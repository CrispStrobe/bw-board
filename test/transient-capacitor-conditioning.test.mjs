import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { solveMNA } from '../src/mna.js';

const term = (part, terminal) => ({ part, terminal });
const net = (id, ...terminals) => ({ id, terminals });

function si7liTrain2854() {
  const board = new BoardImpl(5);
  board.configureTransientAnalysis('precision-v1', { maxStepSec: 1e-6 });
  board.setNetlist([
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'V1', kind: 'vsource', params: { wave: 'spice-sine', offset: 0,
      amplitude: 7.8, freq: 78, td: 0, theta: 0, phase: 0 }, terminals: ['pos', 'neg'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    { id: 'R2', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    { id: 'R3', kind: 'resistor', params: { ohms: 30000 }, terminals: ['a', 'b'] },
    { id: 'R4', kind: 'resistor', params: { ohms: 60000 }, terminals: ['a', 'b'] },
    { id: 'C1', kind: 'capacitor', params: { farads: 4e-3 }, terminals: ['a', 'b'] },
    { id: 'L1', kind: 'inductor', params: { henrys: 10 }, terminals: ['a', 'b'] },
    { id: 'L2', kind: 'inductor', params: { henrys: 10 }, terminals: ['a', 'b'] },
  ], [
    net('in', term('V1', 'pos'), term('R2', 'b')),
    net('N001', term('R1', 'a'), term('R2', 'a'), term('L1', 'a'), term('L2', 'b')),
    net('N002', term('C1', 'a'), term('L1', 'b'), term('L2', 'a')),
    net('out', term('R3', 'a'), term('R4', 'a'), term('C1', 'b')),
    net('0', term('GND', 'gnd'), term('V1', 'neg'), term('R1', 'b'),
      term('R3', 'b'), term('R4', 'b')),
  ]);
  return board;
}

function passiveCapacitors(farads) {
  const caps = farads.map((value, index) => ({
    id: `C${index + 1}`, kind: 'capacitor', params: { farads: value }, terminals: ['a', 'b'],
  }));
  const parts = [
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    ...caps,
  ];
  const nets = [
    net('top', term('R1', 'a'), ...caps.map(cap => term(cap.id, 'a'))),
    net('0', term('GND', 'gnd'), term('R1', 'b'), ...caps.map(cap => term(cap.id, 'b'))),
  ];
  return { parts, nets };
}

describe('conditioned transient capacitor companion', () => {
  it('completes the real precision-profile failure and agrees with independent ngspice nodes', () => {
    const board = si7liTrain2854();
    const initialized = board.initializeTransientFromOperatingPoint({ fallback: 'proven-zero-state' });
    assert.equal(initialized.analysis.initialization,
      'source-declared-waveform-time-zero-zero-state');

    const readings = [];
    for (let sample = 0; sample <= 100; sample++) {
      if (sample) board.advanceTo(BigInt(sample * 150000));
      readings.push(new Map(['in', 'N001', 'N002', 'out'].map(id => [id, board.nodeVoltage(id)])));
    }
    const status = board.transientAnalysisStatus();
    assert.equal(status.accuracyMet, true, JSON.stringify(status.failure));
    assert.equal(status.work.advances, 100);
    assert.ok(readings.every(row => [...row.values()].every(Number.isFinite)));

    // ngspice 42 cannot assign the two individual DC currents of parallel
    // ideal inductors.  Replacing the opposite-oriented 10 H pair with its
    // node-equivalent single 5 H branch gives an independent, nonsingular
    // voltage oracle at the same authored 1 us maximum step.
    for (const [sample, expected] of [[25, {
      in: 7.523548, N001: 2.996613, out: 3.060642, N002: 3.060735,
    }], [100, {
      in: 6.835192, N001: 2.777068, out: 2.562111, N002: 2.562145,
    }]]) {
      for (const [id, voltage] of Object.entries(expected)) {
        const actual = readings[sample].get(id);
        assert.ok(Math.abs(actual - voltage) < 8e-7,
          `${id} sample ${sample}: native ${actual} vs ngspice ${voltage}`);
      }
    }
  });

  it('preserves BE current sign and KCL while sources are powered off', () => {
    const { parts, nets } = passiveCapacitors([1e-6]);
    const result = solveMNA(parts, nets, new Map(), new Map(), 5, {
      powerOff: true,
      transient: { dtSec: 1e-3, method: 'be', capVoltages: new Map([['C1', 5]]),
        capCurrents: new Map(), inductorCurrents: new Map(), inductorVoltages: new Map() },
    });
    assert.equal(result.converged, true);
    assert.ok(Math.abs(result.nodeVoltages.get('top') - 2.5) < 2e-9,
      'the solver gmin changes the analytic BE result only at nanovolt scale');
    assert.ok(Math.abs(result.capCurrentsNext.get('C1') + 2.5e-3) < 3e-12,
      'passive-sign capacitor current is negative while it delivers stored energy');
    const capIntoTop = result.branchCurrents.get('C1').get('a');
    const resistorIntoTop = result.branchCurrents.get('R1').get('a');
    assert.ok(Math.abs(capIntoTop + resistorIntoTop) < 1e-11,
      `top-node KCL: capacitor ${capIntoTop}, resistor ${resistorIntoTop}`);
  });

  it('keeps parallel positive capacitors independent and ignores zero/nonfinite values', () => {
    const parallel = passiveCapacitors([1e-6, 1e-6]);
    const result = solveMNA(parallel.parts, parallel.nets, new Map(), new Map(), 5, {
      powerOff: true,
      transient: { dtSec: 1e-3, method: 'be',
        capVoltages: new Map([['C1', 5], ['C2', 5]]), capCurrents: new Map(),
        inductorCurrents: new Map(), inductorVoltages: new Map() },
    });
    assert.equal(result.converged, true);
    assert.ok(Math.abs(result.nodeVoltages.get('top') - (10 / 3)) < 2e-9,
      'two 1 uF branches in parallel have a 2 ms time constant with 1 kohm');
    assert.ok(Math.abs(result.capCurrentsNext.get('C1') - result.capCurrentsNext.get('C2')) < 1e-15);

    for (const farads of [0, Infinity, Number.NaN]) {
      const inert = passiveCapacitors([farads]);
      const solved = solveMNA(inert.parts, inert.nets, new Map(), new Map(), 5, {
        powerOff: true,
        transient: { dtSec: 1e-3, method: 'be', capVoltages: new Map([['C1', 5]]),
          capCurrents: new Map(), inductorCurrents: new Map(), inductorVoltages: new Map() },
      });
      assert.equal(solved.converged, true, `farads=${farads}`);
      assert.ok([...solved.nodeVoltages.values()].every(Number.isFinite), `farads=${farads}`);
      assert.equal(solved.capCurrentsNext.get('C1'), 0, `farads=${farads}`);
    }
  });
});
