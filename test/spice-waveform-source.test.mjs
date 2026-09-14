import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { BoardImpl } from '../src/board.js';
import { sourceCurrent, sourceVoltage } from '../src/mna.js';
import {
  nextSpiceExpCorner, nextSpicePwlCorner, nextSpiceSineCorner,
  spiceExpValue, spicePwlValue, spiceSineValue,
} from '../src/source-waveforms.js';

const source = (kind, params) => ({ id: 'S1', kind, params,
  terminals: kind === 'vsource' ? ['pos', 'neg'] : ['pos', 'neg'] });

function oneSourceBoard(kind, params, reactive = false) {
  const board = new BoardImpl(5);
  const parts = [source(kind, params),
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    ...(reactive ? [{ id: 'C1', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] }] : []),
    { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] }];
  const nets = kind === 'vsource' ? [
    { id: 'src', terminals: [{ part: 'S1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
    { id: 'out', terminals: [{ part: 'R1', terminal: 'b' },
      ...(reactive ? [{ part: 'C1', terminal: 'a' }] : [])] },
    { id: 'gnd', terminals: [{ part: 'S1', terminal: 'neg' },
      ...(reactive ? [{ part: 'C1', terminal: 'b' }] : []), { part: 'G1', terminal: 'gnd' }] },
  ] : [
    { id: 'out', terminals: [{ part: 'S1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
    { id: 'gnd', terminals: [{ part: 'S1', terminal: 'neg' }, { part: 'R1', terminal: 'b' },
      { part: 'G1', terminal: 'gnd' }] },
  ];
  board.setNetlist(parts, nets);
  return board;
}

describe('exact SPICE PWL and EXP source primitives', () => {
  it('interpolates and holds a strictly ordered PWL, exposing every authored corner', () => {
    const p = { wave: 'spice-pwl', points: [[0, -1], [1e-3, 3], [2.5e-3, 0]] };
    assert.equal(spicePwlValue(p, -1), -1);
    assert.equal(spicePwlValue(p, 0), -1);
    assert.ok(Math.abs(spicePwlValue(p, 0.25e-3)) < 1e-14);
    assert.ok(Math.abs(spicePwlValue(p, 2e-3) - 1) < 1e-14);
    assert.equal(spicePwlValue(p, 3e-3), 0);
    assert.equal(nextSpicePwlCorner(p, 0), 1e-3);
    assert.equal(nextSpicePwlCorner(p, 1e-3), 2.5e-3);
    assert.equal(nextSpicePwlCorner(p, 2.5e-3), null);
    assert.throws(() => spicePwlValue({ points: [[0, 1], [0, 2]] }, 0), /strictly increasing/);
    assert.throws(() => spicePwlValue({ points: [[0, 1]] }, 0), /at least two/);
  });

  it('implements both exponential transitions and their derivative corners', () => {
    const p = { wave: 'spice-exp', v1: -2, v2: 4, td1: 1e-3, tau1: 2e-3,
      td2: 5e-3, tau2: 3e-3 };
    assert.equal(spiceExpValue(p, 0), -2);
    assert.equal(spiceExpValue(p, 1e-3), -2);
    const rise = -2 + 6 * (1 - Math.exp(-1));
    assert.ok(Math.abs(spiceExpValue(p, 3e-3) - rise) < 1e-14);
    const both = -2 + 6 * (1 - Math.exp(-2.5)) - 6 * (1 - Math.exp(-1 / 3));
    assert.ok(Math.abs(spiceExpValue(p, 6e-3) - both) < 1e-14);
    assert.equal(nextSpiceExpCorner(p, 0), 1e-3);
    assert.equal(nextSpiceExpCorner(p, 1e-3), 5e-3);
    assert.equal(nextSpiceExpCorner(p, 5e-3), null);
    assert.throws(() => spiceExpValue({ ...p, tau1: 0 }, 0), /time constants must be positive/);
    assert.throws(() => spiceExpValue({ ...p, td2: 0 }, 0), /must not precede/);
  });

  it('implements delayed, damped, phased SPICE sine without folding it into native sine', () => {
    const p = { wave: 'spice-sine', offset: 2, amplitude: 3, freq: 1000,
      td: 1e-3, theta: 200, phase: 30 };
    assert.ok(Math.abs(spiceSineValue(p, 0.5e-3) - 3.5) < 1e-12);
    assert.ok(Math.abs(spiceSineValue(p, 1e-3) - 3.5) < 1e-12);
    const expected = 2 + 3 * Math.sin(2 * Math.PI * 0.25 + Math.PI / 6) * Math.exp(-0.05);
    assert.ok(Math.abs(spiceSineValue(p, 1.25e-3) - expected) < 1e-12);
    assert.equal(nextSpiceSineCorner(p, 0), 1e-3);
    assert.equal(nextSpiceSineCorner(p, 1e-3), null);
  });

  it('drives voltage and current sources through the same time function without changing polarity', () => {
    const params = { wave: 'spice-pwl', points: [[0, 0], [1e-3, 2e-3], [2e-3, -1e-3]] };
    assert.equal(sourceVoltage(source('vsource', params), 1e-3, 5), 2e-3);
    assert.equal(sourceCurrent(source('isource', { ...params, amps: 0 }), 1e-3), 2e-3);
    const board = oneSourceBoard('isource', { ...params, amps: 0 });
    board.advanceTo(1_000_000n);
    assert.ok(Math.abs(board.nodeVoltage('out') - 2) < 1e-8,
      'positive current still flows neg→pos and produces +I·R');
    assert.ok(Math.abs(board.branchCurrent('S1', 'pos') - 2e-3) < 1e-10);
  });

  it('keeps a waveform transient value distinct from its explicit DC bias', () => {
    const params = { wave: 'spice-pwl', points: [[0, 1], [1e-3, 2]], volts: 1, dcValue: 4 };
    const board = oneSourceBoard('vsource', params, true);
    assert.throws(() => board.operatingPoint(), /unsupported time-varying source/);
    const initialized = board.initializeTransientFromOperatingPoint();
    assert.ok(Math.abs(initialized.capacitorVoltages.get('C1') - 1) < 1e-8,
      'the non-UIC state is biased from PWL(t=0), not the distinct .op dcValue');
    assert.ok(Math.abs(board.nodeVoltage('src') - 1) < 1e-10);
    assert.equal(sourceVoltage(source('vsource', params), 0, 5), 1);
    const dc = oneSourceBoard('vsource', params, true).operatingPoint({ waveformBias: 'dc-value' });
    assert.ok(Math.abs(dc.nodeVoltages.get('src') - 4) < 1e-10);

    const missing = oneSourceBoard('vsource', { ...params, dcValue: undefined }, true);
    assert.throws(() => missing.operatingPoint({ waveformBias: 'dc-value' }), /explicit finite dcValue/);
  });

  it('matches ngspice waveform values at independently selected transient instants', (t) => {
    if (spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0) {
      t.skip('ngspice is not installed'); return;
    }
    const deck = `self-authored waveform values
VP p 0 PWL(0 -1 1m 3 2.5m 0)
VE e 0 EXP(-2 4 1m 2m 5m 3m)
VS s 0 SIN(2 3 1k 1m 200 30)
RP p 0 1k
RE e 0 1k
RS s 0 1k
.tran 1u 6m uic
.meas tran p FIND v(p) AT=2m
.meas tran e FIND v(e) AT=6m
.meas tran s FIND v(s) AT=1.25m
.end
`;
    const ng = spawnSync('ngspice', ['-n', '-b'], { input: deck, encoding: 'utf8' });
    assert.equal(ng.status, 0, ng.stderr);
    const read = name => Number(new RegExp(`^${name}\\s*=\\s*([^\\s]+)`, 'm').exec(ng.stdout)?.[1]);
    assert.ok(Math.abs(read('p') - spicePwlValue({ points: [[0, -1], [1e-3, 3], [2.5e-3, 0]] }, 2e-3)) < 2e-6);
    assert.ok(Math.abs(read('e') - spiceExpValue({ v1: -2, v2: 4, td1: 1e-3, tau1: 2e-3,
      td2: 5e-3, tau2: 3e-3 }, 6e-3)) < 2e-6);
    assert.ok(Math.abs(read('s') - spiceSineValue({ offset: 2, amplitude: 3, freq: 1000,
      td: 1e-3, theta: 200, phase: 30 }, 1.25e-3)) < 1e-5);
  });
});
