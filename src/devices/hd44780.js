/**
 * HD44780U character-LCD behavioral model — the 16-pin parallel module.
 *
 * Implements the full instruction set from the Hitachi HD44780U datasheet
 * (ADE-207-272(Z), Rev. 0.0, 1999-09-29), including:
 *  - 4-bit and 8-bit data interfaces
 *  - Busy flag with realistic timing per Table 6 (p.24)
 *  - 80-byte DDRAM (0x00-0x27 line 1, 0x40-0x67 line 2)
 *  - 64-byte CGRAM for user-defined characters
 *  - Entry mode (increment/decrement, display shift)
 *  - Display on/off, cursor on/off, cursor blink
 *  - Cursor/display shift instructions
 *  - DDRAM address → row/col mapping for 2×16 (1×16, 2×20, 4×20)
 *
 * Terminals per the standard 16-pin module:
 *   1 VSS (ground), 2 VDD (power), 3 V0 (contrast),
 *   4 RS, 5 RW, 6 E, 7-14 D0-D7, 15 A (backlight anode), 16 K (cathode)
 *
 * Datasheet §Figure 9 (p.22): data is latched on the FALLING edge of E.
 * Read data is valid while E is high.
 *
 * All timing values from Table 6 (p.24):
 *   Clear display / Return home: 1.52 ms
 *   All other instructions:      37 µs (worst case for standard freq)
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_OUT = 50;
// Input pins draw nothing here, on purpose. These models used to declare
// `ctx.conductance(pin, null, 1 / R_INPUT)` with R_INPUT = 1e6 — a call that
// names no second terminal, which stampTwoTerminal's air-leg guard declines,
// so it never stamped. 1 MOhm is not a CMOS input either (a 74HC draws 1 uA
// max). The ideal high-Z input IS the model, and GMIN keeps every pin a real
// node. See spec-updates/ideal-high-z-inputs.md.

// ─── Timing constants (nanoseconds), from HD44780U Table 6 (p.24) ───────
const BUSY_CLEAR_NS   = 1_520_000n;  // clear display, return home
const BUSY_DEFAULT_NS = 37_000n;     // all other instructions

// ─── DDRAM layout (HD44780U §Table 4, p.11) ─────────────────────────────
// Standard 2-line display: line 1 starts at 0x00, line 2 at 0x40.
// Each line has 40 positions (0x00-0x27, 0x40-0x67) though only cols
// positions are visible at a time (typically 16 or 20).

/**
 * Register the HD44780 16-pin parallel LCD device model.
 */
