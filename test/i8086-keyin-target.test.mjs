// The keyboard as the DEBUG TARGET sees it — the surface a host widget uses.
//
// The machine has had keyIn() since the support-chip lane wired the 8255 and
// the PIC together, and nothing outside bw-board could reach it: the debug
// target did not expose it, so a host had the hardware and no handle on it.
// This is that handle, plus the capability that says whether offering a
// keyboard is honest for a given board.
//
// `keys: []` on a board with no PPI or no PIC is the same discipline as
// `steps` not listing 'cycle': a host must be able to tell "this machine
// cannot take keys" from "this machine took the key and did nothing", because
// on screen those are identical.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, PCXT8086 } from '../src/i8086-machine.js';
import { createI8086DebugTarget } from '../src/i8086-debug.js';

/** A machine with neither a PPI nor a PIC: nowhere to latch, no wire to raise. */
const NO_KEYBOARD = Object.freeze({
    clockHz: 4_772_727,
    regions: [{ kind: 'ram', start: 0, end: 0x9ffff }, { kind: 'rom', start: 0xf0000, end: 0xfffff }],
    chips: [{ kind: 'cga', name: 'cga1', at: 0x3d0 }],
});

test('an XT board declares the keyboard capability and takes a scancode', () => {
    const m = new I8086Machine(PCXT8086);
    const t = createI8086DebugTarget({ machine: m });
    assert.deepEqual(t.capabilities().keys, ['scancode']);

    // Set-1 make code for 'A'. Delivered means: latched at port A, IRQ1 raised.
    assert.equal(t.keyIn(0x1e), true, 'the target reports it was delivered');
    assert.equal(m.chips.ppi1.read(0), 0x1e, 'the scancode is readable at port 60h');
    assert.equal(m.chips.pic1.irr & 0x02, 0x02, 'and IRQ1 is requesting at the 8259');
});

test('a board with no PPI and no PIC declares NO keyboard and refuses the key', () => {
    // The property that makes the capability worth having. Without it a host
    // would offer a keyboard on this board, the user would type, and nothing
    // would happen -- indistinguishable from a program that ignores input.
    const m = new I8086Machine(NO_KEYBOARD);
    const t = createI8086DebugTarget({ machine: m });
    assert.deepEqual(t.capabilities().keys, [], 'no keyboard is offered');
    assert.equal(t.keyIn(0x1e), false,
        'and a key sent anyway is REFUSED rather than silently dropped');
});

test('the acknowledge path clears IRQ1, so a second key can arrive', () => {
    // The whole reason a real driver strobes port B bit 7. Without the ack the
    // PIC keeps IR1 requesting, and on hardware exactly one key ever arrives --
    // which looks like a keyboard that stopped working rather than a driver
    // that forgot to acknowledge.
    const m = new I8086Machine(PCXT8086);
    const t = createI8086DebugTarget({ machine: m });
    t.keyIn(0x1e);
    assert.equal(m.chips.pic1.irr & 0x02, 0x02, 'first key requesting');

    m._out(0x61, 0x80);                       // strobe HIGH: the acknowledge
    assert.equal(m.chips.pic1.irr & 0x02, 0, 'IRQ1 released on the rising edge');

    t.keyIn(0x30);                            // 'B'
    assert.equal(m.chips.pic1.irr & 0x02, 0x02, 'and the next key raises it again');
    assert.equal(m.chips.ppi1.read(0), 0x30);
});

test('a break code is just a scancode — the target does not invent one', () => {
    // Deliberately NOT modelled here: make-on-press and make|0x80-on-release
    // are the host's business, because only the host knows about key-up. A
    // target that synthesised a break would make every modifier stick or
    // never stick, and neither is a decision this layer can make correctly.
    const m = new I8086Machine(PCXT8086);
    const t = createI8086DebugTarget({ machine: m });
    assert.equal(t.keyIn(0x1e | 0x80), true, 'a break code is delivered like any other');
    assert.equal(m.chips.ppi1.read(0), 0x9e);
});
