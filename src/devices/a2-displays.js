/**
 * A2 board display devices — SEVENSEG8 and LEDBANK8.
 *
 * SEVENSEG8: 8-digit multiplexed common-cathode 7-segment display.
 * Hardware: 74HC245 buffer for segment data (8 bits: a-g + dp),
 * 74HC138 3-to-8 decoder for digit select (3 address pins A, B, C).
 * Digit 0 when all select lines low. Segments active HIGH for common
 * cathode; the display is ISR-scanned, one digit per tick. The device
 * model latches the segment byte for the selected digit on every
 * update, exposing per-digit segment state for the face to render.
 *
 * LEDBANK8: 8 discrete LEDs on a port. Active-low option (default).
 * Shares P2 with the 7-seg digit select on the A2 board — modeled
 * honestly: both devices can coexist, but the state exposes a
 * flickerWarning when the shared port is driven by both. The ISR
 * owns the shadow byte; direct port writes race with the scan.
 *
 * Reference: /mnt/volume1/code/stc/docs/A2-BOARD-SUPPORT.md
 * Wiring: /mnt/volume1/code/stc/docs/BOARD-PRECHIN-A2.md
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_INPUT = 1e6;

// ─── 7-segment font table (0-9, A-F) ────────────────────────────────
// Segment mapping: bit 0=a, 1=b, 2=c, 3=d, 4=e, 5=f, 6=g, 7=dp
//   a
//  f   b
//   g
//  e   c
//   d   dp
const FONT = [
  0x3f, // 0: a b c d e f
  0x06, // 1: b c
  0x5b, // 2: a b d e g
  0x4f, // 3: a b c d g
  0x66, // 4: b c f g
  0x6d, // 5: a c d f g
  0x7d, // 6: a c d e f g
  0x07, // 7: a b c
  0x7f, // 8: a b c d e f g
  0x6f, // 9: a b c d f g
  0x77, // A: a b c e f g
  0x7c, // b: c d e f g
  0x39, // C: a d e f
  0x5e, // d: b c d e g
  0x79, // E: a d e f g
  0x71, // F: a e f g
];

/**
 * Decode a segment byte into a display character.
 * Returns the hex digit (0-15) if it matches the font, '.' for dp-only,
 * ' ' for blank (0x00), or the raw hex byte as a string.
 */
function decodeSegments(seg) {
  const withoutDp = seg & 0x7f;
  if (withoutDp === 0x00) return seg & 0x80 ? '.' : ' ';
  const idx = FONT.indexOf(withoutDp);
  if (idx >= 0) return idx.toString(16).toUpperCase() + (seg & 0x80 ? '.' : '');
  return `0x${seg.toString(16).padStart(2, '0')}`;
}

// ─── SEVENSEG8 ──────────────────────────────────────────────────────

