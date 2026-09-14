/**
 * THE FOURTH TERMINAL'S TWO DIODES.
 *
 * A SPICE MOSFET has four terminals and the bulk carries a pn junction to the
 * source and another to the drain. This engine's nmos/pmos have three, so those
 * junctions had no representation — and they turned out to be the single
 * largest remaining cause of numeric disagreement against ngspice, worth more
 * than the body effect that uncovered them.
 *
 * HOW THE CAUSE WAS IDENTIFIED, because a wrong voltage on its own accuses
 * nothing in particular. The corpus deck below (ADI2005 v3 row 36, an NMOS diff
 * pair with a PMOS active load) was run three ways through ngspice 44:
 *
 *   bulk at node 0, as the deck writes it     TAIL = -0.639395 V
 *   bulk moved to VSS                         TAIL = -1.667870 V
 *   bulk at 0 but IS crushed to 1e-30         TAIL = -1.559280 V
 *
 * Our three-terminal answer was -1.673589 V — within 6 mV of the bulk-at-VSS
 * deck. So the channel model was ALREADY RIGHT and the entire 1.03 V error was
 * one missing diode. Then the arithmetic closed it: the source sits 0.639395 V
 * below a grounded bulk, so each device's bulk-source junction carries
 * 1e-14*(e^(0.639395/0.02585) - 1) = 0.5523 mA; two devices give 1.1046 mA; and
 * the tail resistor demands (TAIL - VSS)/13k = 1.10466 mA. Agreement to 0.02 %.
 *
 * The three decks are kept here as three separate assertions BECAUSE they
 * separate: a change that got the junction wrong in either direction moves at
 * least one of them by a volt.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { NetlistBuilder } from '../src/builder.js';
import { mosBulkJunction, JUNCTION_THERMAL_VOLTAGE, mosVth } from '../src/mna.js';

const current = (v, params) => {
  const { gEq, iEq } = mosBulkJunction(v, params);
  return iEq + gEq * v;
};

describe('mosBulkJunction: SPICE defaults, and the arithmetic that identified it', () => {
  it('carries 0.5523 mA at 0.639395 V forward — the number that closed the case', () => {
    // Hand-derived, not copied: IS*(exp(V/Vt) - 1) with SPICE's default IS.
    const v = 0.639395;
    const expected = 1e-14 * (Math.exp(v / JUNCTION_THERMAL_VOLTAGE) - 1);
    assert.ok(Math.abs(current(v) / expected - 1) < 1e-9,
      `${current(v)} vs ${expected}`);
    // And it is the current the tail resistor demands, which is the whole point.
    const demanded = (v - 15) / -13000 / 2;   // (TAIL - VSS)/13k shared by two
    assert.ok(Math.abs(current(v) / demanded - 1) < 5e-3,
      `junction ${current(v)} A vs tail resistor's ${demanded} A per device`);
  });

  it('defaults to SPICE IS = 1e-14 A and ideality 1', () => {
    assert.ok(Math.abs(current(0) ) < 1e-20, 'no current at zero bias');
    for (const v of [0.3, 0.5, 0.7]) {
      const expected = 1e-14 * (Math.exp(v / JUNCTION_THERMAL_VOLTAGE) - 1);
      assert.ok(Math.abs(current(v) / expected - 1) < 1e-9, `at ${v} V`);
    }
  });

  it('returns -IS under reverse bias, not zero and not a runaway', () => {
    for (const v of [-1, -5, -15]) {
      assert.ok(Math.abs(current(v) + 1e-14) < 1e-16,
        `reverse ${v} V should draw -IS, got ${current(v)}`);
    }
  });

  it('honours a model-supplied IS', () => {
    const v = 0.639395;
    assert.ok(current(v, { bulkIs: 1e-30 }) < current(v) * 1e-12,
      'IS = 1e-30 must all but extinguish it');
    assert.ok(current(v, { bulkIs: 1e-12 }) > current(v) * 50,
      'IS = 1e-12 must be two orders stronger');
  });

  it('ignores a nonsensical IS rather than producing a nonsensical current', () => {
    const v = 0.5;
    for (const bad of [0, -1e-14, NaN, Infinity, undefined, null, 'big']) {
      const i = current(v, { bulkIs: bad });
      assert.ok(Number.isFinite(i) && i > 0, `bulkIs ${String(bad)} gave ${i}`);
      assert.ok(Math.abs(i / current(v) - 1) < 1e-12,
        `bulkIs ${String(bad)} must fall back to the default`);
    }
  });
});

/**
 * ADI2005 v3 row 36, transcribed:
 *
 *   M1 OUTP INP TAIL 0 NMOS   M2 OUT INN TAIL 0 NMOS
 *   M3 OUTP OUTP VDD VDD PMOS M4 OUT OUTP VDD VDD PMOS
 *   RSS TAIL VSS 13k
 *   .MODEL NMOS NMOS (LEVEL=1 VTO=1 KP=1.0e-4 LAMBDA=0.01)
 *   .MODEL PMOS PMOS (LEVEL=1 VTO=-1 KP=5.0e-5 LAMBDA=0.01)
 *
 * k = KP/2 * W/L: NMOS 1e-4/2 * 20 = 1e-3, PMOS 5e-5/2 * 40 = 1e-3.
 */