export function registerHD44780() {

  const model = {
    digitalFastPath: true,
    // The standard 16-pin LCD module
    terminals: [
      'vss', 'vdd', 'v0',           // power + contrast
      'rs', 'rw', 'e',              // control
      'd0', 'd1', 'd2', 'd3',       // data low nibble (unused in 4-bit mode)
      'd4', 'd5', 'd6', 'd7',       // data high nibble
      'a', 'k',                     // backlight LED
    ],

    init(part) {
      const cols = part.params?.cols ?? 16;
      const rows = part.params?.rows ?? 2;
      return {
        drives: {},

        // ── HD44780 internal registers ──────────────────────────
        ddram: new Uint8Array(80),         // 80 bytes DDRAM (§5.1)
        cgram: new Uint8Array(64),         // 64 bytes CGRAM (§5.2)
        ac: 0,                             // address counter (7 bits)
        acIsCgram: false,                  // true when AC points into CGRAM

        // Contrast: the LC drive is VDD−V0 (§Power supply, p.14). Near
        // 0 V on V0 the segments are fully dark against the backlight;
        // as V0 rises toward VDD the drive collapses and the text fades
        // out. 0..1 for the face; updated from the nets every step.
        contrast: 1,

        // Display control (§Table 6)
        displayOn: false,                  // D: display on/off
        cursorOn: false,                   // C: cursor on/off
        blinkOn: false,                    // B: cursor blink
        increment: true,                   // I/D: 1=increment, 0=decrement
        shiftDisplay: false,               // S: shift display on data write
        is4Bit: false,                     // DL: 0=4-bit, 1=8-bit
        twoLine: false,                    // N: 0=1-line, 1=2-line
        font5x10: false,                   // F: 0=5×8, 1=5×10
        displayShift: 0,                   // display shift offset

        // Busy flag + timing
        busyUntilNs: 0n,                   // tNs when busy clears

        // 4-bit interface state (§Figure 11, p.22)
        _nibblePhase: 0,                   // 0=waiting high nibble, 1=have it
        _highNibble: 0,                    // stashed high nibble

        // E pin edge detection
        _lastE: false,
        // RS/RW tracking for nibble-phase reset (§Application Note):
        // The HD44780's internal nibble counter resets to "high nibble"
        // whenever the operation type changes (RS or RW changes between
        // E pulses). This keeps the 4-bit interface synchronized when
        // a partial write is abandoned for a read (e.g., busy-flag poll).
        _lastRs: 0,
        _lastRw: 0,

        // Public: state for UI consumption
        backlight: 0,    // 0..1 from A-K branch current (rated 20 mA)
        text: Array.from({ length: rows }, () => ' '.repeat(cols)),
        _cols: cols,
        _rows: rows,
      };
    },

    stamp(ctx) {
      // Data and control pins draw nothing: they are CMOS inputs, and the
      // 1 MOhm declarations that used to claim otherwise named no second
      // terminal and never stamped (spec-updates/ideal-high-z-inputs.md).
      // Backlight LED: simplified ~20mA at Vf≈3.2V
      ctx.conductance('a', 'k', 1 / 100);
    },

    // High-level verbs (boundary B setDeviceControl,
    // spec-updates/set-device-control.md): write the same DDRAM/AC the
    // bus path writes; the register machinery stays authoritative for
    // MCU-driven benches. Printing implies the learner wants to see it.
    control(part, state, verb, value) {
      switch (verb) {
        case 'clear':
          state.ddram.fill(0x20);
          state.ac = 0;
          state.displayOn = true;
          return true;
        case 'cursor': {
          const a = Array.isArray(value) ? value : [0, 0];
          // Line bases per the common controller mapping (2- and 4-line).
          const bases = [0x00, 0x40, 0x14, 0x54];
          const row = Math.max(0, Math.min(3, a[0] | 0));
          const col = Math.max(0, Math.min(39, a[1] | 0));
          state.ac = (bases[row] + col) & 0x7f;
          return true;
        }
        case 'print': {
          for (const ch of String(value)) {
            state.ddram[_ddramAddr(state.ac)] = ch.charCodeAt(0) & 0xff;
            state.ac = (state.ac + 1) & 0x7f;
          }
          state.displayOn = true;
          return true;
        }
      }
      return false;
    },

    update(part, state, read, tNs) {
      const vdd = read('vdd') || 5.0;
      const vss = read('vss') || 0;
      const threshold = vdd * 0.4;  // CMOS-level threshold

      // ── Backlight: A-K branch current → brightness 0..1 ──────
      // The stamp models the backlight LED as 100Ω (conductance 1/100).
      // Current = (Va - Vk) / 100. Normalize to 20 mA rated.
      const vA = read('a');
      const vK = read('k');
      const blCurrent = Math.max(0, (vA - vK)) / 100;
      state.backlight = Math.min(1, Math.max(0, blCurrent / 0.020));

      // Contrast tracks the V0 pin continuously: drive = VDD − V0. The
      // knee mirrors a real 5 V module — full contrast with V0 below
      // ~1 V, fading through the pot's travel, gone by V0 ≈ 3 V. An
      // unwired V0 reads 0 V (grounded-by-gmin), which is max contrast —
      // the same default every wiring tutorial uses.
      {
        const v0 = read('v0') || 0;
        const drive = vdd - v0;
        state.contrast = Math.max(0, Math.min(1, (drive - 2) / 2));
      }

      const eHigh = read('e') > threshold;
      const wasE = state._lastE;
      state._lastE = eHigh;

      const rs = read('rs') > threshold ? 1 : 0;
      const rw = read('rw') > threshold ? 1 : 0;

      // ── Nibble-phase reset on RS/RW change ──────────────────
      // The HD44780's internal nibble counter resets to "expecting
      // high nibble" whenever RS or RW changes between E pulses.
      // This ensures that a partial write (one nibble latched,
      // waiting for the second) is discarded when the controller
      // switches to a read or to a different register. Without
      // this, the 4-bit interface desynchronizes when firmware
      // sends two-nibble writes where the first nibble triggers a
      // mode change (e.g., the 8-bit → 4-bit function-set switch
      // in the init-by-instruction sequence).
      if (rs !== state._lastRs || rw !== state._lastRw) {
        state._nibblePhase = 0;
        state._lastRs = rs;
        state._lastRw = rw;
      }

      // ── Read mode: drive data pins while E is high ──────────
      if (rw === 1 && eHigh) {
        // HD44780U §Figure 9: read data valid while E=1
        let outByte;
        if (rs === 0) {
          // Read busy flag + address counter (§Table 6, instruction 4)
          const busy = tNs < state.busyUntilNs ? 1 : 0;
          outByte = (busy << 7) | (state.ac & 0x7f);
        } else {
          // Read data from DDRAM/CGRAM at current AC
          outByte = state.acIsCgram
            ? state.cgram[state.ac & 0x3f]
            : state.ddram[_ddramAddr(state.ac)];
        }

        // Drive data pins with the read value
        if (state.is4Bit) {
          // In 4-bit mode, only D4-D7 are connected
          // First read gives high nibble, second gives low nibble
          // (same nibble sequencing as writes, §Figure 11)
          const nibble = state._nibblePhase === 0
            ? (outByte >> 4) & 0x0f
            : outByte & 0x0f;
          for (let i = 0; i < 4; i++) {
            state.drives[`d${i + 4}`] = {
              vTh: (nibble >> i) & 1 ? vdd : 0,
              rTh: R_OUT,
            };
          }
        } else {
          for (let i = 0; i < 8; i++) {
            state.drives[`d${i}`] = {
              vTh: (outByte >> i) & 1 ? vdd : 0,
              rTh: R_OUT,
            };
          }
        }
        return true;
      }

      // Release data pins when not reading
      if (rw === 0 || !eHigh) {
        let released = false;
        for (let i = 0; i < 8; i++) {
          if (state.drives[`d${i}`]) {
            delete state.drives[`d${i}`];
            released = true;
          }
        }
        if (released && rw === 0 && !eHigh && !wasE) return false;
      }

      // ── Write: latch on E falling edge (§Figure 9, p.22) ───
      if (!eHigh && wasE && rw === 0) {
        // Read data bus
        let dataByte;
        if (state.is4Bit) {
          // 4-bit mode: two E pulses per byte (§Figure 11, p.22)
          const nibble =
            ((read('d4') > threshold ? 1 : 0) << 0) |
            ((read('d5') > threshold ? 1 : 0) << 1) |
            ((read('d6') > threshold ? 1 : 0) << 2) |
            ((read('d7') > threshold ? 1 : 0) << 3);

          if (state._nibblePhase === 0) {
            state._highNibble = nibble;
            state._nibblePhase = 1;
            return false; // wait for low nibble
          }
          dataByte = (state._highNibble << 4) | nibble;
          state._nibblePhase = 0;
        } else {
          dataByte = 0;
          for (let i = 0; i < 8; i++) {
            if (read(`d${i}`) > threshold) dataByte |= (1 << i);
          }
        }

        // Reject writes while busy (§p.22: "when BF=1, the next instruction
        // will not be accepted")
        if (tNs < state.busyUntilNs) return false;

        _execute(state, rs, dataByte, tNs);
        _rebuildText(state);
        return true;
      }

      // ── 4-bit read: track nibble phase on E falling edge ────
      if (!eHigh && wasE && rw === 1) {
        if (state.is4Bit) {
          if (state._nibblePhase === 0) {
            state._nibblePhase = 1;
          } else {
            state._nibblePhase = 0;
            // After full read, auto-increment AC (§Table 6, read data)
            if (rs === 1) _advanceAC(state);
          }
        } else {
          if (rs === 1) _advanceAC(state);
        }
        return false;
      }

      return false;
    },
  };

  registerDevice('hd44780', model);

  // 'char_lcd' — the SAME silicon under the designer catalog's terminal
  // names. bw-circuit-ui ships the part as char_lcd with the designer's
  // house convention (vcc/gnd/vo/bl_a/bl_k where the datasheet says
  // vdd/vss/v0/a/k; rs/rw/e/d0-d7 agree). One model, two skins — a
  // second implementation here would be the terminal-contract divergence
  // class all over again, one layer down.
  const LCD_ALIAS = { vdd: 'vcc', vss: 'gnd', v0: 'vo', a: 'bl_a', k: 'bl_k' };
  registerDevice('char_lcd', {
    terminals: ['rs', 'rw', 'e', 'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7',
      'vcc', 'gnd', 'vo', 'bl_a', 'bl_k'],
    init: (part) => model.init(part),
    stamp(ctx) {
      ctx.conductance('bl_a', 'bl_k', 1 / 100);
    },
    update: (part, state, read, tNs) =>
      model.update(part, state, (t) => read(LCD_ALIAS[t] ?? t), tNs),
    control: (part, state, verb, value) => model.control(part, state, verb, value),
  });
}

