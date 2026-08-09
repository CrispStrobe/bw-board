/**
 * Sensor devices — ultrasonic, PIR, tilt, flex, force, phototransistor.
 *
 * These are behavioral models controlled via setControl():
 * - Ultrasonic: control = distance (cm), output = pulse width
 * - PIR: control = 0/1 (motion detected), output = digital HIGH/LOW
 * - Tilt: control = 0/1 (tilted), acts as switch
 * - Flex: control = 0..1 (bend amount), resistance varies
 * - Force: control = 0..1 (pressure), resistance varies
 * - Phototransistor: control = 0..1 (light), current source
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_INPUT = 1e6;

/**
 * Register all sensor device models.
 */
export function registerSensors() {

  // ─── Ultrasonic (HC-SR04) ──────────────────────────────────────────
  // Trigger: receive a 10µs pulse, then echo goes HIGH for duration
  // proportional to distance. At 343 m/s: time_µs = distance_cm * 58.
  // For simulation: control sets the distance, echo drives accordingly.
  registerDevice('ultrasonic', {
    terminals: ['vcc', 'gnd', 'trig', 'echo'],

    init() {
      return {
        drives: { echo: { vTh: 0, rTh: 50 } },
        _trigHigh: false,
        _echoEndNs: 0n,
        _measuring: false,
      };
    },

    stamp(ctx, part, state) {
      ctx.conductance('trig', null, 1 / R_INPUT);
    },

    update(part, state, read, tNs) {
      const vcc = read('vcc') || 5.0;
      const threshold = vcc * 0.5;
      const trigV = read('trig');
      const trigHigh = trigV > threshold;

      let changed = false;

      // Detect trigger rising edge → start measurement
      if (trigHigh && !state._trigHigh) {
        const distanceCm = part.params?.distance ?? 100; // default 1m
        const echoUs = distanceCm * 58; // microseconds
        state._echoEndNs = tNs + BigInt(Math.round(echoUs * 1000));
        state._measuring = true;
        state.drives.echo = { vTh: vcc, rTh: 50 };
        changed = true;
      }
      state._trigHigh = trigHigh;

      // End echo pulse when time is up
      if (state._measuring && tNs >= state._echoEndNs) {
        state._measuring = false;
        state.drives.echo = { vTh: 0, rTh: 50 };
        changed = true;
      }

      return changed;
    },
  });

  // ─── PIR motion sensor ─────────────────────────────────────────────
  // Digital output: HIGH when motion detected (control = 1).
  registerDevice('pir', {
    terminals: ['vcc', 'gnd', 'out'],

    init() {
      return { drives: { out: { vTh: 0, rTh: 50 } } };
    },

    stamp(ctx) { /* no analog loading */ },

    update(part, state, read) {
      const vcc = read('vcc') || 5.0;
      const motion = part.params?.motion ?? 0;
      const newDrive = motion ? { vTh: vcc, rTh: 50 } : { vTh: 0, rTh: 50 };

      if ((state.drives.out?.vTh ?? 0) === newDrive.vTh) return false;
      state.drives.out = newDrive;
      return true;
    },
  });

  // ─── Tilt sensor ───────────────────────────────────────────────────
  // Acts as a switch: closed when upright, open when tilted.
  // Control = 0 (upright/closed) or 1 (tilted/open).
  registerDevice('tilt_sensor', {
    terminals: ['a', 'b'],

    init() { return { drives: {}, _closed: true }; },

    stamp(ctx, part, state) {
      if (state._closed) {
        ctx.conductance('a', 'b', 1 / 0.1); // closed: ~0.1Ω
      }
      // open: no conductance
    },

    update(part, state) {
      const tilted = (part.params?.tilted ?? 0) === 1;
      const shouldClose = !tilted;
      if (shouldClose === state._closed) return false;
      state._closed = shouldClose;
      return true;
    },
  });

  // ─── Flex sensor ───────────────────────────────────────────────────
  // Resistance varies with bend: straight = rFlat, fully bent = rBent.
  // Control = 0..1 (bend amount).
  registerDevice('flex_sensor', {
    terminals: ['a', 'b'],

    init() { return { drives: {}, _ohms: 25000 }; },

    stamp(ctx, part, state) {
      ctx.conductance('a', 'b', 1 / state._ohms);
    },

    update(part, state) {
      const bend = part.params?.bend ?? 0;
      const rFlat = part.params?.rFlat ?? 25000;
      const rBent = part.params?.rBent ?? 100000;
      // Linear interpolation
      const newOhms = rFlat + (rBent - rFlat) * bend;
      if (Math.abs(newOhms - state._ohms) < 1) return false;
      state._ohms = newOhms;
      return true;
    },
  });

  // ─── Force sensor (FSR) ────────────────────────────────────────────
  // Resistance decreases with pressure: no force = very high R, full force = low R.
  registerDevice('force_sensor', {
    terminals: ['a', 'b'],

    init() { return { drives: {}, _ohms: 1e6 }; },

    stamp(ctx, part, state) {
      ctx.conductance('a', 'b', 1 / state._ohms);
    },

    update(part, state) {
      const force = part.params?.force ?? 0;
      const rNone = part.params?.rNone ?? 1e6;   // no force: 1MΩ
      const rFull = part.params?.rFull ?? 200;    // full force: 200Ω
      // Exponential interpolation (FSRs are logarithmic)
      const newOhms = force > 0.01
        ? rNone * Math.pow(rFull / rNone, force)
        : rNone;
      if (Math.abs(newOhms - state._ohms) / state._ohms < 0.01) return false;
      state._ohms = newOhms;
      return true;
    },
  });

  // ─── Phototransistor ───────────────────────────────────────────────
  // Current source proportional to light (control = 0..1).
  // Collector-emitter, like a transistor but light-controlled.
  registerDevice('phototransistor', {
    terminals: ['collector', 'emitter'],

    init() { return { drives: {}, _current: 0 }; },

    stamp(ctx, part, state) {
      if (state._current > 0) {
        ctx.current('collector', -state._current);
        ctx.current('emitter', state._current);
      }
    },

    update(part, state) {
      const light = part.params?.light ?? 0;
      const iMax = part.params?.iMax ?? 0.005; // 5mA at full light
      const newCurrent = light * iMax;
      if (Math.abs(newCurrent - state._current) < 1e-6) return false;
      state._current = newCurrent;
      return true;
    },
  });
}
