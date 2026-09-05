/**
 * 8086 core — the retro tier's third CPU, our own, built the W65C02 and Z80
 * way: bus-agnostic (read/write callbacks), instruction-stepped, ground
 * against the SingleStepTests 8086 suite (MIT; 324 opcode files × 2,000
 * vectors, generated on an Intel P80C86A-2 by ArduinoX86, UNDOCUMENTED
 * behavior included: SETMO/SETMOC, SALC, the 0x60-0x6F and 0xC0/C1/C8/C9
 * decode aliases, POP CS, the F6/F7 reg=1 TEST alias).
 *
 * STATUS: VECTOR-COMPLETE — 323/323 files, 646,000 vectors, every opcode
 * the suite ships. The eleven it does not ship (0x0f POP CS, the five
 * prefixes, 0x9b WAIT, 0xf4 HLT) are implemented but unverified; there is
 * nothing to verify them against.
 *
 * THREE THINGS DIFFER FROM EVERY OTHER CORE HERE, and each one is a bug
 * waiting to happen in code that assumes the Z80 shape:
 *
 *   - Addresses are TWENTY bits. The bus sees a physical address, not a
 *     16-bit one: (seg << 4) + off, wrapped at 1 MB. There is no A20 gate.
 *   - Offsets wrap at SIXTEEN bits INSIDE the segment. A word read at
 *     offset 0xffff reads offset 0x0000 of the SAME segment for its high
 *     byte -- it does not spill into the next paragraph.
 *   - There is no single program counter. CS:IP is the pair; the debug
 *     layer derives a flat pc from it and must never write one back.
 *
 * Accuracy tier: architectural state, verified opcode by opcode against the
 * vector suite via scripts/grind-i8086.mjs. Cycle counts are the published
 * 8086 timings plus the EA cost, NOT vector-verified -- the suite's cycle
 * arrays are prefetch-queue-inclusive bus traces and mean nothing for an
 * instruction-stepped core, so the grinder does not compare them. The
 * machine layer advances peripherals at instruction granularity, which at
 * millisecond trace resolution is indistinguishable.
 *
 * NOT modeled, deliberately: the prefetch queue and the BIU; the 8087 escape
 * (0xd8-0xdf reads its operand and does nothing else); INTR/NMI delivery,
 * which belongs to the machine layer; and the 8086 erratum where an
 * interrupt taken mid-REP loses a segment override on resumption -- with no
 * interrupt delivery there is nothing yet for it to happen to.
 *
 * MODELLED BUT NOT VECTOR-VERIFIED: the TRAP FLAG. TF sampled at an
 * instruction boundary raises INT 1 after the instruction, which is what
 * DEBUG.COM's `t` and every period single-step tracer are built on. It was
 * absent for the tier's first weeks and, worse, was not on the list above --
 * so a program that installed its own tracer got silence, and the list that
 * readers trust said nothing about it. The suite cannot verify this, and that
 * is MEASURED rather than taken from its README: across all 646,000 vectors
 * TF is set in the initial flags of exactly ZERO, and IF in exactly zero. The
 * grind is blind to this code by construction -- 646,000/646,000 with the
 * trap implemented, and the same without it -- so what holds it up is the
 * behavioural tests below and period binaries that use it. DEBUG.COM's `t` is
 * the acceptance, and it is owed rather than done.
 * Two things about it are decided rather than measured, and are recorded as
 * such at the sampling site: whether the segment-load shadow inhibits a trap
 * (taken: yes, on the grounds that the shadow exists to protect an
 * `mov ss` / `mov sp` pair and a trap between them corrupts the same stack),
 * and the ordering when an INT instruction executes with TF already set.
 *
 * THE 80186 VARIANT (added 2026-09-04, E6.8.1). `new I8086(bus, {variant:
 * '80186'})` is the same core with the fifteen opcodes the 186 put in holes
 * the 8086 leaves as decode aliases -- PUSHA, POPA, BOUND, PUSH imm8/imm16,
 * the three-operand IMUL, INS/OUTS, shift-by-immediate, ENTER, LEAVE -- plus
 * the two changes to instructions BOTH parts have: shift counts mask to five
 * bits, and D0-D3/C0-C1 reg=6 is a second SHL rather than SETMO. One class
 * answers for both; the variant is read at dispatch and never cached into a
 * table, so there is no second core to drift.
 *
 * GRADED BY A DIFFERENT CHIP, and the gap is the interesting part.
 * `scripts/grind-i8086-v20.mjs` runs 132,532/132,532 vectors from the
 * SingleStepTests **v20** suite (MIT), because there is no hardware-generated
 * 80186 suite and there is unlikely ever to be one. The NEC V20 implements
 * the 186's additions with the same encodings, so it grades those. It does
 * NOT grade the two shared-instruction changes, because the V20 sides with
 * the 8086 on both:
 *
 *   - The V20 does not mask shift counts. MEASURED, not assumed: with masking
 *     on, C0.4+C1.4 score 470/600; with it off, 579/600. So the grinder
 *     EXCLUDES the 39,898 vectors whose count exceeds 31 and says so in its
 *     summary, and `test/i8086-186.test.mjs` is what actually holds the
 *     masking up.
 *   - REPC/REPNC (0x64/0x65) are NEC prefixes with no 186 equivalent; 3,570
 *     vectors use them and are excluded by name.
 *
 * What the V20 suite DID teach, which no reading of a manual would have:
 * **OF is defined for every shift count on the later part, not only for a
 * count of one** -- and the rule is the count-of-one rule applied to the LAST
 * iteration rather than a new rule. Six C0 files failed on bit 0x800 alone
 * until that landed. The 8086 path is bit-identical either way, because at a
 * count of one the pre-final value IS the original.
 *
 * A pass here is evidence the 186 additions are right. It is NOT a claim of
 * V20 compatibility: the V20's own instructions (the 0x0F bit-manipulation
 * group, 8080 emulation mode) are not implemented and are not pretended to be.
 *
 * @module
 */

/** A 16-bit word read as a signed number -- BOUND and IMUL both need it. */
const NOOP = () => {};
const sx16 = (v) => ((v & 0xffff) ^ 0x8000) - 0x8000;

// Flag bits in FLAGS.
const CF = 0x0001, PF = 0x0004, AF = 0x0010, ZF = 0x0040, SF = 0x0080;
const TF = 0x0100, IF = 0x0200, DF = 0x0400, OF = 0x0800;

// The 8086 reads bit 1 and bits 12-15 as 1 and bits 3 and 5 as 0, always,
// whatever POPF or IRET was handed. PUSHF hands those bits straight back
// out, so the vectors compare them and a core that stores a "clean" 16-bit
// flags word fails every test that touches the stack.
const F_ON = 0xf002, F_OFF = 0x0028;
const fixFlags = (f) => (f | F_ON) & ~F_OFF;

const PARITY = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
    let b = i, c = 0;
    while (b) { c ^= b & 1; b >>= 1; }
    PARITY[i] = c ? 0 : PF;      // even parity sets PF
}

/** Thrown by step() for an opcode this core does not implement yet. The
 *  grinder scores these NOT-YET; nothing may score them as pass. */
export class Unimplemented extends Error {
    constructor(op) {
        super(`8086: opcode ${op.toString(16).padStart(2, '0')} not implemented`);
        this.name = 'Unimplemented';
        this.opcode = op;
    }
}

export class I8086 {
    /** @param {{ read: (a:number)=>number, write:(a:number,v:number)=>void,
     *            in?:(port:number)=>number, out?:(port:number,v:number)=>void }} bus */
    constructor(bus, opts = {}) {
        // WHICH CHIP. '8086' is the default and is what 646,000 vectors
        // verify; '80186' adds the fifteen opcodes the 186 put in the holes
        // the 8086 left as decode aliases, and masks shift counts to five
        // bits. The flag is read at DISPATCH, never cached into a table, so
        // one core class answers for both and there is no second core to
        // drift. Anything that reads this must treat '8086' as the fallback:
        // an unknown string is a caller error and is rejected here rather
        // than silently becoming a 186.
        if (opts.variant !== undefined && opts.variant !== '8086' && opts.variant !== '80186') {
            throw new Error(`8086: unknown variant ${JSON.stringify(opts.variant)} `
                + "-- expected '8086' or '80186'");
        }
        this.variant = opts.variant || '8086';
        this._is186 = this.variant === '80186';
        this.read = bus.read;
        this.write = bus.write;
        this._inPort = bus.in || (() => 0xff);
        this.inPort = (p) => { if (this.busTrace !== null) this.busTrace.push(3, p & 0xffff); return this._inPort(p); };
        this._outPort = bus.out || (() => {});
        this.outPort = (p, v) => { if (this.busTrace !== null) this.busTrace.push(4, p & 0xffff); return this._outPort(p, v); };
        // Asked between REP iterations: is an interrupt waiting? The machine
        // layer owns the answer (PIC line AND the interrupt flag); a bare
        // core with no machine says no and REP runs to completion, which is
        // what every vector in the suite expects.
        this.intPending = bus.intPending || (() => false);
        this.reset();
    }

    reset() {
        this.ax = 0; this.bx = 0; this.cx = 0; this.dx = 0;
        this.sp = 0; this.bp = 0; this.si = 0; this.di = 0;
        this.ip = 0;
        // Power-on vector: FFFF:0000, the top sixteen bytes of the space.
        this.cs = 0xffff; this.ds = 0; this.es = 0; this.ss = 0;
        this.flags = fixFlags(0);
        this.halted = false;
        this.cycles = 0;
        /** null, or an array the bus operations are appended to. See _rd8. */
        this.busTrace = null;
        this._fsOpcodeSeen = false;
        this._tookBranch = false;
        this._seg = -1;          // active segment override VALUE, -1 for none
        this._rep = 0;           // 0, 0xf2 (REPNE) or 0xf3 (REP/REPE)
        // Set by an instruction that loads a segment register; blocks one
        // interrupt. See canTakeInterrupt().
        this.intShadow = 0;
        this._repIp = 0;
        /** How many times a REP has been cut short by an interrupt. Counted
         *  because the erratum it triggers is otherwise invisible. */
        this.repInterrupted = 0;
        this.mod = 0; this.reg = 0; this.rm = 0;
        this.ea = 0; this.eaSeg = 0;
    }

