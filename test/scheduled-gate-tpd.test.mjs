/**
 * Scheduled device events + gate propagation delay — hand oracles per
 * spec-updates/scheduled-device-events.md. tpd is OPT-IN; the default
 * path stays the fixpoint (covered by the whole existing gate suite).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerLogicGates } from '../src/devices/logic-gates.js';
import { unregisterDevice } from '../src/devices.js';

function setup() { registerLogicGates(); }
function teardown() {
  for (const k of ['gate_and', 'gate_or', 'gate_not', 'gate_nand', 'gate_nor', 'gate_xor']) {
    try { unregisterDevice(k); } catch {}
  }
}

const VCC = { id: 'V1', kind: 'vcc', params: {}, terminals: ['vcc'] };
const GND = { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] };

describe('ring oscillator (the E4.1a unlock)', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('three staggered inverters oscillate at period 2·Σtpd = 720 ns', () => {
    // tpd 100/120/140 ns breaks the symmetric all-flip mode, so the
    // classic traveling wave runs: period = 2·(100+120+140) = 720 ns.
    const parts = [VCC, GND];
    const nets = [
      { id: 'n_vcc', terminals: [{ part: 'V1', terminal: 'vcc' }] },
      { id: 'n_gnd', terminals: [{ part: 'G1', terminal: 'gnd' }] },
    ];
    const tpds = [100, 120, 140];
    for (let k = 0; k < 3; k++) {
      parts.push({ id: `N${k}`, kind: 'gate_not', params: { tpdNs: tpds[k] },
        terminals: ['in0', 'out'] });
    }
    // Ring wiring: N0.out→N1.in0, N1.out→N2.in0, N2.out→N0.in0.
    for (let k = 0; k < 3; k++) {
      nets.push({ id: `n_${k}`, terminals: [
        { part: `N${k}`, terminal: 'out' },
        { part: `N${(k + 1) % 3}`, terminal: 'in0' },
      ] });
    }
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // March 6 µs in 20 ns ticks, counting rising edges on n_0 after a
    // 1.5 µs settling head.
    let last = board.nodeVoltage('n_0') > 2.5;
    let rises = 0;
    let firstRise = null;
    let lastRise = null;
    for (let t = 20; t <= 6000; t += 20) {
      board.advanceTo(BigInt(t)); // t is in ns
      const hi = board.nodeVoltage('n_0') > 2.5;
      if (hi && !last && t > 1500) {
        rises++;
        if (firstRise === null) firstRise = t;
        lastRise = t;
      }
      last = hi;
    }
    assert.ok(rises >= 4, `the ring must oscillate: ${rises} rising edges seen`);
    const period = (lastRise - firstRise) / (rises - 1);
    assert.ok(Math.abs(period - 720) <= 40,
      `period must be 2·Σtpd = 720 ns (±2 ticks), measured ${period.toFixed(0)} ns over ${rises} edges`);
  });
});

describe('inertial semantics', () => {
  beforeEach(setup);
  afterEach(teardown);

  function pulseBench(pulseNs) {
    // A pulse source into a tpd=100ns inverter; the pulse repeats slowly
    // (10 µs period) so one window is clean to observe.
    const parts = [GND,
      { id: 'SRC', kind: 'vsource',
        params: { wave: 'pulse', freq: 100000, duty: pulseNs / 10000, amplitude: 5, offset: 0 },
        terminals: ['pos', 'neg'] },
      { id: 'N0', kind: 'gate_not', params: { tpdNs: 100 }, terminals: ['in0', 'out'] }];
    const nets = [
      { id: 'n_in', terminals: [{ part: 'SRC', terminal: 'pos' }, { part: 'N0', terminal: 'in0' }] },
      { id: 'n_out', terminals: [{ part: 'N0', terminal: 'out' }] },
      { id: 'n_gnd', terminals: [{ part: 'G1', terminal: 'gnd' }, { part: 'SRC', terminal: 'neg' }] },
    ];
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    return board;
  }

  it('a 40 ns pulse into tpd=100 ns does NOT propagate', () => {
    // Observe the SECOND pulse window (10.000–10.040 µs): the startup
    // epoch is excluded — the gate's init output is low until its first
    // wake, which is bring-up, not propagation.
    const board = pulseBench(40);
    board.advanceTo(9_000n);           // past startup; steady out = high
    assert.ok(board.nodeVoltage('n_out') > 2.5, 'steady state is high');
    let sawLow = false;
    for (let t = 9_900; t <= 11_000; t += 10) {
      board.advanceTo(BigInt(t));
      if (board.nodeVoltage('n_out') < 2.5) sawLow = true;
    }
    assert.equal(sawLow, false,
      'the output never dips — the sub-tpd pulse was inertially cancelled');
  });

  it('a 250 ns pulse propagates, delayed by tpd', () => {
    // Second window: pulse high 10.000–10.250 µs. Output falls at
    // ~10.100 (rise + tpd) and returns at ~10.350 (fall + tpd).
    const board = pulseBench(250);
    const at = (ns) => { board.advanceTo(BigInt(ns)); return board.nodeVoltage('n_out') > 2.5; };
    assert.equal(at(10_080), true, 'before tpd expires the output has not moved');
    assert.equal(at(10_150), false, 'flipped ~100 ns after the rising edge');
    assert.equal(at(10_320), false, 'still low before the return flip');
    assert.equal(at(10_420), true, 'returned high ~100 ns after the falling edge');
  });
});

describe('mixed chain: armed and un-armed gates compose', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('an un-armed inverter collapses in the fixpoint; the armed one takes its tpd', () => {
    const parts = [GND,
      { id: 'SRC', kind: 'vsource', params: { volts: 0 }, terminals: ['pos', 'neg'] },
      { id: 'FAST', kind: 'gate_not', params: {}, terminals: ['in0', 'out'] },
      { id: 'SLOW', kind: 'gate_not', params: { tpdNs: 200 }, terminals: ['in0', 'out'] }];
    const nets = [
      { id: 'n_in', terminals: [{ part: 'SRC', terminal: 'pos' }, { part: 'FAST', terminal: 'in0' }] },
      { id: 'n_mid', terminals: [{ part: 'FAST', terminal: 'out' }, { part: 'SLOW', terminal: 'in0' }] },
      { id: 'n_out', terminals: [{ part: 'SLOW', terminal: 'out' }] },
      { id: 'n_gnd', terminals: [{ part: 'G1', terminal: 'gnd' }, { part: 'SRC', terminal: 'neg' }] },
    ];
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.advanceTo(1_000_000n); // settle: in=0 → mid=1 → out pending→0
    board.advanceTo(2_000_000n);
    assert.ok(board.nodeVoltage('n_mid') > 2.5, 'un-armed inverter settled high');
    assert.ok(board.nodeVoltage('n_out') < 2.5, 'armed inverter settled low');
    // Step the source: FAST flips within the same solve event; SLOW 200 ns later.
    board.setControl('SRC', 5);
    board.advanceTo(2_000_100n); // +100 ns
    assert.ok(board.nodeVoltage('n_mid') < 2.5, 'FAST already low at +100 ns');
    assert.ok(board.nodeVoltage('n_out') < 2.5, 'SLOW has not flipped yet at +100 ns');
    board.advanceTo(2_000_300n); // +300 ns
    assert.ok(board.nodeVoltage('n_out') > 2.5, 'SLOW high after its 200 ns');
  });
});

describe('static-1 hazard (the E4.1 oracle the fixpoint provably cannot show)', () => {
  beforeEach(setup);
  afterEach(teardown);

  // Y = (A·B) + (Ā·C) with B = C = 1: Y is 1 on BOTH sides of any A
  // transition, so a fixpoint model holds Y at 1 forever. With skewed
  // real delays, A falling opens a window where the A·B leg has already
  // dropped and the Ā·C leg has not yet risen — the classic static-1
  // glitch. Hand timeline for A: 5→0 at t0, tpd AND=50, NOT=100, OR=50:
  //   AND1.out falls  t0+50   (A gone, B still 1)
  //   NOT.out  rises  t0+100 → AND2.out rises t0+150
  //   OR sees in0 low from t0+50 with in1 still low → Y falls t0+100
  //   OR sees in1 rise at t0+150               → Y rises t0+200
  // Glitch: Y low exactly in [t0+100, t0+200) — width = tpd_NOT, the
  // path-skew, not any input's own width. The pending fall FIRES before
  // the reverting input arrives, so inertial cancellation (which kills
  // sub-tpd input pulses) does not kill a genuine hazard.
  function hazardBench(armed) {
    const tpd = (ns) => (armed ? { tpdNs: ns } : {});
    const parts = [VCC, GND,
      { id: 'SRC', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
      { id: 'AND1', kind: 'gate_and', params: tpd(50), terminals: ['in0', 'in1', 'out'] },
      { id: 'NOT1', kind: 'gate_not', params: tpd(100), terminals: ['in0', 'out'] },
      { id: 'AND2', kind: 'gate_and', params: tpd(50), terminals: ['in0', 'in1', 'out'] },
      { id: 'OR1', kind: 'gate_or', params: tpd(50), terminals: ['in0', 'in1', 'out'] }];
    const nets = [
      { id: 'n_vcc', terminals: [
        { part: 'V1', terminal: 'vcc' },
        { part: 'AND1', terminal: 'in1' },   // B = 1
        { part: 'AND2', terminal: 'in1' },   // C = 1
      ] },
      { id: 'n_a', terminals: [
        { part: 'SRC', terminal: 'pos' },
        { part: 'AND1', terminal: 'in0' },
        { part: 'NOT1', terminal: 'in0' },
      ] },
      { id: 'n_nota', terminals: [
        { part: 'NOT1', terminal: 'out' }, { part: 'AND2', terminal: 'in0' }] },
      { id: 'n_p', terminals: [
        { part: 'AND1', terminal: 'out' }, { part: 'OR1', terminal: 'in0' }] },
      { id: 'n_q', terminals: [
        { part: 'AND2', terminal: 'out' }, { part: 'OR1', terminal: 'in1' }] },
      { id: 'n_y', terminals: [{ part: 'OR1', terminal: 'out' }] },
      { id: 'n_gnd', terminals: [
        { part: 'G1', terminal: 'gnd' }, { part: 'SRC', terminal: 'neg' }] },
    ];
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.advanceTo(2_000_000n); // settle well past bring-up: A=1 ⇒ Y=1
    return board;
  }

  it('armed gates glitch low for exactly the path skew when A falls', () => {
    const board = hazardBench(true);
    assert.ok(board.nodeVoltage('n_y') > 2.5, 'settled: Y = 1 with A = 1');
    board.setControl('SRC', 0); // A falls at t0 = 2,000,000 ns
    const at = (dNs) => {
      board.advanceTo(BigInt(2_000_000 + dNs));
      return board.nodeVoltage('n_y') > 2.5;
    };
    assert.equal(at(80), true, 'before the OR reacts (t0+80) Y still 1');
    assert.equal(at(130), false, 'the glitch: Y low at t0+130 with BOTH legs low');
    assert.equal(at(180), false, 'still inside the window at t0+180');
    assert.equal(at(230), true, 'recovered at t0+230, tpd_OR after the Ā·C leg rose');
    // And it STAYS recovered — the glitch was the transient, not the answer.
    assert.equal(at(1000), true, 'steady after: Y = 1 with A = 0');
  });

  it('the same bench un-armed never dips — which is exactly the fixpoint blindness', () => {
    const board = hazardBench(false);
    assert.ok(board.nodeVoltage('n_y') > 2.5, 'settled: Y = 1');
    board.setControl('SRC', 0);
    let dipped = false;
    for (let d = 10; d <= 1000; d += 10) {
      board.advanceTo(BigInt(2_000_000 + d));
      if (board.nodeVoltage('n_y') < 2.5) dipped = true;
    }
    assert.equal(dipped, false,
      'the fixpoint holds Y at 1 through the transition — the hazard is invisible without tpd');
  });
});
