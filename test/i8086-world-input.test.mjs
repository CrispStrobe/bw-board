// GIVING THE MACHINE INPUT — the other half of a workbench.
//
// `video()`, `audioTone()` and `regs()` report what the machine is DOING.
// Until now nothing let a widget or a code block change what the machine
// SEES: the 8255 has had `setInput()` since it was written, but the only
// caller was the adapter reading a DRAWN BOARD. A user with no schematic --
// the ASM tab, the pseudocode tab, a lesson with a switch widget -- had no
// way to flip anything. A workbench that can only observe is a television.
//
// The assertion that matters is not that a port reads back. It is that a
// RUNNING PROGRAM changes its behaviour because someone flipped something.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, PCXT8086 } from '../src/i8086-machine.js';
import { createI8086DebugTarget } from '../src/i8086-debug.js';
import { createDos8086, DOSBOX8086_XT } from '../src/i8086-dos.js';
import { assembleRaw } from '../src/i8086-asm.js';

test('the machine declares which inputs exist, and none when it has no hardware', () => {
    const m = new I8086Machine(PCXT8086);
    const pts = createI8086DebugTarget({ machine: m }).capabilities().inputs;
    assert.deepEqual(pts.map((p) => `${p.chip}.${p.port}`), ['ppi1.a', 'ppi1.b', 'ppi1.c']);

    // A machine with no 8255 declares NO inputs, on the same terms as `keys`.
    // Offering a switch widget for a board that cannot read one would give a
    // user a control that does nothing, which is indistinguishable from a
    // program ignoring them.
    const bare = new I8086Machine({
        clockHz: 4_772_727,
        regions: [{ kind: 'ram', start: 0, end: 0x9ffff }],
        chips: [{ kind: 'cga', name: 'cga1', at: 0x3d0 }],
    });
    assert.deepEqual(createI8086DebugTarget({ machine: bare }).capabilities().inputs, []);
    assert.equal(createI8086DebugTarget({ machine: bare }).setInput('ppi1', 'a', 0, 1), false,
        'and it REFUSES the write rather than swallowing it');
});

test('a bad address is refused, every way it can be bad', () => {
    const t = createI8086DebugTarget({ machine: new I8086Machine(PCXT8086) });
    assert.equal(t.setInput('nosuch', 'a', 0, 1), false, 'no such chip');
    assert.equal(t.setInput('ppi1', 'd', 0, 1), false, 'no such port');
    assert.equal(t.setInput('ppi1', 'a', 8, 1), false, 'bit past the port');
    assert.equal(t.setInput('ppi1', 'a', -1, 1), false, 'and below it');
    assert.equal(t.setInput('ppi1', 'a', 0, 1), true, 'while a good one succeeds');
});

test('A RUNNING PROGRAM SEES THE SWITCH FLIP', () => {
    // The whole point. A program polls port 60h (8255 port A) and prints 'Y'
    // the moment bit 0 goes low, then exits. Nothing about the program knows
    // a person exists; it reads a port in a loop, exactly as a real one would.
    const m = new I8086Machine({ ...DOSBOX8086_XT });
    let out = '';
    const dos = createDos8086(m, { onChar: (c) => { out += c; } }).install();
    const t = createI8086DebugTarget({ machine: m });

    dos.loadCom(assembleRaw([
        'poll:',
        ' in al, 60h',
        ' test al, 1',            // bit 0 high = switch open
        ' jnz poll',              // still open: keep polling
        ' mov ah, 02h',
        ' mov dl, 59h',           // 'Y'
        ' int 21h',
        ' mov ax, 4c00h',
        ' int 21h',
    ].join('\n'), 0x100));

    // Run a while with the switch OPEN. It must NOT finish -- if it does, the
    // test proves nothing about the flip, because the program was leaving
    // anyway.
    for (let i = 0; i < 50_000 && !dos.terminated; i++) dos.step();
    assert.ok(!dos.terminated, 'the program is still polling, as it should be');
    assert.equal(out, '', 'and has printed nothing');

    // Somebody flips the switch.
    assert.equal(t.setInput('ppi1', 'a', 0, 0), true);

    for (let i = 0; i < 50_000 && !dos.terminated; i++) dos.step();
    assert.ok(dos.terminated, 'the program noticed and ran on');
    assert.equal(out, 'Y', 'and it printed what the switch means');
});

