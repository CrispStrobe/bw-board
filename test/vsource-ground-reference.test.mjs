import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { solveMNA } from '../src/mna.js';

const current = (result, part, terminal) =>
  result.branchCurrents.get(part)?.get(terminal) ?? 0;

function sourceAndLoad(sourceReversed) {
  const liveTerminal = sourceReversed ? 'neg' : 'pos';
  const groundTerminal = sourceReversed ? 'pos' : 'neg';
  const parts = [
    { id: 'V1', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ];
  const nets = [
    { id: 'live', terminals: [
      { part: 'V1', terminal: liveTerminal },
      { part: 'R1', terminal: 'a' },
    ] },
    { id: 'ground', terminals: [
      { part: 'V1', terminal: groundTerminal },
      { part: 'R1', terminal: 'b' },
      { part: 'GND', terminal: 'gnd' },
    ] },
  ];
  return solveMNA(parts, nets, new Map(), new Map(), 5, {});
}

describe('independent voltage source with either terminal grounded', () => {
  it('solves both orientations with voltage polarity, signed currents, and KCL intact', () => {
    const normal = sourceAndLoad(false);
    assert.equal(normal.converged, true);
    assert.ok(Math.abs(normal.nodeVoltages.get('live') - 5) < 1e-9,
      'the established pos-live orientation is non-vacuously driven to +5 V');
    assert.ok(Math.abs(current(normal, 'V1', 'pos') - 0.005) < 1e-9,
      'normal source delivers 5 mA out of its pos terminal');
    assert.ok(Math.abs(current(normal, 'R1', 'a') + 0.005) < 1e-9,
      'normal load current is signed out-of-part at terminal a');
    assert.ok(Math.abs(current(normal, 'V1', 'pos') + current(normal, 'R1', 'a')) < 1e-9,
      'normal live-node KCL holds directly in the uniform terminal convention');

    const reversed = sourceAndLoad(true);
    assert.equal(reversed.converged, true);
    assert.ok(Math.abs(reversed.nodeVoltages.get('live') + 5) < 1e-9,
      'a grounded pos terminal drives the live neg terminal to -5 V');
    assert.ok(Math.abs(current(reversed, 'V1', 'neg') + 0.005) < 1e-9,
      'reversed source draws 5 mA into its neg terminal');
    assert.ok(Math.abs(current(reversed, 'R1', 'a') - 0.005) < 1e-9,
      'reversed load current changes sign with the voltage');
    assert.ok(Math.abs(current(reversed, 'V1', 'neg') + current(reversed, 'R1', 'a')) < 1e-9,
      'reversed live-node KCL holds directly in the uniform terminal convention');
  });

  it('does not allocate a redundant zero-volt ground-to-ground source row', () => {
    const parts = [
      { id: 'VGOOD', kind: 'vsource', params: { volts: 3 }, terminals: ['pos', 'neg'] },
      { id: 'VZERO', kind: 'vsource', params: { volts: 0 }, terminals: ['pos', 'neg'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ];
    const nets = [
      { id: 'live', terminals: [
        { part: 'VGOOD', terminal: 'pos' }, { part: 'R1', terminal: 'a' },
      ] },
      { id: 'ground', terminals: [
        { part: 'VGOOD', terminal: 'neg' }, { part: 'VZERO', terminal: 'pos' },
        { part: 'VZERO', terminal: 'neg' }, { part: 'R1', terminal: 'b' },
        { part: 'GND', terminal: 'gnd' },
      ] },
    ];
    const result = solveMNA(parts, nets, new Map(), new Map(), 5, {});
    assert.equal(result.converged, true);
    assert.ok(Math.abs(result.nodeVoltages.get('live') - 3) < 1e-9,
      'redundant ground-ground source stays outside the MNA rows and cannot singularize the valid circuit');
    assert.equal(result.branchCurrents.get('VZERO')?.size, 0);
  });
});
