import {shaftElectricalStep} from '../mechanical-shaft.js';
/**
 * Miscellaneous parts to complete the target inventory:
 *
 * - dc_motor_encoder: DC motor + quadrature encoder output
 * - timer_556: dual 555 (composed — two independent 555 channels)
 * - keypad_4x4: 4×4 matrix keypad (16 buttons, 8 pins)
 * - dip_switch: N-position DIP switch (array of independent switches)
 * - polarized_cap: electrolytic capacitor (a solver capacitor + polarity check)
 * - vibration_motor: like DC motor but only cares about on/off state
 *
 * @module
 */

import { registerDevice } from '../devices.js';
import { stepMotorVelocity, motorDirectionOf } from './dc-motor.js';

const R_OUT = 50;
/** Default rotor inertia of the encoder motor (kg·m²): a small hobby motor. */
export const ENCODER_MOTOR_J = 5e-7;

/**
 * Register miscellaneous parts.
 */
export function registerMiscParts() {

  // ─── DC motor with quadrature encoder ─────────────────────────────
  // Same as dc_motor but additionally outputs quadrature signals (A, B)
  // based on angular position. Pulses per revolution configurable.
  //
  // SIGNED like dc_motor (Lite task B14): `velocity` is the rotor's signed
  // angular velocity (+ forward, current a -> b), stepped by dc_motor's own
  // stepMotorVelocity; `angle` integrates it, so in reverse it falls and the
  // quadrature phases run backwards (B leads A), as a real encoder's do;
  // `count` is the signed quadrature edge count a decoder would hold (4 per
  // pulse); `omega` stays the speed, `direction` what the `direction of
  // motor` reporter reads. Until 2026-10 omega was clamped at 0, so driven
  // backwards the motor sat still and the encoder never moved.
  //
  // MECHANICS (2026-11): params.loadTorque (N·m, Coulomb: opposes motion,
  // cannot start it) and params.friction (viscous, N·m·s/rad) load the
  // shaft, so the steady speed is the torque balance
  //   kT (V − kV w)/R = loadTorque + friction·w.
  // The default rotor inertia is a small hobby motor's, J = 5e-7 kg·m²: with
  // the default kV 0.01 and 10 Ohm winding the mechanical time constant
  // J·R/(kT·kV) is 50 ms, so it is at speed in about 0.25 s. It was 1e-3,
  // a 100 s time constant -- about 200 s of simulated time to spin up.
  registerDevice('dc_motor_encoder', {
    terminals: ['a', 'b', 'enc_a', 'enc_b'],

    init(part) {
      return {
        drives: {
          enc_a: { vTh: 0, rTh: R_OUT },
          enc_b: { vTh: 0, rTh: R_OUT },
        },
        velocity: 0,
        omega: 0,
        direction: 'stopped',
        angle: 0,      // cumulative SIGNED angle in radians
        count: 0,      // signed quadrature edge count
        _lastTNs: 0n,
        _lastSlot: 0,
      };
    },

    stamp(ctx, part, state) {
      const R = part.params?.windingR ?? 10;
      const kV = part.params?.kV ?? 0.01;
      // dc_motor's stamp: back-EMF (kV x signed velocity, + at a) behind the
      // winding resistance. This model's own Norton pair had the EMF INVERTED
      // (the bug dc_motor shed earlier, test/referenced-drives.test.mjs): an
      // open-circuit motor braked itself, a driven one ran at ~40 % of V/kV,
      // and once signed, a coasting rotor that reached 0 crept into reverse.
      ctx.theveninBetween('a', 'b', kV * state.velocity, R);
    },

    update(part, state, read, tNs) {
      if (shaftElectricalStep(part, state, read, tNs)) return false;
      const R = part.params?.windingR ?? 10;
      const kV = part.params?.kV ?? 0.01;
      const kT = part.params?.kT ?? kV;
      const J = part.params?.J ?? ENCODER_MOTOR_J;
      const loadTorque = part.params?.loadTorque ?? 0;
      const friction = part.params?.friction ?? 0;
      const ppr = part.params?.pulsesPerRev ?? 20; // encoder pulses per revolution
      const vcc = read('vcc') || 5.0;

      if (state._lastTNs === 0n) { state._lastTNs = tNs; return false; }
      const dtSec = Number(tNs - state._lastTNs) / 1e9;
      state._lastTNs = tNs;
      if (dtSec <= 0) return false;

      // Motor dynamics
      const vA = read('a');
      const vB = read('b');
      const v0 = state.velocity;
      const current = (vA - vB - kV * v0) / R;
      const v1 = stepMotorVelocity(v0, kT * current, loadTorque, J, dtSec, friction);
      state.velocity = v1;
      state.omega = Math.abs(v1);
      state.direction = motorDirectionOf(v1);
      state.angle += v1 * dtSec;
      state._angleAtSec = Number(tNs) / 1e9;

      // Quadrature encoder: divide rotation into slots. The edge index is
      // signed (floor of a negative angle), its slot wraps into 0..n-1.
      const slotsPerRev = ppr * 4; // 4 edges per pulse (quadrature)
      const edge = Math.floor((state.angle / (2 * Math.PI)) * slotsPerRev);
      state.count = edge;
      const slot = ((edge % slotsPerRev) + slotsPerRev) % slotsPerRev;

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

  // ─── Function generator ──────────────────────────────────────────
  // A bench waveform source: OUT against its own GND lead, through a 50 Ω
  // output impedance (params.rOut). The waveform is the vsource vocabulary —
  // params.wave 'sine' (default) | 'square' | 'pulse' | 'triangle' | 'dc',
  // freq (Hz, default 1000; `frequency` accepted), amplitude (V peak,
  // default 1), offset (V), duty, phase (deg). The ELECTRICAL part is built
  // by the board in its solver view (BoardImpl._expandFunctionGenerators):
  // a hidden waveform vsource plus the output resistor, so the transient
  // integrator sees its edges and corners exactly as it sees any source's.
  // This registration is what lets a netlist name the kind at all — before
  // it, `function_gen` was refused as unknown and builders hand-wired a
  // vsource with wave params instead.
  registerDevice('function_gen', {
    terminals: ['out', 'gnd'],
    init() { return { drives: {} }; },
  });

  // ─── Oscilloscope (passive probe) ────────────────────────────────
  // Two channels against a common ground lead, each a 1 MΩ input
  // (params.inputOhms) — the standard scope input. It only LOADS the
  // circuit; the waveform itself is read through addScopeChannel on the
  // channel's net. Registered so a circuit that includes the instrument
  // is accepted and solves with the loading a real scope adds.
  registerDevice('oscilloscope', {
    terminals: ['ch1', 'ch2', 'gnd'],
    init() { return { drives: {} }; },
    stamp(ctx, part) {
      const r = Number(part.params?.inputOhms ?? 1e6);
      if (!(r > 0)) throw new Error(`oscilloscope ${part.id}: inputOhms must be positive`);
      ctx.conductance('ch1', 'gnd', 1 / r);
      ctx.conductance('ch2', 'gnd', 1 / r);
    },
  });

  // ─── Slide switch (SPDT) ─────────────────────────────────────────
  // Three-terminal SPDT: position 0 connects a↔com, position 1 connects
  // b↔com. The position is the board control (setControl(id, 0|1), the
  // same channel as a switch or button) and falls back to params.position,
  // default 0 — so it is operable like every other contact, not only by
  // rewriting its params.
  registerDevice('slide_switch', {
    terminals: ['a', 'com', 'b'],
    init() { return { drives: {}, _pos: -1 }; },
    stamp(ctx, part) {
      const pos = Number.isFinite(ctx.control) ? (ctx.control >= 0.5 ? 1 : 0)
        : (part.params?.position ?? 0);
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
  // An electrolytic: electrically a CAPACITOR. The board gives the solver a
  // real capacitor across pos/neg (BoardImpl._expandPolarizedCaps, a hidden
  // `<id>_cap` part, like a motor's winding inductor) -- trapezoidal
  // companion, error control, getCapVoltage(id). Until 2026-11 this model
  // stamped a flat 1 MOhm here and nothing else, so an electrolytic never
  // charged. What THIS model adds is the polarity: `reversed` latches true
  // while neg sits more than params.reverseVolts (default 0.5 V) above pos,
  // and the board reports it in getWarnings (type 'polarized-cap-reversed'),
  // the way it reports an LED wired backwards. params.leakageOhms (optional)
  // adds the DC leakage a real electrolytic has; absent, it has none.
  registerDevice('polarized_cap', {
    terminals: ['pos', 'neg'],

    init() {
      return { drives: {}, voltage: 0, reversed: false, _reversed: false };
    },

    stamp(ctx, part) {
      const leak = Number(part.params?.leakageOhms);
      if (Number.isFinite(leak) && leak > 0) ctx.conductance('pos', 'neg', 1 / leak);
    },

    update(part, state, read) {
      const vPos = read('pos');
      const vNeg = read('neg');
      state.voltage = vPos - vNeg;
      const limit = Number(part.params?.reverseVolts ?? 0.5);
      state.reversed = state.voltage < -(Number.isFinite(limit) ? Math.abs(limit) : 0.5);
      state._reversed = state.reversed;
      return false;
    },
  });
}