// ─── DDRAM address mapping (§Table 4, p.11) ──────────────────────────────
// Valid addresses: 0x00-0x27 (line 1), 0x40-0x67 (line 2).
// Map to a flat 80-byte array: 0x00-0x27 → indices 0-39,
// 0x40-0x67 → indices 40-79.
function _ddramAddr(ac) {
  const a = ac & 0x7f;
  if (a >= 0x40) return 40 + (a - 0x40) % 40;
  return a % 40;
}

// ─── Instruction execution (§Table 6, p.24) ──────────────────────────────
// After each instruction completes, the internal nibble counter resets to
// "expecting high nibble." This keeps the 4-bit interface synchronized
// even when stray E pulses occur during 8-bit → 4-bit mode transitions
// (as in BeebEater's init sequence, where LCD_WRITE always sends two
// nibbles but the first one triggers the mode switch).
function _execute(state, rs, data, tNs) {
  // Reset the nibble phase: after an instruction completes, the HD44780
  // expects the high nibble first for the next operation.
  state._nibblePhase = 0;

  if (rs === 1) {
    // Data write: write to DDRAM or CGRAM at current AC
    if (state.acIsCgram) {
      state.cgram[state.ac & 0x3f] = data;
    } else {
      state.ddram[_ddramAddr(state.ac)] = data;
    }
    _advanceAC(state);
    state.busyUntilNs = tNs + BUSY_DEFAULT_NS;
    return;
  }

  // ── Instruction decode (§Table 6) ──────────────────────────
  // Instructions are decoded MSB-first; the first set bit determines
  // the instruction (§p.24: "The highest bit that is set determines
  // the instruction").

  if (data === 0x01) {
    // Clear display (§Table 6, instruction 1)
    // Clears DDRAM to 0x20 (space), sets AC to 0, resets shift
    state.ddram.fill(0x20);
    state.ac = 0;
    state.acIsCgram = false;
    state.displayShift = 0;
    state.increment = true;        // I/D=1 per datasheet
    state.busyUntilNs = tNs + BUSY_CLEAR_NS;
    return;
  }

  if ((data & 0xfe) === 0x02) {
    // Return home (§Table 6, instruction 2)
    // AC=0, display shift reset, DDRAM unchanged
    state.ac = 0;
    state.acIsCgram = false;
    state.displayShift = 0;
    state.busyUntilNs = tNs + BUSY_CLEAR_NS;
    return;
  }

  if ((data & 0xfc) === 0x04) {
    // Entry mode set (§Table 6, instruction 3)
    state.increment = !!(data & 0x02);   // I/D
    state.shiftDisplay = !!(data & 0x01); // S
    state.busyUntilNs = tNs + BUSY_DEFAULT_NS;
    return;
  }

  if ((data & 0xf8) === 0x08) {
    // Display on/off control (§Table 6, instruction 4)
    state.displayOn = !!(data & 0x04);   // D
    state.cursorOn = !!(data & 0x02);    // C
    state.blinkOn = !!(data & 0x01);     // B
    state.busyUntilNs = tNs + BUSY_DEFAULT_NS;
    return;
  }

  if ((data & 0xf0) === 0x10) {
    // Cursor or display shift (§Table 6, instruction 5)
    const sc = !!(data & 0x08); // S/C: 1=display shift, 0=cursor move
    const rl = !!(data & 0x04); // R/L: 1=right, 0=left
    if (sc) {
      // Display shift
      state.displayShift += rl ? 1 : -1;
    } else {
      // Cursor move (AC moves)
      if (rl) state.ac = (state.ac + 1) & 0x7f;
      else state.ac = (state.ac - 1) & 0x7f;
    }
    state.busyUntilNs = tNs + BUSY_DEFAULT_NS;
    return;
  }

  if ((data & 0xe0) === 0x20) {
    // Function set (§Table 6, instruction 6)
    state.is4Bit = !(data & 0x10);       // DL: 0=4-bit
    state.twoLine = !!(data & 0x08);     // N
    state.font5x10 = !!(data & 0x04);    // F
    state.busyUntilNs = tNs + BUSY_DEFAULT_NS;
    return;
  }

  if ((data & 0xc0) === 0x40) {
    // Set CGRAM address (§Table 6, instruction 7)
    state.ac = data & 0x3f;
    state.acIsCgram = true;
    state.busyUntilNs = tNs + BUSY_DEFAULT_NS;
    return;
  }

  if (data & 0x80) {
    // Set DDRAM address (§Table 6, instruction 8)
    state.ac = data & 0x7f;
    state.acIsCgram = false;
    state.busyUntilNs = tNs + BUSY_DEFAULT_NS;
    return;
  }
}

