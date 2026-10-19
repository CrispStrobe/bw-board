/**
 * R6507 — a MOS 6507 mask over the W65C02 core.
 *
 * The 6507 is a 28-pin variant of the 6502 with three key differences:
 *   1. Only 13 address lines (A0–A12): the full 64K space is masked to
 *      8K ($0000–$1FFF), everything above mirrors.
 *   2. No IRQ pin — the interrupt request line is not bonded out.
 *   3. No NMI pin — the non-maskable interrupt line is not bonded out.
 *
 * Documented limitation: the underlying core is a W65C02 (CMOS). The real
 * 6507 is NMOS — no 65C02-only opcodes (RMB/SMB/BBR/BBS, STZ, TRB/TSB,
 * STP/WAI, BRA, PLX/PLY/PHX/PHY, (zp)) should appear in 6507 programs.
 * NMOS undocumented opcodes (LAX, SAX, DCP, etc.) are NOT modeled.
 *
 * The address mask is applied in the bus callbacks so the CPU core itself
 * is unmodified — vectors at $FFFC/$FFFE map to $1FFC/$1FFE in the 8K space.
 *
 * @module
 */
import { W65C02 } from './w65c02.js';

const ADDR_MASK = 0x1fff; // 13 bits — 8K address space

export class R6507 {
    /**
     * @param {{ read: (addr: number) => number, write: (addr: number, val: number) => void }} bus
     */
    constructor(bus) {
        this.cpu = new W65C02({
            read: (a) => bus.read(a & ADDR_MASK),
            write: (a, v) => bus.write(a & ADDR_MASK, v),
        });
    }

    /** Proxy architectural state for inspection. */
    get a() { return this.cpu.a; }
    get x() { return this.cpu.x; }
    get y() { return this.cpu.y; }
    get s() { return this.cpu.s; }
    get pc() { return this.cpu.pc; }
    get p() { return this.cpu.p; }
    get stopped() { return this.cpu.stopped; }
    get waiting() { return this.cpu.waiting; }
    get cycles() { return this.cpu.cycles; }

    /** Hardware reset via the vector at $FFFC (maps to $1FFC in 8K space). */
    reset() { this.cpu.reset(); }

    /** Execute one instruction. Returns cycle count. */
    step() { return this.cpu.step(); }

    // IRQ and NMI are NOT exposed — the 6507 has no interrupt pins.
    // The BRK instruction still works (it's a software interrupt).
}
