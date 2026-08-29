/**
 * Op-amp output limiting — hand oracles per
 * spec-updates/opamp-output-limit.md (defect D20).
 *
 * The defect: rails bound the op-amp's output VOLTAGE and nothing bounded
 * its output CURRENT, so a unity-gain follower held 2.499998 V into a 1 Ω
 * load — 2.5 amps out of an 8-pin DIP — and `signals-loading` asked the
 * learner to find an output-limit regime that did not exist.
 *
 * Every number below is arithmetic on the declared parameters:
 * iShort = 0.040 A (the LM358/TL07x-class datasheet figure, now the
 * default), so below R = 2.5 V / 0.040 A = 62.5 Ω the follower delivers
 * 0.040·R and above it holds 2.5 V.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

const GND = { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] };
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });

/** Unity-gain follower from a 2.5 V source into `rl`. */
function follower(rl, params = {}) {
  const board = new BoardImpl(5.0);
  board.setNetlist([GND,
    { id: 'FG', kind: 'vsource', params: { volts: 2.5 }, terminals: ['pos', 'neg'] },
    { id: 'U1', kind: 'opamp', params, terminals: ['inp', 'inn', 'out'] },
    R('RL', rl)], [
    net('n_in', ['FG', 'pos'], ['U1', 'inp']),
    net('n_out', ['U1', 'out'], ['U1', 'inn'], ['RL', 'a']),
    net('n_gnd', ['G1', 'gnd'], ['FG', 'neg'], ['RL', 'b']),
  ]);
  return board;
}

/** Open loop: inn on ground, so the output resistance is not divided by
 *  the loop gain. `gain: 1` keeps the ideal output inside the rails. */
function openLoop(rl, params) {
  const board = new BoardImpl(5.0);
  board.setNetlist([GND,
    { id: 'FG', kind: 'vsource', params: { volts: 2.5 }, terminals: ['pos', 'neg'] },
    { id: 'U1', kind: 'opamp', params, terminals: ['inp', 'inn', 'out'] },
    R('RL', rl)], [
    net('n_in', ['FG', 'pos'], ['U1', 'inp']),
    net('n_out', ['U1', 'out'], ['RL', 'a']),
    net('n_gnd', ['G1', 'gnd'], ['FG', 'neg'], ['RL', 'b'], ['U1', 'inn']),
  ]);
  return board;
}

