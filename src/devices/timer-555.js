/**
 * 555 timer — behavioral model.
 *
 * Two comparators + SR flip-flop + discharge switch.
 * Internal voltage divider provides 2/3 and 1/3 VCC thresholds
 * (overridden if the control pin is externally driven).
 *
 * Outputs:
 *   - output: Thévenin driver (HIGH/LOW via flip-flop)
 *   - discharge: controlled switch to GND (closed when output LOW)
 *
 * @module
 */

import { registerDevice, getDevice } from '../devices.js';

const R_OUT_DEFAULT = 50;
const R_DISCHARGE = 10;     // discharge switch on-resistance
const R_INPUT = 1e6;        // comparator input impedance
const R_DIVIDER = 5000;     // internal divider resistors (3 × 5kΩ)

/**
 * Register the 555 timer device model.
 */
export function registerTimer555() {
  registerDevice('timer_555', {
    terminals: ['vcc', 'gnd', 'trigger', 'threshold', 'control', 'discharge', 'output', 'reset'],

    init(part) {
      return {
        drives: {
          output: { vTh: 0, rTh: part.params?.rOut ?? R_OUT_DEFAULT },
        },
        ffOut: 0,            // flip-flop output: 0=LOW, 1=HIGH
        _dischargeActive: true, // discharge switch closed when output LOW
      };
    },

    stamp(ctx, part, state) {
      const rOut = part.params?.rOut ?? R_OUT_DEFAULT;

      // Input impedance on threshold, trigger, reset, control
      ctx.conductance('threshold', null, 1 / R_INPUT);
      ctx.conductance('trigger', null, 1 / R_INPUT);
      ctx.conductance('reset', null, 1 / R_INPUT);

      // Internal voltage divider: VCC → 5kΩ → control → 5kΩ → (1/3 tap) → 5kΩ → GND
      // This provides 2/3 VCC at the control pin and 1/3 VCC at the internal tap.
      // Stamp as conductance from vcc to control, and control to gnd.
      ctx.conductance('vcc', 'control', 1 / R_DIVIDER);       // top 5kΩ
      ctx.conductance('control', 'gnd', 1 / (R_DIVIDER * 2)); // bottom 10kΩ (two 5kΩ in series)

      // Discharge switch: when active, low resistance from discharge to gnd
      if (state._dischargeActive) {
        ctx.conductance('discharge', 'gnd', 1 / R_DISCHARGE);
      }

      // Output drive is handled by state.drives (generic device stamping)
    },

    update(part, state, read, tNs) {
      const vcc = read('vcc');
      const vGnd = read('gnd');
      const vThreshold = read('threshold');
      const vTrigger = read('trigger');
      const vControl = read('control');
      const vReset = read('reset');
      const rOut = part.params?.rOut ?? R_OUT_DEFAULT;

      // Effective VCC (relative to GND pin)
      const effectiveVcc = vcc - vGnd;
      if (effectiveVcc < 0.5) {
        // No power — output LOW, discharge closed
        if (state.ffOut !== 0) {
          state.ffOut = 0;
          state.drives.output = { vTh: vGnd, rTh: rOut };
          state._dischargeActive = true;
          return true;
        }
        return false;
      }

      // Control voltage sets the upper threshold.
      // If externally driven, it overrides the internal divider.
      // The internal divider makes control ≈ 2/3 VCC.
      const upperThreshold = vControl - vGnd;  // voltage at control relative to GND
      const lowerThreshold = upperThreshold / 2; // 1/3 VCC from the midpoint

      // Reset (active LOW): forces output LOW
      const resetActive = (vReset - vGnd) < (effectiveVcc * 0.3);

      let newFf = state.ffOut;

      if (resetActive) {
        newFf = 0;
      } else {
        // Upper comparator: threshold > control → RESET flip-flop (output LOW)
        if ((vThreshold - vGnd) > upperThreshold) {
          newFf = 0;
        }
        // Lower comparator: trigger < 1/3 VCC → SET flip-flop (output HIGH)
        // SET dominates if both conditions are true simultaneously (555 spec)
        if ((vTrigger - vGnd) < lowerThreshold) {
          newFf = 1;
        }
      }

      if (newFf === state.ffOut) return false;

      state.ffOut = newFf;
      // Output HIGH: drive to VCC. Output LOW: drive to GND.
      state.drives.output = {
        vTh: newFf ? vcc : vGnd,
        rTh: rOut,
      };
      // Discharge switch: closed when output is LOW (flip-flop reset)
      state._dischargeActive = (newFf === 0);

      return true;
    },
  });

  // The gallery's kind is '555' (the designer catalog's name); the
  // registry only knew 'timer_555', so every gallery 555 was accepted
  // by validation and modelled by NOTHING — output stuck at 0V forever
  // (audit escalation, pc27; same disease as rgb_led). One model, two
  // names; terminal order follows the kind table's catalog order.
  const base = getDevice('timer_555');
  registerDevice('555', {
    terminals: ['gnd', 'trigger', 'output', 'reset', 'control', 'threshold', 'discharge', 'vcc'],
    init: (part) => base.init(part),
    stamp: (ctx, part, state) => base.stamp(ctx, part, state),
    update: (part, state, read, tNs) => base.update(part, state, read, tNs),
  });
}
