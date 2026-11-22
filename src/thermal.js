/**
 * A minimal, explicit, OPT-IN thermal model for discrete parts.
 *
 * Until 2026-11 every part sat at the bench temperature (board.temperatureC):
 * a heater resistor could not warm the thermistor taped to it, a self-heated
 * sensor could not be cooled by blowing on it, and a transistor could not be
 * used as a thermometer through its VBE. This module is the smallest model
 * that makes those three experiments honest.
 *
 * WHICH PARTS. A part takes part in the model only when its params ask for it:
 *
 *   rth          thermal resistance to the surrounding air, K/W. Its presence
 *                (> 0) makes the part self-heat from its own dissipation.
 *   thermalTau   thermal time constant, seconds (rth x heat capacity).
 *   heatedBy     id of another part (the heater). That part joins the model
 *                too, with its kind's defaults if it set no rth itself.
 *   thermalCoupling  0..1 (default 0.5): the fraction of the heater's
 *                temperature rise this part sees as its own surroundings --
 *                1 is glued to it, 0.2 is "a few millimetres away".
 *
 * A part named only by heatedBy, or carrying only heatedBy, gets the defaults
 * of its kind (THERMAL_DEFAULTS). Kinds outside that table do not take part.
 * A circuit with none of these params builds no thermal state at all, so it
 * solves exactly as before and pays one null check per advance.
 *
 * THE PHYSICS. Per part, a first-order RC to its surroundings:
 *
 *   T_surround = T_bench + coupling x (T_heater - T_bench)   (heatedBy)
 *              = T_bench                                      (otherwise)
 *   tau dT/dt  = T_surround + P x rth_eff - T
 *
 * stepped EXACTLY for a power held over the step,
 *   T += (T_surround + P rth_eff - T)(1 - exp(-h / tau_eff)),
 * so it is unconditionally stable. P is the part's dissipation off the live
 * solve: the sum over its terminals of V x (current into the part).
 *
 * AIRFLOW is the world's `airflowMs` (m/s, default 0; world.js). Forced
 * convection scales the film coefficient roughly with sqrt(v), so
 *   rth_eff = rth / (1 + sqrt(v)),   tau_eff = tau / (1 + sqrt(v))
 * (the heat capacity does not change): 1 m/s halves the rise, 4 m/s thirds it.
 * It is a teaching approximation with a stated shape, not a CFD figure.
 *
 * WHAT A TEMPERATURE CHANGES (the solver reads it per part, mna.js):
 *   - diode / LED / zener forward drop and BJT VBE: -2 mV/K from 25 C, the
 *     same coefficient the bench temperature already applies (E2.2);
 *   - an NTC in the model follows the beta equation
 *       R = r25 exp(beta (1/T - 1/298.15 K)),  params r25 (10 kOhm), beta (3950)
 *     instead of its 0..1 control;
 *   - a resistor's value does not change (no TCR): it is the heater.
 *
 * @module
 */

/** Defaults per kind when a part joins without its own numbers. */
export const THERMAL_DEFAULTS = Object.freeze({
  // 1/4 W axial film resistor: ~200 K/W, about 10 s to settle.
  resistor: Object.freeze({ rth: 200, tau: 10 }),
  // Bead NTC: dissipation constant ~2 mW/K -> 500 K/W.
  ntc: Object.freeze({ rth: 500, tau: 10 }),
  // TO-92 small-signal transistor, junction to ambient.
  npn: Object.freeze({ rth: 200, tau: 10 }),
  pnp: Object.freeze({ rth: 200, tau: 10 }),
  // DO-35 glass diode / 5 mm LED.
  diode: Object.freeze({ rth: 300, tau: 10 }),
  zener: Object.freeze({ rth: 300, tau: 10 }),
  led: Object.freeze({ rth: 300, tau: 10 }),
});

/** Silicon junction forward-drop coefficient, V/K (E2.2). */
export const JUNCTION_TEMPCO_V_PER_K = -0.002;