    // ---- byte views over the word registers -----------------------------
    get al() { return this.ax & 0xff; }
    set al(v) { this.ax = (this.ax & 0xff00) | (v & 0xff); }
    get ah() { return (this.ax >> 8) & 0xff; }
    set ah(v) { this.ax = (this.ax & 0x00ff) | ((v & 0xff) << 8); }
    get bl() { return this.bx & 0xff; }
    set bl(v) { this.bx = (this.bx & 0xff00) | (v & 0xff); }
    get bh() { return (this.bx >> 8) & 0xff; }
    set bh(v) { this.bx = (this.bx & 0x00ff) | ((v & 0xff) << 8); }
    get cl() { return this.cx & 0xff; }
    set cl(v) { this.cx = (this.cx & 0xff00) | (v & 0xff); }
    get ch() { return (this.cx >> 8) & 0xff; }
    set ch(v) { this.cx = (this.cx & 0x00ff) | ((v & 0xff) << 8); }
    get dl() { return this.dx & 0xff; }
    set dl(v) { this.dx = (this.dx & 0xff00) | (v & 0xff); }
    get dh() { return (this.dx >> 8) & 0xff; }
    set dh(v) { this.dx = (this.dx & 0x00ff) | ((v & 0xff) << 8); }

    /** The flat address CS:IP names — what a debugger anchors on. */
    get pc() { return ((this.cs << 4) + this.ip) & 0xfffff; }

    /**
     * May a maskable interrupt be delivered right now? The machine layer
     * asks this instead of testing IF itself, because IF is only half of it.
     *
     * THE OTHER HALF IS THE SEGMENT-LOAD SHADOW, and it exists so that
     *
     *     mov ss, ax
     *     mov sp, 400h
     *
     * cannot be interrupted BETWEEN those two instructions. There is an
     * instant there where SS is new and SP is old — the stack points into
     * nowhere — and an interrupt taken in that instant pushes three words
     * into whatever that address happens to be. So the 8086 inhibits the
     * interrupt for one instruction after ANY segment-register load, which
     * is exactly long enough for the pair to complete. (The 286 narrowed
     * this to SS alone; on an 8086 it is all four.)
     *
     * The vector suite cannot test this — its own README says the interrupt
     * and trap flags are not exercised — so it is verified behaviourally
     * instead, by delivering an IRQ and requiring it to arrive one
     * instruction later than it otherwise would.
     */
    canTakeInterrupt() { return (this.flags & IF) !== 0 && this.intShadow === 0; }

    // ---- memory ---------------------------------------------------------
    /** seg:off to a physical address. Both halves wrap: the offset at 16
     *  bits, the sum at 20 (the 8086 has no A20 gate to hold it open). */
    static phys(seg, off) { return (((seg & 0xffff) << 4) + (off & 0xffff)) & 0xfffff; }

    /**
     * THE BUS TRACE (E6.8.4c). `cpu.busTrace = []` records the sequence of bus
     * operations an instruction performs -- fetches, data reads and writes,
     * port reads and writes, in order, with their physical addresses. Null by
     * default and one truthiness test per access when off, which is the same
     * zero-cost rule the write watchpoint and the port hooks follow.
     *
     * It exists because the BIU model (src/i8088-biu.js) is fed by it rather
     * than by making this core cycle-stepped. A cycle-stepped core would touch
     * the instruction path everything else in the tier depends on -- measured
     * at 19x real time on the bare core -- to serve a DEBUGGING mode. An
     * access trace costs nothing when nobody is recording and carries exactly
     * what a bus scheduler needs: what the EU asked for, and in what order.
     *
     * What it deliberately does NOT carry is WHEN within the instruction each
     * access happened. That is the known boundary of this design and the
     * reason `tstate` is not among the scores the grinder claims.
     *
     * Kinds: 0 fetch, 1 read, 2 write, 3 in, 4 out.
     */
    // THE FAST PATH IS THE ORIGINAL ONE-LINER, and that is not style. Writing
    // the trace check inline turned these from single expressions into
    // multi-statement bodies, and the bench caught the cost by INVERSION:
    // machine/core rose from 0.284 to 0.417 and boot/core from 0.176 to 0.218.
    // Both ratios "improving" meant the CORE had slowed -- `core` is pure core
    // and takes the full hit, while the other two spend most of their time
    // elsewhere. Roughly a third of the bare core's speed, to serve a
    // debugging mode that is off by default, which is exactly what this
    // design set out to avoid.
    //
    // So the traced path is a separate, cold method and the untraced path is
    // byte-for-byte what it was.
    _rd8(seg, off) {
        return this.busTrace === null
            ? this.read(I8086.phys(seg, off)) & 0xff
            : this._rd8Traced(seg, off);
    }

    _rd8Traced(seg, off) {
        const a = I8086.phys(seg, off);
        this.busTrace.push(1, a);
        return this.read(a) & 0xff;
    }

    _wr8(seg, off, v) {
        if (this.busTrace === null) { this.write(I8086.phys(seg, off), v & 0xff); return; }
        const a = I8086.phys(seg, off);
        this.busTrace.push(2, a);
        this.write(a, v & 0xff);
    }
    _rd16(seg, off) {
        return this._rd8(seg, off) | (this._rd8(seg, (off + 1) & 0xffff) << 8);
    }
    _wr16(seg, off, v) {
        this._wr8(seg, off, v & 0xff);
        this._wr8(seg, (off + 1) & 0xffff, (v >> 8) & 0xff);
    }

    // ---- instruction fetch ----------------------------------------------
    /** A FETCH IS NOT A READ, and this no longer goes through _rd8 for that
     *  reason: routing it there would record every instruction byte twice --
     *  once as the fetch it is and once as a data read it is not -- and a bus
     *  scheduler fed that trace would invent a memory cycle per opcode byte. */
    _fetch8() {
        if (this.busTrace !== null) return this._fetch8Traced();
        const b = this.read(I8086.phys(this.cs, this.ip)) & 0xff;
        this.ip = (this.ip + 1) & 0xffff;
        return b;
    }

    _fetch8Traced() {
        const a = I8086.phys(this.cs, this.ip);
        // KIND 0 IS AN 'F' AND KIND 5 IS AN 'S', which is the queue-status
        // distinction the 8088 puts on its QS0/QS1 lines: F for the first byte
        // of an instruction OR of a prefix, S for every subsequent byte -- a
        // ModR/M, a displacement, an immediate.
        //
        // The core already knows which is which without a queue model, because
        // prefixes are eaten in step()'s prefix loop and the opcode is the
        // first fetch after it. `_fsOpcodeSeen` is cleared per instruction and
        // set by that first fetch, so everything after it is an operand.
        this.busTrace.push(this._fsOpcodeSeen ? 5 : 0, a);
        this._fsOpcodeSeen = true;
        // Where the queue WOULD continue if this instruction did not branch.
        // Compared after execution to decide whether the queue was flushed.
        this._seqIp = (this.ip + 1) & 0xffff;
        this._seqCs = this.cs;
        const b = this.read(a) & 0xff;
        this.ip = (this.ip + 1) & 0xffff;
        return b;
    }
    _fetchS8() { const b = this._fetch8(); return b & 0x80 ? b - 256 : b; }
    _fetch16() { return this._fetch8() | (this._fetch8() << 8); }

    // ---- stack ----------------------------------------------------------
    _push(v) { this.sp = (this.sp - 2) & 0xffff; this._wr16(this.ss, this.sp, v); }
    _pop() { const v = this._rd16(this.ss, this.sp); this.sp = (this.sp + 2) & 0xffff; return v; }

    /** PUSH of a register reads it AFTER the decrement, so `push sp` stores
     *  SP-2 and not SP. The 286 changed this, and detecting the difference
     *  is how period software tells an 8086 from its successors, so it is
     *  not a rough edge to smooth off. */
    _pushR16(i) {
        this.sp = (this.sp - 2) & 0xffff;
        this._wr16(this.ss, this.sp, i === 4 ? this.sp : this._r16(i));
    }

    // ---- ModR/M ---------------------------------------------------------
    /** Decode the ModR/M byte and, for a memory form, the effective address
     *  and its segment. The default-segment rule lives HERE and nowhere else:
     *  anything reached through BP belongs to SS, everything else to DS, and
     *  an override replaces that choice -- except for a string destination,
     *  which is always ES:DI and never asks this function. */
    _modrm() {
        const m = this._fetch8();
        this.mod = m >> 6; this.reg = (m >> 3) & 7; this.rm = m & 7;
        if (this.mod === 3) { this.ea = 0; this.eaSeg = 0; return 0; }
        let base = 0, seg = this.ds, cost;
        switch (this.rm) {
            case 0: base = this.bx + this.si; cost = 7; break;
            case 1: base = this.bx + this.di; cost = 8; break;
            case 2: base = this.bp + this.si; seg = this.ss; cost = 8; break;
            case 3: base = this.bp + this.di; seg = this.ss; cost = 7; break;
            case 4: base = this.si; cost = 5; break;
            case 5: base = this.di; cost = 5; break;
            case 6:
                if (this.mod === 0) { base = this._fetch16(); cost = 6; }
                else { base = this.bp; seg = this.ss; cost = 5; }
                break;
            default: base = this.bx; cost = 5; break;
        }
        if (this.mod === 1) { base += this._fetchS8(); cost += 4; }
        else if (this.mod === 2) { base += this._fetch16(); cost += 4; }
        this.ea = base & 0xffff;
        this.eaSeg = this._seg >= 0 ? this._seg : seg;
        return cost;
    }

