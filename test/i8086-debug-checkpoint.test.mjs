// THE 8086 DEBUG TARGET CAN CHECKPOINT ITS OWN STATE, NOT JUST THE MACHINE'S.
//
// I8086Machine has had captureCheckpoint/restoreCheckpoint for a while, and the
// m6502 and z80 bridges already expose them. The 8086 target did not, so a
// caller wanting to branch 8086 history had to snapshot the machine and then
// separately guess at the debugger's own bookkeeping -- run state, a pending
// step, the event clock epoch. Those are not derivable from the machine: a
// restored machine with stale debugger state single-steps into the wrong place.
//
// WHAT THE TARGET ADDS OVER THE MACHINE'S OWN CHECKPOINT:
//   - the debugger's run state and pending step, validated BEFORE the machine
//     mutates, so a bad snapshot cannot half-apply;
//   - a fresh event-clock epoch on restore, because a branch in history must not
//     make the existing event clock run backwards;
//   - a refusal when something outside the machine holds state the checkpoint
//     cannot see.
//
// THE REFUSAL IS THE PART WORTH TESTING HARDEST. A checkpoint that silently
// omits state is worse than one that declines: it restores to a machine that
// looks right and is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, BREADBOARD8086 } from '../src/i8086-machine.js';
import { createI8086Adapter } from '../src/i8086-adapter.js';
import { createI8086DebugTarget } from '../src/i8086-debug.js';

const machineOnly = () => {
    const machine = new I8086Machine(BREADBOARD8086);
    return {machine, target: createI8086DebugTarget({machine})};
};

test('a target over a checkpointable machine advertises recording, and a round trip restores', () => {
    const {machine, target} = machineOnly();
    assert.deepEqual(target.capabilities().recording, ['checkpoint', 'restore'],
        'the machine can checkpoint, so the target must say so rather than leave callers guessing');

    machine._write(0x0400, 0x5a);
    const snap = target.captureCheckpoint();
    assert.ok(!snap.refused, `capture refused: ${snap.refused}`);
    assert.ok(snap.debugger, 'the target must attach its OWN state, not just the machine envelope');

    machine._write(0x0400, 0xa5);
    assert.equal(machine.mem[0x0400], 0xa5);
    assert.equal(target.restoreCheckpoint(snap), true);
    assert.equal(machine.mem[0x0400], 0x5a, 'the restore did not reach machine memory');
});

test('the event clock gets a fresh epoch on restore, so a branch cannot run it backwards', () => {
    const {target} = machineOnly();
    const before = target.debugTime().domain;
    const snap = target.captureCheckpoint();
    assert.equal(target.restoreCheckpoint(snap), true);
    const after = target.debugTime().domain;
    assert.notEqual(after, before,
        'restoring is a branch in history; reusing the domain would let one timeline read as two');
});

test('a checkpoint carrying no debugger state is refused, not half-applied', () => {
    const {machine, target} = machineOnly();
    const bare = machine.captureCheckpoint();       // the MACHINE envelope alone
    const r = target.restoreCheckpoint(bare);
    assert.equal(r.code, 'INVALID_CHECKPOINT');
    assert.match(r.refused, /debugger state/);
});

test('an invalid run state is refused BEFORE the machine mutates', () => {
    const {machine, target} = machineOnly();
    machine._write(0x0400, 0x11);
    const snap = target.captureCheckpoint();
    machine._write(0x0400, 0x22);
    snap.debugger.runState = 'sprinting';

    const r = target.restoreCheckpoint(snap);
    assert.equal(r.code, 'INVALID_CHECKPOINT');
    assert.match(r.refused, /run state/);
    assert.equal(machine.mem[0x0400], 0x22,
        'the refusal must leave memory untouched -- validating after the machine applied would corrupt');
});

test('an invalid pending step is refused the same way', () => {
    const {target} = machineOnly();
    const snap = target.captureCheckpoint();
    snap.debugger.pendingStep = {kind: 'sideways'};
    const r = target.restoreCheckpoint(snap);
    assert.equal(r.code, 'INVALID_CHECKPOINT');
    assert.match(r.refused, /pending instruction step/);
});

test('an unlogged live input source refuses the checkpoint rather than omitting it', () => {
    // The board is sampled directly, so inputs exist that the checkpoint cannot
    // see. Declining is the whole point: a snapshot that quietly drops them
    // restores a machine that looks right and is not.
    const adapter = createI8086Adapter({config: BREADBOARD8086});
    adapter.attachBoard({
        setPin() {}, advanceTo() {}, readPin() { return 0; }, readAnalog() { return 0; }
    });
    const target = createI8086DebugTarget(adapter);

    assert.deepEqual(target.capabilities().recording, [],
        'a target that cannot capture everything must not advertise recording');
    const r = target.captureCheckpoint();
    assert.equal(r.code, 'INCOMPLETE_CHECKPOINT_STATE');
    assert.match(r.refused, /outside the machine/);
});

test('replayInstruction retires exactly one boundary, and refuses a halted CPU by name', () => {
    const {machine, target} = machineOnly();
    const before = machine.cycles;
    const r = target.replayInstruction();
    assert.equal(r.accepted, true);
    assert.equal(r.boundary, 'instruction');
    assert.equal(r.cycles, machine.cycles - before, 'the reported cost must be the cost actually paid');

    machine.cpu.halted = true;
    const halted = target.replayInstruction();
    assert.equal(halted.accepted, false);
    assert.equal(halted.code, 'halted-without-instruction');
});
