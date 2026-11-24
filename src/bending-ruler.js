// SPDX-License-Identifier: MIT
/**
 * A weighing scale from a ruler: a ruler clamped at one end bends under a
 * load hung at its free end, and the magnet glued there comes closer to a
 * linear Hall sensor fixed below it (part `bending_ruler`, a three-lead
 * module: vcc, gnd, ao).
 *
 * MECHANICS. A cantilever of free length L, width w, thickness t and
 * Young's modulus E, loaded by F = m g at its tip, deflects there by
 *
 *     delta = F L^3 / (3 E I),   I = w t^3 / 12,
 *
 * linear in the load (Hooke). The defaults are a 0.8 mm x 25 mm steel rule
 * with 20 cm free (12.5 mm per newton, 1.2 mm per 10 g). The tip stops
 * 1 mm above the sensor (it rests on it): delta <= gapMm - 1.
 *
 * FIELD. The magnet (moment m, A m^2, its axis pointing at the sensor) is a
 * dipole; on its axis at distance d
 *
 *     B = mu0 m / (2 pi d^3),
 *
 * so the field grows steeply, not linearly, as the ruler bends: the scale
 * needs calibrating. 0.1 A m^2 is a small (8 x 3 mm) neodymium disc;
 * at the default 15 mm rest gap it gives about 5.9 mT, at 5 mm 160 mT.
 *
 * SENSOR. A ratiometric linear Hall sensor: ao = vcc/2 + S (vcc/5) B with
 * S = 14 mV/mT at 5 V (params.mvPerMt), limited to 4 %..96 % of the supply;
 * a 50 Ohm output. params.flip turns the magnet over (field and output
 * swing the other way).
 *
 * @module
 */

export const G_ACCEL = 9.81;
const MU0 = 4e-7 * Math.PI;

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * The ruler's state for its params: deflection (mm), magnet distance (mm),
 * field at the sensor (mT, signed).
 * @param {{params?: Record<string, unknown>}} part
 */
export function rulerCard(part) {
  const P = part.params ?? {};
  const L = num(P.lengthCm, 20) / 100;
  const w = num(P.widthMm, 25) / 1000;
  const t = num(P.thickMm, 0.8) / 1000;
  const E = num(P.youngGPa, 200) * 1e9;
  const gapMm = Math.max(1.5, num(P.gapMm, 15));
  const loadG = Math.max(0, num(P.loadG, 0));
  const I = w * t * t * t / 12;
  const mmPerN = (L * L * L) / (3 * E * I) * 1000;
  const free = loadG / 1000 * G_ACCEL * mmPerN;
  const deflectionMm = Math.min(free, gapMm - 1);
  const dMm = gapMm - deflectionMm;
  const m = num(P.magnetAm2, 0.1);
  const fieldMt = (P.flip ? -1 : 1) * MU0 * m / (2 * Math.PI * (dMm / 1000) ** 3) * 1000;
  return { loadG, mmPerN, deflectionMm, distanceMm: dMm, fieldMt, touching: free >= gapMm - 1 };
}

/** The sensor output (V) for a supply `vcc` and a field in mT. */
export function hallOutput(part, vcc, fieldMt) {
  const s = num(part.params?.mvPerMt, 14) / 1000 * (vcc / 5);
  const v = vcc / 2 + s * fieldMt;
  return Math.max(0.04 * vcc, Math.min(0.96 * vcc, v));
}