function diffPair({ bulkAtGround, bulkIs }) {
  const { parts, nets } = new NetlistBuilder()
    .vsource('VDD', 15)
    .vsource('VSS', -15)
    .gnd('GND')
    .nmos('M1', 1.0, 1e-3)
    .nmos('M2', 1.0, 1e-3)
    .pmos('M3', -1.0, 1e-3)
    .pmos('M4', -1.0, 1e-3)
    .resistor('RSS', 13000)
    .wire('VDD.neg', 'GND.gnd')
    .wire('VSS.neg', 'GND.gnd')
    .wire('M1.gate', 'GND.gnd')          // INP = 0
    .wire('M2.gate', 'GND.gnd')          // INN = 0
    .wire('M1.source', 'M2.source')
    .wire('M1.source', 'RSS.a')
    .wire('RSS.b', 'VSS.pos')
    .wire('M1.drain', 'M3.drain')
    .wire('M3.gate', 'M3.drain')
    .wire('M4.gate', 'M3.drain')
    .wire('M2.drain', 'M4.drain')
    .wire('M3.source', 'VDD.pos')
    .wire('M4.source', 'VDD.pos')
    .build();
  for (const id of ['M1', 'M2']) {
    const m = parts.find((p) => p.id === id);
    m.params.lambda = 0.01;
    if (bulkAtGround) m.params.bulkAtGround = true;
    if (bulkIs !== undefined) m.params.bulkIs = bulkIs;
  }
  for (const id of ['M3', 'M4']) parts.find((p) => p.id === id).params.lambda = 0.01;
  const board = new BoardImpl(15);
  board.setNetlist(parts, nets);
  const tailNet = nets.find((n) =>
    n.terminals.some((t) => t.part === 'RSS' && t.terminal === 'a'));
  const outpNet = nets.find((n) =>
    n.terminals.some((t) => t.part === 'M3' && t.terminal === 'gate'));
  return { board, nets, tail: board.nodeVoltage(tailNet.id),
    outp: board.nodeVoltage(outpNet.id), tailNet };
}

