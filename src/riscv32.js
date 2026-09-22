/**
 * A small RV32IM interpreter — the RISC-V core, in the hand-rolled per-core
 * idiom of z80.js / m6502.js / i8086.js (one instruction per `step()`, a flat
 * little-endian memory, no code generation). Semantics follow the RISC-V
 * unprivileged ISA (rv32i base + the M extension: mul/div/rem); the atomic (A)
 * extension and CSRs are a later increment. ultraembedded's `exactstep` was the
 * reference for the one-step decode shape.
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
    LOAD: 0x03, STORE: 0x23, OPIMM: 0x13, OP: 0x33, MISCMEM: 0x0f, SYSTEM: 0x73
};

/** Sign-extend the low `bits` of `v` to a JS (32-bit) signed int. */
const sext = (v, bits) => (v << (32 - bits)) >> (32 - bits);

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
    }

    reset() {
        this.x.fill(0);
        this.pc = (this.hooks.resetPc ?? 0) >>> 0;
        this.halted = false;
        this.instret = 0;
    }

    // ── little-endian memory ────────────────────────────────────────
    ld8(a)  { return this.mem[a & (this.mem.length - 1)]; }
    ld16(a) { return this.ld8(a) | (this.ld8(a + 1) << 8); }
    ld32(a) { return (this.ld16(a) | (this.ld16(a + 2) << 16)) >>> 0; }
    st8(a, v)  { this.mem[a & (this.mem.length - 1)] = v & 0xff; }
    st16(a, v) { this.st8(a, v); this.st8(a + 1, v >>> 8); }
    st32(a, v) { this.st16(a, v); this.st16(a + 2, v >>> 16); }

    /** Write a register (x0 discards). Accepts any 32-bit pattern. */
    set(rd, v) { if (rd !== 0) this.x[rd] = v | 0; }

    /**
     * Execute one instruction. Returns the number of instructions retired
     * (1 normally, 0 when halted) so a machine loop can stop on halt.
     */
    step() {
        if (this.halted) return 0;
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
                // CSR instructions (funct3 1..7): unimplemented — read as 0.
                if (funct3 !== 0) { this.set(rd, 0); break; }
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

export default RiscV32;
