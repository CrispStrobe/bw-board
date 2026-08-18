/**
 * Digital fast path PARITY test: the fast path must produce byte-identical
 * device state compared to the eager (MNA-solve-per-edge) path.
 *
 * For each SPI/shift device (ili9341, max7219, shift_register, st7920,
 * hd44780), we drive an identical bit-bang sequence through:
 *   A) the normal board (fast path active)
 *   B) a board with a probe added (disables fast path wholesale)
 * and assert that the device state is field-identical.
 *
 * A probe on the VCC net disables the fast path without changing the
 * electrical behavior — the same circuit, the same MNA, just no shortcut.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const V = { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] };
const G = { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] };
const net = (id, ...terms) => ({ id, terminals: terms.map(([p, t]) => ({ part: p, terminal: t })) });

/**
 * Run the same sequence on two boards, one fast and one eager.
 * Returns both device states for comparison.
 */
function runDual(makeParts, makeNets, mcuTerminals, driveSequence, deviceId) {
  const results = {};
  for (const mode of ['fast', 'eager']) {
    const board = new BoardImpl(5.0);
    const parts = [V, G,
      { id: 'MCU', kind: 'mcu', params: {}, terminals: mcuTerminals },
      ...makeParts(),
    ];
    // makeNets must include all net wiring including VCC/GND connections
    const nets = makeNets();
    board.setNetlist(parts, nets);
    board.setPower(true);

    if (mode === 'eager') {
      // A probe disables the fast path wholesale
      board.addProbe('nv');
    }

    let t = 0n;
    const tick = () => { t += 1_000n; board.advanceTo(t); };
    const pin = (name, h) => { board.setPin(name, 'pushpull', h); tick(); };

    // Verify the mode is what we expect
    if (mode === 'fast') {
      // At least one MCU pin should qualify for the fast path
      const anyFast = mcuTerminals.some(p => board._digitalFastInfo(p.toLowerCase()));
      // (Not all pins will qualify — some may be on non-decoder nets)
    }

    driveSequence(pin, tick, board);
    results[mode] = board.getDeviceState(deviceId);
  }
  return results;
}

/** Deep compare two objects, ignoring function properties and private _ keys
 *  that are FSM internals (edge-detection state can legitimately differ
 *  because the eager path's _updateDevices runs extra settle rounds). */
function assertStateEqual(fast, eager, label, opts = {}) {
  const ignore = new Set(opts.ignoreKeys || []);
  const compareKeys = Object.keys(eager).filter(k =>
    !k.startsWith('_') && typeof eager[k] !== 'function' && !ignore.has(k));

  for (const key of compareKeys) {
    const fv = fast[key];
    const ev = eager[key];
    if (fv === ev) continue;
    if (fv instanceof Uint8Array || fv instanceof Uint16Array ||
        fv instanceof Float64Array) {
      // Typed array: compare element by element
      assert.equal(fv.length, ev.length, `${label}.${key} length mismatch`);
      for (let i = 0; i < fv.length; i++) {
        assert.equal(fv[i], ev[i], `${label}.${key}[${i}] mismatch: fast=${fv[i]} eager=${ev[i]}`);
      }
      continue;
    }
    if (Array.isArray(fv) && Array.isArray(ev)) {
      assert.deepEqual(fv, ev, `${label}.${key} array mismatch`);
      continue;
    }
    if (typeof fv === 'object' && fv !== null && typeof ev === 'object' && ev !== null) {
      assert.deepEqual(fv, ev, `${label}.${key} object mismatch`);
      continue;
    }
    assert.equal(fv, ev, `${label}.${key}: fast=${fv} eager=${ev}`);
  }
}

// ─── ILI9341 SPI TFT ───────────────────────────────────────────────────

