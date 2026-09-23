/**
 * A small RV32IMA interpreter — the RISC-V core, in the hand-rolled per-core
 * idiom of z80.js / m6502.js / i8086.js (one instruction per `step()`, a flat
 * little-endian memory, no code generation). Semantics follow the RISC-V
 * unprivileged ISA: rv32i base + M (mul/div/rem) + A (LR/SC + AMO*, a single
 * reservation since this is one hart), plus the machine-mode privileged bits an
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

export class RiscV32 {
    /**
     * @param {Uint8Array} mem flat memory the CPU reads/writes (little-endian)
     * @param {{ecall?: (cpu: RiscV32) => void, ebreak?: (cpu: RiscV32) => void,
     *          resetPc?: number}} [hooks]
     */
    constructor(mem, hooks = {}) {
        this.mem = mem;
        this.x = new Int32Array(32);      // x0..x31, x0 stays 0
        this.pc = (hooks.resetPc ?? 0) >>> 0;
        this.hooks = hooks;
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

    // ── little-endian memory ────────────────────────────────────────
    /** Find the MMIO device (in `list`) whose range contains address `u`, or null. */
    _dev(list, u) { for (let i = 0; i < list.length; i++) { const d = list[i]; if (u >= d.base && u < d.base + d.size) return d; } return null; }

    ld8(a)  {
        const u = a >>> 0, d = this.io8.length && this._dev(this.io8, u);
        return d ? (d.load8((u - d.base) >>> 0) & 0xff) : this.mem[a & (this.mem.length - 1)];
    }
    ld16(a) { return this.ld8(a) | (this.ld8(a + 1) << 8); }
    ld32(a) {
        const u = a >>> 0, d = this.io.length && this._dev(this.io, u);
        return d ? (d.load32((u - d.base) >>> 0) >>> 0) : ((this.ld16(a) | (this.ld16(a + 2) << 16)) >>> 0);
    }
    st8(a, v)  {
        const u = a >>> 0, d = this.io8.length && this._dev(this.io8, u);
        if (d) { d.store8((u - d.base) >>> 0, v & 0xff); return; }
        this.mem[a & (this.mem.length - 1)] = v & 0xff;
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
        const inst = this.ld32(pc);
        const opcode = inst & 0x7f;
        const rd = (inst >>> 7) & 0x1f;
        const funct3 = (inst >>> 12) & 0x7;
        const rs1 = (inst >>> 15) & 0x1f;
        const rs2 = (inst >>> 20) & 0x1f;
        const funct7 = (inst >>> 25) & 0x7f;
        let next = (pc + 4) >>> 0;
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
