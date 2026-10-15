/**
 * The simulated world — one per project, read by every sensor.
 *
 * A world holds the ambient conditions on the bench:
 *
 *   temperatureC  °C            default 25      (the old board.temperatureC)
 *   humidityPct   % RH          default 50
 *   pressureHpa   hPa           default 1013.25
 *   lightLux      lx            unset (null)
 *   soundDb       dB SPL        unset (null)
 *
 * The three defaults equal the defaults the sensor models always used, so a
 * project that never touches the world reads exactly what it read before.
 * Light and sound start UNSET: the light and sound parts used different
 * fallbacks of their own (0, 0.5, 1.0 …), and an unset key leaves each part
 * on its own legacy fallback until somebody sets the world value.
 *
 * Precedence, highest first:
 *   1. an explicit per-part value (part.params[param], set by the
 *      Environment block "set [PARAM] of [PART] …", the controller panel or
 *      the netlist) — unchanged behaviour, the per-part stimulus always wins;
 *   2. the world value (constant, or a schedule evaluated at the board's
 *      simulation time);
 *   3. the part model's own fallback.
 *
 * Several boards in one project share one world: create it once and hand it
 * to each board with board.setWorld(world). A change made through any board
 * (or the world directly) re-solves and notifies every board sharing it.
 *
 * Schedules are piecewise-linear in SIMULATION seconds (board.timeNs / 1e9),
 * held flat before the first and after the last point, so the same program
 * reads the same values on every run (no wall clock is consulted).
 *
 * @module
 */

/** @typedef {'temperatureC'|'humidityPct'|'pressureHpa'|'lightLux'|'soundDb'} WorldKey */

export const WORLD_KEYS = Object.freeze(['temperatureC', 'humidityPct', 'pressureHpa', 'lightLux', 'soundDb']);

/** Defaults; null = unset (each part keeps its own legacy fallback). */
export const WORLD_DEFAULTS = Object.freeze({
  temperatureC: 25,
  humidityPct: 50,
  pressureHpa: 1013.25,
  lightLux: null,
  soundDb: null,
});

/** Valid ranges, used to clamp set() and schedule points. */
export const WORLD_RANGES = Object.freeze({
  temperatureC: [-55, 150],
  humidityPct: [0, 100],
  pressureHpa: [300, 1100],
  lightLux: [0, 120000],
  soundDb: [0, 140],
});

function clampKey (key, v) {
  const [lo, hi] = WORLD_RANGES[key];
  return Math.max(lo, Math.min(hi, v));
}

function assertKey (key) {
  if (!WORLD_KEYS.includes(key)) throw new Error(`unknown world key: ${key}`);
}

/** Piecewise-linear interpolation through sorted [t, v] points, held at the ends. */
export function evaluateSchedule (points, tSec) {
  if (tSec <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [t1, v1] = points[i];
    if (tSec <= t1) {
      const [t0, v0] = points[i - 1];
      return t1 === t0 ? v1 : v0 + (v1 - v0) * (tSec - t0) / (t1 - t0);
    }
  }
  return points[points.length - 1][1];
}

export class World {
  constructor (init) {
    /** @type {Record<string, number|null>} */
    this._values = { ...WORLD_DEFAULTS };
    /** @type {Map<string, Array<[number, number]>>} */
    this._schedules = new Map();
    /** @type {Set<(key: string, value: number|null) => void>} */
    this._listeners = new Set();
    if (init) this._load(init);
  }

  /**
   * The value of `key` at simulation time `tSec` (default 0): the schedule
   * when one is set, else the constant, else null when unset.
   * @param {WorldKey} key
   * @param {number} [tSec]
   * @returns {number|null}
   */
  get (key, tSec = 0) {
    assertKey(key);
    const s = this._schedules.get(key);
    if (s) return evaluateSchedule(s, Number.isFinite(tSec) ? tSec : 0);
    return this._values[key];
  }

  /**
   * Set a constant value (clears any schedule for the key). null unsets
   * light/sound (and resets the others to their default).
   * @param {WorldKey} key
   * @param {number|null} value
   */
  set (key, value) {
    assertKey(key);
    let v;
    if (value === null || value === undefined) v = WORLD_DEFAULTS[key];
    else {
      const n = Number(value);
      if (!Number.isFinite(n)) return;
      v = clampKey(key, n);
    }
    const hadSchedule = this._schedules.delete(key);
    if (!hadSchedule && this._values[key] === v) return;
    this._values[key] = v;
    this._emit(key, v);
  }

  /**
   * A time-varying value: [[tSec, value], …], sorted by time on entry.
   * @param {WorldKey} key
   * @param {Array<[number, number]>} points
   */
  setSchedule (key, points) {
    assertKey(key);
    if (!Array.isArray(points) || points.length === 0) throw new Error('schedule needs at least one point');
    const clean = points.map(([t, v]) => {
      const tn = Number(t), vn = Number(v);
      if (!Number.isFinite(tn) || !Number.isFinite(vn)) throw new Error('schedule points must be finite');
      return [tn, clampKey(key, vn)];
    }).sort((a, b) => a[0] - b[0]);
    this._schedules.set(key, clean);
    this._emit(key, null);
  }

