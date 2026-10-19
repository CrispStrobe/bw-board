/**
 * Digital fast-path SOAK: thousands of randomized edges across multiple
 * seeds, asserting byte-identical device state between the fast path and
 * the forced-eager (probe-disabled) path at every checkpoint.
 *
 * The short differential vectors in digital-fast-parity.test.mjs prove
 * the happy path. This soak hammers edge cases: partial bytes, abandoned
 * transfers, back-to-back commands with no gap, random pin interleaving,
 * and multi-kilobyte payloads — all with deterministic seeds so a failure
 * reproduces exactly.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

// ─── Seedable PRNG (xorshift32, deterministic) ──────────────────────────

function xorshift32(seed) {
  let s = seed | 1; // must be nonzero
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

// ─── Board factory ──────────────────────────────────────────────────────

const V = { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] };
const G = { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] };
const net = (id, ...terms) => ({ id, terminals: terms.map(([p, t]) => ({ part: p, terminal: t })) });

function makeBoard(parts, nets, eager = false) {
  const board = new BoardImpl(5.0);
  board.setNetlist([V, G, ...parts], nets);
  board.setPower(true);
  if (eager) board.addProbe('nv'); // disables fast path
  let t = 0n;
  const tick = () => { t += 1_000n; board.advanceTo(t); };
  const pin = (name, h) => { board.setPin(name, 'pushpull', h); tick(); };
  return { board, pin, tick };
}

/** Deep-compare two device states on public (non-underscore) keys. */
function assertParity(fast, eager, label) {
  const keys = Object.keys(eager).filter(k =>
    !k.startsWith('_') && typeof eager[k] !== 'function');
  for (const key of keys) {
    const fv = fast[key];
    const ev = eager[key];
    if (fv === ev) continue;
    if (ArrayBuffer.isView(fv) && ArrayBuffer.isView(ev)) {
      assert.equal(fv.length, ev.length, `${label}.${key} length`);
      for (let i = 0; i < fv.length; i++) {
        if (fv[i] !== ev[i]) assert.fail(`${label}.${key}[${i}]: fast=${fv[i]} eager=${ev[i]}`);
      }
      continue;
    }
    if (Array.isArray(fv)) { assert.deepEqual(fv, ev, `${label}.${key}`); continue; }
    if (typeof fv === 'object' && fv !== null) { assert.deepEqual(fv, ev, `${label}.${key}`); continue; }
    assert.equal(fv, ev, `${label}.${key}: fast=${fv} eager=${ev}`);
  }
}

/** Run a sequence on both boards, checkpoint parity every `interval` edges. */
function soakDual(partsFactory, netsFactory, mcuPins, sequence, deviceId, interval = 500) {
  const fastEnv = makeBoard(partsFactory(), netsFactory(), false);
  const eagerEnv = makeBoard(partsFactory(), netsFactory(), true);

  let edges = 0;
  for (const [name, high] of sequence) {
    fastEnv.pin(name, high);
    eagerEnv.pin(name, high);
    edges++;
    if (edges % interval === 0) {
      const fs = fastEnv.board.getDeviceState(deviceId);
      const es = eagerEnv.board.getDeviceState(deviceId);
      assertParity(fs, es, `${deviceId}@edge${edges}`);
    }
  }
  // Final checkpoint
  const fs = fastEnv.board.getDeviceState(deviceId);
  const es = eagerEnv.board.getDeviceState(deviceId);
  assertParity(fs, es, `${deviceId}@final(${edges})`);
  return edges;
}

// ─── ILI9341 SPI soak ──────────────────────────────────────────────────

