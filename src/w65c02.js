/**
 * W65C02 core — our own, written for the retro tier's composable machine.
 *
 * The CPU knows NOTHING about the machine: every memory access goes through
 * the read/write callbacks the machine model provides, and the machine (RAM,
 * ROM, VIA, ACIA, chip-select map) lives outside this file. Instruction-
 * stepped: step() executes one instruction and returns the cycle count, so
 * the machine can advance its peripherals by exactly that many cycles.
 *
 * Accuracy tier: architectural state + cycle count, verified opcode by
 * opcode against the SingleStepTests 65x02 vector suite (WDC 65C02 variant,
 * ~10k vectors per opcode) via scripts/grind-w65c02.mjs. Per-cycle bus
 * activity is NOT modeled — the composable machine advances peripherals at
 * instruction granularity, which at millisecond trace resolution is
 * indistinguishable.
 *
 * WDC specifics implemented: RMB/SMB/BBR/BBS, STP/WAI, (zp) addressing,
 * STZ/TRB/TSB/BRA/PHX-PLY, decimal ADC/SBC with valid N/Z and the extra
 * cycle, JMP (abs) without the NMOS page bug, all undefined opcodes as
 * fixed-length NOPs, D cleared by interrupts and reset.
 *
 * @module
 */

// Flag bits in P.
const C = 0x01, Z = 0x02, I = 0x04, D = 0x08, B = 0x10, U = 0x20, V = 0x40, N = 0x80;

export class W65C02 {
    /**
     * @param {{ read: (addr: number) => number, write: (addr: number, val: number) => void }} bus
     */
    constructor(bus) {
        this.read = bus.read;
        this.write = bus.write;
        this.a = 0; this.x = 0; this.y = 0; this.s = 0xfd;
        this.pc = 0; this.p = U | I;
        /** True after STP until reset. */
        this.stopped = false;
        /** True after WAI until an interrupt line is raised. */
        this.waiting = false;
        /** Total cycles executed since construction/reset. */
        this.cycles = 0;
    }

    /** Hardware reset: vector at $FFFC/$FFFD, I set, D cleared. 7 cycles. */
    reset() {
        this.pc = this.read(0xfffc) | (this.read(0xfffd) << 8);
        this.p = (this.p | I | U) & ~D;
        this.s = 0xfd;
        this.stopped = false;
        this.waiting = false;
        this.cycles += 7;
    }

    /** Maskable interrupt. Returns true if taken (I clear). Wakes WAI. */
    irq() {
        this.waiting = false;
        if (this.p & I) return false;
        this.cycles += this._interrupt(0xfffe, false);
        return true;
    }

    /** Non-maskable interrupt. Always taken. Wakes WAI. */
    nmi() {
        this.waiting = false;
        this.cycles += this._interrupt(0xfffa, false);
    }

    _interrupt(vector, isBrk) {
        const pc = this.pc;
        this._push(pc >> 8); this._push(pc & 0xff);
        this._push((this.p & ~B) | U | (isBrk ? B : 0));
        this.p = ((this.p | I) & ~D) | U;
        this.pc = this.read(vector) | (this.read(vector + 1) << 8);
        return 7;
    }

    _push(v) { this.write(0x100 + this.s, v & 0xff); this.s = (this.s - 1) & 0xff; }
    _pull() { this.s = (this.s + 1) & 0xff; return this.read(0x100 + this.s); }

    _nz(v) { this.p = (this.p & ~(N | Z)) | (v & N) | (v === 0 ? Z : 0); return v; }
    _flag(bit, cond) { if (cond) this.p |= bit; else this.p &= ~bit; }

    _fetch() { const v = this.read(this.pc); this.pc = (this.pc + 1) & 0xffff; return v; }
    _fetch16() { const lo = this._fetch(); return lo | (this._fetch() << 8); }

    // ---- effective-address helpers. Each returns the address; the ones with
    // page-cross-dependent timing set this._crossed.
    _zp() { return this._fetch(); }
    _zpx() { return (this._fetch() + this.x) & 0xff; }
    _zpy() { return (this._fetch() + this.y) & 0xff; }
    _abs() { return this._fetch16(); }
    _absx() { const b = this._fetch16(); const a = (b + this.x) & 0xffff; this._crossed = (b & 0xff00) !== (a & 0xff00); return a; }
    _absy() { const b = this._fetch16(); const a = (b + this.y) & 0xffff; this._crossed = (b & 0xff00) !== (a & 0xff00); return a; }
    _indx() { const z = (this._fetch() + this.x) & 0xff; return this.read(z) | (this.read((z + 1) & 0xff) << 8); }
    _indy() { const z = this._fetch(); const b = this.read(z) | (this.read((z + 1) & 0xff) << 8); const a = (b + this.y) & 0xffff; this._crossed = (b & 0xff00) !== (a & 0xff00); return a; }
    _zpi() { const z = this._fetch(); return this.read(z) | (this.read((z + 1) & 0xff) << 8); }

