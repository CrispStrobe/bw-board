/**
 * I8086Machine → boundary A adapter: the 8086 breadboard computer drives
 * the circuit board through the same contract every other adapter speaks —
 * pin edges as `board.setPin(name, mode, driveHigh)`, time as
 * `board.advanceTo(tNs)`.
 *
 * The machine's onPinChange hook fires for every 8255 output-pin edge and
 * the adapter turns those into setPin calls. A PPI pin configured as an
 * output is a push-pull CMOS/TTL driver — the only kind onPinChange
 * reports — so the mode is always 'pushpull', as with the VIA.
 *
 * Input pins sync from the board on each advanceNs: `board.readPin`
 * ('ppi1.PA3') → `ppi.setInput('a', 3, level)`. Only pins whose direction
 * bit says INPUT are read back, and port C is read half by half, because
 * its two nibbles carry independent directions and a whole-port sync would
 * overwrite the half the chip is driving.
 *
 * @module
 */

import { I8086Machine, BREADBOARD8086 } from './i8086-machine.js';

/**
 * @param {object} [opts]
 * @param {object} [opts.config] - Machine config (default BREADBOARD8086)
 * @param {Uint8Array} [opts.rom] - ROM image
 * @param {number} [opts.romAt] - ROM load address (default: first rom region)
 */
export function createI8086Adapter(opts = {}) {
    const config = opts.config ?? BREADBOARD8086;

    let board = null;
    let serialListener = null;
    const stats = { pinChangeCount: 0, advanceToCount: 0 };

    const machine = new I8086Machine(config, {
        onPinChange(pin, level, tMs) {
            if (!board) return;
            // Time first, edge second — the invariant every adapter keeps.
            if (board.advanceTo) board.advanceTo(BigInt(Math.round(tMs * 1e6)));
            board.setPin(pin, 'pushpull', !!level);
            stats.pinChangeCount++;
        },
        onSerial(byte) {
            if (serialListener) serialListener(byte);
        },
    });

    if (opts.rom) machine.loadRom(opts.rom, opts.romAt);

    /** Board → PPI, for every pin the chip is NOT driving. */
    function syncInputs() {
        if (!board || !board.readPin) return;
        for (const c of config.chips) {
            if (c.kind !== 'ppi') continue;
            const ppi = machine.chips[c.name];
            if (!ppi) continue;
            for (const [port, out] of [['a', ppi.dirA], ['b', ppi.dirB], ['c', ppi.dirC]]) {
                for (let bit = 0; bit < 8; bit++) {
                    if (out & (1 << bit)) continue;   // driven by the chip
                    const pin = `${c.name}.P${port.toUpperCase()}${bit}`;
                    ppi.setInput(port, bit, board.readPin(pin));
                }
            }
        }
    }

    return {
        machine,
        clockHz: config.clockHz,

        onSerial(cb) { serialListener = cb; },

        sendSerial(byte) { return machine.serialIn(byte & 0xff); },

        loadRom(bytes, at) { machine.loadRom(bytes, at); },

        attachBoard(b) {
            board = b;
            // Reset fetches from FFFF:0000 and publishes the initial pin
            // state, which for a just-reset 8255 is "nothing driven".
            machine.reset();
            syncInputs();
        },

        syncInputs,

        advanceNs(deltaNs) {
            syncInputs();
            machine.advanceToMs(machine.tMs + deltaNs / 1e6);
            if (board && board.advanceTo) {
                board.advanceTo(this.timeNs());
                stats.advanceToCount++;
            }
        },

        timeNs() { return BigInt(Math.round(machine.tMs * 1e6)); },

        stats,
    };
}

export default createI8086Adapter;