test('inputs are per-BIT, so one switch does not disturb its neighbours', () => {
    // A port is eight switches. Driving one must leave the other seven where
    // they were, or a lesson with two buttons has one button.
    const m = new I8086Machine(PCXT8086);
    const t = createI8086DebugTarget({ machine: m });
    assert.equal(m._in(0x60), 0xff, 'all inputs idle high, as an undriven bus reads');
    t.setInput('ppi1', 'a', 2, 0);
    assert.equal(m._in(0x60), 0xfb, 'only bit 2 moved');
    t.setInput('ppi1', 'a', 5, 0);
    assert.equal(m._in(0x60), 0xdb, 'and bit 5, with bit 2 still where it was put');
    t.setInput('ppi1', 'a', 2, 1);
    assert.equal(m._in(0x60), 0xdf, 'releasing one leaves the other held');
});

// ---------------------------------------------------------------------------
// The other direction: what the world can SEE
// ---------------------------------------------------------------------------

test('an output port reports value, direction AND pins, and all three are needed', () => {
    // `value` is what the chip DRIVES. `dir` is which bits it drives at all.
    // `pins` is what the wires actually carry -- the latch where the chip
    // drives, the input elsewhere.
    //
    // Value alone would light an LED on a bit configured as an INPUT, which is
    // a lamp for a wire the chip is not driving. That is not a rendering
    // nicety: a program that reconfigures a port mid-run would leave lamps lit
    // for bits it no longer controls.
    const m = new I8086Machine(PCXT8086);
    const t = createI8086DebugTarget({ machine: m });

    m._out(0x63, 0x80);                       // mode 0, every port an OUTPUT
    m._out(0x60, 0b10100101);
    const a = t.outputs().find((o) => o.port === 'a');
    assert.equal(a.value, 0b10100101, 'the latch holds what was written');
    assert.equal(a.dir, 0xff, 'and the chip drives all eight');
    assert.equal(a.pins, 0b10100101, 'so the pins carry the latch');

    // Now make port A an INPUT. The latch is CLEARED by the mode word -- a
    // real 8255 does that, and it is why an LED goes dark for the instant
    // between configuring a chip and writing to it.
    m._out(0x63, 0x90);                       // mode 0, port A now an input
    const b = t.outputs().find((o) => o.port === 'a');
    assert.equal(b.dir, 0x00, 'the chip drives nothing on port A now');
    assert.equal(b.pins, 0xff, 'and the pins read the undriven bus, not the old latch');
});

test('a machine with no port chip declares no outputs either', () => {
    const bare = new I8086Machine({
        clockHz: 4_772_727,
        regions: [{ kind: 'ram', start: 0, end: 0x9ffff }],
        chips: [{ kind: 'cga', name: 'cga1', at: 0x3d0 }],
    });
    const t = createI8086DebugTarget({ machine: bare });
    assert.deepEqual(t.capabilities().outputs, [], 'nothing to show');
    assert.deepEqual(t.outputs(), [], 'and nothing to read');
});

test('capabilities lists the SHAPE and outputs() reports the STATE', () => {
    // The distinction that stops a renderer reading a photograph: which ports
    // exist does not change, so it belongs in capabilities; what they are
    // doing changes every instruction, so it must be asked for per frame.
    const m = new I8086Machine(PCXT8086);
    const t = createI8086DebugTarget({ machine: m });
    const caps = t.capabilities().outputs;
    assert.ok(caps.length > 0);
    for (const c of caps) {
        assert.deepEqual(Object.keys(c).sort(), ['bits', 'chip', 'port'],
            'a capability carries no VALUE -- one captured there would be stale by the '
            + 'time anything rendered it');
    }
    m._out(0x63, 0x80);
    m._out(0x61, 0x42);
    assert.equal(t.outputs().find((o) => o.port === 'b').value, 0x42,
        'while outputs() reflects the write immediately');
});
