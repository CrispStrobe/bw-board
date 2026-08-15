// ILI9341 oracle tests — expectations hand-computed from the ILITEK
// datasheet: 4-line serial interface II (D/CX per byte, MOSI sampled on
// SCK rising), CASET/PASET windows with wrap-and-advance RAMWR, MADCTL
// remapping, COLMOD, and the reset/sleep/display-on ladder every real
// driver walks before drawing anything.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { registerILI9341, ili9341Rgba, ILI9341_W } from '../src/devices/ili9341.js';
import { getDevice, unregisterDevice } from '../src/devices.js';

function makeLcd() {
  registerILI9341();
  const model = getDevice('ili9341');
  const part = { id: 'tft', kind: 'ili9341', params: {} };
  const state = model.init(part);
  const pins = { vcc: 3.3, gnd: 0, cs: 3.3, rst: 3.3, dc: 0, mosi: 0, sck: 0, miso: 0, led: 3.3 };
  const read = (t) => pins[t] ?? 0;
  let t = 0n;
  const clockByte = (byte, isData) => {
    pins.dc = isData ? 3.3 : 0;
    for (let i = 7; i >= 0; i--) {
      pins.mosi = (byte >> i) & 1 ? 3.3 : 0;
      pins.sck = 3.3; model.update(part, state, read, t); t += 100n;
      pins.sck = 0; model.update(part, state, read, t); t += 100n;
    }
  };
  const select = (on) => { pins.cs = on ? 0 : 3.3; model.update(part, state, read, t); t += 100n; };
  const cmd = (c, ...params) => { clockByte(c, false); for (const p of params) clockByte(p, true); };
  const wake = () => { select(true); cmd(0x11); cmd(0x29); }; // SLPOUT + DISPON
  const window = (x0, x1, y0, y1) => {
    cmd(0x2a, x0 >> 8, x0 & 0xff, x1 >> 8, x1 & 0xff);
    cmd(0x2b, y0 >> 8, y0 & 0xff, y1 >> 8, y1 & 0xff);
  };
  return { model, part, state, pins, read, clockByte, select, cmd, wake, window };
}

describe('ILI9341 SPI TFT', () => {
  beforeEach(() => { try { unregisterDevice('ili9341'); } catch {} });

  it('boots sleeping and dark; SLPOUT + DISPON wake it', () => {
    const l = makeLcd();
    assert.equal(l.state.sleeping, true);
    assert.equal(l.state.displayOn, false);
    l.wake();
    assert.equal(l.state.sleeping, false);
    assert.equal(l.state.displayOn, true);
  });

  it('RAMWR fills the CASET/PASET window with wrap-and-advance', () => {
    const l = makeLcd();
    l.wake();
    l.window(10, 11, 20, 21); // 2x2 window
    l.cmd(0x2c);
    // four RGB565 pixels: red, green, blue, white
    const px = [0xf800, 0x07e0, 0x001f, 0xffff];
    for (const p of px) { l.clockByte(p >> 8, true); l.clockByte(p & 0xff, true); }
    assert.equal(l.state.gram[20 * ILI9341_W + 10], 0xf800, '(10,20) red');
    assert.equal(l.state.gram[20 * ILI9341_W + 11], 0x07e0, '(11,20) green — column advanced');
    assert.equal(l.state.gram[21 * ILI9341_W + 10], 0x001f, '(10,21) blue — wrapped to next page');
    assert.equal(l.state.gram[21 * ILI9341_W + 11], 0xffff, '(11,21) white');
    assert.equal(l.state.writes, 4);
  });

  it('MADCTL MV swaps the landing coordinates', () => {
    const l = makeLcd();
    l.wake();
    l.cmd(0x36, 0x20); // MV
    l.window(5, 5, 9, 9);
    l.cmd(0x2c);
    l.clockByte(0xf8, true); l.clockByte(0x00, true);
    // cursor (5,9) lands at swapped (9,5)
    assert.equal(l.state.gram[5 * ILI9341_W + 9], 0xf800);
    assert.equal(l.state.gram[9 * ILI9341_W + 5], 0, 'unswapped spot stays empty');
  });

  it('RESX low returns to reset defaults', () => {
    const l = makeLcd();
    l.wake();
    assert.equal(l.state.displayOn, true);
    l.pins.rst = 0; l.model.update(l.part, l.state, l.read, 999999n);
    assert.equal(l.state.displayOn, false);
    assert.equal(l.state.sleeping, true);
  });

  it('unknown commands are recorded, never crash the decode', () => {
    const l = makeLcd();
    l.wake();
    l.cmd(0xb1, 0x00, 0x1b); // frame rate control — unimplemented
    l.cmd(0x2c);
    l.clockByte(0xff, true); l.clockByte(0xff, true);
    assert.ok(l.state.unknown.includes(0xb1));
    assert.equal(l.state.writes, 1, 'pixel path still works after it');
  });

  it('rgba(): dark while off, colors mapped 565 to 888', () => {
    const l = makeLcd();
    const dark = ili9341Rgba(l.state);
    assert.deepEqual([...dark.slice(0, 4)], [0, 0, 0, 255]);
    l.wake();
    l.window(0, 0, 0, 0);
    l.cmd(0x2c);
    l.clockByte(0xf8, true); l.clockByte(0x00, true); // pure red
    const rgba = ili9341Rgba(l.state);
    assert.deepEqual([...rgba.slice(0, 4)], [248, 0, 0, 255]);
  });
});
