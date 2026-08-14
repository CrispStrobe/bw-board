/**
 * Minimal AVR TWI (I2C) stub peripheral with optional EEPROM memory model.
 *
 * Enough for firmware that polls TWCR for TWINT and checks TWSR status codes.
 * Two modes:
 *
 * 1. **Without eepromData** — returns 0xFF for all reads (empty EEPROM).
 *    Sufficient for boot: storage.enable() reads num_anims = 0xFF →
 *    hasData() returns false → firmware shows built-in PROGMEM patterns.
 *
 * 2. **With eepromData** — full 24Cxx EEPROM model.  Tracks 2-byte address
 *    phase, stores writes, returns stored data for reads with auto-increment.
 *    Required for modem test: firmware decodes audio, writes animation data
 *    to the external EEPROM, and we verify it arrived correctly.
 *
 * BSD-3-Clause (vendorable alongside avr8js).
 *
 * @module
 */

// TWI state machine
const ST_IDLE      = 0;
const ST_STARTED   = 1;
const ST_SLA_W_ACK = 2;
const ST_DATA_W    = 3;
const ST_SLA_R_ACK = 4;
const ST_DATA_R    = 5;

/**
 * Install a TWI stub on the given avr8js CPU.
 *
 * @param {import('avr8js').CPU} cpu
 * @param {{TWBR:number, TWSR:number, TWAR:number, TWDR:number, TWCR:number}} regs
 *   Register data-space addresses.
 * @param {Uint8Array} [eepromData] - Optional EEPROM backing store.
 *   If provided, reads/writes go to this array with 24Cxx address tracking.
 *   If omitted, all reads return 0xFF (original behavior).
 * @returns {{ eepromData: Uint8Array|undefined }}
 */
export function installTWIStub(cpu, regs, eepromData) {
  const { TWSR, TWDR, TWCR } = regs;

  // TWI control register bits
  const TWINT = 0x80;
  const TWSTA = 0x20;
  const TWSTO = 0x10;
  const TWEN  = 0x04;
  const TWEA  = 0x40;

  let state = ST_IDLE;

  // 24Cxx EEPROM address tracking (only active when eepromData provided)
  let addrByteCount = 0;  // counts address bytes received (0, 1, 2)
  let addrHi = 0;
  let addrLo = 0;
  let eepromAddr = 0;     // current byte address in EEPROM

  cpu.writeHooks[TWCR] = (value) => {
    if (!(value & TWEN)) {
      state = ST_IDLE;
      return false;
    }

    if (!(value & TWINT)) {
      return false;
    }

    // ── START condition ──
    if (value & TWSTA) {
      cpu.data[TWSR] = (state === ST_IDLE) ? 0x08 : 0x10;
      state = ST_STARTED;
      addrByteCount = 0;  // reset address phase on every (re)start
      cpu.data[TWCR] = value;
      return true;
    }

    // ── STOP condition ──
    if (value & TWSTO) {
      state = ST_IDLE;
      cpu.data[TWCR] = value & ~(TWINT | TWSTO);
      return true;
    }

    // ── Data / address phase ──
    switch (state) {
      case ST_STARTED: {
        const sla = cpu.data[TWDR];
        if (sla & 1) {
          state = ST_SLA_R_ACK;
          cpu.data[TWSR] = 0x40;
        } else {
          state = ST_SLA_W_ACK;
          cpu.data[TWSR] = 0x18;
        }
        break;
      }

      case ST_SLA_W_ACK:
      case ST_DATA_W: {
        state = ST_DATA_W;
        const byteVal = cpu.data[TWDR];

        if (eepromData) {
          // 24Cxx protocol: first 2 bytes after SLA+W are address
          if (addrByteCount === 0) {
            addrHi = byteVal;
            addrByteCount = 1;
          } else if (addrByteCount === 1) {
            addrLo = byteVal;
            eepromAddr = ((addrHi & 0xFF) << 8) | (addrLo & 0xFF);
            addrByteCount = 2;
          } else {
            // Data byte — store and auto-increment
            if (eepromAddr < eepromData.length) {
              eepromData[eepromAddr] = byteVal;
            }
            eepromAddr = (eepromAddr + 1) % eepromData.length;
          }
        }

        cpu.data[TWSR] = 0x28;
        break;
      }

      case ST_SLA_R_ACK:
      case ST_DATA_R: {
        state = ST_DATA_R;

        if (eepromData) {
          // Return data from EEPROM at current address, auto-increment
          cpu.data[TWDR] = eepromAddr < eepromData.length
            ? eepromData[eepromAddr] : 0xFF;
          eepromAddr = (eepromAddr + 1) % eepromData.length;
        } else {
          cpu.data[TWDR] = 0xFF;
        }

        cpu.data[TWSR] = (value & TWEA) ? 0x50 : 0x58;
        break;
      }

      default:
        cpu.data[TWSR] = 0x20;
        break;
    }

    cpu.data[TWCR] = value;
    return true;
  };

  return { eepromData };
}
