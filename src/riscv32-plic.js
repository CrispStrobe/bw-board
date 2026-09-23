/**
 * A PLIC (Platform-Level Interrupt Controller) — the standard SiFive layout with
 * TWO contexts for one hart: context 0 (machine) → MEIP (mip bit 11) and context
 * 1 (supervisor) → SEIP (mip bit 9). It routes *external* device interrupts (a
 * UART's receive line, a virtio disk's completion) to whichever privilege has
 * enabled the source. An RTOS uses the machine context; a supervisor kernel (xv6,
 * Linux) uses the supervisor context. The third of the standard CLINT+PLIC+UART.
 *
 *   base+0x000000 + 4*src        priority[src]         (src 1..31)
 *   base+0x001000                pending bitfield      (read-only; devices set it)
 *   base+0x002000 + 0x80*ctx     enable bitfield       (per context)
 *   base+0x200000 + 0x1000*ctx   threshold             (per context)
 *   base+0x200004 + 0x1000*ctx   claim / complete      (per context)
 *
 * A device raises/lowers its line with `setPending(src, on)`; the core takes an
 * external interrupt, reads its context's claim, services the device (which
 * lowers its line), then writes complete. @module
 */
import {INTERRUPT} from './riscv32.js';

const PRIORITY = 0x000000, PENDING = 0x001000;
const ENABLE = 0x002000, ENABLE_STRIDE = 0x80;
const CTX = 0x200000, CTX_STRIDE = 0x1000;   // threshold at +0, claim/complete at +4
const NCTX = 2;
const EXT_BIT = [INTERRUPT.MEI, INTERRUPT.SEI];   // context 0 → machine, 1 → supervisor

export function createPlic(cpu, opts = {}) {
    const base = opts.base ?? 0x0c000000;
    const priority = new Uint32Array(32);   // priority[src], src 1..31
    let pending = 0;
    const enable = new Array(NCTX).fill(0);
    const threshold = new Array(NCTX).fill(0);
    const inService = new Array(NCTX).fill(0);

    // The highest-priority source pending, enabled for context `c`, above its
    // threshold and not already in service — 0 if none.
    const best = c => {
        let src = 0, pri = 0;
        const ready = pending & enable[c] & ~inService[c];
        for (let s = 1; s < 32; s++) {
            if ((ready & (1 << s)) && priority[s] > threshold[c] && priority[s] > pri) { pri = priority[s]; src = s; }
        }
        return src;
    };
    const update = () => { for (let c = 0; c < NCTX; c++) cpu.setInterruptPending(EXT_BIT[c], best(c) !== 0); };

    return {
        base, size: 0x400000,
        load32(off) {
            if (off >= PRIORITY && off < PRIORITY + 128) return priority[off >> 2] || 0;
            if (off === PENDING) return pending;
            if (off >= ENABLE && off < ENABLE + NCTX * ENABLE_STRIDE) {
                const rem = (off - ENABLE) % ENABLE_STRIDE;
                if (rem === 0) return enable[(off - ENABLE) / ENABLE_STRIDE];
                return 0;
            }
            if (off >= CTX && off < CTX + NCTX * CTX_STRIDE) {
                const c = ((off - CTX) / CTX_STRIDE) | 0, rem = (off - CTX) % CTX_STRIDE;
                if (rem === 0) return threshold[c];
                if (rem === 4) { const s = best(c); if (s) { inService[c] |= (1 << s); update(); } return s; }
            }
            return 0;
        },
        store32(off, v) {
            v >>>= 0;
            if (off >= PRIORITY && off < PRIORITY + 128) { priority[off >> 2] = v; update(); return; }
            if (off >= ENABLE && off < ENABLE + NCTX * ENABLE_STRIDE) {
                const rem = (off - ENABLE) % ENABLE_STRIDE;
                if (rem === 0) { enable[(off - ENABLE) / ENABLE_STRIDE] = v; update(); }
                return;
            }
            if (off >= CTX && off < CTX + NCTX * CTX_STRIDE) {
                const c = ((off - CTX) / CTX_STRIDE) | 0, rem = (off - CTX) % CTX_STRIDE;
                if (rem === 0) { threshold[c] = v; update(); }
                else if (rem === 4) { inService[c] &= ~(1 << (v & 0x1f)); update(); }   // complete
            }
        },
        /** A device gateway: raise (on) or lower its interrupt line. */
        setPending(src, on) {
            if (on) pending |= (1 << src); else pending &= ~(1 << src);
            update();
        }
    };
}

export default createPlic;
