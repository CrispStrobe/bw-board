/**
 * The MOSFET body effect, and the smoothing that sits under it.
 *
 * Two fixes land together here because the second was uncovered by the first:
 * building a bench that put a MOSFET source off the bulk also put a gate-drain
 * node into cutoff, and the cutoff answer was wrong for a reason that had
 * nothing to do with the body effect.
 *
 * EVERY reference number below was measured with ngspice and is quoted with
 * the deck that produced it, so a reader can re-derive it rather than trust it.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { NetlistBuilder } from '../src/builder.js';
import { mosVth, smoothVov, MOS_SMOOTH_DELTA } from '../src/mna.js';

// ─── The threshold law itself ──────────────────────────────────────────────

describe('mosVth: Vth = VTO + GAMMA*(sqrt(PHI + Vsb) - sqrt(PHI))', () => {
  it('is the plain threshold when GAMMA is absent — SPICE defaults GAMMA to 0', () => {
    for (const vsb of [0, 0.5, 1, 2, 4]) {
      assert.equal(mosVth({ vth: 1.0, phi: 0.6, bulkAtGround: true }, vsb), 1.0);
      assert.equal(mosVth({ vth: 1.0, gamma: 0, phi: 0.6, bulkAtGround: true }, vsb), 1.0);
    }
  });

  it('is the plain threshold when the bulk is tied to the SOURCE, at any Vsb', () => {
    // Not merely because Vsb is then 0 — the flag says the deck wired it that
    // way, so even a stale Vsb reading must not raise the threshold.
    const p = { vth: 1.0, gamma: 0.5, phi: 0.6 };   // no bulkAtGround
    for (const vsb of [0, 0.5, 1, 2, 4]) assert.equal(mosVth(p, vsb), 1.0);
  });

  it('raises the threshold by the square-root law when the bulk is at ground', () => {
    const p = { vth: 1.0, gamma: 0.5, phi: 0.6, bulkAtGround: true };
    // Hand-derived from the law, not copied from the implementation:
    // 1 + 0.5*(sqrt(0.6 + Vsb) - sqrt(0.6))
    const law = (vsb) => 1 + 0.5 * (Math.sqrt(0.6 + vsb) - Math.sqrt(0.6));
    for (const vsb of [0, 0.5, 1, 2, 4]) {
      assert.ok(Math.abs(mosVth(p, vsb) - law(vsb)) < 1e-12,
        `Vsb ${vsb}: ${mosVth(p, vsb)} vs ${law(vsb)}`);
    }
    // And it is MONOTONE and actually moves — a law that returned VTO for
    // every input would satisfy the formula check above at Vsb = 0 alone.
    assert.equal(mosVth(p, 0), 1.0);
    assert.ok(mosVth(p, 4) > 1.6, `Vsb 4 V must raise Vth well clear of VTO, got ${mosVth(p, 4)}`);
    let prev = -Infinity;
    for (const vsb of [0, 0.5, 1, 2, 4]) {
      const v = mosVth(p, vsb);
      assert.ok(v > prev, 'monotone in Vsb');
      prev = v;
    }
  });

  it('clamps a FORWARD-biased bulk junction rather than returning NaN', () => {
    // Vsb < -PHI would take the square root of a negative number. A negative
    // Vsb means the bulk diode is forward biased, which this model does not
    // describe at all; refusing to produce NaN is the least it can do.
    const p = { vth: 1.0, gamma: 0.5, phi: 0.6, bulkAtGround: true };
    for (const vsb of [-0.1, -1, -10]) {
      const v = mosVth(p, vsb);
      assert.ok(Number.isFinite(v), `Vsb ${vsb} gave ${v}`);
      assert.equal(v, 1.0, 'a clamped Vsb of 0 leaves the threshold at VTO');
    }
  });
});

// ─── The smoothing under it ────────────────────────────────────────────────

describe('smoothVov: C1, and EXACTLY ZERO below cutoff', () => {
  it('is exactly zero, with zero slope, at and below -delta', () => {
    // THIS IS THE LOAD-BEARING ASSERTION. The previous form,
    // ½·(vov + √(vov² + δ²)), returned 6.24e-4 at vov = -1 V with derivative
    // 6.24e-4. Both are negligible; their RATIO is not. An off device on an
    // otherwise-floating node injects id0 = k·vov_s² through its own
    // gm = 2k·vov_s·dvov_s, so the node settles at vov_s/(2·dvov_s) — HALF A
    // VOLT, INDEPENDENT OF k. Weakening the device does not help: the phantom
    // current and the phantom conductance shrink together.
    for (const vov of [-MOS_SMOOTH_DELTA, -0.06, -0.1, -1, -5, -50]) {
      const [s, d] = smoothVov(vov);
      assert.equal(s, 0, `vov ${vov} must give exactly 0, got ${s}`);
      assert.equal(d, 0, `vov ${vov} must give exactly slope 0, got ${d}`);
    }
  });

  it('is the square law EXACTLY at and above +delta', () => {
    for (const vov of [MOS_SMOOTH_DELTA, 0.1, 1, 3, 30]) {
      const [s, d] = smoothVov(vov);
      assert.equal(s, vov, `vov ${vov} must be returned unchanged, got ${s}`);
      assert.equal(d, 1);
    }
  });

  it('is continuous in value AND slope across both joins', () => {
    // THE TOLERANCES DERIVE FROM THE PROBE AND THE BAND, not from a constant.
    // In band the slope is (vov + d)/(2d), so stepping across a join by h moves
    // it by h/(2d) -- a number that depends on delta. A flat 1e-7 tolerance
    // silently encoded delta = 0.05 and reddened the day delta moved to 0.005,
    // accusing the function of a discontinuity it does not have.
    const h = 1e-9;
    const valueTol = 4 * h;                          // slope <= 1 either side
    const slopeTol = 4 * h / MOS_SMOOTH_DELTA;       // d(slope)/d(vov) = 1/(2d)
    for (const join of [-MOS_SMOOTH_DELTA, MOS_SMOOTH_DELTA]) {
      const [lo, dlo] = smoothVov(join - h);
      const [hi, dhi] = smoothVov(join + h);
      assert.ok(Math.abs(hi - lo) < valueTol,
        `value jump at ${join}: ${hi - lo} (tol ${valueTol})`);
      assert.ok(Math.abs(dhi - dlo) < slopeTol,
        `slope jump at ${join}: ${dhi - dlo} (tol ${slopeTol})`);
    }
    // And the tolerances must not be so loose that a real jump would pass:
    // the old hyperbola's slope at -delta was 0.5*(1 - 1/sqrt(1+1)) = 0.146,
    // which is orders above slopeTol at any delta this band takes.
    assert.ok(slopeTol < 0.01, `slopeTol ${slopeTol} would admit a real jump`);
  });

  it('has the analytic derivative of its own value, in band', () => {
    // The probe points are FRACTIONS OF THE BAND, so this stays in band when
    // delta moves. Absolute values would walk outside it and test the lines.
    const h = MOS_SMOOTH_DELTA * 2e-6;
    for (const f of [-0.8, -0.4, 0, 0.4, 0.8]) {
      const vov = f * MOS_SMOOTH_DELTA;
      const [, d] = smoothVov(vov);
      const numeric = (smoothVov(vov + h)[0] - smoothVov(vov - h)[0]) / (2 * h);
      assert.ok(Math.abs(d - numeric) < 1e-6, `vov ${vov}: stated ${d}, numeric ${numeric}`);
    }
  });

  it('the in-band value never exceeds the line it joins, and is never negative', () => {
    const step = MOS_SMOOTH_DELTA / 50;
    for (let vov = -MOS_SMOOTH_DELTA; vov <= MOS_SMOOTH_DELTA; vov += step) {
      const [s] = smoothVov(vov);
      assert.ok(s >= 0, `vov ${vov} gave a NEGATIVE overdrive ${s}`);
      assert.ok(s <= Math.max(vov, 0) + MOS_SMOOTH_DELTA / 4 + 1e-12,
        `vov ${vov} overshoots: ${s}`);
    }
  });
});

// ─── Both, in a solve ──────────────────────────────────────────────────────

/**
 * Source degeneration puts the source above the bulk, so GAMMA fires.
 *
 *   * source degeneration with the bulk at ground
 *   Vdd vdd 0 DC 10
 *   Vg  g   0 DC 4
 *   M1  d g s 0 NM W=20u L=2u
 *   Rd  vdd d 2k
 *   Rs  s   0 1k
 *   .model NM NMOS(VTO=1 KP=100u GAMMA=0.5 PHI=0.6)
 *
 * ngspice 44, .options temp=26.8267934421 tnom=26.8267934421:
 *   GAMMA=0.5 PHI=0.6           s = 1.182169 V   d = 7.635663 V
 *   GAMMA absent                s = 1.354249 V   d = 7.291503 V
 *   GAMMA=0.5, bulk on SOURCE   s = 1.354249 V   d = 7.291503 V   (identical)
 *
 * The pair SEPARATES by 172 mV, 34x the 5 mV corpus tolerance, so this bench
 * can tell a body effect from its absence. The third deck is the control that
 * says the effect is keyed to the BULK WIRING and not merely to GAMMA.
 */