export function registerSevenseg8() {
  registerDevice('sevenseg8', {

    // Segment port (directly from MCU via 74HC245):
    //   seg_a..seg_g, seg_dp — the 8 segment data lines
    // Digit select (74HC138 address inputs):
    //   sel_a, sel_b, sel_c — 3-bit binary digit address
    // Power:
    //   vcc, gnd
    terminals: [
      'vcc', 'gnd',
      'seg_a', 'seg_b', 'seg_c', 'seg_d',
      'seg_e', 'seg_f', 'seg_g', 'seg_dp',
      'sel_a', 'sel_b', 'sel_c',
    ],

    init(part) {
      const commonAnode = /anode/i.test(part.params?.common ?? '');
      return {
        drives: {},
        // Per-digit segment state: digit[0] is selected when sel = 000
        digits: new Uint8Array(8),
        // Decoded text representation for the face
        text: Array(8).fill(' '),
        // Current select address (0-7)
        selectedDigit: 0,
        // Common anode inverts the segment logic
        commonAnode,
        // Two-phase select debounce: _pendingSel holds the last seen
        // select address; when the same value is seen again (stable),
        // it becomes the new _stableSel and the latch fires. This
        // filters the intermediate addresses that appear when 3
        // individual setPin calls update the select pins one at a time.
        // _stableSel starts at 0: all select pins LOW at reset → digit 0
        // is the initial stable address. The first latch fires when the
        // select changes away from 0 (or from 0→0 after a different digit).
        _pendingSel: 0,
        _stableSel: 0,
      };
    },

    stamp(ctx) {
      // All inputs: high impedance CMOS
      for (const t of ['seg_a', 'seg_b', 'seg_c', 'seg_d',
                        'seg_e', 'seg_f', 'seg_g', 'seg_dp',
                        'sel_a', 'sel_b', 'sel_c']) {
        ctx.conductance(t, null, 1 / R_INPUT);
      }
    },

    update(part, state, read) {
      const vcc = read('vcc') || 5.0;
      const th = vcc * 0.5;

      // Read the 3-bit digit select (74HC138 address)
      const selA = read('sel_a') > th ? 1 : 0;
      const selB = read('sel_b') > th ? 1 : 0;
      const selC = read('sel_c') > th ? 1 : 0;
      const sel = selA | (selB << 1) | (selC << 2);

      // Read the segment byte
      let seg = 0;
      const segPins = ['seg_a', 'seg_b', 'seg_c', 'seg_d',
                        'seg_e', 'seg_f', 'seg_g', 'seg_dp'];
      for (let i = 0; i < 8; i++) {
        if (read(segPins[i]) > th) seg |= (1 << i);
      }

      // Common anode: invert segment logic (segments LOW = lit)
      if (state.commonAnode) seg = (~seg) & 0xff;

      // Debounced edge latch: the 74HC138 address changes one pin at
      // a time (3 setPin calls). Intermediate addresses are transient.
      // The model latches when the select address has CHANGED from the
      // previous stable value AND has been seen on two consecutive
      // updates (stable). Segment-only changes (sel unchanged) never
      // trigger a latch — the ISR writes segments THEN changes select.
      state.selectedDigit = sel;
      if (sel === state._stableSel) {
        // No select change: don't latch (segments being written)
        return false;
      }
      if (sel !== state._pendingSel) {
        state._pendingSel = sel;
        return false; // first sighting of a new address — debounce
      }
      // Confirmed: same new sel seen twice → stable transition
      state._stableSel = sel;
      const prev = state.digits[sel];
      state.digits[sel] = seg;
      state.text[sel] = decodeSegments(seg);

      return prev !== seg;
    },
  });
}

// ─── LEDBANK8 ───────────────────────────────────────────────────────

export function registerLedbank8() {
  registerDevice('ledbank8', {

    // 8 LED data pins + power
    terminals: [
      'vcc', 'gnd',
      'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7',
    ],

    init(part) {
      const activeLow = part.params?.activeLow !== false; // default active-low
      return {
        drives: {},
        // Per-LED on/off state (true = lit)
        leds: new Uint8Array(8),
        // Raw port byte (before active-low inversion); init to -1 so the
        // first update always runs (even if the port starts at 0x00).
        portByte: -1,
        // Active-low: LED on when pin LOW
        activeLow,
        // Shared-port flicker warning (set externally when both
        // SEVENSEG8 select and LEDBANK8 share the same port)
        flickerWarning: false,
      };
    },

    stamp(ctx) {
      for (let i = 0; i < 8; i++) {
        ctx.conductance(`d${i}`, null, 1 / R_INPUT);
      }
    },

    update(part, state, read) {
      const vcc = read('vcc') || 5.0;
      const th = vcc * 0.5;

      let portByte = 0;
      for (let i = 0; i < 8; i++) {
        if (read(`d${i}`) > th) portByte |= (1 << i);
      }

      if (portByte === state.portByte) return false;
      state.portByte = portByte;

      // Apply active-low inversion
      const effective = state.activeLow ? (~portByte) & 0xff : portByte;
      for (let i = 0; i < 8; i++) {
        state.leds[i] = (effective >> i) & 1;
      }

      return true;
    },
  });
}

export { FONT, decodeSegments };
