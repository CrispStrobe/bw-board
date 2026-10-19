/**
 * E6.8.2 — symbols reach the debugger.
 *
 * `i8086-asm.js` has always returned a `symbols` Map and `i8086-disasm.js`
 * has always accepted a `labels` one. NOTHING JOINED THEM, so a learner who
 * wrote `delay_loop:` read `jmp 002Bh`. This file is the join, and it covers
 * the three places the join can be silently wrong rather than loudly broken:
 *
 *   - an EQU admitted as an address (a constant renaming whatever lives there)
 *   - a linear map handed to a disassembler that speaks segment offsets
 *     (labels nothing, on every machine whose code is not at segment zero)
 *   - a breakpoint on an unknown name doing nothing (the program runs to
 *     completion and the evidence says it never reached the label)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { assemble } from '../src/i8086-asm.js';
import { I8086Machine } from '../src/i8086-machine.js';
import { createI8086DebugTarget, labelsFromAssembly } from '../src/i8086-debug.js';

const SRC = `
        org 100h
start:  mov ax, BUFSIZE
        jmp delay_loop
delay_loop:
        mov ax, [counter]
        jmp start
counter dw 0
BUFSIZE equ 1234h
`;

const target = (loadSeg = 0) => {
    const r = assemble(SRC, { format: 'com' });
    const machine = new I8086Machine({
        clockHz: 5_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0xfffff }],
        chips: [],
    });
    const base = ((loadSeg << 4) + 0x100) & 0xfffff;
    machine.mem.set(r.bytes, base);
    machine.cpu.cs = loadSeg; machine.cpu.ip = 0x100;
    machine.cpu.ds = loadSeg; machine.cpu.ss = loadSeg; machine.cpu.sp = 0xfffe;
    const t = createI8086DebugTarget({ machine });
    return { r, t, machine, base };
};

test('the target declares it can take symbols', () => {
    const { t } = target();
    assert.equal(t.capabilities().symbols, true);
});

test('an EQU is not an address, and does not become a label', () => {
    const { r } = target();
    const labels = labelsFromAssembly(r);
    const names = [...labels.values()];
    assert.ok(names.includes('start'), 'a code label is kept');
    assert.ok(names.includes('delay_loop'), 'so is the one the learner cares about');
    assert.ok(names.includes('counter'), 'and a data label, which the direct forms use');
    // THE POINT OF THIS TEST. BUFSIZE names the number 1234h. Admitting it
    // would put `BUFSIZE` in front of whatever happens to live at 1234h --
    // an invented cross-reference a reader cannot distinguish from a real one.
    assert.ok(!names.includes('BUFSIZE'), 'an EQU is a constant, not an address');
});

test('setSymbols reports the count, and refuses to pretend about an empty map', () => {
    const { t } = target();
    assert.equal(t.setSymbols(new Map()), 0, 'an empty map is not "symbols loaded"');
    assert.equal(t.setSymbols(null), 0);
    const n = t.setSymbols(new Map([[0x100, 'start']]));
    assert.equal(n, 1, 'the count comes back so a caller can tell empty from working');
    assert.equal(t.symbolAt(0x100), 'start');
    assert.equal(t.symbolAt(0x999), null);
});

test('the pane names a jump target instead of a number', () => {
    const { r, t } = target();
    t.setSymbols(labelsFromAssembly(r));
    // `jmp delay_loop` is the second instruction, at org+3.
    const text = t.disasm(0x103).text;
    assert.ok(/delay_loop/.test(text), `expected a name, got: ${text}`);
    assert.ok(!/\b010[0-9A-F]h\b/.test(text), `expected no bare address, got: ${text}`);
});

test('THE JOIN THAT FAILS SILENTLY: a linear map on a machine not at segment zero', () => {
    // The map is linear; the disassembler labels a 16-bit operand, which is an
    // offset in the segment the instruction came from. Get the rebase wrong
    // and nothing is labelled -- and nothing raises, it just renders hex. So
    // the same program is loaded at a REAL segment and must still read the
    // same way.
    const { r, t } = target(0x2000);
    const n = t.setSymbols(labelsFromAssembly(r, { loadSeg: 0x2000 }));
    assert.ok(n >= 3, `expected labels, got ${n}`);
    const text = t.disasm((0x2000 << 4) + 0x103).text;
    assert.ok(/delay_loop/.test(text), `expected a name at segment 2000h, got: ${text}`);
});

test('a breakpoint by name resolves, and an unknown name REFUSES', () => {
    const { r, t } = target(0x2000);
    t.setSymbols(labelsFromAssembly(r, { loadSeg: 0x2000 }));

    const id = t.setBreakpoint({ kind: 'code', symbol: 'delay_loop' });
    assert.equal(typeof id, 'number', 'a known name gives a breakpoint id');

    // Case-insensitively, because MASM symbols are.
    assert.equal(typeof t.setBreakpoint({ kind: 'code', symbol: 'DELAY_LOOP' }), 'number');

    // AND THE ONE THAT MATTERS: an unknown name is refused by name rather
    // than silently doing nothing. A no-op here lets the program run to
    // completion and produces evidence that it never reached the label --
    // a different and much more interesting claim than the truth.
    const bad = t.setBreakpoint({ kind: 'code', symbol: 'no_such_label' });
    assert.ok(bad && /no symbol named/.test(bad.unsupported), `expected a refusal, got ${JSON.stringify(bad)}`);

    // And asking by name before any symbols are loaded says so specifically.
    const { t: bare } = target();
    const early = bare.setBreakpoint({ kind: 'code', symbol: 'start' });
    assert.ok(early && /no symbols are loaded/.test(early.unsupported));
});

test('a breakpoint by name actually stops the machine there', () => {
    const { r, t, machine } = target(0x2000);
    t.setSymbols(labelsFromAssembly(r, { loadSeg: 0x2000 }));
    const id = t.setBreakpoint({ kind: 'code', symbol: 'delay_loop' });
    assert.equal(typeof id, 'number');
    t.run();
    t.runFor(1_000_000);
    assert.equal(t.state(), 'halted', 'it stopped');
    const pc = t.regs().pc;
    assert.equal(pc, ((0x2000 << 4) + 0x105) & 0xfffff,
        'and it stopped AT the label, not merely somewhere');
});

test('addr still works, and the refusal now names both ways in', () => {
    const { t } = target();
    assert.equal(typeof t.setBreakpoint({ kind: 'code', addr: 0x100 }), 'number');
    const r = t.setBreakpoint({ kind: 'code' });
    assert.ok(r && /addr or symbol required/.test(r.unsupported), JSON.stringify(r));
});
