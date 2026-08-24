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

      // Motor as Thévenin between its own pins: back-EMF (kV·omega, + at
      // a) behind the winding resistance — the EMF sign matters (the
      // original Norton pair had it INVERTED, so the motor drew MORE
      // current the faster it spun; the free-running oracle in
      // test/referenced-drives.test.mjs keeps that dead).
      //
      // The winding INDUCTANCE is deliberately NOT stamped here: the
      // board expands every dc_motor into motor + a first-class solver
      // inductor on a hidden series net (_expandMotorWindings). A
      // device-side inductor companion cannot be made consistent with
      // the adaptive integrator — frozen Norton memory across the
      // step-doubling's sub-solves, update cadence out of step with the
      // solver's histories; the failure modes (a permanent err ≈ 0.73
      // phantom, a period-2h oscillator, a 1e35 V series blow-up) are
      // written up at the expansion site.
      void L;
      ctx.theveninBetween('a', 'b', kV * state.omega, R);
    },

    // Terminal currents, so an ammeter probe on a motor lead reads the
    // winding current rather than the flat 0 `branchCurrent` returns for a
    // terminal no rule fills. Same expression `update` uses below, and for
    // the same reason it is exact: the board expands the winding L onto a
    // hidden series net, so 'a' sits between L and R and the resistive
    // formula IS the series current.
    //
    // Sign follows the resistor convention in mna.js (current out of the
    // part at the terminal), so a meter placed in either lead agrees with
    // one placed in a series resistor.
    branchCurrents(part, state, read) {
      const R = getR(part);
      const kV = part.params?.kV ?? 0.01;
      const i = (read('a') - read('b') - kV * state.omega) / R;
      return new Map([['a', -i], ['b', i]]);
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

      // With the winding L expanded into a solver inductor, the motor's
      // 'a' pin sits on the hidden net BETWEEN L and R — so this
      // resistive formula reads the true series winding current.
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