    // ---- register files -------------------------------------------------
    _r8(i) {
        switch (i) {
            case 0: return this.al; case 1: return this.cl;
            case 2: return this.dl; case 3: return this.bl;
            case 4: return this.ah; case 5: return this.ch;
            case 6: return this.dh; default: return this.bh;
        }
    }
    _r8set(i, v) {
        switch (i) {
            case 0: this.al = v; break; case 1: this.cl = v; break;
            case 2: this.dl = v; break; case 3: this.bl = v; break;
            case 4: this.ah = v; break; case 5: this.ch = v; break;
            case 6: this.dh = v; break; default: this.bh = v; break;
        }
    }
    _r16(i) {
        switch (i) {
            case 0: return this.ax; case 1: return this.cx;
            case 2: return this.dx; case 3: return this.bx;
            case 4: return this.sp; case 5: return this.bp;
            case 6: return this.si; default: return this.di;
        }
    }
    _r16set(i, v) {
        v &= 0xffff;
        switch (i) {
            case 0: this.ax = v; break; case 1: this.cx = v; break;
            case 2: this.dx = v; break; case 3: this.bx = v; break;
            case 4: this.sp = v; break; case 5: this.bp = v; break;
            case 6: this.si = v; break; default: this.di = v; break;
        }
    }
    /** Only two bits of the ModR/M reg field select a segment register:
     *  8C/8E with reg 4-7 alias to 0-3 rather than faulting, and the suite
     *  puts random values there precisely to catch a core that masks with 7. */
    _sreg(i) {
        switch (i & 3) {
            case 0: return this.es; case 1: return this.cs;
            case 2: return this.ss; default: return this.ds;
        }
    }
    _sregSet(i, v) {
        v &= 0xffff;
        switch (i & 3) {
            case 0: this.es = v; break; case 1: this.cs = v; break;
            case 2: this.ss = v; break; default: this.ds = v; break;
        }
    }

    // ---- r/m operands ---------------------------------------------------
    _rm8() { return this.mod === 3 ? this._r8(this.rm) : this._rd8(this.eaSeg, this.ea); }
    _rm8set(v) {
        if (this.mod === 3) this._r8set(this.rm, v); else this._wr8(this.eaSeg, this.ea, v);
    }
    _rm16() { return this.mod === 3 ? this._r16(this.rm) : this._rd16(this.eaSeg, this.ea); }
    _rm16set(v) {
        if (this.mod === 3) this._r16set(this.rm, v); else this._wr16(this.eaSeg, this.ea, v);
    }

    // ---- flag primitives ------------------------------------------------
    _add(a, b, cin, w) {
        const mask = w ? 0xffff : 0xff, sign = w ? 0x8000 : 0x80;
        const raw = a + b + cin, res = raw & mask;
        let f = this.flags & ~(CF | PF | AF | ZF | SF | OF);
        if (raw > mask) f |= CF;
        if ((a ^ b ^ res) & 0x10) f |= AF;
        if ((res ^ a) & (res ^ b) & sign) f |= OF;
        if (!res) f |= ZF;
        if (res & sign) f |= SF;
        this.flags = f | PARITY[res & 0xff];
        return res;
    }
    _sub(a, b, cin, w) {
        const mask = w ? 0xffff : 0xff, sign = w ? 0x8000 : 0x80;
        const raw = a - b - cin, res = raw & mask;
        let f = this.flags & ~(CF | PF | AF | ZF | SF | OF);
        if (raw < 0) f |= CF;
        if ((a ^ b ^ res) & 0x10) f |= AF;
        if ((a ^ b) & (a ^ res) & sign) f |= OF;
        if (!res) f |= ZF;
        if (res & sign) f |= SF;
        this.flags = f | PARITY[res & 0xff];
        return res;
    }
    /** AND/OR/XOR/TEST: CF and OF cleared, AF undefined (left clear). */
    _logic(res, w) {
        const sign = w ? 0x8000 : 0x80;
        let f = this.flags & ~(CF | PF | AF | ZF | SF | OF);
        if (!res) f |= ZF;
        if (res & sign) f |= SF;
        this.flags = f | PARITY[res & 0xff];
        return res;
    }
    /** INC/DEC touch every arithmetic flag EXCEPT carry. */
    _inc(v, w) { const c = this.flags & CF; const r = this._add(v, 1, 0, w); this.flags = (this.flags & ~CF) | c; return r; }
    _dec(v, w) { const c = this.flags & CF; const r = this._sub(v, 1, 0, w); this.flags = (this.flags & ~CF) | c; return r; }

    /** ALU op by ModR/M reg field: ADD OR ADC SBB AND SUB XOR CMP.
     *  Returns the result; CMP (7) is the caller's cue to discard it. */
    _alu(op, a, b, w) {
        const c = this.flags & CF ? 1 : 0;
        switch (op) {
            case 0: return this._add(a, b, 0, w);
            case 1: return this._logic((a | b) & (w ? 0xffff : 0xff), w);
            case 2: return this._add(a, b, c, w);
            case 3: return this._sub(a, b, c, w);
            case 4: return this._logic(a & b, w);
            case 5: return this._sub(a, b, 0, w);
            case 6: return this._logic((a ^ b) & (w ? 0xffff : 0xff), w);
            default: return this._sub(a, b, 0, w);
        }
    }

    // ---- shifts and rotates ---------------------------------------------
    /** D0-D3 group. Rotates touch ONLY CF and OF -- SZP and AF survive them,
     *  which is the difference the vectors catch first. OF is defined for a
     *  count of one and undefined above it. A count of zero changes nothing
     *  at all, flags included. */
    _shift(op, val, cnt, w) {
        const mask = w ? 0xffff : 0xff, sign = w ? 0x8000 : 0x80;
        // REG=6 IS TWO DIFFERENT INSTRUCTIONS ON THE TWO PARTS. On the 8086
        // it is SETMO/SETMOC -- undocumented, real, and verified by 646,000
        // vectors. On the 186 the encoding was reclaimed as a second SHL,
        // which is what the v20 suite's own disassembly calls it (`shl`, not
        // `setmo`) and what period 186 documentation implies by listing the
        // field as reserved rather than as an operation. Two sources agreeing
        // is why this is a decision and not a guess; it is graded here for
        // the V20 and ungraded for an Intel 186, which is stated in the
        // grinder rather than left to be discovered.
        if (op === 6 && this._is186) op = 4;
        if (op === 6) return this._setmo(cnt, w);       // undocumented, below
        if (cnt === 0) return val & mask;
        let v = val & mask, cf = this.flags & CF ? 1 : 0;
        // The value as it stood BEFORE THE LAST iteration. For a count of one
        // this is the original operand, so the 8086 path below is unchanged
        // to the bit; for a longer count it is what the 186's OF is computed
        // from. See the OF block.
        let orig = v;
        for (let i = 0; i < cnt; i++) {
            orig = v;
            switch (op) {
                case 0: { const b = (v & sign) ? 1 : 0; v = ((v << 1) | b) & mask; cf = b; break; }
                case 1: { const b = v & 1; v = (v >>> 1) | (b ? sign : 0); cf = b; break; }
                case 2: { const b = (v & sign) ? 1 : 0; v = ((v << 1) | cf) & mask; cf = b; break; }
                case 3: { const b = v & 1; v = (v >>> 1) | (cf ? sign : 0); cf = b; break; }
                case 4: { cf = (v & sign) ? 1 : 0; v = (v << 1) & mask; break; }
                case 5: { cf = v & 1; v = v >>> 1; break; }
                default: { cf = v & 1; v = ((v >>> 1) | (v & sign)) & mask; break; }
            }
        }
        let f = this.flags & ~(CF | OF);
        if (cf) f |= CF;
        // OVERFLOW IS DEFINED FOR ONE COUNT ON AN 8086 AND FOR EVERY COUNT ON
        // A 186, and the second rule is the first one applied to the LAST
        // iteration rather than a different rule. Measured, not assumed: with
        // OF computed only at cnt===1 the v20 suite fails six C0 files purely
        // on bit 0x800; computing it every time fixes five of them, and
        // taking SHR's operand from the pre-final value rather than the
        // original fixes the sixth. That last one is the tell -- SHR's OF is
        // "the MSB of what was shifted", and after two or more byte shifts
        // there is nothing left up there, which is exactly the zero the
        // hardware reports.
        //
        // The 8086 is untouched: at cnt===1 the pre-final value IS the
        // original, so this is the same arithmetic it was verified with.
        if (cnt === 1 || this._is186) {
            const msb = (v & sign) ? 1 : 0;
            let of = 0;
            switch (op) {
                case 0: case 2: case 4: of = msb ^ cf; break;
                case 1: case 3: of = msb ^ ((v & (sign >>> 1)) ? 1 : 0); break;
                case 5: of = (orig & sign) ? 1 : 0; break;
                default: of = 0; break;                 // SAR never overflows
            }
            if (of) f |= OF;
        }
        this.flags = f;
        if (op >= 4) {                                  // SHL/SHR/SAR set SZP
            let g = this.flags & ~(PF | ZF | SF);
            if (!v) g |= ZF;
            if (v & sign) g |= SF;
            this.flags = g | PARITY[v & 0xff];
        }
        return v;
    }

    /** SETMO / SETMOC (D0-D3 reg=6) -- undocumented, and real: the operand
     *  becomes all ones and the flags follow from that, unconditionally for
     *  the D0/D1 forms and only when CL is non-zero for D2/D3. */
    _setmo(cnt, w) {
        const mask = w ? 0xffff : 0xff;
        if (cnt === 0) return 0;                        // caller keeps the operand
        const v = mask;
        let f = this.flags & ~(CF | PF | AF | ZF | SF | OF);
        if (v & (w ? 0x8000 : 0x80)) f |= SF;
        this.flags = f | PARITY[v & 0xff];
        return v;
    }

