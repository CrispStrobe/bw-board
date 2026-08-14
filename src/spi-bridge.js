/**
 * SPI transaction bridge — routes avr8js AVRSPI byte-level transfers
 * to board SPI device handlers.
 *
 * Most hobby SPI devices (MAX7219, MCP3008, XPT2046) are wired with
 * GPIO-controlled CS and use shiftOut or bit-bang SPI in typical
 * Arduino code (LedControl, Adafruit libraries). Hardware SPI via
 * SPI.transfer() is less common in the starter-kit lessons.
 *
 * This bridge provides the infrastructure: devices that expose
 * `state.spiHandler = { onByte(value) => response }` can be routed
 * through the AVRSPI peripheral. CS pin detection requires board
 * topology awareness and is left to the caller.
 *
 * @module
 */

/**
 * Create an SPI byte handler that bridges AVRSPI transfers to a set
 * of SPI device handlers.
 *
 * @param {import('avr8js').AVRSPI} spi - the AVRSPI instance
 * @returns {object} bridge with attach() and the onByte callback
 */
export function createSPIBridge(spi) {
  const bridge = {
    spi,
    /** @type {Array<{onByte: (value: number) => number}>} */
    devices: [],
    /** @type {object|null} currently selected device (by CS) */
    active: null,

    /**
     * Attach to a board — discover SPI device handlers.
     * @param {object} board
     */
    attach(board) {
      // Future: scan board._deviceStates for state.spiHandler
      bridge.devices = [];
    },

    /**
     * Select a specific device (called when CS goes low).
     * @param {object|null} handler - device's spiHandler or null to deselect
     */
    select(handler) {
      bridge.active = handler;
    },

    /**
     * The onByte callback for AVRSPI. Wired as `spi.onByte = bridge.onByte`.
     * @param {number} value - byte sent on MOSI
     */
    onByte(value) {
      let response = 0xff;
      if (bridge.active && typeof bridge.active.onByte === 'function') {
        response = bridge.active.onByte(value) & 0xff;
      }
      // Complete the transfer after the SPI clock cycles
      spi.cpu.addClockEvent(() => spi.completeTransfer(response), spi.transferCycles);
    },
  };

  return bridge;
}
