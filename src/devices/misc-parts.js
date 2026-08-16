/**
 * Miscellaneous parts to complete the target inventory:
 *
 * - dc_motor_encoder: DC motor + quadrature encoder output
 * - timer_556: dual 555 (composed — two independent 555 channels)
 * - keypad_4x4: 4×4 matrix keypad (16 buttons, 8 pins)
 * - dip_switch: N-position DIP switch (array of independent switches)
 * - polarized_cap: polarized capacitor (same as cap but validates polarity)
 * - vibration_motor: like DC motor but only cares about on/off state
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_INPUT = 1e6;
const R_OUT = 50;

/**
 * Register miscellaneous parts.
 */
export function registerMiscParts() {

  // ─── DC motor with quadrature encoder ─────────────────────────────
  // Same as dc_motor but additionally outputs quadrature signals (A, B)
  // based on angular position. Pulses per revolution configurable.
  registerDevice('dc_motor_encoder', {
    terminals: ['a', 'b', 'enc_a', 'enc_b'],

    init(part) {
      return {
        drives: {
          enc_a: { vTh: 0, rTh: R_OUT },
          enc_b: { vTh: 0, rTh: R_OUT },
        },
        omega: 0,
        angle: 0,      // cumulative angle in radians
        _lastTNs: 0n,
        _lastSlot: 0,
      };
    },

    stamp(ctx, part, state) {
      const R = part.params?.windingR ?? 10;
      const kV = part.params?.kV ?? 0.01;
      ctx.conductance('a', 'b', 1 / R);
      // Back-EMF
      const backEMF = kV * state.omega;
      if (Math.abs(backEMF) > 1e-12) {
        ctx.current('a', -backEMF / R);
        ctx.current('b', backEMF / R);
      }
    },

    update(part, state, read, tNs) {
      const R = part.params?.windingR ?? 10;
      const kV = part.params?.kV ?? 0.01;
      const kT = part.params?.kT ?? kV;
      const J = part.params?.J ?? 0.001;
      const ppr = part.params?.pulsesPerRev ?? 20; // encoder pulses per revolution
      const vcc = 5.0;

      if (state._lastTNs === 0n) { state._lastTNs = tNs; return false; }
      const dtSec = Number(tNs - state._lastTNs) / 1e9;
      state._lastTNs = tNs;
      if (dtSec <= 0) return false;

      // Motor dynamics
      const vA = read('a');
      const vB = read('b');
      const current = (vA - vB - kV * state.omega) / R;
      const torque = kT * current;
      state.omega = Math.max(0, state.omega + (torque / J) * dtSec);
      state.angle += state.omega * dtSec;

      // Quadrature encoder: divide rotation into slots
      const slotsPerRev = ppr * 4; // 4 edges per pulse (quadrature)
      const slot = Math.floor((state.angle / (2 * Math.PI)) * slotsPerRev) % slotsPerRev;

      if (slot === state._lastSlot) return false;
      state._lastSlot = slot;

      // Quadrature pattern: A leads B by 90°
      const phase = slot % 4;
      const encA = (phase === 0 || phase === 1) ? 1 : 0;
      const encB = (phase === 1 || phase === 2) ? 1 : 0;

      state.drives.enc_a = { vTh: encA ? vcc : 0, rTh: R_OUT };
      state.drives.enc_b = { vTh: encB ? vcc : 0, rTh: R_OUT };
      return true;
    },
  });

  // ─── 4×4 Keypad ──────────────────────────────────────────────────
  // 8 pins: 4 rows (R0-R3) + 4 columns (C0-C3).
  // A pressed key shorts its row to its column.
  // Control param: key index 0-15 (or -1 for none pressed).
  registerDevice('keypad_4x4', {
    terminals: ['r0', 'r1', 'r2', 'r3', 'c0', 'c1', 'c2', 'c3'],

    init() {
      return { drives: {}, _pressed: -1 };
    },

    stamp(ctx, part, state) {
      const pressed = part.params?.pressed ?? -1;
      if (pressed >= 0 && pressed < 16) {
        const row = Math.floor(pressed / 4);
        const col = pressed % 4;
        // Short row to column with near-zero resistance
        ctx.conductance(`r${row}`, `c${col}`, 1 / 0.1);
      }
    },

    update(part, state) {
      const pressed = part.params?.pressed ?? -1;
      if (pressed === state._pressed) return false;
      state._pressed = pressed;
      return true; // re-stamp with new connection
    },
  });

  // ─── DIP switch (N positions) ─────────────────────────────────────
  // Each position is an independent SPST switch.
  // Terminals: s0_a, s0_b, s1_a, s1_b, ... sN_a, sN_b
  // For 4-position (most common): 8 terminals.
  registerDevice('dip_switch', {
    terminals: ['s0_a', 's0_b', 's1_a', 's1_b', 's2_a', 's2_b', 's3_a', 's3_b'],

    init() {
      return { drives: {}, _state: 0 }; // bitmask of closed switches
    },

    stamp(ctx, part, state) {
      const sw = part.params?.switches ?? 0; // bitmask
      for (let i = 0; i < 4; i++) {
        if ((sw >> i) & 1) {
          ctx.conductance(`s${i}_a`, `s${i}_b`, 1 / 0.1); // closed
        }
      }
    },

    update(part, state) {
      const sw = part.params?.switches ?? 0;
      if (sw === state._state) return false;
      state._state = sw;
      return true;
    },
  });

  // ─── Slide switch (SPDT) ─────────────────────────────────────────
  // Three-terminal SPDT: params.position = 0 connects a↔com,
  // position = 1 connects b↔com. Default position 0.
  registerDevice('slide_switch', {
    terminals: ['a', 'com', 'b'],
    init() { return { drives: {}, _pos: -1 }; },
    stamp(ctx, part) {
      const pos = part.params?.position ?? 0;
      if (pos === 0) ctx.conductance('a', 'com', 1 / 0.1);
      else           ctx.conductance('b', 'com', 1 / 0.1);
    },
    update(part, state) {
      const pos = part.params?.position ?? 0;
      if (pos === state._pos) return false;
      state._pos = pos;
      return true;
    },
  });

  // ─── DIP switch SPST variant ────────────────────────────────────
  // 4-position SPST — same as dip_switch but with 1-indexed terminal
  // names (1a/1b..4a/4b instead of s0_a/s0_b).
  registerDevice('dip_switch_spst', {
    terminals: ['1a', '2a', '3a', '4a', '1b', '2b', '3b', '4b'],
    init() { return { drives: {}, _state: 0 }; },
    stamp(ctx, part) {
      const sw = part.params?.switches ?? 0;
      for (let i = 0; i < 4; i++) {
        if ((sw >> i) & 1) ctx.conductance(`${i+1}a`, `${i+1}b`, 1 / 0.1);
      }
    },
    update(part, state) {
      const sw = part.params?.switches ?? 0;
      if (sw === state._state) return false;
      state._state = sw;
      return true;
    },
  });

  // ─── DIP switch DPST variant ────────────────────────────────────
  // 2-position DPST — each position has two independent contacts.
  registerDevice('dip_switch_dpst', {
    terminals: ['1a', '1b', '2a', '2b', '1a_out', '1b_out', '2a_out', '2b_out'],
    init() { return { drives: {}, _state: 0 }; },
    stamp(ctx, part) {
      const sw = part.params?.switches ?? 0;
      if ((sw >> 0) & 1) { ctx.conductance('1a', '1a_out', 1 / 0.1); ctx.conductance('1b', '1b_out', 1 / 0.1); }
      if ((sw >> 1) & 1) { ctx.conductance('2a', '2a_out', 1 / 0.1); ctx.conductance('2b', '2b_out', 1 / 0.1); }
    },
    update(part, state) {
      const sw = part.params?.switches ?? 0;
      if (sw === state._state) return false;
      state._state = sw;
      return true;
    },
  });

  // ─── Vibration motor ──────────────────────────────────────────────
  // Small DC motor — just cares about on/off and spin direction.
  // Modeled as a simple resistive load.
  registerDevice('vibration_motor', {
    terminals: ['a', 'b'],

    init() {
      return { drives: {}, vibrating: false };
    },

    stamp(ctx, part) {
      const ohms = part.params?.ohms ?? 15;
      ctx.conductance('a', 'b', 1 / ohms);
    },

    update(part, state, read) {
      const vA = read('a');
      const vB = read('b');
      const v = Math.abs(vA - vB);
      const threshold = part.params?.vThreshold ?? 1.5;
      const newVibrating = v > threshold;
      if (newVibrating === state.vibrating) return false;
      state.vibrating = newVibrating;
      return false; // mechanical state only
    },
  });

  // ─── Polarized capacitor ──────────────────────────────────────────
  // Electrically same as regular cap, but tracks whether voltage
  // polarity is correct (positive terminal should be higher voltage).
  // Incorrect polarity generates a warning.
  registerDevice('polarized_cap', {
    terminals: ['pos', 'neg'],

    init(part) {
      return { drives: {}, voltage: 0, _reversed: false };
    },

    stamp(ctx, part) {
      // Behaves as a capacitor — the actual C integration is handled
      // by the board's cap integrator if this kind is registered there.
      // For now: high impedance DC (cap blocks DC).
      ctx.conductance('pos', 'neg', 1 / R_INPUT);
    },

    update(part, state, read) {
      const vPos = read('pos');
      const vNeg = read('neg');
      state.voltage = vPos - vNeg;
      state._reversed = state.voltage < -0.5; // significant reverse bias
      return false;
    },
  });
}
