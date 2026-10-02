import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BoardImpl} from '../src/board.js';
import {registerPowerDevices} from '../src/devices/power.js';

registerPowerDevices();
const terminals = ['vout_1', 'vout_2', 'sense_adj', 'gnd', 'en', 'ss', 'vin_7', 'vin_8'];
const net = (id, ...nodes) => ({id, terminals: nodes.map(([part, terminal]) => ({part, terminal}))});
function rig({params = {vOut: 5, startupModel: 'datasheet-envelope'}, cap = 2.2e-6,
  enable = 3.3, ss = false, load = 500} = {}) {
  const b = new BoardImpl(5);
  const parts = [
    {id: 'VIN', kind: 'vsource', params: {volts: 8}, terminals: ['pos', 'neg']},
    {id: 'EN', kind: 'vsource', params: {volts: enable}, terminals: ['pos', 'neg']},
    {id: 'G', kind: 'gnd', params: {}, terminals: ['gnd']},
    {id: 'U', kind: 'adp7118', params, terminals},
    {id: 'RL', kind: 'resistor', params: {ohms: load}, terminals: ['a', 'b']},
    ...(cap ? [{id: 'C', kind: 'capacitor', params: {farads: cap}, terminals: ['a', 'b']}] : []),
  ];
  const nets = [
    net('vin', ['VIN', 'pos'], ['U', 'vin_7'], ['U', 'vin_8']),
    net('en', ['EN', 'pos'], ['U', 'en']),
    net('out', ['U', 'vout_1'], ['U', 'vout_2'], ['U', 'sense_adj'], ['RL', 'a'],
      ...(cap ? [['C', 'a']] : [])),
    net('gnd', ['G', 'gnd'], ['VIN', 'neg'], ['EN', 'neg'], ['U', 'gnd'], ['RL', 'b'],
      ...(cap ? [['C', 'b']] : []), ...(ss ? [['U', 'ss']] : [])),
  ];
  b.setNetlist(parts, nets);
  return b;
}

test('opt-in ADP7118 startup meets independent 80us/380us data-sheet timing anchors with real output capacitance', () => {
  const b = rig();
  b.advanceTo(1n);
  assert.ok(Math.abs(b.nodeVoltage('out')) < 1e-5,
    `startup must not be instantaneous DC: ${b.nodeVoltage('out')} V, ${JSON.stringify(b.getDeviceState('U'), (_, v) => typeof v === 'bigint' ? String(v) : v)}`);
  b.advanceTo(80_000n);
  assert.ok(Math.abs(b.nodeVoltage('out') - .5) < .015, '80 us reaches typical 10%');
  assert.ok(b.branchCurrent('U', 'vout_1') + b.branchCurrent('U', 'vout_2') > .01,
    `charging currents ${b.branchCurrent('U', 'vout_1')} / ${b.branchCurrent('U', 'vout_2')}, C=${b.branchCurrent('C', 'a')}, out=${b.nodeVoltage('out')}`);
  assert.ok(Math.abs(terminals.reduce((sum, t) => sum + b.branchCurrent('U', t), 0)) < 1e-8,
    'charging output preserves whole-device KCL');
  b.advanceTo(380_000n);
  assert.ok(Math.abs(b.nodeVoltage('out') - 4.5) < .015, '380 us reaches typical 90%');
  b.advanceTo(1_200_000n);
  assert.ok(Math.abs(b.nodeVoltage('out') - 5) < .003);
  assert.equal(b.transientAnalysisStatus().accuracyMet, true,
    `startup must satisfy the real integrator, not only endpoint voltage: ${JSON.stringify(b.transientAnalysisStatus())}`);
  assert.equal(b.getDeviceState('U').startupModel, 'datasheet-envelope');
});

test('dynamic shutdown releases the real output capacitor and refuses unsupported prebiased restart', () => {
  const b = rig();
  b.advanceTo(380_000n);
  const before = b.nodeVoltage('out');
  b.setControl('EN', 0);
  const off = b.timeNs;
  b.advanceTo(off + 100_000n);
  const expected = before * Math.exp(-100e-6 / (500 * 2.2e-6));
  assert.ok(Math.abs(b.nodeVoltage('out') - expected) < .015,
    'disabled output discharges through its actual resistor, not an invented active sink');
  assert.throws(() => b.setControl('EN', 3.3), /ADP7118.*prebiased/);
});

test('startup never bypasses the existing output-current ceiling', () => {
  const b = rig({cap: 0, load: 10});
  b.advanceTo(1_200_000n);
  assert.ok(Math.abs(b.nodeVoltage('out') / 10 - .36) < .003,
    `startup-limited load reads ${b.nodeVoltage('out') / 10} A`);
});

test('default DC model remains immediate and explicit dynamic model is voltage-scaled', () => {
  const legacy = rig({params: {vOut: 5}, cap: 0});
  legacy.advanceTo(1n);
  assert.ok(Math.abs(legacy.nodeVoltage('out') - 5) < .003);
  assert.equal(legacy.getDeviceState('U').startupModel, undefined);
  const scaled = rig({params: {vOut: 3.3, startupModel: 'datasheet-envelope'}});
  scaled.advanceTo(380_000n);
  assert.ok(Math.abs(scaled.nodeVoltage('out') - 2.97) < .015);
});

