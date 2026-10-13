/**
 * A2 board display devices — SEVENSEG8 and LEDBANK8.
 *
 * SEVENSEG8: 8-digit multiplexed common-cathode 7-segment display.
 * Hardware: 74HC245 buffer for segment data (8 bits: a-g + dp),
 * 74HC138 3-to-8 decoder for digit select (3 address pins A, B, C).
 * Digit 0 when all select lines low. Segments active HIGH for common
 * cathode; the display is ISR-scanned, one digit per tick. The device
 * model shows what the eye sees: each segment's on-time while its digit is
 * selected, integrated over a 20 ms persistence window, lit above a stated
 * duty (PERSISTENCE_WINDOW_NS, DUTY_THRESHOLD). It used to latch the
 * segment byte at the instant the select changed, which read a scan that
 * blanks, selects, then writes the segments (the compiled C's ISR) as a
 * blank display (Lite task B16).
 *
 * LEDBANK8: 8 discrete LEDs on a port. Active-low option (default).
 * Shares P2 with the 7-seg digit select on the A2 board. The devices may
 * coexist in a netlist because that is the real wiring, but they cannot hold
 * independent stable patterns: select activity drives D3-D5 and a whole-port
 * LED write overwrites the 74HC138 address. The state exposes flickerWarning.
 *
 * Reference: stc/docs/A2-BOARD-SUPPORT.md
 * Wiring: stc/docs/BOARD-PRECHIN-A2.md
 *
 * (Repo-relative. These were absolute /mnt/volume1 paths naming one VPS
 * checkout -- harmless here, since they are doc pointers in a comment rather
 * than anything the module loads, but they send a reader to a directory that
 * exists on exactly one machine.)
 *
 * @module
 */

import { registerDevice } from '../devices.js';

// Input pins draw nothing here, on purpose. These models used to declare
// `ctx.conductance(pin, null, 1 / R_INPUT)` with R_INPUT = 1e6 — a call that
// names no second terminal, which stampTwoTerminal's air-leg guard declines,
// so it never stamped. 1 MOhm is not a CMOS input either (a 74HC draws 1 uA
// max). The ideal high-Z input IS the model, and GMIN keeps every pin a real
// node. See spec-updates/ideal-high-z-inputs.md.

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

/**
 * The persistence window: what the eye integrates, 20 ms -- the same window
 * board.js's ledBrightness() averages an LED's current over
 * (BRIGHTNESS_WINDOW_NS), and the LED cube's voxel integrator. A scan whose
 * whole frame fits in it (the C's Timer-0 ISR: 1 ms per digit, 8 ms per
 * frame, 125 Hz) shows every digit in every window.
 */
const PERSISTENCE_WINDOW_NS = 20_000_000n;

/**
 * A segment is lit when it was on for at least this fraction of the window
 * while its digit was selected: 1/32, a quarter of one digit's share of an
 * 8-digit scan (1/8). An 8-digit scan at 1 ms per digit gives every lit
 * segment 2 or 3 ms of the 20 ms window (10-15 %, three to five times this);
 * the transients a scan leaves on the other addresses -- the 74HC138 address
 * passing through intermediate values while its three pins change one at a
 * time, or the segments of the next digit before the select moves -- last
 * microseconds (< 0.1 %), thirty times below it. Above zero on purpose: at
 * zero those transients light (the `52547678` ghost B7 named).
 */
const DUTY_THRESHOLD = 1 / 32;

const SEG_PINS = ['seg_a', 'seg_b', 'seg_c', 'seg_d',
  'seg_e', 'seg_f', 'seg_g', 'seg_dp'];

/** Add (sign 1) or remove (sign -1) `dt` ns of one (sel, seg) step. */
function accumulate(state, sel, seg, dt, sign) {
  if (dt === 0) return;
  state._accSel[sel] += sign * dt;
  for (let s = 0; s < 8; s++) if ((seg >> s) & 1) state._accSeg[sel * 8 + s] += sign * dt;
}

/**
 * What the eye sees over the window ending at `now`: per digit, each
 * segment's on-time while that digit was selected. Fills `state.segDuty`
 * (64 entries, digit * 8 + segment, fraction of the window) and
 * `state.selDuty` (8, the fraction each digit was selected), then
 * `state.digits` / `state.text`.
 *
 * A digit the window never selected for any time keeps the frame the select
 * change latched (`_latched`). That is the zero-time push: the stc12 blocks
 * write a whole frame at one instant of board time (they stand in for an
 * ISR the board does not run), so only the digit left selected has time in
 * the window. A timed scan selects every digit in every window and is read
 * from its on-time alone.
 *
 * `_accSel` / `_accSeg` hold the CLOSED steps (every step but the last) in
 * full, in integer nanoseconds (exact in a double); the part of the first
 * step before the window and the open last step are settled here, so one
 * update costs the same however long the scan's history is.
 */
