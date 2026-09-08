/**
 * TWI transaction bridge — routes avr8js AVRTWI hardware-level I2C
 * transactions to the board's device-model handlers at the TRANSACTION
 * level, bypassing the bit-level I2C slave engine entirely.
 *
 * The same handler object ({onAddress, onWriteByte, onReadByte, onStop})
 * is shared between the bit-bang path (feedI2CSlave) and this bridge.
 * One behavior, two transports: bit-bang for software I2C, this bridge
 * for Wire.h / hardware TWI.
 *
 * Usage:
 *   const bridge = createTWIBridge(twi);
 *   bridge.attach(board);          // scans board for I2C handlers
 *   twi.eventHandler = bridge;     // replaces the NoopTWIEventHandler
 *
 * @module
 */

/**
 * Create a TWI event handler that bridges AVRTWI transactions to board
 * I2C device handlers.
 *
 * @param {import('avr8js').AVRTWI} twi - the AVRTWI instance to complete against
 * @param {{onAccess?: (device: object) => void}} [opts] observation only
 * @returns {object} an AVRTWI-compatible eventHandler
 */
export function createTWIBridge(twi, opts = {}) {
  // Observation is downstream of every emulation mutation. A debugger listener
  // may fail, but it must never change the ACK/data the AVR already received.
  const observe = (device) => {
    try { opts.onAccess?.(device); } catch {}
  };
  const bridge = {
    twi,
    /** @type {Array<{onAddress: Function, onWriteByte: Function, onReadByte: Function, onStop?: Function}>} */
    devices: [],
    /** @type {object|null} currently addressed device handler */
    active: null,

    /**
     * Attach to a board — discover all I2C device handlers.
     * Call after board.setNetlist() so devices are initialized.
     * Safe to call multiple times (replaces the device list).
     */
    attach(board) {
      if (board && typeof board.getI2CHandlers === 'function') {
        bridge.devices = board.getI2CHandlers();
      }
    },

    // ── AVRTWI eventHandler interface ──────────────────────────────

    start(repeated) {
      // A repeated START without an intervening STOP: the active device
      // stays selected until connectToSlave picks a (possibly different) one.
      twi.completeStart();
      observe({ id: 'twi0', bus: 'twi', event: repeated ? 'restart' : 'start' });
    },

    stop() {
      if (bridge.active?.onStop) bridge.active.onStop();
      bridge.active = null;
      twi.completeStop();
      observe({ id: 'twi0', bus: 'twi', event: 'stop' });
    },

    /**
     * @param {number} address - 7-bit slave address
     * @param {boolean} write  - true = SLA+W (master write), false = SLA+R (master read)
     */
    connectToSlave(address, write) {
      // rw convention in our handlers: 0 = write, 1 = read
      const rw = write ? 0 : 1;
      for (const dev of bridge.devices) {
        if (dev.onAddress(address, rw)) {
          bridge.active = dev;
          twi.completeConnect(true);
          observe({ id: 'twi0', bus: 'twi', event: 'address', address: address & 0x7f,
            direction: write ? 'write' : 'read', acknowledged: true });
          return;
        }
      }
      bridge.active = null;
      twi.completeConnect(false);  // NACK — no device at this address
      observe({ id: 'twi0', bus: 'twi', event: 'address', address: address & 0x7f,
        direction: write ? 'write' : 'read', acknowledged: false });
    },

    writeByte(value) {
      if (!bridge.active) {
        twi.completeWrite(false);
        observe({ id: 'twi0', bus: 'twi', event: 'write', value: value & 0xff,
          acknowledged: false });
        return;
      }
      const ack = bridge.active.onWriteByte(value);
      twi.completeWrite(ack !== false);
      observe({ id: 'twi0', bus: 'twi', event: 'write', value: value & 0xff,
        acknowledged: ack !== false });
    },

    readByte(ack) {
      if (!bridge.active) {
        twi.completeRead(0xff);
        observe({ id: 'twi0', bus: 'twi', event: 'read', value: 0xff,
          acknowledged: Boolean(ack) });
        return;
      }
      const value = bridge.active.onReadByte();
      twi.completeRead(value & 0xff);
      observe({ id: 'twi0', bus: 'twi', event: 'read', value: value & 0xff,
        acknowledged: Boolean(ack) });
    },
  };

  return bridge;
}
