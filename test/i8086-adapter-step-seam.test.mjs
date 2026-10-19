// A BOUNDARY SERVICE CAN OWN THE INSTRUCTION STEP.
//
// Some hosts put a service layer between the debug target and the machine: work
// that must happen at an instruction boundary before the hardware steps. A DOS
// trap layer is the case this exists for -- INT 21h is serviced there, not in
// the core.
//
// The target therefore steps through `adapter.step` when the adapter provides
// one, and through `machine.step` when it does not. WITHOUT THAT SEAM the CPU
// runs and the service does not: the program executes, its system calls never
// happen, and nothing reports it. The machine is not broken, it is the wrong
// machine.
//
// AN EXTENSION POINT IS NOT A DEAD GUARD, and the difference is whether anything
// CAN install it. Nothing in this repository provides `adapter.step` today. That
// makes it uninstalled, not dead -- the same standing as `captureWriteBefore`,
// which nothing here sets either. This distinction cost a capability once:
// the branch was deleted as unreachable after measuring only the repository it
// was being deleted from, while the file it was measured in is vendored into
// another that does install it.
//
// THE TEST DRIVES THE SEAM RATHER THAN ACCEPTING IT. A target that takes the
// option and never calls it passes any check that the option was accepted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, BREADBOARD8086 } from '../src/i8086-machine.js';
import { createI8086DebugTarget } from '../src/i8086-debug.js';

const machineWith = code => {
    const r = new Uint8Array(0x8000).fill(0x90);
    r.set(code, 0);
    r.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);
    const m = new I8086Machine(BREADBOARD8086, {});
    m.loadRom(r);
    m.reset();
    m.step();
    return m;
};
/** An adapter whose step() is the boundary service. */
const servicing = machine => {
    const calls = {n: 0};
    return {calls, adapter: {machine, step() { calls.n++; return machine.step(); }}};
};

test('runFor steps THROUGH the adapter when one provides step()', () => {
    const machine = machineWith([0x90]);
    const {calls, adapter} = servicing(machine);
    const target = createI8086DebugTarget(adapter);

    const before = machine.cycles;
    target.run();
    target.runFor(200_000);

    assert.ok(machine.cycles > before, 'nothing executed; the fixture never ran');
    assert.ok(calls.n > 0,
        'the CPU advanced without the boundary service being called once -- ' +
        'the program runs and its system calls never happen');
    assert.equal(calls.n > 1, true, 'the service must be called per instruction, not once');
});

test('replayInstruction REFUSES a serviced target rather than stepping it', () => {
    // NOT a seam test, and the mutation that survived is why this now says so. A
    // boundary service holds state outside the machine, so replay refuses before
    // it would ever reach a step -- which means routing that call through the
    // seam would be a branch nothing can take.
    const machine = machineWith([0x90]);
    const {calls, adapter} = servicing(machine);
    const r = createI8086DebugTarget(adapter).replayInstruction();

    assert.equal(r.accepted, false, 'a serviced target must not claim a replayable boundary');
    assert.equal(r.code, 'unsupported-replay');
    assert.equal(calls.n, 0, 'and it must refuse WITHOUT executing anything');
});

test('a target with NO adapter step is unaffected', () => {
    // The extension point must not change the machine-only path, which is every
    // caller in this repository today.
    const machine = machineWith([0x90]);
    const target = createI8086DebugTarget({machine});
    const before = machine.cycles;
    target.run();
    target.runFor(200_000);
    assert.ok(machine.cycles > before, 'the machine-only path stopped working');
});

test('a service holding state outside the machine is refused a checkpoint, by name', () => {
    // The other half of the same concept. `adapter.step` means work happens
    // outside I8086Machine, so a machine-only checkpoint would omit it -- and a
    // checkpoint that silently omits state restores a machine that looks right
    // and is not.
    const machine = machineWith([0x90]);
    const {adapter} = servicing(machine);
    const target = createI8086DebugTarget(adapter);

    assert.deepEqual(target.capabilities().recording, [],
        'a target that cannot capture the service state must not advertise recording');
    const r = target.captureCheckpoint();
    assert.equal(r.code, 'INCOMPLETE_CHECKPOINT_STATE');
    assert.match(r.refused, /outside the machine/);
});

test('the machine advances THROUGH the service, not alongside it', () => {
    // THE ASSERTION A CALL COUNT CANNOT MAKE. A target that calls adapter.step()
    // and then steps the machine itself satisfies "the service was called" while
    // still running the wrong machine -- twice, in fact. The discriminator is a
    // service that INTERCEPTS: if it declines to advance the machine and the
    // machine advances anyway, something else is stepping it.
    const machine = machineWith([0x90]);
    let calls = 0;
    const adapter = {machine, step() { calls++; return 0; }};   // services, does not advance
    const target = createI8086DebugTarget(adapter);

    const before = machine.cycles;
    target.run();
    target.runFor(50_000);

    assert.ok(calls > 0, 'the service was never called at all');
    assert.equal(machine.cycles, before,
        `the machine advanced ${machine.cycles - before} cycles while the service declined to ` +
        'advance it -- the target is stepping the machine behind the seam');
});

test('a service that works one boundary and steps the next is NOT stopped', () => {
    // THE CASE THE FIRST VERSION OF THIS GUARD BROKE, and it broke it silently.
    // A boundary service does work AT a boundary: the DOS trap layer answers
    // INT 21h by inspecting CS:IP before the hardware steps, so an iteration
    // where machine time does not move is ordinary servicing, not a stall.
    //
    // Halting on the FIRST such iteration stopped every DOS program from ever
    // reaching INT 21h/4Ch. They ran, never terminated, and looked on screen
    // exactly like a program that hung -- no throw, no red, nothing to read.
    const machine = machineWith([0x90]);
    let calls = 0;
    const adapter = {machine, step() {
        // odd calls service and return without advancing; even calls step
        return (++calls % 2) ? 0 : machine.step();
    }};
    const target = createI8086DebugTarget(adapter);

    const before = machine.cycles;
    target.run();
    const verdict = target.runFor(50_000);

    assert.ok(machine.cycles > before,
        'the alternating service made no progress at all; the guard stopped it');
    assert.notEqual(verdict, 'halted',
        'a service that advances every second boundary is working, not stalled');
});
