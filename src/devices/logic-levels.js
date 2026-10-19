/**
 * Input logic levels per family (E5.7).
 *
 * HC inputs are CMOS: V_IL/V_IH scale with the rail (30 %/70 % VCC).
 * HCT inputs are TTL-FIXED — V_IL 0.8 V, V_IH 2.0 V regardless of rail —
 * which is the entire reason HCT parts appear on mixed-level 5 V boards:
 * a 3.3 V-ish MCU high (or a TTL 2.4 V high) clears 2.0 V but not 3.5 V.
 *
 * A part is HCT when its kind says so (`74hct*`) or when
 * `params.family: 'hct'` is set on an HC kind.
 *
 * @module
 */

/**
 * LS inputs are TTL proper — the same fixed 0.8/2.0 V levels HCT was
 * built to mimic — so the `74ls*` aliases take the TTL branch too.
 *
 * @param {import('../types.js').Part} part
 * @param {number} vcc
 * @returns {{ vIL: number, vIH: number }}
 */
export function inputThresholds(part, vcc) {
  if (isHct(part)) return { vIL: 0.8, vIH: 2.0 };
  return { vIL: 0.3 * vcc, vIH: 0.7 * vcc };
}

/**
 * Single switching threshold for models that read inputs without
 * hysteresis: mid-supply for HC, the 1.4 V TTL center for HCT (the
 * midpoint of V_IL/V_IH — an approximation those models already make
 * for HC by using 0.5·VCC).
 * @param {import('../types.js').Part} part
 * @param {number} vcc
 * @returns {number}
 */
export function inputThreshold(part, vcc) {
  return isHct(part) ? 1.4 : 0.5 * vcc;
}

/** TTL-fixed input levels: HCT kinds, LS kinds, or an explicit param.
 * @param {import('../types.js').Part} part */
export function isHct(part) {
  return part.params?.family === 'hct' || /^74(hct|ls)/.test(part.kind);
}