  /** @param {WorldKey} key */
  getSchedule (key) {
    const s = this._schedules.get(key);
    return s ? s.map(p => [...p]) : null;
  }

  /**
   * @param {(key: string, value: number|null) => void} fn
   * @returns {() => void} unsubscribe
   */
  subscribe (fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit (key, value) {
    for (const fn of [...this._listeners]) fn(key, value);
  }

  /** True when nothing differs from the defaults (nothing to persist). */
  isDefault () {
    return this._schedules.size === 0 && WORLD_KEYS.every(k => this._values[k] === WORLD_DEFAULTS[k]);
  }

  /**
   * Only what differs from the defaults, so an untouched world serialises
   * to {} and a caller can omit it entirely (byte-for-byte unchanged files).
   */
  toJSON () {
    const out = {};
    for (const k of WORLD_KEYS) {
      if (this._schedules.has(k)) (out.schedules ??= {})[k] = this.getSchedule(k);
      else if (this._values[k] !== WORLD_DEFAULTS[k]) out[k] = this._values[k];
    }
    return out;
  }

  _load (obj) {
    for (const k of WORLD_KEYS) {
      if (obj[k] !== undefined) this.set(k, obj[k]);
      if (obj.schedules?.[k]) this.setSchedule(k, obj.schedules[k]);
    }
  }

  /** @param {object} obj - a toJSON() result (unknown keys ignored) */
  static fromJSON (obj) {
    return new World(obj && typeof obj === 'object' ? obj : undefined);
  }
}

export function createWorld (init) { return new World(init); }

// ─── Sensor defaults ─────────────────────────────────────────────────────

/** Normalised 0…1 light level for parts that model light as a fraction:
 *  log10(1 + lux) / 5, i.e. 0 lx → 0, ~10 lx → 0.21, ~1000 lx → 0.6,
 *  100 000 lx (direct sun) → 1. */
export function luxToUnit (lux) {
  return Math.max(0, Math.min(1, Math.log10(1 + Math.max(0, lux)) / 5));
}

/** Normalised 0…1 sound level: 30 dB (quiet room) → 0, 120 dB → 1, linear in dB. */
export function dbToUnit (db) {
  return Math.max(0, Math.min(1, (db - 30) / 90));
}

const PRESSURE_KINDS = new Set(['bmp280', 'bme280', 'bmp180', 'bmp085', 'bmp388', 'bmp390', 'ms5611', 'lps22']);

/**
 * Part param → world key. `kinds` restricts the binding when the same param
 * name means something else on another part (xpt2046 'pressure' is touch
 * pressure; 'level' is only a sound level on the sound module).
 */
export const WORLD_PARAM_BINDINGS = Object.freeze({
  temperature: { key: 'temperatureC' },
  humidity: { key: 'humidityPct' },
  pressure: { key: 'pressureHpa', convert: hpa => hpa * 100, kinds: PRESSURE_KINDS },
  lux: { key: 'lightLux' },
  white: { key: 'lightLux' },
  light: { key: 'lightLux', convert: luxToUnit },
  level: { key: 'soundDb', convert: dbToUnit, kinds: new Set(['sound_module']) },
});

/** part object → board (any object with .world and .timeNs). WeakMap: no
 *  hidden fields on parts, nothing leaks into serialised netlists. */
const PART_HOST = new WeakMap();

/** Bind parts to the board whose world they read. Called by the board. */
export function bindPartsToHost (parts, host) {
  for (const p of parts || []) if (p && typeof p === 'object') PART_HOST.set(p, host);
}

/**
 * The world value a part reads for `param` when no explicit per-part value
 * is set, or undefined when the param is not world-facing for this part or
 * the world key is unset.
 */
export function worldDefault (part, param) {
  const b = WORLD_PARAM_BINDINGS[param];
  if (!b || (b.kinds && !b.kinds.has(part?.kind))) return undefined;
  const host = PART_HOST.get(part);
  const world = host?.world;
  if (!world) return undefined;
  const tSec = typeof host.timeNs === 'bigint' ? Number(host.timeNs) / 1e9 : 0;
  const v = world.get(b.key, tSec);
  if (v === null || v === undefined) return undefined;
  return b.convert ? b.convert(v) : v;
}

/**
 * What a sensor model reads for a world-facing param: explicit per-part
 * value, else the world, else `fallback` (the model's legacy default).
 * @param {object} part
 * @param {string} param
 * @param {*} fallback
 */
export function ambient (part, param, fallback) {
  const v = part?.params?.[param];
  if (v !== undefined && v !== null) return v;
  const w = worldDefault(part, param);
  return w !== undefined ? w : fallback;
}