    // ---- multiply and divide --------------------------------------------
    _mul8(src) {
        const r = this.al * src;
        this.ax = r & 0xffff;
        let f = this.flags & ~(CF | OF);
        if (this.ah) f |= CF | OF;
        this.flags = f;
    }
    _mul16(src) {
        const r = this.ax * src;
        this.ax = r & 0xffff; this.dx = (r >>> 16) & 0xffff;
        let f = this.flags & ~(CF | OF);
        if (this.dx) f |= CF | OF;
        this.flags = f;
    }
    _imul8(src) {
        const a = this.al & 0x80 ? this.al - 256 : this.al;
        const b = src & 0x80 ? src - 256 : src;
        const r = a * b;
        this.ax = r & 0xffff;
        let f = this.flags & ~(CF | OF);
        if (r < -128 || r > 127) f |= CF | OF;
        this.flags = f;
    }
    _imul16(src) {
        const a = this.ax & 0x8000 ? this.ax - 65536 : this.ax;
        const b = src & 0x8000 ? src - 65536 : src;
        const r = a * b;
        this.ax = r & 0xffff; this.dx = (r >>> 16) & 0xffff;
        let f = this.flags & ~(CF | OF);
        if (r < -32768 || r > 32767) f |= CF | OF;
        this.flags = f;
    }
    /** Divide overflow raises INT 0. On the 8086 the address pushed is the
     *  one AFTER the failing instruction (the 286 changed this), which falls
     *  out naturally here because IP has already advanced. */
    _div8(src) {
        if (src === 0) { this._fault(0); return; }
        const q = Math.floor(this.ax / src), r = this.ax % src;
        if (q > 0xff) { this._fault(0); return; }
        this.al = q; this.ah = r;
    }
    _div16(src) {
        if (src === 0) { this._fault(0); return; }
        const n = this.dx * 65536 + this.ax;
        const q = Math.floor(n / src), r = n % src;
        if (q > 0xffff) { this._fault(0); return; }
        this.ax = q & 0xffff; this.dx = r & 0xffff;
    }
    /** A REP prefix on IDIV NEGATES THE QUOTIENT. It is not a decode quirk
     *  and not a no-op prefix being ignored: the microcode's sign-correction
     *  step runs an extra time, and period code that put a stray REP in
     *  front of a divide got a sign-flipped answer from the silicon. The
     *  suite prepends REP to a share of every string-capable opcode, which
     *  is how it surfaces here at all. Range is checked on the magnitude
     *  BEFORE the flip -- that is the order the vectors show. */
    _idiv8(src) {
        const d = src & 0x80 ? src - 256 : src;
        if (d === 0) { this._fault(0); return; }
        const n = this.ax & 0x8000 ? this.ax - 65536 : this.ax;
        let q = Math.trunc(n / d);
        const r = n % d;
        // The range check is on the MAGNITUDE, so a quotient of exactly
        // -128 faults where -127..127 does not: the microcode compares an
        // absolute value against 0x7f and never sees the sign.
        if (Math.abs(q) > 127) { this._fault(0); return; }
        if (this._rep) q = -q;
        this.al = q & 0xff; this.ah = r & 0xff;
    }
    _idiv16(src) {
        const d = src & 0x8000 ? src - 65536 : src;
        if (d === 0) { this._fault(0); return; }
        let n = this.dx * 65536 + this.ax;
        if (n >= 0x80000000) n -= 0x100000000;
        let q = Math.trunc(n / d);
        const r = n % d;
        if (Math.abs(q) > 32767) { this._fault(0); return; }   // magnitude, as above
        if (this._rep) q = -q;
        this.ax = q & 0xffff; this.dx = r & 0xffff;
    }

    // ---- BCD ------------------------------------------------------------
    /** DAA and DAS differ only in the sign of the two corrections, and both
     *  diverge from Intel's published pseudocode in the same place.
     *
     *  The manual says the high correction happens when the ORIGINAL AL was
     *  above 0x99 or carry was set. The silicon does something narrower: for
     *  an AL of 0x9a-0x9f it applies the correction only when AF was CLEAR,
     *  so `daa` on AL=0x9a leaves 0xa0 with AL=0x9a,AF=1 and 0x00 with
     *  AL=0x9a,AF=0 -- the same AL, the same low correction, two different
     *  answers. Carry out is then exactly "the high correction happened":
     *  a borrow out of the low correction does NOT set it, which is what
     *  `das` on AL=0x00,AF=1 proves (0xfa with carry CLEAR).
     *
     *  This rule is fitted to the vectors and exact over all 2,000 of each,
     *  where the published one misses 17 and 37 respectively. It is
     *  behavior, not documentation, and it is deliberately written to look
     *  odd so nobody "corrects" it back. */
    _bcdAdjust(sub) {
        const oldAl = this.al, oldCf = this.flags & CF ? 1 : 0, oldAf = this.flags & AF;
        let f = this.flags & ~(CF | AF | PF | ZF | SF);
        if ((oldAl & 0x0f) > 9 || oldAf) {
            this.al = sub ? this.al - 6 : this.al + 6;
            f |= AF;
        }
        if (oldCf || oldAl >= 0xa0 || (oldAl >= 0x9a && !oldAf)) {
            this.al = sub ? this.al - 0x60 : this.al + 0x60;
            f |= CF;
        }
        if (!this.al) f |= ZF;
        if (this.al & 0x80) f |= SF;
        this.flags = f | PARITY[this.al];
    }
    _daa() { this._bcdAdjust(false); }
    _das() { this._bcdAdjust(true); }
    _aaa() {
        let f = this.flags & ~(CF | AF);
        if ((this.al & 0x0f) > 9 || (this.flags & AF)) {
            this.al = this.al + 6;
            this.ah = this.ah + 1;
            f |= AF | CF;
        }
        this.al = this.al & 0x0f;
        this.flags = f;
    }
    _aas() {
        let f = this.flags & ~(CF | AF);
        if ((this.al & 0x0f) > 9 || (this.flags & AF)) {
            this.al = this.al - 6;
            this.ah = this.ah - 1;
            f |= AF | CF;
        }
        this.al = this.al & 0x0f;
        this.flags = f;
    }
    /** The immediate byte is a real operand, not a hardwired ten -- AAM 0
     *  divides by zero and takes INT 0 like any other. */
    _aam(base) {
        if (base === 0) {
            // AAM 0 divides by zero. Before it faults it leaves the flags of
            // a ZERO result -- ZF and PF set, SF, AF and CF clear -- while AX
            // itself is untouched, and INT 0 then pushes exactly that.
            this.flags = (this.flags & ~(CF | AF | OF | SF | PF)) | ZF | PARITY[0];
            this._fault(0);
            return;
        }
        const al = this.al;
        this.ah = Math.floor(al / base) & 0xff;
        this.al = (al % base) & 0xff;
        this._szpAl();
    }
    _aad(base) {
        this.al = (this.al + this.ah * base) & 0xff;
        this.ah = 0;
        this._szpAl();
    }
    _szpAl() {
        let f = this.flags & ~(PF | ZF | SF);
        if (!this.al) f |= ZF;
        if (this.al & 0x80) f |= SF;
        this.flags = f | PARITY[this.al];
    }

    // ---- interrupts -----------------------------------------------------
    /** Software or internal interrupt: FLAGS, CS, IP go on the stack, the
     *  trap and interrupt flags clear, and the vector comes from segment 0.
     *  Hardware delivery (INTR/NMI) is the machine layer's call, not ours. */
    /**
     * THE VECTOR IS READ BEFORE ANYTHING IS PUSHED, and this used to be the
     * other way round (E6.8.4c).
     *
     * The 646,000-vector suite could never see it: it compares FINAL state,
     * and in ordinary RAM the end state is identical whichever order the six
     * writes and four reads happen in. The 8088 BUS TRACES can, and do --
     * `int C6h` reads 0318h-031Bh, the IVT entry, and only then writes the six
     * stack bytes. We produced `wwwwwwrrrr` where the silicon produces
     * `rrrrwwwwww`, on all ten thousand vectors of that file.
     *
     * IT IS NOT COSMETIC. The two orders differ whenever the pushes and the
     * vector fetch touch the same bytes -- a stack placed over the interrupt
     * vector table, which is a real thing in tight embedded code and exactly
     * the kind of machine this tier is for -- and whenever the IVT sits in a
     * memory-mapped window where a read has side effects. Push-first would
     * have the CPU fetch a vector it had just overwritten.
     *
     * Found by the bus-sequence score on its first meaningful run, and it is
     * one of the three divergences lego-47 predicted from the design alone:
     * writes-before-reads on read-modify-write, the push order on interrupt
     * entry, and operand order on the string ops.
     */
    _interrupt(n) {
        const newIp = this._rd16(0, (n * 4) & 0xffff);
        const newCs = this._rd16(0, (n * 4 + 2) & 0xffff);
        this._push(this.flags);
        this.flags &= ~(IF | TF);
        this._push(this.cs);
        this._push(this.ip);
        this.ip = newIp;
        this.cs = newCs;
    }

    /** Public entry for a machine-layer interrupt request. The caller owns
     *  the IF check and the acknowledge cycle; this just takes the vector. */
    interrupt(n) { this.halted = false; this._interrupt(n); }

    /**
     * A PROGRAM-INITIATED interrupt: INT n, INT3, INTO. Emits before taking
     * it, so a debugger that breaks here sees the machine as the instruction
     * left it rather than as the handler found it.
     *
     * WHY THIS IS NOT IN `_interrupt(n)`, which is where it obviously belongs
     * and where it would be wrong. `_interrupt` is the SHARED funnel: the
     * public `interrupt(n)` above routes hardware delivery through it too, so
     * an emit there fires a second time for every IRQ and NMI the machine has
     * already reported, and "break on INT 21h" starts tripping on the timer
     * tick. The opcode handlers are the only sites a program's INT passes and
     * a delivered IRQ does not. Verified rather than assumed — read
     * `interrupt(n)` directly above and follow it down.
     */
    _swInt(n) {
        this.onInterrupt?.({ vector: n, source: 'int' });
        this._interrupt(n);
    }

    /**
     * A FAULT the CPU raises on its own: divide overflow (0), the single-step
     * trap (1), BOUND out of range (5, 186 only).
     *
     * Reported as `source: 'exception'` rather than folded into 'int',
     * because "break when this divides by zero" and "break when the program
     * calls INT 21h" are different questions asked for different reasons —
     * the same argument that separates 'int' from 'irq'. A caller that wants
     * them together can watch the vector and ignore the source; a caller that
     * wants them apart cannot recover the distinction if we throw it away
     * here.
     */
    _fault(n) {
        this.onInterrupt?.({ vector: n, source: 'exception' });
        this._interrupt(n);
    }

    // ---- string primitives ----------------------------------------------
    /** The source of a string op takes a segment override; the destination
     *  is ES:DI and takes none. That asymmetry is the whole trap. */
    _srcSeg() { return this._seg >= 0 ? this._seg : this.ds; }
    _delta(w) { return (this.flags & DF ? -1 : 1) * (w ? 2 : 1); }

