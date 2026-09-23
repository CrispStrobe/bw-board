/**
 * A small RV32IMA interpreter — the RISC-V core, in the hand-rolled per-core
 * idiom of z80.js / m6502.js / i8086.js (one instruction per `step()`, a flat
 * little-endian memory, no code generation). Semantics follow the RISC-V
 * unprivileged ISA: rv32i base + M (mul/div/rem) + A (LR/SC + AMO*, a single
 * reservation since this is one hart) + C (the compressed 16-bit encodings,
 * expanded to their base instruction at fetch by `_decompress`), plus the
 * machine-mode privileged bits an
 * RTOS trap handler needs: the M-mode CSRs (mstatus/mie/mip/mtvec/mepc/mcause/
 * mscratch/mtval), Zicsr (CSRRW/S/C and their immediate forms), MRET, WFI, and
 * interrupt entry — a pending, enabled machine interrupt (mip & mie, with
 * mstatus.MIE) traps to mtvec before the next fetch. A device (a CLINT) raises
 * the timer/software lines through `setInterruptPending`. No S-mode / Sv32 MMU
 * yet (that is the Linux increment). exactstep was the one-step decode reference.
 *
 * Memory is a flat `Uint8Array` the caller owns; the CPU reads and writes it
 * little-endian. `ecall`/`ebreak` call an injectable hook so a test (or a later
 * machine) supplies syscalls (console, exit) without this core knowing about
 * them. x0 is hard-wired to zero.
 *
 * @module
 */

const OPC = {
    LUI: 0x37, AUIPC: 0x17, JAL: 0x6f, JALR: 0x67, BRANCH: 0x63,
    LOAD: 0x03, STORE: 0x23, OPIMM: 0x13, OP: 0x33, MISCMEM: 0x0f, SYSTEM: 0x73,
    AMO: 0x2f
};

/** Sign-extend the low `bits` of `v` to a JS (32-bit) signed int. */
const sext = (v, bits) => (v << (32 - bits)) >> (32 - bits);

// M-mode CSRs (the subset a machine-mode RTOS trap handler needs).
const CSR = {
    MSTATUS: 0x300, MISA: 0x301, MIE: 0x304, MTVEC: 0x305,
    MSCRATCH: 0x340, MEPC: 0x341, MCAUSE: 0x342, MTVAL: 0x343, MIP: 0x344,
    MHARTID: 0xf14, MCYCLE: 0xb00, MINSTRET: 0xb02
};
// mstatus fields.
const MSTATUS_MIE = 1 << 3, MSTATUS_MPIE = 1 << 7, MSTATUS_MPP = 3 << 11;
// mie/mip interrupt bits: software (3), timer (7), external (11) — machine mode.
const IRQ_MSI = 1 << 3, IRQ_MTI = 1 << 7, IRQ_MEI = 1 << 11;
// Interrupt causes (with the high bit set in mcause).
const CAUSE_MSI = 3, CAUSE_MTI = 7, CAUSE_MEI = 11;
// Synchronous exception cause: environment call from M-mode (no interrupt bit).
const CAUSE_ECALL_M = 11;

export class RiscV32 {
    /**
     * @param {Uint8Array} mem flat memory the CPU reads/writes (little-endian)
     * @param {{ecall?: (cpu: RiscV32) => void, ebreak?: (cpu: RiscV32) => void,
     *          resetPc?: number, ecallTraps?: boolean}} [hooks]
     */
    constructor(mem, hooks = {}) {
        this.mem = mem;
        this.x = new Int32Array(32);      // x0..x31, x0 stays 0
        this.pc = (hooks.resetPc ?? 0) >>> 0;
        this.hooks = hooks;
        // RTOS mode: ECALL becomes a real M-mode exception (cause 11) to mtvec
        // instead of the Linux-ABI hook. An RTOS (FreeRTOS) yields via ecall and
        // wants its own trap handler; a bare program leaves this off and keeps the
        // write/exit hook. Off by default, so every existing fixture is untouched.
        this.ecallTraps = !!hooks.ecallTraps;
        // Base physical address of RAM. `mem` is a flat 0-based array, so an
        // address is translated to a RAM index by subtracting this. Default 0
        // (RAM at 0x0, as before). Set to 0x80000000 to run images linked at the
        // standard riscv `virt` RAM base (Zephyr's qemu_riscv32, xv6, Linux). The
        // MMIO devices (CLINT/PLIC/UART) sit below it and are routed by absolute
        // address before RAM, so they are unaffected.
        this.ramBase = (hooks.ramBase ?? 0) >>> 0;
        this.halted = false;
        this.instret = 0;                 // instructions retired
        this.resvAddr = -1;               // LR/SC reservation (address, or -1)
        this.csr = new Uint32Array(4096); // M-mode CSR file
        this.waiting = false;             // parked on WFI until an interrupt
        // MMIO device lists: word devices {base,size,load32,store32} (CLINT,
        // PLIC) routed by ld32/st32; byte devices {base,size,load8,store8}
        // (UART) routed by ld8/st8. Accepts a single device or an array.
        this.io = [].concat(hooks.io || []);
        this.io8 = [].concat(hooks.io8 || []);
    }

