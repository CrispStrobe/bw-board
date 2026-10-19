import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BoardImpl } from '../src/board.js';

const gnd = { id: 'G0', kind: 'gnd', params: {}, terminals: ['gnd'] };
const resistor = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });
const net = (id, ...terminals) => ({ id, terminals: terminals.map(([part, terminal]) => ({ part, terminal })) });

function board(parts, nets) {
  const result = new BoardImpl(5);
  result.setNetlist(parts, nets);
  return result;
}

describe('strict AC source-analysis contract', () => {
  it('preserves an exact frequency vector and reports explicit zero regularization', () => {
    const b = board([
      gnd,
      { id: 'V1', kind: 'vsource', params: { volts: 0 }, terminals: ['pos', 'neg'] },
      resistor('R1', 1000),
    ], [
      net('in', ['V1', 'pos'], ['R1', 'a']),
      net('gnd', ['G0', 'gnd'], ['V1', 'neg'], ['R1', 'b']),
    ]);
    const frequencies = [17, 50, 123.456];
    const rows = b.runAc({ sourceId: 'V1', frequencies, analysisProfile: 'source-analysis-v1',
      nodeRegularizationSiemens: 0, probes: ['in'] });
    assert.deepEqual(rows.map(row => row.hz), frequencies);
    assert.equal(rows.every(row => row.results.get('in').mag === 1), true);
    assert.deepEqual(rows[0].profile, { id: 'source-analysis-v1', nodeRegularizationSiemens: 0,
      sourceBiasPolicy: 'authored-dc-value-no-interactive-source-controls' });
    assert.equal(b.runAc({ sourceId: 'V1', frequencies: [50], analysisProfile: 'source-analysis-v1',
      nodeRegularizationSiemens: 0 })[0].hz, 50);
  });

  it('removes only explicitly requested node regularization from the measured Twin-T family', () => {
    const b = board([
      gnd,
      { id: 'Vin', kind: 'vsource', params: { volts: 0 }, terminals: ['pos', 'neg'] },
      resistor('R1', 680e3), resistor('R2', 680e3), resistor('R3', 330e3),
      { id: 'C1', kind: 'capacitor', params: { farads: 47e-12 }, terminals: ['a', 'b'] },
      { id: 'C2', kind: 'capacitor', params: { farads: 47e-12 }, terminals: ['a', 'b'] },
      { id: 'C3', kind: 'capacitor', params: { farads: 100e-12 }, terminals: ['a', 'b'] },
    ], [
      net('n1', ['Vin', 'pos'], ['R1', 'a'], ['C1', 'a']),
      net('n2', ['R1', 'b'], ['R2', 'a'], ['C3', 'a']),
      net('n3', ['C1', 'b'], ['C2', 'a'], ['R3', 'a']),
      net('n4', ['R2', 'b'], ['C2', 'b']),
      net('gnd', ['G0', 'gnd'], ['Vin', 'neg'], ['R3', 'b'], ['C3', 'b']),
    ]);
    const strict = b.runAc({ sourceId: 'Vin', frequencies: [50], analysisProfile: 'source-analysis-v1',
      nodeRegularizationSiemens: 0, probes: ['n4'] })[0].results.get('n4');
    // Independent ngspice 42 result for this self-authored literal network.
    const expectedReal = 0.9983037062236078;
    const strictReal = strict.mag * Math.cos(strict.phaseDeg * Math.PI / 180);
    assert.ok(Math.abs(strictReal - expectedReal) < 1e-12, `${strictReal} vs ${expectedReal}`);

    const legacy = b.runAc({ sourceId: 'Vin', from: 50, to: 50.0001,
      pointsPerDecade: 1, probes: ['n4'] })[0];
    const legacyReal = legacy.results.get('n4').mag
      * Math.cos(legacy.results.get('n4').phaseDeg * Math.PI / 180);
    assert.equal(legacy.profile.nodeRegularizationSiemens, 1e-12);
    assert.ok(Math.abs(legacyReal - expectedReal) > 2e-6,
      'the compatibility profile must retain its declared regularization');
  });

  it('stamps selected and killed voltage sources as differential constraints', () => {
    const differential = board([
      gnd,
      { id: 'V1', kind: 'vsource', params: { volts: 0 }, terminals: ['pos', 'neg'] },
      resistor('RP', 1000), resistor('RN', 1000),
    ], [
      net('p', ['V1', 'pos'], ['RP', 'a']), net('n', ['V1', 'neg'], ['RN', 'a']),
      net('gnd', ['G0', 'gnd'], ['RP', 'b'], ['RN', 'b']),
    ]);
    const v = differential.runAc({ sourceId: 'V1', frequencies: [1], analysisProfile: 'source-analysis-v1',
      nodeRegularizationSiemens: 0, probes: ['p', 'n'] })[0].results;
    assert.ok(Math.abs(v.get('p').mag - 0.5) < 1e-12);
    assert.ok(Math.abs(v.get('n').mag - 0.5) < 1e-12);
    assert.ok(Math.abs(v.get('p').phaseDeg) < 1e-12);
    assert.ok(Math.abs(Math.abs(v.get('n').phaseDeg) - 180) < 1e-12);

    const killed = board([
      gnd,
      { id: 'I1', kind: 'isource', params: { amps: 0 }, terminals: ['pos', 'neg'] },
      { id: 'V0', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
      resistor('RP', 1000), resistor('RN', 1000),
    ], [
      net('p', ['I1', 'pos'], ['V0', 'pos'], ['RP', 'a']),
      net('n', ['V0', 'neg'], ['RN', 'a']),
      net('gnd', ['G0', 'gnd'], ['I1', 'neg'], ['RP', 'b'], ['RN', 'b']),
    ]);
    const i = killed.runAc({ sourceId: 'I1', frequencies: [10], analysisProfile: 'source-analysis-v1',
      nodeRegularizationSiemens: 0, probes: ['p', 'n'] })[0].results;
    assert.ok(Math.abs(i.get('p').mag - 500) < 1e-9);
    assert.ok(Math.abs(i.get('n').mag - 500) < 1e-9);
  });

  it('uses the native neg-to-pos current-source sign without grounding either terminal', () => {
    const make = reverse => board([
      gnd,
      { id: 'I1', kind: 'isource', params: { amps: 0 }, terminals: ['pos', 'neg'] },
      resistor('R1', 1000),
    ], reverse ? [
      net('n', ['I1', 'neg'], ['R1', 'a']), net('gnd', ['G0', 'gnd'], ['I1', 'pos'], ['R1', 'b']),
    ] : [
      net('n', ['I1', 'pos'], ['R1', 'a']), net('gnd', ['G0', 'gnd'], ['I1', 'neg'], ['R1', 'b']),
    ]);
    for (const [reverse, phase] of [[false, 0], [true, 180]]) {
      const value = make(reverse).runAc({ sourceId: 'I1', frequencies: [10],
        analysisProfile: 'source-analysis-v1', nodeRegularizationSiemens: 0, probes: ['n'] })[0].results.get('n');
      assert.ok(Math.abs(value.mag - 1000) < 1e-9);
      assert.ok(Math.abs(Math.abs(value.phaseDeg) - phase) < 1e-12);
    }
  });

  it('linearizes source analysis at authored DC bias rather than waveform time or UI control', () => {
    const b = board([
      gnd,
      { id: 'V1', kind: 'vsource', params: { wave: 'spice-sine', offset: 0, amplitude: 1,
        freq: 1000, td: 0, theta: 0, phase: 0, dcValue: 0.7 }, terminals: ['pos', 'neg'] },
      resistor('R1', 1000),
      { id: 'D1', kind: 'diode', params: { model: 'shockley', is: 1e-12, n: 1, rs: 0 },
        terminals: ['anode', 'cathode'] },
    ], [
      net('in', ['V1', 'pos'], ['R1', 'a']), net('out', ['R1', 'b'], ['D1', 'anode']),
      net('gnd', ['G0', 'gnd'], ['V1', 'neg'], ['D1', 'cathode']),
    ]);
    const run = () => b.runAc({ sourceId: 'V1', frequencies: [1000],
      analysisProfile: 'source-analysis-v1', nodeRegularizationSiemens: 0, probes: ['out'] })[0];
    const authored = run();
    b.setControl('V1', 2.5);
    b.advanceTo(125000n); // a nonzero waveform phase must not become the DC linearization point
    const afterLiveChanges = run();
    assert.deepEqual(afterLiveChanges.results.get('out'), authored.results.get('out'));
    assert.equal(afterLiveChanges.profile.sourceBiasPolicy,
      'authored-dc-value-no-interactive-source-controls');
  });

  it('refuses malformed grids, regularization and singular zero-regularization systems', () => {
    const b = board([
      gnd, { id: 'V1', kind: 'vsource', params: { volts: 0 }, terminals: ['pos', 'neg'] }, resistor('R1', 1000),
    ], [net('n', ['V1', 'pos'], ['R1', 'a']), net('gnd', ['G0', 'gnd'], ['V1', 'neg'], ['R1', 'b'])]);
    for (const frequencies of [[], [0], [1, 1], [2, 1], [1, Infinity], '1']) {
      assert.throws(() => b.runAc({ sourceId: 'V1', frequencies,
        analysisProfile: 'source-analysis-v1' }), /strictly increasing exact grid/);
    }
    assert.throws(() => b.runAc({ sourceId: 'V1', frequencies: [1], from: 1,
      analysisProfile: 'source-analysis-v1' }), /strictly increasing exact grid/);
    assert.throws(() => b.runAc({ sourceId: 'V1', frequencies: [1],
      analysisProfile: 'interactive-v1' }), /strictly increasing exact grid/);
    for (const value of [-1, Infinity, NaN]) assert.throws(() => b.runAc({ sourceId: 'V1',
      from: 1, to: 2, nodeRegularizationSiemens: value }), /finite and >= 0/);

    const floating = board([
      { id: 'I1', kind: 'isource', params: { amps: 0 }, terminals: ['pos', 'neg'] }, resistor('R1', 1000),
    ], [net('a', ['I1', 'pos'], ['R1', 'a']), net('b', ['I1', 'neg'], ['R1', 'b'])]);
    assert.throws(() => floating.runAc({ sourceId: 'I1', frequencies: [1],
      analysisProfile: 'source-analysis-v1', nodeRegularizationSiemens: 0 }), /singular/i);

    const missingTerminal = board([
      gnd, { id: 'I1', kind: 'isource', params: { amps: 0 }, terminals: ['pos', 'neg'] }, resistor('R1', 1000),
    ], [net('n', ['I1', 'pos'], ['R1', 'a']), net('gnd', ['G0', 'gnd'], ['R1', 'b'])]);
    assert.throws(() => missingTerminal.runAc({ sourceId: 'I1', frequencies: [1],
      analysisProfile: 'source-analysis-v1', nodeRegularizationSiemens: 0 }), /both terminals connected/);
  });
});
