/**
 * A BIAS POINT AND AN INSTANT ARE DIFFERENT QUESTIONS.
 *
 * Outside a transient the solver has always had both answers for a capacitor:
 * with `capVoltages` it holds the stored voltage as a source row — which for an
 * UNCHARGED capacitor is 0 V, a SHORT between its two nets — and without it the
 * capacitor is an OPEN, which is what `.op` means by one.
 *
 * `BoardImpl._solveMNA` always passes `capVoltages`, and it is right to: an
 * instrument must see the circuit as it is at `timeNs`, and a half-charged
 * capacitor really does pin its nets at its stored voltage. The consequence was
 * that NO CALLER COULD ASK FOR THE OTHER ANSWER, and a bias point read off the
 * live solve reports every capacitor's two nets as equal — always, by
 * construction, with nothing in the result to say so.
 *
 * Measured consequence on a real corpus: an ADI2005 v3 two-stage
 * Miller-compensated op-amp whose 3 pF compensation capacitor pinned the
 * compensation node to the output gave a 5.09 V disagreement against ngspice at
 * the output. Over a 2,000-deck sample, asking the right question moved 1,579
 * agreeing decks to 1,612 — 93.6 % of the 1,723 decks ngspice can answer at all.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { NetlistBuilder } from '../src/builder.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

/**
 * The smallest circuit that separates the two questions: a 10 V divider of two
 * 1k resistors with a capacitor across the LOWER leg.
 *
 *   instant (t = 0, uncharged): the capacitor shorts the lower leg -> mid = 0 V
 *   bias point:                 the capacitor is open              -> mid = 5 V
 *
 * Five volts apart on four parts, so nothing subtle is required to tell them
 * apart and nothing subtle can hide a regression.
 */
function divider({ withCap = true } = {}) {
  const b = new NetlistBuilder()
    .vsource('V1', 10).gnd('GND')
    .resistor('R1', 1000).resistor('R2', 1000);
  if (withCap) b.capacitor('C1', 1e-6);
  b.wire('V1.neg', 'GND.gnd')
    .wire('V1.pos', 'R1.a')
    .wire('R1.b', 'R2.a')
    .wire('R2.b', 'GND.gnd');
  if (withCap) b.wire('C1.a', 'R1.b').wire('C1.b', 'GND.gnd');
  const { parts, nets } = b.build();
  const board = new BoardImpl(10);
  board.setNetlist(parts, nets);
  const mid = nets.find((n) =>
    n.terminals.some((t) => t.part === 'R2' && t.terminal === 'a')).id;
  return { board, mid };
}

describe('biasPointVoltages: the capacitor is an open', () => {
  it('reads 5 V at the midpoint where the live solve reads 0', () => {
    const { board, mid } = divider();
    const instant = board.nodeVoltage(mid);
    assert.ok(Math.abs(instant) < 1e-3,
      `the live solve must short the lower leg at t = 0; got ${instant} V`);
    const bp = board.biasPointVoltages();
    assert.equal(bp.converged, true);
    const bias = bp.nodeVoltages.get(mid);
    assert.ok(Math.abs(bias - 5) < 1e-6,
      `the bias point must open the capacitor; got ${bias} V`);
    // And they must actually differ, or this file proves nothing.
    assert.ok(Math.abs(bias - instant) > 4, `${bias} vs ${instant}`);
  });

  it('is NON-MUTATING: the live solve is unchanged afterwards', () => {
    // Load-bearing. Two callers reading one board in two different ways must
    // not be able to change what the other sees.
    const { board, mid } = divider();
    const before = board.nodeVoltage(mid);
    board.biasPointVoltages();
    board.biasPointVoltages();
    assert.equal(board.nodeVoltage(mid), before,
      'the cached live solve moved');
    assert.equal(board.capacitorVoltage
      ? board.capacitorVoltage('C1') : 0, 0, 'stored charge moved');
    assert.equal(board.timeNs, 0n, 'time advanced');
  });

  it('agrees with the live solve when there is no capacitor to disagree about', () => {
    const { board, mid } = divider({ withCap: false });
    const bp = board.biasPointVoltages();
    assert.ok(Math.abs(bp.nodeVoltages.get(mid) - 5) < 1e-6);
    assert.ok(Math.abs(board.nodeVoltage(mid) - 5) < 1e-6);
  });

  it('leaves an inductor a short, which is what .op does with one', () => {
    const { parts, nets } = new NetlistBuilder()
      .vsource('V1', 10).gnd('GND').resistor('R1', 1000).inductor('L1', 1e-3)
      .wire('V1.neg', 'GND.gnd').wire('V1.pos', 'R1.a')
      .wire('R1.b', 'L1.a').wire('L1.b', 'GND.gnd')
      .build();
    const board = new BoardImpl(10);
    board.setNetlist(parts, nets);
    const mid = nets.find((n) =>
      n.terminals.some((t) => t.part === 'L1' && t.terminal === 'a')).id;
    const bias = board.biasPointVoltages().nodeVoltages.get(mid);
    // 1 mOhm of wire against 1k: the midpoint sits at ~10 uV, not 5 V.
    assert.ok(Math.abs(bias) < 1e-3,
      `an inductor is a short at DC, so the midpoint is at the rail's bottom; got ${bias} V`);
  });

  it('reports convergence rather than leaving a caller to assume it', () => {
    const { board } = divider();
    const bp = board.biasPointVoltages();
    assert.equal(typeof bp.converged, 'boolean');
    assert.ok(bp.nodeVoltages instanceof Map);
  });

  it('a capacitor across the WHOLE divider is also open, not a rail short', () => {
    // Guard every reach: the first bench puts the capacitor on one leg. A
    // capacitor from the top of the divider to ground would, if shorted, pull
    // the SOURCE down instead of the midpoint — a different consequence from
    // the same defect.
    const { parts, nets } = new NetlistBuilder()
      .vsource('V1', 10).gnd('GND').resistor('R1', 1000).resistor('R2', 1000)
      .capacitor('C1', 1e-6)
      .wire('V1.neg', 'GND.gnd').wire('V1.pos', 'R1.a')
      .wire('R1.b', 'R2.a').wire('R2.b', 'GND.gnd')
      .wire('C1.a', 'V1.pos').wire('C1.b', 'GND.gnd')
      .build();
    const board = new BoardImpl(10);
    board.setNetlist(parts, nets);
    const top = nets.find((n) =>
      n.terminals.some((t) => t.part === 'R1' && t.terminal === 'a')).id;
    const bias = board.biasPointVoltages().nodeVoltages.get(top);
    assert.ok(Math.abs(bias - 10) < 1e-6,
      `the top of the divider must stay at the rail; got ${bias} V`);
  });
});
