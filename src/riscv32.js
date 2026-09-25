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
 * the timer/software lines through `setInterruptPending`. It also has S-mode: the
 * three privilege levels (M/S/U), trap delegation (medeleg/mideleg → stvec), the
 * S trap CSRs (sstatus/sie/sip/stvec/sepc/scause/stval/satp) as masked views of
 * their M counterparts, SRET, and an SBI firmware hook for supervisor ecalls — so
 * a supervisor kernel runs, and Sv32 paging: satp switches on a two-level
 * page-table walk (`_translate`) applied to every fetch/load/store when the
 * effective privilege is S or U — 4 KiB pages and 4 MiB superpages, R/W/X + U +
 * SUM/MXR checks, A/D updates, and instruction/load/store page faults. M-mode
 * and satp=Bare are an identity map. exactstep was the one-step decode reference.
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

// Privileged CSRs — M-mode plus the S-mode subset a supervisor kernel (xv6,
// Linux) needs: trap delegation (medeleg/mideleg), the S trap CSRs, and satp.
const CSR = {
    MSTATUS: 0x300, MISA: 0x301, MEDELEG: 0x302, MIDELEG: 0x303, MIE: 0x304, MTVEC: 0x305,
    MCOUNTEREN: 0x306, MENVCFG: 0x30a, MSTATUSH: 0x310, MENVCFGH: 0x31a, MCOUNTINHIBIT: 0x320,
    MSCRATCH: 0x340, MEPC: 0x341, MCAUSE: 0x342, MTVAL: 0x343, MIP: 0x344,
    SSTATUS: 0x100, SIE: 0x104, STVEC: 0x105, SCOUNTEREN: 0x106, SENVCFG: 0x10a,
    SSCRATCH: 0x140, SEPC: 0x141, SCAUSE: 0x142, STVAL: 0x143, SIP: 0x144,
    STIMECMP: 0x14d, STIMECMPH: 0x15d, SATP: 0x180,
    TSELECT: 0x7a0, TDATA1: 0x7a1, TDATA2: 0x7a2, TDATA3: 0x7a3,
    MVENDORID: 0xf11, MARCHID: 0xf12, MIMPID: 0xf13, MHARTID: 0xf14, MCONFIGPTR: 0xf15,
    MCYCLE: 0xb00, MINSTRET: 0xb02, MCYCLEH: 0xb80, MINSTRETH: 0xb82,
    CYCLE: 0xc00, TIME: 0xc01, INSTRET: 0xc02, CYCLEH: 0xc80, TIMEH: 0xc81, INSTRETH: 0xc82
};

// Which CSR numbers exist on this hart. Any other number is an illegal
// instruction (as is a privilege or read-only violation) — the behaviour the
// privileged spec requires and Spike (the oracle) implements.
const CSR_EXISTS = new Uint8Array(4096);
for (const n of Object.values(CSR)) CSR_EXISTS[n] = 1;
for (let i = 0; i < 4; i++) CSR_EXISTS[0x3a0 + i] = 1;                  // pmpcfg0..3
for (let i = 0; i < 16; i++) CSR_EXISTS[0x3b0 + i] = 1;                 // pmpaddr0..15
for (let i = 3; i < 32; i++) {                                           // hpm counters/events: read-only 0
    CSR_EXISTS[0xb00 + i] = CSR_EXISTS[0xb80 + i] = 1;
    CSR_EXISTS[0xc00 + i] = CSR_EXISTS[0xc80 + i] = 1;
    CSR_EXISTS[0x320 + i] = 1;
}
CSR_EXISTS[CSR.STIMECMP] = CSR_EXISTS[CSR.STIMECMPH] = 0;               // Sstc: not implemented (yet)
// The delegatable synchronous exceptions (Spike's medeleg mask for a hart with
// C, an MMU and Zicntr): everything except misaligned fetch (C makes it
// impossible), ecall-from-M (11) and the reserved causes.
const MEDELEG_MASK = (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5) | (1 << 6) | (1 << 7) |
    (1 << 8) | (1 << 9) | (1 << 12) | (1 << 13) | (1 << 15) | (1 << 19);
// Privilege levels.
const PRIV_U = 0, PRIV_S = 1, PRIV_M = 3;
// mstatus/sstatus fields. M: MIE/MPIE/MPP. S: SIE/SPIE/SPP (SPP is a single bit).
const MSTATUS_MIE = 1 << 3, MSTATUS_MPIE = 1 << 7, MSTATUS_MPP = 3 << 11;
const MSTATUS_SIE = 1 << 1, MSTATUS_SPIE = 1 << 5, MSTATUS_SPP = 1 << 8;
// The sstatus view of mstatus (S-mode sees only these bits).
const SSTATUS_MASK = (MSTATUS_SIE | MSTATUS_SPIE | MSTATUS_SPP | (1 << 18) /*SUM*/ | (1 << 19) /*MXR*/ | (0x3 << 13) /*FS*/);
// menvcfg.ADUE (bit 61 → menvcfgh bit 29): hardware A/D updates (Svadu).
const MENVCFGH_ADUE = 1 << 29;
const MSTATUS_TVM = 1 << 20, MSTATUS_TW = 1 << 21, MSTATUS_TSR = 1 << 22;
// Writable mstatus bits: the M and S mode/interrupt bits, MPRV/SUM/MXR, FS
// (writable because S-mode exists, as in Spike), and the TVM/TW/TSR traps.
const MSTATUS_WMASK = (MSTATUS_MIE | MSTATUS_MPIE | MSTATUS_MPP | MSTATUS_SIE | MSTATUS_SPIE |
    MSTATUS_SPP | (1 << 17) /*MPRV*/ | (1 << 18) /*SUM*/ | (1 << 19) /*MXR*/ | (0x3 << 13) /*FS*/ |
    MSTATUS_TVM | MSTATUS_TW | MSTATUS_TSR);
