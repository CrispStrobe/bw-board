/**
 * E5.7 — HCT input thresholds. HC reads 30 %/70 % of the rail; HCT is
 * TTL-fixed at V_IL 0.8 V / V_IH 2.0 V regardless of rail — the reason
 * HCT parts sit on mixed-level 5 V boards at all.
 *
 * Roadmap oracle: at VCC 5, a 3.6 V input reads high for BOTH families;
 * a 2.2 V input reads high ONLY for HCT (it is inside HC's undefined
 * band, below 3.5 V).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerLogicChips, CHIPS } from '../src/devices/chip-composer.js';
import { registerLogicGates } from '../src/devices/logic-gates.js';
import { registerTier2Parts } from '../src/devices/tier2-parts.js';
import { unregisterDevice } from '../src/devices.js';

function setup() { registerLogicChips(); registerLogicGates(); registerTier2Parts(); }
function teardown() {
  for (const c of CHIPS) { try { unregisterDevice(c.kind); } catch {} }
  for (const k of ['74hct00', '74hct04', '74hct08', '74hct14', '74hct32',
    '74hc138', '74hct138', '74hc245', '74hct245', '74hc244', '74hc165', 'ky040', '74ls373',
    'gate_and', 'gate_or', 'gate_not', 'gate_nand', 'gate_nor', 'gate_xor']) {
    try { unregisterDevice(k); } catch {}
  }
}

/** A hex inverter fed by an ideal source at `volts`; returns V(1y). */
function inverterOut(kind, volts) {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'VS', kind: 'vsource', params: { volts }, terminals: ['pos', 'neg'] },
    { id: 'U1', kind, params: {}, terminals: [
      '1a', '1y', '2a', '2y', '3a', '3y', 'gnd', '4y', '4a', '5y', '5a', '6y', '6a', 'vcc'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
  ];
  const nets = [
    { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'U1', terminal: 'vcc' }] },
    { id: 'net_gnd', terminals: [
      { part: 'GND', terminal: 'gnd' }, { part: 'U1', terminal: 'gnd' },
      { part: 'VS', terminal: 'neg' }, { part: 'R1', terminal: 'b' }] },
    { id: 'net_in', terminals: [{ part: 'VS', terminal: 'pos' }, { part: 'U1', terminal: '1a' }] },
    { id: 'net_out', terminals: [{ part: 'U1', terminal: '1y' }, { part: 'R1', terminal: 'a' }] },
  ];
  const b = new BoardImpl(5.0);
  b.setNetlist(parts, nets);
  return b.nodeVoltage('net_out');
}

describe('HCT vs HC input thresholds (composed chips)', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('3.6 V reads high for both families; 2.2 V only for HCT', () => {
    // 3.6 V > 0.7·5 = 3.5 V and > 2.0 V: both invert to LOW.
    assert.ok(inverterOut('74hc04', 3.6) < 1.0, 'HC sees 3.6 V as high');
    assert.ok(inverterOut('74hct04', 3.6) < 1.0, 'HCT sees 3.6 V as high');

    // 2.2 V: above HCT V_IH 2.0 → high (output LOW); inside HC's undefined
    // band — an un-driven-history gate holds its init 0 → output HIGH.
    assert.ok(inverterOut('74hct04', 2.2) < 1.0, 'HCT sees 2.2 V as high');
    assert.ok(inverterOut('74hc04', 2.2) > 4.0, 'HC does NOT see 2.2 V as high');

    // 0.5 V is low for both (below 0.8 V and below 1.5 V).
    assert.ok(inverterOut('74hc04', 0.5) > 4.0, 'HC sees 0.5 V as low');
    assert.ok(inverterOut('74hct04', 0.5) > 4.0, 'HCT sees 0.5 V as low');

    // LS is TTL proper — the very levels HCT mimics.
    assert.ok(inverterOut('74ls04', 2.2) < 1.0, 'LS sees 2.2 V as high');
  });

  it('params.family hct switches the generic gate kinds too', () => {
    const mk = (params) => {
      const parts = [
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'VS', kind: 'vsource', params: { volts: 2.2 }, terminals: ['pos', 'neg'] },
        { id: 'N0', kind: 'gate_not', params, terminals: ['in0', 'out'] },
      ];
      const nets = [
        { id: 'n_in', terminals: [{ part: 'VS', terminal: 'pos' }, { part: 'N0', terminal: 'in0' }] },
        { id: 'n_out', terminals: [{ part: 'N0', terminal: 'out' }] },
        { id: 'n_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'VS', terminal: 'neg' }] },
      ];
      const b = new BoardImpl(5.0);
      b.setNetlist(parts, nets);
      return b.nodeVoltage('n_out');
    };
    assert.ok(mk({ family: 'hct' }) < 1.0, 'hct gate: 2.2 V in → low out');
    assert.ok(mk({}) > 4.0, 'plain HC gate holds low-history on 2.2 V → high out');
  });

  it('74hct138 decodes with a 2.2 V address bit the HC part cannot see', () => {
    const bench = (kind) => {
      const terms = ['vcc', 'gnd', 'a', 'b', 'c', 'g1', 'g2ab', 'g2bb',
        'y0b', 'y1b', 'y2b', 'y3b', 'y4b', 'y5b', 'y6b', 'y7b'];
      const parts = [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'VS', kind: 'vsource', params: { volts: 2.2 }, terminals: ['pos', 'neg'] },
        { id: 'U1', kind, params: {}, terminals: terms },
        { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      ];
      const nets = [
        { id: 'net_vcc', terminals: [
          { part: 'VCC', terminal: 'vcc' }, { part: 'U1', terminal: 'vcc' },
          { part: 'U1', terminal: 'g1' }] },
        { id: 'net_gnd', terminals: [
          { part: 'GND', terminal: 'gnd' }, { part: 'U1', terminal: 'gnd' },
          { part: 'VS', terminal: 'neg' }, { part: 'R1', terminal: 'b' },
          { part: 'U1', terminal: 'g2ab' }, { part: 'U1', terminal: 'g2bb' },
          { part: 'U1', terminal: 'b' }, { part: 'U1', terminal: 'c' }] },
        { id: 'net_a', terminals: [{ part: 'VS', terminal: 'pos' }, { part: 'U1', terminal: 'a' }] },
        { id: 'net_y1', terminals: [{ part: 'U1', terminal: 'y1b' }, { part: 'R1', terminal: 'a' }] },
      ];
      const b = new BoardImpl(5.0);
      b.setNetlist(parts, nets);
      return b.nodeVoltage('net_y1');
    };
    // A=2.2 V: HCT reads it as 1 → /Y1 selected (LOW). HC's mid-rail
    // threshold (2.5 V) reads 0 → /Y1 stays HIGH.
    assert.ok(bench('74hct138') < 1.0, 'HCT: address bit seen, /Y1 low');
    assert.ok(bench('74hc138') > 4.0, 'HC: 2.2 V under mid-rail, /Y1 high');
  });
});
