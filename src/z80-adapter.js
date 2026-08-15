/**
 * Boundary-A adapter for the composable Z80 machine — the missing link
 * between the z80-bench gallery example and a RUNNING machine. The
 * eater6502 target had this from day one; the Z80 tier had machines,
 * extractors and a debug target, but no adapter, so the factory could
 * not boot it and the shipped example was a dead end.
 *
 * The Z80's boundary-A surface differs from the 6502's on purpose:
 * a Searle-shape machine has NO GPIO pins — its observable edge is the
 * ACIA serial stream (both directions) plus, on Spectrum-shaped
 * configs, the ULA faces the debug target already exposes. So
 * attachBoard keeps the time-sync invariant (board.advanceTo before
 * any effect) but publishes no pins; serial goes through onSerial /
 * sendSerial like every other serial-bearing adapter.
 *
 * config comes from a preset (SEARLE default), from CPM64K, from a
 * Spectrum config ({ula: true} / {zx128: true}), or from the Z80 bus
 * extractor's output — the same three-source doctrine as the 6502.
 */
import { Z80Machine, SEARLE } from './z80-machine.js';

export function createZ80Adapter(opts = {}) {
    const config = opts.config ?? SEARLE;
    let board = null;
    const stats = { serialCount: 0, advanceToCount: 0 };
    let serialListener = null;

    const machine = new Z80Machine(config, {
        onSerial(byte, tMs) {
            if (board && board.advanceTo) {
                board.advanceTo(BigInt(Math.round(tMs * 1e6)));
            }
            stats.serialCount++;
            if (serialListener) serialListener(byte);
        },
    });

    if (opts.rom) machine.load(opts.rom, opts.romAt ?? 0);

    return {
        machine,
        clockHz: config.clockHz,

        load(bytes, at) { machine.load(bytes, at); },

        attachBoard(b) {
            board = b;
            machine.cpu.pc = opts.pc ?? 0;
        },

        /** The serial console face: listen for TX bytes. */
        onSerial(cb) { serialListener = cb; },

        /** RX side: feed a byte to the first ACIA (keyboard → machine). */
        sendSerial(byte) {
            for (const chip of Object.values(machine.chips)) {
                if (typeof chip.rxPush === 'function') { chip.rxPush(byte & 0xff); return true; }
            }
            return false;
        },

        advanceNs(deltaNs) {
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

export default createZ80Adapter;