    _movs(w) {
        const d = this._delta(w), s = this._srcSeg();
        if (w) this._wr16(this.es, this.di, this._rd16(s, this.si));
        else this._wr8(this.es, this.di, this._rd8(s, this.si));
        this.si = (this.si + d) & 0xffff; this.di = (this.di + d) & 0xffff;
    }
    _cmps(w) {
        const d = this._delta(w), s = this._srcSeg();
        const a = w ? this._rd16(s, this.si) : this._rd8(s, this.si);
        const b = w ? this._rd16(this.es, this.di) : this._rd8(this.es, this.di);
        this._sub(a, b, 0, w);
        this.si = (this.si + d) & 0xffff; this.di = (this.di + d) & 0xffff;
    }
    _stos(w) {
        const d = this._delta(w);
        if (w) this._wr16(this.es, this.di, this.ax); else this._wr8(this.es, this.di, this.al);
        this.di = (this.di + d) & 0xffff;
    }
    _lods(w) {
        const d = this._delta(w), s = this._srcSeg();
        if (w) this.ax = this._rd16(s, this.si); else this.al = this._rd8(s, this.si);
        this.si = (this.si + d) & 0xffff;
    }
    _scas(w) {
        const d = this._delta(w);
        const b = w ? this._rd16(this.es, this.di) : this._rd8(this.es, this.di);
        this._sub(w ? this.ax : this.al, b, 0, w);
        this.di = (this.di + d) & 0xffff;
    }

    /**
     * A REP'd string instruction, run iteration by iteration with the
     * interrupt window open between them.
     *
     * WHY NOT JUST LOOP. A REP with CX=65535 is not one atomic act on real
     * silicon: the 8086 checks for an interrupt between iterations, which is
     * how a timer keeps ticking through a long block move. Modelling it as
     * uninterruptible loses that, and loses the erratum below with it.
     *
     * THE ERRATUM, which is the interesting part. When the interrupt is
     * taken, the 8086 saves the address of the REP PREFIX rather than the
     * address of the first prefix byte. So on resumption only the prefixes
     * from the REP onward are re-fetched, and A SEGMENT OVERRIDE THAT CAME
     * BEFORE THE REP IS LOST -- `2e f3 a4` resumes as `f3 a4` and the rest
     * of the copy reads from DS instead of CS. Prefix ORDER decides it:
     * `f3 2e a4` survives, because the override is after the rewind point.
     * That is not a bug in this code, it is a bug in the chip, and it is
     * reproduced rather than smoothed over.
     *
     * With no machine attached, intPending() answers false, the loop runs to
     * completion, and all 646,000 vectors behave exactly as before -- the
     * suite does not exercise interrupts, so there is nothing here it can
     * see.
     */
    /**
     * @returns {number} iterations actually performed — 1 without a REP prefix,
     * 0 when REP was entered with CX already zero.
     *
     * THE COUNT IS RETURNED BECAUSE THE CALLERS MUST CHARGE FOR IT. Until
     * 2026-09-05 every string opcode ran its whole REP loop here and then
     * returned a FLAT cycle count: `REP MOVSW` with CX=127 performed 127 copies
     * and charged 18 cycles. Measured against the 8088 vectors, that one bug
     * produced 69% of the core's total cycle error while touching 4.3% of
     * instructions -- mean |error| 19.43 cycles falls to 5.99 with these ten
     * opcodes excluded. See _repCost().
     */
    _repeat(fn, checksZF) {
        if (!this._rep) { fn(); return 1; }
        const repe = this._rep === 0xf3;
        let iters = 0;
        while (this.cx !== 0) {
            fn();
            iters++;
            this.cx = (this.cx - 1) & 0xffff;
            if (checksZF) {
                const z = (this.flags & ZF) !== 0;
                if (repe !== z) break;
            }
            if (this.cx !== 0 && this.canTakeInterrupt() && this.intPending()) {
                this.ip = this._repIp & 0xffff;   // rewind to the REP, not past it
                this.repInterrupted = (this.repInterrupted || 0) + 1;
                return iters;
            }
        }
        return iters;
    }

    /**
     * Cycles for a string instruction that ran `iters` times.
     *
     * `single` is the unrepeated cost (8086 datasheet, unchanged from before);
     * `per` is the published 8086 REP per-iteration cost, and REP adds a fixed
     * 9-cycle setup.
     *
     * EVIDENCE TIER 2a — independent-source agreement, the strongest kind
     * available here. The per-iteration figures were FITTED from the 8088
     * vectors (cycles = base + per * iterations, two widely separated points)
     * and then compared with the datasheet:
     *
     *     measured on 8088   MOVSB 17  CMPSB 22  STOSB 10  LODSB 13  SCASB 15
     *     8086 datasheet     MOVSB 17  CMPSB 22  STOSB 10  LODSB 13  SCASB 15
     *
     * Every byte form agrees exactly. Every WORD form measured higher --
     * MOVSW 25, CMPSW 30, STOSW 14, LODSW 17, SCASW 19 -- and each is its
     * 8086 value plus 4 cycles per EXTRA BUS CYCLE: +8 where the instruction
     * touches two memory operands, +4 where it touches one. That is precisely
     * the documented 8088 8-bit-bus penalty, reproduced from measurement
     * rather than assumed, which is why this core (an 8086) uses the 8086
     * column and an 8088 would not.
     *
     * SO DO NOT "FIX" THE WORD FORMS TO MATCH THE ORACLE. Grading this core
     * against the 8088 vectors leaves A5, A7, AB, AD and AF as the worst
     * remaining string opcodes, off by exactly the bus penalty above, while
     * all five BYTE forms drop out of the error table entirely. **That
     * residual is the measurement working, not a defect left behind.** An
     * 8086 core that matched an 8088 oracle on word string operations would
     * be wrong about being an 8086 -- and the change that "fixed" it would be
     * indistinguishable, in the score, from a real improvement.
     */
    _repCost(iters, single, per) {
        return this._rep ? 9 + per * iters : single;
    }

    // ---- the 80186 additions --------------------------------------------
    /**
     * The fifteen opcodes an 80186 has and an 8086 does not, plus nothing
     * else: `undefined` means "not mine", and the 8086 alias table below
     * answers instead. Every one of these is an opcode the 8086 leaves as an
     * alias, so nothing here can shadow a real 8086 instruction.
     *
     * Cycle counts are the published 186 timings. They are NOT vector-graded
     * -- the v20 suite's arrays are bus traces from an NEC part with its own
     * prefetch queue, which an instruction-stepped core cannot reproduce and
     * which would not be a 186's numbers even if it could. Same standard the
     * 8086 core states for its own counts, and for the same reason.
     */
    _exec186(op) {
        switch (op) {
            // PUSHA / POPA. The pushed SP is the value from BEFORE the
            // instruction, unlike `push sp` on this same chip -- the 186
            // latches it first and pushes the latch, which is why POPA can
            // discard the slot rather than having to undo a decrement.
            case 0x60: {
                const sp0 = this.sp;
                this._push(this.ax); this._push(this.cx);
                this._push(this.dx); this._push(this.bx);
                this._push(sp0);
                this._push(this.bp); this._push(this.si); this._push(this.di);
                return 36;
            }
            case 0x61: {
                this.di = this._pop(); this.si = this._pop(); this.bp = this._pop();
                // The SP slot is READ AND DISCARDED, not skipped: SP must end
                // up where the pops left it, and a POPA that restored the
                // stacked SP would undo its own unwinding.
                this._pop();
                this.bx = this._pop(); this.dx = this._pop();
                this.cx = this._pop(); this.ax = this._pop();
                return 51;
            }

            // BOUND r16, m32 -- the array-index check, and the only 186
            // addition that can FAULT. Both bounds are inclusive and the
            // comparison is SIGNED, so a negative index against a negative
            // lower bound passes. INT 5 on failure, which on a PC is the
            // print-screen vector: a 186 program that BOUNDs on a PC and
            // faults prints the screen, which is a real historical hazard
            // and not something to smooth over.
            case 0x62: {
                const c = this._modrm();
                if (this.mod === 3) throw new Unimplemented(op);  // no register form
                const idx = sx16(this._r16(this.reg));
                const lo = sx16(this._rd16(this.eaSeg, this.ea));
                const hi = sx16(this._rd16(this.eaSeg, (this.ea + 2) & 0xffff));
                if (idx < lo || idx > hi) { this._fault(5); return 33 + c; }
                return 33 + c;
            }

            // PUSH imm16 / PUSH imm8. The byte form SIGN-EXTENDS to a word
            // before pushing -- `push -1` stores FFFFh, not 00FFh.
            case 0x68: this._push(this._fetch16()); return 10;
            case 0x6a: this._push(this._fetchS8() & 0xffff); return 10;

            // IMUL r16, r/m16, imm -- the three-operand multiply, and the
            // first x86 instruction with three operands at all. The result
            // is the LOW word; CF and OF say whether the discarded high word
            // was a real sign extension of it. SZAP are undefined and the
            // suite masks them, so they are left alone rather than invented.
            case 0x69: case 0x6b: {
                const c = this._modrm();
                const a = sx16(this._rm16());
                const b = op === 0x69 ? sx16(this._fetch16()) : this._fetchS8();
                const full = a * b;
                const low = full & 0xffff;
                this._r16set(this.reg, low);
                const fits = full === sx16(low);
                this.flags = fits ? (this.flags & ~(CF | OF)) : (this.flags | CF | OF);
                return (this.mod === 3 ? 22 : 29 + c);
            }

            // INS / OUTS. INS writes ES:DI and takes NO segment override --
            // the destination of a string primitive is always ES:DI, exactly
            // as with STOS and MOVS. OUTS reads DS:SI and DOES honour one.
            case 0x6c: case 0x6d: return this._repCost(this._repeat(() => this._ins(op & 1), false), 14, 8);
            case 0x6e: case 0x6f: return this._repCost(this._repeat(() => this._outs(op & 1), false), 14, 8);

            // Shift/rotate by an immediate count. The 8086 could only shift
            // by 1 or by CL; this is the same shift unit with a third count
            // source, and the count is masked to five bits like CL's.
            case 0xc0: case 0xc1: {
                const c = this._modrm();
                const w = op & 1;
                const v = w ? this._rm16() : this._rm8();
                // MASKED, AND THE ORACLE DISAGREES -- read this before "fixing" it.
                // The v20 suite says an NEC V20 does NOT mask this count: with
                // masking on, C0.4/C1.4 score 470/600, and with it off, 579/600.
                // That is not evidence the 186 does not mask. It is evidence
                // the V20 does not, and the V20 is 8086-compatible here while
                // the 186 is the part that introduced the `& 31`. So the
                // masking STAYS -- it is the defining behaviour of this
                // variant -- and the grinder excludes the counts above 31 BY
                // NAME rather than pretending the suite graded them. Nothing
                // grades this line; the tests below assert it directly.
                const cnt = this._fetch8() & 31;
                const r = this._shift(this.reg, v, cnt, w);
                if (!(this.reg === 6 && cnt === 0)) { if (w) this._rm16set(r); else this._rm8set(r); }
                return (this.mod === 3 ? 5 + cnt : 17 + c + cnt);
            }

            // ENTER imm16, imm8 -- build a stack frame, optionally copying
            // `level-1` enclosing frame pointers so a nested procedure can
            // reach its parents' locals. The display copy is the whole point
            // of the instruction and the part that is usually got wrong:
            // BP walks DOWN through the caller's display copying each entry,
            // and then the NEW frame pointer is pushed last.
            case 0xc8: {
                const size = this._fetch16();
                const level = this._fetch8() & 31;
                this._push(this.bp);
                const frame = this.sp;
                if (level > 0) {
                    for (let i = 1; i < level; i++) {
                        this.bp = (this.bp - 2) & 0xffff;
                        this._push(this._rd16(this.ss, this.bp));
                    }
                    this._push(frame);
                }
                this.bp = frame;
                this.sp = (this.sp - size) & 0xffff;
                return level === 0 ? 15 : level === 1 ? 25 : 22 + 16 * (level - 1);
            }

            // LEAVE -- discard the frame ENTER built. `mov sp, bp` then
            // `pop bp`, in one opcode and with no flags touched.
            case 0xc9:
                this.sp = this.bp;
                this.bp = this._pop();
                return 8;

            default: return undefined;                   // not a 186 opcode
        }
    }

