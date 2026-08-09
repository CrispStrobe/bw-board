/**
 * Motor driver and actuator devices — stepper motor, solenoid.
 *
 * stepper: 4-phase unipolar stepper motor. Controlled by 4 coil pins.
 * solenoid: electromagnetic actuator. Coil + plunger state.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

/**
 * Register motor driver and actuator device models.
 */
export function registerMotorDrivers() {

  // ─── Stepper motor (unipolar, 4 coils) ────────────────────────────
  // Terminals: coil1, coil2, coil3, coil4, com (common / VCC).
  // Phase sequence (full step): 1-2-3-4.
  // Step angle = 360 / stepsPerRev (default 200 = 1.8° per step).
  registerDevice('stepper', {
    terminals: ['coil1', 'coil2', 'coil3', 'coil4', 'com'],

    init(part) {
      return {
        drives: {},
        stepCount: 0,
        angle: 0, // degrees
        _lastPhase: -1,
      };
    },

    stamp(ctx, part) {
      const coilR = part.params?.coilR ?? 30; // typical unipolar coil resistance
      // Each coil: conductance from com to coilN
      for (let i = 1; i <= 4; i++) {
        ctx.conductance('com', `coil${i}`, 1 / coilR);
      }
    },

    update(part, state, read) {
      const vCom = read('com');
      const threshold = vCom * 0.3; // coil is active when pulled LOW (sinking)

      // Determine which phase(s) are active (sinking current)
      const active = [];
      for (let i = 1; i <= 4; i++) {
        const vCoil = read(`coil${i}`);
        if ((vCom - vCoil) > threshold) active.push(i);
      }

      // Detect phase from active coils (full step sequence: 1,2,3,4)
      let phase = -1;
      if (active.length === 1) {
        phase = active[0] - 1; // 0-indexed
      } else if (active.length === 2) {
        // Half-step: between two phases
        phase = ((active[0] - 1) + (active[1] - 1)) / 2;
      }

      if (phase < 0 || phase === state._lastPhase) return false;

      // Detect direction from phase transition
      const stepsPerRev = part.params?.stepsPerRev ?? 200;
      const stepAngle = 360 / stepsPerRev;
      const diff = phase - state._lastPhase;

      if (state._lastPhase >= 0) {
        // Forward: phase increments (wrapping 3→0)
        if (diff === 1 || diff === -3) {
          state.stepCount++;
          state.angle = (state.angle + stepAngle) % 360;
        } else if (diff === -1 || diff === 3) {
          state.stepCount--;
          state.angle = (state.angle - stepAngle + 360) % 360;
        }
      }

      state._lastPhase = phase;
      return false; // angle changed but no electrical re-solve needed
    },
  });

  // ─── Solenoid ─────────────────────────────────────────────────────
  // Electromagnetic linear actuator. Coil energizes → plunger extends.
  // Terminals: coil_a, coil_b (just a coil, like relay but no contacts).
  registerDevice('solenoid', {
    terminals: ['coil_a', 'coil_b'],

    init() {
      return {
        drives: {},
        extended: false,
      };
    },

    stamp(ctx, part) {
      const coilR = part.params?.coilR ?? 50;
      ctx.conductance('coil_a', 'coil_b', 1 / coilR);
    },

    update(part, state, read) {
      const vA = read('coil_a');
      const vB = read('coil_b');
      const vCoil = Math.abs(vA - vB);
      const pullInV = part.params?.pullInV ?? 3.0;
      const dropOutV = part.params?.dropOutV ?? 1.0;

      let newState = state.extended;
      if (vCoil > pullInV) newState = true;
      else if (vCoil < dropOutV) newState = false;

      if (newState === state.extended) return false;
      state.extended = newState;
      return false; // mechanical state, no electrical re-solve
    },
  });
}
