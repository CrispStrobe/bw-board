/**
 * H-bridge motor driver (L293D / L298N style).
 *
 * Two half-bridges, each with an enable and two input pins.
 * Drives a DC motor bidirectionally.
 *
 * Truth table per half-bridge (enable HIGH):
 *   IN1=H, IN2=L → OUT1=VCC, OUT2=GND (forward)
 *   IN1=L, IN2=H → OUT1=GND, OUT2=VCC (reverse)
 *   IN1=IN2 → brake (both outputs same)
 *   Enable=L → coast (outputs high-Z)
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_OUT = 2.0;     // L293D output saturation ~1.4V at 600mA → ~2Ω
// Input pins draw nothing here, on purpose. These models used to declare
// `ctx.conductance(pin, null, 1 / R_INPUT)` with R_INPUT = 1e6 — a call that
// names no second terminal, which stampTwoTerminal's air-leg guard declines,
// so it never stamped. 1 MOhm is not a CMOS input either (a 74HC draws 1 uA
// max). The ideal high-Z input IS the model, and GMIN keeps every pin a real
// node. See spec-updates/ideal-high-z-inputs.md.

/**
 * Register the H-bridge device model.
 */
export function registerHBridge() {
  registerDevice('h_bridge', {
    terminals: ['vcc', 'gnd', 'en1', 'in1', 'in2', 'out1', 'out2', 'en2', 'in3', 'in4', 'out3', 'out4'],

    init() {
      return {
        drives: {
          out1: null, out2: null,
          out3: null, out4: null,
        },
      };
    },

    // The control pins (en1/in1/in2/en2/in3/in4) draw nothing, so there is no
    // stamp: the "input impedance" declared here named no second terminal and
    // never stamped (spec-updates/ideal-high-z-inputs.md).
    update(part, state, read) {
      const vcc = read('vcc');
      const gnd = read('gnd');
      const vDrop = part.params?.vDrop ?? 1.4; // saturation voltage drop
      const vHigh = vcc - vDrop;
      const vLow = gnd + vDrop;

      const threshold = (vcc + gnd) / 2;

      function halfBridge(en, inA, inB) {
        const enV = read(en);
        if (enV < threshold) {
          // Disabled: outputs high-Z
          return [null, null];
        }
        const a = read(inA) > threshold;
        const b = read(inB) > threshold;

        if (a && !b) return [{ vTh: vHigh, rTh: R_OUT }, { vTh: vLow, rTh: R_OUT }];
        if (!a && b) return [{ vTh: vLow, rTh: R_OUT }, { vTh: vHigh, rTh: R_OUT }];
        // Brake: both same level
        if (a && b) return [{ vTh: vHigh, rTh: R_OUT }, { vTh: vHigh, rTh: R_OUT }];
        return [{ vTh: vLow, rTh: R_OUT }, { vTh: vLow, rTh: R_OUT }];
      }

      const [o1, o2] = halfBridge('en1', 'in1', 'in2');
      const [o3, o4] = halfBridge('en2', 'in3', 'in4');

      let changed = false;
      if (JSON.stringify(state.drives.out1) !== JSON.stringify(o1)) { state.drives.out1 = o1; changed = true; }
      if (JSON.stringify(state.drives.out2) !== JSON.stringify(o2)) { state.drives.out2 = o2; changed = true; }
      if (JSON.stringify(state.drives.out3) !== JSON.stringify(o3)) { state.drives.out3 = o3; changed = true; }
      if (JSON.stringify(state.drives.out4) !== JSON.stringify(o4)) { state.drives.out4 = o4; changed = true; }

      return changed;
    },
  });
}