    // ---- ALU ops
    _adc(m) {
        const cin = this.p & C ? 1 : 0;
        if (this.p & D) {
            let lo = (this.a & 0x0f) + (m & 0x0f) + cin;
            if (lo >= 0x0a) lo = ((lo + 0x06) & 0x0f) + 0x10;
            let sum = (this.a & 0xf0) + (m & 0xf0) + lo;
            this._flag(V, (~(this.a ^ m) & (this.a ^ sum) & 0x80) !== 0);
            if (sum >= 0xa0) sum += 0x60;
            this._flag(C, sum >= 0x100);
            this.a = this._nz(sum & 0xff);
            this._extra += 1;
        } else {
            const sum = this.a + m + cin;
            this._flag(V, (~(this.a ^ m) & (this.a ^ sum) & 0x80) !== 0);
            this._flag(C, sum > 0xff);
            this.a = this._nz(sum & 0xff);
        }
    }

    _sbc(m) {
        const cin = this.p & C ? 1 : 0;
        const bin = this.a + (~m & 0xff) + cin;
        if (this.p & D) {
            this._flag(C, bin > 0xff);
            this._flag(V, ((this.a ^ bin) & ((~m & 0xff) ^ bin) & 0x80) !== 0);
            const lo = (this.a & 0x0f) - (m & 0x0f) + cin - 1;
            let r = this.a - m + cin - 1;
            if (r < 0) r -= 0x60;
            if (lo < 0) r -= 0x06;
            this.a = this._nz(r & 0xff);
            this._extra += 1;
        } else {
            this._flag(C, bin > 0xff);
            this._flag(V, ((this.a ^ bin) & ((~m & 0xff) ^ bin) & 0x80) !== 0);
            this.a = this._nz(bin & 0xff);
        }
    }

    _cmp(reg, m) {
        const r = reg - m;
        this._flag(C, r >= 0);
        this._nz(r & 0xff);
    }

    _asl(v) { this._flag(C, (v & 0x80) !== 0); return this._nz((v << 1) & 0xff); }
    _lsr(v) { this._flag(C, (v & 0x01) !== 0); return this._nz(v >> 1); }
    _rol(v) { const cin = this.p & C ? 1 : 0; this._flag(C, (v & 0x80) !== 0); return this._nz(((v << 1) | cin) & 0xff); }
    _ror(v) { const cin = this.p & C ? 0x80 : 0; this._flag(C, (v & 0x01) !== 0); return this._nz((v >> 1) | cin); }

    _bit(m, immediate) {
        this._flag(Z, (this.a & m) === 0);
        if (!immediate) { this._flag(N, (m & 0x80) !== 0); this._flag(V, (m & 0x40) !== 0); }
    }

    _branch(cond) {
        const off = this._fetch();
        this._extra = 0;
        if (cond) {
            const rel = off < 0x80 ? off : off - 0x100;
            const to = (this.pc + rel) & 0xffff;
            this._extra = 1 + ((to & 0xff00) !== (this.pc & 0xff00) ? 1 : 0);
            this.pc = to;
        }
        return 2 + this._extra;
    }

    _rmw(addr, fn, base) { this.write(addr, fn.call(this, this.read(addr))); return base; }

    /**
     * Execute one instruction. Returns cycles consumed (0 if stopped or
     * waiting — call irq()/nmi()/reset() to resume).
     */
    step() {
        if (this.stopped || this.waiting) return 0;
        this._crossed = false;
        this._extra = 0;
        const op = this._fetch();
        const n = this._exec(op);
        this.cycles += n;
        return n;
    }

