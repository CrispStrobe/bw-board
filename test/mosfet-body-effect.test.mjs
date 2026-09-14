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
    const h = 1e-9;
    for (const join of [-MOS_SMOOTH_DELTA, MOS_SMOOTH_DELTA]) {
      const [lo, dlo] = smoothVov(join - h);
      const [hi, dhi] = smoothVov(join + h);
      assert.ok(Math.abs(hi - lo) < 1e-7, `value jump at ${join}: ${hi - lo}`);
      assert.ok(Math.abs(dhi - dlo) < 1e-7, `slope jump at ${join}: ${dhi - dlo}`);
    }
  });

  it('has the analytic derivative of its own value, in band', () => {
    const h = 1e-7;
    for (const vov of [-0.04, -0.02, 0, 0.02, 0.04]) {
      const [, d] = smoothVov(vov);
      const numeric = (smoothVov(vov + h)[0] - smoothVov(vov - h)[0]) / (2 * h);
      assert.ok(Math.abs(d - numeric) < 1e-6, `vov ${vov}: stated ${d}, numeric ${numeric}`);
    }
  });

  it('the in-band value never exceeds the line it joins, and is never negative', () => {
    for (let vov = -0.05; vov <= 0.05; vov += 0.001) {
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
 *   M1 n1 n1 s 0 NM W=10u L=1u
 *   .model NM NMOS(VTO=1 KP=200u)
 *
 * ngspice: n1 = 5.917696e-20 V — GMIN alone holds it at the reference.
 * Before the smoothing was made exactly zero, our answer was about half a volt
 * and no choice of KP moved it.
 */
describe('an off MOSFET must not drive a floating node', () => {
  it('leaves a dangling gate-drain node at the reference, not at vov_s/(2 dvov_s)', () => {
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
    assert.ok(Math.abs(v) < 1e-3,
      `a floating gate-drain node on an off device must sit at the reference; got ${v} V`);
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
    for (const k of [1e-6, 1e-4, 1e-2, 1]) {
      assert.ok(Math.abs(read(k)) < 1e-3, `k = ${k} gave ${read(k)} V`);
    }
  });
});