    reset() {
        this.x.fill(0);
        this.pc = (this.hooks.resetPc ?? 0) >>> 0;
        this.halted = false;
        this.instret = 0;
        this.resvAddr = -1;
        this.csr.fill(0);
        this.waiting = false;
    }

    /** Raise (level-set) a machine interrupt line in mip — called by a device
     *  (the CLINT) so software sees mip.MTIP / MSIP / MEIP. `on` clears it. */
    setInterruptPending(bit, on) {
        if (on) this.csr[CSR.MIP] |= bit; else this.csr[CSR.MIP] &= ~bit;
    }

    /** Read a CSR, honouring the hard-wired ones. */
    _readCsr(n) {
        if (n === CSR.MHARTID) return 0;
        if (n === CSR.MISA) return 0x40001100 >>> 0;   // RV32 + I,M,A (MXL=1, bits I/M/A)
        return this.csr[n] >>> 0;
    }

    /** Write a CSR with the WARL masks M-mode needs. */
    _writeCsr(n, v) {
        v >>>= 0;
        if (n === CSR.MHARTID || n === CSR.MISA) return;              // read-only here
        if (n === CSR.MSTATUS) { this.csr[n] = v & (MSTATUS_MIE | MSTATUS_MPIE | MSTATUS_MPP); return; }
        if (n === CSR.MIP) {
            // Software may set/clear MSIP; MTIP/MEIP are owned by devices.
            this.csr[n] = (this.csr[n] & ~IRQ_MSI) | (v & IRQ_MSI);
            return;
        }
        if (n === CSR.MTVEC) { this.csr[n] = v & ~1; return; }        // direct/vectored low bit; force direct base
        this.csr[n] = v;
    }

    /** Enter a trap (interrupt or exception): stash pc, set cause/tval, mask
     *  interrupts, and jump to mtvec (direct mode). */
    _trap(cause, isInterrupt, tval) {
        this.csr[CSR.MEPC] = this.pc >>> 0;
        this.csr[CSR.MCAUSE] = ((isInterrupt ? 0x80000000 : 0) | cause) >>> 0;
        this.csr[CSR.MTVAL] = (tval || 0) >>> 0;
        const s = this.csr[CSR.MSTATUS];
        // MPIE <- MIE; MIE <- 0; MPP <- 3 (M-mode).
        this.csr[CSR.MSTATUS] = ((s & ~MSTATUS_MPIE & ~MSTATUS_MIE & ~MSTATUS_MPP) |
            ((s & MSTATUS_MIE) ? MSTATUS_MPIE : 0) | MSTATUS_MPP) >>> 0;
        this.pc = (this.csr[CSR.MTVEC] & ~3) >>> 0;
        this.waiting = false;
    }

    /** If an enabled machine interrupt is pending, take it. Returns true if a
     *  trap was entered (so step() does not also execute an instruction). */
    _takeInterruptIfPending() {
        if (!(this.csr[CSR.MSTATUS] & MSTATUS_MIE)) return false;
        const pending = this.csr[CSR.MIP] & this.csr[CSR.MIE];
        if (!pending) return false;
        // Priority: external > software > timer (per the spec's default order).
        const cause = (pending & IRQ_MEI) ? CAUSE_MEI : (pending & IRQ_MSI) ? CAUSE_MSI : CAUSE_MTI;
        this._trap(cause, true, 0);
        return true;
    }

