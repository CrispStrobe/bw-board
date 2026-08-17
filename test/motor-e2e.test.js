/**
 * End-to-end motor: compiled PCA 8-bit PWM driver → emu8051 → adapter → H-bridge decode.
 *
 * ucsim-stc measured the duty at the pin (dafbaf9):
 *   33%: 84/256 counts, high=91146ns, period=277561ns
 *   50%: 128/256 counts, high=138889ns, period=277506ns
 *   75%: 192/256 counts, high=208334ns, period=277507ns
 *
 * This test decodes the SAME stream through the H-bridge model: direction
 * from IN1/IN2 pins, output voltages from the enable + direction state.
 * Category 2b: both models modified by agents in this campaign. Independent
 * anchor: 84/128/192 counts are what the driver's arithmetic fixed in advance.
 *
 * Skips when hex files or WASM are not available.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmu8051Adapter } from '../src/emu8051-adapter.js';
import { BoardImpl } from '../src/board.js';
import { registerHBridge } from '../src/devices/h-bridge.js';
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
  '75fwd':  '/tmp/motor-build/m75fwd.ihx',
  '50rev':  '/tmp/motor-build/m50rev.ihx',
  '100brk': '/tmp/motor-build/m100brk.ihx',
};

const skip = () => {
  if (!createEmu8051) { console.log('# SKIP: no emu8051 build'); return true; }
  for (const [label, p] of Object.entries(HEX_FILES)) {
    if (!existsSync(p)) { console.log(`# SKIP: ${p} not found`); return true; }
  }
  return false;
};

function makeHBridgeBoard() {
  const board = new BoardImpl(5.0);
  board.setNetlist(
    [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
     { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
     { id: 'H1', kind: 'h_bridge', params: {},
       terminals: ['vcc','gnd','en1','in1','in2','out1','out2','en2','in3','in4','out3','out4'] },
     { id: 'MCU', kind: 'mcu', params: {},
       terminals: ['P1.0','P1.4','P3.4','P3.5'] }],
    [{ id: 'vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'H1', terminal: 'vcc' }] },
     { id: 'gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'H1', terminal: 'gnd' }] },
     { id: 'en', terminals: [{ part: 'MCU', terminal: 'P1.4' }, { part: 'H1', terminal: 'en1' }] },
     { id: 'in1', terminals: [{ part: 'MCU', terminal: 'P3.4' }, { part: 'H1', terminal: 'in1' }] },
     { id: 'in2', terminals: [{ part: 'MCU', terminal: 'P3.5' }, { part: 'H1', terminal: 'in2' }] },
     { id: 'en2', terminals: [{ part: 'H1', terminal: 'en2' }] },
     { id: 'in3', terminals: [{ part: 'H1', terminal: 'in3' }] },
     { id: 'in4', terminals: [{ part: 'H1', terminal: 'in4' }] },
     { id: 'out1', terminals: [{ part: 'H1', terminal: 'out1' }] },
     { id: 'out2', terminals: [{ part: 'H1', terminal: 'out2' }] },
     { id: 'out3', terminals: [{ part: 'H1', terminal: 'out3' }] },
     { id: 'out4', terminals: [{ part: 'H1', terminal: 'out4' }] }]);
  return board;
}

function setup() { registerHBridge(); }
function teardown() { try { unregisterDevice('h_bridge'); } catch {} }

describe('motor end-to-end: compiled PCA 8-bit PWM through emu8051 → H-bridge decode', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('75% forward: direction=FORWARD, PWM active (activity check)', async () => {
    if (skip()) return;
    const wasm = await createEmu8051();
    const board = makeHBridgeBoard();
    const adapter = createEmu8051Adapter(wasm, { fosc: 11059200, vcc: 5.0, ports: [1, 3] });
    adapter.attachBoard(board);
    adapter.loadHex(readFileSync(HEX_FILES['75fwd'], 'utf8'));
    adapter.runNs(10_000_000);

    const stats = adapter.getStats();
    const in1V = board.nodeVoltage('in1');
    const in2V = board.nodeVoltage('in2');

    console.log(`# 75% fwd: IN1=${in1V.toFixed(1)}V IN2=${in2V.toFixed(1)}V pinChanges=${stats.pinChangeCount}`);

    // Direction decode
    assert.ok(in1V > 3.0, `IN1 should be HIGH for forward, got ${in1V.toFixed(1)}V`);
    assert.ok(in2V < 1.0, `IN2 should be LOW for forward, got ${in2V.toFixed(1)}V`);
    // Activity check: PWM must be toggling (not zero, not constant)
    assert.ok(stats.pinChangeCount > 50,
      `PWM should produce many pin changes, got ${stats.pinChangeCount} (activity check)`);
  });

  it('50% reverse: direction=REVERSE, PWM active (activity check)', async () => {
    if (skip()) return;
    const wasm = await createEmu8051();
    const board = makeHBridgeBoard();

    // Track whether REVERSE direction was ever set during the run.
    // main() has no delay loop, so it returns after ~50µs. Asserting
    // on a snapshot at the END would catch post-return state, not the
    // driven state. The push-mode adapter fires callbacks during
    // execution, so we observe the direction as it happens.
    let sawReverse = false;
    const origSetPin = board.setPin.bind(board);
    board.setPin = (pin, mode, high) => {
      origSetPin(pin, mode, high);
      // After each pin change, check if H-bridge is in reverse
      const i1 = board.nodeVoltage('in1');
      const i2 = board.nodeVoltage('in2');
      if (i1 < 1.0 && i2 > 3.0) sawReverse = true;
    };

    const adapter = createEmu8051Adapter(wasm, { fosc: 11059200, vcc: 5.0, ports: [1, 3] });
    adapter.attachBoard(board);
    adapter.loadHex(readFileSync(HEX_FILES['50rev'], 'utf8'));
    adapter.runNs(10_000_000);

    const stats = adapter.getStats();

    console.log(`# 50% rev: sawReverse=${sawReverse} pinChanges=${stats.pinChangeCount}`);

    // Assert the direction was set (an event), not what it is now (a snapshot).
    // This survives any future cycle-count correction because it observes the
    // driven window rather than sampling at a fixed offset.
    assert.ok(sawReverse,
      'direction REVERSE (IN1=LOW, IN2=HIGH) must have been set during execution');
    assert.ok(stats.pinChangeCount > 10,
      `PWM should produce pin changes, got ${stats.pinChangeCount} (activity check)`);
  });

  it('100% brake: EN constant HIGH, no PWM edges (boundary case)', async () => {
    if (skip()) return;
    const wasm = await createEmu8051();
    const board = makeHBridgeBoard();
    const adapter = createEmu8051Adapter(wasm, { fosc: 11059200, vcc: 5.0, ports: [1, 3] });
    adapter.attachBoard(board);
    adapter.loadHex(readFileSync(HEX_FILES['100brk'], 'utf8'));
    adapter.runNs(10_000_000);

    const stats = adapter.getStats();
    const state = board.getDeviceState('H1');
    const out1 = state?.drives?.out1;
    const out2 = state?.drives?.out2;

    console.log(`# 100% brake: pinChanges=${stats.pinChangeCount} OUT1=${out1?.vTh?.toFixed(1) ?? 'float'}V OUT2=${out2?.vTh?.toFixed(1) ?? 'float'}V`);

    // 100% duty = pin stays HIGH = no PWM edges. Only setup + initial
    // seating pin changes (attach-time seating publishes all port pins).
    assert.ok(stats.pinChangeCount < 40,
      `100% duty should produce few pin changes (no PWM toggle), got ${stats.pinChangeCount}`);
    // Outputs should be driven (EN constantly HIGH)
    assert.ok(out1 && out1.vTh > 2.0, 'OUT1 should be driven HIGH');
  });
});
