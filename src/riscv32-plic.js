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
 * external interrupt, reads its context's claim, services the device, then
 * writes complete.
 *
 * Gateway semantics follow the SiFive PLIC / QEMU `sifive_plic`: a *claim*
 * atomically clears the claimed source's pending latch, and *complete* does NOT
 * re-pend a source whose line is still asserted — only a fresh `setPending(src,
 * true)` (a new device event) re-latches it. This edge-at-the-gateway behaviour
 * is what a driver that acknowledges the interrupt purely via claim/complete —
 * e.g. michaelengel's xv6-rv32, whose `virtio_disk_intr` never writes the
 * virtio-mmio INTERRUPT_ACK register — depends on: a level re-derived on
 * complete would storm the hart and starve its scheduler. Devices that fire
 * repeatedly (the UART per keystroke, virtio per used-ring post) re-signal with
 * `setPending(src, true)` for each event, so they still interrupt every time.
 * @module
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

    // The highest-priority source pending and enabled for context `c`, above its
    // threshold — 0 if none. (A claim clears the source's pending bit, so an
    // in-service source drops out of `pending` here without a separate mask.)
    const best = c => {
        let src = 0, pri = 0;
        const ready = pending & enable[c];
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
                if (rem === 4) { const s = best(c); if (s) { pending &= ~(1 << s); update(); } return s; }   // claim: latch clears
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
                else if (rem === 4) { update(); }   // complete: gateway re-evaluates; the latch was already cleared on claim, so a still-high line does not re-pend
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