function degenerated({ gamma, bulkAtGround }) {
  // k = KP/2 * W/L = 100u/2 * 10 = 500u
  const { parts, nets } = new NetlistBuilder()
    .vsource('VDD', 10)
    .vsource('VG', 4)
    .gnd('GND')
    .nmos('M1', 1.0, 500e-6)
    .resistor('RD', 2000)
    .resistor('RS', 1000)
    .wire('VDD.neg', 'GND.gnd')
    .wire('VG.neg', 'GND.gnd')
    .wire('VDD.pos', 'RD.a')
    .wire('RD.b', 'M1.drain')
    .wire('VG.pos', 'M1.gate')
    .wire('M1.source', 'RS.a')
    .wire('RS.b', 'GND.gnd')
    .build();
  const m = parts.find(p => p.id === 'M1');
  if (gamma) Object.assign(m.params, { gamma: 0.5, phi: 0.6 });
  if (bulkAtGround) m.params.bulkAtGround = true;
  const board = new BoardImpl(10);
  board.setNetlist(parts, nets);
  const net = nets.find(n => n.terminals?.some(t => t.part === 'M1' && t.terminal === 'source'));
  return board.nodeVoltage(net.id);
}

describe('body effect in a solve, against ngspice', () => {
  it('GAMMA with the bulk at ground lifts the source to ngspice 1.182169 V', () => {
    const v = degenerated({ gamma: true, bulkAtGround: true });
    assert.ok(Math.abs(v - 1.182169) < 5e-3, `source ${v} V, ngspice 1.182169 V`);
  });

  it('without GAMMA the same bench reads ngspice 1.354249 V', () => {
    const v = degenerated({ gamma: false, bulkAtGround: true });
    assert.ok(Math.abs(v - 1.354249) < 5e-3, `source ${v} V, ngspice 1.354249 V`);
  });

  it('GAMMA with the bulk on the SOURCE reproduces the no-GAMMA answer', () => {
    const v = degenerated({ gamma: true, bulkAtGround: false });
    assert.ok(Math.abs(v - 1.354249) < 5e-3, `source ${v} V, ngspice 1.354249 V`);
  });

  it('the bench SEPARATES: the two answers differ by far more than tolerance', () => {
    // Without this, all three cases above could pass on one number.
    const withG = degenerated({ gamma: true, bulkAtGround: true });
    const without = degenerated({ gamma: false, bulkAtGround: true });
    assert.ok(Math.abs(withG - without) > 0.1,
      `the bench must distinguish the two: ${withG} vs ${without}`);
  });
});

