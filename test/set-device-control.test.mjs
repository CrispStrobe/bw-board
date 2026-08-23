/**
 * setDeviceControl — the write counterpart of getDeviceState.
 * Hand oracles per spec-updates/set-device-control.md.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerSSD1306, ssd1306Pixel } from '../src/devices/ssd1306.js';
import { registerHD44780 } from '../src/devices/hd44780.js';
import { registerServo } from '../src/devices/servo.js';
import { registerRelay } from '../src/devices/relay.js';
import { registerDisplayDevices } from '../src/devices/display.js';
import { unregisterDevice } from '../src/devices.js';

const KINDS = ['ssd1306', 'hd44780', 'char_lcd', 'servo', 'relay', 'neopixel', 'bargraph'];

function setup() {
  registerSSD1306();
  registerHD44780();
  registerServo();
  registerRelay();
  registerDisplayDevices();
}
function teardown() {
  for (const k of KINDS) { try { unregisterDevice(k); } catch {} }
}

/** Minimal powered bench with one device wired to the rails. */
function bench(kind, terminals, params = {}) {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'D1', kind, params, terminals },
  ];
  const nets = [
    { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'D1', terminal: terminals.includes('vcc') ? 'vcc' : terminals[0] }] },
    { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'D1', terminal: terminals.includes('gnd') ? 'gnd' : terminals[1] }] },
  ];
  const board = new BoardImpl(5.0);
  board.setNetlist(parts, nets);
  return board;
}

describe('setDeviceControl: hd44780 text path', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('print at home, then cursor to line 2', () => {
    const board = bench('hd44780', ['rs', 'rw', 'e', 'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'vdd', 'vss', 'v0', 'a', 'k']);
    assert.equal(board.setDeviceControl('D1', 'print', 'Hi'), true);
    const s = board.getDeviceState('D1');
    assert.equal(s.ddram[0], 0x48, 'H at DDRAM 0');
    assert.equal(s.ddram[1], 0x69, 'i at DDRAM 1');
    assert.equal(board.setDeviceControl('D1', 'cursor', [1, 2]), true);
    assert.equal(board.setDeviceControl('D1', 'print', 'X'), true);
    // Line 2 base 0x40 → flat index 40; col 2 → 42.
    assert.equal(s.ddram[42], 0x58, 'X at line 2 col 2');
    assert.equal(board.setDeviceControl('D1', 'clear', 1), true);
    assert.equal(s.ddram[0], 0x20, 'clear fills spaces');
    assert.equal(s.ac, 0, 'clear homes the address counter');
  });
});

describe('setDeviceControl: ssd1306 drawing', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('pixel, hline, print, clear', () => {
    const board = bench('ssd1306', ['vcc', 'gnd', 'sda', 'scl']);
    const s = board.getDeviceState('D1');

    assert.equal(board.setDeviceControl('D1', 'pixel', [3, 5]), true);
    assert.equal(ssd1306Pixel(s, 3, 5), 1, 'pixel [3,5] set');
    assert.equal(ssd1306Pixel(s, 4, 5), 0, 'neighbour untouched');
    assert.equal(s.displayOn, true, 'drawing wakes the display');

    assert.equal(board.setDeviceControl('D1', 'hline', [10, 20, 7]), true);
    assert.equal(ssd1306Pixel(s, 10, 7), 1);
    assert.equal(ssd1306Pixel(s, 20, 7), 1);
    assert.equal(ssd1306Pixel(s, 9, 7), 0, 'hline stops at x0');
    assert.equal(ssd1306Pixel(s, 21, 7), 0, 'hline stops at x1');

    assert.equal(board.setDeviceControl('D1', 'cursor', [0, 0]), true);
    assert.equal(board.setDeviceControl('D1', 'print', 'A'), true);
    let lit = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) lit += ssd1306Pixel(s, x, y);
    assert.ok(lit > 4, `glyph 'A' must light pixels in cell (0,0), lit=${lit}`);

    assert.equal(board.setDeviceControl('D1', 'clear', 1), true);
    assert.equal(s.fb.some(b => b !== 0), false, 'clear zeroes the framebuffer');
  });
});

describe('setDeviceControl: actuators', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('servo angle sets the target; slew stays the model’s', () => {
    const board = bench('servo', ['signal', 'vcc', 'gnd']);
    assert.equal(board.setDeviceControl('D1', 'angle', 90), true);
    assert.equal(board.getDeviceState('D1').targetAngle, 90);
    assert.equal(board.setDeviceControl('D1', 'angle', 500), true);
    assert.equal(board.getDeviceState('D1').targetAngle, 180, 'clamped to 180');
  });

  it('relay state forces the armature and clears the pending timer', () => {
    const board = bench('relay', ['coil_a', 'coil_b', 'com', 'no', 'nc']);
    assert.equal(board.setDeviceControl('D1', 'state', 1), true);
    const s = board.getDeviceState('D1');
    assert.equal(s.energized, true);
    assert.equal(s._pendingState, null);
    assert.equal(board.setDeviceControl('D1', 'state', 0), true);
    assert.equal(board.getDeviceState('D1').energized, false);
  });

  it('neopixel writes and clears pixels; out-of-range refused', () => {
    const board = bench('neopixel', ['din', 'dout', 'vcc', 'gnd'], { pixels: 8 });
    assert.equal(board.setDeviceControl('D1', 'neopixel', [2, 255, 0, 0]), true);
    assert.equal(board.getDeviceState('D1').pixels[2], 0xff0000);
    assert.equal(board.setDeviceControl('D1', 'neopixel', [99, 1, 2, 3]), false,
      'index beyond the strip is refused, not wrapped');
    assert.equal(board.setDeviceControl('D1', 'clearNeopixels', 1), true);
    assert.equal(board.getDeviceState('D1').pixels[2], 0);
  });
});

describe('setDeviceControl: refusals are visible, fallback works', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('unknown verb refuses with a warning naming part and verb', () => {
    const board = bench('servo', ['signal', 'vcc', 'gnd']);
    assert.equal(board.setDeviceControl('D1', 'teleport', 42), false);
    const w = board.getWarnings().filter(x => x.type === 'device-control-refused');
    assert.equal(w.length, 1);
    assert.ok(w[0].message.includes('teleport') && w[0].message.includes('D1'),
      `warning must name verb and part: ${w[0].message}`);
  });

  it('missing part refuses; nothing crashes', () => {
    const board = bench('servo', ['signal', 'vcc', 'gnd']);
    assert.equal(board.setDeviceControl('GHOST', 'angle', 1), false);
    assert.ok(board.getWarnings().some(x => x.type === 'device-control-refused'));
  });

  it("'state' on an unregistered kind falls back to the control channel", () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'BZ', kind: 'buzzer', params: {}, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'BZ', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'BZ', terminal: 'b' }] },
    ];
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    assert.equal(board.setDeviceControl('BZ', 'state', 1), true);
    assert.equal(board.controls.get('BZ'), 1, 'routed to setControl');
  });
});