// mie/mip interrupt bits: machine software/timer/external (3/7/11),
// supervisor software/timer/external (1/5/9).
const IRQ_MSI = 1 << 3, IRQ_MTI = 1 << 7, IRQ_MEI = 1 << 11;
const IRQ_SSI = 1 << 1, IRQ_STI = 1 << 5, IRQ_SEI = 1 << 9;
// Interrupt causes (with the high bit set in mcause).
const CAUSE_MSI = 3, CAUSE_MTI = 7, CAUSE_MEI = 11;
// Synchronous exception causes: environment call from U/S/M mode.
const CAUSE_ECALL_U = 8, CAUSE_ECALL_S = 9, CAUSE_ECALL_M = 11;
const CAUSE_ILLEGAL = 2, CAUSE_BREAKPOINT = 3;
const CAUSE_FETCH_ACCESS = 1, CAUSE_LOAD_ACCESS = 5, CAUSE_STORE_ACCESS = 7;
// Thrown by the physical accessors for an address no RAM or device claims.
const ACCESS_FAULT = Object.freeze({accessFault: true});
// Sv32 page-fault causes: instruction / load / store-or-AMO.
const CAUSE_FETCH_PF = 12, CAUSE_LOAD_PF = 13, CAUSE_STORE_PF = 15;

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
        // EBREAK likewise: with no debugger hook it halts the machine (how the
        // bare test programs stop) unless this is set, when it is the
        // architectural breakpoint exception (cause 3) an OS kernel expects —
        // Linux's BUG()/WARN() are ebreaks. Defaults to follow ecallTraps.
        this.ebreakTraps = hooks.ebreakTraps ?? this.ecallTraps;
        // Base physical address of RAM. `mem` is a flat 0-based array, so an
        // address is translated to a RAM index by subtracting this. Default 0
        // (RAM at 0x0, as before). Set to 0x80000000 to run images linked at the
        // standard riscv `virt` RAM base (Zephyr's qemu_riscv32, xv6, Linux). The
        // MMIO devices (CLINT/PLIC/UART) sit below it and are routed by absolute
        // address before RAM, so they are unaffected.
        this.ramBase = (hooks.ramBase ?? 0) >>> 0;
        // Address decoding. Mirrored (the default for the legacy RAM-at-0 map):
        // RAM repeats across the whole physical space, so a bare program that
        // starts with sp = 0 and pushes to 0xfffffffc lands at the top of RAM.
        // Not mirrored (the default once RAM sits at a base, the riscv `virt`
        // layout Linux/xv6 use): an address no RAM or device claims is an
        // access fault, as on Spike/QEMU.
        this.ramMirror = hooks.ramMirror ?? (this.ramBase === 0);
        this.halted = false;
        this.instret = 0;                 // instructions retired
        this.resvAddr = -1;               // LR/SC reservation (address, or -1)
        this.csr = new Uint32Array(4096); // M/S CSR file
        this.priv = PRIV_M;               // current privilege (M at reset)
        this.waiting = false;             // parked on WFI until an interrupt
        // A supervisor environment-call (SBI) hook: an S-mode kernel calls the
        // firmware via ecall; the machine services it (console/timer) like the
        // M-mode ecall hook. Injected by the machine when it acts as SBI firmware.
        this.sbi = hooks.sbi || null;
        // MMIO device lists: word devices {base,size,load32,store32} (CLINT,
        // PLIC) routed by ld32/st32; byte devices {base,size,load8,store8}
        // (UART) routed by ld8/st8. Accepts a single device or an array.
        this.io = [].concat(hooks.io || []);
        this.io8 = [].concat(hooks.io8 || []);
        // Fast RAM paths: halfword/word views over the same buffer (aligned
        // accesses on a little-endian host), and a map of the 4 KiB RAM pages a
        // device overlaps (those keep the device-routing slow path). The map is
        // rebuilt whenever a device list changes length (checked per step).
        this._memLen = mem.length;
        const le = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
        const aligned = (mem.byteOffset & 3) === 0;
        this._m16 = le && aligned ? new Uint16Array(mem.buffer, mem.byteOffset, mem.length >>> 1) : null;
        this._m32 = le && aligned ? new Int32Array(mem.buffer, mem.byteOffset, mem.length >>> 2) : null;
        this._devPage = new Uint8Array(Math.ceil(mem.length / 4096) + 1);
        this._devCount = -1;
        this._scanDevices();
        // Zicntr: the `time` CSR reads this source (the machine wires the CLINT's
        // mtime); without one it follows the cycle count.
        this.timeSource = hooks.timeSource || null;
        this._resetCounters();
    }

    _resetCounters() {
        // Architectural retired-instruction count = steps retired minus traps
        // taken (a trapping step bumps `instret` but retires nothing). mcycle and
        // minstret are that count plus a 64-bit offset (BigInt: CSR access only).
        this._traps = 0;
        this._cycleOff = 0n;
        this._instretOff = 0n;
    }

    /** Instructions architecturally retired (what minstret counts from reset). */
    get retired() { return this.instret - this._traps; }

    reset() {
        this.x.fill(0);
        this.pc = (this.hooks.resetPc ?? 0) >>> 0;
        this.halted = false;
        this.instret = 0;
        this.resvAddr = -1;
        this.csr.fill(0);
        this.priv = PRIV_M;
        this.waiting = false;
        this._resetCounters();
    }

    /** Raise (level-set) a machine interrupt line in mip — called by a device
     *  (the CLINT) so software sees mip.MTIP / MSIP / MEIP. `on` clears it. */
    setInterruptPending(bit, on) {
        if (on) this.csr[CSR.MIP] |= bit; else this.csr[CSR.MIP] &= ~bit;
    }

    /** A 64-bit counter's current value: `retired` plus its offset, mod 2^64. */
    _counter(off) { return (BigInt(this.retired) + off) & 0xffffffffffffffffn; }

    /** Write half of a 64-bit counter. The written value is what the NEXT
     *  instruction reads (the CSR write suppresses this instruction's own
     *  increment), so the offset is taken against retired + 1. */
    _counterWrite(off, v, high) {
        const cur = this._counter(off);
        const nv = high ? ((BigInt(v >>> 0) << 32n) | (cur & 0xffffffffn))
            : ((cur & 0xffffffff00000000n) | BigInt(v >>> 0));
        return (nv - BigInt(this.retired + 1)) & 0xffffffffffffffffn;
    }

    /** The `time` CSR: the machine's timer (CLINT mtime) or, without one, cycles. */
    _time() { return this.timeSource ? this.timeSource() : Number(this._counter(this._cycleOff)); }

    /** Is CSR `n` accessible from the current privilege (and, for `write`,
     *  writable)? False is an illegal-instruction exception. Checks existence,
     *  the privilege encoded in csr[9:8], read-only csr[11:10]=3, the counter
     *  enables (mcounteren / scounteren), and mstatus.TVM for satp. */
    _csrOk(n, write) {
        if (!CSR_EXISTS[n]) return false;
        if (this.priv < ((n >>> 8) & 3)) return false;
        if (write && (n >>> 10) === 3) return false;
        if ((n >= 0xc00 && n <= 0xc1f) || (n >= 0xc80 && n <= 0xc9f)) {   // user counters
            const bit = 1 << (n & 0x1f);
            if (this.priv < PRIV_M && !(this.csr[CSR.MCOUNTEREN] & bit)) return false;
            if (this.priv < PRIV_S && !(this.csr[CSR.SCOUNTEREN] & bit)) return false;
        }
        if (n === CSR.SATP && this.priv === PRIV_S && (this.csr[CSR.MSTATUS] & MSTATUS_TVM)) return false;
        return true;
    }

    /** Read a CSR. The S-mode status/interrupt CSRs are masked views of the
     *  M-mode registers (sstatus⊂mstatus; sie/sip = mie/mip restricted by mideleg). */
    _readCsr(n) {
        switch (n) {
            case CSR.MHARTID: case CSR.MVENDORID: case CSR.MARCHID: case CSR.MIMPID: case CSR.MCONFIGPTR:
            case CSR.TSELECT: case CSR.TDATA1: case CSR.TDATA2: case CSR.TDATA3: case CSR.MCOUNTINHIBIT:
            case CSR.MSTATUSH:
                return 0;
            case CSR.MISA: return 0x40141105 >>> 0;          // RV32 + A,C,I,M,S,U (MXL=1)
            case CSR.MSTATUS: {                               // SD summarises FS == dirty
                const v = this.csr[CSR.MSTATUS];
                return (((v >>> 13) & 3) === 3 ? (v | 0x80000000) : v) >>> 0;
            }
            case CSR.SSTATUS: {
                const v = this.csr[CSR.MSTATUS];
                return ((v & SSTATUS_MASK) | (((v >>> 13) & 3) === 3 ? 0x80000000 : 0)) >>> 0;
            }
            case CSR.SIE: return (this.csr[CSR.MIE] & this.csr[CSR.MIDELEG]) >>> 0;
            case CSR.SIP: return (this.csr[CSR.MIP] & this.csr[CSR.MIDELEG]) >>> 0;
            case CSR.MCYCLE: case CSR.CYCLE: return Number(this._counter(this._cycleOff) & 0xffffffffn);
            case CSR.MCYCLEH: case CSR.CYCLEH: return Number(this._counter(this._cycleOff) >> 32n);
            case CSR.MINSTRET: case CSR.INSTRET: return Number(this._counter(this._instretOff) & 0xffffffffn);
            case CSR.MINSTRETH: case CSR.INSTRETH: return Number(this._counter(this._instretOff) >> 32n);
            case CSR.TIME: return this._time() % 0x100000000;
            case CSR.TIMEH: return Math.floor(this._time() / 0x100000000) >>> 0;
            default:
                if ((n >= 0xb03 && n <= 0xb1f) || (n >= 0xb83 && n <= 0xb9f) ||
                    (n >= 0xc03 && n <= 0xc1f) || (n >= 0xc83 && n <= 0xc9f) ||
                    (n >= 0x323 && n <= 0x33f)) return 0;       // hpm counters/events: hardwired 0
                return this.csr[n] >>> 0;
        }
    }

    /** Write a CSR with the WARL masks M/S mode need (Spike's, where they differ). */
    _writeCsr(n, v) {
        v >>>= 0;
        switch (n) {
            case CSR.MSTATUS: {
                if (((v >>> 11) & 3) === 2) v &= ~MSTATUS_MPP;          // reserved MPP legalises to U
                this.csr[n] = v & MSTATUS_WMASK;
                return;
            }
            case CSR.SSTATUS:                                         // S-view: only the S bits of mstatus
                this.csr[CSR.MSTATUS] = ((this.csr[CSR.MSTATUS] & ~SSTATUS_MASK) | (v & SSTATUS_MASK)) >>> 0;
                return;
            case CSR.MIP: {
                // M-mode may write the supervisor lines (SSIP/STIP/SEIP) — how
                // firmware forwards a timer to S-mode. The machine lines are
                // owned by devices (CLINT/PLIC), read-only here.
                const w = IRQ_SSI | IRQ_STI | IRQ_SEI;
                this.csr[n] = ((this.csr[n] & ~w) | (v & w)) >>> 0;
                return;
            }
            case CSR.MIE: this.csr[n] = v & 0xaaa; return;
            case CSR.SIE: {                                           // S-view of mie, gated by mideleg
                const d = this.csr[CSR.MIDELEG];
                this.csr[CSR.MIE] = ((this.csr[CSR.MIE] & ~d) | (v & d)) >>> 0;
                return;
            }
            case CSR.SIP: {                                           // S may set SSIP (if delegated)
                const w = IRQ_SSI & this.csr[CSR.MIDELEG];
                this.csr[CSR.MIP] = ((this.csr[CSR.MIP] & ~w) | (v & w)) >>> 0;
                return;
            }
            // Direct (0) and vectored (1) modes; mode 2/3 are reserved.
            case CSR.MTVEC: case CSR.STVEC: this.csr[n] = (v & ~2) >>> 0; return;
            case CSR.MEPC: case CSR.SEPC: this.csr[n] = (v & ~1) >>> 0; return;   // IALIGN=16 (C)
            // Only the S-mode interrupts (software/timer/external) are delegatable;
            // the machine interrupts (bits 3/7/11) are hardwired 0 in mideleg, so an
            // over-broad write (xv6 sets 0xffff) must not delegate the machine timer.
            case CSR.MIDELEG: this.csr[n] = v & (IRQ_SSI | IRQ_STI | IRQ_SEI); return;
            case CSR.MEDELEG: this.csr[n] = v & MEDELEG_MASK; return;
            case CSR.MCYCLE: this._cycleOff = this._counterWrite(this._cycleOff, v, false); return;
            case CSR.MCYCLEH: this._cycleOff = this._counterWrite(this._cycleOff, v, true); return;
            case CSR.MINSTRET: this._instretOff = this._counterWrite(this._instretOff, v, false); return;
            case CSR.MINSTRETH: this._instretOff = this._counterWrite(this._instretOff, v, true); return;
            case CSR.MENVCFG: this.csr[n] = v & ((1 << 0) /*FIOM*/); return;
            case CSR.MENVCFGH: this.csr[n] = v & MENVCFGH_ADUE; return;
            case CSR.SENVCFG: this.csr[n] = v & 1; return;
            case CSR.SATP: this.csr[n] = v; return;
            case CSR.MSCRATCH: case CSR.MCAUSE: case CSR.MTVAL: case CSR.SSCRATCH: case CSR.SCAUSE:
            case CSR.STVAL: case CSR.MCOUNTEREN: case CSR.SCOUNTEREN:
                this.csr[n] = v; return;
            default:
                if ((n >= 0x3a0 && n <= 0x3a3) || (n >= 0x3b0 && n <= 0x3bf)) { this.csr[n] = v; return; }  // PMP (stored, not enforced)
                return;                                                // read-only / hardwired: ignore
        }
    }

    /** Enter a trap. Routed to S-mode when the cause is delegated (medeleg for
     *  exceptions, mideleg for interrupts) and the current privilege is ≤ S;
     *  otherwise to M-mode. Stashes the return pc/cause/tval, records and lowers
     *  the interrupt-enable, sets the previous privilege, and jumps to the vector. */
    _trap(cause, isInterrupt, tval) {
        this._traps++;                                   // the trapping step retires nothing
        const deleg = isInterrupt ? this.csr[CSR.MIDELEG] : this.csr[CSR.MEDELEG];
        const toS = this.priv <= PRIV_S && (deleg & (1 << cause)) !== 0;
        const causeWord = ((isInterrupt ? 0x80000000 : 0) | cause) >>> 0;
        const s = this.csr[CSR.MSTATUS];
        if (toS) {
            this.csr[CSR.SEPC] = this.pc >>> 0;
            this.csr[CSR.SCAUSE] = causeWord;
            this.csr[CSR.STVAL] = (tval || 0) >>> 0;
            // SPIE <- SIE; SIE <- 0; SPP <- (came from S ? 1 : 0).
            let ns = s & ~MSTATUS_SPIE & ~MSTATUS_SIE & ~MSTATUS_SPP;
            if (s & MSTATUS_SIE) ns |= MSTATUS_SPIE;
            if (this.priv === PRIV_S) ns |= MSTATUS_SPP;
            this.csr[CSR.MSTATUS] = ns >>> 0;
            this.priv = PRIV_S;
            const tv = this.csr[CSR.STVEC];                            // vectored: interrupts to base + 4*cause
            this.pc = ((tv & ~3) + ((tv & 1) && isInterrupt ? 4 * cause : 0)) >>> 0;
        } else {
            this.csr[CSR.MEPC] = this.pc >>> 0;
            this.csr[CSR.MCAUSE] = causeWord;
            this.csr[CSR.MTVAL] = (tval || 0) >>> 0;
            // MPIE <- MIE; MIE <- 0; MPP <- the privilege we came from.
            let ns = s & ~MSTATUS_MPIE & ~MSTATUS_MIE & ~MSTATUS_MPP;
            if (s & MSTATUS_MIE) ns |= MSTATUS_MPIE;
            ns |= (this.priv << 11) & MSTATUS_MPP;
            this.csr[CSR.MSTATUS] = ns >>> 0;
            this.priv = PRIV_M;
            const tv = this.csr[CSR.MTVEC];
            this.pc = ((tv & ~3) + ((tv & 1) && isInterrupt ? 4 * cause : 0)) >>> 0;
        }
        this.waiting = false;
    }

    /** If an enabled interrupt is pending, take it (highest priority first).
     *  A delegated interrupt (mideleg) targets S-mode and is gated by the S-mode
     *  rules (taken when priv<S, or priv==S with sstatus.SIE); an M interrupt by
     *  the M rules. Returns true if a trap was entered. */
    _takeInterruptIfPending() {
        const pend = this.csr[CSR.MIP] & this.csr[CSR.MIE];
        if (!pend) return false;
        const md = this.csr[CSR.MIDELEG], ms = this.csr[CSR.MSTATUS];
        // Spec default priority: MEI, MSI, MTI, SEI, SSI, STI.
        const order = [[IRQ_MEI, CAUSE_MEI], [IRQ_MSI, CAUSE_MSI], [IRQ_MTI, CAUSE_MTI],
            [IRQ_SEI, 9], [IRQ_SSI, 1], [IRQ_STI, 5]];
        for (const [bit, cause] of order) {
            if (!(pend & bit)) continue;
            const toS = (md & bit) !== 0;
            const enabled = toS
                ? (this.priv < PRIV_S || (this.priv === PRIV_S && (ms & MSTATUS_SIE)))
                : (this.priv < PRIV_M || (this.priv === PRIV_M && (ms & MSTATUS_MIE)));
            if (enabled) { this._trap(cause, true, 0); return true; }
        }
        return false;
    }

    // ── Sv32 address translation ────────────────────────────────────
    /** Effective privilege for an access — MPRV redirects loads/stores (not the
     *  instruction fetch) to the previous privilege in mstatus.MPP. */
    _effPriv(access) {
        if (access !== 'fetch' && (this.csr[CSR.MSTATUS] & (1 << 17)))
            return (this.csr[CSR.MSTATUS] & MSTATUS_MPP) >>> 11;
        return this.priv;
    }

    /** Translate a virtual address via an Sv32 two-level page-table walk. Returns
     *  the physical address, or null after raising the appropriate page fault.
     *  Paging applies only when satp.MODE = Sv32 and the effective privilege is S
     *  or U; M-mode and MODE=Bare are an identity map. `access` ∈ fetch|load|store.
     *  The walk reads/writes PTEs through the physical ld32/st32 (no recursion),
     *  handles 4 KiB pages and 4 MiB superpages, checks R/W/X + U/SUM/MXR, and
     *  sets the A (and, on a store, D) bits. */
    _translate(va, access) {
        va >>>= 0;
        const satp = this.csr[CSR.SATP] >>> 0;
        const eff = this._effPriv(access);
        if ((satp >>> 31) === 0 || eff > PRIV_S) return va;          // Bare / M-mode: identity
        const cause = access === 'fetch' ? CAUSE_FETCH_PF : access === 'store' ? CAUSE_STORE_PF : CAUSE_LOAD_PF;
        const fault = () => { this._trap(cause, false, va); return null; };
        const vpn1 = (va >>> 22) & 0x3ff, vpn0 = (va >>> 12) & 0x3ff, off = va & 0xfff;
        const isLeaf = p => (p & 0xa) !== 0;                         // R or X set
        const bad = p => !(p & 1) || ((p & 0x4) && !(p & 0x2));      // V=0, or W without R (reserved)
        // Level 1.
        let pteAddr = ((satp & 0x3fffff) * 4096 + vpn1 * 4) >>> 0;
        let pte = this.ld32(pteAddr) >>> 0;
        let phys;
        if (bad(pte)) return fault();
        if (isLeaf(pte)) {
            if (((pte >>> 10) & 0x3ff) !== 0) return fault();        // misaligned superpage (PPN[0] must be 0)
            phys = (((pte >>> 20) & 0xfff) * 0x400000 + (va & 0x3fffff)) >>> 0;   // 4 MiB superpage
        } else {                                                     // pointer → level 0
            pteAddr = (((pte >>> 10) & 0x3fffff) * 4096 + vpn0 * 4) >>> 0;
            pte = this.ld32(pteAddr) >>> 0;
            if (bad(pte) || !isLeaf(pte)) return fault();            // must be a leaf at level 0
            phys = (((pte >>> 10) & 0x3fffff) * 4096 + off) >>> 0;
        }
        // Permission + privilege checks on the leaf PTE.
        const R = pte & 2, W = pte & 4, X = pte & 8, Uf = pte & 0x10;
        const ms = this.csr[CSR.MSTATUS];
        const permit = access === 'fetch' ? X : access === 'store' ? W : (R || (X && (ms & (1 << 19)))); // MXR
        if (!permit) return fault();
        if (eff === PRIV_U && !Uf) return fault();
        // S-mode may not touch a U-page — SUM lifts that for loads/stores, but
        // never for an instruction fetch (S can never execute a user page).
        if (eff === PRIV_S && Uf && !(access !== 'fetch' && (ms & (1 << 18)))) return fault();
        // Accessed / Dirty. Svadu: with menvcfg.ADUE set the hardware updates
        // them; clear (the reset value, as Spike), a leaf whose A — or, for a
        // store, D — is clear is a page fault (Svade) and software sets them.
        const np = (pte | 0x40 | (access === 'store' ? 0x80 : 0)) >>> 0;
        if (np !== pte) {
            if (!(this.csr[CSR.MENVCFGH] & MENVCFGH_ADUE)) return fault();
            this.st32(pteAddr, np);
        }
        return phys;
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

    /** Rebuild the map of RAM pages that a device overlaps (see constructor).
     *  Without the typed views every page is marked, so all accesses route
     *  through the byte-wise slow path. */
    _scanDevices() {
        const n = this.io.length + this.io8.length;
        if (n === this._devCount) return;
        this._devCount = n;
        const map = this._devPage;
        map.fill(this._m32 ? 0 : 1);
        for (const d of this.io.concat(this.io8)) {
            const lo = ((d.base - this.ramBase) >>> 0), hi = lo + d.size;
            if (lo >= this._memLen && ((d.base >>> 0) >= this.ramBase)) continue;   // entirely above RAM
            for (let pg = Math.floor(Math.min(lo, this._memLen) / 4096); pg * 4096 < Math.min(hi, this._memLen); pg++) map[pg] = 1;
        }
    }

    /** Absolute address → flat RAM index (subtract the RAM base). An address
     *  outside RAM (and not claimed by a device) is an access fault: thrown
     *  here, turned into the architectural exception by step(). */
    _ram(u) {
        const i = (u - this.ramBase) >>> 0;
        if (i < this.mem.length) return i;
        if (this.ramMirror) return i & (this.mem.length - 1);
        throw ACCESS_FAULT;
    }

    // Each accessor first tries the fast path — the address is in RAM, on a
    // page no device overlaps, and (for 16/32 bits) naturally aligned — and
    // otherwise takes the device-routing byte path, which is the reference.
    ld8(a) {
        const u = a >>> 0, i = (u - this.ramBase) >>> 0;
        if (i < this._memLen && this._devPage[i >>> 12] === 0) return this.mem[i];
        const d = this.io8.length && this._dev(this.io8, u);
        return d ? (d.load8((u - d.base) >>> 0) & 0xff) : this.mem[this._ram(u)];
    }
    ld16(a) {
        const u = a >>> 0, i = (u - this.ramBase) >>> 0;
        if ((i & 1) === 0 && i < this._memLen && this._devPage[i >>> 12] === 0) return this._m16[i >>> 1];
        return this.ld8(u) | (this.ld8(u + 1) << 8);
    }
    ld32(a) {
        const u = a >>> 0, i = (u - this.ramBase) >>> 0;
        if ((i & 3) === 0 && i < this._memLen && this._devPage[i >>> 12] === 0) return this._m32[i >>> 2] >>> 0;
        const d = this.io.length && this._dev(this.io, u);
        return d ? (d.load32((u - d.base) >>> 0) >>> 0) : ((this.ld16(u) | (this.ld16(u + 2) << 16)) >>> 0);
    }
    st8(a, v) {
        const u = a >>> 0, i = (u - this.ramBase) >>> 0;
        if (i < this._memLen && this._devPage[i >>> 12] === 0) { this.mem[i] = v; return; }
        const d = this.io8.length && this._dev(this.io8, u);
        if (d) { d.store8((u - d.base) >>> 0, v & 0xff); return; }
        this.mem[this._ram(u)] = v & 0xff;
    }
    st16(a, v) {
        const u = a >>> 0, i = (u - this.ramBase) >>> 0;
        if ((i & 1) === 0 && i < this._memLen && this._devPage[i >>> 12] === 0) { this._m16[i >>> 1] = v; return; }
        this.st8(u, v); this.st8(u + 1, v >>> 8);
    }
    st32(a, v) {
        const u = a >>> 0, i = (u - this.ramBase) >>> 0;
        if ((i & 3) === 0 && i < this._memLen && this._devPage[i >>> 12] === 0) { this._m32[i >>> 2] = v; return; }
        const d = this.io.length && this._dev(this.io, u);
        if (d) { d.store32((u - d.base) >>> 0, v >>> 0); return; }
        this.st16(u, v); this.st16(u + 2, v >>> 16);
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
        try {
            return this._exec();
        } catch (e) {
            if (e !== ACCESS_FAULT) throw e;
            return this._accessFault();
        }
    }

    /** A physical access outside RAM and every device: the access-fault
     *  exception for the access in flight (fetch 1 / load 5 / store-AMO 7,
     *  tval = its virtual address). With no trap vector installed it halts
     *  and records what it hit, as an illegal instruction does. */
    _accessFault() {
        if (this.csr[CSR.MTVEC] !== 0) {
            this._trap(this._acc, false, this._va);
            this.instret++;
            return 1;
        }
        this.halted = true;
        this.trap = {cause: 'access-fault', addr: this._va >>> 0, pc: this.pc >>> 0};
        return 0;
    }

    _exec() {
        if (this.io.length + this.io8.length !== this._devCount) this._scanDevices();
        const pc = this.pc >>> 0;
        this._acc = CAUSE_FETCH_ACCESS; this._va = pc;
        // Translate then fetch. A halfword first: low two bits != 11 → a 16-bit
        // compressed (C) instruction, expanded and pc += 2; else the full 32-bit
        // word, pc += 4. The high half of a 32-bit instruction at an odd page
        // offset lands in the next page, so it is translated separately.
        // Paging off (satp.MODE = Bare) or M-mode: fetch is untranslated.
        const pcPhys = ((this.csr[CSR.SATP] & 0x80000000) === 0 || this.priv === PRIV_M) ? pc : this._translate(pc, 'fetch');
        if (pcPhys === null) { this.instret++; return 1; }   // instruction page fault taken
        const lo = this.ld16(pcPhys);
        let inst, ilen;
        if ((lo & 3) !== 3) {
            inst = this._decompress(lo);
            if (inst === null) return this._bad(lo);
            ilen = 2;
        } else {
            let hiPhys;
            if ((pc & 0xfff) === 0xffe) {                     // high half crosses into the next page
                hiPhys = this._translate((pc + 2) >>> 0, 'fetch');
                if (hiPhys === null) { this.instret++; return 1; }
            } else {
                hiPhys = (pcPhys + 2) >>> 0;
            }
            inst = (lo | (this.ld16(hiPhys) << 16)) >>> 0;
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
                if (funct3 !== 0) return this._bad(inst);
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
                const va = (a + sext(inst >>> 20, 12)) >>> 0;
                this._acc = CAUSE_LOAD_ACCESS; this._va = va;
                const addr = this._translate(va, 'load');
                if (addr === null) { this.instret++; return 1; }        // load page fault taken
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
                const va = (a + imm) >>> 0;
                this._acc = CAUSE_STORE_ACCESS; this._va = va;
                const addr = this._translate(va, 'store');
                if (addr === null) { this.instret++; return 1; }        // store page fault taken
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
                    case 1:                                                     // SLLI (shamt[5]=1 is illegal on RV32)
                        if (funct7 !== 0) return this._bad(inst);
                        this.set(rd, a << shamt); break;
                    case 5:                                                     // SRAI/SRLI
                        if ((funct7 & ~0x20) !== 0) return this._bad(inst);
                        this.set(rd, (funct7 & 0x20) ? (a >> shamt) : (a >>> shamt)); break;
                    default: return this._bad(inst);
                }
                break;
            }
            case OPC.OP: {
                if (funct7 === 0x01) { if (!this._muldiv(rd, funct3, a, b)) return this._bad(inst); break; }
                // funct7 is 0, or 0x20 for SUB/SRA only; anything else is illegal.
                if (funct7 !== 0 && !(funct7 === 0x20 && (funct3 === 0 || funct3 === 5))) return this._bad(inst);
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
                this._acc = funct5 === 0x02 ? CAUSE_LOAD_ACCESS : CAUSE_STORE_ACCESS; this._va = a >>> 0;
                // A misaligned LR/SC/AMO is an access fault (Zicclsm covers only
                // plain loads/stores; misaligned atomics are not emulated).
                if (a & 3) throw ACCESS_FAULT;
                const addr = this._translate(a >>> 0, funct5 === 0x02 ? 'load' : 'store'); // rs1 is the address
                if (addr === null) { this.instret++; return 1; }   // page fault taken
                if (funct5 === 0x02) {                         // LR.W
                    if (rs2 !== 0) return this._bad(inst);
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
                break;                                         // an AMO leaves the reservation (as Spike)
            }
            case OPC.MISCMEM:          // FENCE / FENCE.I — a nop for this model (no caches)
                if (funct3 > 1) return this._bad(inst);
                break;
            case OPC.SYSTEM: {
                const imm = (inst >>> 20) & 0xfff;
                if (funct3 === 0 && (rd !== 0 || (rs1 !== 0 && funct7 !== 0x09))) return this._bad(inst);
                if (funct3 === 0 && imm === 0) {          // ECALL
                    if (this.priv === PRIV_M) {
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
                    if (this.priv === PRIV_S && this.sbi) {
                        // S-mode SBI call: the machine acts as the M-mode firmware
                        // and services it inline (console/timer), returning to the
                        // instruction after ecall (a0/a1 hold the SBI return).
                        this.pc = next;
                        this.sbi(this);
                        if (this.halted) return 0;
                        this.instret++;
                        return 1;
                    }
                    // A U-mode syscall (cause 8) or an S-mode ecall with no SBI
                    // firmware (cause 9): a real exception, routed by delegation.
                    this._trap(this.priv === PRIV_S ? CAUSE_ECALL_S : CAUSE_ECALL_U, false, 0);
                    this.instret++;
                    return 1;
                }
                if (funct3 === 0 && imm === 1) {          // EBREAK
                    if (!this.hooks.ebreak && this.ebreakTraps) {
                        // No debugger hook, trap semantics requested: the
                        // architectural breakpoint exception (tval = pc, as Spike).
                        this._trap(CAUSE_BREAKPOINT, false, pc);
                        this.instret++;
                        return 1;
                    }
                    this.pc = next;
                    if (this.hooks.ebreak) this.hooks.ebreak(this); else this.halted = true;
                    if (this.halted) return 0;
                    this.instret++;
                    return 1;
                }
                if (funct3 === 0 && imm === 0x302) {      // MRET — return from an M-mode trap
                    if (this.priv !== PRIV_M) return this._bad(inst);
                    const s = this.csr[CSR.MSTATUS];
                    const mpp = (s & MSTATUS_MPP) >>> 11;
                    // MIE <- MPIE; MPIE <- 1; MPP <- U(0); priv <- MPP.
                    let ns = s & ~MSTATUS_MIE & ~MSTATUS_MPP;
                    if (s & MSTATUS_MPIE) ns |= MSTATUS_MIE;
                    ns |= MSTATUS_MPIE;
                    if (mpp !== PRIV_M) ns &= ~(1 << 17);        // MPRV cleared returning below M
                    this.csr[CSR.MSTATUS] = ns >>> 0;
                    this.priv = mpp;
                    this.pc = this.csr[CSR.MEPC] >>> 0;
                    this.instret++;
                    return 1;
                }
                if (funct3 === 0 && imm === 0x102) {      // SRET — return from an S-mode trap
                    if (this.priv === PRIV_U || (this.priv === PRIV_S && (this.csr[CSR.MSTATUS] & MSTATUS_TSR)))
                        return this._bad(inst);
                    const s = this.csr[CSR.MSTATUS];
                    const spp = (s & MSTATUS_SPP) ? PRIV_S : PRIV_U;
                    // SIE <- SPIE; SPIE <- 1; SPP <- U(0); priv <- SPP.
                    let ns = s & ~MSTATUS_SIE & ~MSTATUS_SPP;
                    if (s & MSTATUS_SPIE) ns |= MSTATUS_SIE;
                    ns |= MSTATUS_SPIE;
                    this.csr[CSR.MSTATUS] = ns >>> 0;
                    this.priv = spp;
                    this.pc = this.csr[CSR.SEPC] >>> 0;
                    this.instret++;
                    return 1;
                }
                if (funct3 === 0 && imm === 0x105) {      // WFI — a hint; nop here
                    if (this.priv === PRIV_U || (this.priv === PRIV_S && (this.csr[CSR.MSTATUS] & MSTATUS_TW)))
                        return this._bad(inst);
                    this.waiting = true;
                    break;
                }
                if (funct3 === 0 && funct7 === 0x09) {    // SFENCE.VMA
                    if (this.priv === PRIV_U || (this.priv === PRIV_S && (this.csr[CSR.MSTATUS] & MSTATUS_TVM)))
                        return this._bad(inst);
                    break;                                // no TLB in this model — a nop
                }
                // CSR read/modify/write (funct3 1..7): rd <- old CSR; CSR <- new.
                if (funct3 !== 0 && funct3 !== 4) {
                    const csrN = imm & 0xfff;
                    const write = funct3 & 0x3;                        // 1=RW, 2=RS, 3=RC
                    // CSRRS/CSRRC with a zero source (rs1 = x0, or uimm = 0) do not write.
                    const writes = write === 1 || rs1 !== 0;
                    if (!this._csrOk(csrN, writes)) return this._bad(inst);
                    const old = this._readCsr(csrN);
                    const src = (funct3 & 0x4) ? rs1 : (a | 0);       // immediate variants use the rs1 FIELD
                    let val;
                    if (write === 1) val = src;                       // CSRRW/I
                    else if (write === 2) val = old | src;            // CSRRS/I (set)
                    else val = old & ~src;                            // CSRRC/I (clear)
                    if (writes) this._writeCsr(csrN, val);
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

    /** An illegal instruction. Once software has installed a trap vector (mtvec
     *  != 0) this is the architectural exception — cause 2, tval = the
     *  instruction bits — which an OS relies on (emulation, SIGILL). A bare
     *  program with no vector would only jump into address 0, so there the
     *  machine halts instead and records what it hit. */
    _bad(inst) {
        if (this.csr[CSR.MTVEC] !== 0) {
            this._trap(CAUSE_ILLEGAL, false, inst >>> 0);
            this.instret++;
            return 1;
        }
        this.halted = true;
        this.trap = { cause: 'illegal-instruction', inst: inst >>> 0, pc: this.pc >>> 0 };
        return 0;
    }
}

/** Machine interrupt line bits for mip/mie, for a device (CLINT) to raise. */
export const INTERRUPT = Object.freeze({
    MSI: IRQ_MSI, MTI: IRQ_MTI, MEI: IRQ_MEI, SSI: IRQ_SSI, STI: IRQ_STI, SEI: IRQ_SEI});

export default RiscV32;
