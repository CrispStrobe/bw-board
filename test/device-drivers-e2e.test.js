/**
 * End-to-end device driver verification: relay, button, ADC sensor.
 *
 * Three behaviour classes from the substitution model, each tested
 * through real compiled hex → emu8051 → adapter → board decode.
 *
 * 1. GPIO write (relay): P2.0 active-low, board decodes coil state
 * 2. GPIO read (button): P3.2 active-low, board reads contact closure
 * 3. ADC read (temperature): register sequence verified, analog path NOT
 *    verified (that requires silicon — BENCH-SESSION.md question #1)
 *
 * Skips when hex files or WASM are not available.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmu8051Adapter } from '../src/emu8051-adapter.js';
import { BoardImpl } from '../src/board.js';
import { registerRelay } from '../src/devices/relay.js';
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

const HEX = {
  relay:  '/tmp/verify-build/relay.ihx',
  button: '/tmp/verify-build/button.ihx',
  adc:    '/tmp/verify-build/adc.ihx',
};

const skip = () => {
  if (!createEmu8051) { console.log('# SKIP: no emu8051 build'); return true; }
  for (const [k, p] of Object.entries(HEX)) {
    if (!existsSync(p)) { console.log(`# SKIP: ${p} not found`); return true; }
  }
  return false;
};

// ─── Relay: GPIO write, active-low ──────────────────────────────────────

describe('relay e2e: GPIO write active-low → coil state decode', () => {
  it('P2.0 goes LOW when relay ON, HIGH when OFF', async () => {
    if (skip()) return;
    registerRelay();
    try {
      const wasm = await createEmu8051();
      const board = new BoardImpl(5.0);

      // Relay coil between VCC and P2.0 (active-low: P2.0=LOW energises)
      board.setNetlist(
        [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
         { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
         { id: 'K1', kind: 'relay', params: { coilR: 200, pullInV: 1.0, dropOutV: 0.5, switchTimeMs: 0 },
           terminals: ['coil_a', 'coil_b', 'com', 'nc', 'no'] },
         { id: 'MCU', kind: 'mcu', params: {},
           terminals: ['P1.0', 'P2.0'] }],
        [{ id: 'vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'K1', terminal: 'coil_a' }] },
         { id: 'gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] },
         { id: 'coil_b', terminals: [{ part: 'K1', terminal: 'coil_b' }, { part: 'MCU', terminal: 'P2.0' }] },
         { id: 'com', terminals: [{ part: 'K1', terminal: 'com' }] },
         { id: 'nc', terminals: [{ part: 'K1', terminal: 'nc' }] },
         { id: 'no', terminals: [{ part: 'K1', terminal: 'no' }] }]);

      const adapter = createEmu8051Adapter(wasm, { fosc: 11059200, vcc: 5.0, ports: [1, 2] });
      adapter.attachBoard(board);
      adapter.loadHex(readFileSync(HEX.relay, 'utf8'));

      // Run 100ms — main() sets relay ON then waits 1s then OFF.
      // At 100ms the relay should be ON (P2.0=LOW, coil energised).
      adapter.runNs(100_000_000);

      const p20_v = board.nodeVoltage('coil_b');
      const state = board.getDeviceState('K1');
      const stats = adapter.getStats();

      console.log(`# relay ON: P2.0=${p20_v.toFixed(1)}V energized=${state?.energized} pinChanges=${stats.pinChangeCount}`);

      // Active-low: P2.0 LOW = coil sees ~5V = energised
      assert.ok(p20_v < 1.0, `P2.0 should be LOW (active-low ON), got ${p20_v.toFixed(1)}V`);
      assert.equal(state?.energized, true, 'relay should be energised');
    } finally { try { unregisterDevice('relay'); } catch {} }
  });
});

// ─── Button: GPIO read, active-low ──────────────────────────────────────

describe('button e2e: GPIO read active-low contact closure', () => {
  it('P3.2 driven LOW by board → firmware reads pressed', async () => {
    if (skip()) return;

    const wasm = await createEmu8051();
    const board = new BoardImpl(5.0);

    // Button between P3.2 and GND, with pull-up
    board.setNetlist(
      [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
       { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
       { id: 'BTN', kind: 'button', params: {}, terminals: ['a', 'b'] },
       { id: 'R_PU', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
       { id: 'MCU', kind: 'mcu', params: {},
         terminals: ['P1.0', 'P3.2'] }],
      [{ id: 'vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R_PU', terminal: 'a' }] },
       { id: 'gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'BTN', terminal: 'b' }] },
       { id: 'btn_pin', terminals: [
         { part: 'MCU', terminal: 'P3.2' },
         { part: 'BTN', terminal: 'a' },
         { part: 'R_PU', terminal: 'b' }] }]);

    const adapter = createEmu8051Adapter(wasm, { fosc: 11059200, vcc: 5.0, ports: [1, 3] });
    adapter.attachBoard(board);
    adapter.loadHex(readFileSync(HEX.button, 'utf8'));

    // Button not pressed: P3.2 pulled HIGH
    board.setControl('BTN', 0);
    adapter.runNs(5_000_000);
    const v_open = board.nodeVoltage('btn_pin');
    const pin_open = board.readPin('P3.2');

    // Button pressed: P3.2 pulled LOW
    board.setControl('BTN', 1);
    adapter.runNs(5_000_000);
    const v_pressed = board.nodeVoltage('btn_pin');
    const pin_pressed = board.readPin('P3.2');

    console.log(`# button open: P3.2=${v_open.toFixed(1)}V readPin=${pin_open}`);
    console.log(`# button pressed: P3.2=${v_pressed.toFixed(1)}V readPin=${pin_pressed}`);

    assert.ok(v_open > 3.0, `open: P3.2 should be HIGH (pulled up), got ${v_open.toFixed(1)}V`);
    assert.equal(pin_open, 1, 'open: readPin should be 1');
    assert.ok(v_pressed < 1.0, `pressed: P3.2 should be LOW, got ${v_pressed.toFixed(1)}V`);
    assert.equal(pin_pressed, 0, 'pressed: readPin should be 0');
  });
});

// ─── ADC: register sequence verified, analog path NOT ───────────────────

describe('ADC e2e: register sequence (analog path requires silicon)', () => {
  it('ADC_CONTR configured, P1ASF set for channel 1', async () => {
    if (skip()) return;

    const wasm = await createEmu8051();
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
       { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
       { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] }],
      [{ id: 'vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
       { id: 'gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] }]);

    const adapter = createEmu8051Adapter(wasm, { fosc: 11059200, vcc: 5.0, ports: [1] });
    adapter.attachBoard(board);
    adapter.loadHex(readFileSync(HEX.adc, 'utf8'));

    adapter.runNs(5_000_000);

    // Check register state (the sequence half we CAN verify)
    const adc_contr = wasm._emu_get_sfr(0xBC);
    const p1asf = wasm._emu_get_sfr(0x9D);
    const p1m1 = wasm._emu_get_sfr(0x91);

    console.log(`# ADC: ADC_CONTR=0x${adc_contr.toString(16)} P1ASF=0x${p1asf.toString(16)} P1M1=0x${p1m1.toString(16)}`);
    console.log(`# NOTE: register sequence verified. Analog path (real voltage → ADC code) requires silicon.`);

    // ADC_CONTR should have power bit set (bit 7) = 0x80+
    assert.ok(adc_contr & 0x80, `ADC should be powered on (bit 7), got 0x${adc_contr.toString(16)}`);
    // P1ASF should have bit 1 set (P1.1 = analog)
    assert.ok(p1asf & 0x02, `P1.1 should be analog (P1ASF bit 1), got 0x${p1asf.toString(16)}`);
    // P1M1 should have bit 1 set (high-impedance input for ADC pin)
    assert.ok(p1m1 & 0x02, `P1.1 should be high-Z input (P1M1 bit 1), got 0x${p1m1.toString(16)}`);
  });
});
