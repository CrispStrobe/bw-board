/**
 * GMIN GOES ACROSS THE JUNCTIONS, NOT ON THE NODES.
 *
 * ngspice places a 1e-12 S conductance in parallel with every pn junction and
 * NOTHING on a node diagonal. This engine did the opposite: a blanket shunt
 * from every node to the reference, and on the junctions only a FLOOR under the
 * conductance, which looks like the same term and is not.
 *
 * Both halves were measured against ngspice on decks written for this file:
 *
 *   1 TOhm divider, far node floating     engine 2.500000 V   ngspice 5.000000 V
 *   the same with one reverse diode       engine 4.989999 V   ngspice 2.495000 V
 *   BJT base behind a coupling capacitor  engine 0.009954 V   ngspice 0.276875 V
 *
 * WHY EACH NUMBER IS WHAT IT IS, because a tolerance on a wrong model passes
 * for the wrong reason:
 *
 *  - 2.500000 V is 1e-12 S of node shunt dividing against 1e-12 S of resistor.
 *    A perfect half, manufactured out of a term ngspice does not have.
 *  - 4.989999 V is what a FLOORED conductance gives. The Newton stamp
 *    `g = 1e-12, Ieq = i(V0) - g*V0` makes the branch carry exactly `i(V0)` at
 *    convergence, so a reverse junction becomes a pure 1e-14 A current source
 *    with no conductance at all -- and 1e-14 A through 1 TOhm is 0.01 V.
 *  - 2.495000 V is (5e-12 - 1e-14)/2e-12, which only solves if the junction
 *    carries the GMIN conductance AND its saturation current together. That is
 *    the arithmetic that says the missing piece was the `GMIN*V` term in the
 *    junction CURRENT.
 *  - 0.276875 V needed a second correction. The floor sat on `gF`, which
 *    reaches the base only as `gF / BF`, so at BF = 100 the base's tie to the
 *    emitter was a hundredth of ngspice's GMIN. ngspice adds GMIN to the
 *    base-emitter and base-collector junction currents themselves, at full
 *    strength on each.
 *
 * The blanket node shunt still runs during the Newton iterations, because it is
 * also the continuation that makes a hard operating point converge -- lowering
 * it globally was measured and is worse (1,612 -> 1,559 agreeing ADI decks,
 * convergence failures doubled). It is removed in a REFINEMENT pass afterwards,
 * on nodes that have anything else on them at all.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { NetlistBuilder } from '../src/builder.js';
import { JUNCTION_GMIN, mosBulkJunction, JUNCTION_THERMAL_VOLTAGE, ebersMollCompanion }
  from '../src/mna.js';

const shockley = { model: 'shockley', is: 1e-14, n: 1, rs: 0 };

/**
 * The BIAS POINT at the terminal named -- capacitors open, inductors short.
 *
 * `nodeVoltage()` would be the wrong instrument and wrong in a way that looks
 * like an engine defect: it is the live solve at t = 0, where an uncharged
 * capacitor pins its two nets EQUAL. Asking it for the base below returns
 * 1.099905 V, because the coupling capacitor is a short at that instant, and
 * the case is about where the base sits when it is an OPEN.
 */
function solve(parts, nets, part, terminal) {
  const board = new BoardImpl(15);
  board.setNetlist(parts, nets);
  const net = nets.find((n) => n.terminals.some((t) => t.part === part && t.terminal === terminal));
  const { converged, nodeVoltages } = board.biasPointVoltages();
  assert.ok(converged, 'the bias point must converge, or the number below is an iterate');
  return nodeVoltages.get(net.id);
}

