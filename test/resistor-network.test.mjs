/**
 * E5.11 — SIP resistor network. Roadmap oracle: a 9-pin bussed 330 Ω
 * network off the rail feeds 8 LED segments at the hand-computed
 * per-segment current; the isolated topology is genuinely isolated.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerResistorNetwork } from '../src/devices/resistor-network.js';
import { unregisterDevice } from '../src/devices.js';

const TERMS = Array.from({ length: 10 }, (_, i) => `p${i + 1}`);

describe('SIP resistor network', () => {
  beforeEach(() => registerResistorNetwork());
  afterEach(() => { try { unregisterDevice('rnet_sip'); } catch {} });

  it('9-pin bussed 330 Ω from the rail: 8 segments at the hand current', () => {
    // Hand value: LED vf = 2.0 V, so I = (5 − 2) / 330 ≈ 9.1 mA per
    // segment; each segment has its OWN element, which is exactly the
    // correct use of a bussed network on a common-anode bar.
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'RN1', kind: 'rnet_sip', params: { ohms: 330, pins: 9 }, terminals: [...TERMS] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'RN1', terminal: 'p1' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    for (let s = 0; s < 8; s++) {
      parts.push({ id: `D${s}`, kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] });
      nets.push({ id: `net_seg${s}`, terminals: [
        { part: 'RN1', terminal: `p${s + 2}` }, { part: `D${s}`, terminal: 'anode' }] });
      nets[1].terminals.push({ part: `D${s}`, terminal: 'cathode' });
    }
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    for (let s = 0; s < 8; s++) {
      const v = b.nodeVoltage(`net_seg${s}`);
      const mA = (5 - v) / 330 * 1000;
      assert.ok(v > 1.7 && v < 2.4, `segment ${s} anode sits near vf: ${v.toFixed(2)} V`);
      assert.ok(mA > 7.5 && mA < 10.5, `segment ${s} current ≈ 9.1 mA: ${mA.toFixed(1)} mA`);
    }
  });

  it('isolated topology: pairs conduct, non-pairs do not', () => {
    // p1–p2 form one element; p3 belongs to the NEXT pair, so a source
    // on p1 must reach p2 and must NOT reach p3 (its net floats at 0
    // through gmin only).
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'RN1', kind: 'rnet_sip', params: { ohms: 1000, topology: 'isolated' }, terminals: [...TERMS] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'RN1', terminal: 'p1' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
      { id: 'net_p2', terminals: [{ part: 'RN1', terminal: 'p2' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_p3', terminals: [{ part: 'RN1', terminal: 'p3' }] },
    ];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    const v2 = b.nodeVoltage('net_p2');
    assert.ok(Math.abs(v2 - 2.5) < 0.05, `p1–p2 element forms the divider: ${v2.toFixed(3)} V`);
    assert.ok(Math.abs(b.nodeVoltage('net_p3')) < 0.05,
      'p3 is a different pair — nothing reaches it');
  });

  it('the bussed misuse is measurable: elements share the common pin', () => {
    // Wired as if it were 2 independent series resistors between two
    // separate signal pairs (p1→p2 and p3→p4, bussed): the p3–p4 "pair"
    // has NO element (both are elements to p1), so the second path
    // conducts through the common pin instead of independently — the
    // reason a bussed part cannot substitute an isolated one.
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'RN1', kind: 'rnet_sip', params: { ohms: 1000 }, terminals: [...TERMS] },
      { id: 'RL', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'RN1', terminal: 'p3' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'RL', terminal: 'b' }] },
      { id: 'net_out', terminals: [{ part: 'RN1', terminal: 'p4' }, { part: 'RL', terminal: 'a' }] },
      { id: 'net_common', terminals: [{ part: 'RN1', terminal: 'p1' }] },
    ];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    // Bussed: p3→p4 is p3→p1→p4, i.e. 2 kΩ, not 1 kΩ: the divider with
    // the 1 kΩ load reads 5·(1/3) ≈ 1.67 V, NOT the 2.5 V an isolated
    // element would give.
    const v = b.nodeVoltage('net_out');
    assert.ok(Math.abs(v - 5 / 3) < 0.05,
      `the path runs through the common pin (2 kΩ): ${v.toFixed(3)} V`);
    const vc = b.nodeVoltage('net_common');
    assert.ok(vc > 3.2 && vc < 3.4, `the common pin carries the midpoint: ${vc.toFixed(3)} V`);
  });
});
