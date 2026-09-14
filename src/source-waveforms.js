/**
 * Exact source waveforms whose parameter contract differs from the native
 * function-generator shapes in mna.js.
 *
 * SPICE PULSE is intentionally a separate tag from the existing native
 * `wave: 'pulse'`: the latter is frequency/duty based and has instantaneous
 * edges, while this one preserves all seven authored values.
 */

const SPICE_PULSE_KEYS = ['v1', 'v2', 'td', 'tr', 'tf', 'pw', 'per'];

const finite = value => typeof value === 'number' && Number.isFinite(value);

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

/** Validate a finite, strictly time-ordered SPICE PWL point list. */
export function spicePwlPoints(params) {
  if (!Array.isArray(params.points) || params.points.length < 2) {
    throw new Error('spice-pwl: points must contain at least two authored pairs');
  }
  const points = params.points.map((point, index) => {
    if (!Array.isArray(point) || point.length !== 2 || !finite(point[0]) || !finite(point[1])) {
      throw new Error(`spice-pwl: point ${index} must be a finite [seconds, value] pair`);
    }
    if (point[0] < 0) throw new Error(`spice-pwl: point ${index} time must be non-negative`);
    if (index && !(point[0] > params.points[index - 1][0])) {
      throw new Error('spice-pwl: point times must be strictly increasing');
    }
    return /** @type {[number, number]} */ ([point[0], point[1]]);
  });
  return points;
}

/** Exact finite PWL interpolation; endpoints are held outside the authored span. */
export function spicePwlValue(params, tSeconds) {
  if (!finite(tSeconds)) throw new Error('spice-pwl: simulation time must be finite');
  const points = spicePwlPoints(params);
  if (tSeconds <= points[0][0]) return points[0][1];
  for (let index = 1; index < points.length; index++) {
    const [rightTime, rightValue] = points[index];
    if (tSeconds <= rightTime) {
      const [leftTime, leftValue] = points[index - 1];
      const fraction = (tSeconds - leftTime) / (rightTime - leftTime);
      return leftValue + fraction * (rightValue - leftValue);
    }
  }
  return points.at(-1)[1];
}

/** First PWL slope corner strictly after t, or null after the final point. */
export function nextSpicePwlCorner(params, tSeconds) {
  for (const [time] of spicePwlPoints(params)) if (time > tSeconds) return time;
  return null;
}

/** Validate the complete six-value SPICE exponential-source contract. */
export function spiceExpParams(params) {
  const out = {};
  for (const key of ['v1', 'v2', 'td1', 'tau1', 'td2', 'tau2']) {
    if (!finite(params[key])) throw new Error(`spice-exp: ${key} must be a finite authored number`);
    out[key] = params[key];
  }
  if (out.td1 < 0 || out.td2 < 0) throw new Error('spice-exp: delays must be non-negative');
  if (!(out.tau1 > 0) || !(out.tau2 > 0)) throw new Error('spice-exp: time constants must be positive');
  if (out.td2 < out.td1) throw new Error('spice-exp: td2 must not precede td1');
  return out;
}

/** Evaluate SPICE EXP(V1 V2 TD1 TAU1 TD2 TAU2) without approximation. */
export function spiceExpValue(params, tSeconds) {
  if (!finite(tSeconds)) throw new Error('spice-exp: simulation time must be finite');
  const p = spiceExpParams(params);
  if (tSeconds <= p.td1) return p.v1;
  const rising = (p.v2 - p.v1) * (1 - Math.exp(-(tSeconds - p.td1) / p.tau1));
  if (tSeconds <= p.td2) return p.v1 + rising;
  const falling = (p.v1 - p.v2) * (1 - Math.exp(-(tSeconds - p.td2) / p.tau2));
  return p.v1 + rising + falling;
}

/** First EXP derivative corner strictly after t, or null after TD2. */
export function nextSpiceExpCorner(params, tSeconds) {
  const p = spiceExpParams(params);
  if (p.td1 > tSeconds) return p.td1;
  if (p.td2 > tSeconds) return p.td2;
  return null;
}

/** Validate SPICE SIN(VO VA FREQ TD THETA PHASE) with all semantics explicit. */
export function spiceSineParams(params) {
  const out = {};
  for (const key of ['offset', 'amplitude', 'freq', 'td', 'theta', 'phase']) {
    if (!finite(params[key])) throw new Error(`spice-sine: ${key} must be a finite authored number`);
    out[key] = params[key];
  }
  if (!(out.freq > 0)) throw new Error('spice-sine: freq must be positive');
  if (out.td < 0) throw new Error('spice-sine: td must be non-negative');
  if (out.theta < 0) throw new Error('spice-sine: theta must be non-negative');
  return out;
}

/** Exact delayed, exponentially damped SPICE sine value. */
export function spiceSineValue(params, tSeconds) {
  if (!finite(tSeconds)) throw new Error('spice-sine: simulation time must be finite');
  const p = spiceSineParams(params);
  const elapsed = Math.max(0, tSeconds - p.td);
  const phase = p.phase * Math.PI / 180;
  return p.offset + p.amplitude * Math.sin(2 * Math.PI * p.freq * elapsed + phase)
    * Math.exp(-p.theta * elapsed);
}

/** Delay is the sole derivative corner of a SPICE sine. */
export function nextSpiceSineCorner(params, tSeconds) {
  const p = spiceSineParams(params);
  return p.td > tSeconds ? p.td : null;
}