    _exec(op) {
        let a;
        switch (op) {
            // ---- loads
            case 0xa9: this.a = this._nz(this._fetch()); return 2;
            case 0xa5: this.a = this._nz(this.read(this._zp())); return 3;
            case 0xb5: this.a = this._nz(this.read(this._zpx())); return 4;
            case 0xad: this.a = this._nz(this.read(this._abs())); return 4;
            case 0xbd: this.a = this._nz(this.read(this._absx())); return 4 + (this._crossed ? 1 : 0);
            case 0xb9: this.a = this._nz(this.read(this._absy())); return 4 + (this._crossed ? 1 : 0);
            case 0xa1: this.a = this._nz(this.read(this._indx())); return 6;
            case 0xb1: this.a = this._nz(this.read(this._indy())); return 5 + (this._crossed ? 1 : 0);
            case 0xb2: this.a = this._nz(this.read(this._zpi())); return 5;
            case 0xa2: this.x = this._nz(this._fetch()); return 2;
            case 0xa6: this.x = this._nz(this.read(this._zp())); return 3;
            case 0xb6: this.x = this._nz(this.read(this._zpy())); return 4;
            case 0xae: this.x = this._nz(this.read(this._abs())); return 4;
            case 0xbe: this.x = this._nz(this.read(this._absy())); return 4 + (this._crossed ? 1 : 0);
            case 0xa0: this.y = this._nz(this._fetch()); return 2;
            case 0xa4: this.y = this._nz(this.read(this._zp())); return 3;
            case 0xb4: this.y = this._nz(this.read(this._zpx())); return 4;
            case 0xac: this.y = this._nz(this.read(this._abs())); return 4;
            case 0xbc: this.y = this._nz(this.read(this._absx())); return 4 + (this._crossed ? 1 : 0);
            // ---- stores
            case 0x85: this.write(this._zp(), this.a); return 3;
            case 0x95: this.write(this._zpx(), this.a); return 4;
            case 0x8d: this.write(this._abs(), this.a); return 4;
            case 0x9d: this.write(this._absx(), this.a); return 5;
            case 0x99: this.write(this._absy(), this.a); return 5;
            case 0x81: this.write(this._indx(), this.a); return 6;
            case 0x91: this.write(this._indy(), this.a); return 6;
            case 0x92: this.write(this._zpi(), this.a); return 5;
            case 0x86: this.write(this._zp(), this.x); return 3;
            case 0x96: this.write(this._zpy(), this.x); return 4;
            case 0x8e: this.write(this._abs(), this.x); return 4;
            case 0x84: this.write(this._zp(), this.y); return 3;
            case 0x94: this.write(this._zpx(), this.y); return 4;
            case 0x8c: this.write(this._abs(), this.y); return 4;
            case 0x64: this.write(this._zp(), 0); return 3;
            case 0x74: this.write(this._zpx(), 0); return 4;
            case 0x9c: this.write(this._abs(), 0); return 4;
            case 0x9e: this.write(this._absx(), 0); return 5;
            // ---- ADC / SBC (decimal adds 1 via _extra)
            case 0x69: this._adc(this._fetch()); return 2 + this._extra;
            case 0x65: this._adc(this.read(this._zp())); return 3 + this._extra;
            case 0x75: this._adc(this.read(this._zpx())); return 4 + this._extra;
            case 0x6d: this._adc(this.read(this._abs())); return 4 + this._extra;
            case 0x7d: this._adc(this.read(this._absx())); return 4 + (this._crossed ? 1 : 0) + this._extra;
            case 0x79: this._adc(this.read(this._absy())); return 4 + (this._crossed ? 1 : 0) + this._extra;
            case 0x61: this._adc(this.read(this._indx())); return 6 + this._extra;
            case 0x71: this._adc(this.read(this._indy())); return 5 + (this._crossed ? 1 : 0) + this._extra;
            case 0x72: this._adc(this.read(this._zpi())); return 5 + this._extra;
            case 0xe9: this._sbc(this._fetch()); return 2 + this._extra;
            case 0xe5: this._sbc(this.read(this._zp())); return 3 + this._extra;
            case 0xf5: this._sbc(this.read(this._zpx())); return 4 + this._extra;
            case 0xed: this._sbc(this.read(this._abs())); return 4 + this._extra;
            case 0xfd: this._sbc(this.read(this._absx())); return 4 + (this._crossed ? 1 : 0) + this._extra;
            case 0xf9: this._sbc(this.read(this._absy())); return 4 + (this._crossed ? 1 : 0) + this._extra;
            case 0xe1: this._sbc(this.read(this._indx())); return 6 + this._extra;
            case 0xf1: this._sbc(this.read(this._indy())); return 5 + (this._crossed ? 1 : 0) + this._extra;
            case 0xf2: this._sbc(this.read(this._zpi())); return 5 + this._extra;
            // ---- compares
            case 0xc9: this._cmp(this.a, this._fetch()); return 2;
            case 0xc5: this._cmp(this.a, this.read(this._zp())); return 3;
            case 0xd5: this._cmp(this.a, this.read(this._zpx())); return 4;
            case 0xcd: this._cmp(this.a, this.read(this._abs())); return 4;
            case 0xdd: this._cmp(this.a, this.read(this._absx())); return 4 + (this._crossed ? 1 : 0);
            case 0xd9: this._cmp(this.a, this.read(this._absy())); return 4 + (this._crossed ? 1 : 0);
            case 0xc1: this._cmp(this.a, this.read(this._indx())); return 6;
            case 0xd1: this._cmp(this.a, this.read(this._indy())); return 5 + (this._crossed ? 1 : 0);
            case 0xd2: this._cmp(this.a, this.read(this._zpi())); return 5;
            case 0xe0: this._cmp(this.x, this._fetch()); return 2;
            case 0xe4: this._cmp(this.x, this.read(this._zp())); return 3;
            case 0xec: this._cmp(this.x, this.read(this._abs())); return 4;
            case 0xc0: this._cmp(this.y, this._fetch()); return 2;
            case 0xc4: this._cmp(this.y, this.read(this._zp())); return 3;
            case 0xcc: this._cmp(this.y, this.read(this._abs())); return 4;
            // ---- logic
            case 0x29: this.a = this._nz(this.a & this._fetch()); return 2;
            case 0x25: this.a = this._nz(this.a & this.read(this._zp())); return 3;
            case 0x35: this.a = this._nz(this.a & this.read(this._zpx())); return 4;
            case 0x2d: this.a = this._nz(this.a & this.read(this._abs())); return 4;
            case 0x3d: this.a = this._nz(this.a & this.read(this._absx())); return 4 + (this._crossed ? 1 : 0);
            case 0x39: this.a = this._nz(this.a & this.read(this._absy())); return 4 + (this._crossed ? 1 : 0);
            case 0x21: this.a = this._nz(this.a & this.read(this._indx())); return 6;
            case 0x31: this.a = this._nz(this.a & this.read(this._indy())); return 5 + (this._crossed ? 1 : 0);
            case 0x32: this.a = this._nz(this.a & this.read(this._zpi())); return 5;
            case 0x09: this.a = this._nz(this.a | this._fetch()); return 2;
            case 0x05: this.a = this._nz(this.a | this.read(this._zp())); return 3;
            case 0x15: this.a = this._nz(this.a | this.read(this._zpx())); return 4;
            case 0x0d: this.a = this._nz(this.a | this.read(this._abs())); return 4;
            case 0x1d: this.a = this._nz(this.a | this.read(this._absx())); return 4 + (this._crossed ? 1 : 0);
            case 0x19: this.a = this._nz(this.a | this.read(this._absy())); return 4 + (this._crossed ? 1 : 0);
            case 0x01: this.a = this._nz(this.a | this.read(this._indx())); return 6;
            case 0x11: this.a = this._nz(this.a | this.read(this._indy())); return 5 + (this._crossed ? 1 : 0);
            case 0x12: this.a = this._nz(this.a | this.read(this._zpi())); return 5;
            case 0x49: this.a = this._nz(this.a ^ this._fetch()); return 2;
            case 0x45: this.a = this._nz(this.a ^ this.read(this._zp())); return 3;
            case 0x55: this.a = this._nz(this.a ^ this.read(this._zpx())); return 4;
            case 0x4d: this.a = this._nz(this.a ^ this.read(this._abs())); return 4;
            case 0x5d: this.a = this._nz(this.a ^ this.read(this._absx())); return 4 + (this._crossed ? 1 : 0);
            case 0x59: this.a = this._nz(this.a ^ this.read(this._absy())); return 4 + (this._crossed ? 1 : 0);
            case 0x41: this.a = this._nz(this.a ^ this.read(this._indx())); return 6;
            case 0x51: this.a = this._nz(this.a ^ this.read(this._indy())); return 5 + (this._crossed ? 1 : 0);
            case 0x52: this.a = this._nz(this.a ^ this.read(this._zpi())); return 5;
            // ---- BIT / TSB / TRB
            case 0x89: this._bit(this._fetch(), true); return 2;
            case 0x24: this._bit(this.read(this._zp()), false); return 3;
            case 0x2c: this._bit(this.read(this._abs()), false); return 4;
            case 0x34: this._bit(this.read(this._zpx()), false); return 4;
            case 0x3c: this._bit(this.read(this._absx()), false); return 4 + (this._crossed ? 1 : 0);
            case 0x04: a = this._zp(); { const m = this.read(a); this._flag(Z, (this.a & m) === 0); this.write(a, m | this.a); } return 5;
            case 0x0c: a = this._abs(); { const m = this.read(a); this._flag(Z, (this.a & m) === 0); this.write(a, m | this.a); } return 6;
            case 0x14: a = this._zp(); { const m = this.read(a); this._flag(Z, (this.a & m) === 0); this.write(a, m & ~this.a); } return 5;
            case 0x1c: a = this._abs(); { const m = this.read(a); this._flag(Z, (this.a & m) === 0); this.write(a, m & ~this.a); } return 6;
            // ---- shifts / rotates
            case 0x0a: this.a = this._asl(this.a); return 2;
            case 0x06: return this._rmw(this._zp(), this._asl, 5);
            case 0x16: return this._rmw(this._zpx(), this._asl, 6);
            case 0x0e: return this._rmw(this._abs(), this._asl, 6);
            case 0x1e: return this._rmw(this._absx(), this._asl, 6 + (this._crossed ? 1 : 0));
            case 0x4a: this.a = this._lsr(this.a); return 2;
            case 0x46: return this._rmw(this._zp(), this._lsr, 5);
            case 0x56: return this._rmw(this._zpx(), this._lsr, 6);
            case 0x4e: return this._rmw(this._abs(), this._lsr, 6);
            case 0x5e: return this._rmw(this._absx(), this._lsr, 6 + (this._crossed ? 1 : 0));
            case 0x2a: this.a = this._rol(this.a); return 2;
            case 0x26: return this._rmw(this._zp(), this._rol, 5);
            case 0x36: return this._rmw(this._zpx(), this._rol, 6);
            case 0x2e: return this._rmw(this._abs(), this._rol, 6);
            case 0x3e: return this._rmw(this._absx(), this._rol, 6 + (this._crossed ? 1 : 0));
            case 0x6a: this.a = this._ror(this.a); return 2;
            case 0x66: return this._rmw(this._zp(), this._ror, 5);
            case 0x76: return this._rmw(this._zpx(), this._ror, 6);
            case 0x6e: return this._rmw(this._abs(), this._ror, 6);
            case 0x7e: return this._rmw(this._absx(), this._ror, 6 + (this._crossed ? 1 : 0));
            // ---- inc / dec
            case 0x1a: this.a = this._nz((this.a + 1) & 0xff); return 2;
            case 0x3a: this.a = this._nz((this.a - 1) & 0xff); return 2;
            case 0xe6: return this._rmw(this._zp(), (v) => this._nz((v + 1) & 0xff), 5);
            case 0xf6: return this._rmw(this._zpx(), (v) => this._nz((v + 1) & 0xff), 6);
            case 0xee: return this._rmw(this._abs(), (v) => this._nz((v + 1) & 0xff), 6);
            case 0xfe: return this._rmw(this._absx(), (v) => this._nz((v + 1) & 0xff), 7);
            case 0xc6: return this._rmw(this._zp(), (v) => this._nz((v - 1) & 0xff), 5);
            case 0xd6: return this._rmw(this._zpx(), (v) => this._nz((v - 1) & 0xff), 6);
            case 0xce: return this._rmw(this._abs(), (v) => this._nz((v - 1) & 0xff), 6);
            case 0xde: return this._rmw(this._absx(), (v) => this._nz((v - 1) & 0xff), 7);
            case 0xe8: this.x = this._nz((this.x + 1) & 0xff); return 2;
            case 0xc8: this.y = this._nz((this.y + 1) & 0xff); return 2;
            case 0xca: this.x = this._nz((this.x - 1) & 0xff); return 2;
            case 0x88: this.y = this._nz((this.y - 1) & 0xff); return 2;
            // ---- jumps / subroutines
            case 0x4c: this.pc = this._fetch16(); return 3;
            case 0x6c: a = this._fetch16(); this.pc = this.read(a) | (this.read((a + 1) & 0xffff) << 8); return 6;
            case 0x7c: a = (this._fetch16() + this.x) & 0xffff; this.pc = this.read(a) | (this.read((a + 1) & 0xffff) << 8); return 6;
            case 0x20: a = this._fetch16(); { const ret = (this.pc - 1) & 0xffff; this._push(ret >> 8); this._push(ret & 0xff); } this.pc = a; return 6;
            case 0x60: this.pc = (this._pull() | (this._pull() << 8)) + 1 & 0xffff; return 6;
            case 0x40: this.p = (this._pull() & ~B) | U; this.pc = this._pull() | (this._pull() << 8); return 6;
            case 0x00: this._fetch(); return this._interrupt(0xfffe, true);
            // ---- branches
            case 0x10: return this._branch(!(this.p & N));
            case 0x30: return this._branch((this.p & N) !== 0);
            case 0x50: return this._branch(!(this.p & V));
            case 0x70: return this._branch((this.p & V) !== 0);
            case 0x90: return this._branch(!(this.p & C));
            case 0xb0: return this._branch((this.p & C) !== 0);
            case 0xd0: return this._branch(!(this.p & Z));
            case 0xf0: return this._branch((this.p & Z) !== 0);
            case 0x80: return this._branch(true);
            // ---- flags
            case 0x18: this.p &= ~C; return 2;
            case 0x38: this.p |= C; return 2;
            case 0x58: this.p &= ~I; return 2;
            case 0x78: this.p |= I; return 2;
            case 0xb8: this.p &= ~V; return 2;
            case 0xd8: this.p &= ~D; return 2;
            case 0xf8: this.p |= D; return 2;
            // ---- transfers / stack
            case 0xaa: this.x = this._nz(this.a); return 2;
            case 0xa8: this.y = this._nz(this.a); return 2;
            case 0x8a: this.a = this._nz(this.x); return 2;
            case 0x98: this.a = this._nz(this.y); return 2;
            case 0xba: this.x = this._nz(this.s); return 2;
            case 0x9a: this.s = this.x; return 2;
            case 0x48: this._push(this.a); return 3;
            case 0x68: this.a = this._nz(this._pull()); return 4;
            case 0x08: this._push(this.p | B | U); return 3;
            case 0x28: this.p = (this._pull() & ~B) | U; return 4;
            case 0xda: this._push(this.x); return 3;
            case 0xfa: this.x = this._nz(this._pull()); return 4;
            case 0x5a: this._push(this.y); return 3;
            case 0x7a: this.y = this._nz(this._pull()); return 4;
            case 0xea: return 2;
            // ---- WDC: WAI / STP
            case 0xcb: this.waiting = true; return 3;
            case 0xdb: this.stopped = true; return 3;
            default:
                return this._execWdcBit(op);
        }
    }

