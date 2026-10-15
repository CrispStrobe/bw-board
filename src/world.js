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
    /** @type {Map<string, WorldSource>} positioned sources (step 2) */
    this._sources = new Map();
    /** @type {WorldSurface|null} what colour/distance sensors face (step 3) */
    this._surface = null;
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
    return this._schedules.size === 0 && this._sources.size === 0 && this._surface === null &&
      WORLD_KEYS.every(k => this._values[k] === WORLD_DEFAULTS[k]);
  }

  // ── Surface (step 3) ──────────────────────────────────────────────────

  /**
   * The surface under / in front of colour and distance sensors, for a
   * project with no 3D scene: r, g, b reflectance 0…1 and distanceCm.
   * Any field may be omitted; null clears the surface.
   * @param {Partial<WorldSurface>|null} surface
   */
  setSurface (surface) {
    this._surface = surface === null ? null : normaliseSurface(surface);
    this._emit('surface', null);
  }

  /** @returns {WorldSurface|null} */
  getSurface () {
    return this._surface ? { ...this._surface } : null;
  }

  // ── Positioned sources (heater, fan, lamp, sound) ──────────────────────

  /**
   * Add or replace a source. Positions are bench coordinates (the circuit
   * designer's layout units); `strength` is the source's effect at or inside
   * the reference distance, in its key's unit (see SOURCE_KINDS).
   * @param {{id: string, kind: string, x: number, y: number, strength?: number, on?: boolean, radius?: number}} src
   */
  setSource (src) {
    const s = normaliseSource(src);
    this._sources.set(s.id, s);
    this._emit('sources', null);
  }

  /** @param {string} id */
  removeSource (id) {
    if (this._sources.delete(String(id))) this._emit('sources', null);
  }

  /** @returns {WorldSource[]} copies, in insertion order */
  getSources () {
    return [...this._sources.values()].map(s => ({ ...s }));
  }

  /**
   * The value of `key` at bench position (x, y): the uniform value plus every
   * source's contribution (see falloff()). Without sources this equals get().
   * @param {WorldKey} key
   * @param {number} x
   * @param {number} y
   * @param {number} [tSec]
   * @returns {number|null}
   */
  getAt (key, x, y, tSec = 0) {
    const base = this.get(key, tSec);
    const mine = [...this._sources.values()].filter(s => s.on && SOURCE_KINDS[s.kind].key === key);
    if (mine.length === 0 || !Number.isFinite(x) || !Number.isFinite(y)) return base;
    if (key === 'soundDb') {
      // Intensities add: L = 10·log10(Σ 10^(L_i/10)), each source attenuated
      // by the same inverse-square factor (−20·log10(d/r) dB beyond r).
      let energy = base === null ? 0 : 10 ** (base / 10);
      for (const s of mine) energy += 10 ** (s.strength / 10) * falloff(Math.hypot(x - s.x, y - s.y), s.radius);
      return energy > 0 ? clampKey(key, 10 * Math.log10(energy)) : base;
    }
    let v = base === null ? 0 : base;
    for (const s of mine) v += SOURCE_KINDS[s.kind].sign * s.strength * falloff(Math.hypot(x - s.x, y - s.y), s.radius);
    return clampKey(key, v);
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
    if (this._sources.size) out.sources = this.getSources();
    if (this._surface) out.surface = this.getSurface();
    return out;
  }

  _load (obj) {
    for (const k of WORLD_KEYS) {
      if (obj[k] !== undefined) this.set(k, obj[k]);
      if (obj.schedules?.[k]) this.setSchedule(k, obj.schedules[k]);
    }
    if (Array.isArray(obj.sources)) for (const s of obj.sources) this.setSource(s);
    if (obj.surface && typeof obj.surface === 'object') this.setSurface(obj.surface);
  }

  /** Replace this world's whole state with `obj` (a toJSON() result). */
  replaceWith (obj) {
    const fresh = World.fromJSON(obj);
    for (const k of WORLD_KEYS) {
      const sched = fresh.getSchedule(k);
      if (sched) this.setSchedule(k, sched);
      else this.set(k, fresh.get(k));
    }
    for (const id of [...this._sources.keys()]) if (!fresh._sources.has(id)) this.removeSource(id);
    for (const s of fresh.getSources()) {
      const old = this._sources.get(s.id);
      if (!old || JSON.stringify(old) !== JSON.stringify(s)) this.setSource(s);
    }
    if (JSON.stringify(this._surface) !== JSON.stringify(fresh._surface)) this.setSurface(fresh.getSurface());
  }

  /** @param {object} obj - a toJSON() result (unknown keys ignored) */
  static fromJSON (obj) {
    return new World(obj && typeof obj === 'object' ? obj : undefined);
  }
}

export function createWorld (init) { return new World(init); }

// ─── Sources and falloff (step 2) ──────────────────────────────────────────

/**
 * Source kinds: which world key each perturbs and in which direction.
 * `strength` is in the key's unit — °C for heater/fan, lx for a lamp, dB SPL
 * for a sound source — and is the full effect at or inside `radius`.
 */
export const SOURCE_KINDS = Object.freeze({
  heater: { key: 'temperatureC', sign: +1, defaultStrength: 10 },
  fan: { key: 'temperatureC', sign: -1, defaultStrength: 3 },
  lamp: { key: 'lightLux', sign: +1, defaultStrength: 500 },
  sound: { key: 'soundDb', sign: +1, defaultStrength: 80 },
});

/** Reference distance in bench (designer layout) units: inside it a source
 *  acts at full strength. 100 units ≈ one part's width in the designer. */
