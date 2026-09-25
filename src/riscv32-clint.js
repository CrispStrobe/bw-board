/**
 * A minimal CLINT (Core-Local Interruptor) — the standard SiFive-layout timer +
 * software-interrupt device an RTOS uses for its tick. It is the MMIO device the
 * core routes `this.io` accesses to; a single hart:
 *
 *   base+0x0000  msip       write 1 → machine software interrupt (MSIP)
 *   base+0x4000  mtimecmp   64-bit compare (lo, hi at +0x4000/+0x4004)
 *   base+0xBFF8  mtime      64-bit monotonic timer (lo, hi)
 *
 * mtime counts the instructions the core retires. It is derived from
 * cpu.instret rather than ticked per step; the machine calls `sync()` when
 * cpu.instret reaches `deadline`, and when mtime ≥ mtimecmp the CLINT raises
 * the core's MTIP line (so an enabled handler traps). Writing mtimecmp (the RTOS
 * scheduling the next tick) lowers the line.
 *
 * @module
 */
import {INTERRUPT} from './riscv32.js';

const MSIP = 0x0000, MTIMECMP_LO = 0x4000, MTIMECMP_HI = 0x4004, MTIME_LO = 0xbff8, MTIME_HI = 0xbffc;

/**
 * @param {object} cpu a RiscV32 (its setInterruptPending raises MTIP/MSIP)
 * @param {{base?: number}} [opts]
 */
export function createClint(cpu, opts = {}) {
    const base = opts.base ?? 0x02000000;
    // mtime advances one tick per instruction the core retires (cpu.instret
    // counts every step, traps included). Rather than ticking it per step, it is
    // derived: mtime = t0 + (cpu.instret - mark). The machine calls sync() only
    // when cpu.instret reaches `deadline` — the step at which mtime reaches
    // mtimecmp — so MTIP rises on the same instruction a per-step tick raised it.
    let t0 = 0, mark = cpu.instret;
    let cmpLo = 0xffffffff, cmpHi = 0xffffffff;   // "never" until the RTOS sets it
    let msip = 0;
    const HI = 0x100000000;
    const now = () => t0 + (cpu.instret - mark);
    const cmp = () => cmpHi * HI + cmpLo;
    const setNow = v => { t0 = v; mark = cpu.instret; };

    const dev = {
        base, size: 0x10000,
        /** cpu.instret at which MTIP must next be re-evaluated (Infinity: never). */
        deadline: Infinity,
        load32(off) {
            switch (off) {
                case MSIP: return msip;
                case MTIMECMP_LO: return cmpLo;
                case MTIMECMP_HI: return cmpHi;
                case MTIME_LO: return now() % HI;
                case MTIME_HI: return Math.floor(now() / HI) >>> 0;
                default: return 0;
            }
        },
        store32(off, v) {
            v >>>= 0;
            switch (off) {
                case MSIP: msip = v & 1; break;
                case MTIMECMP_LO: cmpLo = v; break;
                case MTIMECMP_HI: cmpHi = v; break;
                case MTIME_LO: setNow(Math.floor(now() / HI) * HI + v); break;
                case MTIME_HI: setNow(v * HI + (now() % HI)); break;
                default: return;
            }
            dev.sync();
        },
        /** Re-derive MTIP/MSIP from mtime now, and the next deadline. */
        sync() {
            const t = now(), c = cmp();
            cpu.setInterruptPending(INTERRUPT.MTI, t >= c);
            cpu.setInterruptPending(INTERRUPT.MSI, (msip & 1) !== 0);
            dev.deadline = t >= c ? Infinity : cpu.instret + (c - t);
        },
        /** Advance mtime by `n` ticks beyond what the core has retired (a host
         *  that wants time to pass without instructions, e.g. an idle skip). */
        tick(n = 1) { t0 += n; dev.sync(); },
        /** Keep mtime continuous across a core reset (which zeroes instret). */
        rebase(prevNow) { t0 = prevNow; mark = cpu.instret; dev.sync(); },
        get mtime() { return now(); }
    };
    return dev;
}

export default createClint;
