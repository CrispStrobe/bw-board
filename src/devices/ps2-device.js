/**
 * PS/2 keyboard — board-side device model.
 *
 * The board part holds face-side state: a PS2Keyboard whose keyDown/keyUp
 * queue scan codes. The actual protocol delivery (paced frames, DA strobe,
 * odd parity) runs on the MACHINE side through PS2Capture + ps2OnVia —
 * the same path the standalone ps2.test.mjs golden exercises.
 *
 * Why not drive board terminals and let the MNA carry voltages to the VIA?
 * Because the VIA's CA1 is EDGE-triggered and the adapter's syncInputs
 * samples once per advanceNs. A DA strobe that goes low and high within
 * one board.advanceTo period is invisible to the VIA — the edge is lost.
 * The machine-side PS2Capture calls via.setControl directly per frame,
 * so every edge is seen.
 *
 * The board device still declares terminals (d0-d7, da) so the designer
 * UI can show wiring. The adapter detects the PS/2 part's wiring to
 * determine which VIA port and control line to use.
 *
 * @module
 */

import { registerDevice } from '../devices.js';
import { PS2Keyboard } from '../ps2.js';

export function registerPS2Device() {

  const model = {
    terminals: ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'da'],

    init(part) {
      const kbd = new PS2Keyboard();
      return {
        drives: {},

        // The PS2Keyboard that converts key names → scan-code bytes.
        // The adapter reads this to wire ps2OnVia on the machine side.
        _kbd: kbd,

        // ── Face-side API ──────────────────────────────────────
        /** @param {string} key — a SCAN_CODES / SCAN_CODES_E0 name */
        keyDown(key) { kbd.keyDown(key); },
        /** @param {string} key */
        keyUp(key) { kbd.keyUp(key); },
        /** Convenience: make+break for each character. */
        type(text) { kbd.type(text); },
      };
    },

    // No stamp or update needed — protocol delivery is machine-side.
    // The terminals exist for the designer's wiring display only.
  };

  registerDevice('ps2', model);
}