function ili9341Parts() {
  return [
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['sck', 'mosi', 'dc', 'cs'] },
    { id: 'TFT', kind: 'ili9341', params: {},
      terminals: ['vcc', 'gnd', 'cs', 'rst', 'dc', 'mosi', 'sck', 'miso', 'led'] },
  ];
}
function ili9341Nets() {
  return [
    net('nv', ['VCC', 'vcc'], ['TFT', 'vcc'], ['TFT', 'rst']),
    net('ng', ['GND', 'gnd'], ['TFT', 'gnd']),
    net('nsck', ['MCU', 'sck'], ['TFT', 'sck']),
    net('nmosi', ['MCU', 'mosi'], ['TFT', 'mosi']),
    net('ndc', ['MCU', 'dc'], ['TFT', 'dc']),
    net('ncs', ['MCU', 'cs'], ['TFT', 'cs']),
  ];
}

function* ili9341Soak(rng) {
  function* spiByte(byte, isData) {
    yield ['dc', isData];
    yield ['cs', false];
    for (let i = 7; i >= 0; i--) {
      yield ['mosi', !!((byte >> i) & 1)];
      yield ['sck', true];
      yield ['sck', false];
    }
    yield ['cs', true];
  }
  // Init sequence
  yield* spiByte(0x11, false); // SLPOUT
  yield* spiByte(0x29, false); // DISPON
  yield* spiByte(0x3a, false); // COLMOD
  yield* spiByte(0x55, true);  // 16-bit
  // CASET
  yield* spiByte(0x2a, false);
  for (const b of [0, 0, 0, 239]) yield* spiByte(b, true);
  // PASET
  yield* spiByte(0x2b, false);
  for (const b of [0, 0, 0, 49]) yield* spiByte(b, true);
  // RAMWR + random pixels
  yield* spiByte(0x2c, false);
  const pixelCount = 500 + Math.floor(rng() * 500);
  for (let i = 0; i < pixelCount * 2; i++) {
    yield* spiByte(Math.floor(rng() * 256), true);
  }
  // Random mid-transfer aborts + restarts
  for (let burst = 0; burst < 3; burst++) {
    yield* spiByte(0x2c, false); // new RAMWR
    const n = 10 + Math.floor(rng() * 50);
    for (let i = 0; i < n; i++) {
      yield* spiByte(Math.floor(rng() * 256), true);
    }
    // Abort: CS high mid-byte (partial)
    yield ['cs', false];
    yield ['dc', true];
    const partialBits = 1 + Math.floor(rng() * 7);
    for (let i = 0; i < partialBits; i++) {
      yield ['mosi', rng() > 0.5];
      yield ['sck', true];
      yield ['sck', false];
    }
    yield ['cs', true]; // abort
  }
}

// ─── MAX7219 SPI soak ──────────────────────────────────────────────────

function max7219Parts() {
  return [
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['din', 'clk', 'cs'] },
    { id: 'M1', kind: 'max7219', params: {},
      terminals: ['vcc', 'gnd', 'din', 'clk', 'cs', 'dout'] },
  ];
}
function max7219Nets() {
  return [
    net('nv', ['VCC', 'vcc'], ['M1', 'vcc']),
    net('ng', ['GND', 'gnd'], ['M1', 'gnd']),
    net('ndin', ['MCU', 'din'], ['M1', 'din']),
    net('nclk', ['MCU', 'clk'], ['M1', 'clk']),
    net('ncs', ['MCU', 'cs'], ['M1', 'cs']),
  ];
}

