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
  // A stepper is UNIPOLAR or BIPOLAR and the two are different motors, not
  // two names for one. Unipolar is five wires: four coils sharing a centre
  // tap, each pulled low in turn. Bipolar is four: two coils driven in BOTH
  // directions by an H-bridge, which is why a 28BYJ-48 needs a ULN2003 and a
  // NEMA-17 needs an L298.
  //
  // This modelled only the unipolar one, so bw-parts' four-wire sidecar
  // (coil_a1/coil_b1/coil_a2/coil_b2) described a motor the engine could not
  // wire — counted as unreachable pins by the terminal cross-check for
  // months. params.wiring picks; the default stays unipolar, so every
  // existing bench keeps its terminals.
  const UNIPOLAR = ['coil1', 'coil2', 'coil3', 'coil4', 'com'];
  const BIPOLAR = ['coil_a1', 'coil_a2', 'coil_b1', 'coil_b2'];
  const isBipolar = (part) => part?.params?.wiring === 'bipolar';

  registerDevice('stepper', {
    terminals: UNIPOLAR,
    terminalsFor: (part) => (isBipolar(part) ? BIPOLAR : UNIPOLAR),

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
      if (isBipolar(part)) {
        // Two coils, end to end. No common: current runs either way through
        // each, and the direction is what the phase is made of.
        ctx.conductance('coil_a1', 'coil_a2', 1 / coilR);
        ctx.conductance('coil_b1', 'coil_b2', 1 / coilR);
        return;
      }
      // Each coil: conductance from com to coilN
      for (let i = 1; i <= 4; i++) {
        ctx.conductance('com', `coil${i}`, 1 / coilR);
      }
    },

    update(part, state, read) {
      const active = [];
      if (isBipolar(part)) {
        // Phase comes from the SIGN of the voltage across each coil, which is
        // the whole difference: a unipolar phase is "which wire is low", a
        // bipolar one is "which way is the current going". Full-step order is
        // A+, B+, A-, B- — the same four positions the unipolar sequence
        // walks, reached differently.
        const vA = read('coil_a1') - read('coil_a2');
        const vB = read('coil_b1') - read('coil_b2');
        const th = 1.0;                       // volts across a coil to count
        if (vA > th) active.push(1);
        if (vB > th) active.push(2);
        if (vA < -th) active.push(3);
        if (vB < -th) active.push(4);
      } else {
        const vCom = read('com');
        const threshold = vCom * 0.3; // coil is active when pulled LOW (sinking)
        for (let i = 1; i <= 4; i++) {
          const vCoil = read(`coil${i}`);
          if ((vCom - vCoil) > threshold) active.push(i);
        }
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