    /** RMB/SMB/BBR/BBS (columns 7 and F) and the undefined-NOP matrix. */
    _execWdcBit(op) {
        const col = op & 0x0f;
        const bit = (op >> 4) & 0x07;
        if (col === 0x07) { // RMBn (0x07-0x77) / SMBn (0x87-0xf7), zp, 5 cycles
            const addr = this._zp();
            const m = this.read(addr);
            this.write(addr, op < 0x80 ? m & ~(1 << bit) : m | (1 << bit));
            return 5;
        }
        if (col === 0x0f) { // BBRn / BBSn: zp then relative, 5 cycles, +1 taken/+1 cross
            const m = this.read(this._zp());
            const set = (m & (1 << bit)) !== 0;
            const taken = op < 0x80 ? !set : set;
            const off = this._fetch();
            if (taken) {
                const rel = off < 0x80 ? off : off - 0x100;
                const to = (this.pc + rel) & 0xffff;
                const cross = (to & 0xff00) !== (this.pc & 0xff00);
                this.pc = to;
                return 6 + (cross ? 1 : 0);
            }
            return 5;
        }
        if (col === 0x03 || col === 0x0b) return 1; // 1-byte 1-cycle NOPs
        switch (op) { // remaining undefined NOPs, fixed lengths
            case 0x02: case 0x22: case 0x42: case 0x62: case 0x82: case 0xc2: case 0xe2:
                this._fetch(); return 2;
            case 0x44: this._fetch(); return 3;
            case 0x54: case 0xd4: case 0xf4: this._fetch(); return 4;
            // 0x5c is 4 cycles in the WDC vector suite (all 10k vectors),
            // not the oft-quoted 8 — the suite is the authority here.
            case 0x5c: case 0xdc: case 0xfc: this._fetch16(); return 4;
            default: return 2; // unreachable if the matrix above is complete
        }
    }
}

export default W65C02;
