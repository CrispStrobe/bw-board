import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { getDevice } from '../src/devices.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();
const terminals = ['vin', 'gnd', 'en', 'nc', 'vout'];
const near = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${label}: expected ${expected} ± ${tolerance}, got ${actual}`,
);

function rig({ vin = 5, en = 3.3, loadOhms = 1000, params = { vOut: 3.3 } } = {}) {
  const b = new BoardImpl(5);
  b.setNetlist([
    { id: 'VIN', kind: 'vsource', params: { volts: vin }, terminals: ['pos', 'neg'] },
    { id: 'EN', kind: 'vsource', params: { volts: en }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'adp151', params, terminals },
    { id: 'LOAD', kind: 'resistor', params: { ohms: loadOhms }, terminals: ['a', 'b'] },
  ], [
    { id: 'vin', terminals: [{ part: 'VIN', terminal: 'pos' }, { part: 'U1', terminal: 'vin' }] },
    { id: 'en', terminals: [{ part: 'EN', terminal: 'pos' }, { part: 'U1', terminal: 'en' }] },
    { id: 'out', terminals: [{ part: 'U1', terminal: 'vout' }, { part: 'LOAD', terminal: 'a' }] },
    { id: 'nc', terminals: [{ part: 'U1', terminal: 'nc' }] },
    { id: 'gnd', terminals: [
      { part: 'G', terminal: 'gnd' }, { part: 'VIN', terminal: 'neg' },
      { part: 'EN', terminal: 'neg' }, { part: 'U1', terminal: 'gnd' },
      { part: 'LOAD', terminal: 'b' },
    ] },
  ]);
  b.advanceTo(1n);
  return b;
}

describe('ADP151 TSOT-5 fixed-output DC contract', () => {
  it('registers exactly the five physical leads', () => {
    assert.deepEqual(getDevice('adp151').terminals, terminals);
  });

  it('regulates every audited fixed-output option', () => {
    for (const vOut of [1.1, 1.2, 1.5, 1.8, 2.1, 2.5, 2.6, 2.7, 2.75, 2.8, 2.85, 2.9, 3.0, 3.3]) {
      const b = rig({ vin: Math.max(2.3, vOut + 0.5), params: { vOut } });
      near(b.nodeVoltage('out'), vOut, 0.002, `${vOut} V option`);
    }
  });

  it('refuses disabled, out-of-range supply and invented output settings', () => {
    assert.ok(rig({ en: 0.4 }).nodeVoltage('out') < 1e-4, 'EN low disables');
    assert.ok(rig({ vin: 2.1, params: { vOut: 1.1 } }).nodeVoltage('out') < 1e-4,
      'below rated VIN refuses');
    assert.ok(rig({ vin: 5.6 }).nodeVoltage('out') < 1e-4, 'above rated VIN refuses');
    assert.ok(rig({ params: { vOut: 4.2 } }).nodeVoltage('out') < 1e-4,
      'unavailable output option refuses');
  });

  it('uses the guaranteed loaded-dropout envelope', () => {
    const b = rig({ vin: 3.4, loadOhms: 16.5, params: { vOut: 3.3 } });
    assert.ok(b.nodeVoltage('out') >= 3.16 && b.nodeVoltage('out') <= 3.19,
      `loaded dropout output was ${b.nodeVoltage('out')} V`);
  });

  it('does not promise more than the guaranteed current-limit floor', () => {
    const b = rig({ loadOhms: 10, params: { vOut: 3.3 } });
    near(b.nodeVoltage('out') / 10, 0.22, 0.003, '220 mA current limit');
  });

  it('accounts for load and ground current with full-package KCL', () => {
    const b = rig({ loadOhms: 1000 });
    const load = b.nodeVoltage('out') / 1000;
    const input = -b.branchCurrent('U1', 'vin');
    assert.ok(input > load + 10e-6 && input < load + 20e-6,
      `light-load ground current was ${input - load} A`);
    const total = terminals.reduce((sum, terminal) => sum + b.branchCurrent('U1', terminal), 0);
    near(total, 0, 1e-9, 'five-terminal KCL');
  });

  it('draws shutdown current while leaving the output high impedance', () => {
    const b = rig({ en: 0 });
    near(-b.branchCurrent('U1', 'vin'), 0.2e-6, 0.03e-6, 'shutdown current');
    assert.ok(b.nodeVoltage('out') < 1e-4, 'disabled output');
  });
});
