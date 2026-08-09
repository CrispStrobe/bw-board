/**
 * DC motor — back-EMF + winding R, speed state integrated in advanceTo.
 *
 * Electrical: V = I * R_winding + kV * omega
 * Mechanical: torque = kT * I - loadTorque, alpha = torque / J
 *
 * The motor appears as a resistor (R_winding) in series with a voltage
 * source (kV * omega). As a stamp: Thévenin on one terminal relative to
 * the other — vTh = kV * omega, rTh = R_winding.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

/**
 * Register the DC motor device model.
 */
export function registerDCMotor() {
  registerDevice('dc_motor', {
    terminals: ['a', 'b'],

    init(part) {
      return {
        drives: {},
        omega: 0,    // angular velocity (rad/s)
        _lastTNs: 0n,
      };
    },

    stamp(ctx, part, state) {
      const R = part.params?.windingR ?? 10;
      const kV = part.params?.kV ?? 0.01;

      // Motor as Thévenin: back-EMF voltage source (kV * omega) in series
      // with winding resistance. Between terminals a and b.
      // The stamp is: conductance between a and b of 1/R, plus a current
      // source representing the back-EMF.
      ctx.conductance('a', 'b', 1 / R);
      // Back-EMF: acts as a voltage source kV*omega opposing current flow.
      // As Norton equivalent: I_norton = (kV * omega) / R
      // Current flows from b to a (opposing the applied voltage direction).
      const backEMF = kV * state.omega;
      if (Math.abs(backEMF) > 1e-12) {
        ctx.current('a', -backEMF / R);
        ctx.current('b', backEMF / R);
      }
    },

    update(part, state, read, tNs) {
      const R = part.params?.windingR ?? 10;
      const kV = part.params?.kV ?? 0.01;
      const kT = part.params?.kT ?? kV; // ideal motor: kT = kV
      const J = part.params?.J ?? 0.001;
      const loadTorque = part.params?.loadTorque ?? 0;

      // Time step
      if (state._lastTNs === 0n) {
        state._lastTNs = tNs;
        return false;
      }
      const dtSec = Number(tNs - state._lastTNs) / 1e9;
      state._lastTNs = tNs;
      if (dtSec <= 0) return false;

      // Motor current: I = (V_a - V_b - kV * omega) / R
      const vA = read('a');
      const vB = read('b');
      const current = (vA - vB - kV * state.omega) / R;

      // Mechanical dynamics
      const torque = kT * current - loadTorque;
      const alpha = torque / J;
      const oldOmega = state.omega;
      state.omega = Math.max(0, state.omega + alpha * dtSec); // clamp to >= 0

      // Re-solve if omega changed significantly (affects back-EMF stamp)
      if (Math.abs(state.omega - oldOmega) > 0.1) {
        return true;
      }
      return false;
    },
  });
}
