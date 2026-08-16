/**
 * USI (Universal Serial Interface) bridge for ATtiny85.
 *
 * The ATtiny85 has no hardware TWI — it has a USI peripheral that can be
 * software-driven as an I2C master. The classic "TinyWireM" / "Wire-USI"
 * library uses two-wire mode with external clock (both edges) to shift
 * data in/out via USIDR, counting 8 clocks in USISR, then checking USIOIF.
 *
 * This bridge intercepts register writes to USICR/USISR/USIDR and, when
 * it detects a complete byte transfer (counter overflow), routes the byte
 * to the SAME board I2C device handlers that the TWI bridge uses.
 *
 * Register addresses (ATtiny85 datasheet §15.11):
 *   USIDR  = 0x0F (data space 0x2F)  — shift register
 *   USISR  = 0x0E (data space 0x2E)  — status: flags + 4-bit counter
 *   USICR  = 0x0D (data space 0x2D)  — control: wire mode, clock source
 *
 * Protocol decoding:
 *   The TinyWireM master pattern does 8-bit transfers (counter starts at 0)
 *   for data bytes and 1-bit transfers (counter starts at 0x0E) for ACK.
 *   We distinguish them by counter starting value to know whether the
 *   overflow represents a data byte or an ACK clock.
 *
 * @module
 */

// USI register data-space addresses (ATtiny85)
const USIDR_ADDR = 0x2F;   // IO 0x0F
const USISR_ADDR = 0x2E;   // IO 0x0E
const USICR_ADDR = 0x2D;   // IO 0x0D

// USICR bits
const USIOIE  = 1 << 6;  // Counter overflow interrupt enable
const USIWM1  = 1 << 5;  // Wire mode bit 1
const USICLK  = 1 << 1;  // Clock strobe
const USITC   = 1 << 0;  // Toggle clock pin

// USISR bits
const USISIF  = 1 << 7;  // Start condition flag
const USIOIF  = 1 << 6;  // Counter overflow flag
const USIPF   = 1 << 5;  // Stop condition flag
const USIDC   = 1 << 4;  // Data output collision

/**
 * @param {import('avr8js').CPU} cpu
 * @param {object} [config]
 * @returns {object} bridge with attach(board)
 */
