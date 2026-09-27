/**
 * Power devices — battery, voltage regulator, ADP7118 LDO, fuse.
 *
 * battery: fixed voltage source (1.5V, 3V, 9V, etc.)
 * vreg: linear voltage regulator (78xx series) — drops to fixed output
 * fuse: zero-resistance until current exceeds rating, then open
 *
 * @module
 */

import { registerDevice } from '../devices.js';

/**
 * Register power device models.
 */
export function registerPowerDevices() {
  // ─── Battery ────────────────────────────────────────────────────────
  // A battery is a voltage source with internal resistance.
  // Terminals: pos, neg (like a real battery)
  registerDevice('battery', {
    terminals: ['pos', 'neg'],

    init() {
      return { drives: {} };
    },

    stamp(ctx, part) {
      // ONE stamp, between the battery's own pins. This used to be stamped
      // twice — once via state.drives (ground-referenced) and once via
      // ctx.thevenin — two identical Nortons in parallel, halving the
      // effective internal resistance; and both were referenced to node 0,
      // so a battery whose neg terminal was off-ground was simply wrong
      // (spec-updates/referenced-device-drives.md).
      const rInt = part.params?.rInternal ?? 0.5;
      const volts = part.params?.volts ?? 9;
      ctx.theveninBetween('pos', 'neg', volts, rInt);
    },

    update() { return false; }, // static — no behavioral changes
  });

  // ─── Voltage Regulator (78xx / LM317) ──────────────────────────────
  // Input → output drops to a fixed voltage (e.g. 7805 = 5V out).
  // If Vin < Vout + dropout, output follows input minus dropout.
  registerDevice('vreg', {
    terminals: ['in', 'out', 'gnd'],

    init(part) {
      const vOut = part.params?.vOut ?? 5.0;
      return {
        drives: {
          out: { vTh: vOut, rTh: part.params?.rOut ?? 1.0 },
        },
        _vOut: vOut,
      };
    },

    stamp(ctx, part, state) {
      // Input: draws current (small quiescent + load)
      // Modeled as: output drives vOut through low impedance
      // Input draws what the output needs (not explicitly stamped — the
      // current flows through the output stamp and returns via gnd).
      ctx.conductance('in', 'gnd', 1 / 1e6); // quiescent current path
    },

    update(part, state, read) {
      const vIn = read('in');
      const vGnd = read('gnd');
      const targetVout = part.params?.vOut ?? 5.0;
      const dropout = part.params?.dropout ?? 1.5;
      const rOut = part.params?.rOut ?? 1.0;

      // Regulated output: min(targetVout, Vin - dropout)
      const maxOut = (vIn - vGnd) - dropout;
      const actualVout = Math.min(targetVout, Math.max(0, maxOut));

      if (Math.abs(actualVout - state._vOut) < 0.01) return false;

      state._vOut = actualVout;
      state.drives.out = { vTh: vGnd + actualVout, rTh: rOut };
      return true;
    },
  });

  // ─── ADP7118 200 mA low-noise LDO ─────────────────────────────────
  // Physical SOIC-8 lead names are deliberately unique. Pins 1/2 and 7/8
  // are bonded together on the die, but keeping both terminals visible is
  // what lets a real package/PCB mapping remain honest.
  //
  // This is a bounded DC model of the Rev. H data-sheet contract. It models
  // regulation/feedback, dropout, enable and UVLO hysteresis, quiescent or
  // shutdown current, and the typical current limit. Soft-start timing,
  // noise/PSRR, thermal shutdown and exposed-pad parasitics are intentionally
  // outside this first slice.
  registerDevice('adp7118', {
    terminals: ['vout_1', 'vout_2', 'sense_adj', 'gnd', 'en', 'ss', 'vin_7', 'vin_8'],

    init(part) {
      const nominal = part.params?.adjustable ? 1.2 : (part.params?.vOut ?? 5.0);
      const rOut = part.params?.rOut ?? 0.05;
      return {
        drives: {
          vout_1: { vTh: 0, rTh: rOut, ref: 'gnd' },
        },
        _enabled: false,
        _command: nominal,
        _driveV: 0,
        _inputAmps: 0,
        _outputAmps: 0,
      };
    },

    stamp(ctx, part, state) {
      // Duplicate package leads are the same die nodes. Ten milliohms keeps
      // them observable as separate physical terminals without fabricating a
      // measurable package drop at the model's 200 mA rated load.
      ctx.conductance('vout_1', 'vout_2', 1 / 0.01);
      ctx.conductance('vin_7', 'vin_8', 1 / 0.01);

      // A linear regulator draws its delivered load current from VIN; the
      // output source itself is referenced to GND. Pairing these injections
      // makes the complete eight-terminal model conserve current.
      ctx.current('vin_7', -state._inputAmps);
      ctx.current('gnd', state._inputAmps);
    },

    update(part, state, read) {
      const vGnd = read('gnd');
      const vIn = ((read('vin_7') + read('vin_8')) / 2) - vGnd;
      const vOut = ((read('vout_1') + read('vout_2')) / 2) - vGnd;
      const vSense = read('sense_adj') - vGnd;
      const vEnable = read('en') - vGnd;
      const rOut = part.params?.rOut ?? 0.05;
      const nominal = part.params?.adjustable ? 1.2 : (part.params?.vOut ?? 5.0);
      const currentLimit = part.params?.currentLimit ?? 0.36;

      // Typical data-sheet thresholds: EN rises at 1.22 V and falls at
      // 1.12 V; UVLO rises at 2.69 V and falls at 2.2 V. The rated operating
      // range ends at 20 V, so this model refuses to drive outside it rather
      // than extrapolating unspecified behavior.
      const enOk = state._enabled ? vEnable > 1.12 : vEnable >= 1.22;
      const vinOk = state._enabled ? vIn > 2.2 : vIn >= 2.69;
      const enabled = enOk && vinOk && vIn <= 20;

      let command = state._command;
      let driveV = 0;
      let outputAmps = 0;
      if (enabled) {
        // The SENSE/ADJ pin closes the real feedback loop. Direct sensing
        // regulates at the selected fixed voltage; an external divider can
        // raise VOUT, while the adjustable variant uses the 1.2 V reference.
        command += nominal - vSense;
        const headroom = Math.max(0, vIn - 0.2); // 200 mV typical @ 200 mA
        command = Math.min(headroom, Math.max(0, command));

        // Measure demand from the companion that produced THIS solved point,
        // not from the next command. Using the next command here mistakes an
        // unloaded start at 0 V for a 100 A overload and can only climb by
        // one current-limit step per bounded device-settle pass.
        const demanded = Math.max(0, (state._driveV - vOut) / rOut);
        outputAmps = Math.min(currentLimit, demanded);
        // In limit mode, preserve the observed DC load line and move its
        // intersection to I_LIMIT. This is the finite-R Thévenin equivalent
        // of the current ceiling, and settles in one behavioral pass rather
        // than depending on an unbounded number of tiny voltage steps.
        const loadOhms = demanded > 1e-12 ? Math.max(0, vOut / demanded) : Infinity;
        driveV = demanded > currentLimit
          ? currentLimit * (loadOhms + rOut)
          : command;
      } else {
        command = nominal;
      }

      // Ground current: 50 uA no-load, rising linearly to 180 uA at the
      // rated 200 mA load. Disabled current follows the 5 V / 20 V typical
      // endpoints (1.8 uA / 3 uA), clamped to the characterized range.
      const iq = enabled
        ? 50e-6 + 130e-6 * Math.min(outputAmps, 0.2) / 0.2
        : 1.8e-6 + 1.2e-6 * Math.min(1, Math.max(0, vIn - 5) / 15);
      const inputAmps = outputAmps + iq;

      const changed = enabled !== state._enabled
        || Math.abs(command - state._command) > 1e-6
        || Math.abs(driveV - state._driveV) > 1e-6
        || Math.abs(inputAmps - state._inputAmps) > 1e-9;
      state._enabled = enabled;
      state._command = command;
      state._driveV = driveV;
      state._outputAmps = outputAmps;
      state._inputAmps = inputAmps;
      state.drives.vout_1 = { vTh: driveV, rTh: rOut, ref: 'gnd' };
      return changed;
    },
  });

  // ─── Fuse ──────────────────────────────────────────────────────────
  // Normally a wire (very low R). If current exceeds rating, goes open.
  // Once blown, stays open until reset (control = 1 to reset).
  registerDevice('fuse', {
    terminals: ['a', 'b'],

    init() {
      return {
        drives: {},
        blown: false,
      };
    },

    stamp(ctx, part, state) {
      if (!state.blown) {
        // Intact fuse: very low resistance
        ctx.conductance('a', 'b', 1 / 0.01); // 10 mΩ
      }
      // Blown: open circuit (no conductance)
    },

    update(part, state, read) {
      // Reset via control
      const ctrl = part.params?._control;
      if (ctrl === 1 && state.blown) {
        state.blown = false;
        return true;
      }
      // Check current (approximate from voltage difference and fuse R)
      if (!state.blown) {
        const vA = read('a');
        const vB = read('b');
        const current = Math.abs(vA - vB) / 0.01;
        const rating = part.params?.amps ?? 1.0;
        if (current > rating * 1.5) { // 150% of rating = blow
          state.blown = true;
          return true;
        }
      }
      return false;
    },
  });
}