describe('the diff pair, three ways, against ngspice', () => {
  it('bulk at ground: TAIL = -0.639395 V, which needs the junction', () => {
    const { tail } = diffPair({ bulkAtGround: true });
    assert.ok(Math.abs(tail - (-0.639395)) < 5e-3,
      `TAIL ${tail} V, ngspice -0.639395 V`);
  });

  it('bulk NOT at ground: TAIL = -1.667870 V, the three-terminal answer', () => {
    const { tail } = diffPair({ bulkAtGround: false });
    assert.ok(Math.abs(tail - (-1.667870)) < 1e-2,
      `TAIL ${tail} V, ngspice -1.667870 V`);
  });

  it('bulk at ground with IS = 1e-30: TAIL = -1.559280 V', () => {
    const { tail } = diffPair({ bulkAtGround: true, bulkIs: 1e-30 });
    assert.ok(Math.abs(tail - (-1.559280)) < 2e-2,
      `TAIL ${tail} V, ngspice -1.559280 V`);
  });

  it('the three decks SEPARATE by a volt, so they can tell the models apart', () => {
    const a = diffPair({ bulkAtGround: true }).tail;
    const b = diffPair({ bulkAtGround: false }).tail;
    const c = diffPair({ bulkAtGround: true, bulkIs: 1e-30 }).tail;
    assert.ok(Math.abs(a - b) > 0.9, `bulk-at-ground vs not: ${a} vs ${b}`);
    assert.ok(Math.abs(a - c) > 0.8, `default IS vs 1e-30: ${a} vs ${c}`);
  });
});

describe('the junction current is visible to a meter', () => {
  it("net KCL holds at the tail: the source lead reports the junction current", () => {
    const { board, tail, tailNet } = diffPair({ bulkAtGround: true });
    let sum = 0;
    for (const t of tailNet.terminals) sum += board.branchCurrent(t.part, t.terminal);
    assert.ok(Math.abs(sum) < 1e-6,
      `KCL at the tail net: ${(sum * 1e3).toFixed(6)} mA (TAIL ${tail} V)`);
  });

  it('the source lead carries roughly the whole tail current, not the channel', () => {
    // The channel is CUT OFF here — Vgs = 0.639 against a 1 V threshold — so
    // essentially all of the 1.1 mA is junction current. A reader that reported
    // only the channel would say ~0.
    const { board } = diffPair({ bulkAtGround: true });
    const iSource = board.branchCurrent('M1', 'source');
    assert.ok(Math.abs(iSource) > 4e-4,
      `M1.source should carry about 0.55 mA, got ${(iSource * 1e3).toFixed(4)} mA`);
  });

  it('the four readings conserve, even though the three terminals cannot', () => {
    const { board } = diffPair({ bulkAtGround: true });
    const leads = ['drain', 'gate', 'source'].map((t) => board.branchCurrent('M1', t));
    const three = leads.reduce((a, b) => a + b, 0);
    const bulk = board.branchCurrent('M1', 'bulk');
    assert.ok(Number.isFinite(bulk) && Math.abs(bulk) > 1e-6,
      `the bulk current must be reported, got ${bulk}`);
    assert.ok(Math.abs(three + bulk) < 1e-6,
      `drain+gate+source (${three}) plus bulk (${bulk}) must conserve`);
    assert.ok(Math.abs(three) > 1e-6,
      'and the three leads alone must NOT conserve — that is the honest part');
  });
});

describe('a part with no bulk wiring declared is untouched', () => {
  it('reports no bulk current and no junction at all', () => {
    const { board } = diffPair({ bulkAtGround: false });
    const bulk = board.branchCurrent('M1', 'bulk');
    assert.ok(!bulk, `no bulk reading without bulkAtGround, got ${bulk}`);
    const three = ['drain', 'gate', 'source']
      .map((t) => board.branchCurrent('M1', t)).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(three) < 1e-6,
      `and then the three terminals DO conserve: ${three}`);
  });
});