    // ── RVC: the compressed (C) extension ───────────────────────────
    /** Expand a 16-bit compressed instruction to its 32-bit equivalent, or
     *  return null if the encoding is reserved/illegal. RVC is pure syntactic
     *  sugar — each C instruction maps to one base instruction — so decompressing
     *  at fetch keeps the executor (below) unchanged. RV32 set (no F/D). */
    _decompress(h) {
        h &= 0xffff;
        const op = h & 3, f3 = (h >>> 13) & 7;
        const rd = (h >>> 7) & 0x1f, rs2 = (h >>> 2) & 0x1f;   // full 5-bit fields
        const rdp = 8 + ((h >>> 2) & 7), rs1p = 8 + ((h >>> 7) & 7), rs2p = 8 + ((h >>> 2) & 7);
        const bit = n => (h >>> n) & 1;
        const sx = (v, b) => (v << (32 - b)) >> (32 - b);
        // 32-bit field encoders (same layout the executor decodes).
        const I = (o, f, d, s1, im) => ((im & 0xfff) << 20 | (s1 & 0x1f) << 15 | (f & 7) << 12 | (d & 0x1f) << 7 | o) >>> 0;
        const R = (o, f, f7, d, s1, s2) => ((f7 & 0x7f) << 25 | (s2 & 0x1f) << 20 | (s1 & 0x1f) << 15 | (f & 7) << 12 | (d & 0x1f) << 7 | o) >>> 0;
        const S = (o, f, s1, s2, im) => (((im >> 5) & 0x7f) << 25 | (s2 & 0x1f) << 20 | (s1 & 0x1f) << 15 | (f & 7) << 12 | (im & 0x1f) << 7 | o) >>> 0;
        const B = (o, f, s1, s2, im) => (((im >> 12) & 1) << 31 | ((im >> 5) & 0x3f) << 25 | (s2 & 0x1f) << 20 | (s1 & 0x1f) << 15 | (f & 7) << 12 | ((im >> 1) & 0xf) << 8 | ((im >> 11) & 1) << 7 | o) >>> 0;
        const U = (o, d, im) => ((im & 0xfffff000) | (d & 0x1f) << 7 | o) >>> 0;
        const J = (o, d, im) => (((im >> 20) & 1) << 31 | ((im >> 1) & 0x3ff) << 21 | ((im >> 11) & 1) << 20 | ((im >> 12) & 0xff) << 12 | (d & 0x1f) << 7 | o) >>> 0;

        if (op === 0) {                                        // ── Quadrant 0 ──
            if (f3 === 0) {                                    // C.ADDI4SPN → addi rd', x2, nzuimm
                const nz = (((h >> 7) & 0xf) << 6) | (((h >> 11) & 3) << 4) | (bit(5) << 3) | (bit(6) << 2);
                return nz === 0 ? null : I(0x13, 0, rdp, 2, nz);
            }
            if (f3 === 2) {                                    // C.LW → lw rd', off(rs1')
                const off = (((h >> 10) & 7) << 3) | (bit(6) << 2) | (bit(5) << 6);
                return I(0x03, 2, rdp, rs1p, off);
            }
            if (f3 === 6) {                                    // C.SW → sw rs2', off(rs1')
                const off = (((h >> 10) & 7) << 3) | (bit(6) << 2) | (bit(5) << 6);
                return S(0x23, 2, rs1p, rs2p, off);
            }
            return null;                                       // FLD/FLW/FSD/FSW: no F/D
        }
        if (op === 1) {                                        // ── Quadrant 1 ──
            if (f3 === 0) return I(0x13, 0, rd, rd, sx((bit(12) << 5) | ((h >> 2) & 0x1f), 6));   // C.ADDI (rd=0 → NOP)
            if (f3 === 1) {                                    // C.JAL → jal x1, off  (RV32)
                const im = (bit(12) << 11) | (bit(11) << 4) | (((h >> 9) & 3) << 8) | (bit(8) << 10) |
                    (bit(7) << 6) | (bit(6) << 7) | (((h >> 3) & 7) << 1) | (bit(2) << 5);
                return J(0x6f, 1, sx(im, 12));
            }
            if (f3 === 2) return I(0x13, 0, rd, 0, sx((bit(12) << 5) | ((h >> 2) & 0x1f), 6));     // C.LI → addi rd, x0, imm
            if (f3 === 3) {
                if (rd === 2) {                                // C.ADDI16SP → addi x2, x2, nzimm
                    const im = (bit(12) << 9) | (((h >> 3) & 3) << 7) | (bit(5) << 6) | (bit(2) << 5) | (bit(6) << 4);
                    return im === 0 ? null : I(0x13, 0, 2, 2, sx(im, 10));
                }
                const im = sx((bit(12) << 17) | (((h >> 2) & 0x1f) << 12), 18);                    // C.LUI → lui rd, nzimm
                return im === 0 ? null : U(0x37, rd, im);
            }
            if (f3 === 4) {                                    // MISC-ALU on rd'
                const sub = (h >> 10) & 3;
                if (sub === 0) return R(0x13, 5, 0x00, rs1p, rs1p, (bit(12) << 5) | ((h >> 2) & 0x1f));   // C.SRLI (srli imm)
                if (sub === 1) return R(0x13, 5, 0x20, rs1p, rs1p, (bit(12) << 5) | ((h >> 2) & 0x1f));   // C.SRAI
                if (sub === 2) return I(0x13, 7, rs1p, rs1p, sx((bit(12) << 5) | ((h >> 2) & 0x1f), 6));  // C.ANDI
                const w = (h >> 5) & 3;                        // C.SUB/XOR/OR/AND (bit12=0 for RV32)
                if (bit(12)) return null;
                return R(0x33, [0, 4, 6, 7][w], w === 0 ? 0x20 : 0x00, rs1p, rs1p, rs2p);
            }
            if (f3 === 5) {                                    // C.J → jal x0, off
                const im = (bit(12) << 11) | (bit(11) << 4) | (((h >> 9) & 3) << 8) | (bit(8) << 10) |
                    (bit(7) << 6) | (bit(6) << 7) | (((h >> 3) & 7) << 1) | (bit(2) << 5);
                return J(0x6f, 0, sx(im, 12));
            }
            if (f3 === 6 || f3 === 7) {                        // C.BEQZ / C.BNEZ → beq/bne rs1', x0, off
                const im = (bit(12) << 8) | (((h >> 10) & 3) << 3) | (((h >> 5) & 3) << 6) | (((h >> 3) & 3) << 1) | (bit(2) << 5);
                return B(0x63, f3 === 6 ? 0 : 1, rs1p, 0, sx(im, 9));
            }
        }
        if (op === 2) {                                        // ── Quadrant 2 ──
            if (f3 === 0) return R(0x13, 1, 0x00, rd, rd, (h >> 2) & 0x1f);                // C.SLLI → slli rd, rd, shamt
            if (f3 === 2) {                                    // C.LWSP → lw rd, off(x2)
                const off = (bit(12) << 5) | (((h >> 4) & 7) << 2) | (((h >> 2) & 3) << 6);
                return rd === 0 ? null : I(0x03, 2, rd, 2, off);
            }
            if (f3 === 4) {
                if (bit(12) === 0) {
                    if (rs2 === 0) return rd === 0 ? null : I(0x67, 0, 0, rd, 0);           // C.JR → jalr x0, rd, 0
                    return R(0x33, 0, 0x00, rd, 0, rs2);                                    // C.MV → add rd, x0, rs2
                }
                if (rs2 === 0) return rd === 0 ? 0x00100073 : I(0x67, 0, 1, rd, 0);         // C.EBREAK / C.JALR
                return R(0x33, 0, 0x00, rd, rd, rs2);                                       // C.ADD → add rd, rd, rs2
            }
            if (f3 === 6) {                                    // C.SWSP → sw rs2, off(x2)
                const off = (((h >> 9) & 0xf) << 2) | (((h >> 7) & 3) << 6);
                return S(0x23, 2, 2, rs2, off);
            }
        }
        return null;                                           // reserved / unsupported
    }

