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
    l.cmd(0xb1, 0x00, 0x1b); // FRMCTR1 — now a named no-op, NOT in unknown[]
    l.cmd(0xd0, 0x42);        // truly unimplemented opcode
    l.cmd(0x2c);
    l.clockByte(0xff, true); l.clockByte(0xff, true);
    assert.ok(!l.state.unknown.includes(0xb1), '0xb1 is a named no-op now');
    assert.ok(l.state.unknown.includes(0xd0), 'truly unknown opcode recorded');
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

  // ── v2 features ───────────────────────────────────────────────────

  it('INVON/INVOFF toggle inversion; ili9341Rgba inverts colors', () => {
    const l = makeLcd();
    l.wake();
    l.window(0, 0, 0, 0);
    l.cmd(0x2c);
    l.clockByte(0xf8, true); l.clockByte(0x00, true); // red 0xF800
    assert.equal(l.state.inverted, false);
    const normal = ili9341Rgba(l.state);
    assert.deepEqual([...normal.slice(0, 3)], [248, 0, 0], 'red uninverted');

    l.cmd(0x21); // INVON
    assert.equal(l.state.inverted, true);
    const inv = ili9341Rgba(l.state);
    // Inverted: R=255-248=7, G=255-0=255, B=255-0=255
    assert.deepEqual([...inv.slice(0, 3)], [7, 255, 255], 'inverted red → cyan');

    l.cmd(0x20); // INVOFF
    assert.equal(l.state.inverted, false);
  });

  it('VSCRDEF + VSCRSADD apply vertical scroll in ili9341Rgba', () => {
    const l = makeLcd();
    l.wake();
    // VSCRDEF: TFA=10, VSA=300, BFA=10 (total=320)
    l.cmd(0x33, 0, 10, 1, 0x2c, 0, 10); // VSA = 0x012c = 300
    assert.equal(l.state.scrollTFA, 10);
    assert.equal(l.state.scrollVSA, 300);
    assert.equal(l.state.scrollBFA, 10);

    // Write a red pixel at GRAM row 20, col 0
    l.window(0, 0, 20, 20);
    l.cmd(0x2c);
    l.clockByte(0xf8, true); l.clockByte(0x00, true);

    // VSCRSADD: scroll start = 20 — row 20 in GRAM should appear at
    // display row TFA (=10) in the scrolling area.
    l.cmd(0x37, 0, 20);
    assert.equal(l.state.scrollStart, 20);

    // The GRAM red pixel is at row 20. With scroll applied, the rgba
    // output at display row 10 (start of VSA) should show the pixel
    // that was at GRAM row 20.
    const rgba = ili9341Rgba(l.state);
    const at10 = rgba.slice(10 * ILI9341_W * 4, 10 * ILI9341_W * 4 + 3);
    assert.deepEqual([...at10], [248, 0, 0], 'scrolled red pixel at display row 10');
  });

  it('MADCTL BGR bit swaps R/B in ili9341Rgba', () => {
    const l = makeLcd();
    l.wake();
    l.window(0, 0, 0, 0);
    l.cmd(0x2c);
    l.clockByte(0xf8, true); l.clockByte(0x00, true); // red 0xF800

    // Without BGR (default): R=248, G=0, B=0
    const rgb = ili9341Rgba(l.state);
    assert.deepEqual([...rgb.slice(0, 3)], [248, 0, 0]);

    // Set MADCTL with BGR bit (bit 3 = 0x08)
    l.cmd(0x36, 0x08);
    const bgr = ili9341Rgba(l.state);
    // BGR swaps R and B: what was red (R=248) becomes blue (B=248)
    assert.deepEqual([...bgr.slice(0, 3)], [0, 0, 248], 'BGR swaps R↔B');
  });

  it('RAMRD 0x2E: dummy byte then R,G,B from GRAM', () => {
    const l = makeLcd();
    l.wake();
    // Write a known pixel at (5, 5): green 0x07E0
    l.window(5, 5, 5, 5);
    l.cmd(0x2c);
    l.clockByte(0x07, true); l.clockByte(0xe0, true);
    assert.equal(l.state.gram[5 * ILI9341_W + 5], 0x07e0);

    // Issue RAMRD (0x2E) — sets up read buffer
    l.window(5, 5, 5, 5);
    l.cmd(0x2e);
    assert.equal(l.state._ramReading, true);

    // Read buffer should have [dummy, R, G, B]
    // Green 0x07E0 = R=0, G=252(0xFC), B=0
    assert.equal(l.state._readBuf.length, 4);
    assert.equal(l.state._readBuf[0], 0x00, 'dummy byte');
    assert.equal(l.state._readBuf[1], 0x00, 'R from green pixel');
    assert.equal(l.state._readBuf[2], 0xfc, 'G from green pixel');
    assert.equal(l.state._readBuf[3], 0x00, 'B from green pixel');
  });

  it('power/gamma opcodes are named no-ops, not in unknown[]', () => {
    const l = makeLcd();
    l.wake();
    // Send ALL the measured Adafruit init opcodes
    const ops = [0xef, 0xcf, 0xed, 0xe8, 0xcb, 0xf7, 0xea,
                 0xc0, 0xc1, 0xc5, 0xc7, 0xb1, 0xb6,
                 0xf2, 0x26, 0xe0, 0xe1];
    for (const op of ops) l.cmd(op, 0x00); // each with one param byte
    assert.equal(l.state.unknown.length, 0,
      `all driver opcodes should be named no-ops, got unknown=[${l.state.unknown.map(b => '0x' + b.toString(16))}]`);
    // Pixel path still works after
    l.cmd(0x2c);
    l.clockByte(0xff, true); l.clockByte(0xff, true);
    assert.equal(l.state.writes, 1);
  });
});

