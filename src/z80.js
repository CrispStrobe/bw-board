/**
 * Z80 core — the retro tier's second CPU, our own, built the W65C02 way:
 * bus-agnostic (read/write callbacks), instruction-stepped, ground against
 * the SingleStepTests z80 suite (MIT; 1,604 opcode files × 1,000 vectors,
 * UNDOCUMENTED behavior included: X/Y flags from results, the Q latch that
 * SCF/CCF read, R's per-M1 increment, WZ/MEMPTR).
 *
 * STATUS: SCAFFOLD under active grinding — the state model, flag helpers
 * and the first instruction groups are in; unimplemented opcodes throw,
 * and scripts/grind-z80.mjs sorts files into pass / fail / not-yet so
 * growth is measurable per session. Do not wire into a machine yet.
 *
 * @module
 */

// Flag bits in F.
const FC = 0x01, FN = 0x02, FP = 0x04, FX = 0x08, FH = 0x10, FY = 0x20, FZ = 0x40, FS = 0x80;

const PARITY = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
    let b = i, c = 0;
    while (b) { c ^= b & 1; b >>= 1; }
    PARITY[i] = c ? 0 : FP;
}

export class Z80 {
    /** @param {{ read: (a:number)=>number, write:(a:number,v:number)=>void,
     *            in?:(port:number)=>number, out?:(port:number,v:number)=>void }} bus */
    constructor(bus) {
        this.read = bus.read;
        this.write = bus.write;
        this.inPort = bus.in || (() => 0xff);
        this.outPort = bus.out || (() => {});
        this.a = 0; this.f = 0; this.b = 0; this.c = 0; this.d = 0; this.e = 0;
        this.h = 0; this.l = 0;
        this.a_ = 0; this.f_ = 0; this.b_ = 0; this.c_ = 0; this.d_ = 0; this.e_ = 0;
        this.h_ = 0; this.l_ = 0;
        this.ix = 0; this.iy = 0; this.sp = 0; this.pc = 0;
        this.i = 0; this.r = 0; this.wz = 0;
        this.iff1 = 0; this.iff2 = 0; this.im = 0;
        this.q = 0;          // the SCF/CCF latch: F after a flag-writing op, else 0
        this.eiLatch = 0;    // 1 for the single instruction after EI
        this.cycles = 0;
    }

    // ---- register-pair views -------------------------------------------
    get bc() { return (this.b << 8) | this.c; }
    set bc(v) { this.b = (v >> 8) & 0xff; this.c = v & 0xff; }
    get de() { return (this.d << 8) | this.e; }
    set de(v) { this.d = (v >> 8) & 0xff; this.e = v & 0xff; }
    get hl() { return (this.h << 8) | this.l; }
    set hl(v) { this.h = (v >> 8) & 0xff; this.l = v & 0xff; }
    get af() { return (this.a << 8) | this.f; }
    set af(v) { this.a = (v >> 8) & 0xff; this.f = v & 0xff; }

    _m1() { this.r = (this.r & 0x80) | ((this.r + 1) & 0x7f); }
    _fetch() { const v = this.read(this.pc); this.pc = (this.pc + 1) & 0xffff; return v; }
    _fetch16() { const lo = this._fetch(); return lo | (this._fetch() << 8); }
    _setF(v) { this.f = v & 0xff; this.q = this.f; }

    // ---- 8-bit ALU with documented AND undocumented flags ---------------
    _add8(v, carry) {
        const c = carry ? (this.f & FC) : 0;
        const r = this.a + v + c;
        const rr = r & 0xff;
        let f = (rr & (FS | FX | FY)) | (rr === 0 ? FZ : 0)
            | (((this.a ^ v ^ rr) & 0x10) ? FH : 0)
            | ((~(this.a ^ v) & (this.a ^ rr) & 0x80) ? FP : 0)
            | (r > 0xff ? FC : 0);
        this.a = rr;
        this._setF(f);
    }

