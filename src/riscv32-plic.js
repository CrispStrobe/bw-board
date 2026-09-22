/**
 * A minimal PLIC (Platform-Level Interrupt Controller) — the standard SiFive
 * layout, one hart / one M-mode context. It routes *external* device interrupts
 * (a UART's receive line, say) to the core's MEIP (mip bit 11), the companion to
 * the CLINT's timer line. It is the third of the "standard CLINT + PLIC + UART"
 * an RTOS expects (see the lab's RISCV-OS-MATRIX).
 *
 *   base+0x000000 + 4*src   priority[src]        (src 1..31)
 *   base+0x001000           pending bitfield     (read-only; devices set it)
 *   base+0x002000           enable bitfield      (context 0)
 *   base+0x200000           threshold            (context 0)
 *   base+0x200004           claim / complete     (read = highest pending&enabled
 *                                                 source > threshold, marks it
 *                                                 in-service; write = complete)
 *
 * A device raises/lowers its line with `setPending(src, on)`; the core takes an
 * external interrupt, reads claim, services the device (which lowers its line),
 * writes complete. @module
 */
import {INTERRUPT} from './riscv32.js';

const PRIORITY = 0x000000, PENDING = 0x001000, ENABLE = 0x002000, THRESHOLD = 0x200000, CLAIM = 0x200004;

export function createPlic(cpu, opts = {}) {
    const base = opts.base ?? 0x0c000000;
    const priority = new Uint32Array(32);   // priority[src], src 1..31
    let pending = 0, enable = 0, threshold = 0, inService = 0;

    // The highest-priority source that is pending, enabled, above threshold and
    // not already in service — 0 if none.
    const best = () => {
        let src = 0, pri = 0;
        const ready = pending & enable & ~inService;
        for (let s = 1; s < 32; s++) {
            if ((ready & (1 << s)) && priority[s] > threshold && priority[s] > pri) { pri = priority[s]; src = s; }
        }
        return src;
    };
    const update = () => cpu.setInterruptPending(INTERRUPT.MEI, best() !== 0);

    return {
        base, size: 0x400000,
        load32(off) {
            if (off >= PRIORITY && off < PRIORITY + 128) return priority[off >> 2] || 0;
            if (off === PENDING) return pending;
            if (off === ENABLE) return enable;
            if (off === THRESHOLD) return threshold;
            if (off === CLAIM) { const s = best(); if (s) { inService |= (1 << s); update(); } return s; }
            return 0;
        },
        store32(off, v) {
            v >>>= 0;
            if (off >= PRIORITY && off < PRIORITY + 128) { priority[off >> 2] = v; update(); return; }
            if (off === ENABLE) { enable = v; update(); return; }
            if (off === THRESHOLD) { threshold = v; update(); return; }
            if (off === CLAIM) { inService &= ~(1 << (v & 0x1f)); update(); return; }   // complete
        },
        /** A device gateway: raise (on) or lower its interrupt line. */
        setPending(src, on) {
            if (on) pending |= (1 << src); else pending &= ~(1 << src);
            update();
        }
    };
}

export default createPlic;
