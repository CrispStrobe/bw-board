/**
 * I2C parts — PCF8574 (8-bit I/O expander) and char_lcd_i2c (I2C LCD backpack).
 *
 * I2C protocol decoded behaviorally from SCL/SDA edge timing:
 * - START: SDA falls while SCL high
 * - STOP: SDA rises while SCL high
 * - BIT: SDA sampled on SCL rising edge
 * - ACK: 9th clock after 8 data bits
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_OUT = 50;
const R_INPUT = 1e6;

// ─── I2C decoder helper ─────────────────────────────────────────────────

/**
 * Stateful I2C byte decoder. Tracks SCL/SDA edges and decodes bytes.
 */
function createI2CDecoder() {
  return {
    lastScl: false,
    lastSda: false,
    bitCount: 0,
    currentByte: 0,
    addressMatch: false,
    receiving: false,
    bytes: [],       // decoded bytes since last START
    ackPending: false,
  };
}

function feedI2C(dec, sclHigh, sdaHigh, myAddress) {
  const sclRose = sclHigh && !dec.lastScl;
  const sclFell = !sclHigh && dec.lastScl;
  const sdaFell = !sdaHigh && dec.lastSda;
  const sdaRose = sdaHigh && !dec.lastSda;

  let byteReady = false;

  // START condition: SDA falls while SCL high
  if (sdaFell && sclHigh) {
    dec.bitCount = 0;
    dec.currentByte = 0;
    dec.bytes = [];
    dec.addressMatch = false;
    dec.receiving = true;
    dec.ackPending = false;
  }
  // STOP condition: SDA rises while SCL high
  else if (sdaRose && sclHigh) {
    dec.receiving = false;
  }
  // Clock rising edge: sample data bit
  else if (sclRose && dec.receiving) {
    if (dec.ackPending) {
      // This is the ACK/NACK clock — skip
      dec.ackPending = false;
    } else {
      dec.currentByte = (dec.currentByte << 1) | (sdaHigh ? 1 : 0);
      dec.bitCount++;
      if (dec.bitCount === 8) {
        // Byte complete
        if (dec.bytes.length === 0) {
          // First byte is address
          const addr7 = dec.currentByte >> 1;
          dec.addressMatch = (addr7 === myAddress);
        }
        if (dec.addressMatch) {
          dec.bytes.push(dec.currentByte);
          byteReady = true;
        }
        dec.bitCount = 0;
        dec.currentByte = 0;
        dec.ackPending = true;
      }
    }
  }

  dec.lastScl = sclHigh;
  dec.lastSda = sdaHigh;
  return byteReady;
}

// ─── PCF8574: 8-bit I2C I/O expander ───────────────────────────────────