    // ── little-endian memory ────────────────────────────────────────
    /** Find the MMIO device (in `list`) whose range contains address `u`, or null. */
    _dev(list, u) { for (let i = 0; i < list.length; i++) { const d = list[i]; if (u >= d.base && u < d.base + d.size) return d; } return null; }

    /** Absolute address → flat RAM index (subtract the RAM base, wrap to size). */
    _ram(u) { return ((u - this.ramBase) >>> 0) & (this.mem.length - 1); }

    ld8(a)  {
        const u = a >>> 0, d = this.io8.length && this._dev(this.io8, u);
        return d ? (d.load8((u - d.base) >>> 0) & 0xff) : this.mem[this._ram(u)];
    }
    ld16(a) { return this.ld8(a) | (this.ld8(a + 1) << 8); }
    ld32(a) {
        const u = a >>> 0, d = this.io.length && this._dev(this.io, u);
        return d ? (d.load32((u - d.base) >>> 0) >>> 0) : ((this.ld16(a) | (this.ld16(a + 2) << 16)) >>> 0);
    }
    st8(a, v)  {
        const u = a >>> 0, d = this.io8.length && this._dev(this.io8, u);
        if (d) { d.store8((u - d.base) >>> 0, v & 0xff); return; }
        this.mem[this._ram(u)] = v & 0xff;
    }
    st16(a, v) { this.st8(a, v); this.st8(a + 1, v >>> 8); }
    st32(a, v) {
        const u = a >>> 0, d = this.io.length && this._dev(this.io, u);
        if (d) { d.store32((u - d.base) >>> 0, v >>> 0); return; }
        this.st16(a, v); this.st16(a + 2, v >>> 16);
    }

