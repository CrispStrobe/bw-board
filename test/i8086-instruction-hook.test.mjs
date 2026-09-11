// AN INSTRUCTION HOOK AT THE MACHINE BOUNDARY, NOT OUTSIDE IT.
//
// A debugger that wants to observe retired instructions can in principle wrap
// machine.step() from outside. It cannot get pcBefore right that way: step()
// services interrupts FIRST, so a pending IRQ redirects execution and the pc a
// caller read before calling step() is not the pc the instruction retired from.
// The hook therefore lives inside step(), after interrupt arbitration and around
// the one core call that retires an instruction.
//
// COST IS THE OTHER HALF OF THE DESIGN. A machine with no observer must pay
// nothing measurable, and an observer that only wants addresses must not pay for
// a register snapshot and a 15-byte instruction image on every retire. The
// payload is therefore gated on the observer declaring `captureSnapshot`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, BREADBOARD8086 } from '../src/i8086-machine.js';

// mov al, 0x41 / nop / jmp $ at F800:0000, with the reset vector.
function romWith(bytes) {
    const rom = new Uint8Array(0x8000).fill(0x90);
    rom.set(bytes, 0);
    rom.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);   // jmp f800:0000
    return rom;
}
// reset() lands on the far jump at FFFF:0000, so one step is spent reaching
// F800:0000. Every test here measures from AFTER that, like the other 8086
// fixtures in this suite -- and that priming step is itself a retire, so an
// observer installed at construction sees it. `seen.length = 0` after the
// fixture is what makes each test's count its own.
const machineWith = hooks => {
    const m = new I8086Machine(BREADBOARD8086, hooks);
    m.hooks = hooks;
    m.loadRom(romWith([0xb0, 0x41, 0x90, 0x90]));
    m.reset();
    m.step();
    return m;
};

test('with no observer the machine steps exactly as before', () => {
    const m = machineWith({});
    const before = m.cycles;
    const n = m.step();
    assert.ok(n > 0, 'the step must still retire and report its cycles');
    assert.equal(m.cycles - before, n, 'machine time advanced by exactly what step reported');
});

test('an observer sees the retire boundary, and pays for nothing it did not ask for', () => {
    const seen = [];
    const m = machineWith({onInstruction: ev => seen.push(ev)});
    seen.length = 0;
    const before = m.cycles;
    const n = m.step();

    assert.equal(seen.length, 1, 'exactly one fact per retired instruction');
    const ev = seen[0];
    assert.equal(ev.pcBefore, 0xf8000, 'the reset vector jump landed us at F800:0000');
    assert.equal(ev.cycles, n);
    assert.equal(ev.cyclesBefore, before);
    assert.equal(ev.cyclesAfter, before + n, 'cyclesAfter is machine time AFTER the retire');
    assert.ok(ev.pcAfter > ev.pcBefore, 'the pc moved');

    assert.equal('bytesBefore' in ev, false,
        'an observer that did not ask for a snapshot must not be charged for one');
    assert.equal('registersBefore' in ev, false);
    assert.equal('registersAfter' in ev, false);
});

test('captureSnapshot adds the instruction image and the register pair, read BEFORE execution', () => {
    const seen = [];
    const observer = ev => seen.push(ev);
    observer.captureSnapshot = true;
    const m = machineWith({onInstruction: observer});
    seen.length = 0;
    m.step();

    const ev = seen[0];
    assert.equal(ev.bytesBefore.length, 15,
        'the maximum 8086 instruction window, so a self-modifying instruction cannot ' +
        'make the historical disassembly describe new bytes');
    assert.deepEqual(ev.bytesBefore.slice(0, 2), [0xb0, 0x41], 'the bytes actually at pcBefore');
    assert.equal(ev.registersBefore.ax & 0xff, 0x00, 'AL before the mov');
    assert.equal(ev.registersAfter.ax & 0xff, 0x41, 'AL after it');
    assert.equal(ev.registersBefore.pc, ev.pcBefore);
});

test('the reported boundaries chain, so no retire is missed or invented', () => {
    // THE REASON THE HOOK IS INSIDE step(). step() services interrupts FIRST, so
    // a caller reading cpu.pc and then calling step() can be reporting a pc that
    // execution was redirected away from. A hook after arbitration reports the pc
    // that actually retired -- and the observable consequence is that consecutive
    // facts CHAIN: each pcAfter is the next pcBefore, with no gap where a
    // redirected instruction went unreported.
    const seen = [];
    const m = machineWith({onInstruction: ev => seen.push(ev)});
    seen.length = 0;
    for (let i = 0; i < 3; i++) m.step();

    assert.equal(seen.length, 3, 'one fact per step, none invented and none dropped');
    for (let i = 1; i < seen.length; i++) {
        assert.equal(seen[i].pcBefore, seen[i - 1].pcAfter,
            `fact ${i} starts where fact ${i - 1} ended; a gap means a retire nobody reported`);
        assert.equal(seen[i].cyclesBefore, seen[i - 1].cyclesAfter,
            'machine time must be continuous across the facts too');
    }
});

test('a halted CPU waking on its own does not manufacture a retired instruction', () => {
    const seen = [];
    const m = machineWith({onInstruction: ev => seen.push(ev)});
    seen.length = 0;
    m.cpu.halted = true;
    m.step();
    assert.equal(seen.length, 0,
        'the wake horizon advances time without retiring an instruction; a fact here would be a lie');
});

test('a self-modifying instruction is imaged as it WAS, not as it left itself', () => {
    // THE ASSERTION THAT MAKES "bytesBefore" MEAN ANYTHING. Every other test here
    // passes just as well if the image is read after the retire, because ordinary
    // instructions do not change their own bytes. This one writes over its own
    // opcode, so reading late reports an instruction that never executed -- and a
    // historical disassembly built from it describes code that was never run.
    const seen = [];
    const m = machineWith({onInstruction: ev => seen.push(ev)});
    seen.length = 0;
    m.hooks.onInstruction.captureSnapshot = true;

    // mov byte [0x0400], 0x90  ->  C6 06 00 04 90, sited AT 0x0400 so byte 0 of
    // the instruction is what the store lands on.
    const at = 0x0400;
    for (const [i, b] of [0xc6, 0x06, 0x00, 0x04, 0x90].entries()) m.mem[at + i] = b;
    m.cpu.cs = 0;
    m.cpu.ip = at;

    m.step();

    assert.equal(seen.length, 1);
    assert.equal(seen[0].pcBefore, at);
    assert.equal(seen[0].bytesBefore[0], 0xc6,
        'the image must show the opcode that RAN; 0x90 here means it was read after the store');
    assert.equal(m.mem[at], 0x90, 'the instruction really did overwrite itself');
});