export function registerI2CParts() {

  registerDevice('pcf8574', {
    terminals: ['sda', 'scl', 'vcc', 'gnd',
                'p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'int'],

    init(part) {
      const drives = {};
      for (let i = 0; i < 8; i++) {
        drives[`p${i}`] = { vTh: 5, rTh: R_OUT }; // quasi-bidirectional, default HIGH
      }
      return {
        drives,
        outputReg: 0xFF, // all HIGH by default (quasi-bidir)
        _i2c: createI2CDecoder(),
      };
    },

    stamp(ctx) {
      ctx.conductance('sda', null, 1 / R_INPUT);
      ctx.conductance('scl', null, 1 / R_INPUT);
    },

    update(part, state, read) {
      const vcc = read('vcc') || 5.0;
      const threshold = vcc * 0.5;
      const sclHigh = read('scl') > threshold;
      const sdaHigh = read('sda') > threshold;
      const addr = part.params?.address ?? 0x20; // default PCF8574 address

      const byteReady = feedI2C(state._i2c, sclHigh, sdaHigh, addr);

      if (!byteReady) return false;

      // First byte is address+R/W. Second byte (if write) is output data.
      if (state._i2c.bytes.length >= 2) {
        const rw = state._i2c.bytes[0] & 1;
        if (rw === 0) {
          // Write: second byte is the output register
          const data = state._i2c.bytes[1];
          if (data === state.outputReg) return false;
          state.outputReg = data;
          for (let i = 0; i < 8; i++) {
            const bit = (data >> i) & 1;
            state.drives[`p${i}`] = { vTh: bit ? vcc : 0, rTh: R_OUT };
          }
          return true;
        }
      }
      return false;
    },
  });

  // ─── char_lcd_i2c: I2C LCD backpack ────────────────────────────────
  // A PCF8574 driving an HD44780 in 4-bit mode.
  // The 8 output bits map to: D7 D6 D5 D4 BL EN RW RS
  // This is a behavioral model — it tracks the LCD content.
  registerDevice('char_lcd_i2c', {
    terminals: ['sda', 'scl', 'vcc', 'gnd'],

    init(part) {
      const cols = part.params?.cols ?? 16;
      const rows = part.params?.rows ?? 2;
      return {
        drives: {},
        display: Array.from({ length: rows }, () => ' '.repeat(cols)),
        cursor: { row: 0, col: 0 },
        backlight: true,
        _i2c: createI2CDecoder(),
        _nibbleHigh: null, // waiting for second nibble
      };
    },

    stamp(ctx) {
      ctx.conductance('sda', null, 1 / R_INPUT);
      ctx.conductance('scl', null, 1 / R_INPUT);
    },

    // High-level verbs (boundary B setDeviceControl,
    // spec-updates/set-device-control.md). Writes the same `display` rows and
    // `cursor` the I2C decode below writes, so the bus path stays
    // authoritative for MCU-driven benches and the two cannot disagree.
    //
    // This handler was missing for as long as the model existed, and
    // char_lcd_i2c was the ONLY display kind in the example corpus without
    // one — char_lcd, hd44780 and ssd1306 all had it. The consequence was a
    // learner-facing blank screen on the `74-ammeter` bench with no
    // indication anything had gone wrong, since `setDeviceControl` simply
    // returned false: brickwright-lite `docs/LESSON-REVIEW-WAVE-2.md`
    // defect 1, which cost `measurement-current-burden` its display.
    control(part, state, verb, value) {
      const cols = part.params?.cols ?? 16;
      const rows = part.params?.rows ?? 2;
      switch (verb) {
        case 'clear':
          state.display = Array.from({ length: rows }, () => ' '.repeat(cols));
          state.cursor = { row: 0, col: 0 };
          return true;
        case 'cursor': {
          // [row, col], clamped into the panel the part declares — the bus
          // path clamps by construction (a DDRAM address cannot address a
          // row that is not there), so the verb path must too.
          const a = Array.isArray(value) ? value : [0, 0];
          state.cursor = {
            row: Math.max(0, Math.min(rows - 1, a[0] | 0)),
            col: Math.max(0, Math.min(cols - 1, a[1] | 0)),
          };
          return true;
        }
        case 'print': {
          for (const ch of String(value)) {
            const { row, col } = state.cursor;
            if (row >= state.display.length || col >= cols) break;
            const line = state.display[row];
            state.display[row] = line.substring(0, col) + ch + line.substring(col + 1);
            state.cursor = { row, col: col + 1 };
          }
          return true;
        }
        case 'backlight':
          state.backlight = !!value;
          return true;
      }
      return false;
    },

    update(part, state, read) {
      const vcc = read('vcc') || 5.0;
      const threshold = vcc * 0.5;
      const sclHigh = read('scl') > threshold;
      const sdaHigh = read('sda') > threshold;
      const addr = part.params?.address ?? 0x27; // common I2C LCD address

      const byteReady = feedI2C(state._i2c, sclHigh, sdaHigh, addr);
      if (!byteReady) return false;

      if (state._i2c.bytes.length < 2) return false;
      const rw = state._i2c.bytes[0] & 1;
      if (rw !== 0) return false; // read not supported

      // Decode the PCF8574 byte into HD44780 signals
      // Bit mapping: D7 D6 D5 D4 BL EN RW RS
      const data = state._i2c.bytes[state._i2c.bytes.length - 1];
      const rs = data & 0x01;        // Register Select
      // const rw_bit = (data >> 1) & 1; // R/W (always 0 for writes)
      const en = (data >> 2) & 1;    // Enable
      const bl = (data >> 3) & 1;    // Backlight
      const nibble = (data >> 4) & 0x0F;

      state.backlight = bl === 1;

      // HD44780 latches on EN falling edge — we process when EN is high
      // In practice, the I2C sequence sends high-nibble with EN=1, then EN=0,
      // then low-nibble with EN=1, then EN=0. We capture on EN=1.
      if (!en) return false;

      if (state._nibbleHigh === null) {
        state._nibbleHigh = nibble;
        return false;
      }

      // Complete byte: high nibble + low nibble
      const fullByte = (state._nibbleHigh << 4) | nibble;
      state._nibbleHigh = null;

      if (rs === 0) {
        // Command
        if ((fullByte & 0x80) !== 0) {
          // Set DDRAM address
          const addr = fullByte & 0x7F;
          state.cursor.row = addr >= 0x40 ? 1 : 0;
          state.cursor.col = addr >= 0x40 ? addr - 0x40 : addr;
        } else if (fullByte === 0x01) {
          // Clear display
          const cols = part.params?.cols ?? 16;
          const rows = part.params?.rows ?? 2;
          state.display = Array.from({ length: rows }, () => ' '.repeat(cols));
          state.cursor = { row: 0, col: 0 };
        }
      } else {
        // Data: write character at cursor
        const cols = part.params?.cols ?? 16;
        const { row, col } = state.cursor;
        if (row < state.display.length && col < cols) {
          const line = state.display[row];
          state.display[row] = line.substring(0, col) + String.fromCharCode(fullByte) + line.substring(col + 1);
          state.cursor.col++;
        }
      }

      return false; // display state only
    },
  });
}