function* max7219Soak(rng) {
  function* spiWord(word16) {
    yield ['cs', false];
    for (let i = 15; i >= 0; i--) {
      yield ['din', !!((word16 >> i) & 1)];
      yield ['clk', true];
      yield ['clk', false];
    }
    yield ['cs', true];
  }
  // Init
  yield* spiWord((0x0C << 8) | 0x01); // shutdown off
  yield* spiWord((0x0B << 8) | 0x07); // scan limit
  yield* spiWord((0x09 << 8) | 0x00); // no decode
  yield* spiWord((0x0A << 8) | 0x08); // intensity
  // Random digit writes
  for (let i = 0; i < 200; i++) {
    const addr = 1 + Math.floor(rng() * 8); // 1-8
    const data = Math.floor(rng() * 256);
    yield* spiWord((addr << 8) | data);
  }
  // Interleave config changes
  for (let i = 0; i < 50; i++) {
    const intensity = Math.floor(rng() * 16);
    yield* spiWord((0x0A << 8) | intensity);
    const addr = 1 + Math.floor(rng() * 8);
    yield* spiWord((addr << 8) | Math.floor(rng() * 256));
  }
  // Partial transfers (aborted mid-word)
  for (let i = 0; i < 10; i++) {
    yield ['cs', false];
    const bits = 1 + Math.floor(rng() * 15);
    for (let b = 0; b < bits; b++) {
      yield ['din', rng() > 0.5];
      yield ['clk', true];
      yield ['clk', false];
    }
    yield ['cs', true]; // load with partial data — the chip handles it
  }
}

// ─── 74HC595 shift register soak ────────────────────────────────────────

function sr595Parts() {
  return [
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['data', 'clock', 'latch', 'oe'] },
    { id: 'SR1', kind: 'shift_register', params: {},
      terminals: ['data', 'clock', 'latch', 'oe',
                  'q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'] },
  ];
}
function sr595Nets() {
  return [
    net('nv', ['VCC', 'vcc']),
    net('ng', ['GND', 'gnd']),
    net('ndata', ['MCU', 'data'], ['SR1', 'data']),
    net('nclock', ['MCU', 'clock'], ['SR1', 'clock']),
    net('nlatch', ['MCU', 'latch'], ['SR1', 'latch']),
    net('noe', ['MCU', 'oe'], ['SR1', 'oe']),
  ];
}

function* sr595Soak(rng) {
  yield ['oe', false]; // enable
  yield ['clock', false];
  yield ['latch', false];
  // Random bytes, latch at irregular intervals
  for (let i = 0; i < 300; i++) {
    const byte = Math.floor(rng() * 256);
    for (let bit = 7; bit >= 0; bit--) {
      yield ['data', !!((byte >> bit) & 1)];
      yield ['clock', true];
      yield ['clock', false];
    }
    // Latch only sometimes
    if (rng() > 0.3) {
      yield ['latch', true];
      yield ['latch', false];
    }
  }
  // OE toggling
  for (let i = 0; i < 20; i++) {
    yield ['oe', rng() > 0.5];
    const byte = Math.floor(rng() * 256);
    for (let bit = 7; bit >= 0; bit--) {
      yield ['data', !!((byte >> bit) & 1)];
      yield ['clock', true];
      yield ['clock', false];
    }
    yield ['latch', true];
    yield ['latch', false];
  }
}

// ─── Test runner ────────────────────────────────────────────────────────

const SEEDS = [42, 1337, 0xDEAD, 7, 2026];

describe('digital fast-path soak', () => {
  for (const seed of SEEDS) {
    it(`ILI9341 SPI: seed ${seed}`, () => {
      const edges = soakDual(
        ili9341Parts, ili9341Nets, ['sck', 'mosi', 'dc', 'cs'],
        ili9341Soak(xorshift32(seed)), 'TFT', 500,
      );
      assert.ok(edges > 5000, `drove ${edges} edges`);
    });
  }

  for (const seed of SEEDS) {
    it(`MAX7219 SPI: seed ${seed}`, () => {
      const edges = soakDual(
        max7219Parts, max7219Nets, ['din', 'clk', 'cs'],
        max7219Soak(xorshift32(seed)), 'M1', 500,
      );
      assert.ok(edges > 5000, `drove ${edges} edges`);
    });
  }

  for (const seed of SEEDS) {
    it(`74HC595 shift register: seed ${seed}`, () => {
      const edges = soakDual(
        sr595Parts, sr595Nets, ['data', 'clock', 'latch', 'oe'],
        sr595Soak(xorshift32(seed)), 'SR1', 200,
      );
      assert.ok(edges > 5000, `drove ${edges} edges`);
    });
  }
});
