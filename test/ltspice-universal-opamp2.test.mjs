import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { getDevice } from '../src/devices.js';
import { registerAnalogAmps } from '../src/devices/analog-amps.js';

registerAnalogAmps();

const TERMINALS = ['inp', 'inn', 'vpos', 'vneg', 'out'];
const net = (id, ...terminals) => ({
  id,
  terminals: terminals.map(([part, terminal]) => ({ part, terminal })),
});

function amplifier({ input = 1, params = {}, feedback = true, load = 10000 } = {}) {
  const board = new BoardImpl(5);
  const ground = [['G', 'gnd'], ['VP', 'neg'], ['VN', 'pos'], ['VIN', 'neg'], ['RL', 'b']];
  if (!feedback) ground.push(['U1', 'inn']);
  board.setNetlist([
    { id: 'VP', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
    { id: 'VN', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
    { id: 'VIN', kind: 'vsource', params: { volts: input }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'ltspice_universal_opamp2', params, terminals: TERMINALS },
    { id: 'RL', kind: 'resistor', params: { ohms: load }, terminals: ['a', 'b'] },
  ], [
    net('gnd', ...ground),
    net('vpos', ['VP', 'pos'], ['U1', 'vpos']),
    net('vneg', ['VN', 'neg'], ['U1', 'vneg']),
    net('inp', ['VIN', 'pos'], ['U1', 'inp']),
    net('out', ['U1', 'out'], ...(feedback ? [['U1', 'inn']] : []), ['RL', 'a']),
  ]);
  return board;
}

function biasedLoadAmplifier() {
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'VP', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
    { id: 'VN', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
    { id: 'VIN', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
    { id: 'VBIAS', kind: 'vsource', params: { volts: 2 }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'ltspice_universal_opamp2', params: { outputCurrentLimitA: 0.025 }, terminals: TERMINALS },
    { id: 'RL', kind: 'resistor', params: { ohms: 10 }, terminals: ['a', 'b'] },
  ], [
    net('gnd', ['G', 'gnd'], ['VP', 'neg'], ['VN', 'pos'], ['VIN', 'neg'], ['VBIAS', 'neg']),
    net('vpos', ['VP', 'pos'], ['U1', 'vpos']),
    net('vneg', ['VN', 'neg'], ['U1', 'vneg']),
    net('inp', ['VIN', 'pos'], ['U1', 'inp']),
    net('out', ['U1', 'out'], ['U1', 'inn'], ['RL', 'a']),
    net('bias', ['VBIAS', 'pos'], ['RL', 'b']),
  ]);
  return board;
}

describe('LTspice UniversalOpamp2 deterministic Level-2 contract', () => {
  it('registers only the package-neutral five source terminals', () => {
    assert.deepEqual(getDevice('ltspice_universal_opamp2').terminals, TERMINALS);
  });

  it('uses the official finite-gain and input-resistance defaults', () => {
    const board = amplifier({ input: 1, load: 1e12 });
    board.advanceTo(10_000n);
    assert.ok(Math.abs(board.nodeVoltage('out') - (1e6 / 1_000_001)) < 2e-6,
      `default 1 MV/V output ${board.nodeVoltage('out')} V`);
    const current = Math.abs(board.branchCurrent('VIN', 'pos'));
    assert.ok(current > 0.9e-15 && current < 1.1e-15,
      `default 1 GOhm differential input current ${current} A`);
  });

  it('takes gain, offset and input resistance from each instance', () => {
    const board = amplifier({
      input: 1,
      load: 1e12,
      params: { a0: 1000, inputOffsetV: 0, inputR: 2e6 },
    });
    board.advanceTo(10_000n);
    assert.ok(Math.abs(board.nodeVoltage('out') - (1000 / 1001)) < 2e-5,
      `authored gain/offset output ${board.nodeVoltage('out')} V`);
    assert.ok(Math.abs(board.branchCurrent('VIN', 'pos')) > 0.45e-9);

    const offset = amplifier({ input: 1, params: { a0: 1000, inputOffsetV: 1e-3 } });
    offset.advanceTo(10_000n);
    assert.ok(Math.abs(offset.nodeVoltage('out') - 1) < 2e-5,
      `authored 1 mV offset output ${offset.nodeVoltage('out')} V`);
  });

  it('applies symmetric rail headroom and the authored output-current limit', () => {
    const rail = amplifier({ input: 5, params: { railHeadroomV: 1 }, load: 1e12 });
    rail.advanceTo(10_000n);
    assert.ok(rail.nodeVoltage('out') <= 4.00001);

    const limited = amplifier({ input: 5, load: 10, params: { outputCurrentLimitA: 0.025 } });
    limited.advanceTo(20_000n);
    assert.ok(limited.nodeVoltage('out') > 0.249 && limited.nodeVoltage('out') < 0.251,
      `25 mA into 10 ohm gives ${limited.nodeVoltage('out')} V`);
    assert.equal(limited.getDeviceState('U1').outputCurrentLimited, true);
    assert.ok(Math.abs(Math.abs(limited.branchCurrent('RL', 'a')) - 0.025) < 2e-5);

    const sinking = amplifier({ input: -5, load: 10, params: { outputCurrentLimitA: 0.025 } });
    sinking.advanceTo(20_000n);
    assert.ok(sinking.nodeVoltage('out') < -0.249 && sinking.nodeVoltage('out') > -0.251,
      `-25 mA into 10 ohm gives ${sinking.nodeVoltage('out')} V`);

    const biased = biasedLoadAmplifier();
    biased.advanceTo(20_000n);
    assert.ok(biased.nodeVoltage('out') > 2.249 && biased.nodeVoltage('out') < 2.251,
      `25 mA into 10 ohm above a 2 V reference gives ${biased.nodeVoltage('out')} V`);
    assert.ok(Math.abs(Math.abs(biased.branchCurrent('RL', 'a')) - 0.025) < 2e-5);
  });

  it('uses per-instance slew and gain-bandwidth limits', () => {
    const slow = amplifier({ input: 0, params: { slewVPerUs: 0.5, gbwHz: 100e6 } });
    slow.advanceTo(1_000n);
    slow.setControl('VIN', 4);
    const t0 = slow.timeNs;
    const v0 = slow.nodeVoltage('out');
    slow.advanceTo(t0 + 2_000n);
    const moved = slow.nodeVoltage('out') - v0;
    assert.ok(moved > 0.9 && moved <= 1.001, `two-us slew moved ${moved} V`);

    const narrow = amplifier({ input: 0, params: { slewVPerUs: 100, gbwHz: 100e3 } });
    narrow.advanceTo(10_000n);
    narrow.setControl('VIN', 0.01);
    const n0 = narrow.timeNs;
    narrow.advanceTo(n0 + 1_000n);
    assert.ok(narrow.nodeVoltage('out') > 0.001 && narrow.nodeVoltage('out') < 0.005,
      `100 kHz one-us response ${narrow.nodeVoltage('out')} V`);
    narrow.advanceTo(n0 + 10_000n);
    assert.ok(narrow.nodeVoltage('out') > 0.009,
      `100 kHz response eventually approaches the step, got ${narrow.nodeVoltage('out')} V`);
  });

  it('refuses malformed normalized parameters by name', () => {
    assert.throws(() => amplifier({ params: { gbwHz: 0 } }), /UniversalOpamp2 gbwHz/);
    assert.throws(() => amplifier({ params: { railHeadroomV: -1 } }), /railHeadroomV/);
    assert.throws(() => amplifier({ params: { inputOffsetV: '1m' } }), /inputOffsetV/);
  });
});