    /** INS: read the port in DX into ES:DI. No segment override applies to a
     *  string DESTINATION, so this does not consult _srcSeg(). */
    _ins(w) {
        const d = this._delta(w);
        // A WORD PORT ACCESS IS TWO BYTE ACCESSES, at DX and DX+1 -- the same
        // convention `in ax, dx` follows two hundred lines below, and the one
        // the suite's "reads return 0xFF" note is written against. Calling the
        // bus once and using the result as a word gives 00FFh where the
        // hardware gives FFFFh, which is a whole high byte of nothing.
        const p = this.dx;
        if (w) {
            this._wr8(this.es, this.di, this.inPort(p) & 0xff);
            this._wr8(this.es, (this.di + 1) & 0xffff, this.inPort((p + 1) & 0xffff) & 0xff);
        } else this._wr8(this.es, this.di, this.inPort(p) & 0xff);
        this.di = (this.di + d) & 0xffff;
    }

    /** OUTS: write DS:SI (override-able) to the port in DX. */
    _outs(w) {
        const seg = this._srcSeg();
        const d = this._delta(w);
        const p = this.dx;
        if (w) {
            this.outPort(p, this._rd8(seg, this.si));
            this.outPort((p + 1) & 0xffff, this._rd8(seg, (this.si + 1) & 0xffff));
        } else this.outPort(p, this._rd8(seg, this.si));
        this.si = (this.si + d) & 0xffff;
    }

    // ---- one instruction ------------------------------------------------
    /** Execute one instruction; returns its cycle cost. Throws Unimplemented
     *  for opcodes this core has not reached, so the grinder counts those as
     *  NOT-YET and never as pass. */
    step() {
        this._seg = -1;
        this._rep = 0;
        // SINGLE-STEP IS SAMPLED BEFORE THE INSTRUCTION, NOT AFTER. The 8086
        // tests TF at an instruction boundary and takes a type-1 interrupt if
        // it was set; sampling the value the instruction LEAVES would mean a
        // POPF that sets TF traps immediately on itself, so a debugger's
        // first `t` would step its own flag-load instead of the program.
        //
        // The SHADOW is read at the other end, after the instruction, and
        // that asymmetry is not an oversight -- it is where the first version
        // of this was wrong. A segment-register load RAISES the shadow as it
        // retires, so reading it here would let `mov ss, ax` trap on itself:
        // exactly the instant SS is new, SP is old, and three words go into
        // whatever that address happens to be. Reading it after suppresses
        // that one trap and lets the next instruction take it, which is the
        // delay the shadow exists to provide.
        this._fsOpcodeSeen = false;
        this._tookBranch = false;
        const traceThis = (this.flags & TF) !== 0;
        // The shadow lasts exactly one instruction: clear it on the way in,
        // and any instruction that loads a segment register sets it again
        // before it returns. Same shape as the Z80's EI latch.
        this.intShadow = 0;
        let n = 0;

        // Prefixes. There is no length limit on real silicon and the last
        // segment override wins, so this is a loop and not an if.
        for (;;) {
            // A PEEK, NOT A BUS CYCLE. This looks at the next byte to decide
            // whether it is a prefix, and if it is not, `_fetch8()` below reads
            // the same byte again. Real silicon takes it from the queue once.
            //
            // Routing the peek through _rd8 therefore recorded TWO accesses per
            // instruction that hardware never makes -- a spurious data read of
            // every prefix byte, and a duplicate of every opcode byte -- which
            // the bus trace exposed the moment it existed. Harmless in RAM,
            // where a read has no effect; NOT harmless over a memory-mapped
            // device, where executing from a window with read side effects
            // would trigger them twice. Recorded in ROADMAP E6.8.4c.
            //
            // The peek is now silent and the CONSUMPTION of a prefix records a
            // fetch, which is what the queue actually sees.
            const b = this.read(I8086.phys(this.cs, this.ip)) & 0xff;
            // Not a closure per instruction: allocating one on every step is
            // measurable in a loop this hot, and the trace is off by default.
            const eaten = this.busTrace === null ? NOOP : () => this.busTrace.push(0, I8086.phys(this.cs, this.ip));
            if (b === 0x26 || b === 0x2e || b === 0x36 || b === 0x3e) {
                eaten();
                this.ip = (this.ip + 1) & 0xffff; n += 2;
                this._seg = b === 0x26 ? this.es : b === 0x2e ? this.cs
                    : b === 0x36 ? this.ss : this.ds;
            } else if (b === 0xf2 || b === 0xf3) {
                eaten();
                // Remember WHERE the REP prefix is, not just that there is
                // one: an interrupt taken mid-REP resumes from here, and
                // anything in front of it is lost. See _repeat().
                this._repIp = this.ip;
                this.ip = (this.ip + 1) & 0xffff; n += 2;
                this._rep = b;
            } else if (b === 0xf0 || b === 0xf1) {
                eaten();
                this.ip = (this.ip + 1) & 0xffff; n += 2;   // LOCK, and its alias
            } else break;
        }

        const op = this._fetch8();
        n += this._exec(op);

        // THE QUEUE FLUSH (E). The 8088 throws the prefetch queue away when
        // control goes somewhere the queue was not already reading, and its
        // QS lines report that as an `E`. The core knows it without a queue:
        // if CS:IP after execution is not where the last fetch left off, the
        // bytes the BIU had queued are wrong and are discarded.
        //
        // A NOT-TAKEN CONDITIONAL DOES NOT FLUSH, and this gets that right for
        // free rather than by special-casing branch opcodes: a jump that was
        // not taken continues sequentially, so the comparison is equal and no
        // E is emitted. The same test covers INT, RET, CALL, the far forms and
        // any future opcode that moves control, which is the reason it is a
        // comparison rather than a list.
        if (this.busTrace !== null
            && (this._tookBranch || this.ip !== this._seqIp || this.cs !== this._seqCs)) {
            this.busTrace.push(6, I8086.phys(this.cs, this.ip));
        }

        // The trap fires after the instruction has completed and committed.
        // _interrupt() clears TF as it enters, so the handler does not step
        // itself, and pushes the flags word with TF still SET -- which is
        // what lets a debugger's IRET resume tracing. HLT is left alone: a
        // halted CPU has not completed an instruction boundary in the sense
        // this trap is about, and waking it belongs to the machine layer.
        if (traceThis && !this.halted && this.intShadow === 0) { this._fault(1); n += 51; }

        this.cycles += n;
        return n;
    }

