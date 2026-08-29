/**
 * Servo motor — PWM pulse-width decoder, angle state with slew limit.
 *
 * Decodes the pulse width on the signal pin (rising→falling edge) and
 * maps it to a target angle. The actual angle slews toward the target
 * at a configurable rate.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

// Input pins draw nothing here, on purpose. These models used to declare
// `ctx.conductance(pin, null, 1 / R_INPUT)` with R_INPUT = 1e6 — a call that
// names no second terminal, which stampTwoTerminal's air-leg guard declines,
// so it never stamped. 1 MOhm is not a CMOS input either (a 74HC draws 1 uA
// max). The ideal high-Z input IS the model, and GMIN keeps every pin a real
// node. See spec-updates/ideal-high-z-inputs.md.

/**
 * Register the servo device model.
 */
export function registerServo() {
  registerDevice('servo', {
    terminals: ['signal', 'vcc', 'gnd'],

    init(part) {
      return {
        drives: {},
        targetAngle: 90,  // degrees, start at center
        actualAngle: 90,
        _lastTNs: 0n,
        _signalHigh: false,
        _riseNs: 0n,
      };
    },

    // No stamp. Signal pin: an ideal high-impedance input, which is what this
    // model computes — the 1 MOhm declared here named no second terminal and
    // never stamped (spec-updates/ideal-high-z-inputs.md).
    // VCC/GND: power draw not modeled (would need current spec)

    // Boundary B setDeviceControl (spec-updates/set-device-control.md):
    // 'angle' sets the TARGET; the slew limit stays the model's honesty —
    // a real servo does not teleport.
    control(part, state, verb, value) {
      if (verb === 'angle') {
        state.targetAngle = Math.max(0, Math.min(180, Number(value) || 0));
        return true;
      }
      return false;
    },

    update(part, state, read, tNs) {
      const minPulseUs = part.params?.minPulseUs ?? 1000;
      const maxPulseUs = part.params?.maxPulseUs ?? 2000;
      const maxAngle = part.params?.maxAngle ?? 180;
      const slewRate = part.params?.slewRate ?? 300; // deg/s

      const vcc = read('vcc') || 5.0;
      const vSignal = read('signal');
      const threshold = vcc * 0.5;

      // Edge detection
      const isHigh = vSignal > threshold;
      let angleChanged = false;

      if (isHigh && !state._signalHigh) {
        // Rising edge
        state._riseNs = tNs;
      } else if (!isHigh && state._signalHigh) {
        // Falling edge — measure pulse width
        const pulseNs = Number(tNs - state._riseNs);
        const pulseUs = pulseNs / 1000;

        if (pulseUs >= minPulseUs * 0.8 && pulseUs <= maxPulseUs * 1.2) {
          const frac = (pulseUs - minPulseUs) / (maxPulseUs - minPulseUs);
          const newTarget = Math.max(0, Math.min(maxAngle, frac * maxAngle));
          if (Math.abs(newTarget - state.targetAngle) > 0.1) {
            state.targetAngle = newTarget;
            angleChanged = true;
          }
        }
      }
      state._signalHigh = isHigh;

      // Slew toward target
      if (state._lastTNs > 0n) {
        const dtSec = Number(tNs - state._lastTNs) / 1e9;
        if (dtSec > 0) {
          const diff = state.targetAngle - state.actualAngle;
          const maxStep = slewRate * dtSec;
          if (Math.abs(diff) > 0.01) {
            state.actualAngle += Math.sign(diff) * Math.min(Math.abs(diff), maxStep);
            angleChanged = true;
          }
        }
      }
      state._lastTNs = tNs;

      return angleChanged;
    },
  });
}
