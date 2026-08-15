/**
 * M6502Machine → boundary A adapter: the 6502 breadboard computer drives
 * the circuit board through the same contract every other adapter speaks —
 * pin edges as `board.setPin(name, mode, driveHigh)`, time as
 * `board.advanceTo(tNs)`.
 *
 * The machine's onPinChange hook fires for every VIA output-pin edge;
 * the adapter translates those to board.setPin calls. VIA pins are
 * push-pull outputs when DDR-driven (the only kind onPinChange reports),
 * so mode is always 'pushpull'.
 *
 * Input pins (buttons, sensors) sync from the board on each advanceNs:
 * board.readPin('via1.PA3') → via.setInput('a', 3, level). Only pins
 * whose DDR bit is clear are read back.
 *
 * @module
 */

import { M6502Machine, EATER6502 } from './m6502-machine.js';

/**
 * @param {object} [opts]
 * @param {object} [opts.config] - Machine config (default EATER6502)
 * @param {Uint8Array} [opts.rom] - ROM image
 * @param {number} [opts.romAt] - ROM load address (default: first rom region)
 * @param {number} [opts.resetLo] - $FFFC value (default from ROM image)
 * @param {number} [opts.resetHi] - $FFFD value (default from ROM image)
 */
export function createM6502Adapter(opts = {}) {
  const config = opts.config ?? EATER6502;

  let board = null;
  const stats = { pinChangeCount: 0, advanceToCount: 0 };
  let serialListener = null;

  const machine = new M6502Machine(config, {
    onPinChange(pin, level, tMs) {
      if (!board) return;
      // Time first, edge second — the invariant every adapter keeps.
      if (board.advanceTo) {
        board.advanceTo(BigInt(Math.round(tMs * 1e6))); // ms → ns
      }
      board.setPin(pin, 'pushpull', !!level);
      stats.pinChangeCount++;
    },
    onSerial(byte, tMs) {
      if (serialListener) serialListener(byte);
    },
  });

  if (opts.rom) {
    machine.loadRom(opts.rom, opts.romAt);
  }
  if (opts.resetLo != null) machine.mem[0xfffc] = opts.resetLo;
  if (opts.resetHi != null) machine.mem[0xfffd] = opts.resetHi;

  /** Sync input pins: board → VIA. Only pins with DDR clear (inputs). */
  function syncInputs() {
    if (!board || !board.readPin) return;
    for (const c of config.chips) {
      if (c.kind !== 'via') continue;
      const via = machine.chips[c.name];
      if (!via) continue;
      for (const [port, ddr] of [['a', via.ddra], ['b', via.ddrb]]) {
        for (let bit = 0; bit < 8; bit++) {
          if (ddr & (1 << bit)) continue; // output — driven by VIA
          const pin = `${c.name}.P${port.toUpperCase()}${bit}`;
          const level = board.readPin(pin);
          via.setInput(port, bit, level);
        }
      }
    }
  }

  return {
    machine,
    clockHz: config.clockHz,

    onSerial(cb) { serialListener = cb; },

    /** RX side: feed a byte to a 'console' MMIO chip (py65mon getc). */
    sendSerial(byte) {
      for (const chip of Object.values(machine.chips)) {
        if (chip && Array.isArray(chip.rx)) { chip.rx.push(byte & 0xff); return true; }
      }
      return false;
    },

    loadRom(bytes, at) {
      machine.loadRom(bytes, at);
    },

    attachBoard(b) {
      board = b;
      // Reset drives the CPU through $FFFC and publishes initial pin state.
      machine.reset();
      syncInputs();
    },

    syncInputs,

    advanceNs(deltaNs) {
      syncInputs();
      const targetMs = machine.tMs + deltaNs / 1e6;
      machine.advanceToMs(targetMs);
      if (board && board.advanceTo) {
        board.advanceTo(this.timeNs());
        stats.advanceToCount++;
      }
    },

    timeNs() {
      return BigInt(Math.round(machine.tMs * 1e6));
    },

    stats,
  };
}