const finitePositive = (x) => {
  const n = Number(x);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * The thermal spec of `part`, or null when it does not take part.
 * @param {{id: string, kind: string, params?: Record<string, unknown>}} part
 * @param {boolean} [named] true when another part names it with heatedBy
 * @returns {{rth: number, tau: number, heatedBy: string|null, coupling: number}|null}
 */
export function thermalSpecOf(part, named = false) {
  const P = part.params ?? {};
  const def = THERMAL_DEFAULTS[part.kind];
  if (!def) return null;
  const rthOwn = finitePositive(P.rth);
  const heatedBy = typeof P.heatedBy === 'string' && P.heatedBy !== '' ? P.heatedBy : null;
  if (!rthOwn && !heatedBy && !named) return null;
  const c = Number(P.thermalCoupling ?? 0.5);
  return {
    rth: rthOwn ?? def.rth,
    tau: finitePositive(P.thermalTau) ?? def.tau,
    heatedBy: heatedBy === part.id ? null : heatedBy,
    coupling: Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0.5,
  };
}

/**
 * Build the thermal entries for a (solver-view) parts list, or null when no
 * part opts in.
 * @param {Array<{id: string, kind: string, params?: Record<string, unknown>}>} parts
 * @returns {Array<{id: string, rth: number, tau: number, heatedBy: string|null, coupling: number}>|null}
 */
export function buildThermalEntries(parts) {
  const named = new Set();
  for (const p of parts) {
    const h = p.params?.heatedBy;
    if (typeof h === 'string' && h !== '' && THERMAL_DEFAULTS[p.kind]) named.add(h);
  }
  const entries = [];
  for (const p of parts) {
    const spec = thermalSpecOf(p, named.has(p.id));
    if (spec) entries.push({ id: p.id, ...spec });
  }
  if (!entries.length) return null;
  const ids = new Set(entries.map((e) => e.id));
  // A heater that is not in the model (unknown id, or a kind with no thermal
  // defaults) heats nothing: the coupling would read a temperature that
  // does not exist.
  for (const e of entries) if (e.heatedBy && !ids.has(e.heatedBy)) e.heatedBy = null;
  return entries;
}

/** The airflow divisor on rth and tau for an air speed in m/s. */
export function airflowFactor(airflowMs) {
  const v = Number(airflowMs);
  return 1 + (Number.isFinite(v) && v > 0 ? Math.sqrt(v) : 0);
}

/**
 * Advance every entry's temperature by `h` seconds at the dissipations in
 * `powers` (watts by id). Mutates `temps`. Returns the largest |dT|.
 * @param {Array<{id: string, rth: number, tau: number, heatedBy: string|null, coupling: number}>} entries
 * @param {Map<string, number>} temps
 * @param {Map<string, number>} powers
 * @param {number} benchC
 * @param {number} airflowMs
 * @param {number} h
 */
export function stepThermal(entries, temps, powers, benchC, airflowMs, h) {
  const f = airflowFactor(airflowMs);
  const before = new Map(temps);
  let maxDelta = 0;
  for (const e of entries) {
    const T = before.get(e.id) ?? benchC;
    const surround = e.heatedBy
      ? benchC + e.coupling * ((before.get(e.heatedBy) ?? benchC) - benchC)
      : benchC;
    const P = powers.get(e.id) ?? 0;
    const target = surround + (Number.isFinite(P) ? P : 0) * e.rth / f;
    const next = T + (target - T) * (1 - Math.exp(-h * f / e.tau));
    temps.set(e.id, next);
    maxDelta = Math.max(maxDelta, Math.abs(next - T));
  }
  return maxDelta;
}

/** The shortest effective time constant among `entries` (seconds). */
export function shortestTau(entries, airflowMs) {
  let tau = Infinity;
  for (const e of entries) tau = Math.min(tau, e.tau);
  return tau / airflowFactor(airflowMs);
}

/**
 * An NTC's resistance at `celsius` by the beta equation.
 * @param {{params?: Record<string, unknown>}} part
 * @param {number} celsius
 */
export function ntcResistanceAt(part, celsius) {
  const r25 = finitePositive(part.params?.r25) ?? 10000;
  const beta = finitePositive(part.params?.beta) ?? 3950;
  const T = Math.max(celsius + 273.15, 1);
  return Math.max(0.001, r25 * Math.exp(beta * (1 / T - 1 / 298.15)));
}
