/**
 * Power devices — battery, voltage regulator, fuse.
 *
 * battery: fixed voltage source (1.5V, 3V, 9V, etc.)
 * vreg: linear voltage regulator (78xx series) — drops to fixed output
 * fuse: zero-resistance until current exceeds rating, then open
 *
 * @module
 */

import { registerDevice } from '../devices.js';

/**
 * Register power device models.
 */
export function registerPowerDevices() {
  // ─── Battery ────────────────────────────────────────────────────────
  // A battery is a voltage source with internal resistance.
  // Terminals: pos, neg (like a real battery)
  registerDevice('battery', {
    terminals: ['pos', 'neg'],

    init(part) {
      const volts = part.params?.volts ?? 9;
      return {
        drives: {
          pos: { vTh: volts, rTh: part.params?.rInternal ?? 0.5 },
        },
      };
    },

    stamp(ctx, part, state) {
      // The battery drives 'pos' relative to 'neg' via state.drives (generic).
      // Also stamp the internal resistance as a conductance path so current flows.
      const rInt = part.params?.rInternal ?? 0.5;
      const volts = part.params?.volts ?? 9;
      ctx.thevenin('pos', volts, rInt);
    },

    update() { return false; }, // static — no behavioral changes
  });

  // ─── Voltage Regulator (78xx / LM317) ──────────────────────────────
  // Input → output drops to a fixed voltage (e.g. 7805 = 5V out).
  // If Vin < Vout + dropout, output follows input minus dropout.
  registerDevice('vreg', {
    terminals: ['in', 'out', 'gnd'],

    init(part) {
      const vOut = part.params?.vOut ?? 5.0;
      return {
        drives: {
          out: { vTh: vOut, rTh: part.params?.rOut ?? 1.0 },
        },
        _vOut: vOut,
      };
    },

    stamp(ctx, part, state) {
      // Input: draws current (small quiescent + load)
      // Modeled as: output drives vOut through low impedance
      // Input draws what the output needs (not explicitly stamped — the
      // current flows through the output stamp and returns via gnd).
      ctx.conductance('in', 'gnd', 1 / 1e6); // quiescent current path
    },

    update(part, state, read) {
      const vIn = read('in');
      const vGnd = read('gnd');
      const targetVout = part.params?.vOut ?? 5.0;
      const dropout = part.params?.dropout ?? 1.5;
      const rOut = part.params?.rOut ?? 1.0;

      // Regulated output: min(targetVout, Vin - dropout)
      const maxOut = (vIn - vGnd) - dropout;
      const actualVout = Math.min(targetVout, Math.max(0, maxOut));

      if (Math.abs(actualVout - state._vOut) < 0.01) return false;

      state._vOut = actualVout;
      state.drives.out = { vTh: vGnd + actualVout, rTh: rOut };
      return true;
    },
  });

  // ─── Fuse ──────────────────────────────────────────────────────────
  // Normally a wire (very low R). If current exceeds rating, goes open.
  // Once blown, stays open until reset (control = 1 to reset).
  registerDevice('fuse', {
    terminals: ['a', 'b'],

    init() {
      return {
        drives: {},
        blown: false,
      };
    },

    stamp(ctx, part, state) {
      if (!state.blown) {
        // Intact fuse: very low resistance
        ctx.conductance('a', 'b', 1 / 0.01); // 10 mΩ
      }
      // Blown: open circuit (no conductance)
    },

    update(part, state, read) {
      // Reset via control
      const ctrl = part.params?._control;
      if (ctrl === 1 && state.blown) {
        state.blown = false;
        return true;
      }
      // Check current (approximate from voltage difference and fuse R)
      if (!state.blown) {
        const vA = read('a');
        const vB = read('b');
        const current = Math.abs(vA - vB) / 0.01;
        const rating = part.params?.amps ?? 1.0;
        if (current > rating * 1.5) { // 150% of rating = blow
          state.blown = true;
          return true;
        }
      }
      return false;
    },
  });
}
