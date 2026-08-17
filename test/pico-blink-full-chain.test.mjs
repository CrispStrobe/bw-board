// Task #32's proof standard: the RP2040 CPU executes a Thumb blink, the
// adapter publishes GP25 edges onto a REAL board carrying a seated
// pi_pico, and the ONBOARD LED's brightness follows — the same headless
// bar the calculator cleared. Program and cycle math are the adapter
// test's own (602-cycle half periods at 125 MHz).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { createRp2040jsAdapter } from '../src/rp2040js-adapter.js';

registerAllDevices();

const BLINK = new Uint16Array([
  0x2005, 0x4907, 0x6008, 0x2001, 0x0640, 0x4906, 0x6248,
  0x6148, 0x22C8, 0x3A01, 0xD1FD, 0x6188, 0x22C8, 0x3A01, 0xD1FD, 0xE7F6,
  0x40CC, 0x4001,
  0x0000, 0xd000,
]);

describe('Pico full chain: CPU blink lights the onboard LED', () => {
  it('GP25 toggles from the program and the onboard LED integrates it', () => {
    const parts = [
      { id: 'PICO', kind: 'pi_pico', params: {}, terminals: ['gp25', 'gnd_1', '3v3', 'vbus'] },
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ];
    const nets = [
      { id: 'n_v', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'PICO', terminal: 'vbus' }] },
      { id: 'n_g', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'PICO', terminal: 'gnd_1' }] },
    ];
    const board = new BoardImpl(3.3);
    board.setNetlist(parts, nets);
    board.setPower(true);
    const adapter = createRp2040jsAdapter({ clockHz: 125_000_000, vcc: 3.3 });
    adapter.attachBoard(board);
    adapter.loadProgram(BLINK);
    // The blink period is ~9.6 µs, far inside the 20 ms brightness
    // window, so the LED integrates to blink duty × its DC brightness.
    // At 3.3 V through the onboard 1 kΩ: (3.3 − Vf) / 1k ≈ 1.3 mA of a
    // 20 mA rating ≈ 0.065 full-on — honestly dim, exactly like the
    // real board's tiny SMD LED — and ~0.032 at 50% duty. The face's
    // perceptual gamma is what makes it clearly visible on canvas.
    adapter.advanceNs(40_000_000); // 40 ms
    const b = board.ledBrightness('PICO_onboard');
    assert.ok(b > 0.015 && b < 0.06, `onboard LED at half duty of its DC level, got ${b}`);
  });
});
