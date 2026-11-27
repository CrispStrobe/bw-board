/**
 * Power-on is a rise, not a step (mna.js SUPPLY_RISE_SEC).
 *
 * At power-on the DC operating point has Q2 on (its base fed from the
 * collector of Q1, which a discharged hold capacitor keeps off), so Q2's
 * collector -- a counter's clock -- sits low. With the supply switched on as
 * an ideal step the transient started with Q2's junction capacitances at 0 V,
 * i.e. with its base uncharged: for ~10 ns Q2 was off, the clock line pulsed
 * to the full 5 V and fell again, and a falling-edge counter counted once in
 * the first microsecond of a circuit in which nothing happened (sb3
 * lab-barrier-counter carried a 1 nF capacitor on its clock as a workaround).
 *
 * A battery switched on rises over microseconds (internal resistance and lead
 * inductance into the board's supply capacitance), so Q2's base charges while
 * the rail rises and Q2 is on from ~0.7 V of rail. A supply states its rise
 * (`params.riseSec`); the default is still the ideal step. And a counter below its
 * minimum supply (2 V for 74HC) does not count: it only tracks its clock, so
 * by the time it can count, its clock has long been low.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { supplyRampFraction, SUPPLY_RISE_SEC } from '../src/mna.js';

registerAllDevices();
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });
const Q = (id) => ({ id, kind: 'npn', params: { beta: 100 }, terminals: ['base', 'collector', 'emitter'] });
const CNT = { id: 'CNT', kind: '74hc93', params: {}, terminals: ['clk_a', 'clk_b', 'r0_1', 'r0_2', 'qa', 'qb', 'qc', 'qd', 'vcc', 'gnd'] };

function bench(riseSec = SUPPLY_RISE_SEC) {
  const b = new BoardImpl(5);
  b.setNetlist([
    { id: 'V', kind: 'vsource', params: { volts: 5, riseSec }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    R('RB1', 10e3), { id: 'CH', kind: 'capacitor', params: { farads: 220e-9 }, terminals: ['a', 'b'] }, Q('Q1'), R('RC1', 10e3), R('RB2', 10e3), Q('Q2'), R('RC2', 10e3),
    CNT,
  ], [
    net('vcc', ['V', 'pos'], ['RC1', 'a'], ['RC2', 'a'], ['CNT', 'vcc']),
    net('b1', ['RB1', 'b'], ['Q1', 'base']),
    net('h', ['RB1', 'a'], ['CH', 'a']),
    net('c1', ['Q1', 'collector'], ['RC1', 'b'], ['RB2', 'a']),
    net('b2', ['RB2', 'b'], ['Q2', 'base']),
    net('clk', ['Q2', 'collector'], ['RC2', 'b'], ['CNT', 'clk_a']),
    net('qa', ['CNT', 'qa'], ['CNT', 'clk_b']),
    net('g', ['G', 'gnd'], ['V', 'neg'], ['CH', 'b'], ['Q1', 'emitter'], ['Q2', 'emitter'],
      ['CNT', 'gnd'], ['CNT', 'r0_1'], ['CNT', 'r0_2']),
  ]);
  b.setPower(true);
  return b;
}

describe('power-on: the supply rises', () => {
  it('the rise is a smooth S-curve over SUPPLY_RISE_SEC, finite and monotone', () => {
    assert.equal(supplyRampFraction(0), 0);
    assert.equal(supplyRampFraction(SUPPLY_RISE_SEC), 1);
    assert.equal(supplyRampFraction(SUPPLY_RISE_SEC / 2), 0.5);
    assert.equal(supplyRampFraction(1), 1);
    assert.equal(supplyRampFraction(1e-9, 0), 1, 'rise 0: an ideal step');
    let prev = 0;
    for (let k = 1; k <= 100; k++) {
      const f = supplyRampFraction(k * SUPPLY_RISE_SEC / 100);
      assert.ok(f >= prev, 'monotone');
      prev = f;
    }
  });

  it('the rail follows the rise in a transient; the power-on DC point is the full supply', () => {
    const b = bench();
    assert.ok(Math.abs(b.nodeVoltage('vcc') - 5) < 1e-9, 'DC view at power-on: full supply');
    b.advanceTo(BigInt(Math.round(SUPPLY_RISE_SEC * 1e9 / 4)));
    const quarter = b.nodeVoltage('vcc');
    assert.ok(Math.abs(quarter - 5 * supplyRampFraction(SUPPLY_RISE_SEC / 4)) < 1e-6, `rail a quarter into the rise: ${quarter}`);
    b.advanceTo(BigInt(Math.round(SUPPLY_RISE_SEC * 2e9)));
    assert.ok(Math.abs(b.nodeVoltage('vcc') - 5) < 1e-9, 'risen');
  });

  it('a battery part and a vcc rail rise the same way; a board-wide rise covers supplies that state none', () => {
    const quarter = supplyRampFraction(SUPPLY_RISE_SEC / 4);
    const run = (parts, nets, boardRise) => {
      const b = new BoardImpl(5);
      if (boardRise !== undefined) b.supplyRiseSec = boardRise;
      b.setNetlist([{ id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
        R('RL', 1e3), { id: 'C', kind: 'capacitor', params: { farads: 1e-9 }, terminals: ['a', 'b'] }, ...parts], nets);
      b.setPower(true);
      b.advanceTo(BigInt(Math.round(SUPPLY_RISE_SEC * 1e9 / 4)));
      return b.nodeVoltage('s');
    };
    const loadNets = (src) => [net('s', src, ['RL', 'a'], ['C', 'a']), net('g', ['G', 'gnd'], ['RL', 'b'], ['C', 'b'])];
    const bat = run([{ id: 'B', kind: 'battery', params: { volts: 9, rInternal: 0, riseSec: SUPPLY_RISE_SEC }, terminals: ['pos', 'neg'] }],
      [...loadNets(['B', 'pos']).slice(0, 1), net('g', ['G', 'gnd'], ['RL', 'b'], ['C', 'b'], ['B', 'neg'])]);
    assert.ok(Math.abs(bat - 9 * quarter) < 0.01, `battery a quarter into its rise: ${bat}`);
    const rail = run([{ id: 'V', kind: 'vcc', params: { volts: 5, riseSec: SUPPLY_RISE_SEC }, terminals: ['vcc'] }], loadNets(['V', 'vcc']));
    assert.ok(Math.abs(rail - 5 * quarter) < 0.01, `vcc rail a quarter into its rise: ${rail}`);
    const boardWide = run([{ id: 'V', kind: 'vcc', params: { volts: 5 }, terminals: ['vcc'] }], loadNets(['V', 'vcc']), SUPPLY_RISE_SEC);
    assert.ok(Math.abs(boardWide - 5 * quarter) < 0.01, `board-wide rise: ${boardWide}`);
    const step = run([{ id: 'V', kind: 'vcc', params: { volts: 5 }, terminals: ['vcc'] }], loadNets(['V', 'vcc']));
    assert.ok(Math.abs(step - 5) < 1e-6, `default: an ideal step (${step})`);
  });

  it('a board rebuilt for a new netlist and restored from an empty board\'s snapshot still rises', () => {
    // How a designer syncs a netlist: snapshot the old (empty) board, build a
    // new one, setNetlist, restore. The empty snapshot never saw a power-on.
    const empty = new BoardImpl(5);
    const snap = empty.snapshot();
    const b = bench();
    b.restore(snap);
    b.advanceTo(BigInt(Math.round(SUPPLY_RISE_SEC * 1e9 / 4)));
    assert.ok(b.nodeVoltage('vcc') < 1, `still rising a quarter in: ${b.nodeVoltage('vcc')}`);
  });

  it('a transistor on at power-on stays on: its collector clock never pulses, the counter stays at 0', () => {
    const b = bench();
    let hi = 0;
    for (let ns = 1; ns <= 20000; ns *= 2) {
      b.advanceTo(BigInt(ns));
      hi = Math.max(hi, b.nodeVoltage('clk'));
    }
    b.advanceTo(1_000_000n);
    assert.equal(b.transientAnalysisStatus().failure, null);
    assert.ok(b.nodeVoltage('clk') < 0.3, `Q2 on: clock low (${b.nodeVoltage('clk')} V)`);
    assert.ok(hi < 1.0, `clock stayed under the counter's minimum supply from t = 0 (peak ${hi.toFixed(2)} V)`);
    assert.equal(b.getDeviceState('CNT').count, 0, 'nothing was counted');
  });

  it('an ideal step (the default, riseSec 0) still pulses the clock: the rise is what removes it', () => {
    const b = bench(0);
    let hi = 0;
    for (let ns = 1; ns <= 2000; ns *= 2) {
      b.advanceTo(BigInt(ns));
      hi = Math.max(hi, b.nodeVoltage('clk'));
    }
    assert.ok(hi > 2.5, `step: the clock pulsed (peak ${hi.toFixed(2)} V)`);
  });

  it('a drive that follows its own rising supply is not an edge: the rise costs a few hundred steps', () => {
    // A sensor module's digital output sits at its supply pin's voltage, so
    // during the rise its drive level moves on every accepted step. Each move
    // used to count as a discontinuity (a backward-Euler restart at a 1 ns
    // seed), and one 1 ms advance spent its whole 20,000-attempt budget on
    // the first microseconds (sb3 lab-hall-door-tone).
    const b = new BoardImpl(5);
    b.setNetlist([
      { id: 'V', kind: 'vsource', params: { volts: 5, riseSec: SUPPLY_RISE_SEC }, terminals: ['pos', 'neg'] },
      { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'H', kind: 'hall_digital', params: { field: 0 }, terminals: ['vcc', 'gnd', 'do'] },
      R('RL', 10e3), { id: 'C', kind: 'capacitor', params: { farads: 100e-9 }, terminals: ['a', 'b'] },
      Q('Q'), R('RC', 1e3),
    ], [
      net('vcc', ['V', 'pos'], ['H', 'vcc'], ['RC', 'a']),
      net('do', ['H', 'do'], ['RL', 'a']),
      net('base', ['RL', 'b'], ['C', 'a'], ['Q', 'base']),
      net('c', ['RC', 'b'], ['Q', 'collector']),
      net('g', ['G', 'gnd'], ['V', 'neg'], ['H', 'gnd'], ['C', 'b'], ['Q', 'emitter']),
    ]);
    b.setPower(true);
    b.advanceTo(1_000_000n);
    const s = b.transientAnalysisStatus();
    assert.equal(s.failure, null);
    assert.ok(s.work.attempts < 1000, `attempts for 1 ms: ${s.work.attempts}`);
    assert.ok(Math.abs(b.nodeVoltage('do') - 5) < 0.05, `output high: ${b.nodeVoltage('do')}`);
  });

  it('below 2 V of its own supply a counter tracks its clock but does not count', () => {
    // A 74HC93 on a 1.5 V rail, clocked by a square wave: nothing counts.
    // The same counter on 3 V counts.
    const run = (volts) => {
      const b = new BoardImpl(5);
      b.setNetlist([
        { id: 'V', kind: 'vsource', params: { volts, riseSec: SUPPLY_RISE_SEC }, terminals: ['pos', 'neg'] },
        { id: 'S', kind: 'vsource', params: { wave: 'pulse', freq: 10000, amplitude: volts, duty: 0.5 }, terminals: ['pos', 'neg'] },
        { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
        R('RL', 10e3), CNT,
      ], [
        net('vcc', ['V', 'pos'], ['CNT', 'vcc']),
        net('clk', ['S', 'pos'], ['CNT', 'clk_a'], ['RL', 'a']),
        net('qa', ['CNT', 'qa'], ['CNT', 'clk_b']),
        net('g', ['G', 'gnd'], ['V', 'neg'], ['S', 'neg'], ['RL', 'b'], ['CNT', 'gnd'], ['CNT', 'r0_1'], ['CNT', 'r0_2']),
      ]);
      b.setPower(true);
      b.advanceTo(1_000_000n);
      return b.getDeviceState('CNT').count;
    };
    assert.equal(run(1.5), 0, '1.5 V: below the 74HC minimum, no counting');
    assert.ok(run(3) > 0, '3 V: counts');
  });
});
