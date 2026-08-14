/**
 * Minimal AVR TWI (I2C) stub peripheral.
 *
 * Enough for firmware that polls TWCR for TWINT and checks TWSR status codes.
 * Simulates a single I2C slave that ACKs every transaction and returns 0xFF
 * for all reads — which is what an unprogrammed/empty external EEPROM does.
 *
 * Used by the blinkenrocket firmware's storage.cc, which talks to an external
 * 24Cxx EEPROM at I2C address 0x50.  With this stub, storage.enable() sees
 * num_anims == 0xFF → hasData() returns false → firmware shows the built-in
 * turnonPattern from PROGMEM, then emptyPattern on button press.
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
 */
export function installTWIStub(cpu, regs) {
  const { TWSR, TWDR, TWCR } = regs;

  // TWI control register bits
  const TWINT = 0x80;
  const TWSTA = 0x20;
  const TWSTO = 0x10;
  const TWEN  = 0x04;
  const TWEA  = 0x40;

  let state = ST_IDLE;

  cpu.writeHooks[TWCR] = (value) => {
    if (!(value & TWEN)) {
      state = ST_IDLE;
      return false;  // let normal write proceed
    }

    if (!(value & TWINT)) {
      return false;  // firmware not clearing TWINT — normal write
    }

    // ── START condition ──
    if (value & TWSTA) {
      cpu.data[TWSR] = (state === ST_IDLE) ? 0x08 : 0x10;
      state = ST_STARTED;
      cpu.data[TWCR] = value;  // keep TWINT set = instant completion
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
        // First byte after START: SLA+R/W
        const sla = cpu.data[TWDR];
        if (sla & 1) {
          state = ST_SLA_R_ACK;
          cpu.data[TWSR] = 0x40;  // SLA+R acknowledged
        } else {
          state = ST_SLA_W_ACK;
          cpu.data[TWSR] = 0x18;  // SLA+W acknowledged
        }
        break;
      }

      case ST_SLA_W_ACK:
      case ST_DATA_W:
        // Data byte transmitted (address bytes or payload — we ACK all)
        state = ST_DATA_W;
        cpu.data[TWSR] = 0x28;  // data byte ACK
        break;

      case ST_SLA_R_ACK:
      case ST_DATA_R:
        // Master receive: return 0xFF (empty/unprogrammed EEPROM)
        state = ST_DATA_R;
        cpu.data[TWDR] = 0xFF;
        cpu.data[TWSR] = (value & TWEA) ? 0x50 : 0x58;
        break;

      default:
        // Shouldn't happen — NACK everything
        cpu.data[TWSR] = 0x20;
        break;
    }

    cpu.data[TWCR] = value;  // keep TWINT set
    return true;
  };
}