// ─── Address counter advance (§5.1, p.10) ─────────────────────────────────
function _advanceAC(state) {
  if (state.acIsCgram) {
    state.ac = (state.ac + (state.increment ? 1 : -1)) & 0x3f;
  } else {
    const prev = state.ac;
    state.ac = (state.ac + (state.increment ? 1 : -1)) & 0x7f;
    // Wrap between line 1 and line 2 in 2-line mode:
    // End of line 1 (0x27) wraps to line 2 (0x40),
    // end of line 2 (0x67) wraps to line 1 (0x00)
    if (state.twoLine) {
      if (state.increment) {
        if (prev === 0x27) state.ac = 0x40;
        else if (prev === 0x67) state.ac = 0x00;
      } else {
        if (prev === 0x40) state.ac = 0x27;
        else if (prev === 0x00) state.ac = 0x67;
      }
    }
  }
  if (state.shiftDisplay && !state.acIsCgram) {
    state.displayShift += state.increment ? 1 : -1;
  }
}

// ─── Rebuild visible text from DDRAM (for UI) ────────────────────────────
function _rebuildText(state) {
  const { _cols: cols, _rows: rows } = state;
  const lineStarts = rows >= 2 ? [0x00, 0x40] : [0x00];
  if (rows === 4) {
    // 4-line displays: line 3 = 0x14, line 4 = 0x54 (common controller mapping)
    lineStarts.push(0x14, 0x54);
  }
  const text = [];
  for (let r = 0; r < rows && r < lineStarts.length; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const addr = (lineStarts[r] + c) % 40 + (r >= 2 ? 0 : (lineStarts[r] >= 0x40 ? 40 : 0));
      // Simpler: just use the DDRAM flat mapping
      const ddAddr = lineStarts[r] + c;
      const flat = _ddramAddr(ddAddr);
      const ch = state.ddram[flat];
      // Characters 0x20-0x7F are standard ASCII; 0x00-0x07 are CGRAM slots;
      // everything else maps to the HD44780's built-in ROM (A00/A02).
      // For text display: use ASCII where possible, otherwise '?'
      line += (ch >= 0x20 && ch <= 0x7e) ? String.fromCharCode(ch) : (ch < 0x08 ? '\u2588' : '?');
    }
    text.push(line);
  }
  state.text = text;
}