    /** Write a register (x0 discards). Accepts any 32-bit pattern. */
    set(rd, v) { if (rd !== 0) this.x[rd] = v | 0; }

    /**
     * Execute one instruction. Returns the number of instructions retired
     * (1 normally, 0 when halted) so a machine loop can stop on halt.
     */
    step() {
        if (this.halted) return 0;
        // A pending, enabled machine interrupt is taken before the next fetch.
        if (this._takeInterruptIfPending()) { this.instret++; return 1; }
        const pc = this.pc >>> 0;
        // Fetch a halfword first: if its low two bits are not 11 it is a 16-bit
        // compressed (C) instruction — expand it and advance pc by 2; otherwise
        // read the full 32-bit word and advance by 4.
        const lo = this.ld16(pc);
        let inst, ilen;
        if ((lo & 3) !== 3) {
            inst = this._decompress(lo);
            if (inst === null) return this._bad(lo);
            ilen = 2;
        } else {
            inst = (lo | (this.ld16(pc + 2) << 16)) >>> 0;
            ilen = 4;
        }
        const opcode = inst & 0x7f;
        const rd = (inst >>> 7) & 0x1f;
        const funct3 = (inst >>> 12) & 0x7;
        const rs1 = (inst >>> 15) & 0x1f;
        const rs2 = (inst >>> 20) & 0x1f;
        const funct7 = (inst >>> 25) & 0x7f;
        let next = (pc + ilen) >>> 0;
        const a = this.x[rs1] | 0, b = this.x[rs2] | 0;

        switch (opcode) {
            case OPC.LUI:   this.set(rd, inst & 0xfffff000); break;
            case OPC.AUIPC: this.set(rd, (pc + (inst & 0xfffff000)) | 0); break;
            case OPC.JAL: {
                const imm = sext(
                    ((inst >>> 31) & 1) << 20 | ((inst >>> 12) & 0xff) << 12 |
                    ((inst >>> 20) & 1) << 11 | ((inst >>> 21) & 0x3ff) << 1, 21);
                this.set(rd, next | 0);
                next = (pc + imm) >>> 0;
                break;
            }
            case OPC.JALR: {
                const imm = sext(inst >>> 20, 12);
                const t = next;
                next = ((a + imm) & ~1) >>> 0;
                this.set(rd, t | 0);
                break;
            }
            case OPC.BRANCH: {
                const imm = sext(
                    ((inst >>> 31) & 1) << 12 | ((inst >>> 7) & 1) << 11 |
                    ((inst >>> 25) & 0x3f) << 5 | ((inst >>> 8) & 0xf) << 1, 13);
                let take = false;
                switch (funct3) {
                    case 0: take = a === b; break;                       // BEQ
                    case 1: take = a !== b; break;                       // BNE
                    case 4: take = a < b; break;                         // BLT
                    case 5: take = a >= b; break;                        // BGE
                    case 6: take = (a >>> 0) < (b >>> 0); break;         // BLTU
                    case 7: take = (a >>> 0) >= (b >>> 0); break;        // BGEU
                    default: return this._bad(inst);
                }
                if (take) next = (pc + imm) >>> 0;
                break;
            }
            case OPC.LOAD: {
                const addr = (a + sext(inst >>> 20, 12)) >>> 0;
                switch (funct3) {
                    case 0: this.set(rd, sext(this.ld8(addr), 8)); break;   // LB
                    case 1: this.set(rd, sext(this.ld16(addr), 16)); break; // LH
                    case 2: this.set(rd, this.ld32(addr) | 0); break;       // LW
                    case 4: this.set(rd, this.ld8(addr)); break;            // LBU
                    case 5: this.set(rd, this.ld16(addr)); break;           // LHU
                    default: return this._bad(inst);
                }
                break;
            }
            case OPC.STORE: {
                const imm = sext(((inst >>> 25) & 0x7f) << 5 | ((inst >>> 7) & 0x1f), 12);
                const addr = (a + imm) >>> 0;
                switch (funct3) {
                    case 0: this.st8(addr, b); break;    // SB
                    case 1: this.st16(addr, b); break;   // SH
                    case 2: this.st32(addr, b); break;   // SW
                    default: return this._bad(inst);
                }
                break;
            }
            case OPC.OPIMM: {
                const imm = sext(inst >>> 20, 12);
                const shamt = (inst >>> 20) & 0x1f;
                switch (funct3) {
                    case 0: this.set(rd, (a + imm) | 0); break;                 // ADDI
                    case 2: this.set(rd, a < imm ? 1 : 0); break;               // SLTI
                    case 3: this.set(rd, (a >>> 0) < (imm >>> 0) ? 1 : 0); break; // SLTIU
                    case 4: this.set(rd, a ^ imm); break;                       // XORI
                    case 6: this.set(rd, a | imm); break;                       // ORI
                    case 7: this.set(rd, a & imm); break;                       // ANDI
                    case 1: this.set(rd, a << shamt); break;                    // SLLI
                    case 5: this.set(rd, (funct7 & 0x20) ? (a >> shamt) : (a >>> shamt)); break; // SRAI/SRLI
                    default: return this._bad(inst);
                }
                break;
            }
            case OPC.OP: {
                if (funct7 === 0x01) { if (!this._muldiv(rd, funct3, a, b)) return this._bad(inst); break; }
                const shamt = b & 0x1f;
                switch (funct3) {
                    case 0: this.set(rd, (funct7 & 0x20) ? (a - b) | 0 : (a + b) | 0); break; // SUB/ADD
                    case 1: this.set(rd, a << shamt); break;                    // SLL
                    case 2: this.set(rd, a < b ? 1 : 0); break;                 // SLT
                    case 3: this.set(rd, (a >>> 0) < (b >>> 0) ? 1 : 0); break; // SLTU
                    case 4: this.set(rd, a ^ b); break;                         // XOR
                    case 5: this.set(rd, (funct7 & 0x20) ? (a >> shamt) : (a >>> shamt)); break; // SRA/SRL
                    case 6: this.set(rd, a | b); break;                         // OR
                    case 7: this.set(rd, a & b); break;                         // AND
                    default: return this._bad(inst);
                }
                break;
            }
            case OPC.AMO: {
                if (funct3 !== 0x2) return this._bad(inst);   // .W only (RV32A)
                const funct5 = (inst >>> 27) & 0x1f;
                const addr = a >>> 0;                          // rs1 is the address
                if (funct5 === 0x02) {                         // LR.W
                    this.set(rd, this.ld32(addr) | 0);
                    this.resvAddr = addr;
                    break;
                }
                if (funct5 === 0x03) {                         // SC.W
                    if (this.resvAddr === addr) { this.st32(addr, b); this.set(rd, 0); }
                    else this.set(rd, 1);
                    this.resvAddr = -1;
                    break;
                }
                const t = this.ld32(addr) | 0;                 // AMO*: read, op, write-back, return old
                let v;
                switch (funct5) {
                    case 0x01: v = b; break;                                   // AMOSWAP
                    case 0x00: v = (t + b) | 0; break;                         // AMOADD
                    case 0x04: v = t ^ b; break;                              // AMOXOR
                    case 0x0c: v = t & b; break;                              // AMOAND
                    case 0x08: v = t | b; break;                              // AMOOR
                    case 0x10: v = t < b ? t : b; break;                      // AMOMIN
                    case 0x14: v = t > b ? t : b; break;                      // AMOMAX
                    case 0x18: v = (t >>> 0) < (b >>> 0) ? t : b; break;       // AMOMINU
                    case 0x1c: v = (t >>> 0) > (b >>> 0) ? t : b; break;       // AMOMAXU
                    default: return this._bad(inst);
                }
                this.st32(addr, v);
                this.set(rd, t);
                this.resvAddr = -1;
                break;
            }
            case OPC.MISCMEM: break;   // FENCE / FENCE.I — a nop for this model
            case OPC.SYSTEM: {
                const imm = (inst >>> 20) & 0xfff;
                if (funct3 === 0 && imm === 0) {          // ECALL
                    if (this.ecallTraps) {
                        // A real M-mode environment-call exception. pc is still the
                        // ecall instruction, so _trap stashes MEPC = this.pc; the
                        // RTOS handler advances mepc past it (mepc+4) before MRET.
                        this._trap(CAUSE_ECALL_M, false, 0);
                        this.instret++;
                        return 1;
                    }
                    this.pc = next;
                    if (this.hooks.ecall) this.hooks.ecall(this);
                    if (this.halted) return 0;
                    this.instret++;
                    return 1;
                }
                if (funct3 === 0 && imm === 1) {          // EBREAK
                    this.pc = next;
                    if (this.hooks.ebreak) this.hooks.ebreak(this); else this.halted = true;
                    if (this.halted) return 0;
                    this.instret++;
                    return 1;
                }
                if (funct3 === 0 && imm === 0x302) {      // MRET — return from trap
                    const s = this.csr[CSR.MSTATUS];
                    // MIE <- MPIE; MPIE <- 1; MPP <- 0.
                    this.csr[CSR.MSTATUS] = ((s & ~MSTATUS_MIE & ~MSTATUS_MPP) |
                        ((s & MSTATUS_MPIE) ? MSTATUS_MIE : 0) | MSTATUS_MPIE) >>> 0;
                    this.pc = this.csr[CSR.MEPC] >>> 0;
                    this.instret++;
                    return 1;
                }
                if (funct3 === 0 && imm === 0x105) {      // WFI — a hint; nop here
                    this.waiting = true;
                    break;
                }
                // CSR read/modify/write (funct3 1..7): rd <- old CSR; CSR <- new.
                if (funct3 !== 0) {
                    const csrN = imm & 0xfff;
                    const old = this._readCsr(csrN);
                    const src = (funct3 & 0x4) ? rs1 : (a | 0);       // immediate variants use the rs1 FIELD
                    const write = funct3 & 0x3;                        // 1=RW, 2=RS, 3=RC
                    let val;
                    if (write === 1) val = src;                       // CSRRW/I
                    else if (write === 2) val = old | src;            // CSRRS/I (set)
                    else val = old & ~src;                            // CSRRC/I (clear)
                    // CSRRS/CSRRC with a zero source do not write (no side effects).
                    if (!(write !== 1 && ((funct3 & 0x4) ? rs1 : rs1) === 0)) this._writeCsr(csrN, val);
                    this.set(rd, old | 0);
                    break;
                }
                return this._bad(inst);
            }
            default: return this._bad(inst);
        }
        this.pc = next;
        this.instret++;
        return 1;
    }

