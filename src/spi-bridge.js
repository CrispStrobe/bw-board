/**
 * SPI transaction bridge — routes avr8js AVRSPI byte-level transfers
 * to board SPI device handlers.
 *
 * Most hobby SPI devices (MAX7219, MCP3008, XPT2046) are wired with
 * GPIO-controlled CS and use shiftOut or bit-bang SPI in typical
 * Arduino code (LedControl, Adafruit libraries). Hardware SPI via
 * SPI.transfer() is less common in the starter-kit lessons.
 *
 * Every SPI part on the board (nRF24L01, MCP3008, ILI9341, MAX7219,
 * 74HC595, ...) is modelled at PIN level: it watches its SCK/MOSI/CS nets
 * and drives MISO. So a hardware transfer must reach those nets as edges.
 * avr8js's AVRSPI does not do that -- it only hands the byte to onByte --
 * so before this, SPI.transfer() touched no pin, every part stayed idle
 * and every read returned 0xFF (measured: an nRF24 read CONFIG/RF_SETUP as
 * FF FF over SPI.transfer and 08 0E bit-banged on the same wires).
 *
 * With `opts.wire` the bridge now clocks the byte out on the pins, one
 * clock event per SCK half-period at the programmed rate, in the SPCR's
 * mode (CPOL/CPHA) and bit order (DORD), sampling MISO from the board at
 * each sampling edge. CS stays the program's GPIO, as on silicon. Without
 * `wire` (a chip with no SPI pin map) the old byte-level path remains:
 * `select(handler)` + `handler.onByte(value) => response`.
 *
 * @module
 */

/**
 * Create an SPI byte handler that bridges AVRSPI transfers to a set
 * of SPI device handlers.
 *
 * @param {import('avr8js').AVRSPI} spi - the AVRSPI instance
 * @param {{onAccess?: (device: object) => void}} [opts] observation only
 * @returns {object} bridge with attach() and the onByte callback
 */
export function createSPIBridge(spi, opts = {}) {
  const observe = (device) => {
    try { opts.onAccess?.(device); } catch {}
  };
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
      if (opts.wire && opts.wire.ready()) { clockOut(value); return; }
      let response = 0xff;
      if (bridge.active && typeof bridge.active.onByte === 'function') {
        response = bridge.active.onByte(value) & 0xff;
      }
      // Complete the transfer after the SPI clock cycles
      spi.cpu.addClockEvent(() => {
        spi.completeTransfer(response);
        observe({ id: 'spi0', bus: 'spi', event: 'transfer', tx: value & 0xff,
          rx: response });
      }, spi.transferCycles);
    },
  };

  // Pin-level transfer. SPCR: DORD bit 5, MSTR bit 4, CPOL bit 3, CPHA bit 2.
  function clockOut(value) {
    const { wire } = opts;
    const cpu = spi.cpu;
    const spcr = cpu.data[wire.SPCR];
    const lsbFirst = !!(spcr & 0x20);
    const cpol = !!(spcr & 0x08);
    const cpha = !!(spcr & 0x04);
    const half = Math.max(1, Math.round(spi.transferCycles / 16));
    const bitOut = (i) => !!(value & (lsbFirst ? 1 << i : 0x80 >> i));
    let rx = 0;
    const sample = (i) => { if (wire.readMiso()) rx |= lsbFirst ? 1 << i : 0x80 >> i; };
    wire.drive('sck', cpol);
    if (!cpha) wire.drive('mosi', bitOut(0));
    // Edges 1..16: odd = leading (idle -> active), even = trailing.
    const edge = (k) => {
      const i = (k - 1) >> 1;
      if (k & 1) {
        if (cpha) wire.drive('mosi', bitOut(i));
        else sample(i);
        wire.drive('sck', !cpol);
      } else {
        if (cpha) sample(i);
        wire.drive('sck', cpol);
        if (!cpha && i < 7) wire.drive('mosi', bitOut(i + 1));
      }
      if (k < 16) { cpu.addClockEvent(() => edge(k + 1), half); return; }
      // SCK now idles at CPOL and MOSI holds its last bit: the peripheral keeps
      // both pins while SPE/MSTR stay set (the adapter releases them on SPCR).
      spi.completeTransfer(rx);
      observe({ id: 'spi0', bus: 'spi', event: 'transfer', tx: value & 0xff, rx });
    };
    cpu.addClockEvent(() => edge(1), half);
  }

  return bridge;
}
