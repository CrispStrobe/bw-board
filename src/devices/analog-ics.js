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
        _comp: [0, 0], // output states: 0=LOW(sinking), 1=floating
      };
    },

    stamp(ctx) {
      ctx.conductance('1_pos', null, 1 / R_INPUT);
      ctx.conductance('1_neg', null, 1 / R_INPUT);
      ctx.conductance('2_pos', null, 1 / R_INPUT);
      ctx.conductance('2_neg', null, 1 / R_INPUT);
    },

    update(part, state, read) {
      let changed = false;

      // Comparator 1
      const comp1 = read('1_pos') > read('1_neg') ? 1 : 0;
      if (comp1 !== state._comp[0]) {
        state._comp[0] = comp1;
        // Open-collector: V+ > V- → float (null), V+ < V- → sink to GND (Vce_sat ~ 0.2V)
        state.drives['1_out'] = comp1 ? null : { vTh: 0.2, rTh: 10 };
        changed = true;
      }

      // Comparator 2
      const comp2 = read('2_pos') > read('2_neg') ? 1 : 0;
      if (comp2 !== state._comp[1]) {
        state._comp[1] = comp2;
        state.drives['2_out'] = comp2 ? null : { vTh: 0.2, rTh: 10 };
        changed = true;
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
      };
    },

    stamp(ctx) { /* output drive handled by state.drives */ },

    update(part, state) {
      const tempC = part.params?.tempC ?? 25;
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
      return { drives: {}, brightness: 0 };
    },

    stamp(ctx, part) {
      const ohms = part.params?.ohms ?? 500; // typical incandescent
      ctx.conductance('a', 'b', 1 / ohms);
    },

    update(part, state, read) {
      const vA = read('a');
      const vB = read('b');
      const v = Math.abs(vA - vB);
      const vRated = part.params?.vRated ?? 5.0;
      const newBrightness = Math.min(1.0, (v / vRated) ** 2);

      if (Math.abs(newBrightness - state.brightness) < 0.001) return false;
      state.brightness = newBrightness;
      return false; // brightness is read-only state, no electrical re-solve
    },
  });

  // ─── Optocoupler ──────────────────────────────────────────────────
  // LED side (anode/cathode) drives a phototransistor (collector/emitter).
  // When LED current > threshold, transistor saturates.
  registerDevice('optocoupler', {
    terminals: ['anode', 'cathode', 'collector', 'emitter'],

    init() {
      return { drives: {}, _on: false };
    },

    stamp(ctx, part, state) {
      // LED side: forward voltage drop modeled as simple resistor above Vf
      const rd = 50; // dynamic R of internal LED
      ctx.conductance('anode', 'cathode', 1 / (rd + 100));

      // Transistor side: controlled by LED state
      if (state._on) {
        ctx.conductance('collector', 'emitter', 1 / 5); // saturated: ~5Ω
      }
    },

    update(part, state, read) {
      const vLed = read('anode') - read('cathode');
      const vfThreshold = part.params?.vf ?? 1.2;
      const shouldBeOn = vLed > vfThreshold;

      if (shouldBeOn === state._on) return false;
      state._on = shouldBeOn;
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
        _comp: [0, 0, 0, 0],
      };
    },

    stamp(ctx) {
      for (let i = 1; i <= 4; i++) {
        ctx.conductance(`${i}_pos`, null, 1 / R_INPUT);
        ctx.conductance(`${i}_neg`, null, 1 / R_INPUT);
      }
    },

    update(part, state, read) {
      let changed = false;
      for (let i = 1; i <= 4; i++) {
        const result = read(`${i}_pos`) > read(`${i}_neg`) ? 1 : 0;
        if (result !== state._comp[i - 1]) {
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
        ctx.conductance(`${prefix}threshold`, null, 1 / R_INPUT);
        ctx.conductance(`${prefix}trigger`, null, 1 / R_INPUT);
        ctx.conductance(`${prefix}reset`, null, 1 / R_INPUT);
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
