/**
 * The RISC-V debug adapter — the thin wrapper the debug-target factory builds
 * around a {@link RiscV32Machine}, in the shape of z80-adapter / m6502-adapter
 * but stripped to what a console-only bench needs: this machine has no pin
 * boundary and no board, so `attachBoard` is a time-sync stub (the same stance
 * the z80 and 6502 console shapes take). Its I/O is the machine's `ecall` ABI,
 * surfaced through `onSerial`, so the app's console face reads its output the
 * way it reads any serial machine.
 *
 * Adapter-only mode: there is no dedicated riscv32 *debug* target yet (stepping/
 * inspection UI), so the factory returns `{target: null, adapter}` — the caller
 * can still run the program and watch its serial output.
 *
 * @module
 */
import {RiscV32Machine} from './riscv32-machine.js';

/**
 * @param {{image?: {segments: {addr:number,bytes:Uint8Array}[], entry:number},
 *          config?: object}} [opts]
 */
export function createRiscV32Adapter(opts = {}) {
    let serialListener = null;
    const stats = {serialCount: 0, stepCount: 0};
    const machine = new RiscV32Machine(opts.config || {}, {
        onSerial: b => { stats.serialCount++; if (serialListener) serialListener(b & 0xff); }
    });

    // Load a linked program image (segments + entry) if one was given.
    if (opts.image && Array.isArray(opts.image.segments)) {
        for (const {addr, bytes} of opts.image.segments) machine.load(bytes, addr);
        if (typeof opts.image.entry === 'number') machine.cpu.pc = opts.image.entry >>> 0;
    }

    let tNs = 0;
    return {
        machine,
        kind: 'riscv32',

        load(bytes, at) { machine.load(bytes, at); },

        // No pins to publish; a time-sync stub suffices (z80/6502 stance).
        attachBoard() { /* console-only bench: nothing to wire */ },

        /** The serial console face: listen for the ecall ABI's output bytes. */
        onSerial(cb) { serialListener = cb; },

        /** No console-input path on RISC-V yet (a UART/HTIF stdin is future work). */
        sendSerial() { return false; },

        exited() { return machine.halted; },
        exitCode() { return machine.exitCode; },

        step() { stats.stepCount++; return machine.step(); },

        /** Advance ~deltaNs of work. RISC-V here has no fixed clock, so this
         *  approximates one instruction per ns, bounded, and stops on halt. */
        advanceNs(deltaNs) {
            const budget = Math.max(1, Math.min(2_000_000, Math.round(deltaNs)));
            let n = 0;
            while (!machine.halted && n++ < budget) { machine.step(); stats.stepCount++; }
            tNs += deltaNs;
        },

        timeNs() { return BigInt(Math.round(tNs)); },

        reset() { machine.reset(); tNs = 0; },

        stats
    };
}

export default createRiscV32Adapter;
