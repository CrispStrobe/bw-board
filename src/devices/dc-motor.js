import {shaftElectricalStep} from '../mechanical-shaft.js';
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
import { classDefaults } from '../parts-library.js';

/** Below this speed (rad/s, about 0.1 rpm) the motor reports 'stopped'. */
const STOPPED_RAD_S = 0.01;

/**
 * One explicit step of a motor's SIGNED rotor velocity (rad/s) — the shared
 * mechanics of every DC-motor model (dc_motor, gearmotor, dc_motor_encoder),
 * so a motor driven backwards turns backwards whichever model it is.
 *
 * `drive` is the electrical torque kT·i (signed). The load torque opposes the
 * motion, whichever way it turns (at rest it opposes the drive; it cannot
 * start one). A step that would carry the rotor THROUGH zero stops it at
 * zero: an explicit step longer than the motor's electrical-mechanical time
 * constant overshoots, and the old clamp at 0 was what stopped that. From
 * rest the next step's torque decides the direction, so forward motion is
 * exactly what it was under the clamp (`Math.max(0, v + drive/J·dt)`), and
 * reverse is new.
 *
 * `friction` is VISCOUS friction b (N·m·s/rad): a torque −b·v. It is taken
 * semi-implicitly, v1 = (v0 + (drive ∓ load)/J·dt) / (1 + b·dt/J), so a
 * large b on a light rotor damps to the torque balance instead of
 * overshooting. Absent (0), the step is exactly the explicit one above.
 *
 * @param {number} v0 signed velocity before the step
 * @param {number} drive signed electrical torque
 * @param {number} loadTorque magnitude of the opposing load torque
 * @param {number} J rotor inertia
 * @param {number} dtSec step length
 * @param {number} [friction] viscous friction coefficient b (≥ 0)
 * @returns {number} signed velocity after the step
 */
export function stepMotorVelocity(v0, drive, loadTorque, J, dtSec, friction = 0) {
  const sense = v0 !== 0 ? Math.sign(v0) : Math.sign(drive);
  const torque = drive - sense * loadTorque;
  const alpha = torque / J;
  let v1 = v0 + alpha * dtSec;
  if (friction > 0) v1 /= 1 + friction * dtSec / J;
  if ((v0 > 0 && v1 < 0) || (v0 < 0 && v1 > 0)) v1 = 0;
  // Load torque cannot start a motor turning the other way.
  if (v0 === 0 && Math.abs(drive) <= loadTorque) v1 = 0;
  return v1;
}

/**
 * The `direction` a motor reports for a signed velocity — what the devices
 * blocks' `direction of motor` reporter reads, for every motor model.
 * @param {number} v signed velocity (rad/s)
 * @returns {'forward'|'reverse'|'stopped'}
 */
export function motorDirectionOf(v) {
  return v > STOPPED_RAD_S ? 'forward' : v < -STOPPED_RAD_S ? 'reverse' : 'stopped';
}

/**
 * THE SHAFT ANGLE, for anything mounted on the shaft (a slotted disc
 * chopping a light path, src/optics.js). Integrated with the trapezoidal rule
 * over each mechanical step, as a signed cumulative angle in radians, and
 * stamped with the time it holds at (`_angleAtSec`).
 */
export function advanceShaftAngle(state, v0, v1, dtSec, atSec) {
  state.angle = (Number.isFinite(state.angle) ? state.angle : 0) + 0.5 * (v0 + v1) * dtSec;
  state._angleAtSec = atSec;
}

/**
 * The shaft angle (rad) of a motor's device state at time `tSec`: the last
 * integrated angle carried forward at the present velocity. A gearmotor's
 * `gearRatio` turns it into its OUTPUT shaft's angle when `output` is set.
 */
export function motorShaftAngle(state, tSec, part = null, output = false) {
  if (!state) return 0;
  const base = Number.isFinite(state.angle) ? state.angle : 0;
  const at = Number.isFinite(state._angleAtSec) ? state._angleAtSec : tSec;
  const v = state.velocity ?? state.omega ?? 0;
  const angle = base + v * Math.max(0, tSec - at);
  const ratio = output && part?.kind === 'gearmotor' ? Number(part.params?.gearRatio ?? 48) || 1 : 1;
  return angle / ratio;
}

