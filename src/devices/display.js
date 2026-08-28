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
// A blocking segment is not infinite resistance: the node still needs a
// path or the solver has nothing to place it against.
const R_OPEN_SEG = 1e9;

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
      return {
        drives: {},
        // What the face draws. It was never here, and the renderer reads
        // `ds.brightness` — so every segment of every bargraph on every bench
        // was dark no matter what you wired to it. The disp-bargraph examples
        // ship in seven circuits and showed nothing.
        brightness: new Array(10).fill(0),
        // Which segments the LAST solve found forward-biased. Starts true so
        // the first stamp conducts, as the old fixed conductance did.
        _on: new Array(10).fill(true),
      };
    },

    stamp(ctx, part, state) {
      // Ten LEDs, each a piecewise-linear diode: below vf it blocks, above it
      // conducts through rd. The previous stamp was a plain conductance of
      // 1/(rd+100) in BOTH directions, which is a resistor, not a diode --
      // reverse-connect a segment and it still passed current, and a forward
      // one sat on a divider instead of clamping near its forward drop.
      //
      // Companion form, linearised about the last solution: I = G*(Va-Vk) -
      // G*vf, so the conductance carries G and a constant source carries the
      // offset. `_on` comes from update(), which is the standard
      // stamp-from-the-previous-solution arrangement this device API allows;
      // the built-in led/diode kinds get the solver's Newton-Raphson instead.
      const vf = part.params?.vForward ?? 2.0;
      const rd = Math.max(1e-3, part.params?.rDynamic ?? 10);
      const g = 1 / rd;
      for (let i = 0; i < 10; i++) {
        if (state?._on?.[i]) {
          ctx.conductance(`a${i}`, `k${i}`, g);
          ctx.current(`a${i}`, g * vf);
          ctx.current(`k${i}`, -g * vf);
        } else {
          ctx.conductance(`a${i}`, `k${i}`, 1 / R_OPEN_SEG);
        }
      }
    },

    update(part, state, read) {
      const vf = part.params?.vForward ?? 2.0;
      const rd = Math.max(1e-3, part.params?.rDynamic ?? 10);
      const iFull = part.params?.iFull ?? 0.02;   // 20 mA is a lit segment
      let changed = false;
      for (let i = 0; i < 10; i++) {
        const v = (read(`a${i}`) ?? 0) - (read(`k${i}`) ?? 0);
        // Decide on CURRENT while conducting, not on voltage. Voltage is the
        // wrong test because the companion source is already in the solution:
        // a reverse-connected segment dragged its own cathode negative, which
        // made the measured forward voltage POSITIVE, which kept it on. It
        // latched at -1.79 V and reported itself lit. Asking "is current still
        // flowing the right way" cannot self-confirm like that.
        const amps = (v - vf) / rd;
        const on = state._on[i] ? amps > 0 : v > vf;
        if (on !== state._on[i]) { state._on[i] = on; changed = true; }
        state.brightness[i] = on ? Math.max(0, Math.min(1, amps / iFull)) : 0;
      }
      return changed;
    },
  });
}
