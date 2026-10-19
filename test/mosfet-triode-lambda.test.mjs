/**
 * SPICE APPLIES CHANNEL-LENGTH MODULATION IN THE LINEAR REGION TOO.
 *
 * This engine applied `(1 + LAMBDA*Vds)` only in saturation. Level-1 applies it
 * in both regions, and leaving it out of the triode branch was the last
 * systematic error in the MOSFET model.
 *
 * HOW IT WAS ESTABLISHED, on a device held firmly in triode so that nothing
 * else could account for the difference — Vds = 62 mV against Vov = 4 V:
 *
 *   * VDD vdd 0 DC 5 / VG g 0 DC 5 / M1 d g 0 0 NM W=20u L=1u / RD vdd d 10k
 *   .model NM NMOS(LEVEL=1 VTO=1 KP=1.0e-4 LAMBDA=0.1)  ->  d = 6.182569e-2 V
 *   .model NM NMOS(LEVEL=1 VTO=1 KP=1.0e-4 LAMBDA=0)    ->  d = 6.220612e-2 V
 *
 * The current is pinned by the 10k load, so Vds is what moves:
 * 0.0618257/0.0622061 = 0.993886 against 1/(1 + 0.1*0.0618) = 0.993855 —
 * agreement to 3e-5, in both directions.
 *
 * Corpus consequence, which is why it is worth a file: ADI2005 v3 row 417.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { NetlistBuilder } from '../src/builder.js';
import { registerAllDevices } from '../src/register-all.js';
import { mosTriode } from '../src/mna.js';

registerAllDevices();

describe('mosTriode: the law, and what it reduces to', () => {
  it('is BIT-IDENTICAL to the plain square law when LAMBDA is absent', () => {
    // SPICE defaults LAMBDA to 0, so every deck that states none must be
    // untouched — not "close", identical.
    const k = 1e-3;
    for (const [vov, vds] of [[1, 0.5], [3, 1], [0.1, 0.05], [2, 2], [0, 0]]) {
      for (const params of [{}, { lambda: 0 }, { lambda: NaN }, { lambda: -1 }]) {
        const t = mosTriode(k, vov, vds, 1, params);
        assert.equal(t.id, k * (2 * vov * vds - vds * vds));
        assert.equal(t.gds, 2 * k * (vov - vds));
        assert.equal(t.gm, 2 * k * vds * 1);
      }
    }
  });

  it('scales the current by (1 + LAMBDA*Vds)', () => {
    const k = 1e-3, vov = 4, vds = 0.0618257, lambda = 0.1;
    const with_ = mosTriode(k, vov, vds, 1, { lambda });
    const without = mosTriode(k, vov, vds, 1, {});
    assert.ok(Math.abs(with_.id / without.id - (1 + lambda * vds)) < 1e-12,
      `${with_.id / without.id} vs ${1 + lambda * vds}`);
  });

  it('has the analytic derivatives of its own current', () => {
    const k = 1e-3, params = { lambda: 0.05 };
    const h = 1e-7;
    for (const [vov, vds] of [[1, 0.3], [3, 1.5], [0.5, 0.4]]) {
      const t = mosTriode(k, vov, vds, 1, params);
      const dVds = (mosTriode(k, vov, vds + h, 1, params).id
        - mosTriode(k, vov, vds - h, 1, params).id) / (2 * h);
      assert.ok(Math.abs(t.gds - dVds) / Math.abs(dVds) < 1e-5,
        `gds at (${vov},${vds}): stated ${t.gds}, numeric ${dVds}`);
      const dVgs = (mosTriode(k, vov + h, vds, 1, params).id
        - mosTriode(k, vov - h, vds, 1, params).id) / (2 * h);
      assert.ok(Math.abs(t.gm - dVgs) / Math.abs(dVgs) < 1e-5,
        `gm at (${vov},${vds}): stated ${t.gm}, numeric ${dVgs}`);
    }
  });

  it('MEETS SATURATION at Vds = Vov, in slope as well as value', () => {
    // Before this, triode's gds went to ZERO at the boundary while saturation's
    // was LAMBDA*Id, so the two regions met in value only and the FSM crossed a
    // kink in the derivative. Now both agree.
    const k = 1e-3, lambda = 0.02;
    for (const vov of [0.5, 2, 5]) {
      const t = mosTriode(k, vov, vov, 1, { lambda });
      assert.ok(Math.abs(t.id - k * vov * vov * (1 + lambda * vov)) < 1e-15,
        `value at Vds=Vov=${vov}: ${t.id}`);
      assert.ok(Math.abs(t.gds - lambda * k * vov * vov) < 1e-15,
        `slope at Vds=Vov=${vov}: ${t.gds} vs mosGds's ${lambda * k * vov * vov}`);
    }
  });
});

/**
 * ADI2005 v3 row 417, transcribed:
 *
 *   VDD VDD 0 DC 12 / VIN IN 0 DC 6.6
 *   RD VDD DRAIN 560 / RS SOURCE 0 120
 *   M1 DRAIN IN SOURCE 0 NMOS W=20u L=1u
 *   .MODEL NMOS NMOS (LEVEL=1 VTO=1 KP=1.0e-4 LAMBDA=0.01)
 *
 * ngspice: SOURCE = 1.667681 V, DRAIN = 4.217489 V.
 *
 * The device is in TRIODE — Vds = 2.55 V against Vov = 3.93 V — which is why
 * this deck and not a saturated one found the defect. ngspice's drain needs
 * Id = 13.897 mA; the triode law WITHOUT the lambda factor gives 13.797 mA and
 * puts the drain at 4.273378 V, 56 mV high. With it: 13.90 mA.
 */