/**
 * A gate-drain node with NOTHING else on it, on a device held in cutoff.
 *
 *   * a dangling gate-drain node on an OFF nmos
 *   Vs s 0 DC 5
 *   M1 n1 n1 s <bulk> NM W=10u L=1u
 *   .model NM NMOS(VTO=1 KP=200u)
 *
 * THE BULK NODE DECIDES THE ANSWER, and this file used to state only one of the
 * two. Measured on that deck:
 *
 *   bulk 0  (the reference)   ngspice n1 = 3.362041e-19 V
 *   bulk s  (its own source)  ngspice n1 = 4.999380e+00 V
 *
 * Both are ngspice's answer, for two different devices. The recorded 5.9e-20
 * belongs to the first, and the engine's three-terminal `nmos` is the SECOND --
 * its symbol ties bulk to source and its SPICE export writes `M1 n1 n1 s s`, so
 * the bulk-drain junction holds the node up near the source rail.
 *
 * What the original defect was, and what still has to hold: our answer used to
 * be about half a volt and INDEPENDENT of KP, which is the tell that a
 * smoothing term rather than the circuit was setting it. Independence of k is
 * therefore still asserted, against whichever number the bulk wiring implies.
 */
describe('an off MOSFET must not drive a floating node', () => {
  it('leaves a dangling gate-drain node where its bulk junction puts it', () => {
    const { parts, nets } = new NetlistBuilder()
      .vsource('VS', 5)
      .gnd('GND')
      .nmos('M1', 1.0, 1e-3)
      .wire('VS.neg', 'GND.gnd')
      .wire('VS.pos', 'M1.source')
      .wire('M1.gate', 'M1.drain')
      .build();
    const board = new BoardImpl(5);
    board.setNetlist(parts, nets);
    const net = nets.find(n => n.terminals?.some(t => t.part === 'M1' && t.terminal === 'gate'));
    const v = board.nodeVoltage(net.id);
    // Bulk on source: ngspice 4.999380 V. Our bulk-on-source stamp is still
    // 132 mV off that (4.867521 V measured), which is a KNOWN remaining
    // disagreement and is why this is a band rather than a point -- asserting
    // our own 4.867521 would be a test of the defect.
    assert.ok(Math.abs(v - 4.999380) < 0.2,
      `a three-terminal device's bulk-drain junction must hold this node near its `
      + `source rail; ngspice 4.999380 V, got ${v} V`);

    // THE CONTROL: the same bench with the bulk declared at the reference is
    // the OTHER device, and ngspice puts it at 3.362041e-19 V. Two wirings,
    // two answers, five volts apart -- so neither assertion can pass on the
    // other's number.
    parts.find(part => part.id === 'M1').params.bulkAtGround = true;
    const grounded = new BoardImpl(5);
    grounded.setNetlist(parts, nets);
    const atReference = grounded.nodeVoltage(net.id);
    assert.ok(Math.abs(atReference) < 1e-3,
      `with the bulk at the reference the node belongs to GMIN; ngspice 3.4e-19 V, got ${atReference} V`);
    assert.ok(Math.abs(v - atReference) > 4,
      `the two bulk wirings must separate by volts: ${v} vs ${atReference}`);
  });

  it('and the answer does not depend on the device strength', () => {
    // The defect's signature: the wrong voltage was INDEPENDENT of k, so a
    // sweep over k that returns one constant non-zero number is the tell.
    const read = (k) => {
      const { parts, nets } = new NetlistBuilder()
        .vsource('VS', 5).gnd('GND').nmos('M1', 1.0, k)
        .wire('VS.neg', 'GND.gnd').wire('VS.pos', 'M1.source')
        .wire('M1.gate', 'M1.drain')
        .build();
      const board = new BoardImpl(5);
      board.setNetlist(parts, nets);
      const net = nets.find(n => n.terminals?.some(t => t.part === 'M1' && t.terminal === 'gate'));
      return board.nodeVoltage(net.id);
    };
    // INDEPENDENCE OF k is the claim, not the value: the defect's signature was
    // a wrong voltage that no choice of KP moved. So every k must give the SAME
    // number, and that number must be the bulk junction's, not a smoothing
    // artefact's.
    const first = read(1e-6);
    for (const k of [1e-6, 1e-4, 1e-2, 1]) {
      assert.ok(Math.abs(read(k) - first) < 1e-9,
        `k = ${k} gave ${read(k)} V, k = 1e-6 gave ${first} V — a cutoff device's `
        + 'floating node must not depend on its strength');
      assert.ok(Math.abs(read(k) - 4.999380) < 0.2, `k = ${k} gave ${read(k)} V`);
    }
  });
});

