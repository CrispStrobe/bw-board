/**
 * 8x8 LED matrix — behavioral display device for column-scanned dot matrices.
 *
 * The blinkenrocket congress badge drives an 8x8 LED matrix via:
 *   PORTB (PB0–PB7) → 8 column-select pins (one high = active column)
 *   PORTD (PD0–PD7) → 8 row-data pins (active-low: LOW = LED on)
 *
 * The firmware multiplexes at ~4 kHz (Timer0 overflow every 256 µs), cycling
 * through columns 0–7.  Each LED is on for 1/8 of the time at maximum.
 *
 * This model integrates the on-time of each LED over a persistence-of-vision
 * window (default 20 ms ≈ 50 Hz, matching human eye response) and exposes an
 * 8×8 brightness array for the UI.
 *
 * Terminals: col0–col7, row0–row7 (16 total).
 * Params:
 *   colActiveHigh  boolean (default true)  — col pin HIGH selects column
 *   rowActiveHigh  boolean (default true)  — row pin HIGH lights LED
 *                  (set false for common-anode / active-low row drive)
 *   windowNs       number  (default 20 000 000) — POV integration window
 *   vcc            number  (default 5.0)
 *
 * State:
 *   brightness  Float64Array(64) — row-major [row*8 + col], range 0.0–1.0
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_INPUT = 1e6;  // input impedance

/**
 * Register the matrix8x8 device model.
 */
export function registerMatrix8x8() {

  registerDevice('matrix8x8', {
    terminals: [
      'col0', 'col1', 'col2', 'col3', 'col4', 'col5', 'col6', 'col7',
      'row0', 'row1', 'row2', 'row3', 'row4', 'row5', 'row6', 'row7',
    ],

    init(part) {
      const colActiveHigh = part.params?.colActiveHigh !== false;
      const rowActiveHigh = part.params?.rowActiveHigh !== false;
      return {
        drives: {},
        /** 8x8 brightness, row-major: brightness[row * 8 + col]. */
        brightness: new Float64Array(64),
        /** Accumulated on-time per LED in current window (ns). */
        _onNs: new Float64Array(64),
        /** Start of current integration window (ns, as Number). */
        _windowStartNs: 0,
        /** Timestamp of last update call (ns, as Number). */
        _lastNs: 0,
        /** Integration window duration (ns). */
        _windowNs: part.params?.windowNs ?? 20_000_000,  // 20 ms
        /** Voltage threshold for logic high (V). */
        _threshold: (part.params?.vcc ?? 5.0) * 0.4,
        /** Snapshot of which LEDs were on at last update (for integration). */
        _prevOn: new Uint8Array(64),
        _colActiveHigh: colActiveHigh,
        _rowActiveHigh: rowActiveHigh,
      };
    },

    stamp(ctx) {
      for (let i = 0; i < 8; i++) {
        ctx.conductance('col' + i, null, 1 / R_INPUT);
        ctx.conductance('row' + i, null, 1 / R_INPUT);
      }
    },

    update(part, state, read, tNs) {
      const now = Number(tNs);
      const dt = now - state._lastNs;
      if (dt <= 0) return false;

      // Integrate PREVIOUS LED state over the elapsed interval
      for (let i = 0; i < 64; i++) {
        if (state._prevOn[i]) state._onNs[i] += dt;
      }

      // Sample current column/row voltages
      const thr = state._threshold;
      const colHi = state._colActiveHigh;
      const rowHi = state._rowActiveHigh;

      for (let col = 0; col < 8; col++) {
        const vCol = read('col' + col);
        const colOn = (vCol > thr) === colHi;
        for (let row = 0; row < 8; row++) {
          const vRow = read('row' + row);
          const rowOn = (vRow > thr) === rowHi;
          state._prevOn[row * 8 + col] = (colOn && rowOn) ? 1 : 0;
        }
      }

      state._lastNs = now;

      // At end of each window, compute brightness and reset accumulators
      const elapsed = now - state._windowStartNs;
      if (elapsed >= state._windowNs) {
        let changed = false;
        for (let i = 0; i < 64; i++) {
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
  });
}