describe('a source-degenerated amplifier in triode, against ngspice', () => {
  const rig = () => {
    const { parts, nets } = new NetlistBuilder()
      .vsource('VDD', 12).vsource('VIN', 6.6).gnd('GND')
      .resistor('RD', 560).resistor('RS', 120)
      .nmos('M1', 1.0, 1e-3)        // k = KP/2 * W/L = 5e-5 * 20
      .wire('VDD.neg', 'GND.gnd').wire('VIN.neg', 'GND.gnd')
      .wire('VDD.pos', 'RD.a').wire('RD.b', 'M1.drain')
      .wire('VIN.pos', 'M1.gate')
      .wire('M1.source', 'RS.a').wire('RS.b', 'GND.gnd')
      .build();
    const m = parts.find((p) => p.id === 'M1');
    m.params.lambda = 0.01;
    m.params.bulkAtGround = true;
    const board = new BoardImpl(12);
    board.setNetlist(parts, nets);
    const at = (part, terminal) => board.nodeVoltage(
      nets.find((n) => n.terminals.some((t) => t.part === part && t.terminal === terminal)).id);
    return { board, drain: at('RD', 'b'), source: at('RS', 'a') };
  };

  it('puts the drain at 4.217489 V, not the 4.273378 V the law without it gives', () => {
    const { drain } = rig();
    assert.ok(Math.abs(drain - 4.217489) < 5e-3,
      `DRAIN ${drain} V, ngspice 4.217489 V (without the lambda factor: 4.273378 V)`);
    // The bench SEPARATES: the two candidate laws are 56 mV apart, eleven times
    // the corpus tolerance, so this cannot pass on both.
    assert.ok(Math.abs(4.273378 - 4.217489) > 10 * 5e-3);
  });

  it('and the source too, so it is the current that is right and not one node', () => {
    const { source } = rig();
    assert.ok(Math.abs(source - 1.667681) < 5e-3,
      `SOURCE ${source} V, ngspice 1.667681 V`);
  });

  it('the device really is in triode here, or this bench proves nothing', () => {
    // Vds = 4.217 - 1.668 = 2.550; Vov = 6.6 - 1.668 - 1 = 3.932. Vds < Vov.
    const { drain, source } = rig();
    const vds = drain - source;
    const vov = 6.6 - source - 1.0;
    assert.ok(vds < vov,
      `Vds ${vds} must be below Vov ${vov} — a saturated device would not see this defect`);
  });

  it('the extraction agrees with the solve, so a meter reads the same current', () => {
    // One reader agrees and the other does not is the recurring defect class:
    // the triode law has three readers and this is the third.
    const { board, drain } = rig();
    const iDrain = board.branchCurrent('M1', 'drain');
    const iResistor = (12 - drain) / 560;
    assert.ok(Math.abs(Math.abs(iDrain) - iResistor) / iResistor < 1e-6,
      `M1.drain reads ${iDrain} A, the 560 Ohm in series carries ${iResistor} A`);
    // And it is ngspice's current, not merely a self-consistent one.
    assert.ok(Math.abs(iResistor - 13.897e-3) / 13.897e-3 < 5e-3,
      `${iResistor} A against ngspice's 13.897 mA`);
  });
});
