// TWO COSTS THE DEBUG TARGET PAID ON EVERY CALL, AND NEITHER WAS NECESSARY.
//
// Both are performance changes, so both are written as BEHAVIOUR here: a
// benchmark proves a number on one machine, while an assertion about what the
// target does proves the property that made the number possible.
//
//   runFor  compared machine.tMs against a floating deadline every instruction,
//           and walked the breakpoint Map every instruction even when empty.
//   video   re-rendered the screen on every call. Text mode alone costs about
//           8 ms on the measured Node path, so a static DOS prompt was paying
//           for a picture that had not changed.
//
// THE CACHE IS THE RISKY ONE AND ITS TEST SAYS SO. A cache that never
// invalidates is indistinguishable from a fast renderer until the screen
// changes and the display does not. The assertion that matters is not "the
// cache was consulted" but "a display revision bump RE-RENDERS".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, PCXT8086 } from '../src/i8086-machine.js';
import { createI8086DebugTarget } from '../src/i8086-debug.js';

// PCXT8086 maps 64K of ROM at 0xF0000 and has a CGA, which the video cases
// need. The reset vector at 0xFFFF0 is therefore ROM offset 0xFFF0, and the far
// jump goes to F000:0000.
const romOf = code => {
    const r = new Uint8Array(0x10000).fill(0x90);
    r.set(code, 0);
    r.set([0xea, 0x00, 0x00, 0x00, 0xf0], 0xfff0);
    return r;
};
const build = (code = [0x90]) => {
    const machine = new I8086Machine(PCXT8086, {});
    machine.loadRom(romOf(code));
    machine.reset();
    machine.step();                       // consume the reset-vector jump
    const target = createI8086DebugTarget({machine});
    return {machine, target};
};

test('a sub-cycle budget still executes one whole instruction', () => {
    // THE CLAIM THE CYCLE DEADLINE HAD TO PRESERVE. The old float comparison
    // ran while tMs < tMs + budget/1e6, which for any positive budget is true
    // at least once. Computing a cycle deadline must not round that to zero,
    // or a caller asking for a tiny slice gets no progress at all and the
    // machine appears hung.
    const {machine, target} = build();
    target.run();
    const before = machine.cycles;
    target.runFor(1);                     // one nanosecond: far under a cycle
    assert.ok(machine.cycles > before,
        `a positive budget retired nothing: ${before} -> ${machine.cycles}`);
});

test('a zero budget does not execute an instruction', () => {
    // The other direction, or "always run one" would pass the case above just
    // as well while making every budget meaningless.
    const {machine, target} = build();
    target.run();
    const before = machine.cycles;
    target.runFor(0);
    assert.equal(machine.cycles, before, 'a zero budget must retire nothing');
});

test('a breakpoint still halts once the Map is no longer walked unconditionally', () => {
    // The skip is guarded on breakpoints.size, so the guard must not be able to
    // skip a breakpoint that exists.
    const {machine, target} = build();
    const at = machine.cpu.pc + 1;   // every ROM byte is a NOP, so +1 is a boundary
    const id = target.setBreakpoint({kind: 'code', addr: at});
    assert.ok(Number.isInteger(id), `setBreakpoint refused: ${JSON.stringify(id)}`);
    target.run();
    const verdict = target.runFor(1_000_000);
    assert.equal(verdict, 'halted', 'the breakpoint did not stop the run');
});

test('an unchanged screen returns the SAME frame object, not an equal one', () => {
    const {target} = build();
    const first = target.video();
    if (first.unsupported) return;        // a machine with no display has nothing to cache
    assert.equal(target.video(), first,
        'identity, not equality: an equal object means it re-rendered and matched');
});

test('a display revision bump RE-RENDERS, which is the whole risk of caching', () => {
    // THE ASSERTION THAT MAKES THE CACHE SAFE. A cache that never invalidates
    // is indistinguishable from a fast renderer until the screen changes and
    // the display does not.
    const {machine, target} = build();
    const first = target.video();
    if (first.unsupported) return;

    machine._write(0xb8000, 0x41);        // a write into the video window
    const after = target.video();
    assert.notEqual(after, first, 'the cached frame survived a write to video memory');
    assert.notEqual(after.frame, first.frame,
        'the frame number must move, or a consumer keying on it freezes after its first paint');
});
