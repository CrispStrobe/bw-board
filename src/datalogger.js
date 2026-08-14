/**
 * Datalogger — in-memory time-series data store for simulation telemetry.
 *
 * Provides named series, timestamped entries, capacity management, and
 * CSV export.  No DOM dependency.  MakeCode's datalogger is the UX
 * reference; the API is simpler because we control both ends.
 *
 * Two capture modes share the same store:
 *   - Program-driven: extension blocks call log(value, series).
 *   - Sim-driven: the board layer pushes frames (one per tick) for
 *     automatic telemetry of pin states, voltages, currents.
 *
 * @module
 */

/** @type {number} Default max entries per series before ring-buffer wrap. */
const DEFAULT_MAX_ENTRIES = 10000;

export class DataLogger {

  /**
   * @param {{ maxEntries?: number, clock?: () => number }} [opts]
   *   maxEntries — per-series ring-buffer capacity (default 10 000).
   *   clock      — returns current time in ms; defaults to Date.now.
   */
  constructor(opts = {}) {
    /** @type {Map<string, Series>} */
    this._series = new Map();
    this._maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this._clock = opts.clock ?? (() => Date.now());
    /** @type {Set<(event: string, detail: object) => void>} */
    this._listeners = new Set();
  }

  // ── Logging ──────────────────────────────────────────────────────────

  /**
   * Log a value to a named series.  Creates the series if it doesn't exist.
   * @param {number} value
   * @param {string} [series='default']
   */
  log(value, series = 'default') {
    let s = this._series.get(series);
    if (!s) {
      s = { name: series, entries: [], startIndex: 0, totalLogged: 0 };
      this._series.set(series, s);
      this._emit('series-add', { series });
    }
    const entry = { t: this._clock(), v: Number(value) };
    if (s.entries.length < this._maxEntries) {
      s.entries.push(entry);
    } else {
      // Ring buffer: overwrite oldest
      s.entries[s.startIndex] = entry;
      s.startIndex = (s.startIndex + 1) % this._maxEntries;
    }
    s.totalLogged++;
    this._emit('log', { series, value: entry.v, t: entry.t });
  }

  // ── Series management ───────────────────────────────────────────────

  /** Clear a single series, or all series if name is omitted. */
  clear(series) {
    if (series !== undefined) {
      const s = this._series.get(series);
      if (s) {
        s.entries.length = 0;
        s.startIndex = 0;
        s.totalLogged = 0;
        this._emit('clear', { series });
      }
    } else {
      this._series.clear();
      this._emit('clear', { series: null });
    }
  }

  /** @returns {string[]} Names of all series. */
  getSeriesNames() {
    return [...this._series.keys()];
  }

  /** @returns {number} Number of series. */
  getSeriesCount() {
    return this._series.size;
  }

  /**
   * Get entries for a series, in chronological order.
   * @param {string} series
   * @returns {{ t: number, v: number }[]}
   */
  getEntries(series) {
    const s = this._series.get(series);
    if (!s) return [];
    if (s.startIndex === 0) return [...s.entries];
    // Unwind ring buffer
    return [
      ...s.entries.slice(s.startIndex),
      ...s.entries.slice(0, s.startIndex),
    ];
  }

  /**
   * Number of entries in a series.
   * @param {string} series
   * @returns {number}
   */
  getEntryCount(series) {
    const s = this._series.get(series);
    return s ? s.entries.length : 0;
  }

  /**
   * Most recent value in a series, or 0 if empty.
   * @param {string} series
   * @returns {number}
   */
  getLatest(series) {
    const s = this._series.get(series);
    if (!s || s.entries.length === 0) return 0;
    // Most recent entry is at (startIndex - 1 + length) % length for full ring,
    // or just the last element for non-full.
    if (s.entries.length < this._maxEntries) {
      return s.entries[s.entries.length - 1].v;
    }
    const idx = (s.startIndex - 1 + s.entries.length) % s.entries.length;
    return s.entries[idx].v;
  }