describe('op-amp output current limit (D20)', () => {
  it('the follower droops into 1 Ω instead of sourcing 2.5 A', () => {
    const board = follower(1);
    const v = board.nodeVoltage('n_out');
    // 0.040 A × 1 Ω. Before this landed: 2.499998 V and 2.499998 A.
    assert.ok(Math.abs(v - 0.040) < 1e-9, `0.040 V into 1 Ω, got ${v}`);
    assert.ok(Math.abs(v / 1 - 0.040) < 1e-9, `40 mA, got ${v / 1} A`);
    // The branch variable is positive INTO the pin, so sourcing is negative.
    assert.ok(Math.abs(board.branchCurrent('U1', 'out') + 0.040) < 1e-9);
  });

  it('below 62.5 Ω the output is iShort·R; above it, the divider answer', () => {
    // 2.5 V / 0.040 A = 62.5 Ω is where the two regimes meet, and both
    // sides of it are arithmetic rather than a recorded number.
    for (const [rl, expected] of [[1, 0.040], [10, 0.400], [25, 1.000], [50, 2.000]]) {
      const v = follower(rl).nodeVoltage('n_out');
      assert.ok(Math.abs(v - expected) < 1e-9,
        `${rl} Ω → 0.040 × ${rl} = ${expected} V, got ${v}`);
    }
    for (const rl of [62.5, 63, 100, 1000, 10000]) {
      const v = follower(rl).nodeVoltage('n_out');
      assert.ok(Math.abs(v - 2.5) < 1e-5, `${rl} Ω → the follower still holds 2.5 V, got ${v}`);
      assert.ok(v / rl <= 0.040 + 1e-9, `and never more than 40 mA: ${v / rl} A`);
    }
  });

  it('it limits SINKING current at the same 40 mA', () => {
    // Follower commanded to 0 V, output tied to a 5 V rail through 10 Ω.
    // Unlimited it would sink 500 mA; limited it sinks 40 mA, so the node
    // sits at 5 − 0.040 × 10 = 4.600 V.
    const board = new BoardImpl(5.0);
    board.setNetlist([GND,
      { id: 'FG', kind: 'vsource', params: { volts: 0 }, terminals: ['pos', 'neg'] },
      { id: 'V5', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
      { id: 'U1', kind: 'opamp', params: {}, terminals: ['inp', 'inn', 'out'] },
      R('RP', 10)], [
      net('n_in', ['FG', 'pos'], ['U1', 'inp']),
      net('n_out', ['U1', 'out'], ['U1', 'inn'], ['RP', 'b']),
      net('n5', ['V5', 'pos'], ['RP', 'a']),
      net('n_gnd', ['G1', 'gnd'], ['FG', 'neg'], ['V5', 'neg']),
    ]);
    assert.ok(Math.abs(board.nodeVoltage('n_out') - 4.600) < 1e-9,
      `5 − 0.040×10 = 4.600 V, got ${board.nodeVoltage('n_out')}`);
    assert.ok(Math.abs(board.branchCurrent('U1', 'out') - 0.040) < 1e-9,
      'sinking is the POSITIVE branch direction');
  });

  it('the rails still clamp, and a light load never enters the limit', () => {
    // Open loop, +1 V differential: railHigh (= vcc) as before D20.
    const board = openLoop(10000, {});
    assert.ok(Math.abs(board.nodeVoltage('n_out') - 5.0) < 1e-6,
      `railHigh, got ${board.nodeVoltage('n_out')}`);
  });

  it('iShort: 0 restores the unlimited ideal source, exactly', () => {
    const v = follower(1, { iShort: 0 }).nodeVoltage('n_out');
    assert.ok(Math.abs(v - 2.4999975000025003) < 1e-12,
      `the pre-D20 answer, bit for bit; got ${v}`);
  });
});

describe('op-amp finite output resistance (D20)', () => {
  it('rout divides against the load — measured OPEN loop', () => {
    // A follower hides its own rout behind the loop gain; open loop it is
    // a plain divider: 2.5 × RL/(RL + 100).
    const at900 = openLoop(900, { gain: 1, rout: 100, railHigh: 10, iShort: 0 });
    assert.ok(Math.abs(at900.nodeVoltage('n_out') - 2.250) < 1e-9,
      `2.5 × 900/1000 = 2.250 V, got ${at900.nodeVoltage('n_out')}`);
    const at100 = openLoop(100, { gain: 1, rout: 100, railHigh: 10, iShort: 0 });
    assert.ok(Math.abs(at100.nodeVoltage('n_out') - 1.250) < 1e-9,
      `2.5 × 100/200 = 1.250 V, got ${at100.nodeVoltage('n_out')}`);
    // Without rout the same bench is the ideal source it always was.
    const ideal = openLoop(900, { gain: 1, railHigh: 10, iShort: 0 });
    assert.equal(ideal.nodeVoltage('n_out'), 2.5);
  });

  it('a follower divides its own rout by the loop gain, so it barely moves', () => {
    // 100 Ω of output resistance inside a ×1e6 loop: the closed-loop
    // output impedance is rout/(1 + A) ≈ 100 µΩ. THAT is why oracle 5
    // has to be measured open loop.
    const v = follower(900, { rout: 100, iShort: 0 }).nodeVoltage('n_out');
    assert.ok(Math.abs(v - 2.5) < 1e-5, `still 2.5 V, got ${v}`);
  });
});

describe('op-amp output limiting stays deterministic', () => {
  it('two identical current-limited solves agree bit-for-bit', () => {
    assert.equal(follower(1).nodeVoltage('n_out'), follower(1).nodeVoltage('n_out'));
    assert.equal(follower(50).nodeVoltage('n_out'), follower(50).nodeVoltage('n_out'));
  });

  it('a load swept down and back up settles on the same answers', () => {
    // The FSM must not latch: the same board re-solved at 1 kΩ after a
    // 1 Ω excursion has to give the 1 kΩ answer, not a remembered limit.
    const board = follower(1000);
    const before = board.nodeVoltage('n_out');
    board.setPartParam('RL', 'ohms', 1);
    assert.ok(Math.abs(board.nodeVoltage('n_out') - 0.040) < 1e-9,
      `1 Ω → 0.040 V, got ${board.nodeVoltage('n_out')}`);
    board.setPartParam('RL', 'ohms', 1000);
    assert.equal(board.nodeVoltage('n_out'), before);
  });
});

describe('rout in the AC small-signal stamp', () => {
  it('the AC row carries rout too, so the parameter does not lie', () => {
    // src/ac.js builds its own small-signal stamps. A parameter the DC row
    // honours and the AC row drops is the two-truths shape this engine keeps
    // paying for, so the AC op-amp/vcvs rows carry rout as well.
    //
    // Open loop, gain 1, rout 100 Ω into 900 Ω: |H| = 900/1000 = 0.900.
    const bench = (rout) => {
      const board = new BoardImpl(5.0);
      board.setNetlist([GND,
        { id: 'FG', kind: 'vsource', params: { volts: 2.5 }, terminals: ['pos', 'neg'] },
        { id: 'U1', kind: 'opamp', params: { gain: 1, rout, railHigh: 10, iShort: 0 },
          terminals: ['inp', 'inn', 'out'] },
        R('RL', 900)], [
        net('n_in', ['FG', 'pos'], ['U1', 'inp']),
        net('n_out', ['U1', 'out'], ['RL', 'a']),
        net('n_gnd', ['G1', 'gnd'], ['FG', 'neg'], ['RL', 'b'], ['U1', 'inn']),
      ]);
      const rows = board.runAc({ sourceId: 'FG', from: 1e3, to: 1e4, pointsPerDecade: 1, probes: ['n_out'] });
      return rows[0].results.get('n_out').mag;
    };
    assert.ok(Math.abs(bench(0) - 1) < 1e-9, `rout 0 is the ideal source: ${bench(0)}`);
    assert.ok(Math.abs(bench(100) - 0.9) < 1e-9, `900/1000 = 0.900, got ${bench(100)}`);
  });
});
