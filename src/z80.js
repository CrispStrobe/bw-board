/**
 * Z80 core — the retro tier's second CPU, our own, built the W65C02 way:
 * bus-agnostic (read/write callbacks), instruction-stepped, ground against
 * the SingleStepTests z80 suite (MIT; 1,604 opcode files × 1,000 vectors,
 * UNDOCUMENTED behavior included: X/Y flags from results, the Q latch that
 * SCF/CCF read, R's per-M1 increment, WZ/MEMPTR).
 *
 * STATUS: VECTOR-COMPLETE — 1,604/1,604 files, 1.6 million vectors, all
 * pages (main, CB, ED with the interrupted-repeat rules, DD/FD with the
 * undocumented index halves, DDCB/FDCB). Interrupt delivery (IM 0/1/2,
 * NMI) is NOT yet modeled — the machine layer adds it next; nothing in
 * the single-step suite exercises it.
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
        /* shadow set (accessed as af_/bc_/de_/hl_ pair views below) */
        Object.assign(this, { a_: 0, f_: 0, b_: 0, c_: 0, d_: 0, e_: 0, h_: 0, l_: 0 });
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
    get af_() { return (this.a_ << 8) | this.f_; }
    set af_(v) { this.a_ = (v >> 8) & 0xff; this.f_ = v & 0xff; }
    get bc_() { return (this.b_ << 8) | this.c_; }
    set bc_(v) { this.b_ = (v >> 8) & 0xff; this.c_ = v & 0xff; }
    get de_() { return (this.d_ << 8) | this.e_; }
    set de_(v) { this.d_ = (v >> 8) & 0xff; this.e_ = v & 0xff; }
    get hl_() { return (this.h_ << 8) | this.l_; }
    set hl_(v) { this.h_ = (v >> 8) & 0xff; this.l_ = v & 0xff; }

    _m1() { this.r = (this.r & 0x80) | ((this.r + 1) & 0x7f); }
    _push16(v) {
        this.sp = (this.sp - 1) & 0xffff; this.write(this.sp, (v >> 8) & 0xff);
        this.sp = (this.sp - 1) & 0xffff; this.write(this.sp, v & 0xff);
    }
    _pop16() {
        const lo = this.read(this.sp); this.sp = (this.sp + 1) & 0xffff;
        const hi = this.read(this.sp); this.sp = (this.sp + 1) & 0xffff;
        return lo | (hi << 8);
    }
    /** One CB-page rotate/shift with full flags (H=N=0, P=parity). */
    _rot(kind, v) {
        let c;
        let r;
        switch (kind) {
            case 0: c = v >> 7; r = ((v << 1) | c) & 0xff; break;               // RLC
            case 1: c = v & 1; r = ((v >> 1) | (c << 7)) & 0xff; break;         // RRC
            case 2: c = v >> 7; r = ((v << 1) | (this.f & FC)) & 0xff; break;   // RL
            case 3: c = v & 1; r = ((v >> 1) | ((this.f & FC) << 7)) & 0xff; break; // RR
            case 4: c = v >> 7; r = (v << 1) & 0xff; break;                     // SLA
            case 5: c = v & 1; r = ((v >> 1) | (v & 0x80)) & 0xff; break;       // SRA
            case 6: c = v >> 7; r = ((v << 1) | 1) & 0xff; break;               // SLL (undocumented)
            default: c = v & 1; r = v >> 1;                                     // SRL
        }
        this._setF((r & (FS | FX | FY)) | (r === 0 ? FZ : 0) | PARITY[r] | c);
        return r;
    }

    _cb() {
        this._m1();                       // the prefix's own M1 refresh
        const op = this._fetch();
        const k = op & 7;
        const isHL = k === 6;
        const grp = op >> 6;
        if (grp === 0) {
            this._setR(k, this._rot((op >> 3) & 7, this._getR(k)));
            return isHL ? 15 : 8;
        }
        const bit = (op >> 3) & 7;
        if (grp === 1) {                  // BIT: X/Y from the operand — or
            const v = this._getR(k);      // from MEMPTR's high byte for (HL)
            const set = v & (1 << bit);
            const xySrc = isHL ? (this.wz >> 8) : v;
            this._setF((this.f & FC) | FH | (set ? 0 : (FZ | FP))
                | (bit === 7 && set ? FS : 0) | (xySrc & (FX | FY)));
            return isHL ? 12 : 8;
        }
        const v = this._getR(k);
        this._setR(k, grp === 2 ? (v & ~(1 << bit)) & 0xff : v | (1 << bit));
        return isHL ? 15 : 8;
    }

    _sbc16(v) {
        const a = this.hl;
        const c = this.f & FC;
        const r = a - v - c;
        const rr = r & 0xffff;
        this.wz = (a + 1) & 0xffff;
        this._setF(((rr >> 8) & (FS | FX | FY)) | (rr === 0 ? FZ : 0) | FN
            | (((a ^ v ^ rr) & 0x1000) ? FH : 0)
            | (((a ^ v) & (a ^ rr) & 0x8000) ? FP : 0)
            | (r < 0 ? FC : 0));
        this.hl = rr;
    }

    _adc16(v) {
        const a = this.hl;
        const c = this.f & FC;
        const r = a + v + c;
        const rr = r & 0xffff;
        this.wz = (a + 1) & 0xffff;
        this._setF(((rr >> 8) & (FS | FX | FY)) | (rr === 0 ? FZ : 0)
            | (((a ^ v ^ rr) & 0x1000) ? FH : 0)
            | ((~(a ^ v) & (a ^ rr) & 0x8000) ? FP : 0)
            | (r > 0xffff ? FC : 0));
        this.hl = rr;
    }

    _ed() {
        this._m1();
        const op = this._fetch();
        const pair = (k) => k === 0 ? this.bc : k === 1 ? this.de : k === 2 ? this.hl : this.sp;
        const setPair = (k, v) => { if (k === 0) this.bc = v; else if (k === 1) this.de = v; else if (k === 2) this.hl = v; else this.sp = v; };
        // IN r,(C) / OUT (C),r rows.
        if (op >= 0x40 && op <= 0x7f) {
            const k = (op >> 3) & 7;
            switch (op & 7) {
                case 0: { // IN r,(C) — r=6 sets flags only
                    const v = this.inPort(this.bc) & 0xff;
                    this.wz = (this.bc + 1) & 0xffff;
                    if (k !== 6) this._setR(k, v);
                    this._setF((this.f & FC) | (v & (FS | FX | FY)) | (v === 0 ? FZ : 0) | PARITY[v]);
                    return 12;
                }
                case 1: // OUT (C),r — r=6 outputs 0
                    this.outPort(this.bc, k === 6 ? 0 : this._getR(k));
                    this.wz = (this.bc + 1) & 0xffff;
                    return 12;
                case 2:
                    if (op & 8) this._adc16(pair(k >> 1)); else this._sbc16(pair(k >> 1));
                    return 15;
                case 3: {
                    const nn = this._fetch16();
                    if (op & 8) { setPair(k >> 1, this.read(nn) | (this.read((nn + 1) & 0xffff) << 8)); }
                    else { const v = pair(k >> 1); this.write(nn, v & 0xff); this.write((nn + 1) & 0xffff, v >> 8); }
                    this.wz = (nn + 1) & 0xffff;
                    return 20;
                }
                case 4: { // NEG (all mirrors)
                    const v = this.a;
                    this.a = 0;
                    this._sub8(v, false, false);
                    return 8;
                }
                case 5: // RETN / RETI (all mirrors): IFF1 <- IFF2
                    this.pc = this._pop16();
                    this.wz = this.pc;
                    this.iff1 = this.iff2;
                    return 14;
                case 6: // IM: pattern 0,0,1,2 by bits 4-3
                    this.im = [0, 0, 1, 2][k & 3];
                    return 8;
                default: // 7: LD I,A / LD R,A / LD A,I / LD A,R / RRD / RLD / NONI
                    switch (op) {
                        case 0x47: this.i = this.a; return 9;
                        case 0x4f: this.r = this.a; return 9;
                        case 0x57: case 0x5f: {
                            this.a = op === 0x57 ? this.i : this.r;
                            this._setF((this.f & FC) | (this.a & (FS | FX | FY))
                                | (this.a === 0 ? FZ : 0) | (this.iff2 ? FP : 0));
                            return 9;
                        }
                        case 0x67: { // RRD
                            const m = this.read(this.hl);
                            this.write(this.hl, ((this.a << 4) | (m >> 4)) & 0xff);
                            this.a = (this.a & 0xf0) | (m & 0x0f);
                            this.wz = (this.hl + 1) & 0xffff;
                            this._setF((this.f & FC) | (this.a & (FS | FX | FY))
                                | (this.a === 0 ? FZ : 0) | PARITY[this.a]);
                            return 18;
                        }
                        case 0x6f: { // RLD
                            const m = this.read(this.hl);
                            this.write(this.hl, ((m << 4) | (this.a & 0x0f)) & 0xff);
                            this.a = (this.a & 0xf0) | (m >> 4);
                            this.wz = (this.hl + 1) & 0xffff;
                            this._setF((this.f & FC) | (this.a & (FS | FX | FY))
                                | (this.a === 0 ? FZ : 0) | PARITY[this.a]);
                            return 18;
                        }
                        default: return 8;   // ED 77/7F: NONI
                    }
            }
        }
        // Block instructions.
        if (op >= 0xa0 && op <= 0xbb && (op & 4) === 0) {
            const dir = (op & 8) ? -1 : 1;      // LDI/LDD by bit 3
            const rep = op >= 0xb0;
            switch (op & 3) {
                case 0: { // LDI/LDD/LDIR/LDDR
                    const v = this.read(this.hl);
                    this.write(this.de, v);
                    this.hl = (this.hl + dir) & 0xffff;
                    this.de = (this.de + dir) & 0xffff;
                    this.bc = (this.bc - 1) & 0xffff;
                    const n = (this.a + v) & 0xff;
                    let f = (this.f & (FS | FZ | FC)) | (this.bc ? FP : 0)
                        | ((n & 2) ? FY : 0) | ((n & 8) ? FX : 0);
                    if (rep && this.bc) {
                        this.pc = (this.pc - 2) & 0xffff;
                        this.wz = (this.pc + 1) & 0xffff;
                        // Interrupted repeat: X/Y come from PC's high byte.
                        f = (f & ~(FX | FY)) | ((this.pc >> 8) & (FX | FY));
                        this._setF(f);
                        return 21;
                    }
                    this._setF(f);
                    return 16;
                }
                case 1: { // CPI/CPD/CPIR/CPDR
                    const v = this.read(this.hl);
                    const r = (this.a - v) & 0xff;
                    const hc = ((this.a ^ v ^ r) & 0x10) ? 1 : 0;
                    this.hl = (this.hl + dir) & 0xffff;
                    this.bc = (this.bc - 1) & 0xffff;
                    this.wz = (this.wz + dir) & 0xffff;
                    const n = (r - hc) & 0xff;
                    let f = (this.f & FC) | FN | (r & FS) | (r === 0 ? FZ : 0)
                        | (hc ? FH : 0) | (this.bc ? FP : 0)
                        | ((n & 2) ? FY : 0) | ((n & 8) ? FX : 0);
                    if (rep && this.bc && r !== 0) {
                        this.pc = (this.pc - 2) & 0xffff;
                        this.wz = (this.pc + 1) & 0xffff;
                        f = (f & ~(FX | FY)) | ((this.pc >> 8) & (FX | FY));
                        this._setF(f);
                        return 21;
                    }
                    this._setF(f);
                    return 16;
                }
                case 2: { // INI/IND/INIR/INDR
                    const v = this.inPort(this.bc) & 0xff;
                    this.wz = (this.bc + dir) & 0xffff;
                    this.write(this.hl, v);
                    this.hl = (this.hl + dir) & 0xffff;
                    this.b = (this.b - 1) & 0xff;
                    const k = v + ((this.c + dir) & 0xff);
                    let f = (this.b & (FS | FX | FY)) | (this.b === 0 ? FZ : 0)
                        | ((v & 0x80) ? FN : 0) | (k > 0xff ? (FH | FC) : 0)
                        | PARITY[(k & 7) ^ this.b];
                    if (rep && this.b) {
                        this.pc = (this.pc - 2) & 0xffff;
                        f = this._ioRepeatFlags(f, v);
                        this._setF(f);
                        return 21;
                    }
                    this._setF(f);
                    return 16;
                }
                default: { // OUTI/OUTD/OTIR/OTDR
                    const v = this.read(this.hl);
                    this.hl = (this.hl + dir) & 0xffff;
                    this.b = (this.b - 1) & 0xff;
                    this.outPort((this.b << 8) | this.c, v);
                    this.wz = (((this.b << 8) | this.c) + dir) & 0xffff;
                    const k = v + this.l;
                    let f = (this.b & (FS | FX | FY)) | (this.b === 0 ? FZ : 0)
                        | ((v & 0x80) ? FN : 0) | (k > 0xff ? (FH | FC) : 0)
                        | PARITY[(k & 7) ^ this.b];
                    if (rep && this.b) {
                        this.pc = (this.pc - 2) & 0xffff;
                        f = this._ioRepeatFlags(f, v);
                        this._setF(f);
                        return 21;
                    }
                    this._setF(f);
                    return 16;
                }
            }
        }
        return 8;   // every other ED opcode: NONI
    }

    /** The interrupted-repeat flag corrections for INxR/OTxR (the behavior
     *  nailed down by the 2021-era block-flags research the suite encodes):
     *  X/Y from PC high; when the transfer carried, H tells whether B's low
     *  nibble borrows/carries on the NEXT step and P flips by the parity
     *  delta of B±1 vs B (direction by the N flag). */
    _ioRepeatFlags(f, v) {
        // Derived from the vectors themselves and validated 3,990/3,990
        // before landing: WZ = pc+1 (overriding the bc-based one); X/Y from
        // PC high; P = baseP ^ 1 ^ parity((B+adj)&7) with adj = carry ?
        // (N ? -1 : +1) : 0; H only under carry, testing B's low nibble at
        // the borrow/carry edge for the NEXT step.
        this.wz = (this.pc + 1) & 0xffff;
        f = (f & ~(FX | FY)) | ((this.pc >> 8) & (FX | FY));
        const carry = (f & FC) !== 0;
        const adj = carry ? ((v & 0x80) ? -1 : 1) : 0;
        f ^= FP ^ PARITY[(this.b + adj) & 7];
        if (carry) {
            f = (f & ~FH) | (((v & 0x80)
                ? (this.b & 0x0f) === 0x00
                : (this.b & 0x0f) === 0x0f) ? FH : 0);
        } else {
            f &= ~FH;
        }
        return f;
    }

    /** One ALU-group operation (ADD ADC SUB SBC AND XOR OR CP) on A. */
    _aluOp(g, v) {
        switch (g) {
            case 0: this._add8(v, false); break;
            case 1: this._add8(v, true); break;
            case 2: this._sub8(v, false, false); break;
            case 3: this._sub8(v, true, false); break;
            case 4: this._logic(v, '&'); break;
            case 5: this._logic(v, '^'); break;
            case 6: this._logic(v, '|'); break;
            default: this._sub8(v, false, true);
        }
    }

    _ddfd(iy, qBefore) {
        this._m1();
        const op = this._fetch();
        const getIx = () => iy ? this.iy : this.ix;
        const setIx = (v) => { if (iy) this.iy = v & 0xffff; else this.ix = v & 0xffff; };
        const getH = () => getIx() >> 8;
        const setH = (v) => setIx((getIx() & 0xff) | ((v & 0xff) << 8));
        const getL = () => getIx() & 0xff;
        const setL = (v) => setIx((getIx() & 0xff00) | (v & 0xff));
        /** (IX+d): fetch the displacement, compute the address, set MEMPTR. */
        const disp = () => {
            const d = this._fetch();
            const a = (getIx() + (d << 24 >> 24)) & 0xffff;
            this.wz = a;
            return a;
        };
        // Substituted register access: H/L mean the index halves — EXCEPT in
        // (IX+d) memory forms, where the register operand is the REAL H/L.
        const sub = (k) => k === 4 ? getH() : k === 5 ? getL() : this._getR(k);
        const setSub = (k, v) => { if (k === 4) setH(v); else if (k === 5) setL(v); else this._setR(k, v); };

        // LD block with substitution.
        if (op >= 0x40 && op <= 0x7f && op !== 0x76) {
            const dst = (op >> 3) & 7;
            const src = op & 7;
            if (src === 6) { const a = disp(); this._setR(dst, this.read(a)); return 19; }
            if (dst === 6) { const a = disp(); this.write(a, this._getR(src)); return 19; }
            setSub(dst, sub(src));
            return 8;
        }
        // ALU block with substitution.
        if (op >= 0x80 && op <= 0xbf) {
            if ((op & 7) === 6) { this._aluOp((op >> 3) & 7, this.read(disp())); return 19; }
            this._aluOp((op >> 3) & 7, sub(op & 7));
            return 8;
        }
        switch (op) {
            case 0x09: setIx(this._add16(getIx(), this.bc)); return 15;
            case 0x19: setIx(this._add16(getIx(), this.de)); return 15;
            case 0x29: setIx(this._add16(getIx(), getIx())); return 15;
            case 0x39: setIx(this._add16(getIx(), this.sp)); return 15;
            case 0x21: setIx(this._fetch16()); return 14;
            case 0x22: { const nn = this._fetch16(); const v = getIx(); this.write(nn, v & 0xff); this.write((nn + 1) & 0xffff, v >> 8); this.wz = (nn + 1) & 0xffff; return 20; }
            case 0x2a: { const nn = this._fetch16(); setIx(this.read(nn) | (this.read((nn + 1) & 0xffff) << 8)); this.wz = (nn + 1) & 0xffff; return 20; }
            case 0x23: setIx(getIx() + 1); return 10;
            case 0x2b: setIx(getIx() - 1); return 10;
            case 0x24: setH(this._inc8(getH())); return 8;
            case 0x25: setH(this._dec8(getH())); return 8;
            case 0x26: setH(this._fetch()); return 11;
            case 0x2c: setL(this._inc8(getL())); return 8;
            case 0x2d: setL(this._dec8(getL())); return 8;
            case 0x2e: setL(this._fetch()); return 11;
            case 0x34: { const a = disp(); this.write(a, this._inc8(this.read(a))); return 23; }
            case 0x35: { const a = disp(); this.write(a, this._dec8(this.read(a))); return 23; }
            case 0x36: { const a = disp(); this.write(a, this._fetch()); return 19; }
            case 0xe1: setIx(this._pop16()); return 14;
            case 0xe5: this._push16(getIx()); return 15;
            case 0xe3: {
                const lo = this.read(this.sp); const hi = this.read((this.sp + 1) & 0xffff);
                this.write(this.sp, getIx() & 0xff); this.write((this.sp + 1) & 0xffff, getIx() >> 8);
                setIx(lo | (hi << 8)); this.wz = getIx(); return 23;
            }
            case 0xe9: this.pc = getIx(); return 8;
            case 0xf9: this.sp = getIx(); return 10;
            case 0xcb: {
                // DDCB/FDCB: displacement BEFORE the sub-opcode, which is
                // fetched WITHOUT an M1 refresh (R advances only twice).
                const a = disp();
                const so = this._fetch();
                const k = so & 7;
                const grp = so >> 6;
                const bit = (so >> 3) & 7;
                if (grp === 1) {   // BIT b,(IX+d): X/Y from the ADDRESS high byte
                    const v = this.read(a);
                    const set = v & (1 << bit);
                    this._setF((this.f & FC) | FH | (set ? 0 : (FZ | FP))
                        | (bit === 7 && set ? FS : 0) | ((a >> 8) & (FX | FY)));
                    return 20;
                }
                let r = this.read(a);
                r = grp === 0 ? this._rot((so >> 3) & 7, r)
                    : grp === 2 ? (r & ~(1 << bit)) & 0xff : r | (1 << bit);
                this.write(a, r);
                if (k !== 6) this._setR(k, r);   // undocumented copy-to-register
                return 23;
            }
            default:
                // Any other opcode: the prefix was a 4-cycle no-op before a
                // normal instruction (its own M1 already counted above).
                // The prefix CLEARS the Q consideration: a prefixed SCF/CCF
                // always takes its X/Y from F|A (vector-established — the
                // failing quarter were exactly the q!=0 cases).
                void qBefore;
                return 4 + this._main(op, 0);
        }
    }

    /** Condition code by index: NZ Z NC C PO PE P M. */
    _cc(k) {
        switch (k) {
            case 0: return !(this.f & FZ); case 1: return !!(this.f & FZ);
            case 2: return !(this.f & FC); case 3: return !!(this.f & FC);
            case 4: return !(this.f & FP); case 5: return !!(this.f & FP);
            case 6: return !(this.f & FS); default: return !!(this.f & FS);
        }
    }
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
            this._aluOp((op >> 3) & 7, this._getR(op & 7));
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
            // ---- accumulator loads via pairs (MEMPTR rules per the suite) --
            case 0x02: this.write(this.bc, this.a); this.wz = ((this.bc + 1) & 0xff) | (this.a << 8); return 7;
            case 0x12: this.write(this.de, this.a); this.wz = ((this.de + 1) & 0xff) | (this.a << 8); return 7;
            case 0x0a: this.a = this.read(this.bc); this.wz = (this.bc + 1) & 0xffff; return 7;
            case 0x1a: this.a = this.read(this.de); this.wz = (this.de + 1) & 0xffff; return 7;
            case 0x22: { const nn = this._fetch16(); this.write(nn, this.l); this.write((nn + 1) & 0xffff, this.h); this.wz = (nn + 1) & 0xffff; return 16; }
            case 0x2a: { const nn = this._fetch16(); this.l = this.read(nn); this.h = this.read((nn + 1) & 0xffff); this.wz = (nn + 1) & 0xffff; return 16; }
            case 0x32: { const nn = this._fetch16(); this.write(nn, this.a); this.wz = ((nn + 1) & 0xff) | (this.a << 8); return 13; }
            case 0x3a: { const nn = this._fetch16(); this.a = this.read(nn); this.wz = (nn + 1) & 0xffff; return 13; }
            // ---- accumulator rotates (X/Y from the result, S/Z/P kept) ----
            case 0x07: { const c = this.a >> 7; this.a = ((this.a << 1) | c) & 0xff; this._setF((this.f & (FS | FZ | FP)) | (this.a & (FX | FY)) | c); return 4; }
            case 0x0f: { const c = this.a & 1; this.a = ((this.a >> 1) | (c << 7)) & 0xff; this._setF((this.f & (FS | FZ | FP)) | (this.a & (FX | FY)) | c); return 4; }
            case 0x17: { const c = this.a >> 7; this.a = ((this.a << 1) | (this.f & FC)) & 0xff; this._setF((this.f & (FS | FZ | FP)) | (this.a & (FX | FY)) | c); return 4; }
            case 0x1f: { const c = this.a & 1; this.a = ((this.a >> 1) | ((this.f & FC) << 7)) & 0xff; this._setF((this.f & (FS | FZ | FP)) | (this.a & (FX | FY)) | c); return 4; }
            case 0x27: { // DAA
                let corr = 0; let c = this.f & FC;
                if ((this.f & FH) || (this.a & 0x0f) > 9) corr = 6;
                if (c || this.a > 0x99) { corr |= 0x60; c = FC; }
                const before = this.a;
                this.a = (this.f & FN) ? (this.a - corr) & 0xff : (this.a + corr) & 0xff;
                this._setF((this.f & FN) | c | (this.a & (FS | FX | FY)) | (this.a === 0 ? FZ : 0)
                    | PARITY[this.a] | (((before ^ this.a) & 0x10) ? FH : 0));
                return 4;
            }
            // ---- exchanges ------------------------------------------------
            case 0x08: { const t = this.af; this.af = (this.a_ << 8) | this.f_; this.a_ = t >> 8; this.f_ = t & 0xff; return 4; }
            case 0xd9: {
                let t = this.bc; this.bc = (this.b_ << 8) | this.c_; this.b_ = t >> 8; this.c_ = t & 0xff;
                t = this.de; this.de = (this.d_ << 8) | this.e_; this.d_ = t >> 8; this.e_ = t & 0xff;
                t = this.hl; this.hl = (this.h_ << 8) | this.l_; this.h_ = t >> 8; this.l_ = t & 0xff;
                return 4;
            }
            case 0xeb: { const t = this.de; this.de = this.hl; this.hl = t; return 4; }
            case 0xe3: {
                const lo = this.read(this.sp); const hi = this.read((this.sp + 1) & 0xffff);
                this.write(this.sp, this.l); this.write((this.sp + 1) & 0xffff, this.h);
                this.hl = lo | (hi << 8); this.wz = this.hl; return 19;
            }
            // ---- relative jumps -------------------------------------------
            case 0x10: { // DJNZ
                const d = this._fetch();
                this.b = (this.b - 1) & 0xff;
                if (this.b) { this.pc = (this.pc + (d << 24 >> 24)) & 0xffff; this.wz = this.pc; return 13; }
                return 8;
            }
            case 0x18: { const d = this._fetch(); this.pc = (this.pc + (d << 24 >> 24)) & 0xffff; this.wz = this.pc; return 12; }
            case 0x20: case 0x28: case 0x30: case 0x38: {
                const d = this._fetch();
                if (this._cc((op >> 3) & 3)) { this.pc = (this.pc + (d << 24 >> 24)) & 0xffff; this.wz = this.pc; return 12; }
                return 7;
            }
            // ---- absolute jumps / calls / returns -------------------------
            case 0xc3: this.pc = this._fetch16(); this.wz = this.pc; return 10;
            case 0xc2: case 0xca: case 0xd2: case 0xda: case 0xe2: case 0xea: case 0xf2: case 0xfa: {
                const nn = this._fetch16(); this.wz = nn;
                if (this._cc((op >> 3) & 7)) this.pc = nn;
                return 10;
            }
            case 0xcd: { const nn = this._fetch16(); this._push16(this.pc); this.pc = nn; this.wz = nn; return 17; }
            case 0xc4: case 0xcc: case 0xd4: case 0xdc: case 0xe4: case 0xec: case 0xf4: case 0xfc: {
                const nn = this._fetch16(); this.wz = nn;
                if (this._cc((op >> 3) & 7)) { this._push16(this.pc); this.pc = nn; return 17; }
                return 10;
            }
            case 0xc9: this.pc = this._pop16(); this.wz = this.pc; return 10;
            case 0xc0: case 0xc8: case 0xd0: case 0xd8: case 0xe0: case 0xe8: case 0xf0: case 0xf8:
                if (this._cc((op >> 3) & 7)) { this.pc = this._pop16(); this.wz = this.pc; return 11; }
                return 5;
            case 0xc7: case 0xcf: case 0xd7: case 0xdf: case 0xe7: case 0xef: case 0xf7: case 0xff:
                this._push16(this.pc); this.pc = op & 0x38; this.wz = this.pc; return 11;
            case 0xe9: this.pc = this.hl; return 4;
            // ---- stack ----------------------------------------------------
            case 0xc5: this._push16(this.bc); return 11;
            case 0xd5: this._push16(this.de); return 11;
            case 0xe5: this._push16(this.hl); return 11;
            case 0xf5: this._push16(this.af); return 11;
            case 0xc1: this.bc = this._pop16(); return 10;
            case 0xd1: this.de = this._pop16(); return 10;
            case 0xe1: this.hl = this._pop16(); return 10;
            case 0xf1: this.af = this._pop16(); return 10;
            case 0xf9: this.sp = this.hl; return 6;
            // ---- I/O ------------------------------------------------------
            case 0xd3: { const n = this._fetch(); const port = n | (this.a << 8); this.outPort(port, this.a); this.wz = ((n + 1) & 0xff) | (this.a << 8); return 11; }
            case 0xdb: { const n = this._fetch(); const port = n | (this.a << 8); this.a = this.inPort(port) & 0xff; this.wz = (port + 1) & 0xffff; return 11; }
            // ---- interrupt enables ---------------------------------------
            case 0xf3: this.iff1 = 0; this.iff2 = 0; return 4;
            case 0xfb: this.iff1 = 1; this.iff2 = 1; this.eiLatch = 1; return 4;
            case 0xcb: return this._cb();
            case 0xed: return this._ed();
            case 0xdd: return this._ddfd(false, qBefore);
            case 0xfd: return this._ddfd(true, qBefore);
            default:
                throw new Error(`z80: opcode ${op.toString(16).padStart(2, '0')} not yet implemented`);
        }
    }
}

export default Z80;
