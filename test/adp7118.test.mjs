import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

function makeRig({
  vin = 8,
  enable = 3.3,
  loadOhms = 1000,
  params = { vOut: 5 },
  divider = null,
} = {}) {
  const board = new BoardImpl(5);
  const parts = [
    { id: 'VIN', kind: 'vsource', params: typeof vin === 'number' ? { volts: vin } : vin, terminals: ['pos', 'neg'] },
    { id: 'VEN', kind: 'vsource', params: typeof enable === 'number' ? { volts: enable } : enable, terminals: ['pos', 'neg'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'adp7118', params, terminals: [
      'vout_1', 'vout_2', 'sense_adj', 'gnd', 'en', 'ss', 'vin_7', 'vin_8',
    ] },
    { id: 'LOAD', kind: 'resistor', params: { ohms: loadOhms }, terminals: ['a', 'b'] },
  ];
  const nets = [
    { id: 'vin7', terminals: [{ part: 'VIN', terminal: 'pos' }, { part: 'U1', terminal: 'vin_7' }] },
    { id: 'vin8', terminals: [{ part: 'U1', terminal: 'vin_8' }] },
    { id: 'en', terminals: [{ part: 'VEN', terminal: 'pos' }, { part: 'U1', terminal: 'en' }] },
    { id: 'out1', terminals: [{ part: 'U1', terminal: 'vout_1' }, { part: 'LOAD', terminal: 'a' }] },
    { id: 'out2', terminals: [{ part: 'U1', terminal: 'vout_2' }] },
    { id: 'ss', terminals: [{ part: 'U1', terminal: 'ss' }] },
    { id: 'gnd', terminals: [
      { part: 'GND', terminal: 'gnd' }, { part: 'VIN', terminal: 'neg' },
      { part: 'VEN', terminal: 'neg' }, { part: 'U1', terminal: 'gnd' },
      { part: 'LOAD', terminal: 'b' },
    ] },
  ];
  if (divider) {
    parts.push(
      { id: 'RT', kind: 'resistor', params: { ohms: divider.top }, terminals: ['a', 'b'] },
      { id: 'RB', kind: 'resistor', params: { ohms: divider.bottom }, terminals: ['a', 'b'] },
    );
    nets[3].terminals.push({ part: 'RT', terminal: 'a' });
    nets.push({ id: 'sense', terminals: [
      { part: 'U1', terminal: 'sense_adj' }, { part: 'RT', terminal: 'b' },
      { part: 'RB', terminal: 'a' },
    ] });
    nets[6].terminals.push({ part: 'RB', terminal: 'b' });
  } else {
    nets[3].terminals.push({ part: 'U1', terminal: 'sense_adj' });
  }
  board.setNetlist(parts, nets);
  board.advanceTo(1n);
  return board;
}

const near = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${label}: expected ${expected} ± ${tolerance}, got ${actual}`,
);

describe('ADP7118 physical DC contract', () => {
  it('regulates a fixed output and bonds both VIN and VOUT lead pairs', () => {
    const b = makeRig();
    near(b.nodeVoltage('out1'), 5, 0.002, 'fixed 5 V output');
    near(b.nodeVoltage('out2'), b.nodeVoltage('out1'), 1e-4, 'VOUT pins 1 and 2');
    near(b.nodeVoltage('vin8'), b.nodeVoltage('vin7'), 1e-4, 'VIN pins 7 and 8');
  });

  it('uses the 1.2 V adjustable reference through the external divider', () => {
    const b = makeRig({
      params: { adjustable: true },
      divider: { top: 30000, bottom: 10000 },
      loadOhms: 10000,
    });
    near(b.nodeVoltage('sense'), 1.2, 0.004, 'ADJ reference');
    near(b.nodeVoltage('out1'), 4.8, 0.015, 'divider-programmed output');
  });

  it('tracks the 200 mV dropout boundary under rated load', () => {
    const b = makeRig({ vin: 5.1, loadOhms: 24.5 }); // approximately 200 mA
    near(b.nodeVoltage('out1'), 4.89, 0.02, 'dropout-limited output');
  });

  it('enforces typical current limit instead of inventing the set voltage', () => {
    const b = makeRig({ loadOhms: 10 });
    near(b.nodeVoltage('out1'), 3.6, 0.03, '360 mA current-limited output');
    near(b.nodeVoltage('out1') / 10, 0.36, 0.003, 'load current');
  });

  it('honours enable and UVLO boundaries without extrapolating over 20 V', () => {
    assert.ok(makeRig({ enable: 1.1 }).nodeVoltage('out1') < 1e-3, 'EN low disables');
    assert.ok(makeRig({ vin: 2.6 }).nodeVoltage('out1') < 1e-3, 'below UVLO disables');
    assert.ok(makeRig({ vin: 20.1 }).nodeVoltage('out1') < 1e-3, 'outside rated VIN disables');
    assert.ok(makeRig({ vin: 2.7, params: { vOut: 1.8 } }).nodeVoltage('out1') > 1.7,
      'rated low VIN enables');
  });

  it('retains regulation through the documented EN hysteresis band', () => {
    const b = makeRig({ enable: {
      wave: 'spice-pwl',
      points: [[0, 0], [1e-6, 1.3], [2e-6, 1.17], [3e-6, 1.1]],
    } });
    b.advanceTo(1_000n);
    assert.ok(b.nodeVoltage('out1') > 4.9, '1.3 V crosses rising threshold');
    b.advanceTo(2_000n);
    assert.ok(b.nodeVoltage('out1') > 4.9, '1.17 V remains enabled in hysteresis band');
    b.advanceTo(3_001n);
    assert.ok(b.nodeVoltage('out1') < 1e-3,
      `1.1 V crosses falling threshold (EN=${b.nodeVoltage('en')}, OUT=${b.nodeVoltage('out1')})`);
  });

  it('retains regulation through the documented UVLO hysteresis band', () => {
    const b = makeRig({
      vin: { wave: 'spice-pwl', points: [[0, 2], [1e-6, 3], [2e-6, 2.4], [3e-6, 2.1]] },
      params: { vOut: 1.8 },
    });
    b.advanceTo(1_000n);
    assert.ok(b.nodeVoltage('out1') > 1.7, '3 V crosses UVLO rising threshold');
    b.advanceTo(2_000n);
    assert.ok(b.nodeVoltage('out1') > 1.7, '2.4 V remains enabled in UVLO band');
    b.advanceTo(3_001n);
    assert.ok(b.nodeVoltage('out1') < 1e-3,
      `2.1 V crosses UVLO falling threshold (VIN=${b.nodeVoltage('vin7')}, OUT=${b.nodeVoltage('out1')})`);
  });

  it('accounts for delivered load plus quiescent current at VIN with full-device KCL', () => {
    const b = makeRig({ loadOhms: 1000 });
    const iLoad = b.nodeVoltage('out1') / 1000;
    const iVin = -b.branchCurrent('U1', 'vin_7');
    assert.ok(iVin > iLoad + 49e-6, `VIN ${iVin} includes load ${iLoad} and Iq`);
    assert.ok(iVin < iLoad + 60e-6, `light-load Iq remains data-sheet bounded: ${iVin - iLoad}`);
    const total = ['vout_1', 'vout_2', 'sense_adj', 'gnd', 'en', 'ss', 'vin_7', 'vin_8']
      .reduce((sum, terminal) => sum + b.branchCurrent('U1', terminal), 0);
    near(total, 0, 1e-9, 'eight-terminal KCL');
  });

  it('draws shutdown current while leaving the output high impedance', () => {
    const b = makeRig({ enable: 0 });
    near(-b.branchCurrent('U1', 'vin_7'), 2.04e-6, 0.1e-6, '8 V shutdown current');
    assert.ok(b.nodeVoltage('out1') < 1e-3, 'disabled output');
  });
});
