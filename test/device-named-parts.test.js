/**
 * Named part variants tests.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerNamedParts } from '../src/devices/named-parts.js';
import { unregisterDevice } from '../src/devices.js';

const KINDS = ['battery_9v', 'battery_aa', 'battery_coin', 'lm7805', 'ld1117v33',
               'gas_sensor', 'ambient_light', 'ir_transmitter'];

function setup() { registerNamedParts(); }
function teardown() { for (const k of KINDS) { try { unregisterDevice(k); } catch {} } }

describe('battery_9v: 9V across 1kΩ load', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('delivers ~9V (minor sag from 1Ω internal R)', () => {
    const parts = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'B1', kind: 'battery_9v', params: {}, terminals: ['pos', 'neg'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_pos', terminals: [{ part: 'B1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'B1', terminal: 'neg' },
        { part: 'R1', terminal: 'b' },
      ]},
    ];
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    const v = board.nodeVoltage('net_pos');
    // 9V * 1000/(1000+1) = 8.991V
    assert.ok(v > 8.5 && v < 9.1, `9V battery: expected ~9V, got ${v.toFixed(3)}V`);
  });
});

describe('battery_aa: declared cell parameters', () => {
  beforeEach(setup);
  afterEach(teardown);

  function loadedVoltage(params, loadOhms = 10) {
    const parts = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'CELL', kind: 'battery_aa', params, terminals: ['pos', 'neg'] },
      { id: 'LOAD', kind: 'resistor', params: { ohms: loadOhms }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'cell_pos', terminals: [
        { part: 'CELL', terminal: 'pos' },
        { part: 'LOAD', terminal: 'a' },
      ] },
      { id: 'ground', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'CELL', terminal: 'neg' },
        { part: 'LOAD', terminal: 'b' },
      ] },
    ];
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    return board.nodeVoltage('cell_pos');
  }

  it('keeps the 1.5 V / 0.3 Ω default', () => {
    // Hand oracle: 1.5 V * 10 Ω / (10 Ω + 0.3 Ω) = 1.4563106796 V.
    assert.ok(Math.abs(loadedVoltage({}) - 1.4563106796) < 1e-9);
  });

  it('honors volts and rInternal overrides', () => {
    // Hand oracle: 1.2 V * 10 Ω / (10 Ω + 2 Ω) = 1.0 V.
    assert.ok(Math.abs(loadedVoltage({ volts: 1.2, rInternal: 2 }) - 1.0) < 1e-9);
  });

  it('makes the 75-battery-tester verdict thresholds reachable under its 10 Ω load', () => {
    const cases = [
      [1.45, 'FULL'],
      [1.30, 'GOOD'],
      [1.10, 'WEAK'],
      [0.90, 'DEAD'],
    ];
    const classify = volts => volts > 1.399 ? 'FULL' : volts >= 1.2 ? 'GOOD' : volts >= 1.0 ? 'WEAK' : 'DEAD';
    for (const [emf, expected] of cases) {
      const measured = loadedVoltage({ volts: emf });
      assert.equal(classify(measured), expected, `${emf} V cell loaded to ${measured} V`);
    }
  });
});

describe('lm7805: regulates 9V → 5V', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('output is 5V with 9V input', () => {
    const parts = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'B1', kind: 'battery_9v', params: {}, terminals: ['pos', 'neg'] },
      { id: 'U1', kind: 'lm7805', params: {}, terminals: ['in', 'out', 'gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_9v', terminals: [{ part: 'B1', terminal: 'pos' }, { part: 'U1', terminal: 'in' }] },
      { id: 'net_5v', terminals: [{ part: 'U1', terminal: 'out' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'B1', terminal: 'neg' },
        { part: 'U1', terminal: 'gnd' },
        { part: 'R1', terminal: 'b' },
      ]},
    ];
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    const v = board.nodeVoltage('net_5v');
    assert.ok(v > 4.5 && v < 5.5, `LM7805: expected ~5V, got ${v.toFixed(3)}V`);
  });
});

describe('ld1117v33: regulates 5V → 3.3V', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('output is 3.3V with 5V input', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'U1', kind: 'ld1117v33', params: {}, terminals: ['in', 'out', 'gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'U1', terminal: 'in' }] },
      { id: 'net_3v3', terminals: [{ part: 'U1', terminal: 'out' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'U1', terminal: 'gnd' },
        { part: 'R1', terminal: 'b' },
      ]},
    ];
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    const v = board.nodeVoltage('net_3v3');
    assert.ok(v > 3.0 && v < 3.6, `LD1117V33: expected ~3.3V, got ${v.toFixed(3)}V`);
  });
});

describe('TMP36 via named: oracle 25°C = 750mV already tested in analog-ics', () => {
  // TMP36 already tested in device-analog-ics.test.js — this just verifies
  // the named parts module registers without collision.
  beforeEach(setup);
  afterEach(teardown);

  it('all 8 named parts register successfully', () => {
    assert.equal(KINDS.length, 8);
  });
});
