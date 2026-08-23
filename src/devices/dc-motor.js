/**
 * DC motor — back-EMF + winding R + optional series inductance,
 * speed state integrated in advanceTo.
 *
 * Electrical: V = I * R_winding + L * dI/dt + kV * omega
 * Mechanical: torque = kT * I - loadTorque, alpha = torque / J
 *
 * The motor appears as a resistor (R_winding) in series with a voltage
 * source (kV * omega). As a stamp: Thévenin on one terminal relative to
 * the other — vTh = kV * omega, rTh = R_winding.
 *
 * params.R is accepted as alias for params.windingR — several gallery
 * circuits declared R and it was silently discarded (both mapped to 10,
 * masking the bug).  params.windingH adds series inductance (default
 * 0.005 = 5 mH, a realistic small motor).
 *
 * @module
 */

import { registerDevice } from '../devices.js';

/** Read winding resistance: accept R as alias for windingR */
function getR(part) {
  return part.params?.windingR ?? part.params?.R ?? 10;
}

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
        current: 0,  // winding current for inductance model
        _lastTNs: 0n,
      };
    },

    stamp(ctx, part, state) {
      const R = getR(part);
      const kV = part.params?.kV ?? 0.01;
      const L = part.params?.windingH ?? 0.005;

      // Motor as Thévenin between its own pins: back-EMF (kV·omega, + at a)
      // in series with the winding resistance, so I(a→b) = (Va−Vb−e)/R —
      // the same equation update() integrates the mechanics from.
      //
      // The previous hand-built Norton pair had the EMF sign INVERTED
      // (injected −e/R into a where the Thévenin→Norton transform gives
      // +e/R): electrically the motor drew MORE current the faster it
      // spun, I = (V+e)/R. Nothing caught it because the mechanical loop
      // uses its own correct formula and stiff supplies hid the node
      // shift; a series resistor exposes it — see the free-running oracle
      // in test/referenced-drives.test.mjs.
      ctx.theveninBetween('a', 'b', kV * state.omega, R);

      // Series inductance: backward-Euler companion model adds a
      // conductance dt/L and a Norton current source of the previous
      // current. Only active during transient sub-steps (dtSec present).
      if (L > 0 && ctx.dtSec) {
        const gL = ctx.dtSec / Math.max(L, 1e-12);
        ctx.conductance('a', 'b', gL);
        // Norton source from previous inductor current
        if (Math.abs(state.current) > 1e-12) {
          ctx.current('a', -state.current);
          ctx.current('b', state.current);
        }
      }
    },

    update(part, state, read, tNs) {
      const R = getR(part);
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
      state.current = current;

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