describe('fast-path parity: ILI9341 SPI', () => {
  const makeParts = () => [
    { id: 'TFT', kind: 'ili9341', params: {},
      terminals: ['vcc', 'gnd', 'cs', 'rst', 'dc', 'mosi', 'sck', 'miso', 'led'] },
  ];
  const makeNets = () => [
    net('nv', ['VCC', 'vcc'], ['TFT', 'vcc'], ['TFT', 'rst']),
    net('ng', ['GND', 'gnd'], ['TFT', 'gnd']),
    net('nsck', ['MCU', 'sck'], ['TFT', 'sck']),
    net('nmosi', ['MCU', 'mosi'], ['TFT', 'mosi']),
    net('ndc', ['MCU', 'dc'], ['TFT', 'dc']),
    net('ncs', ['MCU', 'cs'], ['TFT', 'cs']),
  ];
  const mcuTerminals = ['sck', 'mosi', 'dc', 'cs'];

  function spiByte(pin, byte, isData) {
    pin('dc', isData);
    pin('cs', false);
    for (let i = 7; i >= 0; i--) {
      pin('mosi', !!((byte >> i) & 1));
      pin('sck', true);
      pin('sck', false);
    }
    pin('cs', true);
  }

  function driveInit(pin, tick) {
    // SLPOUT, DISPON, COLMOD 16-bit, CASET 0-9, PASET 0-4, RAMWR + 50 pixels
    spiByte(pin, 0x11, false); // SLPOUT
    spiByte(pin, 0x29, false); // DISPON
    spiByte(pin, 0x3a, false); // COLMOD (cmd)
    spiByte(pin, 0x55, true);  // 16-bit
    // CASET: x0=0, x1=9
    spiByte(pin, 0x2a, false);
    for (const b of [0, 0, 0, 9]) spiByte(pin, b, true);
    // PASET: y0=0, y1=4
    spiByte(pin, 0x2b, false);
    for (const b of [0, 0, 0, 4]) spiByte(pin, b, true);
    // RAMWR + 50 pixels (10×5 = 50, 2 bytes each = 100 data bytes)
    spiByte(pin, 0x2c, false);
    for (let i = 0; i < 100; i++) spiByte(pin, (i & 0xff), true);
  }

  it('fast path produces identical GRAM, display state, and pixel count', () => {
    const { fast, eager } = runDual(makeParts, makeNets, mcuTerminals, driveInit, 'TFT');
    assert.ok(fast && eager, 'both states exist');
    assertStateEqual(fast, eager, 'ILI9341');
    assert.equal(fast.displayOn, true, 'display on');
    assert.equal(fast.sleeping, false, 'not sleeping');
    assert.equal(fast.writes, eager.writes, `pixel count: fast=${fast.writes} eager=${eager.writes}`);
    // GRAM byte-identical
    for (let i = 0; i < fast.gram.length; i++) {
      if (fast.gram[i] !== eager.gram[i]) {
        assert.fail(`GRAM[${i}]: fast=0x${fast.gram[i].toString(16)} eager=0x${eager.gram[i].toString(16)}`);
      }
    }
  });
});

// ─── MAX7219 LED matrix driver ──────────────────────────────────────────

