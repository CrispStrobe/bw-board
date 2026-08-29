/**
 * Analog ICs and discrete power devices.
 *
 * - TIP120: Darlington transistor (behavioral: high beta, 2× Vbe drop)
 * - LM393: Dual comparator (open-collector output)
 * - TMP36: Analog temperature sensor (10mV/°C + 500mV offset)
 * - Light bulb: resistive load with brightness proportional to power
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_INPUT = 1e6;
const R_OUT = 50;

/**
 * Register analog IC and discrete device models.
 */
/**
 * Register analog IC and discrete device models.
 *
 * Includes: TIP120, LM393 (dual comparator), LM339 (quad comparator),
 * TMP36, light bulb, optocoupler, 556 (dual 555 timer).
 */
export function registerAnalogICs() {

  // ─── TIP120 Darlington transistor ─────────────────────────────────
  // Behavioral: base current × beta (1000 typ) = collector current.
  // Vbe = 2 × 0.7V = 1.4V (two junctions). Vce_sat ≈ 2V.
  // Simplified: if Vbe > 1.4V, collector sinks up to the available current.
  registerDevice('tip120', {
    terminals: ['base', 'collector', 'emitter'],

    init() {
      return { drives: {}, _on: false };
    },

    stamp(ctx, part, state) {
      // Base: high impedance (Darlington input)
      ctx.conductance('base', 'emitter', 1 / (R_INPUT / 10)); // ~100kΩ base R

      if (state._on) {
        // Saturated: collector-emitter is a low resistance
        const rCeSat = part.params?.rceSat ?? 2.0;
        ctx.conductance('collector', 'emitter', 1 / rCeSat);
      }
    },

    update(part, state, read) {
      const vBase = read('base');
      const vEmitter = read('emitter');
      const vbe = vBase - vEmitter;
      const vbeThreshold = part.params?.vbe ?? 1.4; // 2 × 0.7V

      const shouldBeOn = vbe > vbeThreshold;
      if (shouldBeOn === state._on) return false;
      state._on = shouldBeOn;
      return true;
    },
  });

  // ─── LM393 Dual comparator ────────────────────────────────────────
  // Open-collector output: pulls LOW when V+ < V-, floats when V+ > V-.
  // Two independent comparators in one package.
  registerDevice('lm393', {
    terminals: ['1_pos', '1_neg', '1_out', '2_pos', '2_neg', '2_out', 'vcc', 'gnd'],

    init() {
      return {
        drives: { '1_out': null, '2_out': null }, // null = high-Z (open collector)
        // null = NOT YET EVALUATED: the first update always applies its
        // drive. The old init of 0-with-floating-drives was inconsistent
        // — a comparator whose first comparison came out low never sank
        // until the input crossed high and back (found by the E3.6
        // hysteresis oracle's fresh-bench case).
        _comp: [null, null], // 0=LOW(sinking), 1=floating
      };
    },

    update(part, state, read) {
      // E3.6: optional hysteresis in volts (default 0 — the bare LM393
      // has none, and the datasheet-honest default keeps every existing
      // bench bit-identical; h=0 uses the exact legacy comparison).
      const h = part.params?.hysteresis ?? 0;
      let changed = false;
      for (let i = 1; i <= 2; i++) {
        const d = read(`${i}_pos`) - read(`${i}_neg`);
        const prev = state._comp[i - 1];
        const comp = (h === 0 || prev === null) ? (d > 0 ? 1 : 0)
          : (prev === 1 ? (d < -h / 2 ? 0 : 1) : (d > h / 2 ? 1 : 0));
        if (comp !== prev) {
          state._comp[i - 1] = comp;
          // Open-collector: high → float (null), low → sink (Vce_sat ~0.2 V)
          state.drives[`${i}_out`] = comp ? null : { vTh: 0.2, rTh: 10 };
          changed = true;
        }
      }
      return changed;
    },
  });

  // ─── TMP36 analog temperature sensor ──────────────────────────────
  // Output: 10mV/°C + 500mV offset. At 25°C: 750mV.
  // Control param sets temperature in °C.
  registerDevice('tmp36', {
    terminals: ['vcc', 'out', 'gnd'],

    init(part) {
      const tempC = part.params?.tempC ?? 25;
      const vOut = 0.5 + tempC * 0.01; // 500mV + 10mV/°C
      return {
        drives: { out: { vTh: vOut, rTh: R_OUT } },
        _tempC: tempC,
        _benchT: 25,
      };
    },

    stamp(ctx, part, state) {
      // E2.2: capture the bench temperature; it is the DEFAULT reading —
      // an explicit params.tempC pins the sensor and is never overridden.
      state._benchT = ctx.temperatureC ?? 25;
    },

    update(part, state) {
      const tempC = part.params?.tempC ?? state._benchT ?? 25;
      if (Math.abs(tempC - state._tempC) < 0.1) return false;

      state._tempC = tempC;
      const vOut = 0.5 + tempC * 0.01;
      state.drives.out = { vTh: vOut, rTh: R_OUT };
      return true;
    },
  });

  // ─── Light bulb ───────────────────────────────────────────────────
  // Resistive load. Brightness proportional to power dissipated.
  // Rated for a specific voltage; brightness = (V/Vrated)² clamped to [0,1].
  registerDevice('light_bulb', {
    terminals: ['a', 'b'],

    init(part) {
      return { drives: {}, brightness: 0, _tempK: 0, _lastTNs: null, _rNow: null };
    },

    stamp(ctx, part, state) {
      // E3.6, opt-in with params.filament: a PTC filament whose
      // resistance grows with its own dissipation — cold it is
      // params.ohms/10 (tungsten's ~10:1 hot/cold ratio), at rated
      // dissipation it warms to params.ohms, and the one-pole thermal
      // state in update() makes INRUSH demonstrable: the first
      // milliseconds draw ~10× the steady current, which is why real
      // bulbs die at switch-on. Default (no param) stays the fixed
      // resistor every existing bench solved.
      const ohms = part.params?.ohms ?? 500;
      const r = part.params?.filament ? (state._rNow ?? ohms / 10) : ohms;
      ctx.conductance('a', 'b', 1 / r);
    },

    update(part, state, read, tNs) {
      const vA = read('a');
      const vB = read('b');
      const v = Math.abs(vA - vB);
      const vRated = part.params?.vRated ?? 5.0;
      const newBrightness = Math.min(1.0, (v / vRated) ** 2);
      let changed = false;

      if (part.params?.filament) {
        const rHot = part.params?.ohms ?? 500;
        const rCold = rHot / 10;
        // Thermal pole: tauMs (default 30 ms — small-bulb scale).
        const tauMs = part.params?.tauMs ?? 30;
        // Steady temp normalized so rated dissipation (vRated²/rHot)
        // lands the filament AT rHot: tSS = P / pRated, r = rCold + (rHot−rCold)·min(tSS,1)… 
        const r = state._rNow ?? rCold;
        const p = v * v / r;
        const pRated = vRated * vRated / rHot;
        const tSS = Math.min(p / pRated, 1.5);
        const dtMs = state._lastTNs === null ? 0 : Number(tNs - state._lastTNs) / 1e6;
        state._lastTNs = tNs;
        const alpha = dtMs <= 0 ? 0 : 1 - Math.exp(-dtMs / tauMs);
        state._tempK = state._tempK + (tSS - state._tempK) * alpha;
        const rNew = rCold + (rHot - rCold) * Math.min(state._tempK, 1);
        if (state._rNow === null || Math.abs(rNew - state._rNow) > state._rNow * 0.02) {
          state._rNow = rNew;
          changed = true; // the network must see the new filament
        } else {
          state._rNow = rNew;
        }
      }

      if (Math.abs(newBrightness - state.brightness) >= 0.001) {
        state.brightness = newBrightness;
      }
      return changed;
    },
  });

  // ─── Optocoupler ──────────────────────────────────────────────────
  // E3.6: the LED side is a real junction segment (off: 1 MΩ leak; on:
  // rd above vf, so vLed clamps near vf + i·rd instead of the old
  // 150 Ω-from-zero fiction), and the output is SCALED by the current
  // transfer ratio instead of snapping to one saturation conductance:
  // the phototransistor can sink at most CTR·iLed, modeled as a
  // conductance ctr·iLed/vceSat — half the LED current, half the sink.
  registerDevice('optocoupler', {
    terminals: ['anode', 'cathode', 'collector', 'emitter'],

    init() {
      return { drives: {}, _on: false, _gCe: 0 };
    },

    stamp(ctx, part, state) {
      const rd = 50; // dynamic R of the internal LED
      const vf = part.params?.vf ?? 1.2;
      if (state._on) {
        // Conducting segment: i = (v − vf)/rd as a Norton pair.
        ctx.conductance('anode', 'cathode', 1 / rd);
        // Norton pair for i = (v − vf)/rd: the −vf/rd constant is an
        // inflow at the anode and an outflow at the cathode (b += amps
        // is inflow in this MNA).
        ctx.current('anode', vf / rd);
        ctx.current('cathode', -vf / rd);
      } else {
        ctx.conductance('anode', 'cathode', 1e-6); // dark leakage
      }
      if (state._gCe > 0) ctx.conductance('collector', 'emitter', state._gCe);
    },

    update(part, state, read) {
      const rd = 50;
      const vf = part.params?.vf ?? 1.2;
      const ctr = part.params?.ctr ?? 1.0;
      const vceSat = 0.2;
      const vLed = read('anode') - read('cathode');
      const on = vLed > vf;
      const iLed = on ? Math.max(0, (vLed - vf) / rd) : 0;
      const gCe = Math.min(ctr * iLed / vceSat, 1 / 5); // cap at the old hard-sat 5 Ω
      const changed = on !== state._on || Math.abs(gCe - state._gCe) > state._gCe * 0.05 + 1e-9;
      if (!changed) return false;
      state._on = on;
      state._gCe = gCe;
      return true;
    },
  });

  // ─── LM339 Quad comparator ────────────────────────────────────────
  // Same as LM393 but four channels. Open-collector outputs.
  registerDevice('lm339', {
    terminals: ['1_pos', '1_neg', '1_out', '2_pos', '2_neg', '2_out',
                '3_pos', '3_neg', '3_out', '4_pos', '4_neg', '4_out', 'vcc', 'gnd'],

    init() {
      return {
        drives: { '1_out': null, '2_out': null, '3_out': null, '4_out': null },
        _comp: [null, null, null, null], // null = not yet evaluated (see lm393)
      };
    },

    update(part, state, read) {
      const h = part.params?.hysteresis ?? 0; // E3.6, same contract as lm393
      let changed = false;
      for (let i = 1; i <= 4; i++) {
        const d = read(`${i}_pos`) - read(`${i}_neg`);
        const prev = state._comp[i - 1];
        const result = (h === 0 || prev === null) ? (d > 0 ? 1 : 0)
          : (prev === 1 ? (d < -h / 2 ? 0 : 1) : (d > h / 2 ? 1 : 0));
        if (result !== prev) {
          state._comp[i - 1] = result;
          state.drives[`${i}_out`] = result ? null : { vTh: 0.2, rTh: 10 };
          changed = true;
        }
      }
      return changed;
    },
  });

  // ─── 556 Dual timer ───────────────────────────────────────────────
  // Two independent 555 timer channels in one package.
  // Terminals prefixed with 1_ and 2_ for each channel.
  registerDevice('timer_556', {
    terminals: [
      '1_trigger', '1_threshold', '1_control', '1_discharge', '1_output', '1_reset',
      '2_trigger', '2_threshold', '2_control', '2_discharge', '2_output', '2_reset',
      'vcc', 'gnd',
    ],

    init(part) {
      const rOut = part.params?.rOut ?? 50;
      return {
        drives: {
          '1_output': { vTh: 0, rTh: rOut },
          '2_output': { vTh: 0, rTh: rOut },
        },
        _ch: [
          { ffOut: 0, dischargeActive: true },
          { ffOut: 0, dischargeActive: true },
        ],
      };
    },

    stamp(ctx, part, state) {
      const rDiv = 5000;
      const rDischarge = 10;

      for (const prefix of ['1_', '2_']) {
        // Internal divider on control pin
        ctx.conductance('vcc', `${prefix}control`, 1 / rDiv);
        ctx.conductance(`${prefix}control`, 'gnd', 1 / (rDiv * 2));
      }

      // Discharge switches
      const ch1 = state._ch[0];
      const ch2 = state._ch[1];
      if (ch1.dischargeActive) ctx.conductance('1_discharge', 'gnd', 1 / rDischarge);
      if (ch2.dischargeActive) ctx.conductance('2_discharge', 'gnd', 1 / rDischarge);
    },

    update(part, state, read) {
      const vcc = read('vcc');
      const vGnd = read('gnd');
      const rOut = part.params?.rOut ?? 50;
      let changed = false;

      for (let ch = 0; ch < 2; ch++) {
        const prefix = `${ch + 1}_`;
        const cs = state._ch[ch];

        const vThreshold = read(`${prefix}threshold`) - vGnd;
        const vTrigger = read(`${prefix}trigger`) - vGnd;
        const vControl = read(`${prefix}control`) - vGnd;
        const vReset = read(`${prefix}reset`) - vGnd;
        const effectiveVcc = vcc - vGnd;

        if (effectiveVcc < 0.5) continue;

        const upperThreshold = vControl;
        const lowerThreshold = vControl / 2;
        const resetActive = vReset < (effectiveVcc * 0.3);

        let newFf = cs.ffOut;
        if (resetActive) newFf = 0;
        else {
          if (vThreshold > upperThreshold) newFf = 0;
          if (vTrigger < lowerThreshold) newFf = 1;
        }

        if (newFf !== cs.ffOut) {
          cs.ffOut = newFf;
          cs.dischargeActive = (newFf === 0);
          state.drives[`${prefix}output`] = {
            vTh: newFf ? vcc : vGnd,
            rTh: rOut,
          };
          changed = true;
        }
      }
      return changed;
    },
  });
}
