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
 * PS/2 keyboard: when attachBoard detects a 'ps2' part wired to a VIA,
 * it bridges the board device's PS2Keyboard to the machine VIA via
 * ps2OnVia — the same proven path the standalone ps2.test.mjs exercises.
 * The VIA's CA1 edge-trigger needs per-frame strobe callbacks, not
 * polled sync, which is why this runs on the machine side.
 *
 * @module
 */

import { M6502Machine, EATER6502 } from './m6502-machine.js';
import { ps2OnVia } from './ps2.js';
import { getDevice } from './devices.js';

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

  /**
   * Detect PS/2 parts on the board and wire them to the machine VIA via
   * ps2OnVia. The wiring is inferred from the board's nets: if a PS/2
   * part's d0-d7 terminals share nets with a VIA's PA0-PA7 (or PB0-PB7),
   * that determines the port. The DA terminal's net partner determines
   * the control line (CA1/CA2/CB1/CB2).
   */
  function bridgePS2(b) {
    if (!b.parts || !b.nets) return;

    for (const part of b.parts) {
      if (part.kind !== 'ps2') continue;
      const state = b.getDeviceState(part.id);
      if (!state || !state._kbd) continue;

      // Find which VIA port the data lines are wired to
      let viaName = null;
      let port = null;
      let control = 'ca1'; // default

      for (const net of b.nets) {
        const ps2Term = net.terminals.find(t => t.part === part.id);
        if (!ps2Term) continue;
        const term = ps2Term.terminal;

        // Check data lines d0-d7
        if (/^d[0-7]$/.test(term)) {
          const viaTerm = net.terminals.find(t => {
            if (t.part === part.id) return false;
            const p = b.partMap ? b.partMap.get(t.part) : b.parts.find(pp => pp.id === t.part);
            return p && (p.kind === 'mcu' || p.kind === 'w65c22');
          });
          if (viaTerm) {
            viaName = viaTerm.part;
            const m = String(viaTerm.terminal).match(/^P([AB])(\d)$/i);
            if (m) port = m[1].toLowerCase();
          }
        }

        // Check DA line → control line
        if (term === 'da') {
          const viaTerm = net.terminals.find(t => {
            if (t.part === part.id) return false;
            return true; // any partner
          });
          if (viaTerm) {
            const m = String(viaTerm.terminal).match(/^(CA1|CA2|CB1|CB2)$/i);
            if (m) control = m[1].toLowerCase();
          }
        }
      }

      // Wire it up: find the machine VIA that corresponds to the board part
      if (!port) port = 'a'; // default to port A
      const chipEntry = config.chips.find(c =>
        c.kind === 'via' && (c.name === viaName || !viaName));
      if (!chipEntry) continue;
      const via = machine.chips[chipEntry.name];
      if (!via) continue;

      const cap = ps2OnVia(state._kbd, via, { port, control });
      machine.attachDevice(`ps2_${part.id}`, cap);
    }
  }

  return {
    machine,
    clockHz: config.clockHz,

    onSerial(cb) { serialListener = cb; },

    /** RX side: bit-banged VIA serial first (G-Pascal-class boards),
     *  then a 'console' MMIO chip (py65mon getc). */
    sendSerial(byte) {
      if (machine.serialIn && machine.serialIn(byte & 0xff)) return true;
      for (const chip of Object.values(machine.chips)) {
        // A real UART raises its data-ready flag through rxPush(); poking
        // the raw rx array bypassed RDRF, so MS BASIC polled status forever
        // and typing at MEMORY SIZE? did nothing (owner report,
        // 2026-08-17). The bare-array path stays for the py65mon console
        // chip, whose read() shifts rx directly.
        if (chip && typeof chip.rxPush === 'function') { chip.rxPush(byte & 0xff); return true; }
        if (chip && Array.isArray(chip.rx)) { chip.rx.push(byte & 0xff); return true; }
      }
      return false;
    },

    loadRom(bytes, at) {
      machine.loadRom(bytes, at);
    },

    attachBoard(b) {
      board = b;
      // Bridge PS/2 parts to the machine VIA before reset, so the
      // capture chain's advance() runs from the first instruction.
      bridgePS2(b);
      // Publish machine video through the physical card's board state so a
      // part-bound controller widget mirrors the actual framebuffer.
      for (const c of config.chips) {
        if (c.kind !== 'simplevga') continue;
        const state = typeof b.getDeviceState === 'function' ? b.getDeviceState(c.name) : null;
        if (state) state._video = machine.chips[c.name] || null;
      }
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