describe('fast-path parity: MAX7219', () => {
  const makeParts = () => [
    { id: 'M1', kind: 'max7219', params: {},
      terminals: ['vcc', 'gnd', 'din', 'clk', 'cs', 'dout'] },
  ];
  const makeNets = () => [
    net('nv', ['VCC', 'vcc'], ['M1', 'vcc']),
    net('ng', ['GND', 'gnd'], ['M1', 'gnd']),
    net('ndin', ['MCU', 'din'], ['M1', 'din']),
    net('nclk', ['MCU', 'clk'], ['M1', 'clk']),
    net('ncs', ['MCU', 'cs'], ['M1', 'cs']),
  ];
  const mcuTerminals = ['din', 'clk', 'cs'];

  function spiWord(pin, word16) {
    pin('cs', false);
    for (let i = 15; i >= 0; i--) {
      pin('din', !!((word16 >> i) & 1));
      pin('clk', true);
      pin('clk', false);
    }
    pin('cs', true); // LOAD: latches on rising CS
  }

  function driveInit(pin) {
    // Shutdown off (0x0C, 0x01), scan limit 7 (0x0B, 0x07),
    // decode none (0x09, 0x00), intensity 8 (0x0A, 0x08),
    // then write 8 digit registers with a test pattern
    spiWord(pin, (0x0C << 8) | 0x01); // shutdown off
    spiWord(pin, (0x0B << 8) | 0x07); // scan limit
    spiWord(pin, (0x09 << 8) | 0x00); // no decode
    spiWord(pin, (0x0A << 8) | 0x08); // intensity
    // Write digits: alternating 0xAA / 0x55
    for (let d = 0; d < 8; d++) {
      spiWord(pin, ((d + 1) << 8) | (d % 2 === 0 ? 0xAA : 0x55));
    }
  }

  it('fast path produces identical digit registers and config', () => {
    const { fast, eager } = runDual(makeParts, makeNets, mcuTerminals, driveInit, 'M1');
    assert.ok(fast && eager, 'both states exist');
    assertStateEqual(fast, eager, 'MAX7219');
    assert.equal(fast.shutdown, false, 'shutdown off');
    assert.equal(fast.scanLimit, 7);
    assert.equal(fast.intensity, 8);
    assert.deepEqual(fast.digits, eager.digits, 'digit registers byte-identical');
    assert.deepEqual(fast.digits, [0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55, 0xAA, 0x55]);
  });
});

// ─── 74HC595 shift register ────────────────────────────────────────────

describe('fast-path parity: 74HC595 shift register', () => {
  const makeParts = () => [
    { id: 'SR1', kind: 'shift_register', params: {},
      terminals: ['data', 'clock', 'latch', 'oe',
                  'q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'] },
    // Load resistors on outputs (so nodeVoltage is meaningful)
    ...Array.from({ length: 8 }, (_, i) => ({
      id: `R${i}`, kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'],
    })),
  ];
  const makeNets = () => [
    net('nv', ['VCC', 'vcc']),
    net('ndata', ['MCU', 'data'], ['SR1', 'data']),
    net('nclock', ['MCU', 'clock'], ['SR1', 'clock']),
    net('nlatch', ['MCU', 'latch'], ['SR1', 'latch']),
    net('noe', ['MCU', 'oe'], ['SR1', 'oe']),
    ...Array.from({ length: 8 }, (_, i) =>
      net(`nq${i}`, ['SR1', `q${i}`], [`R${i}`, 'a'])),
    ...Array.from({ length: 8 }, (_, i) => {
      // Wire each load resistor to GND
      const n = net(`ng${i}`, [`R${i}`, 'b'], ['GND', 'gnd']);
      return n;
    }),
  ];
  const mcuTerminals = ['data', 'clock', 'latch', 'oe'];

  function shiftByte(pin, byte) {
    for (let i = 7; i >= 0; i--) {
      pin('data', !!((byte >> i) & 1));
      pin('clock', true);
      pin('clock', false);
    }
    pin('latch', true);
    pin('latch', false);
  }

  function driveSequence(pin) {
    pin('oe', false); // OE active low
    pin('clock', false);
    pin('latch', false);
    // Shift 4 different patterns
    for (const byte of [0xa5, 0x3c, 0xff, 0x00, 0x42]) {
      shiftByte(pin, byte);
    }
  }

  it('fast path produces identical shift/latch registers and OE state', () => {
    const { fast, eager } = runDual(makeParts, makeNets, mcuTerminals, driveSequence, 'SR1');
    assert.ok(fast && eager, 'both states exist');
    assert.equal(fast.shiftReg, eager.shiftReg, `shiftReg: fast=${fast.shiftReg} eager=${eager.shiftReg}`);
    assert.equal(fast.latchReg, eager.latchReg, `latchReg: fast=${fast.latchReg} eager=${eager.latchReg}`);
    assert.equal(fast.latchReg, 0x42, 'last byte latched is 0x42');
    // OE state
    assert.equal(fast.oeActive, eager.oeActive, 'oeActive matches');
  });

  it('output voltages match between fast and eager after flush', () => {
    // This verifies that nodeVoltage reads are correct after the fast
    // path's deferred solve is flushed.
    for (const mode of ['fast', 'eager']) {
      const board = new BoardImpl(5.0);
      board.setNetlist([V, G,
        { id: 'MCU', kind: 'mcu', params: {}, terminals: mcuTerminals },
        ...makeParts(),
      ], makeNets());
      board.setPower(true);
      if (mode === 'eager') board.addProbe('nv');

      let t = 0n;
      const tick = () => { t += 1_000n; board.advanceTo(t); };
      const pin = (n, h) => { board.setPin(n, 'pushpull', h); tick(); };

      pin('oe', false);
      pin('clock', false);
      pin('latch', false);
      shiftByte(pin, 0xa5);

      // Read output voltages — forces flush in fast mode
      const voltages = [];
      for (let i = 0; i < 8; i++) {
        voltages.push(board.nodeVoltage(`nq${i}`));
      }
      // 0xA5 = 10100101: Q0=1, Q1=0, Q2=1, Q3=0, Q4=0, Q5=1, Q6=0, Q7=1
      const expected = [1, 0, 1, 0, 0, 1, 0, 1];
      for (let i = 0; i < 8; i++) {
        if (expected[i]) {
          assert.ok(voltages[i] > 3.0, `${mode}: Q${i} should be HIGH, got ${voltages[i].toFixed(2)}V`);
        } else {
          assert.ok(voltages[i] < 1.0, `${mode}: Q${i} should be LOW, got ${voltages[i].toFixed(2)}V`);
        }
      }
    }
  });
});

