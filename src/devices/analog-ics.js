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
}