export const REFERENCE_DISTANCE = 100;

/**
 * Inverse-square falloff, clamped: 1 at or inside `radius`, (radius/d)² beyond.
 * Clamping keeps a sensor sitting on a source finite.
 */
export function falloff (d, radius = REFERENCE_DISTANCE) {
  if (!(d > radius)) return 1;
  return (radius / d) ** 2;
}

/**
 * @typedef {{id: string, kind: 'heater'|'fan'|'lamp'|'sound', x: number, y: number,
 *   strength: number, on: boolean, radius: number}} WorldSource
 */
function normaliseSource (src) {
  if (!src || typeof src !== 'object') throw new Error('source must be an object');
  const id = String(src.id ?? '');
  if (!id) throw new Error('source needs an id');
  const kind = SOURCE_KINDS[src.kind];
  if (!kind) throw new Error(`unknown source kind: ${src.kind}`);
  const x = Number(src.x), y = Number(src.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('source needs a finite x and y');
  const strength = src.strength === undefined ? kind.defaultStrength : Number(src.strength);
  if (!Number.isFinite(strength) || strength < 0) throw new Error('source strength must be finite and ≥ 0');
  const radius = src.radius === undefined ? REFERENCE_DISTANCE : Number(src.radius);
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('source radius must be finite and > 0');
  return { id, kind: src.kind, x, y, strength, on: src.on !== false, radius };
}

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
  const pos = typeof host.partBenchPosition === 'function' ? host.partBenchPosition(part) : null;
  const v = pos ? world.getAt(b.key, pos.x, pos.y, tSec) : world.get(b.key, tSec);
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

// ─── Surfaces: colour and distance sensors without a 3D scene (step 3) ─────

/** @typedef {{r?: number, g?: number, b?: number, distanceCm?: number}} WorldSurface */

const SURFACE_FIELDS = ['r', 'g', 'b', 'distanceCm'];

function normaliseSurface (src) {
  if (!src || typeof src !== 'object') throw new Error('surface must be an object or null');
  const out = {};
  for (const f of ['r', 'g', 'b']) {
    if (src[f] === undefined || src[f] === null) continue;
    const v = Number(src[f]);
    if (!Number.isFinite(v)) throw new Error(`surface ${f} must be finite`);
    out[f] = Math.max(0, Math.min(1, v));
  }
  if (src.distanceCm !== undefined && src.distanceCm !== null) {
    const d = Number(src.distanceCm);
    if (!Number.isFinite(d)) throw new Error('surface distanceCm must be finite');
    out.distanceCm = Math.max(0, d);
  }
  return out;
}

/** Per-part surface params (override the world's surface field by field). */
const PART_SURFACE_PARAMS = { r: 'surfaceR', g: 'surfaceG', b: 'surfaceB', distanceCm: 'surfaceDistanceCm' };

/**
 * The surface a sensor part faces: each field from the part's own
 * surfaceR/G/B/surfaceDistanceCm param, else the world's surface, else
 * absent. Returns null when no field is known at all.
 * @param {object} part
 * @returns {WorldSurface|null}
 */
export function surfaceFor (part) {
  const world = PART_HOST.get(part)?.world;
  const ws = world && typeof world.getSurface === 'function' ? world.getSurface() : null;
  const out = {};
  for (const f of SURFACE_FIELDS) {
    const pv = part?.params?.[PART_SURFACE_PARAMS[f]];
    const v = pv !== undefined && pv !== null ? Number(pv) : ws?.[f];
    if (Number.isFinite(v)) out[f] = f === 'distanceCm' ? Math.max(0, v) : Math.max(0, Math.min(1, v));
  }
  return Object.keys(out).length ? out : null;
}

/** Illuminance a reflected-colour reading assumes when world light is unset (an indoor room). */
export const DEFAULT_SURFACE_LUX = 300;
/** Uncalibrated counts per (lux × reflectance) at the colour sensor's power-on setting. */
export const COLOUR_COUNTS_PER_LUX = 1;

/**
 * What a colour sensor (TCS34725-style RGBC) reads. A channel the part sets
 * explicitly (params.red/green/blue/clear — the existing stimulus) wins.
 * Otherwise, when the sensor faces a surface with r/g/b reflectance, each
 * channel is illuminance × reflectance × COLOUR_COUNTS_PER_LUX, where the
 * illuminance is the world's light at the sensor (positioned, sources
 * included) or DEFAULT_SURFACE_LUX while light is unset; clear = R+G+B.
 * Without either, a channel reads 0 as before.
 * @returns {{red: number, green: number, blue: number, clear: number}}
 */
export function colourCounts (part) {
  const p = part?.params || {};
  const surf = surfaceFor(part);
  let lux = worldDefault(part, 'lux');
  if (lux === undefined) lux = DEFAULT_SURFACE_LUX;
  const ch = (param, f) => {
    if (p[param] !== undefined && p[param] !== null) return Number(p[param]);
    if (surf && surf[f] !== undefined) return Math.min(65535, Math.round(lux * surf[f] * COLOUR_COUNTS_PER_LUX));
    return 0;
  };
  const red = ch('red', 'r'), green = ch('green', 'g'), blue = ch('blue', 'b');
  const clear = p.clear !== undefined && p.clear !== null ? Number(p.clear) : red + green + blue;
  return { red, green, blue, clear };
}

/**
 * The distance a ranging sensor reads, in cm: its own param (in its own
 * unit, converted by the caller) wins; else the surface distance (part or
 * world); else undefined, and the caller keeps its legacy default.
 */
export function surfaceDistanceCm (part) {
  return surfaceFor(part)?.distanceCm;
}