test('shutdown, enable hysteresis and UVLO restart preserve a fresh startup clock', () => {
  const b = rig({cap: 0});
  b.advanceTo(2_000_000n);
  b.setControl('EN', 1.17);
  b.advanceTo(2_100_000n);
  assert.ok(b.nodeVoltage('out') > 4.99, 'hysteresis band does not restart');
  b.setControl('EN', 0);
  b.advanceTo(2_100_001n);
  assert.ok(Math.abs(b.nodeVoltage('out')) < 1e-3);
  b.setControl('EN', 3.3);
  const restart = b.timeNs;
  b.advanceTo(restart + 80_000n);
  assert.ok(Math.abs(b.nodeVoltage('out') - .5) < .015);
  b.setControl('VIN', 2);
  b.advanceTo(b.timeNs + 1n);
  assert.ok(Math.abs(b.nodeVoltage('out')) < 1e-3);
  b.setControl('VIN', 8);
  const uvloRestart = b.timeNs;
  b.advanceTo(uvloRestart + 380_000n);
  assert.ok(Math.abs(b.nodeVoltage('out') - 4.5) < .015);
});

test('startup scope captures monotonic finite history and complete device KCL', () => {
  const b = rig();
  const channel = b.addScopeChannel({type: 'voltage', netId: 'out', sampleRateHz: 100000, capture: 'sample'});
  const outputCurrent = b.addScopeChannel({type: 'current', partId: 'U', terminal: 'vout_1', sampleRateHz: 100000});
  // Current channels are caller-sampled, unlike engine-clock voltage rings.
  // Explicitly sample each real 10 us instant; do not invent a host-loop clock.
  for (let i = 1; i <= 100; i++) {
    b.advanceTo(BigInt(i) * 10_000n);
    b.sampleCurrentChannels();
  }
  const data = b.getScopeData(channel);
  assert.equal(b.transientAnalysisStatus().accuracyMet, true,
    `scope startup must satisfy the real integrator: ${JSON.stringify(b.transientAnalysisStatus())}`);
  const values = Array.from(data.samples).filter(Number.isFinite);
  assert.ok(values.length >= 100);
  assert.ok(values.every(v => v >= -1e-5 && v <= 5.001));
  assert.ok(values.some(v => v > .4 && v < .6), 'scope must observe the ramp, not only its endpoint');
  for (let i = 1; i < values.length; i++) assert.ok(values[i] >= values[i - 1] - 1e-5);
  const charging = Array.from(b.getScopeData(outputCurrent).samples).filter(Number.isFinite);
  assert.ok(charging.length >= 100);
  assert.ok(charging.every(amps => amps >= -1e-6 && amps <= .3601),
    'every caller-sampled charging current respects the ceiling and cannot actively sink');
  const currents = terminals.map(t => b.branchCurrent('U', t));
  assert.ok(currents.every(Number.isFinite));
  assert.ok(Math.abs(currents.reduce((a, c) => a + c, 0)) < 1e-8);
});

test('unknown startup model, external SS, adjustable and invalid nominal configurations refuse by name', () => {
  for (const params of [
    {startupModel: 'made-up'}, {startupModel: null},
    {startupModel: 'datasheet-envelope', adjustable: true},
    {startupModel: 'datasheet-envelope', vOut: 6},
    {startupModel: 'datasheet-envelope', rOut: 0},
    {startupModel: 'datasheet-envelope', currentLimit: NaN},
    {startupModel: 'datasheet-envelope', softStartCapacitanceF: 1e-9},
  ]) assert.throws(() => rig({params}), /ADP7118.*startup/i);
  assert.throws(() => {
    const b = rig({ss: true});
    b.advanceTo(1n);
    b.nodeVoltage('out');
  }, /ADP7118.*SS/i);
});

test('four executable startup mutants fail their real Board caller consequences; registry always restored', async () => {
  const pristine = readFileSync(new URL('../src/devices/power.js', import.meta.url), 'utf8');
  const mutants = [
    ['ramp bypass', 'nominal * startupFraction - vSense', 'nominal - vSense', () => {
      const b = rig({cap: 0}); b.advanceTo(80_000n);
      assert.ok(Math.abs(b.nodeVoltage('out') - .5) < .015);
    }],
    ['stale restart clock', 'state._startupStartNs = tNs;', 'state._startupStartNs = 0n;', () => {
      const b = rig({cap: 0}); b.advanceTo(1_200_000n);
      b.setControl('EN', 0); b.advanceTo(b.timeNs + 1n);
      b.setControl('EN', 3.3); const start = b.timeNs;
      b.advanceTo(start + 80_000n);
      assert.ok(Math.abs(b.nodeVoltage('out') - .5) < .015);
    }],
    ['missing SS refusal', "state.startupModel && ctx.netFor('ss')", "false && ctx.netFor('ss')", () => {
      assert.throws(() => rig({ss: true}), /ADP7118.*SS/);
    }],
    ['output current ceiling bypass', 'Math.max(vOut, Math.min(command, vOut + currentLimit * rOut))', 'command', () => {
      const b = rig({cap: 0, load: 10}); b.advanceTo(1_200_000n);
      assert.ok(Math.abs(b.nodeVoltage('out') / 10 - .36) < .003);
    }],
  ];
  for (const [name, anchor, replacement, prove] of mutants) {
    assert.equal(pristine.split(anchor).length - 1, 1, `${name}: one exact production anchor`);
    const mutated = pristine.replace(anchor, replacement).replace("'../devices.js'",
      JSON.stringify(new URL('../src/devices.js', import.meta.url).href));
    try {
      const model = await import(`data:text/javascript;base64,${Buffer.from(mutated).toString('base64')}`);
      model.registerPowerDevices();
      assert.throws(prove, {name: 'AssertionError'}, `${name}: numerical/refusal consequence must genuinely red`);
    } finally {registerPowerDevices();}
  }
  assert.equal(readFileSync(new URL('../src/devices/power.js', import.meta.url), 'utf8'), pristine);
  const restored = rig({cap: 0}); restored.advanceTo(380_000n);
  assert.ok(Math.abs(restored.nodeVoltage('out') - 4.5) < .015);
});
