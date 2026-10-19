// Controlling the 80286 from the widgets pane. Two input paths reach the same
// 8255 the LED/switch panels already draw:
//
//   1. A ControllerPanel widget (joystick/button/slider) drives an 8255 input
//      pin — the world-facing binding (board.setControl -> ppi.setInput) the
//      z80/6502 tiers use — so a pressed button controls a running 286 program.
//   2. A PS/2 keyboard (Code Set 2, real frame timing) lands its scancode byte
//      on the 8255 via ps2On8255, the 8086/286 analogue of ps2OnVia.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { I8086Machine, BLINK80286 } from '../src/i8086-machine.js';
import { I8255 } from '../src/i8255.js';
import PS2Keyboard, { ps2On8255, SCAN_CODES } from '../src/ps2.js';
import { ControllerPanel } from '../src/controller.js';

const demo = new Uint8Array(readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', 'rom', 'blink-demo.bin')));

test('a controller-panel button controls the running 80286 through its 8255 (control per widgets)', () => {
    const panel = new ControllerPanel();
    panel.addWidget('fire', 'button', { toggle: true });
    const m = new I8086Machine(BLINK80286);
    m.loadRom(demo); m.reset();
    // Route the widget value to port C bit 2 each step — the exact pin a
    // world-facing binding drives (board.setControl -> ppi.setInput). The demo
    // mirrors an active-LOW port-C bit onto its LED, so a pressed button (1)
    // pulls the bit low and lights LED 2.
    const runWithWidget = (n) => {
        for (let i = 0; i < n; i++) { m.chips.ppi1.setInput('c', 2, panel.getValue('fire') ? 0 : 1); m.step(); }
    };
    runWithWidget(2000);                              // let the ROM configure the 8255

    panel.setButtonInput('fire', true);              // toggle ON
    assert.equal(panel.getValue('fire'), 1, 'button is on');
    runWithWidget(9000);                              // warm-up: the ROM re-reads port C once per main loop (a delay loop holds the LED between reads), so let a full iteration pass before sampling
    const lit = new Set();
    for (let k = 0; k < 24; k++) { runWithWidget(3000); lit.add(m._in(0x61) & 0xff); }
    assert.ok([...lit].every((v) => v & 0x04), 'a pressed controller button lights LED 2 on the 286 at every sample');

    panel.setButtonInput('fire', true);              // toggle OFF (toggle flips on press)
    assert.equal(panel.getValue('fire'), 0, 'button is off');
    runWithWidget(9000);                              // warm-up past the toggle
    const off = new Set();
    for (let k = 0; k < 24; k++) { runWithWidget(3000); off.add(m._in(0x61) & 0xff); }
    assert.ok([...off].some((v) => !(v & 0x04)), 'released, LED 2 is dark except when the walk reaches it');
});

test('a PS/2 keyboard delivers Code Set 2 scancodes onto an 8255 (ps2On8255, the 286 tier)', () => {
    const ppi = new I8255();                          // power-on 9Bh: all ports input, so read() returns the delivered pins
    const kbd = new PS2Keyboard();
    const cap = ps2On8255(kbd, ppi, { gapCycles: 100 });
    kbd.keyDown('a');                                 // make  -> 0x1C
    kbd.keyUp('a');                                   // break -> 0xF0, 0x1C
    const bytes = [];
    for (let i = 0; i < 3; i++) { cap.advance(100); bytes.push(ppi.read(0) & 0xff); }
    assert.deepEqual(bytes, [SCAN_CODES.a, 0xf0, SCAN_CODES.a], 'port A latches the make, break-prefix, break-code');
    assert.equal(ppi.read(2) & 1, 1, 'DATA AVAILABLE strobe (port C bit 0) set after a delivered frame');
});

test('the PS/2 capture paces frames by machine cycles — no frame before the inter-frame gap', () => {
    const ppi = new I8255();
    const kbd = new PS2Keyboard();
    const cap = ps2On8255(kbd, ppi, { gapCycles: 1000 });
    kbd.keyDown('a');
    cap.advance(500);
    assert.equal(kbd.fifo.length, 1, 'nothing shifted before a full frame gap elapses');
    cap.advance(600);
    assert.equal(kbd.fifo.length, 0, 'the frame shifts once enough cycles have elapsed');
    assert.equal(ppi.read(0) & 0xff, SCAN_CODES.a, 'and its byte is on port A');
});
