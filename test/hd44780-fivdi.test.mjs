// The HD44780 model vs REAL third-party firmware: fivdi/lcd (MIT), the
// widely-used Node.js Raspberry Pi driver, run UNMODIFIED against our
// device model through a fake `onoff`. The driver bit-bangs the classic
// 4-bit init-by-instruction sequence (3× wake-up 0x03, then 0x02) and
// paces itself with real setTimeout delays — a completely independent
// implementation of the protocol our model decodes. If its Hello/World
// lands in our DDRAM, two strangers agree about the datasheet.
//
// Sibling checkout: git clone --depth 1 https://github.com/fivdi/lcd
// ~/code/lcd — skipped loudly when absent (its deps are faked below, so
// no npm install is needed).
//
// Virtual-time rule: tNs advances with WALL time (the driver's delays
// are real sleeps) but never slower than a per-write minimum, so E
// pulses stay ordered even when writeSync calls land in the same
// microsecond.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { registerHD44780 } from '../src/devices/hd44780.js';
import { getDevice, unregisterDevice } from '../src/devices.js';

const LCD_DIR = process.env.FIVDI_LCD_DIR || join(homedir(), 'code', 'lcd');
const LCD_JS = join(LCD_DIR, 'lcd.js');

function makeHarness() {
  registerHD44780();
  const model = getDevice('hd44780');
  const part = { id: 'lcd', kind: 'hd44780', params: { cols: 16, rows: 2 } };
  const state = model.init(part);
  // GPIO number → model terminal. The driver maps data[i] to bit i of
  // each nibble, i.e. data[0] is D4.
  const PIN_MAP = { 1: 'rs', 2: 'e', 3: 'd4', 4: 'd5', 5: 'd6', 6: 'd7' };
  const pins = { vdd: 5, vss: 0, rw: 0, rs: 0, e: 0, d4: 0, d5: 0, d6: 0, d7: 0 };
  const read = (t) => pins[t] ?? 0;

  const t0 = process.hrtime.bigint();
  let tNs = 0n;
  const touch = () => {
    const wall = process.hrtime.bigint() - t0;
    tNs = wall > tNs ? wall : tNs + 20_000n; // ≥20µs per op keeps busy windows honest
    model.update(part, state, read, tNs);
  };

  class Gpio {
    constructor(no, _direction) { this.terminal = PIN_MAP[no]; if (!this.terminal) throw new Error(`unmapped gpio ${no}`); }
    writeSync(v) { pins[this.terminal] = v ? 5 : 0; touch(); }
    unexport() {}
  }
  // mutexify: minimal same-shape lock (lock(fn) → fn(release))
  const mutexify = () => {
    let locked = false; const q = [];
    const release = () => { const next = q.shift(); if (next) next(release); else locked = false; };
    return (fn) => { if (locked) q.push(fn); else { locked = true; fn(release); } };
  };
  return { state, Gpio, mutexify };
}

/** Load fivdi/lcd with its two deps replaced by our shims. */
function loadDriver(Gpio, mutexify) {
  const origLoad = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'onoff') return { Gpio };
    if (request === 'mutexify') return mutexify;
    return origLoad.call(this, request, ...rest);
  };
  try {
    const req = createRequire(import.meta.url);
    delete req.cache?.[req.resolve(LCD_JS)];
    return req(LCD_JS);
  } finally {
    Module._load = origLoad;
  }
}

test('fivdi/lcd drives our HD44780 to Hello / World', { timeout: 30_000 }, async (t) => {
  if (!existsSync(LCD_JS)) { t.skip(`no fivdi/lcd checkout at ${LCD_DIR}`); return; }
  const { state, Gpio, mutexify } = makeHarness();
  try {
    const Lcd = loadDriver(Gpio, mutexify);
    const lcd = new Lcd({ rs: 1, e: 2, data: [3, 4, 5, 6], cols: 16, rows: 2 });
    await new Promise((res, rej) => { lcd.on('ready', res); lcd.on('error', rej); });

    assert.equal(state.is4Bit, true, 'driver must have switched the model to 4-bit mode');
    assert.equal(state.displayOn, true, 'display control 0x0c must land');

    const printed = () => new Promise((res) => lcd.once('printed', res));
    lcd.print('Hello');
    await printed();
    lcd.setCursor(0, 1);
    lcd.print('World');
    await printed();

    assert.equal(state.text[0].slice(0, 5), 'Hello');
    assert.equal(state.text[1].slice(0, 5), 'World');
  } finally {
    try { unregisterDevice('hd44780'); } catch {}
    try { unregisterDevice('char_lcd'); } catch {}
  }
});