// ─── API for direct (non-board) use: procedural writes ───────────────────
// Used by the machine-level smoke tests where VIA port writes clock E
// directly instead of going through the analog solver.

/**
 * Create a standalone HD44780 state (no board required).
 * @param {{ cols?: number, rows?: number }} [opts]
 * @returns {object} state object compatible with the device model
 */
export function createHD44780(opts = {}) {
  const cols = opts.cols ?? 16;
  const rows = opts.rows ?? 2;
  const part = { params: { cols, rows } };
  // Use the device model's init
  const model = _getModel();
  return model.init(part);
}

/**
 * Clock a write into the HD44780: set RS, data, then pulse E.
 * @param {object} state - HD44780 state from createHD44780()
 * @param {0|1} rs - register select (0=command, 1=data)
 * @param {number} data - 8-bit data value
 * @param {bigint} tNs - current time in nanoseconds
 */
export function hd44780Write8(state, rs, data, tNs) {
  if (tNs < state.busyUntilNs) return; // busy, rejected
  _execute(state, rs, data, tNs);
  _rebuildText(state);
}

/**
 * Clock a 4-bit write (one nibble per call, high nibble first).
 * Call twice to send a full byte.
 * @param {object} state
 * @param {0|1} rs
 * @param {number} nibble - 4-bit value (D7-D4)
 * @param {bigint} tNs
 */