    _exec(op) {
        // THE 186 GETS FIRST REFUSAL, and this is deliberately here rather
        // than threaded through the switch below. On an 8086 the fifteen
        // opcodes the 186 later claimed are DECODE ALIASES -- 0x60-0x6f land
        // on Jcc, C0/C1/C8/C9 land on the returns -- and a `case` label
        // cannot be conditional. Asking the variant before the alias table
        // is reached keeps both answers in one core with no table to drift.
        // Cost on the 8086 path is one boolean test per instruction.
        if (this._is186) {
            const r = this._exec186(op);
            if (r !== undefined) return r;
        }
        // ---- 0x00-0x3f: the eight ALU ops, six forms each ----------------
        if (op < 0x40 && (op & 7) < 6) {
            const kind = op >> 3, form = op & 7, w = form & 1;
            if (form < 2) {                              // r/m, reg
                const c = this._modrm();
                const a = w ? this._rm16() : this._rm8();
                const b = w ? this._r16(this.reg) : this._r8(this.reg);
                const r = this._alu(kind, a, b, w);
                if (kind !== 7) { if (w) this._rm16set(r); else this._rm8set(r); }
                return (this.mod === 3 ? 3 : 16 + c);
            }
            if (form < 4) {                              // reg, r/m
                const c = this._modrm();
                const a = w ? this._r16(this.reg) : this._r8(this.reg);
                const b = w ? this._rm16() : this._rm8();
                const r = this._alu(kind, a, b, w);
                if (kind !== 7) { if (w) this._r16set(this.reg, r); else this._r8set(this.reg, r); }
                return (this.mod === 3 ? 3 : 9 + c);
            }
            const b = w ? this._fetch16() : this._fetch8();   // acc, imm
            const r = this._alu(kind, w ? this.ax : this.al, b, w);
            if (kind !== 7) { if (w) this.ax = r; else this.al = r; }
            return 4;
        }

        switch (op) {
            // ---- segment register push/pop and the BCD adjusts -----------
            case 0x06: this._push(this.es); return 10;
            case 0x07: this.es = this._pop(); this.intShadow = 1; return 8;
            case 0x0e: this._push(this.cs); return 10;
            // POP CS is real on the 8086: there are no two-byte opcodes for
            // 0x0f to introduce, so it decodes as the pop nobody wanted.
            case 0x0f: this.cs = this._pop(); this.intShadow = 1; return 8;
            case 0x16: this._push(this.ss); return 10;
            case 0x17: this.ss = this._pop(); this.intShadow = 1; return 8;
            case 0x1e: this._push(this.ds); return 10;
            case 0x1f: this.ds = this._pop(); this.intShadow = 1; return 8;
            case 0x27: this._daa(); return 4;
            case 0x2f: this._das(); return 4;
            case 0x37: this._aaa(); return 4;
            case 0x3f: this._aas(); return 4;

            // ---- 0x40-0x5f: INC/DEC and PUSH/POP of the word registers ---
            // TWO CLOCKS, NOT THREE, and this was wrong until the 8088 bus
            // traces could say so (E6.8.4c). Intel's table gives 2 for the
            // 16-bit REGISTER form and 3 for the 8-bit one; we had 3 for both.
            // The suite's `40` file is 5000 traces of exactly 2 cycles and
            // 5000 of exactly 4 -- the best case and the case where the next
            // byte had to be fetched -- and we matched neither, scoring 0 of
            // 10,000 on the first correct run of the new grinder.
            case 0x40: case 0x41: case 0x42: case 0x43:
            case 0x44: case 0x45: case 0x46: case 0x47:
                this._r16set(op & 7, this._inc(this._r16(op & 7), 1)); return 2;
            case 0x48: case 0x49: case 0x4a: case 0x4b:
            case 0x4c: case 0x4d: case 0x4e: case 0x4f:
                this._r16set(op & 7, this._dec(this._r16(op & 7), 1)); return 2;
            // PUSH SP pushes the ALREADY DECREMENTED value on the 8086. The
            // 286 changed it, and the difference is how software tells the
            // two apart, so it is not a detail to normalise away.
            case 0x50: case 0x51: case 0x52: case 0x53:
            case 0x54: case 0x55: case 0x56: case 0x57:
                this._pushR16(op & 7); return 11;
            case 0x58: case 0x59: case 0x5a: case 0x5b:
            case 0x5c: case 0x5d: case 0x5e: case 0x5f:
                this._r16set(op & 7, this._pop()); return 8;

            // ---- 0x70-0x7f: Jcc. 0x60-0x6f alias onto them, because the
            // decoder ignores bit 4 -- these are NOT the 80186 opcodes. ----
            case 0x60: case 0x70: return this._jcc(this.flags & OF);
            case 0x61: case 0x71: return this._jcc(!(this.flags & OF));
            case 0x62: case 0x72: return this._jcc(this.flags & CF);
            case 0x63: case 0x73: return this._jcc(!(this.flags & CF));
            case 0x64: case 0x74: return this._jcc(this.flags & ZF);
            case 0x65: case 0x75: return this._jcc(!(this.flags & ZF));
            case 0x66: case 0x76: return this._jcc((this.flags & CF) || (this.flags & ZF));
            case 0x67: case 0x77: return this._jcc(!((this.flags & CF) || (this.flags & ZF)));
            case 0x68: case 0x78: return this._jcc(this.flags & SF);
            case 0x69: case 0x79: return this._jcc(!(this.flags & SF));
            case 0x6a: case 0x7a: return this._jcc(this.flags & PF);
            case 0x6b: case 0x7b: return this._jcc(!(this.flags & PF));
            case 0x6c: case 0x7c: return this._jcc(!!(this.flags & SF) !== !!(this.flags & OF));
            case 0x6d: case 0x7d: return this._jcc(!!(this.flags & SF) === !!(this.flags & OF));
            case 0x6e: case 0x7e: return this._jcc((this.flags & ZF) || (!!(this.flags & SF) !== !!(this.flags & OF)));
            case 0x6f: case 0x7f: return this._jcc(!(this.flags & ZF) && (!!(this.flags & SF) === !!(this.flags & OF)));

            // ---- 0x80-0x83: ALU with an immediate. 0x82 aliases 0x80. ----
            case 0x80: case 0x82: {
                const c = this._modrm();
                const a = this._rm8(), b = this._fetch8();
                const r = this._alu(this.reg, a, b, 0);
                if (this.reg !== 7) this._rm8set(r);
                return this.mod === 3 ? 4 : 17 + c;
            }
            case 0x81: case 0x83: {
                const c = this._modrm();
                const a = this._rm16();
                const b = op === 0x81 ? this._fetch16() : (this._fetchS8() & 0xffff);
                const r = this._alu(this.reg, a, b, 1);
                if (this.reg !== 7) this._rm16set(r);
                return this.mod === 3 ? 4 : 17 + c;
            }

            // ---- 0x84-0x8f: TEST, XCHG, MOV, LEA, POP r/m ----------------
            case 0x84: { const c = this._modrm(); this._logic(this._rm8() & this._r8(this.reg), 0); return this.mod === 3 ? 3 : 9 + c; }
            case 0x85: { const c = this._modrm(); this._logic(this._rm16() & this._r16(this.reg), 1); return this.mod === 3 ? 3 : 9 + c; }
            case 0x86: { const c = this._modrm(); const a = this._rm8(), b = this._r8(this.reg); this._rm8set(b); this._r8set(this.reg, a); return this.mod === 3 ? 4 : 17 + c; }
            case 0x87: { const c = this._modrm(); const a = this._rm16(), b = this._r16(this.reg); this._rm16set(b); this._r16set(this.reg, a); return this.mod === 3 ? 4 : 17 + c; }
            case 0x88: { const c = this._modrm(); this._rm8set(this._r8(this.reg)); return this.mod === 3 ? 2 : 9 + c; }
            case 0x89: { const c = this._modrm(); this._rm16set(this._r16(this.reg)); return this.mod === 3 ? 2 : 9 + c; }
            case 0x8a: { const c = this._modrm(); this._r8set(this.reg, this._rm8()); return this.mod === 3 ? 2 : 8 + c; }
            case 0x8b: { const c = this._modrm(); this._r16set(this.reg, this._rm16()); return this.mod === 3 ? 2 : 8 + c; }
            case 0x8c: { const c = this._modrm(); this._rm16set(this._sreg(this.reg)); return this.mod === 3 ? 2 : 9 + c; }
            case 0x8d: { const c = this._modrm(); this._r16set(this.reg, this.ea); return 2 + c; }
            // MOV to a segment register and POP of one arm the interrupt
            // shadow; LES and LDS (C4/C5) deliberately do NOT. The shadow
            // exists so `mov ss,ax` / `mov sp,imm` cannot be split, and
            // LES/LDS load DS or ES, which can never be half of that pair —
            // so there is no behaviour to protect and no evidence they are
            // shadowed. Absent evidence, the narrower answer.
            case 0x8e: { const c = this._modrm(); this._sregSet(this.reg, this._rm16()); this.intShadow = 1; return this.mod === 3 ? 2 : 8 + c; }
            case 0x8f: { const c = this._modrm(); this._rm16set(this._pop()); return this.mod === 3 ? 8 : 17 + c; }

            // ---- 0x90-0x9f ----------------------------------------------
            case 0x90: return 3;                              // NOP = XCHG AX,AX
            case 0x91: case 0x92: case 0x93:
            case 0x94: case 0x95: case 0x96: case 0x97: {
                const i = op & 7, t = this.ax; this.ax = this._r16(i); this._r16set(i, t); return 3;
            }
            case 0x98: this.ax = (this.al & 0x80 ? 0xff00 : 0) | this.al; return 2;
            case 0x99: this.dx = this.ax & 0x8000 ? 0xffff : 0; return 5;
            case 0x9a: { const ip = this._fetch16(), cs = this._fetch16(); this._push(this.cs); this._push(this.ip); this.cs = cs; this.ip = ip; return 28; }
            case 0x9b: return 4;                              // WAIT, with no 8087 to wait for
            case 0x9c: this._push(this.flags); return 10;
            case 0x9d: this.flags = fixFlags(this._pop()); return 8;
            case 0x9e: this.flags = fixFlags((this.flags & 0xff00) | this.ah); return 4;
            case 0x9f: this.ah = this.flags & 0xff; return 4;

            // ---- 0xa0-0xaf: accumulator moves, TEST imm, string ops ------
            case 0xa0: { const a = this._fetch16(); this.al = this._rd8(this._srcSeg(), a); return 10; }
            case 0xa1: { const a = this._fetch16(); this.ax = this._rd16(this._srcSeg(), a); return 10; }
            case 0xa2: { const a = this._fetch16(); this._wr8(this._srcSeg(), a, this.al); return 10; }
            case 0xa3: { const a = this._fetch16(); this._wr16(this._srcSeg(), a, this.ax); return 10; }
            case 0xa4: case 0xa5: return this._repCost(this._repeat(() => this._movs(op & 1), false), 18, 17);
            case 0xa6: case 0xa7: return this._repCost(this._repeat(() => this._cmps(op & 1), true), 22, 22);
            case 0xa8: this._logic(this.al & this._fetch8(), 0); return 4;
            case 0xa9: this._logic(this.ax & this._fetch16(), 1); return 4;
            case 0xaa: case 0xab: return this._repCost(this._repeat(() => this._stos(op & 1), false), 11, 10);
            case 0xac: case 0xad: return this._repCost(this._repeat(() => this._lods(op & 1), false), 12, 13);
            case 0xae: case 0xaf: return this._repCost(this._repeat(() => this._scas(op & 1), true), 15, 15);

            // ---- 0xb0-0xbf: MOV register, immediate ----------------------
            case 0xb0: case 0xb1: case 0xb2: case 0xb3:
            case 0xb4: case 0xb5: case 0xb6: case 0xb7:
                this._r8set(op & 7, this._fetch8()); return 4;
            case 0xb8: case 0xb9: case 0xba: case 0xbb:
            case 0xbc: case 0xbd: case 0xbe: case 0xbf:
                this._r16set(op & 7, this._fetch16()); return 4;

            // ---- 0xc0-0xcf: returns, LES/LDS, MOV imm, interrupts --------
            // C0/C1 and C8/C9 are not 80186 shift-by-immediate here: they
            // decode as the returns two bits along.
            case 0xc0: case 0xc2: { const k = this._fetch16(); this.ip = this._pop(); this.sp = (this.sp + k) & 0xffff; return 20; }
            case 0xc1: case 0xc3: this.ip = this._pop(); return 16;
            case 0xc4: { const c = this._modrm(); this._r16set(this.reg, this._rd16(this.eaSeg, this.ea)); this.es = this._rd16(this.eaSeg, (this.ea + 2) & 0xffff); return 16 + c; }
            case 0xc5: { const c = this._modrm(); this._r16set(this.reg, this._rd16(this.eaSeg, this.ea)); this.ds = this._rd16(this.eaSeg, (this.ea + 2) & 0xffff); return 16 + c; }
            case 0xc6: { const c = this._modrm(); this._rm8set(this._fetch8()); return this.mod === 3 ? 4 : 10 + c; }
            case 0xc7: { const c = this._modrm(); this._rm16set(this._fetch16()); return this.mod === 3 ? 4 : 10 + c; }
            case 0xc8: case 0xca: { const k = this._fetch16(); this.ip = this._pop(); this.cs = this._pop(); this.sp = (this.sp + k) & 0xffff; return 25; }
            case 0xc9: case 0xcb: this.ip = this._pop(); this.cs = this._pop(); return 26;
            case 0xcc: this._swInt(3); return 52;
            case 0xcd: { const v = this._fetch8(); this._swInt(v); return 51; }
            case 0xce: if (this.flags & OF) { this._swInt(4); return 53; } return 4;
            case 0xcf: this.ip = this._pop(); this.cs = this._pop(); this.flags = fixFlags(this._pop()); return 24;

            // ---- 0xd0-0xd7: shift group, BCD by immediate, SALC, XLAT ----
            case 0xd0: case 0xd1: case 0xd2: case 0xd3: {
                const c = this._modrm();
                const w = op & 1, byCl = op & 2;
                // SHIFT COUNTS ARE NOT MASKED ON AN 8086. `shl ax, cl` with
                // CL=33 really shifts thirty-three times and leaves zero;
                // the `& 31` that every later x86 applies arrived with the
                // 186. This is the one variant difference that changes an
                // EXISTING opcode rather than filling an empty one, so it is
                // also the one a program can use to tell the two apart.
                const cnt = byCl ? (this._is186 ? this.cl & 31 : this.cl) : 1;
                const v = w ? this._rm16() : this._rm8();
                const r = this._shift(this.reg, v, cnt, w);
                if (!(this.reg === 6 && cnt === 0)) { if (w) this._rm16set(r); else this._rm8set(r); }
                return (this.mod === 3 ? 2 : 15 + c) + (byCl ? 4 * cnt : 0);
            }
            case 0xd4: this._aam(this._fetch8()); return 83;
            case 0xd5: this._aad(this._fetch8()); return 60;
            case 0xd6: this.al = this.flags & CF ? 0xff : 0x00; return 4;   // SALC
            case 0xd7: this.al = this._rd8(this._srcSeg(), (this.bx + this.al) & 0xffff); return 11;

            // ---- 0xd8-0xdf: the 8087 escape. The operand is read and
            // nothing else happens, which is what a machine with no
            // coprocessor does. ------------------------------------------
            case 0xd8: case 0xd9: case 0xda: case 0xdb:
            case 0xdc: case 0xdd: case 0xde: case 0xdf: {
                const c = this._modrm();
                if (this.mod !== 3) this._rd16(this.eaSeg, this.ea);
                return 2 + c;
            }

            // ---- 0xe0-0xef: loops, port I/O, near and far transfers ------
            case 0xe0: { const d = this._fetchS8(); this.cx = (this.cx - 1) & 0xffff; if (this.cx !== 0 && !(this.flags & ZF)) { this._tookBranch = true; this.ip = (this.ip + d) & 0xffff; return 19; } return 5; }
            case 0xe1: { const d = this._fetchS8(); this.cx = (this.cx - 1) & 0xffff; if (this.cx !== 0 && (this.flags & ZF)) { this._tookBranch = true; this.ip = (this.ip + d) & 0xffff; return 18; } return 6; }
            case 0xe2: { const d = this._fetchS8(); this.cx = (this.cx - 1) & 0xffff; if (this.cx !== 0) { this._tookBranch = true; this.ip = (this.ip + d) & 0xffff; return 17; } return 5; }
            case 0xe3: { const d = this._fetchS8(); if (this.cx === 0) { this._tookBranch = true; this.ip = (this.ip + d) & 0xffff; return 18; } return 6; }
            case 0xe4: this.al = this.inPort(this._fetch8()) & 0xff; return 10;
            case 0xe5: { const p = this._fetch8(); this.ax = (this.inPort(p) & 0xff) | ((this.inPort((p + 1) & 0xffff) & 0xff) << 8); return 10; }
            case 0xe6: this.outPort(this._fetch8(), this.al); return 10;
            case 0xe7: { const p = this._fetch8(); this.outPort(p, this.al); this.outPort((p + 1) & 0xffff, this.ah); return 10; }
            case 0xe8: { const d = this._fetch16(); this._push(this.ip); this._tookBranch = true; this.ip = (this.ip + (d << 16 >> 16)) & 0xffff; return 19; }
            case 0xe9: { const d = this._fetch16(); this._tookBranch = true; this.ip = (this.ip + (d << 16 >> 16)) & 0xffff; return 15; }
            case 0xea: { const ip = this._fetch16(), cs = this._fetch16(); this.ip = ip; this.cs = cs; return 15; }
            case 0xeb: { const d = this._fetchS8(); this._tookBranch = true; this.ip = (this.ip + d) & 0xffff; return 15; }
            case 0xec: this.al = this.inPort(this.dx) & 0xff; return 8;
            case 0xed: this.ax = (this.inPort(this.dx) & 0xff) | ((this.inPort((this.dx + 1) & 0xffff) & 0xff) << 8); return 8;
            case 0xee: this.outPort(this.dx, this.al); return 8;
            case 0xef: this.outPort(this.dx, this.al); this.outPort((this.dx + 1) & 0xffff, this.ah); return 8;

            // ---- 0xf4-0xff: halt, flags, and the two ModR/M groups -------
            case 0xf4: this.halted = true; return 2;
            case 0xf5: this.flags ^= CF; return 2;
            case 0xf6: case 0xf7: return this._group3(op & 1);
            case 0xf8: this.flags &= ~CF; return 2;
            case 0xf9: this.flags |= CF; return 2;
            case 0xfa: this.flags &= ~IF; return 2;
            case 0xfb: this.flags |= IF; return 2;
            case 0xfc: this.flags &= ~DF; return 2;
            case 0xfd: this.flags |= DF; return 2;
            case 0xfe: case 0xff: return this._group45(op & 1);

            default: throw new Unimplemented(op);
        }
    }

