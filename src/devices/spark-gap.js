// SPDX-License-Identifier: MIT
/**
 * Spark gap: two electrodes `gapMm` apart in air (part `spark_gap`, leads a
 * and b). Open until the voltage across it reaches the breakdown voltage,
 * then an arc: a low resistance (arcOhms, 2 Ohm) behind an arc voltage
 * (arcV, 30 V) that conducts until its current falls below holdAmps (1 mA),
 * when the gap recovers and is open again.
 *
 * Breakdown in air for gaps of a fraction of a millimetre to a few
 * centimetres (uniform field, sea level) follows a straight-line fit to
 * Paschen's curve: Vb = 3 kV/mm x gap + 1.35 kV (params.kvPerMm,
 * params.offsetKv), so 1 mm breaks down near 4.4 kV and a hair's breadth
 * still needs over a kilovolt. Above that the 3 kV/mm of air's dielectric
 * strength dominates. The device state counts the sparks (`sparks`), keeps
 * the charge each one carried (`lastCoulombs`) and whether it burns now.
 *
 * A charged comb or a rubbed ruler is a tiny capacitance (tens of pF) at
 * kilovolts: a spark empties it in nanoseconds through the arc and whatever
 * resistance is in series. Not modelled: the statistical delay of breakdown,
 * humidity, the shape of the electrodes.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/** Breakdown voltage (V) for a spark gap's params. */
export function sparkBreakdownVolts(part) {
  const P = part.params ?? {};
  const gap = Math.max(0, num(P.gapMm, 1));
  return (num(P.kvPerMm, 3) * gap + num(P.offsetKv, 1.35)) * 1000;
}

export function registerSparkGap() {
  registerDevice('spark_gap', {
    terminals: ['a', 'b'],
    init() { return { drives: {}, burning: false, sparks: 0, sign: 1, lastCoulombs: 0, _q: 0, _t: null, volts: 0, amps: 0 }; },
    stamp(ctx, part, state) {
      if (state?.burning) {
        const r = num(part.params?.arcOhms, 2);
        ctx.theveninBetween('a', 'b', state.sign * num(part.params?.arcV, 30), r);
      }
    },
    update(part, state, read, tNs) {
      const v = read('a') - read('b');
      const t = Number(tNs) / 1e9;
      state.volts = v;
      if (!state.burning) {
        state.amps = 0;
        state._t = t;
        if (Math.abs(v) >= sparkBreakdownVolts(part)) {
          state.burning = true;
          state.sign = v >= 0 ? 1 : -1;
          state.sparks += 1;
          state._q = 0;
          return true;
        }
        return false;
      }
      const r = num(part.params?.arcOhms, 2);
      const i = (v - state.sign * num(part.params?.arcV, 30)) / r;
      if (state._t !== null && t > state._t) state._q += Math.abs(i) * (t - state._t);
      state._t = t;
      state.amps = i;
      // The arc dies when its current falls below the hold current or reverses.
      if (i * state.sign < num(part.params?.holdAmps, 1e-3)) {
        state.burning = false;
        state.lastCoulombs = state._q;
        return true;
      }
      return false;
    },
  });
}
