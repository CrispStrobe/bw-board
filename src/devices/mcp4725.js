/**
 * MCP4725 — 12-bit I2C DAC, clean-room from Microchip DS22039D.
 *
 * I2C slave at 0x60 (A0 low) or 0x62 (A0 high — MCP4725A1 variant).
 * The A0 pin is electrically sampled; params.address overrides.
 *
 * Write modes:
 *   Fast write: 2 data bytes after address. Byte 0 bits [7:6] = 0b00,
 *   bits [5:4] = PD mode, bits [3:0] = DAC[11:8]. Byte 1 = DAC[7:0].
 *
 *   Register write (3 bytes): Byte 0 = command byte (C2:C1:C0 + PD + D11:D8),
 *   Byte 1 = D7:D0, Byte 2 = ignored padding. We accept both.
 *
 * Output: drives OUT terminal as a Thévenin source:
 *   vOut = (dacCode / 4095) * vcc
 *
 * This is the first analog-output I2C part in the engine.
 *
 * @module
 */

import { registerDevice } from '../devices.js';
import { createI2CSlave, feedI2CSlave } from './i2c-slave.js';

const R_OUT = 50;
const R_OFF = 1e9;
const R_INPUT = 1e6;
const R_DAC_OUT = 100; // DAC output impedance (1 Ω typ, model as 100 Ω)

export function registerMCP4725() {

  registerDevice('mcp4725', {
    terminals: ['vcc', 'gnd', 'sda', 'scl', 'a0', 'out'],

    init(part) {
      const baseAddr = part.params?.address ?? 0x60;
      const state = {
        drives: {
          sda: { vTh: 0, rTh: R_OFF },
          out: { vTh: 0, rTh: R_DAC_OUT },
        },
        dacCode: 0,       // 12-bit DAC register (0..4095)
        pdMode: 0,        // power-down mode: 0 = normal
        _vcc: 5.0,
        _buf: [],
        _baseAddr: baseAddr,
        _a0Electrical: 0,
      };

      const handlers = {
        onAddress(a7, rw) {
          const myAddr = (state._baseAddr & 0xFE) | (state._a0Electrical & 1);
          if (a7 !== myAddr) return false;
          state._buf = [];
          return true;
        },

        onWriteByte(b) {
          state._buf.push(b);
          // Fast write: 2 bytes
          if (state._buf.length === 2) {
            const b0 = state._buf[0];
            const b1 = state._buf[1];
            const cmdType = (b0 >> 5) & 0x07;
            if (cmdType === 0) {
              // Fast write: bits [5:4] = PD, [3:0] = DAC[11:8]
              state.pdMode = (b0 >> 4) & 0x03;
              state.dacCode = ((b0 & 0x0F) << 8) | b1;
            }
          }
          // Register write: 3 bytes (C2:C1:C0 = 010 or 011)
          if (state._buf.length === 3) {
            const b0 = state._buf[0];
            const cmdType = (b0 >> 5) & 0x07;
            if (cmdType === 0x02 || cmdType === 0x03) {
              state.pdMode = (b0 >> 1) & 0x03;
              state.dacCode = ((b0 & 0x01) << 11) | (state._buf[1] << 3) | (state._buf[2] >> 5);
            }
          }
          return true;
        },

        onReadByte() {
          // Read: 5 bytes: [status, dacHi, dacLo, eepromHi, eepromLo]
          const idx = state._buf.length;
          state._buf.push(0); // count reads
          switch (idx) {
            case 0: return 0x80 | (state.pdMode << 1); // RDY=1, PD bits
            case 1: return (state.dacCode >> 4) & 0xFF;
            case 2: return (state.dacCode << 4) & 0xF0;
            case 3: return (state.pdMode << 5) | ((state.dacCode >> 8) & 0x0F);
            case 4: return state.dacCode & 0xFF;
            default: return 0;
          }
        },

        onStop() {
          // DAC output is updated continuously in onWriteByte
        },
      };

      state._i2c = createI2CSlave(handlers);
      return state;
    },

    stamp(ctx) {
      ctx.conductance('scl', null, 1 / R_INPUT);
      ctx.conductance('a0', null, 1 / R_INPUT);
    },

    update(part, state, read) {
      const vcc = read('vcc') || 5.0;
      state._vcc = vcc;
      const th = vcc * 0.5;

      // Sample A0 pin electrically
      state._a0Electrical = read('a0') > th ? 1 : 0;

      // Feed I2C
      const driveLow = feedI2CSlave(state._i2c, read('scl') > th, read('sda') > th);
      const wasLow = state.drives.sda.rTh === R_OUT;
      let changed = false;

      if (driveLow !== wasLow) {
        state.drives.sda = driveLow
          ? { vTh: 0, rTh: R_OUT }
          : { vTh: 0, rTh: R_OFF };
        changed = true;
      }

      // Update DAC output
      const vOut = state.pdMode === 0
        ? (state.dacCode / 4095) * vcc
        : 0; // power-down modes pull output to GND via internal resistor
      const rOut = state.pdMode === 0 ? R_DAC_OUT : R_OFF;

      if (state.drives.out.vTh !== vOut || state.drives.out.rTh !== rOut) {
        state.drives.out = { vTh: vOut, rTh: rOut };
        changed = true;
      }

      return changed;
    },
  });
}