    _jcc(take) {
        const d = this._fetchS8();
        // A TAKEN BRANCH FLUSHES EVEN WHEN THE TARGET IS WHERE IT WAS GOING
        // ANYWAY. `jz` with a displacement of zero lands on the next
        // instruction, so comparing CS:IP against the sequential continuation
        // cannot see it -- they are equal -- but the 8088 still throws the
        // queue away, because the microcode's branch path reloads
        // unconditionally rather than checking whether it needed to.
        //
        // 53 vectors in 152,000 say so, all of them `jz` with a zero
        // displacement. The comparison in step() is right for every other
        // transfer; this is the one case that has to be TOLD rather than
        // inferred, so it is set here where the decision is made.
        if (take) { this._tookBranch = true; this.ip = (this.ip + d) & 0xffff; return 16; }
        return 4;
    }

    /** F6/F7. reg=1 is an alias of reg=0 (TEST), not an invalid form. */
    _group3(w) {
        const c = this._modrm();
        const mem = this.mod !== 3;
        switch (this.reg) {
            case 0: case 1: {
                const a = w ? this._rm16() : this._rm8();
                const b = w ? this._fetch16() : this._fetch8();
                this._logic(a & b, w);
                return mem ? 11 + c : 5;
            }
            case 2: {                                     // NOT: no flags at all
                const a = w ? this._rm16() : this._rm8();
                if (w) this._rm16set(~a & 0xffff); else this._rm8set(~a & 0xff);
                return mem ? 16 + c : 3;
            }
            case 3: {                                     // NEG
                const a = w ? this._rm16() : this._rm8();
                const r = this._sub(0, a, 0, w);
                if (w) this._rm16set(r); else this._rm8set(r);
                return mem ? 16 + c : 3;
            }
            case 4: if (w) this._mul16(this._rm16()); else this._mul8(this._rm8()); return mem ? 76 + c : 70;
            case 5: if (w) this._imul16(this._rm16()); else this._imul8(this._rm8()); return mem ? 104 + c : 98;
            case 6: if (w) this._div16(this._rm16()); else this._div8(this._rm8()); return mem ? 155 + c : 90;
            default: if (w) this._idiv16(this._rm16()); else this._idiv8(this._rm8()); return mem ? 177 + c : 112;
        }
    }

    /** FE (byte: INC/DEC only) and FF. FF reg=7 aliases reg=6 (PUSH). */
    _group45(w) {
        const c = this._modrm();
        const mem = this.mod !== 3;
        if (!w) {
            switch (this.reg) {
                case 0: this._rm8set(this._inc(this._rm8(), 0)); return mem ? 15 + c : 3;
                case 1: this._rm8set(this._dec(this._rm8(), 0)); return mem ? 15 + c : 3;
                default: throw new Unimplemented(0xfe);
            }
        }
        switch (this.reg) {
            case 0: this._rm16set(this._inc(this._rm16(), 1)); return mem ? 15 + c : 3;
            case 1: this._rm16set(this._dec(this._rm16(), 1)); return mem ? 15 + c : 3;
            case 2: { const t = this._rm16(); this._push(this.ip); this.ip = t; return mem ? 21 + c : 16; }
            case 3: {
                const ip = this._rd16(this.eaSeg, this.ea);
                const cs = this._rd16(this.eaSeg, (this.ea + 2) & 0xffff);
                this._push(this.cs); this._push(this.ip);
                this.ip = ip; this.cs = cs;
                return 37 + c;
            }
            case 4: this.ip = this._rm16(); return mem ? 18 + c : 11;
            case 5: {
                const ip = this._rd16(this.eaSeg, this.ea);
                const cs = this._rd16(this.eaSeg, (this.ea + 2) & 0xffff);
                this.ip = ip; this.cs = cs;
                return 24 + c;
            }
            default:
                if (mem) this._push(this._rd16(this.eaSeg, this.ea));
                else this._pushR16(this.rm);          // `push sp` again
                return mem ? 16 + c : 11;
        }
    }
}

export default I8086;
