// The PS/2 mouse: the standard 3-byte packet, riding the SAME capture chain and
// 8255 bridge the keyboard does (a mouse is just another PS/2 device). Movement
// and buttons are driven by controller-panel widgets — pointer control per widget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8255 } from '../src/i8255.js';
import { PS2Mouse, ps2On8255 } from '../src/ps2.js';
import { ControllerPanel } from '../src/controller.js';

// Read one 3-byte packet delivered byte-by-byte through the 8255 and decode it.
function readPacket(cap, ppi) {
    const [b1, x, y] = [0, 0, 0].map(() => { cap.advance(200); return ppi.read(0) & 0xff; });
    return {
        left: !!(b1 & 1), right: !!(b1 & 2), middle: !!(b1 & 4),
        dx: (b1 & 0x10) ? x - 256 : x,   // XS (bit4) sign-extends byte 2
        dy: (b1 & 0x20) ? y - 256 : y,   // YS (bit5) sign-extends byte 3
    };
}
const bridge = () => { const ppi = new I8255(); const mouse = new PS2Mouse(); return { ppi, mouse, cap: ps2On8255(mouse, ppi, { gapCycles: 100 }) }; };

test('a movement packet carries signed X/Y deltas', () => {
    const { ppi, mouse, cap } = bridge();
    mouse.move(5, -3);
    const p = readPacket(cap, ppi);
    assert.equal(p.dx, 5);
    assert.equal(p.dy, -3);
    assert.equal(p.left, false, 'no button in a plain move');
});

test('a full-scale negative delta stays in range and decodes correctly', () => {
    const { ppi, mouse, cap } = bridge();
    mouse.move(-128, 127);
    const p = readPacket(cap, ppi);
    assert.equal(p.dx, -128);
    assert.equal(p.dy, 127);
});

test('button state rides in every packet, and each change emits a report', () => {
    const { ppi, mouse, cap } = bridge();
    mouse.press('left');
    let p = readPacket(cap, ppi);
    assert.equal(p.left, true); assert.equal(p.dx, 0, 'a press is a zero-move report');

    mouse.move(-10, 0);                       // moving with the button held
    p = readPacket(cap, ppi);
    assert.equal(p.left, true); assert.equal(p.dx, -10);

    mouse.press('right');                     // now left+right
    p = readPacket(cap, ppi);
    assert.equal(p.left, true); assert.equal(p.right, true);

    mouse.release('left');
    p = readPacket(cap, ppi);
    assert.equal(p.left, false); assert.equal(p.right, true);
});

test('controller-panel widgets drive the mouse (pointer control per widgets)', () => {
    const { ppi, mouse, cap } = bridge();
    const panel = new ControllerPanel();
    panel.addWidget('mx', 'slider', { min: -100, max: 100, value: 0 });
    panel.addWidget('click', 'button', {});

    // Host binding: the slider's delta moves the mouse; the button clicks it.
    panel.setSliderInput('mx', 20);
    mouse.move(panel.getValue('mx'), 0);
    let p = readPacket(cap, ppi);
    assert.equal(p.dx, 20, 'the widget axis moved the pointer');

    panel.setButtonInput('click', true);      // momentary button pressed
    mouse.press('left');
    p = readPacket(cap, ppi);
    assert.equal(p.left, true, 'the widget button clicked the pointer');
});
