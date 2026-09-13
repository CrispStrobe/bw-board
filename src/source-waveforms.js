/**
 * Exact source waveforms whose parameter contract differs from the native
 * function-generator shapes in mna.js.
 *
 * SPICE PULSE is intentionally a separate tag from the existing native
 * `wave: 'pulse'`: the latter is frequency/duty based and has instantaneous
 * edges, while this one preserves all seven authored values.
 */

const SPICE_PULSE_KEYS = ['v1', 'v2', 'td', 'tr', 'tf', 'pw', 'per'];

/**
 * Validate and return an exact seven-argument SPICE PULSE description.
 * Time values are seconds; voltage values are volts.
 *
 * Zero rise/fall times are refused in the first supported domain because
 * SPICE dialects may substitute the transient step for an authored zero.
 * Overlapping segments are likewise refused rather than reinterpreted.
 *
 * @param {Record<string, unknown>} params
 */
export function spicePulseParams(params) {
  const pulse = {};
  for (const key of SPICE_PULSE_KEYS) {
    const value = params[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`spice-pulse: ${key} must be a finite authored number`);
    }
    pulse[key] = value;
  }
  if (pulse.td < 0) throw new Error('spice-pulse: td must be non-negative');
  if (!(pulse.tr > 0)) throw new Error('spice-pulse: tr must be positive');
  if (!(pulse.tf > 0)) throw new Error('spice-pulse: tf must be positive');
  if (pulse.pw < 0) throw new Error('spice-pulse: pw must be non-negative');
  if (!(pulse.per > 0)) throw new Error('spice-pulse: per must be positive');
  if (pulse.tr + pulse.pw + pulse.tf > pulse.per) {
    throw new Error('spice-pulse: tr + pw + tf must not exceed per');
  }
  return /** @type {{v1:number,v2:number,td:number,tr:number,tf:number,pw:number,per:number}} */ (pulse);
}

/**
 * Evaluate a validated SPICE PULSE at an absolute simulation time.
 *
 * @param {Record<string, unknown>} params
 * @param {number} tSeconds
 */
export function spicePulseVoltage(params, tSeconds) {
  const p = spicePulseParams(params);
  if (tSeconds <= p.td) return p.v1;
  const phase = (tSeconds - p.td) % p.per;
  if (phase < p.tr) return p.v1 + (p.v2 - p.v1) * phase / p.tr;
  if (phase < p.tr + p.pw) return p.v2;
  if (phase < p.tr + p.pw + p.tf) {
    return p.v2 + (p.v1 - p.v2) * (phase - p.tr - p.pw) / p.tf;
  }
  return p.v1;
}

/**
 * Return the first authored PULSE corner strictly after `tSeconds`.
 * Duplicate corners (notably pw=0) are removed so callers always advance.
 *
 * @param {Record<string, unknown>} params
 * @param {number} tSeconds
 * @returns {number}
 */
export function nextSpicePulseCorner(params, tSeconds) {
  const p = spicePulseParams(params);
  if (tSeconds < p.td) return p.td;
  const cycle = Math.floor((tSeconds - p.td) / p.per);
  const base = p.td + cycle * p.per;
  const offsets = [...new Set([0, p.tr, p.tr + p.pw, p.tr + p.pw + p.tf, p.per])]
    .sort((a, b) => a - b);
  for (const offset of offsets) {
    const candidate = base + offset;
    if (candidate > tSeconds) return candidate;
  }
  const following = base + p.per;
  if (following > tSeconds) return following;
  throw new Error('spice-pulse: simulation time is too large to resolve the next period');
}