    _sub8(v, carry, keepA) {
        const c = carry ? (this.f & FC) : 0;
        const r = this.a - v - c;
        const rr = r & 0xff;
        let f = (rr & (FS | FX | FY)) | (rr === 0 ? FZ : 0) | FN
            | (((this.a ^ v ^ rr) & 0x10) ? FH : 0)
            | (((this.a ^ v) & (this.a ^ rr) & 0x80) ? FP : 0)
            | (r < 0 ? FC : 0);
        if (keepA) f = (f & ~(FX | FY)) | (v & (FX | FY)); // CP: X/Y from OPERAND
        else this.a = rr;
        this._setF(f);
    }

    _logic(v, op) {
        this.a = (op === '&' ? this.a & v : op === '|' ? this.a | v : this.a ^ v) & 0xff;
        this._setF((this.a & (FS | FX | FY)) | (this.a === 0 ? FZ : 0)
            | PARITY[this.a] | (op === '&' ? FH : 0));
    }

    _inc8(v) {
        const r = (v + 1) & 0xff;
        this._setF((this.f & FC) | (r & (FS | FX | FY)) | (r === 0 ? FZ : 0)
            | ((v & 0x0f) === 0x0f ? FH : 0) | (v === 0x7f ? FP : 0));
        return r;
    }

    _dec8(v) {
        const r = (v - 1) & 0xff;
        this._setF((this.f & FC) | (r & (FS | FX | FY)) | (r === 0 ? FZ : 0) | FN
            | ((v & 0x0f) === 0x00 ? FH : 0) | (v === 0x80 ? FP : 0));
        return r;
    }

    _add16(a, v) {
        const r = a + v;
        this.wz = (a + 1) & 0xffff;
        this._setF((this.f & (FS | FZ | FP)) | ((r >> 8) & (FX | FY))
            | (((a ^ v ^ r) & 0x1000) ? FH : 0) | (r > 0xffff ? FC : 0));
        return r & 0xffff;
    }

    // ---- register file by index (the 8-bit r encoding) -------------------
    _getR(k) {
        switch (k) {
            case 0: return this.b; case 1: return this.c; case 2: return this.d;
            case 3: return this.e; case 4: return this.h; case 5: return this.l;
            case 6: return this.read(this.hl); default: return this.a;
        }
    }

    _setR(k, v) {
        switch (k) {
            case 0: this.b = v; break; case 1: this.c = v; break;
            case 2: this.d = v; break; case 3: this.e = v; break;
            case 4: this.h = v; break; case 5: this.l = v; break;
            case 6: this.write(this.hl, v); break; default: this.a = v;
        }
    }

    /** Execute one instruction; returns cycles. Throws on opcodes not yet
     *  implemented — the grinder counts those as NOT-YET, never as pass. */
    step() {
        const qBefore = this.q;
        this.q = 0;                    // any instruction that writes F re-sets it
        const eiWas = this.eiLatch;
        this.eiLatch = 0;
        this._m1();
        const op = this._fetch();
        const n = this._main(op, qBefore);
        this.cycles += n;
        void eiWas;
        return n;
    }