  // ── Export ───────────────────────────────────────────────────────────

  /**
   * Export a series as CSV text.
   * @param {string} series
   * @param {{ header?: boolean, relative?: boolean }} [opts]
   * @returns {string}
   */
  toCSV(series, opts = {}) {
    const entries = this.getEntries(series);
    if (entries.length === 0) return '';
    const header = opts.header !== false;
    const t0 = opts.relative !== false ? entries[0].t : 0;
    const lines = [];
    if (header) lines.push('time_ms,value');
    for (const e of entries) {
      lines.push(`${e.t - t0},${e.v}`);
    }
    return lines.join('\n') + '\n';
  }

  /**
   * Export all series as CSV (columns: time, series1, series2, ...).
   * Aligns on timestamps: if series have different timestamps,
   * each row uses the nearest-previous value (sample-and-hold).
   * @param {{ header?: boolean, relative?: boolean }} [opts]
   * @returns {string}
   */
  toCSVAll(opts = {}) {
    const names = this.getSeriesNames();
    if (names.length === 0) return '';
    if (names.length === 1) return this.toCSV(names[0], opts);

    // Collect all timestamps, merge and sort
    const seriesEntries = names.map(n => this.getEntries(n));
    const allTimes = new Set();
    for (const entries of seriesEntries) {
      for (const e of entries) allTimes.add(e.t);
    }
    const times = [...allTimes].sort((a, b) => a - b);
    if (times.length === 0) return '';

    const t0 = (opts.relative !== false) ? times[0] : 0;
    const header = opts.header !== false;
    const lines = [];
    if (header) lines.push('time_ms,' + names.join(','));

    // Sample-and-hold cursors
    const cursors = seriesEntries.map(() => 0);
    for (const t of times) {
      const row = [t - t0];
      for (let i = 0; i < names.length; i++) {
        const entries = seriesEntries[i];
        while (cursors[i] < entries.length - 1 && entries[cursors[i] + 1].t <= t) {
          cursors[i]++;
        }
        if (entries.length > 0 && entries[cursors[i]].t <= t) {
          row.push(entries[cursors[i]].v);
        } else {
          row.push('');
        }
      }
      lines.push(row.join(','));
    }
    return lines.join('\n') + '\n';
  }

  // ── Persistence ─────────────────────────────────────────────────────

  /** Serialize to JSON-safe object. */
  toJSON() {
    const series = {};
    for (const [name, s] of this._series) {
      series[name] = {
        entries: this.getEntries(name), // chronological
        totalLogged: s.totalLogged,
      };
    }
    return { version: 1, maxEntries: this._maxEntries, series };
  }

  /** Restore from serialized data. */
  static fromJSON(data, opts = {}) {
    if (!data || data.version !== 1) throw new Error('Invalid datalogger data');
    const logger = new DataLogger({
      maxEntries: data.maxEntries ?? DEFAULT_MAX_ENTRIES,
      ...opts,
    });
    for (const [name, sd] of Object.entries(data.series)) {
      for (const e of sd.entries) {
        // Bypass ring buffer logic — entries are already chronological and within capacity
        let s = logger._series.get(name);
        if (!s) {
          s = { name, entries: [], startIndex: 0, totalLogged: 0 };
          logger._series.set(name, s);
        }
        s.entries.push({ t: e.t, v: e.v });
        s.totalLogged++;
      }
    }
    return logger;
  }

  // ── Events ──────────────────────────────────────────────────────────

  addListener(fn) { this._listeners.add(fn); }
  removeListener(fn) { this._listeners.delete(fn); }

  _emit(event, detail) {
    for (const fn of this._listeners) {
      try { fn(event, detail); } catch { /* listener errors don't propagate */ }
    }
  }
}

/**
 * @typedef {object} Series
 * @property {string} name
 * @property {{ t: number, v: number }[]} entries - Ring buffer
 * @property {number} startIndex - Where the oldest entry is (ring buffer head)
 * @property {number} totalLogged - Lifetime count (may exceed entries.length)
 */