/**
 * THE BACK-EMF IS A RAMP, NOT A STAIRCASE.
 *
 * The speed is stepped in `update()`, once per accepted solve or device
 * sub-step, and the EMF used to jump to each new speed. A jump of kV x the
 * speed change, applied to the winding inductance behind a node held by
 * nothing but a transistor's 5 pF input capacitance (an emitter follower
 * whose transistor has just turned off, the motor coasting), rang that LC at
 * about 1 MHz after every update: ~1,800 integration attempts per 50 ms of
 * coast-down, 45k attempts and ~30 s of wall time for the airflow bench's
 * fan to stop, and a 1 s advance ran out of device sub-step work.
 *
 * Between updates the stamp now carries the speed forward at the last step's
 * acceleration, from the time of that update, so the EMF the network sees is
 * continuous; it is clamped at zero rather than reversing (the mechanics stop
 * a coasting rotor at zero, `stepMotorVelocity`). At the update instant the
 * offset is zero, so every published solution reads the stepped speed itself.
 */
function emfVelocity(state, tSec) {
  const v = state.velocity ?? state.omega;
  const a = state._emfAccel;
  if (!a || !Number.isFinite(tSec) || !(tSec > state._emfAtSec)) return v;
  const w = v + a * (tSec - state._emfAtSec);
  return (v > 0 && w < 0) || (v < 0 && w > 0) ? 0 : w;
}

/** Read winding resistance: accept R as alias for windingR */
function getR(part) {
  return part.params?.windingR ?? part.params?.R ?? classDefaults('dc_motor').ohms;
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
        // SIGNED angular velocity (rad/s): + turns forward (current a -> b),
        // - turns in reverse. `omega` stays the SPEED, |velocity|, so every
        // reader that took it as a speed reads exactly what it read before;
        // `direction` is what the devices blocks' `direction of motor`
        // reporter asks for. Until 2026-10 the model clamped omega at 0, so a
        // motor driven backwards (an H-bridge in reverse, or simply wired
        // b-to-pin) sat still and every motor reported no direction at all.
        velocity: 0,
        omega: 0,
        direction: 'stopped',
        // Cumulative SIGNED shaft angle (rad) at `_angleAtSec`: what a
        // slotted disc on the shaft reads (motorShaftAngle).
        angle: 0,
        _angleAtSec: 0,
        current: 0,  // winding current for inductance model
        _lastTNs: 0n,
      };
    },

    // A board reset is a new run from rest: the rotor stops and the
    // integrator's clock restarts with the board's.
    reset(part, state) {
      state.velocity = 0;
      state.omega = 0;
      state.direction = 'stopped';
      state.angle = 0;
      state._angleAtSec = 0;
      state.current = 0;
      state._lastTNs = 0n;
      state._emfAccel = 0;
    },

    stamp(ctx, part, state) {
      const R = getR(part);
      const kV = part.params?.kV ?? classDefaults('dc_motor').kV;
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
      ctx.theveninBetween('a', 'b', kV * emfVelocity(state, ctx.tSeconds), R);
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
    branchCurrents(part, state, read, tSeconds) {
      const R = getR(part);
      const kV = part.params?.kV ?? classDefaults('dc_motor').kV;
      // The EMF the stamp used at this solve's time (`emfVelocity`).
      const i = (read('a') - read('b') - kV * emfVelocity(state, tSeconds)) / R;
      return new Map([['a', -i], ['b', i]]);
    },

    update(part, state, read, tNs) {
      if (shaftElectricalStep(part, state, read, tNs)) return false;
      const R = getR(part);
      const kV = part.params?.kV ?? classDefaults('dc_motor').kV;
      const kT = part.params?.kT ?? kV; // ideal motor: kT = kV
      const J = part.params?.J ?? 0.001;
      const loadTorque = part.params?.loadTorque ?? 0;
      const friction = part.params?.friction ?? 0;

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
      const v0 = state.velocity ?? state.omega;
      const current = (vA - vB - kV * v0) / R;
      state.current = current;

      // Mechanical dynamics (signed; see stepMotorVelocity).
      const v1 = stepMotorVelocity(v0, kT * current, loadTorque, J, dtSec, friction);
      // What the stamp has been extrapolating to this instant (`emfVelocity`).
      const predicted = emfVelocity(state, Number(tNs) / 1e9);
      state.velocity = v1;
      state.omega = Math.abs(v1);
      state.direction = motorDirectionOf(v1);
      advanceShaftAngle(state, v0, v1, dtSec, Number(tNs) / 1e9);
      state._emfAccel = (v1 - v0) / dtSec;
      state._emfAtSec = Number(tNs) / 1e9;

      // Re-solve if the back-EMF the network saw missed the new speed by
      // enough to matter (a steady acceleration is already in the ramp).
      return Math.abs(v1 - predicted) > 0.1;
    },
  });
}