function integrateSevenseg8(state, now) {
  const hist = state._hist;
  const windowStart = now > PERSISTENCE_WINDOW_NS ? now - PERSISTENCE_WINDOW_NS : 0n;
  const w = Number(now - windowStart);
  const selNs = Float64Array.from(state._accSel);
  const segNs = Float64Array.from(state._accSeg);
  const first = hist[0];
  const last = hist[hist.length - 1];
  if (hist.length > 1 && first.tNs < windowStart) {
    // The first (closed) step runs into the window: drop its part before it.
    const before = Number(windowStart - first.tNs);
    selNs[first.sel] -= before;
    for (let s = 0; s < 8; s++) if ((first.seg >> s) & 1) segNs[first.sel * 8 + s] -= before;
  }
  const openFrom = last.tNs > windowStart ? last.tNs : windowStart;
  const open = Number(now - openFrom);
  selNs[last.sel] += open;
  for (let s = 0; s < 8; s++) if ((last.seg >> s) & 1) segNs[last.sel * 8 + s] += open;

  let changed = false;
  for (let d = 0; d < 8; d++) {
    state.selDuty[d] = w > 0 ? selNs[d] / w : 0;
    let byte = 0;
    for (let s = 0; s < 8; s++) {
      const duty = w > 0 ? segNs[d * 8 + s] / w : 0;
      state.segDuty[d * 8 + s] = duty;
      if (duty >= DUTY_THRESHOLD) byte |= 1 << s;
    }
    if (!(selNs[d] > 0)) byte = state._latched[d];
    if (state.digits[d] !== byte) {
      state.digits[d] = byte;
      state.text[d] = decodeSegments(byte);
      changed = true;
    }
  }
  return changed;
}

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
        // What the display shows, per digit: digit[0] is selected when
        // sel = 000. Persistence of vision over the window (see
        // integrateSevenseg8), not the byte at one instant.
        digits: new Uint8Array(8),
        // Decoded text representation for the face
        text: Array(8).fill(' '),
        // Per digit x segment on-time over the window, as a fraction of it
        // (digit * 8 + segment), and per digit its selected fraction. Not
        // named segBrightness: the canvas would draw that raw, and an 8-digit
        // scan's 12.5 % reads dim there while a zero-time block push reads 0.
        segDuty: new Float64Array(64),
        selDuty: new Float64Array(8),
        // Current select address (0-7)
        selectedDigit: 0,
        // Common anode inverts the segment logic
        commonAnode,
        // (sel, segment byte) steps over time: [{tNs, sel, seg}], the first
        // at or before the window's start.
        _hist: [{ tNs: 0n, sel: 0, seg: 0 }],
        _accSel: new Float64Array(8),
        _accSeg: new Float64Array(64),
        // The frame a select change latches, for a digit the window never
        // selected (a zero-time push). Two-phase select debounce: _pendingSel
        // holds the last seen select address; when the same value is seen
        // again (stable), it becomes the new _stableSel and the latch fires.
        // This filters the intermediate addresses that appear when 3
        // individual setPin calls update the select pins one at a time.
        // _stableSel starts at 0: all select pins LOW at reset.
        _latched: new Uint8Array(8),
        _pendingSel: 0,
        _stableSel: 0,
      };
    },

    // All inputs are high-impedance CMOS: no stamp at all
    // (spec-updates/ideal-high-z-inputs.md).
    update(part, state, read, atNs) {
      const vcc = read('vcc') || 5.0;
      const th = vcc * 0.5;

      // Read the 3-bit digit select (74HC138 address)
      const selA = read('sel_a') > th ? 1 : 0;
      const selB = read('sel_b') > th ? 1 : 0;
      const selC = read('sel_c') > th ? 1 : 0;
      const sel = selA | (selB << 1) | (selC << 2);

      // Read the segment byte
      let seg = 0;
      for (let i = 0; i < 8; i++) {
        if (read(SEG_PINS[i]) > th) seg |= (1 << i);
      }

      // Common anode: invert segment logic (segments LOW = lit)
      if (state.commonAnode) seg = (~seg) & 0xff;
      state.selectedDigit = sel;

      // The time-integrated record: one step per change of (sel, seg).
      const hist = state._hist;
      const last = hist[hist.length - 1];
      const now = typeof atNs === 'bigint' && atNs > last.tNs ? atNs : last.tNs;
      if (last.sel !== sel || last.seg !== seg) {
        if (now === last.tNs) {
          // Same instant: the last step lasted no time; replace it.
          last.sel = sel;
          last.seg = seg;
        } else {
          accumulate(state, last.sel, last.seg, Number(now - last.tNs), 1);
          hist.push({ tNs: now, sel, seg });
        }
      }
      // Prune to the window, keeping the step in force at its start.
      const windowStart = now > PERSISTENCE_WINDOW_NS ? now - PERSISTENCE_WINDOW_NS : 0n;
      let keep = 0;
      while (keep + 1 < hist.length && hist[keep + 1].tNs <= windowStart) {
        accumulate(state, hist[keep].sel, hist[keep].seg, Number(hist[keep + 1].tNs - hist[keep].tNs), -1);
        keep++;
      }
      if (keep > 0) hist.splice(0, keep);

      // Debounced edge latch (the zero-time frame; see integrateSevenseg8):
      // latches when the select address has CHANGED from the previous
      // stable value AND has been seen on two consecutive updates.
      if (sel !== state._stableSel) {
        if (sel !== state._pendingSel) {
          state._pendingSel = sel; // first sighting of a new address
        } else {
          state._stableSel = sel;
          state._latched[sel] = seg;
        }
      }

      return integrateSevenseg8(state, now);
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

export { FONT, decodeSegments, PERSISTENCE_WINDOW_NS, DUTY_THRESHOLD };
