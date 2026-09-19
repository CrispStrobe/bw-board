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
import { ps2On8255 } from './ps2.js';

/**
 * @param {object} [opts]
 * @param {object} [opts.config] - Machine config (default BREADBOARD8086)
 * @param {Uint8Array} [opts.rom] - ROM image
 * @param {number} [opts.romAt] - ROM load address (default: first rom region)
 */
export function createI8086Adapter(opts = {}) {
    const config = opts.config ?? BREADBOARD8086;

    let board = null;
    let unloggedBoardInputs = false;
    let serialListener = null;
    const stats = { pinChangeCount: 0, advanceToCount: 0 };
    // Pins a PS/2 bridge drives directly (the scancode byte lanes + the strobe).
    // syncInputs must NOT re-sample these from board.readPin, or it would clobber
    // the latched byte between frames — the capture, not the board, owns them.
    const ps2Pins = new Set();

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
                    if (ps2Pins.has(pin)) continue;   // a PS/2 bridge owns this input
                    ppi.setInput(port, bit, board.readPin(pin));
                }
            }
        }
    }

    /**
     * Auto-wire a PS/2 keyboard the way the 6502/z80 adapters do (bridgePS2),
     * but onto an 8255: when a drawn board carries a `ps2` part whose data lines
     * reach a PPI port and whose DA line reaches a PPI status bit, bridge the
     * board's PS2Keyboard to that port via ps2On8255 and attach the capture so
     * it is clocked each step. The wiring is INFERRED from the nets, so a learner
     * draws a keyboard onto the board and it just works — the same shape as
     * ps2OnVia's board detection, expressed for the PPI's ports.
     */
    function bridgePS2(b) {
        if (!b || !b.parts || !b.nets) return;
        for (const part of b.parts) {
            if (part.kind !== 'ps2') continue;
            const state = b.getDeviceState?.(part.id);
            if (!state || !state._kbd) continue;
            let ppiName = null, port = null, strobePort = 'c', strobeBit = 0;
            const partOf = (id) => b.partMap ? b.partMap.get(id) : b.parts.find((pp) => pp.id === id);
            for (const net of b.nets) {
                const here = net.terminals.find((t) => t.part === part.id);
                if (!here) continue;
                if (/^d[0-7]$/.test(here.terminal)) {                    // a data line -> a PPI port pin
                    const ppiTerm = net.terminals.find((t) => t.part !== part.id && partOf(t.part)?.kind === 'ppi');
                    if (ppiTerm) {
                        ppiName = ppiTerm.part;
                        const m = String(ppiTerm.terminal).match(/^P([ABC])(\d)$/i);
                        if (m) port = m[1].toLowerCase();
                    }
                } else if (here.terminal === 'da') {                    // DATA AVAILABLE -> a PPI status bit
                    const ppiTerm = net.terminals.find((t) => t.part !== part.id && partOf(t.part)?.kind === 'ppi');
                    const m = ppiTerm && String(ppiTerm.terminal).match(/^P([ABC])(\d)$/i);
                    if (m) { strobePort = m[1].toLowerCase(); strobeBit = Number(m[2]); }
                }
            }
            if (!port) port = 'a';                                      // XT convention: scancode byte at port A (0x60)
            const chipEntry = config.chips.find((c) => c.kind === 'ppi' && (c.name === ppiName || !ppiName));
            if (!chipEntry) continue;
            const ppi = machine.chips[chipEntry.name];
            if (!ppi) continue;
            for (let i = 0; i < 8; i++) ps2Pins.add(`${chipEntry.name}.P${port.toUpperCase()}${i}`);
            ps2Pins.add(`${chipEntry.name}.P${strobePort.toUpperCase()}${strobeBit}`);
            machine.attachDevice(`ps2_${part.id}`, ps2On8255(state._kbd, ppi, { port, strobePort, strobeBit }));
        }
    }

    return {
        machine,
        clockHz: config.clockHz,
        /**
         * Which RAM word-access path this machine resolved to, OBSERVED from
         * the machine rather than re-derived from `config`.
         *
         * `installI8086RamWordAccess` assigns its own `_rd16` over the
         * prototype's, so the own-property is the installation itself — the
         * effect, not a second reading of the condition that caused it. That
         * also keeps this change inside THIS file: a record stored on the
         * machine would be unreachable for the consumer that needs it, because
         * a downstream tree that omits the cycle-timing path cannot vendor
         * i8086-machine.js at all.
         *
         * DECLARED BECAUSE THE RESOLUTION MOVED OUT. A caller supplies the
         * config, so a caller that means to decline the fast path can fail to,
         * and without this it has no way to tell. Reporting it makes the seam's
         * absence detectable, which is the condition on every other injected
         * seam in this tree.
         *
         * What the suite DOES defend is that this agrees with the effect: a
         * hardcoded value, a dropped field, or a machine that records one thing
         * and installs another all red. What it does not defend is reading the
         * machine rather than re-deriving from `config` -- see the note at the
         * machine's own recording site.
         */
        fastWordAccess: Object.hasOwn(machine.cpu, '_rd16'),

        /** Does a live board sample input nets that nothing records? */
        unloggedBoardInputs() { return unloggedBoardInputs; },

        onSerial(cb) { serialListener = cb; },

        sendSerial(byte) { return machine.serialIn(byte & 0xff); },

        loadRom(bytes, at) { machine.loadRom(bytes, at); },

        attachBoard(b) {
            board = b;
            // syncInputs samples input nets that never pass through the debug
            // target, so nothing records them.
            unloggedBoardInputs = typeof b?.readPin === 'function';
            // Reset fetches from FFFF:0000 and publishes the initial pin
            // state, which for a just-reset 8255 is "nothing driven".
            machine.reset();
            ps2Pins.clear();
            bridgePS2(b);        // auto-wire a drawn PS/2 keyboard onto its PPI
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
