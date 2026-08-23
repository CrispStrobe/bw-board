/**
 * Display devices — neopixel (WS2812B), bargraph.
 *
 * neopixel: addressable RGB LED strip. Serial data protocol.
 * bargraph: 10-segment LED bar, each segment is an independent LED.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_INPUT = 1e6;

/**
 * Register display device models.
 */
export function registerDisplayDevices() {

  // ─── Neopixel / WS2812B ───────────────────────────────────────────
  // Single-wire serial protocol. Each pixel: 24 bits (GRB, MSB first).
  // For simulation: we track the color state. The serial timing is
  // decoded from the data pin edges.
  //
  // Timing: 0-bit = 0.4µs high + 0.85µs low, 1-bit = 0.8µs high + 0.45µs low.
  // Reset: >50µs low.
  //
  // This is a behavioral model — we decode the bits and store RGB values.
  registerDevice('neopixel', {
    terminals: ['din', 'dout', 'vcc', 'gnd'],

    init(part) {
      const numPixels = part.params?.pixels ?? 8;
      return {
        drives: { dout: { vTh: 0, rTh: 50 } },
        pixels: new Array(numPixels).fill(0), // packed RGB: 0xRRGGBB
        _bitBuffer: [],
        _lastHigh: false,
        _riseNs: 0n,
        _fallNs: 0n,
        _lastUpdateNs: 0n,
      };
    },

    stamp(ctx) {
      ctx.conductance('din', null, 1 / R_INPUT);
    },

    // Boundary B setDeviceControl (spec-updates/set-device-control.md).
    // Writes the same pixels[] the WS2812B bit decoder writes; an
    // out-of-range index is refused (visibly, via the board's warning).
    control(part, state, verb, value) {
      if (verb === 'neopixel') {
        const a = Array.isArray(value) ? value : [];
        const i = a[0] | 0;
        if (i < 0 || i >= state.pixels.length) return false;
        state.pixels[i] = (((a[1] | 0) & 0xff) << 16)
          | (((a[2] | 0) & 0xff) << 8)
          | ((a[3] | 0) & 0xff);
        return true;
      }
      if (verb === 'clearNeopixels') {
        state.pixels.fill(0);
        return true;
      }
      return false;
    },

    update(part, state, read, tNs) {
      const vcc = read('vcc') || 5.0;
      const threshold = vcc * 0.5;
      const dinV = read('din');
      const isHigh = dinV > threshold;

      // Edge detection
      if (isHigh && !state._lastHigh) {
        // Rising edge
        state._riseNs = tNs;
      } else if (!isHigh && state._lastHigh) {
        // Falling edge — measure high time to decode bit
        const highTimeNs = Number(tNs - state._riseNs);
        // 0-bit: ~400ns high, 1-bit: ~800ns high. Threshold at 550ns.
        if (highTimeNs > 100 && highTimeNs < 2000) {
          state._bitBuffer.push(highTimeNs > 550 ? 1 : 0);
        }
        state._fallNs = tNs;
      }
      state._lastHigh = isHigh;

      // Reset detection: if low for > 50µs, latch the data
      if (!isHigh && state._fallNs > 0n) {
        const lowTime = Number(tNs - state._fallNs);
        if (lowTime > 50000 && state._bitBuffer.length > 0) {
          // Decode bits into pixels (24 bits per pixel, GRB order)
          const numPixels = part.params?.pixels ?? 8;
          for (let p = 0; p < numPixels && (p + 1) * 24 <= state._bitBuffer.length; p++) {
            let val = 0;
            for (let b = 0; b < 24; b++) {
              val = (val << 1) | (state._bitBuffer[p * 24 + b] ?? 0);
            }
            // GRB → RGB: G=bits[0:7], R=bits[8:15], B=bits[16:23]
            const g = (val >> 16) & 0xFF;
            const r = (val >> 8) & 0xFF;
            const blue = val & 0xFF;
            state.pixels[p] = (r << 16) | (g << 8) | blue;
          }
          state._bitBuffer = [];
          state._fallNs = 0n;
          return true;
        }
      }

      return false;
    },
  });

  // ─── Bargraph (10-segment LED bar) ────────────────────────────────
  // 10 independent LEDs in a package. Each has an anode and cathode.
  // Terminals: a0-a9 (anodes), k0-k9 (cathodes).
  // Current through each segment determines its brightness.
  registerDevice('bargraph', {
    terminals: ['a0', 'k0', 'a1', 'k1', 'a2', 'k2', 'a3', 'k3', 'a4', 'k4',
                'a5', 'k5', 'a6', 'k6', 'a7', 'k7', 'a8', 'k8', 'a9', 'k9'],

    init() {
      return { drives: {} };
    },

    stamp(ctx, part) {
      // Each segment is a diode (LED) between aN and kN.
      // Use forward voltage drop model.
      const vf = part.params?.vForward ?? 2.0;
      const rd = part.params?.rDynamic ?? 10;

      for (let i = 0; i < 10; i++) {
        // Simplified: conductance when forward biased
        // This is approximate — a real LED stamp needs the MNA diode model.
        // For the device registry, we model as a conductance with threshold.
        ctx.conductance(`a${i}`, `k${i}`, 1 / (rd + 100)); // series R approximation
      }
    },

    update() { return false; }, // passive — no behavioral logic
  });
}