// =====================================================================
// ILI9341 8080-parallel mode (ili9341_par)
// =====================================================================

function makeParLcd() {
  registerILI9341();
  const model = getDevice('ili9341_par');
  const part = { id: 'tft_par', kind: 'ili9341_par', params: {} };
  const state = model.init(part);
  const pins = { vcc: 3.3, gnd: 0, cs: 3.3, rst: 3.3, rs: 0, wr: 3.3, rd: 3.3,
                 d0: 0, d1: 0, d2: 0, d3: 0, d4: 0, d5: 0, d6: 0, d7: 0, led: 3.3 };
  const read = (t) => pins[t] ?? 0;
  let t = 0n;

  /** Write one byte via the 8080 bus: set data + RS, pulse WR low→high. */
  const writeByte = (byte, isData) => {
    pins.rs = isData ? 3.3 : 0;
    for (let i = 0; i < 8; i++) pins[`d${i}`] = (byte >> i) & 1 ? 3.3 : 0;
    pins.wr = 0; model.update(part, state, read, t); t += 100n;
    pins.wr = 3.3; model.update(part, state, read, t); t += 100n; // rising edge latches
  };
  const select = (on) => { pins.cs = on ? 0 : 3.3; model.update(part, state, read, t); t += 100n; };
  const cmd = (c, ...params) => { writeByte(c, false); for (const p of params) writeByte(p, true); };
  const wake = () => { select(true); cmd(0x11); cmd(0x29); };
  const window = (x0, x1, y0, y1) => {
    cmd(0x2a, x0 >> 8, x0 & 0xff, x1 >> 8, x1 & 0xff);
    cmd(0x2b, y0 >> 8, y0 & 0xff, y1 >> 8, y1 & 0xff);
  };
  return { model, part, state, pins, read, writeByte, select, cmd, wake, window };
}

