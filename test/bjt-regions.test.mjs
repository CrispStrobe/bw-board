// BJT operating regions — oracle tests for the two audit escalations:
// the NPN had no saturation region (switch circuits drove collectors
// to -420V) and the PNP never conducted (double-negated junction).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

const solve = (parts, nets) => {
  const b = new BoardImpl(5.0);
  b.setNetlist(parts, nets);
  b.advanceTo(1n);
  return b;
};

describe('NPN saturation region', () => {
  it('a switched-on NPN saturates at ~vceSat instead of a negative rail', () => {
    // 5V — 220R — LED — collector; base driven through 1k: beta*Ib far
    // exceeds what the load passes → saturation, Vce ≈ 0.2.
    const b = solve([
      { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'rl', kind: 'resistor', params: { ohms: 220 }, terminals: ['a', 'b'] },
      { id: 'led', kind: 'led', params: {}, terminals: ['anode', 'cathode'] },
      { id: 'rb', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'q', kind: 'npn', params: {}, terminals: ['base', 'collector', 'emitter'] },
    ], [
      { id: 'n_v', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 'rl', terminal: 'a' }, { part: 'rb', terminal: 'a' }] },
      { id: 'n_a', terminals: [{ part: 'rl', terminal: 'b' }, { part: 'led', terminal: 'anode' }] },
      { id: 'n_c', terminals: [{ part: 'led', terminal: 'cathode' }, { part: 'q', terminal: 'collector' }] },
      { id: 'n_b', terminals: [{ part: 'rb', terminal: 'b' }, { part: 'q', terminal: 'base' }] },
      { id: 'n_g', terminals: [{ part: 'q', terminal: 'emitter' }, { part: 'g1', terminal: 'gnd' }] },
    ]);
    const vce = b.nodeVoltages.get('n_c');
    assert.ok(vce > 0 && vce < 0.4, `saturated Vce ≈ 0.2, got ${vce}`);
  });
});

describe('PNP conduction', () => {
  it('base pulled a diode drop below the emitter turns the PNP on', () => {
    // 5V emitter; base through 10k to gnd → vEB ≈ 0.7, conducts;
    // collector load 1k to gnd must rise well above zero.
    const b = solve([
      { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'rb', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'rl', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'q', kind: 'pnp', params: {}, terminals: ['base', 'collector', 'emitter'] },
    ], [
      { id: 'n_v', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 'q', terminal: 'emitter' }] },
      { id: 'n_b', terminals: [{ part: 'q', terminal: 'base' }, { part: 'rb', terminal: 'a' }] },
      { id: 'n_c', terminals: [{ part: 'q', terminal: 'collector' }, { part: 'rl', terminal: 'a' }] },
      { id: 'n_g', terminals: [{ part: 'rb', terminal: 'b' }, { part: 'rl', terminal: 'b' }, { part: 'g1', terminal: 'gnd' }] },
    ]);
    const vc = b.nodeVoltages.get('n_c');
    assert.ok(vc > 2.0, `conducting PNP must pull its collector load high, got ${vc}`);
  });
});