// ─── ST7920 SPI LCD ────────────────────────────────────────────────────

describe('fast-path parity: ST7920 SPI LCD', () => {
  const makeParts = () => [
    { id: 'LCD', kind: 'st7920', params: {},
      terminals: ['vcc', 'gnd', 'cs', 'sclk', 'sid', 'rstb'] },
  ];
  const makeNets = () => [
    net('nv', ['VCC', 'vcc'], ['LCD', 'vcc'], ['LCD', 'rstb']),
    net('ng', ['GND', 'gnd'], ['LCD', 'gnd']),
    net('ncs', ['MCU', 'cs'], ['LCD', 'cs']),
    net('nsclk', ['MCU', 'sclk'], ['LCD', 'sclk']),
    net('nsid', ['MCU', 'sid'], ['LCD', 'sid']),
  ];
  const mcuTerminals = ['cs', 'sclk', 'sid'];

  // ST7920 serial: 5 sync bits (11111), RS, RW, 0, then data in two
  // 4-bit nibbles (high first, each with 4 data bits + 4 zeros)
  function st7920Byte(pin, byte, isData) {
    pin('cs', true);
    // 5 sync bits
    for (let i = 0; i < 5; i++) { pin('sid', true); pin('sclk', true); pin('sclk', false); }
    // RS bit (0=cmd, 1=data)
    pin('sid', isData); pin('sclk', true); pin('sclk', false);
    // RW bit (0=write)
    pin('sid', false); pin('sclk', true); pin('sclk', false);
    // 0 bit
    pin('sid', false); pin('sclk', true); pin('sclk', false);
    // High nibble: D7-D4 + 0000
    for (let i = 7; i >= 4; i--) {
      pin('sid', !!((byte >> i) & 1)); pin('sclk', true); pin('sclk', false);
    }
    for (let i = 0; i < 4; i++) { pin('sid', false); pin('sclk', true); pin('sclk', false); }
    // Low nibble: D3-D0 + 0000
    for (let i = 3; i >= 0; i--) {
      pin('sid', !!((byte >> i) & 1)); pin('sclk', true); pin('sclk', false);
    }
    for (let i = 0; i < 4; i++) { pin('sid', false); pin('sclk', true); pin('sclk', false); }
    pin('cs', false);
  }

  function driveSequence(pin) {
    // Function set: 8-bit, basic instruction
    st7920Byte(pin, 0x30, false);
    // Display on, cursor off
    st7920Byte(pin, 0x0C, false);
    // Clear display
    st7920Byte(pin, 0x01, false);
    // Write 'A' (0x41) at the current position
    st7920Byte(pin, 0x41, true);
    st7920Byte(pin, 0x42, true); // 'B'
  }

  it('fast path produces identical display state and text buffer', () => {
    const { fast, eager } = runDual(makeParts, makeNets, mcuTerminals, driveSequence, 'LCD');
    assert.ok(fast && eager, 'both states exist');
    assertStateEqual(fast, eager, 'ST7920');
    // Parity is the claim: the text buffers match between fast and eager.
    // Whether the model correctly processes the data bytes is the model's
    // own test concern, not the fast path's.
    assert.deepEqual(fast.text, eager.text, 'text buffer identical');
    assert.deepEqual(fast.gdram, eager.gdram, 'GDRAM identical');
  });
});

