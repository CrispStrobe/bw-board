import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const terminals = ['out', 'sense_adj', 'gnd_3', 'byp', 'shdn', 'gnd_6', 'gnd_7', 'in'];

function makeRig({ vin = 8, shdn = 3.3, loadOhms = 1000, params = { vOut: 5 }, divider = null } = {}) {
  const board = new BoardImpl(5);
  const parts = [
    { id: 'VIN', kind: 'vsource', params: typeof vin === 'number' ? { volts: vin } : vin, terminals: ['pos', 'neg'] },
    { id: 'SHDN', kind: 'vsource', params: typeof shdn === 'number' ? { volts: shdn } : shdn, terminals: ['pos', 'neg'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'lt1763', params, terminals },
    { id: 'LOAD', kind: 'resistor', params: { ohms: loadOhms }, terminals: ['a', 'b'] },
  ];
  const nets = [
    { id: 'vin', terminals: [{ part: 'VIN', terminal: 'pos' }, { part: 'U1', terminal: 'in' }] },
    { id: 'shdn', terminals: [{ part: 'SHDN', terminal: 'pos' }, { part: 'U1', terminal: 'shdn' }] },
    { id: 'out', terminals: [{ part: 'U1', terminal: 'out' }, { part: 'LOAD', terminal: 'a' }] },
    { id: 'byp', terminals: [{ part: 'U1', terminal: 'byp' }] },
    { id: 'gnd', terminals: [
      { part: 'GND', terminal: 'gnd' }, { part: 'VIN', terminal: 'neg' },
      { part: 'SHDN', terminal: 'neg' }, { part: 'U1', terminal: 'gnd_3' },
      { part: 'U1', terminal: 'gnd_6' }, { part: 'U1', terminal: 'gnd_7' },
      { part: 'LOAD', terminal: 'b' },
    ] },
  ];
  if (divider) {
    parts.push(
      { id: 'RT', kind: 'resistor', params: { ohms: divider.top }, terminals: ['a', 'b'] },
      { id: 'RB', kind: 'resistor', params: { ohms: divider.bottom }, terminals: ['a', 'b'] },
    );
    nets[2].terminals.push({ part: 'RT', terminal: 'a' });
    nets.push({ id: 'sense', terminals: [
      { part: 'U1', terminal: 'sense_adj' }, { part: 'RT', terminal: 'b' },
      { part: 'RB', terminal: 'a' },
    ] });
    nets[4].terminals.push({ part: 'RB', terminal: 'b' });
  } else {
    nets[2].terminals.push({ part: 'U1', terminal: 'sense_adj' });
  }
  board.setNetlist(parts, nets);
  board.advanceTo(1n);
  return board;
}

const near = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${label}: expected ${expected} ± ${tolerance}, got ${actual}`,
);

describe('LT1763 SO-8 physical DC contract', () => {
  it('regulates a fixed output and bonds all three ground leads', () => {
    const b = makeRig();
    near(b.nodeVoltage('out'), 5, 0.003, 'fixed output');
    near(b.branchCurrent('U1', 'gnd_6') + b.branchCurrent('U1', 'gnd_7'), 0, 1e-9,
      'bonded ground leads do not invent package current');
  });

  it('servos the adjustable pin to 1.22 V through an external divider', () => {
    const b = makeRig({ params: { adjustable: true }, divider: { top: 30000, bottom: 10000 }, loadOhms: 10000 });
    near(b.nodeVoltage('sense'), 1.22, 0.004, 'ADJ reference');
    near(b.nodeVoltage('out'), 4.88, 0.015, 'divider-programmed output');
  });

  it('uses the characterized load-dependent dropout curve', () => {
    near(makeRig({ vin: 5.2, loadOhms: 500 }).nodeVoltage('out'), 5.0, 0.02, '10 mA dropout');
    near(makeRig({ vin: 5.2, loadOhms: 10, params: { vOut: 5, currentLimit: 0.8 } }).nodeVoltage('out'),
      4.9, 0.025, '500 mA dropout');
  });

  it('does not promise more than the guaranteed current-limit floor', () => {
    const b = makeRig({ loadOhms: 5 });
    near(b.nodeVoltage('out') / 5, 0.52, 0.005, '520 mA limit');
  });

  it('honours shutdown hysteresis and rated input range', () => {
    assert.ok(makeRig({ shdn: 0.7 }).nodeVoltage('out') < 1e-3, 'below rising threshold stays off');
    assert.ok(makeRig({ vin: 1.7 }).nodeVoltage('out') < 1e-3, 'below rated VIN stays off');
    assert.ok(makeRig({ vin: 20.1 }).nodeVoltage('out') < 1e-3, 'above rated VIN stays off');
    const b = makeRig({ shdn: { wave: 'spice-pwl', points: [[0, 0], [1e-6, 0.9], [2e-6, 0.7], [3e-6, 0.6]] } });
    b.advanceTo(1_000n);
    assert.ok(b.nodeVoltage('out') > 4.9, 'crosses off-to-on threshold');
    b.advanceTo(2_000n);
    assert.ok(b.nodeVoltage('out') > 4.9, 'holds through hysteresis band');
    b.advanceTo(3_001n);
    assert.ok(b.nodeVoltage('out') < 1e-3, 'crosses on-to-off threshold');
  });

  it('accounts for load-dependent ground current and complete device KCL', () => {
    const b = makeRig({ loadOhms: 100 });
    const load = b.nodeVoltage('out') / 100;
    const input = -b.branchCurrent('U1', 'in');
    near(input - load, 1.1e-3, 0.08e-3, '50 mA ground current');
    const total = terminals.reduce((sum, terminal) => sum + b.branchCurrent('U1', terminal), 0);
    near(total, 0, 1e-9, 'eight-terminal KCL');
  });

  it('draws shutdown current while leaving OUT high impedance', () => {
    const b = makeRig({ shdn: 0 });
    near(-b.branchCurrent('U1', 'in'), 0.1e-6, 0.02e-6, 'typical shutdown current');
    assert.ok(b.nodeVoltage('out') < 1e-3, 'shutdown output');
  });
});
