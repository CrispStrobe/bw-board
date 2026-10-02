/**
 * Power devices — battery, voltage regulator, physical LDOs, fuse.
 *
 * battery: fixed voltage source (1.5V, 3V, 9V, etc.)
 * vreg: linear voltage regulator (78xx series) — drops to fixed output
 * fuse: zero-resistance until current exceeds rating, then open
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const ADP151_FIXED_OUTPUTS = new Set([
  1.1, 1.2, 1.5, 1.8, 2.1, 2.5, 2.6, 2.7, 2.75, 2.8, 2.85, 2.9, 3.0, 3.3,
]);

// ADP7118 Rev.H Table 1: typical EN-to-10% = 80 us, EN-to-90% = 380 us.
// A delayed single pole interpolates these anchors; its shape is a stated
// behavioural approximation, not an ADI transistor/feedback-loop model.
const ADP7118_STARTUP_TAU_SEC = 300e-6 / Math.log(9);
const ADP7118_STARTUP_DELAY_SEC = 80e-6 + ADP7118_STARTUP_TAU_SEC * Math.log(.9);
const ADP7118_STARTUP_DELAY_NS = BigInt(Math.round(ADP7118_STARTUP_DELAY_SEC * 1e9));
// A 10 us wake keeps the whole ~1.95 ms envelope below the existing 200
// device-deadline budget. Reactive solves evaluate f(t) continuously, not
// as a 10 us staircase; this deadline refreshes non-reactive endpoints.
const ADP7118_STARTUP_TICK_NS = 10000n;

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

  // ─── ADP151 200 mA ultralow-noise LDO ────────────────────────────
  // Bounded fixed-output DC model of the Rev. J data-sheet contract.
  // The five terminals are the TSOT-5 physical leads; NC is deliberately
  // visible but electrically inert. Noise/PSRR, start-up and thermal dynamics
  // are outside this static slice rather than fabricated from headline data.
  registerDevice('adp151', {
    terminals: ['vin', 'gnd', 'en', 'nc', 'vout'],

    init(part) {
      const nominal = part.params?.vOut ?? 3.3;
      const rOut = part.params?.rOut ?? 0.05;
      return {
        drives: { vout: { vTh: 0, rTh: 1e9, ref: 'gnd' } },
        _enabled: false,
        _driveV: 0,
        _driveR: 1e9,
        _inputAmps: 0,
        _outputAmps: 0,
        _nominal: nominal,
        _rOut: rOut,
      };
    },

    stamp(ctx, part, state) {
      // Input current is delivered load plus the regulator's ground current.
      // Pairing the two injections makes the complete five-terminal package
      // conserve current; NC receives no stamp.
      ctx.current('vin', -state._inputAmps);
      ctx.current('gnd', state._inputAmps);
      ctx.conductance('en', 'gnd', 1 / 2.6e6); // internal EN pull-down
    },

    update(part, state, read) {
      const vGnd = read('gnd');
      const vIn = read('vin') - vGnd;
      const vOut = read('vout') - vGnd;
      const vEnable = read('en') - vGnd;
      const nominal = part.params?.vOut ?? 3.3;
      const rOut = part.params?.rOut ?? 0.05;
      // Default to the guaranteed 220 mA floor, not the 300 mA typical value.
      const currentLimit = part.params?.currentLimit ?? 0.22;
      const outputIsSpecified = ADP151_FIXED_OUTPUTS.has(nominal);
      const enOk = state._enabled ? vEnable > 0.4 : vEnable >= 1.2;
      const inputOk = vIn >= 2.2 && vIn <= 5.5;
      const enabled = outputIsSpecified && enOk && inputOk;

      let driveV = 0;
      let driveR = 1e9;
      let outputAmps = 0;
      if (enabled) {
        driveR = rOut;
        const observed = Math.max(0,
          (state._driveV - vOut) / Math.max(state._driveR, rOut));
        const loadOhms = observed > 1e-12 ? Math.max(0, vOut / observed) : Infinity;
        const preDropoutAmps = Number.isFinite(loadOhms)
          ? Math.min(currentLimit, nominal / (loadOhms + rOut))
          : observed;
        // Rev. J guarantees <=30 mV at 10 mA and <=230 mV at 200 mA.
        const loadFraction = Math.min(1, Math.max(0, (preDropoutAmps - 0.01) / 0.19));
        const dropout = 0.03 + 0.20 * loadFraction;
        const command = Math.min(nominal, Math.max(0, vIn - dropout));
        const commandedAmps = Number.isFinite(loadOhms)
          ? command / (loadOhms + rOut)
          : observed;
        outputAmps = Math.min(currentLimit, commandedAmps);
        driveV = commandedAmps > currentLimit
          ? currentLimit * (loadOhms + rOut)
          : command;
      }

      // Typical IGND: 10 uA unloaded to 265 uA at 200 mA; 0.2 uA shut down.
      // The separate DRC budget uses the maximum rather than this curve.
      const iq = enabled
        ? 10e-6 + 255e-6 * Math.min(outputAmps, 0.2) / 0.2
        : 0.2e-6;
      const inputAmps = outputAmps + iq;
      const changed = enabled !== state._enabled
        || Math.abs(driveV - state._driveV) > 1e-6
        || driveR !== state._driveR
        || Math.abs(inputAmps - state._inputAmps) > 1e-9;
      state._enabled = enabled;
      state._driveV = driveV;
      state._driveR = driveR;
      state._inputAmps = inputAmps;
      state._outputAmps = outputAmps;
      state._nominal = nominal;
      state._rOut = rOut;
      state.drives.vout = { vTh: driveV, rTh: driveR, ref: 'gnd' };
      return changed;
    },
  });

  // ─── ADP7118 200 mA low-noise LDO ─────────────────────────────────
  // Physical SOIC-8 lead names are deliberately unique. Pins 1/2 and 7/8
  // are bonded together on the die, but keeping both terminals visible is
  // what lets a real package/PCB mapping remain honest.
  //
  // This is a bounded DC model of the Rev. H data-sheet contract. It models
  // regulation/feedback, dropout, enable and UVLO hysteresis, quiescent or
  // shutdown current, and the typical current limit. Internal soft-start
  // timing is opt-in via startupModel:'datasheet-envelope'. External SS,
  // noise/PSRR, thermal shutdown and exposed-pad parasitics remain unmodeled.
  registerDevice('adp7118', {
    terminals: ['vout_1', 'vout_2', 'sense_adj', 'gnd', 'en', 'ss', 'vin_7', 'vin_8'],

    init(part) {
      const nominal = part.params?.adjustable ? 1.2 : (part.params?.vOut ?? 5.0);
      const rOut = part.params?.rOut ?? 0.05;
      const startup = part.params?.startupModel;
      if (startup !== undefined && startup !== 'datasheet-envelope') {
        throw new Error(`ADP7118 ${part.id}: unsupported startupModel ${String(startup)}`);
      }
      if (startup && (part.params?.adjustable || !Number.isFinite(nominal)
          || nominal < 1.2 || nominal > 5 || !Number.isFinite(rOut) || rOut <= 0
          || !Number.isFinite(part.params?.currentLimit ?? .36) || (part.params?.currentLimit ?? .36) <= 0
          || part.params?.softStartCapacitanceF !== undefined)) {
        throw new Error(`ADP7118 ${part.id}: startup supports fixed 1.2–5 V with open SS only`);
      }
      return {
        drives: {
          vout_1: startup ? null : { vTh: 0, rTh: rOut, ref: 'gnd' },
        },
        _enabled: false,
        _command: startup ? 0 : nominal,
        _driveV: 0,
        _inputAmps: 0,
        _outputAmps: 0,
        ...(startup ? {startupModel: startup, startupFraction: 0,
          _startupStartNs: null, _wakeNs: null, _currentLimited: false,
          _headroom: 0, _startupUpdateNs: null, _startupRamping: false,
          _startupTransientStamp: false, _startupStampedLimit: false} : {}),
      };
    },

    stamp(ctx, part, state) {
      if (state.startupModel && ctx.netFor('ss')) {
        throw new Error(`ADP7118 ${part.id}: startup SS must be open; external SS networks are unmodeled`);
      }
      if (state.startupModel) {
        // Record only which existing solve route evaluates the source, not
        // any trial-step voltage or integration history. Non-reactive boards
        // need explicit endpoint re-solves; reactive substeps already evaluate
        // the continuous reference and must not restart for every new value.
        state._startupTransientStamp = ctx.dtSec !== undefined;
        state._startupStampedLimit = state._currentLimited;
        const sense = ctx.netFor('sense_adj');
        if (!sense || ![ctx.netFor('vout_1'), ctx.netFor('vout_2')].includes(sense)) {
          throw new Error(`ADP7118 ${part.id}: startup requires directly connected SENSE; external feedback is unmodeled`);
        }
        if (state._enabled && state._currentLimited) {
          // A current ceiling is a Norton current, not a voltage source
          // moved after each accepted capacitor-integration step.
          const amps = part.params?.currentLimit ?? .36;
          ctx.current('vout_1', amps);
          ctx.current('gnd', -amps);
        } else {
          const elapsed = state._startupStartNs === null ? 0
            : ctx.tSeconds - Number(state._startupStartNs) / 1e9;
          const fraction = Math.max(0, 1 - Math.exp(
            -Math.max(0, elapsed - Number(ADP7118_STARTUP_DELAY_NS) / 1e9) / ADP7118_STARTUP_TAU_SEC));
          const target = state._enabled
            ? Math.min(state._headroom, (part.params?.vOut ?? 5) * fraction) : 0;
          ctx.theveninBetween('vout_1', 'gnd', target,
            state._enabled ? (part.params?.rOut ?? .05) : 1e9);
        }
      }
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

    update(part, state, read, tNs) {
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

      let startupFraction = 1;
      if (state.startupModel) {
        if (enabled) {
          if (!state._enabled || state._startupStartNs === null) {
            if (vOut > 1e-6) throw new Error(`ADP7118 ${part.id}: startup into a prebiased output is unmodeled`);
            state._startupStartNs = tNs;
          }
          const elapsedSec = Number(tNs - state._startupStartNs) / 1e9;
          startupFraction = Math.max(0, 1 - Math.exp(
            -Math.max(0, elapsedSec - Number(ADP7118_STARTUP_DELAY_NS) / 1e9) / ADP7118_STARTUP_TAU_SEC));
          state._wakeNs = tNs < state._startupStartNs + ADP7118_STARTUP_DELAY_NS
            ? state._startupStartNs + ADP7118_STARTUP_DELAY_NS
            : startupFraction < 1 - 1e-6 ? tNs + ADP7118_STARTUP_TICK_NS : null;
        } else {
          startupFraction = 0;
          state._startupStartNs = null;
          state._wakeNs = null;
        }
        state.startupFraction = startupFraction;
      }

      if (state.startupModel) {
        const headroom = Math.max(0, vIn - .2);
        const target = enabled ? Math.min(headroom, nominal * startupFraction) : 0;
        const demanded = Math.max(0, (target - vOut) / rOut);
        const limited = enabled && demanded > currentLimit;
        if (limited && state._startupTransientStamp) {
          throw new Error(`ADP7118 ${part.id}: current-limited startup transient is unqualified`);
        }
        const outputAmps = enabled ? Math.min(currentLimit, demanded) : 0;
        const iq = enabled ? 50e-6 + 130e-6 * Math.min(outputAmps, .2) / .2
          : 1.8e-6 + 1.2e-6 * Math.min(1, Math.max(0, vIn - 5) / 15);
        const inputAmps = outputAmps + iq;
        const ramping = enabled && tNs >= state._startupStartNs + ADP7118_STARTUP_DELAY_NS;
        const sameInstant = state._startupUpdateNs === tNs;
        const changed = enabled !== state._enabled || limited !== state._currentLimited
          || limited !== state._startupStampedLimit
          || headroom !== state._headroom || ramping !== state._startupRamping
          || (!state._startupTransientStamp && target !== state._command)
          || (sameInstant && Math.abs(inputAmps - state._inputAmps) > 1e-9);
        state._startupUpdateNs = tNs;
        state._enabled = enabled;
        state._currentLimited = limited;
        state._startupRamping = ramping;
        state._headroom = headroom;
        state._command = target;
        state._driveV = target;
        state._inputAmps = inputAmps;
        state._outputAmps = outputAmps;
        state.drives.vout_1 = null;
        return changed;
      }

      let command = state._command;
      let driveV = 0;
      let outputAmps = 0;
      if (enabled) {
        // The SENSE/ADJ pin closes the real feedback loop. Direct sensing
        // regulates at the selected fixed voltage; an external divider can
        // raise VOUT, while the adjustable variant uses the 1.2 V reference.
        command += nominal * startupFraction - vSense;
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
        driveV = demanded > currentLimit ? currentLimit * (loadOhms + rOut) : command;
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

  // ─── LT1763 500 mA low-noise LDO ──────────────────────────────────
  // SO-8 terminals follow the data-sheet lead order. The three ground
  // leads are distinct physical terminals bonded to one die node. This is a
  // bounded DC model: reference-bypass noise/transients and thermal dynamics
  // are intentionally not synthesized from the static data-sheet limits.
  registerDevice('lt1763', {
    terminals: ['out', 'sense_adj', 'gnd_3', 'byp', 'shdn', 'gnd_6', 'gnd_7', 'in'],

    init(part) {
      const nominal = part.params?.adjustable ? 1.22 : (part.params?.vOut ?? 5.0);
      const rOut = part.params?.rOut ?? 0.04;
      return {
        drives: { out: { vTh: 0, rTh: rOut, ref: 'gnd_3' } },
        _enabled: false,
        _command: nominal,
        _driveV: 0,
        _inputAmps: 0,
        _outputAmps: 0,
      };
    },

    stamp(ctx, part, state) {
      // The SO-8 exposes three ground leads. Ten milliohms preserves their
      // package identity while keeping the shared die ground equipotential.
      ctx.conductance('gnd_3', 'gnd_6', 1 / 0.01);
      ctx.conductance('gnd_3', 'gnd_7', 1 / 0.01);

      // Delivering current through a ground-referenced output source must be
      // paired with its VIN draw. The difference is the regulator's ground
      // current, so the complete eight-terminal device conserves current.
      ctx.current('in', -state._inputAmps);
      ctx.current('gnd_3', state._inputAmps);
    },

    update(part, state, read) {
      const vGnd = (read('gnd_3') + read('gnd_6') + read('gnd_7')) / 3;
      const vIn = read('in') - vGnd;
      const vOut = read('out') - vGnd;
      const vSense = read('sense_adj') - vGnd;
      const vShutdown = read('shdn') - vGnd;
      const nominal = part.params?.adjustable ? 1.22 : (part.params?.vOut ?? 5.0);
      const rOut = part.params?.rOut ?? 0.04;
      // 520 mA is the guaranteed data-sheet floor. A caller may select the
      // typical curve explicitly, but the default must not promise more.
      const currentLimit = part.params?.currentLimit ?? 0.52;

      const shdnOk = state._enabled ? vShutdown > 0.65 : vShutdown >= 0.8;
      const inputOk = vIn >= 1.8 && vIn <= 20;
      const enabled = shdnOk && inputOk;

      let command = state._command;
      let driveV = 0;
      let outputAmps = 0;
      if (enabled) {
        command += nominal - vSense;
        command = Math.min(20, Math.max(nominal, command));

        const observed = Math.max(0, (state._driveV - vOut) / rOut);
        const loadOhms = observed > 1e-12 ? Math.max(0, vOut / observed) : Infinity;
        const preDropoutAmps = Number.isFinite(loadOhms)
          ? Math.min(currentLimit, command / (loadOhms + rOut))
          : observed;
        // Typical dropout rises from about 130 mV at 10 mA to 300 mV at
        // 500 mA. Interpolate that characterized interval and clamp it at
        // both ends rather than inventing a zero-load or overload curve.
        const loadFraction = Math.min(1, Math.max(0, (preDropoutAmps - 0.01) / 0.49));
        const dropout = 0.13 + 0.17 * loadFraction;
        command = Math.min(command, Math.max(0, vIn - dropout));

        // Once one nonzero solved point identifies the external load line,
        // compare the commanded operating point against the limit. Using
        // only the present low limited current here would alternate between
        // regulated and limited states on every settle pass.
        const commandedAmps = Number.isFinite(loadOhms)
          ? command / (loadOhms + rOut)
          : observed;
        outputAmps = Math.min(currentLimit, commandedAmps);
        driveV = commandedAmps > currentLimit
          ? currentLimit * (loadOhms + rOut)
          : command;
      } else {
        command = nominal;
      }

      // Typical GND-pin current table: 30 uA at no load, 65 uA at 1 mA,
      // 1.1 mA at 50 mA, 2 mA at 100 mA, 5 mA at 250 mA, 11 mA at 500 mA.
      const groundCurve = [
        [0, 30e-6], [0.001, 65e-6], [0.05, 1.1e-3],
        [0.1, 2e-3], [0.25, 5e-3], [0.5, 11e-3],
      ];
      let groundAmps = 0.1e-6; // typical shutdown current at 6 V
      if (enabled) {
        groundAmps = groundCurve.at(-1)[1];
        for (let i = 1; i < groundCurve.length; i += 1) {
          const [hiLoad, hiCurrent] = groundCurve[i];
          if (outputAmps <= hiLoad) {
            const [loLoad, loCurrent] = groundCurve[i - 1];
            const t = (outputAmps - loLoad) / (hiLoad - loLoad);
            groundAmps = loCurrent + t * (hiCurrent - loCurrent);
            break;
          }
        }
      }
      const inputAmps = outputAmps + groundAmps;

      const changed = enabled !== state._enabled
        || Math.abs(command - state._command) > 1e-6
        || Math.abs(driveV - state._driveV) > 1e-6
        || Math.abs(inputAmps - state._inputAmps) > 1e-9;
      state._enabled = enabled;
      state._command = command;
      state._driveV = driveV;
      state._outputAmps = outputAmps;
      state._inputAmps = inputAmps;
      state.drives.out = { vTh: driveV, rTh: rOut, ref: 'gnd_3' };
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