    /** The M extension (funct7 == 0x01). Returns false on an unknown funct3. */
    _muldiv(rd, funct3, a, b) {
        switch (funct3) {
            case 0: this.set(rd, Math.imul(a, b)); return true;                        // MUL
            case 1: this.set(rd, Number((BigInt(a) * BigInt(b) >> 32n) & 0xffffffffn) | 0); return true; // MULH
            case 2: this.set(rd, Number((BigInt(a) * BigInt(b >>> 0) >> 32n) & 0xffffffffn) | 0); return true; // MULHSU
            case 3: this.set(rd, Number((BigInt(a >>> 0) * BigInt(b >>> 0) >> 32n) & 0xffffffffn) | 0); return true; // MULHU
            case 4: this.set(rd, b === 0 ? -1 : (a === -2147483648 && b === -1 ? a : (a / b) | 0)); return true; // DIV
            case 5: this.set(rd, b === 0 ? -1 : (((a >>> 0) / (b >>> 0)) | 0)); return true;      // DIVU
            case 6: this.set(rd, b === 0 ? a : (a === -2147483648 && b === -1 ? 0 : (a % b) | 0)); return true; // REM
            case 7: this.set(rd, b === 0 ? a : (((a >>> 0) % (b >>> 0)) | 0)); return true;       // REMU
            default: return false;
        }
    }

    _bad(inst) {
        this.halted = true;
        this.trap = { cause: 'illegal-instruction', inst: inst >>> 0, pc: this.pc >>> 0 };
        return 0;
    }
}

/** Machine interrupt line bits for mip/mie, for a device (CLINT) to raise. */
export const INTERRUPT = Object.freeze({MSI: IRQ_MSI, MTI: IRQ_MTI, MEI: IRQ_MEI});

export default RiscV32;