describe('the junction carries GMIN; the node does not', () => {
  it('a 1 TOhm divider with nothing at its far end sits at the supply, not at half', () => {
    const { parts, nets } = new NetlistBuilder()
      .vsource('V1', 5).gnd('GND').resistor('R1', 1e12)
      .wire('V1.neg', 'GND.gnd').wire('V1.pos', 'R1.a')
      .build();
    // The far end is wired to NOTHING, and the builder gives an unwired
    // terminal no net -- so the node this case is about has to be declared
    // here. That is the deck `R1 a b 1T` verbatim: `b` exists, and only R1 is
    // on it.
    nets.push({ id: 'net_dangling_b', terminals: [{ part: 'R1', terminal: 'b' }] });
    const v = solve(parts, nets, 'R1', 'b');
    // ngspice: 5.000000 V. A node shunt of 1e-12 S against R's 1e-12 S gave
    // exactly half, which is the defect at its maximum amplitude.
    assert.ok(Math.abs(v - 5) < 1e-4, `V(b) ${v} V, ngspice 5.000000 V`);
  });

  it('one reverse junction behind that resistor puts it at 2.495 V', () => {
    const { parts, nets } = new NetlistBuilder()
      .vsource('V1', 5).gnd('GND').resistor('R1', 1e12).diode('D1')
      .wire('V1.neg', 'GND.gnd').wire('V1.pos', 'R1.a')
      .wire('R1.b', 'D1.cathode').wire('D1.anode', 'GND.gnd')
      .build();
    Object.assign(parts.find((p) => p.id === 'D1').params, shockley);
    const v = solve(parts, nets, 'R1', 'b');
    // (5e-12 - 1e-14)/2e-12 = 2.495. Both terms of the junction are needed:
    // conductance alone gives 2.5, the saturation current alone gives 4.99.
    assert.ok(Math.abs(v - 2.495) < 2e-3, `V(b) ${v} V, ngspice 2.495000 V`);
  });

  it("a BJT's base behind a coupling capacitor sits where its junctions put it", () => {
    const { parts, nets } = new NetlistBuilder()
      .vsource('V1', 5).gnd('GND').resistor('R1', 10000)
      .capacitor('C1', 1e-6).npn('Q1')
      .wire('V1.neg', 'GND.gnd').wire('V1.pos', 'R1.a').wire('V1.pos', 'C1.a')
      .wire('R1.b', 'Q1.collector').wire('C1.b', 'Q1.base').wire('Q1.emitter', 'GND.gnd')
      .build();
    // REPLACED, not merged: the builder seeds `vbe: 0.7` for the piecewise
    // BJT, and a leftover `vbe` beside explicit Shockley fields selects a
    // different device. `vf means two things` is the same trap on a diode.
    const q1 = parts.find((p) => p.id === 'Q1');
    q1.params = { model: 'shockley', is: 1e-14, beta: 100, br: 1, n: 1 };
    const v = solve(parts, nets, 'Q1', 'base');
    // The capacitor is open at an operating point, so the base is held only by
    // its own two junctions -- which is exactly the case a node shunt steals.
    assert.ok(Math.abs(v - 0.276875) < 5e-3, `V(base) ${v} V, ngspice 0.276875 V`);
  });

  it('leaves an ordinary divider exactly where it was', () => {
    const { parts, nets } = new NetlistBuilder()
      .vsource('V1', 5).gnd('GND').resistor('R1', 1000).resistor('R2', 3000)
      .wire('V1.neg', 'GND.gnd').wire('V1.pos', 'R1.a')
      .wire('R1.b', 'R2.a').wire('R2.b', 'GND.gnd')
      .build();
    const v = solve(parts, nets, 'R1', 'b');
    // 5 * 3k/4k. At these impedances GMIN is 1e-12 against 2.5e-4 S, so the
    // CONTROL is that none of this is detectable where it should not be.
    assert.ok(Math.abs(v - 3.75) < 1e-9, `V(mid) ${v} V, expected exactly 3.75 V`);
  });

  it('is one constant, and the junction current carries it as well as the slope', () => {
    assert.equal(JUNCTION_GMIN, 1e-12);
    // Through the MOS bulk junction, which shares `shockleyEval`: at reverse
    // bias the current is -IS + GMIN*V, and the GMIN term dominates by three
    // orders at 15 V. Asserting the SUM rather than either part is what
    // separates this contract from the floored one.
    const current = (v) => { const { gEq, iEq } = mosBulkJunction(v, {}); return iEq + gEq * v; };
    for (const v of [-1, -5, -15]) {
      const expected = -1e-14 + JUNCTION_GMIN * v;
      assert.ok(Math.abs(current(v) - expected) < Math.abs(expected) * 1e-9,
        `reverse ${v} V: ${current(v)} A, expected ${expected} A`);
    }
    // Forward bias is untouched: 1e-12 * 0.7 V is 7e-13 A against milliamps.
    const v = 0.639395;
    const diffusion = 1e-14 * (Math.exp(v / JUNCTION_THERMAL_VOLTAGE) - 1);
    assert.ok(Math.abs(current(v) / diffusion - 1) < 1e-8,
      `forward ${v} V: ${current(v)} A vs diffusion ${diffusion} A`);
  });

  /**
   * THE REFINEMENT IS TWO STEPS, AND THE SECOND ONE IS CONDITIONAL.
   *
   * Step one re-solves the final assembly with the shunt subtracted -- exact
   * for a linear network, one Newton step for an exponential. Step two
   * re-converges the junctions with the shunt absent and the region FSMs
   * frozen, and it runs ONLY where step one moved the answer by more than
   * 1e-6 V.
   *
   * That condition is derived, not a device list, and both halves of it have a
   * witness here:
   *
   *   a node HELD BY the shunt      step one moves it by volts, so step two
   *                                 runs: 4.867521 -> 5.000000 V against
   *                                 ngspice's 4.999380 V
   *   an ordinary-impedance node    step one moves it by ~1e-11 V, step two is
   *                                 skipped, and the answer is bit-identical
   *
   * The second witness is why the condition exists at all: iterating
   * unconditionally moves the piecewise BJT bench 0.067245 -> 0.195212 V even
   * with the regions frozen, because that bench is not uniquely converged and
   * any second trajectory lands somewhere else. `test/bjt-ebers-moll.test.mjs`
   * holds that number; this test holds the case that needs the iteration, so
   * the two together pin the threshold from both sides.
   */
  it('re-converges a node the shunt was holding, and leaves an ordinary one alone', () => {
    // HELD BY THE SHUNT: a diode-connected MOSFET whose gate-drain node hangs
    // on its bulk junction and nothing else. One linear step reached 4.867521 V
    // and is 132 mV short; the iteration closes it to the reference's 0.62 mV
    // junction drop.
    const { parts, nets } = new NetlistBuilder()
      .vsource('VS', 5).gnd('GND').nmos('M1', 1.0, 1e-3)
      .wire('VS.neg', 'GND.gnd').wire('VS.pos', 'M1.source')
      .wire('M1.gate', 'M1.drain')
      .build();
    const board = new BoardImpl(5);
    board.setNetlist(parts, nets);
    const held = nets.find((n) => n.terminals?.some((t) => t.part === 'M1' && t.terminal === 'gate'));
    const v = board.nodeVoltage(held.id);
    assert.ok(Math.abs(v - 4.999380) < 5e-3,
      `a node held only by its bulk junction must reach the bulk rail: ngspice `
      + `4.999380 V, got ${v} V (one linear step alone gives 4.867521)`);

    // ORDINARY IMPEDANCES: the divider below is 1k/3k, where GMIN is eleven
    // orders down. Step one cannot move it, step two must not run, and the
    // answer must be EXACT -- a tolerance here would hide the iteration firing
    // where it has no business.
    const d = new NetlistBuilder()
      .vsource('V1', 5).gnd('GND').resistor('R1', 1000).resistor('R2', 3000)
      .wire('V1.neg', 'GND.gnd').wire('V1.pos', 'R1.a')
      .wire('R1.b', 'R2.a').wire('R2.b', 'GND.gnd')
      .build();
    const b2 = new BoardImpl(5);
    b2.setNetlist(d.parts, d.nets);
    const mid = d.nets.find((n) => n.terminals.some((t) => t.part === 'R1' && t.terminal === 'b'));
    assert.equal(b2.nodeVoltage(mid.id), 3.75,
      'an ordinary divider must be exactly 5 * 3k/4k, with no iteration anywhere near it');
  });

  /**
   * THE BJT'S JACOBIAN, HELD AS A DERIVATIVE AND NOT AS A VOLTAGE.
   *
   * Writing this test taught me something I had asserted without holding: the
   * BJT's junction GMIN can be divided by BF -- the exact defect the code
   * comment describes -- and not one node voltage in this file moves. It
   * cannot, because a converged Newton solution satisfies `i(V) = 0` at the
   * node and does not depend on the Jacobian that got it there.
   *
   * So the claim is tested where it lives. Each companion conductance must be
   * the derivative of the companion current it belongs to, by finite
   * difference. `d ib / d vbe` includes GMIN UNDIVIDED, because
   * `d(GMIN*vbe)/d vbe` is GMIN; dividing it by BF makes the Jacobian
   * inconsistent with the current, which costs convergence rather than
   * correctness -- invisible in an answer, and still wrong.
   */
  it("each companion conductance is the derivative of its own current", () => {
    const p = { is: 1e-14, bf: 100, br: 2, nVt: JUNCTION_THERMAL_VOLTAGE };
    // The step is 1e-3 and not smaller: `ib` is ~3e-12 here, so a 1e-6 step
    // differences two numbers that agree to 6 significant figures and the
    // quotient is mostly rounding. The tolerance below absorbs the curvature
    // that a step this size costs on the exponential terms.
    const h = 1e-3;
    for (const [vbe, vbc] of [[0.65, -4], [0.7, -0.2], [-2, -5], [0.75, 0.5]]) {
      const at = ebersMollCompanion(vbe, vbc, p);
      const dIbDvbe = (ebersMollCompanion(vbe + h, vbc, p).ib - ebersMollCompanion(vbe - h, vbc, p).ib) / (2 * h);
      const dIbDvbc = (ebersMollCompanion(vbe, vbc + h, p).ib - ebersMollCompanion(vbe, vbc - h, p).ib) / (2 * h);
      const dIcDvbe = (ebersMollCompanion(vbe + h, vbc, p).ic - ebersMollCompanion(vbe - h, vbc, p).ic) / (2 * h);
      const dIcDvbc = (ebersMollCompanion(vbe, vbc + h, p).ic - ebersMollCompanion(vbe, vbc - h, p).ic) / (2 * h);
      const close = (got, want, name) => {
        const scale = Math.max(Math.abs(want), JUNCTION_GMIN);
        assert.ok(Math.abs(got - want) <= scale * 2e-3,
          `at vbe=${vbe} vbc=${vbc}: ${name} ${got} vs finite difference ${want}`);
      };
      close(at.gpi, dIbDvbe, 'gpi');
      close(at.gmu, dIbDvbc, 'gmu');
      close(at.gcF, dIcDvbe, 'gcF');
      close(at.gcR, dIcDvbc, 'gcR');
    }
    // And the term is there at all: deep reverse on both junctions leaves the
    // junction conductances at GMIN exactly, not at zero and not at GMIN/BF.
    const off = ebersMollCompanion(-5, -5, p);
    assert.ok(Math.abs(off.gpi - JUNCTION_GMIN) < JUNCTION_GMIN * 1e-6, `gpi ${off.gpi}`);
    assert.ok(Math.abs(off.gmu - JUNCTION_GMIN) < JUNCTION_GMIN * 1e-6, `gmu ${off.gmu}`);
  });
});