/**
 * THE BULK-DRAIN JUNCTION ON ITS OWN.
 *
 * The diff pair above exercises the bulk-SOURCE junction; its drains sit at
 * +14 V, so the drain junction is reverse biased and contributes -1e-14 A.
 * Deleting the drain junction entirely therefore left every assertion above
 * green — a mutation that failed to break, which is a check that misses it.
 *
 * This bench isolates the other one. Source and bulk are both node 0, so the
 * bulk-source junction has nothing across it; the drain is pulled to -5 V
 * through 10k, so the bulk-drain junction is the only thing that can hold it up:
 *
 *   * bulk-DRAIN junction alone
 *   Vneg neg 0 DC -5
 *   Vg g 0 DC 0
 *   M1 d g 0 0 NM W=10u L=1u
 *   Rd d neg 10k
 *   .model NM NMOS(VTO=1 KP=2.0e-4)
 *
 * ngspice: d = -6.33322e-01 V. The junction carries
 * 1e-14*(e^(0.633322/0.02585) - 1) = 0.436 mA and 10k of that is 4.37 V, which
 * lifts the drain from -5 V to -0.63 V. The channel takes no part: the gate is
 * at 0 and the most positive terminal is node 0, so the overdrive is 0.633
 * against a 1 V threshold.
 *
 * THIS BENCH ALSO FOUND A SECOND DEFECT IN THE GATE ITSELF. The flag that
 * enables the junctions once required the source to be off the bulk as well as
 * the bulk to be grounded — two different needs conflated. The body effect
 * does want a source off the bulk; the drain junction does not care, and this
 * deck, with source and bulk both on node 0, got neither junction and read a
 * flat -5 V.
 */
describe('the bulk-drain junction, isolated', () => {
  const rig = ({ bulkAtGround }) => {
    const { parts, nets } = new NetlistBuilder()
      .vsource('VNEG', -5)
      .gnd('GND')
      .nmos('M1', 1.0, 1e-3)          // k = KP/2 * W/L = 1e-4 * 10
      .resistor('RD', 10000)
      .wire('VNEG.neg', 'GND.gnd')
      .wire('M1.gate', 'GND.gnd')
      .wire('M1.source', 'GND.gnd')
      .wire('M1.drain', 'RD.a')
      .wire('RD.b', 'VNEG.pos')
      .build();
    if (bulkAtGround) parts.find((p) => p.id === 'M1').params.bulkAtGround = true;
    const board = new BoardImpl(5);
    board.setNetlist(parts, nets);
    const dNet = nets.find((n) =>
      n.terminals.some((t) => t.part === 'RD' && t.terminal === 'a'));
    return { board, v: board.nodeVoltage(dNet.id), dNet };
  };

  it('lifts the drain to ngspice -0.633322 V', () => {
    const { v } = rig({ bulkAtGround: true });
    assert.ok(Math.abs(v - (-0.633322)) < 5e-3, `drain ${v} V, ngspice -0.633322 V`);
  });

  it('and without it the drain sits flat on the rail — a 4.4 V separation', () => {
    const { v } = rig({ bulkAtGround: false });
    assert.ok(Math.abs(v - (-5)) < 1e-3,
      `with no bulk declared the three-terminal answer is the rail, got ${v} V`);
    const withJ = rig({ bulkAtGround: true }).v;
    assert.ok(Math.abs(withJ - v) > 4,
      `the bench must separate by volts: ${withJ} vs ${v}`);
  });

  it('fires when source and bulk are the SAME node, which the first gate refused', () => {
    // The regression this pins: `bulkAtGround` must mean "the deck tied the bulk
    // to the reference" and nothing more. Here the source IS the reference, so a
    // gate that also demanded a source off the bulk stamped no junction at all.
    const { board } = rig({ bulkAtGround: true });
    const iD = board.branchCurrent('M1', 'drain');
    assert.ok(Math.abs(iD) > 1e-4,
      `the drain must carry the junction's 0.436 mA, got ${(iD * 1e3).toFixed(4)} mA`);
  });

  it('net KCL holds at the drain', () => {
    const { board, dNet } = rig({ bulkAtGround: true });
    let sum = 0;
    for (const t of dNet.terminals) sum += board.branchCurrent(t.part, t.terminal);
    assert.ok(Math.abs(sum) < 1e-7, `KCL at the drain net: ${(sum * 1e3).toFixed(7)} mA`);
  });
});