    _main(op, qBefore) {
        // LD r,r' block (0x40-0x7f except HALT).
        if (op >= 0x40 && op <= 0x7f && op !== 0x76) {
            const dst = (op >> 3) & 7, src = op & 7;
            this._setR(dst, this._getR(src));
            return (dst === 6 || src === 6) ? 7 : 4;
        }
        // ALU block 0x80-0xbf.
        if (op >= 0x80 && op <= 0xbf) {
            const v = this._getR(op & 7);
            switch ((op >> 3) & 7) {
                case 0: this._add8(v, false); break;
                case 1: this._add8(v, true); break;
                case 2: this._sub8(v, false, false); break;
                case 3: this._sub8(v, true, false); break;
                case 4: this._logic(v, '&'); break;
                case 5: this._logic(v, '^'); break;
                case 6: this._logic(v, '|'); break;
                default: this._sub8(v, false, true);
            }
            return (op & 7) === 6 ? 7 : 4;
        }
        switch (op) {
            case 0x00: return 4;                                   // NOP
            case 0x01: this.bc = this._fetch16(); return 10;
            case 0x11: this.de = this._fetch16(); return 10;
            case 0x21: this.hl = this._fetch16(); return 10;
            case 0x31: this.sp = this._fetch16(); return 10;
            case 0x06: this.b = this._fetch(); return 7;
            case 0x0e: this.c = this._fetch(); return 7;
            case 0x16: this.d = this._fetch(); return 7;
            case 0x1e: this.e = this._fetch(); return 7;
            case 0x26: this.h = this._fetch(); return 7;
            case 0x2e: this.l = this._fetch(); return 7;
            case 0x36: this.write(this.hl, this._fetch()); return 10;
            case 0x3e: this.a = this._fetch(); return 7;
            case 0x04: this.b = this._inc8(this.b); return 4;
            case 0x0c: this.c = this._inc8(this.c); return 4;
            case 0x14: this.d = this._inc8(this.d); return 4;
            case 0x1c: this.e = this._inc8(this.e); return 4;
            case 0x24: this.h = this._inc8(this.h); return 4;
            case 0x2c: this.l = this._inc8(this.l); return 4;
            case 0x34: this.write(this.hl, this._inc8(this.read(this.hl))); return 11;
            case 0x3c: this.a = this._inc8(this.a); return 4;
            case 0x05: this.b = this._dec8(this.b); return 4;
            case 0x0d: this.c = this._dec8(this.c); return 4;
            case 0x15: this.d = this._dec8(this.d); return 4;
            case 0x1d: this.e = this._dec8(this.e); return 4;
            case 0x25: this.h = this._dec8(this.h); return 4;
            case 0x2d: this.l = this._dec8(this.l); return 4;
            case 0x35: this.write(this.hl, this._dec8(this.read(this.hl))); return 11;
            case 0x3d: this.a = this._dec8(this.a); return 4;
            case 0x03: this.bc = (this.bc + 1) & 0xffff; return 6;
            case 0x13: this.de = (this.de + 1) & 0xffff; return 6;
            case 0x23: this.hl = (this.hl + 1) & 0xffff; return 6;
            case 0x33: this.sp = (this.sp + 1) & 0xffff; return 6;
            case 0x0b: this.bc = (this.bc - 1) & 0xffff; return 6;
            case 0x1b: this.de = (this.de - 1) & 0xffff; return 6;
            case 0x2b: this.hl = (this.hl - 1) & 0xffff; return 6;
            case 0x3b: this.sp = (this.sp - 1) & 0xffff; return 6;
            case 0x09: this.hl = this._add16(this.hl, this.bc); return 11;
            case 0x19: this.hl = this._add16(this.hl, this.de); return 11;
            case 0x29: this.hl = this._add16(this.hl, this.hl); return 11;
            case 0x39: this.hl = this._add16(this.hl, this.sp); return 11;
            case 0xc6: this._add8(this._fetch(), false); return 7;
            case 0xce: this._add8(this._fetch(), true); return 7;
            case 0xd6: this._sub8(this._fetch(), false, false); return 7;
            case 0xde: this._sub8(this._fetch(), true, false); return 7;
            case 0xe6: this._logic(this._fetch(), '&'); return 7;
            case 0xee: this._logic(this._fetch(), '^'); return 7;
            case 0xf6: this._logic(this._fetch(), '|'); return 7;
            case 0xfe: this._sub8(this._fetch(), false, true); return 7;
            case 0x37: { // SCF: X/Y from A or from Q (the undocumented latch)
                const xy = (qBefore ? this.a : (this.f | this.a)) & (FX | FY);
                this._setF((this.f & (FS | FZ | FP)) | xy | FC);
                return 4;
            }
            case 0x3f: { // CCF
                const xy = (qBefore ? this.a : (this.f | this.a)) & (FX | FY);
                this._setF((this.f & (FS | FZ | FP)) | xy
                    | ((this.f & FC) ? FH : FC));
                return 4;
            }
            case 0x2f: // CPL
                this.a = (~this.a) & 0xff;
                this._setF((this.f & (FS | FZ | FP | FC)) | FH | FN | (this.a & (FX | FY)));
                return 4;
            case 0x76: this.halted = true; return 4;   // HALT: PC stays past it (suite-verified)
            default:
                throw new Error(`z80: opcode ${op.toString(16).padStart(2, '0')} not yet implemented`);
        }
    }
}

export default Z80;
