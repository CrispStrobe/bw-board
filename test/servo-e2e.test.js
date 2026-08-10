/**
 * End-to-end servo: compiled PCA driver → emu8051 → adapter → board → angle.
 *
 * Uses the REAL compiled C from bw-blocks' servo driver (sb3-creator 1aa05aa),
 * not synthetic edges. The hex runs through emu8051's PCA model, the adapter
 * forwards pin edges, and the board's servo model decodes pulse width to angle.
 *
 * This tests the full chain. If the ISR toggles a frame late, if CCAP0H/L is
 * loaded with the wrong count, or if CMOD selects the wrong clock, this test
 * fails — the synthetic test would not.
 *
 * Skips when no emu8051 WASM build is reachable.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmu8051Adapter } from '../src/emu8051-adapter.js';
import { BoardImpl } from '../src/board.js';
import { registerServo } from '../src/devices/servo.js';
import { unregisterDevice } from '../src/devices.js';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

const WASM_CANDIDATES = [
  path.resolve(here, '../../emu8051-stc/build/emu8051.js'),
].filter(Boolean);

let createEmu8051 = null;
for (const p of WASM_CANDIDATES) {
  if (existsSync(p)) { createEmu8051 = require(p); break; }
}

const HEX_FILES = {
  0: '/tmp/servo-build/s0.ihx',
  90: '/tmp/servo-build/s90.ihx',
  180: '/tmp/servo-build/s180.ihx',
};

const skip = () => {
  if (!createEmu8051) { console.log('# SKIP: no emu8051 build'); return true; }
  for (const [angle, path] of Object.entries(HEX_FILES)) {
    if (!existsSync(path)) { console.log(`# SKIP: ${path} not found (compile /tmp/servo-${angle}.c first)`); return true; }
  }
  return false;
};

function makeServoBoard() {
  const board = new BoardImpl(5.0);
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'S1', kind: 'servo',
      params: { minPulseUs: 500, maxPulseUs: 2500, maxAngle: 180, slewRate: 100000 },
      terminals: ['signal', 'vcc', 'gnd'] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.3'] },
  ];
  const nets = [
    { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'S1', terminal: 'vcc' }] },
    { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    { id: 'net_signal', terminals: [{ part: 'MCU', terminal: 'P1.3' }, { part: 'S1', terminal: 'signal' }] },
  ];
  board.setNetlist(parts, nets);
  return board;
}

function setup() { registerServo(); }
function teardown() { try { unregisterDevice('servo'); } catch {} }

describe('servo end-to-end: compiled PCA driver through emu8051', () => {
  beforeEach(setup);
  afterEach(teardown);

  for (const [angleStr, hexPath] of Object.entries(HEX_FILES)) {
    const expectedAngle = Number(angleStr);

    it(`bw_servo_set(${angleStr}) → emu8051 PCA → board decodes ~${angleStr}°`, async () => {
      if (skip()) return;

      const wasm = await createEmu8051();
      const board = makeServoBoard();

      const adapter = createEmu8051Adapter(wasm, {
        fosc: 11059200,
        vcc: 5.0,
        ports: [1],
        pollIntervalNs: 1000,
      });
      adapter.attachBoard(board);

      const hex = readFileSync(hexPath, 'utf8');
      adapter.loadHex(hex);

      // Run 200ms — enough for ~10 servo frames (20ms each) + setup time.
      adapter.runNs(200_000_000);

      const state = board.getDeviceState('S1');
      const target = state?.targetAngle ?? -1;
      const actual = state?.actualAngle ?? -1;
      const pinChanges = adapter.getStats().pinChangeCount;

      console.log(`# servo ${angleStr}°: target=${target.toFixed(1)}° actual=${actual.toFixed(1)}° pinChanges=${pinChanges} (from real PCA edges)`);

      // Must have pin activity (ISR firing)
      assert.ok(pinChanges > 5,
        `expected pin changes from PCA ISR, got ${pinChanges}`);

      // Tolerance: ±5° — measured pulse widths match expected within 1 µs
      assert.ok(Math.abs(target - expectedAngle) < 5,
        `expected ~${expectedAngle}°, got target=${target.toFixed(1)}°`);
    });
  }
});