export function createUSIBridge(cpu, config = {}) {
  const regDR = config.USIDR ?? USIDR_ADDR;
  const regSR = config.USISR ?? USISR_ADDR;
  const regCR = config.USICR ?? USICR_ADDR;
  const ovfVector = config.usiOverflowInterrupt ?? 0x07;

  // Register state
  let usidr = 0;
  let usisrFlags = 0;   // upper 4 bits only (flags)
  let counter = 0;      // lower 4 bits of USISR
  let usicr = 0;
  let sclState = false;

  // Transfer classification: was this an 8-bit or 1-bit transfer?
  // We track the counter value when last loaded via USISR write.
  let counterStartValue = 0;

  // I2C protocol states
  const IDLE = 0, ADDR_SENT = 1, WRITE = 2, READ = 3;
  let protoState = IDLE;
  let pendingAck = 0x00;  // stored ACK/NACK to return during 1-bit transfer

  const bridge = {
    devices: [],
    active: null,

    attach(board) {
      if (board && typeof board.getI2CHandlers === 'function') {
        bridge.devices = board.getI2CHandlers();
      }
    },

    // Expose for tests
    get usidr() { return usidr; },
    get usisr() { return usisrFlags | (counter & 0x0F); },
    get usicr() { return usicr; },

    startCondition() {
      protoState = IDLE;  // next 8-bit transfer is address
      bridge.active = null;
    },

    stopCondition() {
      if (bridge.active?.onStop) bridge.active.onStop();
      bridge.active = null;
      protoState = IDLE;
    },

    /**
     * Called on counter overflow. Determines if this was data (8-bit)
     * or ACK (1-bit) based on counterStartValue.
     */
    _onOverflow() {
      const isAckTransfer = counterStartValue >= 14; // 0x0E or 0x0F → 1 or 2 toggles

      if (isAckTransfer) {
        // This was a 1-bit ACK/NACK clock. Replace USIDR with the
        // pending ACK value so firmware can read it.
        usidr = pendingAck;
        // After ACK, if reading, pre-load next byte from device
        if (protoState === READ && bridge.active) {
          // Don't pre-load here; firmware will do another 8-bit transfer
        }
        return;
      }

      // 8-bit transfer completed
      if (protoState === IDLE) {
        // First byte after START = address
        const addrByte = usidr;
        const addr7 = (addrByte >> 1) & 0x7F;
        const rw = addrByte & 1;

        bridge.active = null;
        for (const dev of bridge.devices) {
          if (dev.onAddress(addr7, rw)) {
            bridge.active = dev;
            break;
          }
        }

        if (bridge.active) {
          pendingAck = 0x00; // ACK (SDA low → bit 7 = 0 when shifted in)
          protoState = rw ? READ : WRITE;
        } else {
          pendingAck = 0x80; // NACK
          protoState = IDLE;
        }
      } else if (protoState === WRITE) {
        // Data byte written by master
        if (bridge.active) {
          const ack = bridge.active.onWriteByte(usidr);
          pendingAck = (ack !== false) ? 0x00 : 0x80;
        } else {
          pendingAck = 0x80;
        }
      } else if (protoState === READ) {
        // Master just shifted 8 bits with SDA released (0xFF loaded).
        // We replace USIDR with the device's data byte.
        if (bridge.active) {
          usidr = bridge.active.onReadByte() & 0xFF;
        } else {
          usidr = 0xFF;
        }
        // pendingAck for read is master-driven (firmware decides ACK/NACK),
        // so we don't set pendingAck here. The 1-bit transfer just clocks
        // the master's ACK out — we don't need to override USIDR for it.
        pendingAck = usidr; // preserve so firmware can still read data
      }
    },
  };

  // ── Hook CPU register accesses ──────────────────────────────────────

  cpu.writeHooks[regCR] = (value) => {
    usicr = value & ~(USITC | USICLK); // strobe bits don't persist

    const wireMode = (value >> 4) & 0x03;

    if (value & USITC) {
      sclState = !sclState;

      // Two-wire mode with software clock strobe
      if (wireMode >= 2 && (value & USICLK)) {
        counter = (counter + 1) & 0x0F;
        if (counter === 0) {
          usisrFlags |= USIOIF;
          bridge._onOverflow();
          cpu.data[regDR] = usidr;
          cpu.data[regSR] = usisrFlags | (counter & 0x0F);
          cpu.data[regCR] = usicr;
          return true;
        }
      }
    } else if (value & USICLK) {
      // USICLK without USITC: pure software strobe
      if (((value >> 2) & 0x03) === 0) {
        counter = (counter + 1) & 0x0F;
        if (counter === 0) {
          usisrFlags |= USIOIF;
          bridge._onOverflow();
          cpu.data[regDR] = usidr;
          cpu.data[regSR] = usisrFlags | (counter & 0x0F);
          cpu.data[regCR] = usicr;
          return true;
        }
      }
    }

    cpu.data[regCR] = usicr;
    cpu.data[regSR] = usisrFlags | (counter & 0x0F);
    cpu.data[regDR] = usidr;
    return true;
  };

  cpu.writeHooks[regSR] = (value) => {
    // Writing 1 to flag bits clears them
    if (value & USISIF) { usisrFlags &= ~USISIF; bridge.startCondition(); }
    if (value & USIOIF) usisrFlags &= ~USIOIF;
    if (value & USIPF)  usisrFlags &= ~USIPF;
    if (value & USIDC)  usisrFlags &= ~USIDC;

    // Lower 4 bits: counter loaded directly
    counter = value & 0x0F;
    counterStartValue = counter;

    cpu.data[regSR] = usisrFlags | (counter & 0x0F);
    return true;
  };

  cpu.writeHooks[regDR] = (value) => {
    usidr = value & 0xFF;
    cpu.data[regDR] = usidr;
    return true;
  };

  cpu.readHooks[regDR] = () => usidr;
  cpu.readHooks[regSR] = () => usisrFlags | (counter & 0x0F);
  cpu.readHooks[regCR] = () => usicr;

  cpu.data[regDR] = 0;
  cpu.data[regSR] = 0;
  cpu.data[regCR] = 0;

  return bridge;
}