export function hd44780Write4(state, rs, nibble, tNs) {
  if (tNs < state.busyUntilNs) return;
  if (state._nibblePhase === 0) {
    state._highNibble = nibble & 0x0f;
    state._nibblePhase = 1;
    return;
  }
  const fullByte = (state._highNibble << 4) | (nibble & 0x0f);
  state._nibblePhase = 0;
  _execute(state, rs, fullByte, tNs);
  _rebuildText(state);
}

/**
 * Read busy flag + address counter.
 * @param {object} state
 * @param {bigint} tNs
 * @returns {{ busy: boolean, ac: number }}
 */
export function hd44780ReadBF(state, tNs) {
  return {
    busy: tNs < state.busyUntilNs,
    ac: state.ac & 0x7f,
  };
}

// Lazy reference to the registered model (avoids circular deps)
let _model = null;
function _getModel() {
  if (!_model) {
    _model = {
      init(part) {
        const cols = part.params?.cols ?? 16;
        const rows = part.params?.rows ?? 2;
        return {
          drives: {},
          ddram: new Uint8Array(80).fill(0x20), // power-on: spaces (undefined, but 0x20 is conventional)
          cgram: new Uint8Array(64),
          ac: 0,
          acIsCgram: false,
          displayOn: false,
          cursorOn: false,
          blinkOn: false,
          increment: true,
          shiftDisplay: false,
          is4Bit: false,
          twoLine: false,
          font5x10: false,
          displayShift: 0,
          busyUntilNs: 0n,
          _nibblePhase: 0,
          _highNibble: 0,
          _lastE: false,
          _lastRs: 0,
          _lastRw: 0,
          text: Array.from({ length: rows }, () => ' '.repeat(cols)),
          backlight: 0,
          contrast: 1,
          _cols: cols,
          _rows: rows,
        };
      },
    };
  }
  return _model;
}