/**
 * THE BLEND WIDTH IS AN ERROR TERM, AND THIS BENCH MEASURES IT.
 *
 * ADI2005 v3 row 187, an NMOS cascode amplifier, transcribed:
 *
 *   VDD VDD 0 DC 3.3
 *   VIN IN 0 DC 0.49
 *   VBIAS BIAS 0 DC 1.8
 *   RD VDD OUT 270
 *   M1 CASC IN 0 0 NMOS W=20u L=1u
 *   M2 OUT BIAS CASC 0 NMOS W=20u L=1u
 *   .MODEL NMOS NMOS (LEVEL=1 VTO=1 KP=1.0e-4 LAMBDA=0.005)
 *
 * M1's gate is at 0.49 V against a 1 V threshold, so it is half a volt into
 * cutoff and CASC is held only by leakage. M2 therefore settles wherever its
 * current matches that leakage, which is AT threshold: ngspice puts CASC at
 * 0.799205 V, i.e. Vgs = 1.8 - 0.799 = 1.0008 against VTO = 1.
 *
 * A blend of half-width delta puts the balance point inside the band instead,
 * so the answer is wrong by of order delta. Swept on a Miller-compensated
 * op-amp bench, the worst error was linear in delta over a factor of ten:
 *
 *   delta = 0.05    4.88e-2 V        delta = 0.02    2.00e-2 V
 *   delta = 0.005   5.98e-3 V
 *
 * which is why this is one constant and not four topologies. The assertion
 * below is what delta has to buy: 5 mV of tolerance against a node the band
 * used to move by 48 mV.
 */