/**
 * BULK TIED TO THE SOURCE IS ALSO A KNOWN BULK POTENTIAL.
 *
 * It shorts the bulk-SOURCE junction — which is why that case needs no
 * threshold shift — but NOT the bulk-DRAIN one, and that is live whenever the
 * drain goes below the source.
 *
 * ADI2005 v3 row 4654 is the whole case in three lines:
 *
 *   M1 VDD VDD 3 3 NMOS W=1u L=1u
 *   V1 3 0 5
 *   .MODEL NMOS NMOS (LEVEL=1 VTO=1 KP=1.0e-4 LAMBDA=0.02)
 *
 * a diode-connected device whose source and bulk sit at 5 V with its drain/gate
 * node dangling. ngspice, three ways:
 *
 *   bulk at 5 V, as written    V(VDD) = 4.999380
 *   bulk moved to node 0       V(VDD) = 3.36e-19     <- our answer before this
 *   bulk at 5 V, IS = 1e-30    V(VDD) = 5.000000     <- pure GMIN tie, no drop
 *
 * The junction's own forward drop is the 0.62 mV; its ABSENCE was the whole
 * 5 V. 6 of the 24 remaining numeric disagreements in the full 12,471-deck
 * corpus are this one shape.
 *
 * WHAT IS LEFT AFTERWARDS IS OUR NODE SHUNT, and it is stated here rather than
 * papered over: with the junction stamped we read 4.840139 V against ngspice's
 * 4.999380 — 0.16 V low, down from 5.00 V, because `solveMNA` puts GMIN on
 * every node diagonal and that 1e-12 to GROUND competes with the junction's
 * 1e-12 to the BULK. ngspice puts GMIN only across pn junctions, so there the
 * junction is the only tie and wins outright. Lowering ours globally was
 * measured WORSE (a 2,000-deck sample fell 1,612 -> 1,559 agreeing); the fix
 * is a selective shunt, which is its own piece of work.
 */
describe('bulk tied to the source: the drain junction is still live', () => {
  const rig = ({ flag }) => {
    const { parts, nets } = new NetlistBuilder()
      .vsource('V1', 5).gnd('GND')
      .nmos('M1', 1.0, 5e-5)          // k = KP/2 * W/L = 5e-5 * 1
      .wire('V1.neg', 'GND.gnd')
      .wire('V1.pos', 'M1.source')
      .wire('M1.gate', 'M1.drain')    // diode-connected, drain/gate dangling
      .build();
    const m = parts.find((p) => p.id === 'M1');
    m.params.lambda = 0.02;
    if (flag) m.params.bulkOnSource = true;
    const board = new BoardImpl(5);
    board.setNetlist(parts, nets);
    const net = nets.find((n) =>
      n.terminals.some((t) => t.part === 'M1' && t.terminal === 'drain'));
    return board.nodeVoltage(net.id);
  };

  it('pulls the dangling drain node up towards the bulk', () => {
    const withJ = rig({ flag: true });
    assert.ok(withJ > 4.5,
      `the bulk-drain junction must carry the node up near the 5 V bulk; got ${withJ} V`);
    // ngspice reads 4.999380; the residue is our node shunt, documented above.
    assert.ok(Math.abs(withJ - 4.999380) < 0.25,
      `V(drain) ${withJ} V against ngspice's 4.999380 V`);
  });

  it('and without the flag it falls to the reference — a 4.8 V separation', () => {
    const without = rig({ flag: false });
    assert.ok(Math.abs(without) < 1e-3,
      `with no bulk declared the node is left to GMIN; got ${without} V`);
    assert.ok(Math.abs(rig({ flag: true }) - without) > 4,
      'the bench must separate by volts, or it is not testing the junction');
  });

  it('a bulk on the source does NOT shift the threshold', () => {
    // The half that must stay unchanged: Vsb is zero by construction here, so
    // `mosVth` is identity whatever GAMMA says.
    assert.equal(mosVth({ vth: 1, gamma: 0.5, phi: 0.6, bulkOnSource: true }, 0), 1);
    assert.equal(mosVth({ vth: 1, gamma: 0.5, phi: 0.6, bulkOnSource: true }, 4), 1,
      'bulkOnSource must not enable the body effect at any Vsb');
  });
});