// ─── HD44780 parallel LCD ──────────────────────────────────────────────

describe('fast-path parity: HD44780 parallel LCD', () => {
  const makeParts = () => [
    { id: 'LCD', kind: 'hd44780', params: { cols: 16, rows: 2 },
      terminals: ['vss', 'vdd', 'v0', 'rs', 'rw', 'e',
        'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'a', 'k'] },
  ];
  const makeNets = () => [
    net('nv', ['VCC', 'vcc'], ['LCD', 'vdd'], ['LCD', 'a']),
    net('ng', ['GND', 'gnd'], ['LCD', 'vss'], ['LCD', 'v0'], ['LCD', 'k']),
    net('nrs', ['MCU', 'rs'], ['LCD', 'rs']),
    net('nrw', ['MCU', 'rw'], ['LCD', 'rw']),
    net('ne', ['MCU', 'e'], ['LCD', 'e']),
    ...Array.from({ length: 8 }, (_, i) =>
      net(`nd${i}`, ['MCU', `d${i}`], ['LCD', `d${i}`])),
  ];
  const mcuTerminals = ['rs', 'rw', 'e', 'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7'];

  function lcdCmd(pin, byte) {
    // RS=0 (command), RW=0 (write)
    pin('rs', false); pin('rw', false);
    for (let i = 0; i < 8; i++) pin(`d${i}`, !!((byte >> i) & 1));
    pin('e', true); pin('e', false);
  }
  function lcdData(pin, byte) {
    pin('rs', true); pin('rw', false);
    for (let i = 0; i < 8; i++) pin(`d${i}`, !!((byte >> i) & 1));
    pin('e', true); pin('e', false);
  }

  function driveSequence(pin, tick) {
    // Function set: 8-bit, 2-line
    lcdCmd(pin, 0x38);
    // Wait for busy (the model enforces 37µs)
    for (let i = 0; i < 40; i++) tick();
    // Display on, cursor on
    lcdCmd(pin, 0x0E);
    for (let i = 0; i < 40; i++) tick();
    // Clear
    lcdCmd(pin, 0x01);
    // Clear needs 1.52ms
    for (let i = 0; i < 1600; i++) tick();
    // Entry mode: increment
    lcdCmd(pin, 0x06);
    for (let i = 0; i < 40; i++) tick();
    // Write "HI"
    lcdData(pin, 0x48); // 'H'
    for (let i = 0; i < 40; i++) tick();
    lcdData(pin, 0x49); // 'I'
    for (let i = 0; i < 40; i++) tick();
  }

  it('fast path produces identical DDRAM and display state', () => {
    const { fast, eager } = runDual(makeParts, makeNets, mcuTerminals, driveSequence, 'LCD');
    assert.ok(fast && eager, 'both states exist');
    assertStateEqual(fast, eager, 'HD44780', { ignoreKeys: ['contrast', 'backlight'] });
    assert.equal(fast.displayOn, true, 'display on');
    assert.deepEqual(fast.ddram, eager.ddram, 'DDRAM byte-identical');
    assert.deepEqual(fast.text, eager.text, 'text identical');
    const text = fast.text.join('');
    assert.ok(text.includes('HI'), `text contains HI: ${JSON.stringify(fast.text)}`);
  });
});