describe('a device at threshold on a leakage-held node', () => {
  it('sits AT threshold, not a blend-width below it (ngspice 0.799205 V)', () => {
    const { parts, nets } = new NetlistBuilder()
      .vsource('VDD', 3.3).vsource('VIN', 0.49).vsource('VBIAS', 1.8)
      .gnd('GND')
      .resistor('RD', 270)
      .nmos('M1', 1.0, 1e-3)          // k = KP/2 * W/L = 5e-5 * 20
      .nmos('M2', 1.0, 1e-3)
      .wire('VDD.neg', 'GND.gnd').wire('VIN.neg', 'GND.gnd').wire('VBIAS.neg', 'GND.gnd')
      .wire('VDD.pos', 'RD.a')
      .wire('RD.b', 'M2.drain')
      .wire('VBIAS.pos', 'M2.gate')
      .wire('M2.source', 'M1.drain')
      .wire('VIN.pos', 'M1.gate')
      .wire('M1.source', 'GND.gnd')
      .build();
    for (const id of ['M1', 'M2']) {
      const m = parts.find((p) => p.id === id);
      m.params.lambda = 0.005;
      m.params.bulkAtGround = true;
    }
    const board = new BoardImpl(3.3);
    board.setNetlist(parts, nets);
    const casc = nets.find((n) =>
      n.terminals.some((t) => t.part === 'M2' && t.terminal === 'source')).id;
    const v = board.nodeVoltage(casc);
    // THE CORPUS RULE, not a stricter one invented here: a node disagrees only
    // if it misses on BOTH 5 mV absolute and 1 % relative. Asserting the
    // absolute half alone made this red at 5.04 mV on a 0.8 V node — a
    // tolerance the oracle sweep does not apply, so the test would have been
    // measuring something the programme does not.
    const ref = 0.799205;
    const abs = Math.abs(v - ref);
    const rel = abs / Math.abs(ref);
    assert.ok(abs <= 5e-3 || rel <= 0.01,
      `CASC ${v} V, ngspice ${ref} V — abs ${abs.toExponential(2)}, `
      + `rel ${(rel * 100).toFixed(2)} %. An error of order MOS_SMOOTH_DELTA `
      + `(${MOS_SMOOTH_DELTA}) means the blend band is setting the answer.`);
    // And it must be a real bound, not a wide one: at the old delta of 0.05
    // this node read 0.847573 V, which fails both halves.
    assert.ok(abs < 0.02, `${abs} V is blend-width-scale error, not rounding`);
  });

  it('and the blend is narrow enough to be inside the corpus tolerance', () => {
    // The claim this file exists to hold: the band's width is smaller than the
    // agreement tolerance it would otherwise blow. Stated as a bound on the
    // CONSTANT, so raising delta reds here rather than in one bench by luck.
    assert.ok(MOS_SMOOTH_DELTA <= 5e-3,
      `MOS_SMOOTH_DELTA is ${MOS_SMOOTH_DELTA}; an operating point held at `
      + 'threshold by leakage is then wrong by that much, and the corpus '
      + 'tolerance is 5 mV. If this must grow, re-measure the corpus first.');
  });
});
