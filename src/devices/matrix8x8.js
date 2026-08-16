/**
 * NxM scanned LED matrix — behavioral display device for column-scanned
 * dot matrices of arbitrary size.
 *
 * The default 8x8 models the 1088AS-style matrix (blinkenrocket badge).
 * Presets:
 *   8x8   — standard single-module LED matrix (default)
 *   16x8  — two 1088AS modules side by side (retro console playfield)
 *   9x9   — 81-LED self-wired grid (18 scan lines)
 *
 * Terminals: col0..col(C-1), row0..row(R-1).
 * Params:
 *   rows            number  (default 8)
 *   cols            number  (default 8)
 *   colActiveHigh   boolean (default true)  — col pin HIGH selects column
 *   rowActiveHigh   boolean (default true)  — row pin HIGH lights LED
 *   windowNs        number  (default 20_000_000) — POV integration window (ns)
 *   vcc             number  (default 5.0)
 *
 * State:
 *   brightness  Float64Array(rows*cols) — row-major [row*cols+col], 0.0–1.0
 *   rows        number — row count (for face rendering)
 *   cols        number — column count (for face rendering)
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_INPUT = 1e6;

function makeMatrixModel(defaultRows, defaultCols) {
  return {
    get terminals() {
      // Dynamic terminals are generated per-instance in init();
      // this static list covers the default size for validation.
      const terms = [];
      for (let c = 0; c < defaultCols; c++) terms.push('col' + c);
      for (let r = 0; r < defaultRows; r++) terms.push('row' + r);
      return terms;
    },

    init(part) {
      const rows = part.params?.rows ?? defaultRows;
      const cols = part.params?.cols ?? defaultCols;
      const n = rows * cols;
      const colActiveHigh = part.params?.colActiveHigh !== false;
      const rowActiveHigh = part.params?.rowActiveHigh !== false;

      // Build dynamic terminal list for this instance
      const terms = [];
      for (let c = 0; c < cols; c++) terms.push('col' + c);
      for (let r = 0; r < rows; r++) terms.push('row' + r);

      return {
        drives: {},
        rows,
        cols,
        _terminals: terms,
        brightness: new Float64Array(n),
        _onNs: new Float64Array(n),
        _windowStartNs: 0,
        _lastNs: 0,
        _windowNs: part.params?.windowNs ?? 20_000_000,
        _threshold: (part.params?.vcc ?? 5.0) * 0.4,
        _prevOn: new Uint8Array(n),
        _colActiveHigh: colActiveHigh,
        _rowActiveHigh: rowActiveHigh,
      };
    },

    stamp(ctx, part, state) {
      const cols = state?.cols ?? defaultCols;
      const rows = state?.rows ?? defaultRows;
      for (let c = 0; c < cols; c++) ctx.conductance('col' + c, null, 1 / R_INPUT);
      for (let r = 0; r < rows; r++) ctx.conductance('row' + r, null, 1 / R_INPUT);
    },

    update(part, state, read, tNs) {
      const now = Number(tNs);
      const dt = now - state._lastNs;
      if (dt <= 0) return false;

      const rows = state.rows;
      const cols = state.cols;
      const n = rows * cols;

      // Integrate previous LED state
      for (let i = 0; i < n; i++) {
        if (state._prevOn[i]) state._onNs[i] += dt;
      }

      // Sample current column/row voltages
      const thr = state._threshold;
      const colHi = state._colActiveHigh;
      const rowHi = state._rowActiveHigh;

      for (let col = 0; col < cols; col++) {
        const vCol = read('col' + col);
        const colOn = (vCol > thr) === colHi;
        for (let row = 0; row < rows; row++) {
          const vRow = read('row' + row);
          const rowOn = (vRow > thr) === rowHi;
          state._prevOn[row * cols + col] = (colOn && rowOn) ? 1 : 0;
        }
      }

      state._lastNs = now;

      // At end of each window, compute brightness and reset accumulators
      const elapsed = now - state._windowStartNs;
      if (elapsed >= state._windowNs) {
        let changed = false;
        for (let i = 0; i < n; i++) {
          const b = elapsed > 0 ? Math.min(1.0, state._onNs[i] / elapsed) : 0;
          if (Math.abs(b - state.brightness[i]) > 0.002) changed = true;
          state.brightness[i] = b;
          state._onNs[i] = 0;
        }
        state._windowStartNs = now;
        return changed;
      }

      return false;
    },
  };
}

/**
 * Register matrix device models: matrix8x8 (default), matrix16x8, matrix9x9.
 */
export function registerMatrix8x8() {
  registerDevice('matrix8x8',  makeMatrixModel(8, 8));
  registerDevice('matrix16x8', makeMatrixModel(8, 16));
  registerDevice('matrix9x9',  makeMatrixModel(9, 9));
}
