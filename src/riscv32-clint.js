/**
 * A minimal CLINT (Core-Local Interruptor) — the standard SiFive-layout timer +
 * software-interrupt device an RTOS uses for its tick. It is the MMIO device the
 * core routes `this.io` accesses to; a single hart:
 *
 *   base+0x0000  msip       write 1 → machine software interrupt (MSIP)
 *   base+0x4000  mtimecmp   64-bit compare (lo, hi at +0x4000/+0x4004)
 *   base+0xBFF8  mtime      64-bit monotonic timer (lo, hi)
 *
 * The machine calls `tick()` as instructions retire, advancing mtime; when
 * mtime ≥ mtimecmp the CLINT raises the core's MTIP line (so an enabled handler
 * traps). Writing mtimecmp (the RTOS scheduling the next tick) lowers the line.
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
    let mtimeLo = 0, mtimeHi = 0;
    let cmpLo = 0xffffffff, cmpHi = 0xffffffff;   // "never" until the RTOS sets it
    let msip = 0;

    const ge64 = () => (mtimeHi >>> 0) > (cmpHi >>> 0) ||
        ((mtimeHi >>> 0) === (cmpHi >>> 0) && (mtimeLo >>> 0) >= (cmpLo >>> 0));
    const update = () => {
        cpu.setInterruptPending(INTERRUPT.MTI, ge64());
        cpu.setInterruptPending(INTERRUPT.MSI, (msip & 1) !== 0);
    };

    return {
        base, size: 0x10000,
        load32(off) {
            switch (off) {
                case MSIP: return msip;
                case MTIMECMP_LO: return cmpLo;
                case MTIMECMP_HI: return cmpHi;
                case MTIME_LO: return mtimeLo;
                case MTIME_HI: return mtimeHi;
                default: return 0;
            }
        },
        store32(off, v) {
            v >>>= 0;
            switch (off) {
                case MSIP: msip = v & 1; break;
                case MTIMECMP_LO: cmpLo = v; break;
                case MTIMECMP_HI: cmpHi = v; break;
                case MTIME_LO: mtimeLo = v; break;
                case MTIME_HI: mtimeHi = v; break;
                default: return;
            }
            update();
        },
        /** Advance mtime by `n` ticks (the machine calls this per retired instruction). */
        tick(n = 1) {
            const lo = (mtimeLo >>> 0) + n;
            mtimeLo = lo >>> 0;
            if (lo > 0xffffffff) mtimeHi = (mtimeHi + Math.floor(lo / 0x100000000)) >>> 0;
            update();
        },
        get mtime() { return mtimeHi * 0x100000000 + (mtimeLo >>> 0); }
    };
}

export default createClint;