describe('ILI9341 8080-parallel mode', () => {
  beforeEach(() => { try { unregisterDevice('ili9341'); } catch {} try { unregisterDevice('ili9341_par'); } catch {} });

  it('boots sleeping; SLPOUT + DISPON wake it (parallel mirrors SPI)', () => {
    const l = makeParLcd();
    assert.equal(l.state.sleeping, true);
    assert.equal(l.state.displayOn, false);
    l.wake();
    assert.equal(l.state.sleeping, false);
    assert.equal(l.state.displayOn, true);
  });

  it('RAMWR fills the CASET/PASET window — same as SPI path', () => {
    const l = makeParLcd();
    l.wake();
    l.window(10, 11, 20, 21); // 2x2 window
    l.cmd(0x2c);
    const px = [0xf800, 0x07e0, 0x001f, 0xffff];
    for (const p of px) { l.writeByte(p >> 8, true); l.writeByte(p & 0xff, true); }
    assert.equal(l.state.gram[20 * ILI9341_W + 10], 0xf800, '(10,20) red');
    assert.equal(l.state.gram[20 * ILI9341_W + 11], 0x07e0, '(11,20) green');
    assert.equal(l.state.gram[21 * ILI9341_W + 10], 0x001f, '(10,21) blue');
    assert.equal(l.state.gram[21 * ILI9341_W + 11], 0xffff, '(11,21) white');
    assert.equal(l.state.writes, 4);
  });

  it('MADCTL MV swaps coordinates — same as SPI path', () => {
    const l = makeParLcd();
    l.wake();
    l.cmd(0x36, 0x20); // MV
    l.window(5, 5, 9, 9);
    l.cmd(0x2c);
    l.writeByte(0xf8, true); l.writeByte(0x00, true);
    assert.equal(l.state.gram[5 * ILI9341_W + 9], 0xf800);
  });

  it('RESX low resets to sleeping defaults', () => {
    const l = makeParLcd();
    l.wake();
    assert.equal(l.state.displayOn, true);
    l.pins.rst = 0; l.model.update(l.part, l.state, l.read, 999999n);
    assert.equal(l.state.displayOn, false);
    assert.equal(l.state.sleeping, true);
  });

  it('unknown commands recorded, pixel path survives', () => {
    const l = makeParLcd();
    l.wake();
    l.cmd(0xd0, 0x42);
    l.cmd(0x2c);
    l.writeByte(0xff, true); l.writeByte(0xff, true);
    assert.ok(l.state.unknown.includes(0xd0));
    assert.equal(l.state.writes, 1);
  });

  it('INVON/INVOFF toggle inversion (parallel path)', () => {
    const l = makeParLcd();
    l.wake();
    l.window(0, 0, 0, 0);
    l.cmd(0x2c); l.writeByte(0xf8, true); l.writeByte(0x00, true); // red
    l.cmd(0x21); // INVON
    assert.equal(l.state.inverted, true);
    const inv = ili9341Rgba(l.state);
    assert.deepEqual([...inv.slice(0, 3)], [7, 255, 255], 'inverted red = cyan');
    l.cmd(0x20); // INVOFF
    assert.equal(l.state.inverted, false);
  });

  it('ili9341Rgba works identically for parallel-mode state', () => {
    const l = makeParLcd();
    l.wake();
    l.window(0, 0, 0, 0);
    l.cmd(0x2c); l.writeByte(0xf8, true); l.writeByte(0x00, true); // red
    const rgba = ili9341Rgba(l.state);
    assert.deepEqual([...rgba.slice(0, 4)], [248, 0, 0, 255]);
  });

  it('power/gamma opcodes are named no-ops in parallel mode too', () => {
    const l = makeParLcd();
    l.wake();
    const ops = [0xef, 0xcf, 0xed, 0xe8, 0xcb, 0xf7, 0xea,
                 0xc0, 0xc1, 0xc5, 0xc7, 0xb1, 0xb6,
                 0xf2, 0x26, 0xe0, 0xe1];
    for (const op of ops) l.cmd(op, 0x00);
    assert.equal(l.state.unknown.length, 0);
  });
});
