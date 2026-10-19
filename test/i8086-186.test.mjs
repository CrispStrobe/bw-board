/**
 * The 80186 variant — and specifically the parts NO ORACLE GRADES.
 *
 * scripts/grind-i8086-v20.mjs takes 132,532 vectors from the SingleStepTests
 * v20 suite (MIT) and is the real gate on the fifteen opcodes. It is not the
 * gate on everything, because the NEC V20 is not an Intel 186 and the places
 * they differ are exactly the places the suite goes quiet:
 *
 *   - SHIFT-COUNT MASKING. The V20 does not mask; the 186 does. The grinder
 *     therefore EXCLUDES every vector with a count above 31 (39,898 of them)
 *     and says so in its summary. Masking is the defining behaviour of this
 *     variant and nothing outside this file checks it.
 *   - REG=6. The 8086 has SETMO there, verified by 646,000 vectors. The 186
 *     reclaimed the encoding as a second SHL. The v20 suite agrees with SHL,
 *     so that half IS graded — but that it should differ BY VARIANT is a
 *     decision, and a decision belongs in a test.
 *   - The variant flag itself, and that an unknown one is refused rather than
 *     quietly becoming an 8086.
 *
 * Everything here is written so that a change of mind about the 186 has to be
 * a change of mind IN THIS FILE, not a number that silently moves.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { I8086 } from '../src/i8086.js';

/** A bare core over 1 MB of RAM, with a program at CS:IP = 0000:0000. */
function bench(bytes, variant) {
    const mem = new Uint8Array(1 << 20);
    mem.set(bytes, 0);
    const io = { reads: [], writes: [] };
    const cpu = new I8086({
        read: (a) => mem[a & 0xfffff],
        write: (a, v) => { mem[a & 0xfffff] = v & 0xff; },
        in: (p) => { io.reads.push(p); return 0xff; },
        out: (p, v) => { io.writes.push([p, v]); },
    }, variant ? { variant } : undefined);
    cpu.cs = 0; cpu.ds = 0; cpu.es = 0; cpu.ss = 0;
    cpu.ip = 0; cpu.sp = 0x1000;
    return { cpu, mem, io };
}

test('the variant flag: default, explicit, and a refusal', () => {
    const bus = { read: () => 0x90, write: () => {} };
    assert.equal(new I8086(bus).variant, '8086');
    assert.equal(new I8086(bus, {}).variant, '8086');
    assert.equal(new I8086(bus, { variant: '8086' }).variant, '8086');
    assert.equal(new I8086(bus, { variant: '80186' }).variant, '80186');
    // An unknown variant is a CALLER ERROR and is refused by name. Falling
    // back to '8086' would hand a caller who typed '186' or 'V20' a working
    // machine that is quietly the wrong chip.
    assert.throws(() => new I8086(bus, { variant: '186' }), /unknown variant/);
    assert.throws(() => new I8086(bus, { variant: 'v20' }), /unknown variant/);
});

test('shift counts: an 8086 does not mask, a 186 does', () => {
    // shl al, cl with AL=1 and CL=33. Unmasked that shifts every bit out and
    // leaves zero; masked to 33 & 31 = 1 it leaves 2. This is the difference
    // period software uses to tell the parts apart, and the v20 suite cannot
    // grade it because the V20 sides with the 8086 here.
    for (const [variant, want] of [['8086', 0x00], ['80186', 0x02]]) {
        const { cpu } = bench([0xd2, 0xe0], variant);   // D2 /4 = shl rm8, cl
        cpu.al = 1; cpu.cl = 33;
        cpu.step();
        assert.equal(cpu.al, want, `shl al,cl (cl=33) on ${variant}`);
    }
});

// The test above masks SHL only. The 186 masks the count for the WHOLE group-2
// (D0-D3), once, before the op runs -- so SHR/SAR and the rotates mask too, and
// the places it is VISIBLE are exactly the ones no oracle grades: the v20 grind
// drops every count over 31. Ground-truthed against the core, then pinned here
// so a change of mind about the 186 has to be a change of mind IN THIS FILE.
//
// `D2 /r  <op> al, cl` -- the reg field of the ModRM byte selects the op.
const GROUP2 = { rol: 0xc0, ror: 0xc8, rcl: 0xd0, rcr: 0xd8, shl: 0xe0, shr: 0xe8, sar: 0xf8 };
const shiftAlCl = (modrm, variant, al, cl, cfIn = 1) => {
    const { cpu } = bench([0xd2, modrm], variant);
    cpu.al = al; cpu.cl = cl;
    if (cfIn) cpu.flags |= 0x0001; else cpu.flags &= ~0x0001;
    cpu.step();
    return { al: cpu.al, cf: cpu.flags & 0x0001 ? 1 : 0 };
};

test('the whole shift/rotate group masks its count, not just SHL', () => {
    // cl=33 masks to 1 on the 186. AL=81h with CF=1 coming in, so a single step
    // of each op has a distinct, hand-checkable result -- and every one DIFFERS
    // from the unmasked 8086, which acts on the count 33 times. RCL/RCR are the
    // subtle pair: a rotate-through-carry has period 9 (byte), which does NOT
    // divide 32, so masking to five bits changes the result rather than being
    // absorbed by the period the way a plain rotate's is.
    const masked1 = {
        shl: { al: 0x02, cf: 1 },   // 81 << 1, CF = old bit7
        shr: { al: 0x40, cf: 1 },   // 81 >> 1, CF = old bit0
        sar: { al: 0xc0, cf: 1 },   // arithmetic: the sign fills from the left
        rcl: { al: 0x03, cf: 1 },   // (81<<1)|cf_in, CF = old bit7
        rcr: { al: 0xc0, cf: 1 },   // (cf_in<<7)|(81>>1), CF = old bit0
    };
    for (const [op, want] of Object.entries(masked1)) {
        assert.deepEqual(shiftAlCl(GROUP2[op], '80186', 0x81, 33), want,
            `${op} al,cl (cl=33) masks to 1 on the 186`);
        assert.notEqual(shiftAlCl(GROUP2[op], '8086', 0x81, 33).al, want.al,
            `${op}: the 8086 does not mask, so its result differs`);
    }
});

test('a count of 32 is a complete no-op on the 186 and a wipe on the 8086', () => {
    // 32 & 31 = 0: the 186 does nothing at all -- operand AND flags untouched --
    // while the 8086 acts on the operand 32 times. The cleanest single tell
    // between the parts, and unreachable by the v20 grind (which stops at 31).
    for (const op of ['shl', 'shr', 'sar', 'rcl', 'rcr']) {
        assert.deepEqual(shiftAlCl(GROUP2[op], '80186', 0x81, 32), { al: 0x81, cf: 1 },
            `${op} by 32 is a no-op on the 186: nothing moved, CF unchanged`);
        assert.notDeepEqual(shiftAlCl(GROUP2[op], '8086', 0x81, 32), { al: 0x81, cf: 1 },
            `${op} by 32 is NOT a no-op on the 8086`);
    }
});

test('pure ROL/ROR mask too, but INVISIBLY: their period divides 32', () => {
    // Both mask like the rest -- but a byte rotate has period 8, and 8 divides
    // 32, so (count & 31) and count always land on the same rotation. Asserted
    // EQUAL across the variants on purpose: it marks the boundary of what the
    // masking can be observed through, and stops a future reader "fixing" a
    // divergence that cannot exist here.
    for (const op of ['rol', 'ror']) {
        assert.deepEqual(
            shiftAlCl(GROUP2[op], '80186', 0x81, 33),
            shiftAlCl(GROUP2[op], '8086', 0x81, 33),
            `${op} by 33: masked and unmasked coincide (period 8 | 32)`);
    }
});

// The three tests above drive D2 -- the 8-bit operand path. D3 is the 16-bit
// path, a SEPARATE operand handler masked by the same single site, so the same
// ungraded counts exercise a second body of code. AX=8001h keeps a set top bit
// (SAR sign, rotate wrap) and a set bottom bit (CF out).
const shiftAxCl = (modrm, variant, ax, cl, cfIn = 1) => {
    const { cpu } = bench([0xd3, modrm], variant);
    cpu.ax = ax; cpu.cl = cl;
    if (cfIn) cpu.flags |= 0x0001; else cpu.flags &= ~0x0001;
    cpu.step();
    return { ax: cpu.ax, cf: cpu.flags & 0x0001 ? 1 : 0 };
};

test('the WORD shift/rotate group masks too (D3), on the 16-bit operand path', () => {
    // cl=33 masks to 1 on the 186. The rotate-through-carry pair is period 17
    // here (16 + the carry bit), which still does not divide 32, so RCL/RCR
    // stay visible; every op differs from the unmasked 8086.
    const masked1 = {
        shl: { ax: 0x0002, cf: 1 },   // 8001 << 1, CF = old bit15
        shr: { ax: 0x4000, cf: 1 },   // 8001 >> 1, CF = old bit0
        sar: { ax: 0xc000, cf: 1 },   // arithmetic: the sign fills from the left
        rcl: { ax: 0x0003, cf: 1 },   // (8001<<1)|cf_in, CF = old bit15
        rcr: { ax: 0xc000, cf: 1 },   // (cf_in<<15)|(8001>>1), CF = old bit0
    };
    for (const [op, want] of Object.entries(masked1)) {
        assert.deepEqual(shiftAxCl(GROUP2[op], '80186', 0x8001, 33), want,
            `${op} ax,cl (cl=33) masks to 1 on the 186`);
        assert.notEqual(shiftAxCl(GROUP2[op], '8086', 0x8001, 33).ax, want.ax,
            `${op}: the 8086 word form does not mask either`);
    }
});

test('a word count of 32 is a 186 no-op and an 8086 wipe', () => {
    for (const op of ['shl', 'shr', 'sar', 'rcl', 'rcr']) {
        assert.deepEqual(shiftAxCl(GROUP2[op], '80186', 0x8001, 32), { ax: 0x8001, cf: 1 },
            `${op} ax by 32 is a no-op on the 186: nothing moved, CF unchanged`);
        assert.notDeepEqual(shiftAxCl(GROUP2[op], '8086', 0x8001, 32), { ax: 0x8001, cf: 1 },
            `${op} ax by 32 is NOT a no-op on the 8086`);
    }
});

test('word ROL/ROR mask invisibly too: their period 16 divides 32', () => {
    for (const op of ['rol', 'ror']) {
        assert.deepEqual(
            shiftAxCl(GROUP2[op], '80186', 0x8001, 33),
            shiftAxCl(GROUP2[op], '8086', 0x8001, 33),
            `${op} ax by 33: masked and unmasked coincide (period 16 | 32)`);
    }
});

test('shift by WORD immediate: C1 masks on the 186 and is a near RET on the 8086', () => {
    // The byte-immediate C0 is covered below; C1 is its 16-bit operand form. On
    // an 8086 C1 is an alias of NEAR RET -- it pops IP and runs no shift -- so
    // the variants must genuinely diverge, exactly as C0/C2 do.
    const { cpu: a } = bench([0xc1, 0xe0, 0x21], '80186');   // shl ax, 21h; 0x21 masks to 1
    a.ax = 0x8001; a.step();
    assert.equal(a.ax, 0x0002, 'shl ax, 21h masks 33 to 1');
    assert.equal(a.ip, 3, 'a three-byte instruction on the 186');

    const { cpu: b, mem } = bench([0xc1, 0xe0, 0x21], '8086');
    b.ax = 0x8001; b.sp = 0x1000;
    mem[0x1000] = 0x34; mem[0x1001] = 0x12;                  // a return address on the stack
    b.step();
    assert.equal(b.ax, 0x8001, 'on an 8086 C1 runs no shift: AX is untouched');
    assert.equal(b.ip, 0x1234, 'C1 is a near RET: IP comes off the stack');
    assert.equal(b.sp, 0x1002, 'and only the two IP bytes are popped -- no immediate');
});

test('shift by immediate: C0/C1 exist only on the 186, and mask', () => {
    // On an 8086 C0 is an ALIAS OF RET imm16 -- it pops IP and adds the
    // immediate to SP. That is not a rough edge to smooth off: it is what
    // 646,000 vectors verified, so the two variants must genuinely diverge.
    const { cpu: a } = bench([0xc0, 0xe0, 0x21], '8086');  // reads as `ret 0E0h`... 
    a.sp = 0x1000;
    a.step();
    assert.equal(a.ip, 0, 'on an 8086 C0 is RET: IP comes off the stack');

    // On a 186 it is `shl al, 21h`, and 0x21 masks to 1.
    const { cpu: b } = bench([0xc0, 0xe0, 0x21], '80186');
    b.al = 1;
    b.step();
    assert.equal(b.al, 2, 'shl al, 21h masks 33 to 1');
    assert.equal(b.ip, 3, 'and it is a three-byte instruction');
});

test('reg=6 is SETMO on an 8086 and a second SHL on a 186', () => {
    // D0 /6. The 8086 sets the operand to all ones (undocumented, real,
    // vector-verified). The 186 reclaimed the encoding.
    const { cpu: a } = bench([0xd0, 0xf0], '8086');
    a.al = 0x03; a.step();
    assert.equal(a.al, 0xff, 'SETMO sets every bit');

    const { cpu: b } = bench([0xd0, 0xf0], '80186');
    b.al = 0x03; b.step();
    assert.equal(b.al, 0x06, 'on a 186 the same encoding shifts left by one');
});

test('reg=6 covers the word and by-CL forms too: SETMO(C) on the 8086, a shift on a 186', () => {
    // The test above covers D0 /6 -- the 8-bit, count-1 form. D1 is the 16-bit
    // operand, and D2/D3 are the by-CL "SETMOC". Each is all-ones on the 8086
    // (undocumented, vector-verified) and the reclaimed second shift on the 186.
    // Verified against the core; nothing else grades that they split BY VARIANT.
    const regSix = (bytes, variant, wide) => {
        const { cpu } = bench(bytes, variant);
        if (wide) cpu.ax = 0x0003; else cpu.al = 0x03;
        cpu.cl = 1;                                    // the by-CL forms shift once
        cpu.step();
        return wide ? cpu.ax : cpu.al;
    };
    for (const [label, bytes, wide, ones] of [
        ['D1/6 word, count 1', [0xd1, 0xf0], true, 0xffff],
        ['D2/6 byte, by cl',   [0xd2, 0xf0], false, 0xff],
        ['D3/6 word, by cl',   [0xd3, 0xf0], true, 0xffff],
    ]) {
        assert.equal(regSix(bytes, '8086', wide), ones, `${label}: SETMO sets every bit on the 8086`);
        assert.equal(regSix(bytes, '80186', wide), wide ? 0x0006 : 0x06,
            `${label}: the 186 shifts left by one instead`);
    }
});

test('PUSHA pushes the ENTRY SP, and POPA discards that slot', () => {
    const { cpu, mem } = bench([0x60], '80186');
    cpu.ax = 0x1111; cpu.cx = 0x2222; cpu.dx = 0x3333; cpu.bx = 0x4444;
    cpu.bp = 0x5555; cpu.si = 0x6666; cpu.di = 0x7777;
    const sp0 = cpu.sp;
    cpu.step();
    assert.equal(cpu.sp, (sp0 - 16) & 0xffff, 'sixteen bytes of stack');
    // The fifth push is SP, and it is the value from BEFORE the instruction --
    // NOT `push sp`'s decremented value on this same chip.
    const stacked = mem[sp0 - 10] | (mem[sp0 - 9] << 8);
    assert.equal(stacked, sp0, 'the stacked SP is the entry value');
});

test('POPA round-trips every register except SP', () => {
    const { cpu } = bench([0x60, 0x61], '80186');
    const before = { ax: 0x1111, cx: 0x2222, dx: 0x3333, bx: 0x4444,
        bp: 0x5555, si: 0x6666, di: 0x7777 };
    Object.assign(cpu, before);
    const sp0 = cpu.sp;
    cpu.step();                                        // pusha
    Object.assign(cpu, { ax: 0, cx: 0, dx: 0, bx: 0, bp: 0, si: 0, di: 0 });
    cpu.step();                                        // popa
    for (const [r, v] of Object.entries(before)) assert.equal(cpu[r], v, r);
    assert.equal(cpu.sp, sp0, 'SP returns by unwinding, not by being restored');
});

test('BOUND passes inside the range and takes INT 5 outside it', () => {
    // bound ax, [bx]. Bounds are INCLUSIVE and the comparison is SIGNED.
    const build = (idx, lo, hi) => {
        const { cpu, mem } = bench([0x62, 0x07], '80186');   // mod=00 reg=0 rm=7 -> [bx]
        cpu.ax = idx; cpu.bx = 0x200;
        mem[0x200] = lo & 0xff; mem[0x201] = (lo >> 8) & 0xff;
        mem[0x202] = hi & 0xff; mem[0x203] = (hi >> 8) & 0xff;
        // A recognisable INT 5 vector, so "did it fault" is unambiguous.
        mem[5 * 4] = 0x00; mem[5 * 4 + 1] = 0xf0; mem[5 * 4 + 2] = 0x00; mem[5 * 4 + 3] = 0x00;
        cpu.step();
        return cpu;
    };
    assert.equal(build(5, 1, 10).ip, 2, 'inside: falls through');
    assert.equal(build(1, 1, 10).ip, 2, 'the lower bound is inclusive');
    assert.equal(build(10, 1, 10).ip, 2, 'the upper bound is inclusive');
    assert.equal(build(0, 1, 10).ip, 0xf000, 'below: INT 5');
    assert.equal(build(11, 1, 10).ip, 0xf000, 'above: INT 5');
    // Signed, not unsigned: -1 against a range starting at -10 is INSIDE, and
    // an unsigned comparison would read it as 65535 and fault.
    assert.equal(build(0xffff, 0xfff6, 0x000a).ip, 2, 'signed comparison');
});

test('PUSH imm8 sign-extends; PUSH imm16 does not', () => {
    const { cpu: a, mem: ma } = bench([0x6a, 0xff], '80186');
    const sp0 = a.sp; a.step();
    assert.equal(ma[sp0 - 2] | (ma[sp0 - 1] << 8), 0xffff, 'push -1 stores FFFFh');

    const { cpu: b, mem: mb } = bench([0x68, 0x34, 0x12], '80186');
    const sp1 = b.sp; b.step();
    assert.equal(mb[sp1 - 2] | (mb[sp1 - 1] << 8), 0x1234);
});

test('the three-operand IMUL keeps the low word and flags the overflow', () => {
    // imul ax, bx, 2  -- 3 * 2 fits, so CF and OF are clear.
    const { cpu: a } = bench([0x6b, 0xc3, 0x02], '80186');
    a.bx = 3; a.flags |= 0x0801; a.step();
    assert.equal(a.ax, 6);
    assert.equal(a.flags & 0x0801, 0, 'a result that fits clears CF and OF');

    // 0x4000 * 4 = 0x10000: the low word is zero and the high word is not a
    // sign extension of it, so both flags set.
    const { cpu: b } = bench([0x6b, 0xc3, 0x04], '80186');
    b.bx = 0x4000; b.step();
    assert.equal(b.ax, 0x0000);
    assert.equal(b.flags & 0x0801, 0x0801, 'CF and OF report the lost half');
});

test('ENTER 0 builds a bare frame; LEAVE takes it down again', () => {
    const { cpu, mem } = bench([0xc8, 0x08, 0x00, 0x00, 0xc9], '80186');
    cpu.bp = 0xbeef;
    const sp0 = cpu.sp;
    cpu.step();                                        // enter 8, 0
    assert.equal(mem[sp0 - 2] | (mem[sp0 - 1] << 8), 0xbeef, 'the old BP is pushed');
    assert.equal(cpu.bp, (sp0 - 2) & 0xffff, 'BP points at the saved BP');
    assert.equal(cpu.sp, (sp0 - 10) & 0xffff, 'and eight bytes of locals follow');
    cpu.step();                                        // leave
    assert.equal(cpu.bp, 0xbeef, 'LEAVE restores BP');
    assert.equal(cpu.sp, sp0, 'and SP');
});

test('ENTER with a level copies the display, and pushes the new frame last', () => {
    // level 2 copies one enclosing frame pointer, then the new frame.
    const { cpu, mem } = bench([0xc8, 0x00, 0x00, 0x02], '80186');
    cpu.bp = 0x0300;
    mem[0x02fe] = 0xcd; mem[0x02ff] = 0xab;            // the enclosing display entry
    const sp0 = cpu.sp;
    cpu.step();
    assert.equal(mem[sp0 - 2] | (mem[sp0 - 1] << 8), 0x0300, 'old BP first');
    assert.equal(mem[sp0 - 4] | (mem[sp0 - 3] << 8), 0xabcd, 'then the copied entry');
    assert.equal(mem[sp0 - 6] | (mem[sp0 - 5] << 8), (sp0 - 2) & 0xffff,
        'and the NEW frame pointer last -- this is the half that is usually wrong');
    assert.equal(cpu.bp, (sp0 - 2) & 0xffff);
});

test('INS writes ES:DI and ignores an override; OUTS reads DS:SI and honours one', () => {
    // A word port access is TWO byte accesses, at DX and DX+1.
    const { cpu, mem, io } = bench([0x6d], '80186');    // insw
    cpu.dx = 0x0300; cpu.es = 0x100; cpu.di = 0x10;
    cpu.step();
    assert.deepEqual(io.reads, [0x0300, 0x0301], 'two byte reads, DX and DX+1');
    assert.equal(mem[0x1000 + 0x10], 0xff);
    assert.equal(mem[0x1000 + 0x11], 0xff, 'both halves land -- not 00FFh');
    assert.equal(cpu.di, 0x12);

    // 2E 6E = `cs outsb`: the source segment override applies.
    const { cpu: b, mem: mb, io: ib } = bench([0x2e, 0x6e], '80186');
    b.cs = 0; b.ds = 0x900; b.si = 0x20; b.dx = 0x0400;
    mb[0x20] = 0x5a;                                   // at CS:SI, not DS:SI
    b.step();
    assert.deepEqual(ib.writes, [[0x0400, 0x5a]], 'the override chose CS');
});

test('on an 8086 every one of these is still its alias', () => {
    // The whole variant rests on these encodings being FREE on an 8086. If a
    // future edit makes one of them a 186 instruction unconditionally, this
    // is what catches it.
    const { cpu } = bench([0x60, 0x02], '8086');       // 0x60 aliases JO
    cpu.flags |= 0x0800;                                // OF set
    cpu.step();
    assert.equal(cpu.ip, 4, '0x60 is JO on an 8086, and it was taken');

    const { cpu: b } = bench([0xc9], '8086');          // 0xC9 aliases RETF
    b.step();
    assert.equal(b.sp, 0x1004, 'C9 is RETF on an 8086: four bytes off the stack');
});

// ---------------------------------------------------------------------------
// The disassembler half. grind-i8086-v20-disasm.mjs takes 172,430/172,430 on
// TEXT and LENGTH and is the real gate; these cover the three places this
// module deliberately does NOT match its oracle, plus the variant split.
// ---------------------------------------------------------------------------
import { disasmI8086 } from '../src/i8086-disasm.js';

const dis = (bytes, opts = {}) =>
    disasmI8086((a) => bytes[a] ?? 0x90, 0, { ip: 0, ...opts });

test('disasm: the same bytes read as two different instructions', () => {
    // If a future edit makes any of these unconditional, this is what catches
    // it -- and it is the same guard the core has, because a debugger pane
    // that renders `pusha` as `jo` is a confident lie rather than a gap.
    const cases = [
        [[0x60, 0x02], 'jo 0004h', 'pusha'],
        [[0x61, 0x02], 'jno 0004h', 'popa'],
        [[0xc9], 'retf', 'leave'],
        [[0xc8, 0x15, 0x00, 0x0a], 'retf 15h', 'enter 15h, Ah'],
        [[0xd0, 0xf0], 'setmo al', 'shl al'],
        [[0xd2, 0xf0], 'setmoc al, cl', 'shl al, cl'],
    ];
    for (const [bytes, on8086, on186] of cases) {
        assert.equal(dis(bytes).text, on8086, `8086: ${bytes.map((b) => b.toString(16))}`);
        assert.equal(dis(bytes, { variant: '80186' }).text, on186, `186: ${bytes.map((b) => b.toString(16))}`);
    }
});

test('disasm: the immediate IMUL prints its immediate, and v20Syntax drops it', () => {
    // The suite's own disassembler renders these bytes as `imul cx, word
    // [ds:si]` with DA86h nowhere in the text. Matching that by default would
    // put a lossy rendering in front of a person reading a debugger pane.
    const bytes = [0x69, 0x0c, 0x86, 0xda];
    assert.equal(dis(bytes, { variant: '80186' }).text, 'imul cx, word [ds:si], DA86h');
    assert.equal(dis(bytes, { variant: '80186', v20Syntax: true }).text, 'imul cx, word [ds:si]');
    assert.equal(dis(bytes, { variant: '80186' }).length, 4, 'four bytes either way');
});

test('disasm: an override is shown when it does something', () => {
    // INS writes ES:DI and no override can change that, so the prefix byte is
    // inert and is not printed. OUTS reads DS:SI and the override applies, so
    // it is -- except under the suite's convention, which hides it.
    assert.equal(dis([0x2e, 0x6c], { variant: '80186' }).text, 'insb');
    assert.equal(dis([0x2e, 0x6e], { variant: '80186' }).text, 'cs outsb');
    assert.equal(dis([0x2e, 0x6e], { variant: '80186', v20Syntax: true }).text, 'outsb');
    // Neither reads ZF, so F2 and F3 both spell `rep` -- unlike cmps/scas.
    assert.equal(dis([0xf2, 0x6c], { variant: '80186' }).text, 'rep insb');
    assert.equal(dis([0xf3, 0x6c], { variant: '80186' }).text, 'rep insb');
});

test('disasm: the word shift form pads its count and the byte form does not', () => {
    // No principle in it; it is what the oracle emits, and 800 vectors
    // disagreed in one leading zero until this matched.
    assert.equal(dis([0xc0, 0xe0, 0x03], { variant: '80186' }).text, 'shl al, 3h');
    assert.equal(dis([0xc1, 0xe0, 0x03], { variant: '80186' }).text, 'shl ax, 03h');
});

test('disasm: an unknown variant is refused, not silently downgraded', () => {
    assert.throws(() => dis([0x90], { variant: '186' }), /unknown variant/);
    assert.equal(dis([0x90]).text, 'nop', 'and the default is still an 8086');
});

// ---------------------------------------------------------------------------
// Labels. Substitution is BY POSITION, not by pattern -- see the comment on
// `label()` in i8086-disasm.js. These are the cases that made the difference
// visible; the old regex over the finished text failed four of the six.
// ---------------------------------------------------------------------------

test('labels: an address takes one, an immediate never does', () => {
    const labels = new Map([[0x1234, 'start'], [0x002b, 'loop_top'], [0x0042, 'counter']]);
    const d = (bytes, opts = {}) =>
        disasmI8086((a) => bytes[a] ?? 0x90, 0, { ip: 0, labels, ...opts }).text;

    // Addresses: labelled.
    assert.equal(d([0x7e, 0x29]), 'jle loop_top', 'relative jump target');
    assert.equal(d([0x8b, 0x06, 0x34, 0x12]), 'mov ax, word [ds:start]', 'direct memory');
    assert.equal(d([0xa1, 0x42, 0x00]), 'mov ax, word [ds:counter]', 'moffs load');
    assert.equal(d([0xa3, 0x34, 0x12]), 'mov word [ds:start], ax', 'moffs store');

    // Immediates: never. THIS IS THE BUG THE OLD IMPLEMENTATION HAD -- a
    // regex over the finished text cannot tell 1234h-the-constant from
    // 1234h-the-address, so a pane silently invented a cross-reference.
    assert.equal(d([0xb8, 0x34, 0x12]), 'mov ax, 1234h', 'a 16-bit immediate');
    assert.equal(d([0xc8, 0x34, 0x12, 0x02], { variant: '80186' }), 'enter 1234h, 2h',
        "ENTER's frame size is a size, not an address");

    // A displacement is part of an effective address computed at run time,
    // not an address known now, so it is left alone too.
    assert.equal(d([0x8b, 0x87, 0x34, 0x12]), 'mov ax, word [ds:bx+1234h]', 'a displacement');
});

test('labels: width does not decide, and an absent map changes nothing', () => {
    // The old regex required four hex digits, so a datum at 0042h could never
    // be named while one at 1042h could -- a distinction nothing in the
    // machine makes. Both are labelled now.
    const labels = new Map([[0x0042, 'lo'], [0x1042, 'hi']]);
    const d = (bytes) => disasmI8086((a) => bytes[a] ?? 0x90, 0, { ip: 0, labels }).text;
    assert.equal(d([0xa1, 0x42, 0x00]), 'mov ax, word [ds:lo]');
    assert.equal(d([0xa1, 0x42, 0x10]), 'mov ax, word [ds:hi]');

    // And with no map at all the rendering is byte-identical to what the
    // 646,000-vector grind verifies.
    const bare = disasmI8086((a) => [0x7e, 0x29][a] ?? 0x90, 0, { ip: 0 });
    assert.equal(bare.text, 'jle 002Bh');
});

test('labels: a far pointer is NOT labelled, because it cannot be', () => {
    // `jmpf 5678:1234` -- the offset means nothing without its segment, and a
    // map keyed on sixteen bits cannot say which segment a name belongs to.
    // Labelling it would be right only when CS happened to match.
    const labels = new Map([[0x1234, 'start']]);
    const text = disasmI8086((a) => [0xea, 0x34, 0x12, 0x78, 0x56][a] ?? 0x90, 0,
        { ip: 0, labels }).text;
    assert.ok(!text.includes('start'), `far pointer left alone, got: ${text}`);
});

// ---------------------------------------------------------------------------
// The variant is reachable through the MACHINE, not only through the core --
// which is the half that makes a breadboard 80188 a config key rather than a
// fork, and the half I originally plumbed without testing.
// ---------------------------------------------------------------------------
import { I8086Machine } from '../src/i8086-machine.js';

/** The smallest machine that will run: RAM over the whole space. */
const machineCfg = (variant) => ({
    clockHz: 5_000_000,
    regions: [{ kind: 'ram', start: 0, end: 0xfffff }],
    chips: [],
    ...(variant ? { variant } : {}),
});

test('machine: the variant reaches the core, and defaults to 8086', () => {
    assert.equal(new I8086Machine(machineCfg()).cpu.variant, '8086');
    assert.equal(new I8086Machine(machineCfg('8086')).cpu.variant, '8086');
    assert.equal(new I8086Machine(machineCfg('80186')).cpu.variant, '80186');
    assert.throws(() => new I8086Machine(machineCfg('80188')), /unknown variant/,
        'an 80188 is an 80186 core on an 8-bit bus; the ISA name is what this key takes');
});

test('machine: the same byte runs as two instructions on the two variants', () => {
    // End to end through the machine rather than the bare core: 60h at the
    // reset-adjacent address, PUSHA on one and JO on the other.
    const run = (variant) => {
        const m = new I8086Machine(machineCfg(variant));
        m.cpu.cs = 0; m.cpu.ip = 0; m.cpu.ss = 0; m.cpu.sp = 0x1000;
        m.mem[0] = 0x60; m.mem[1] = 0x02;
        m.cpu.flags &= ~0x0800;                        // OF clear, so JO is NOT taken
        m.step();
        return m.cpu.sp;
    };
    assert.equal(run('8086'), 0x1000, 'JO not taken: the stack is untouched');
    assert.equal(run('80186'), 0x1000 - 16, 'PUSHA: sixteen bytes of stack');
});

test('machine: a snapshot carries its variant and refuses a mismatched restore', () => {
    const a = new I8086Machine(machineCfg('80186'));
    a.cpu.ax = 0x1234;
    const snap = a.saveState();
    // The complete v2 checkpoint carries the variant inside its topology, where
    // it belongs: 60h is PUSHA on a 186 and JO on an 8086, so the variant is a
    // decode property of the snapshotted machine, not a free-standing key.
    assert.equal(JSON.parse(snap.topology).variant, '80186', 'the variant is IN the snapshot topology');

    // Onto an identical machine: fine.
    const b = new I8086Machine(machineCfg('80186'));
    b.loadState(snap);
    assert.equal(b.cpu.ax, 0x1234);

    // Onto the other chip: REFUSED. Loading it silently would give a machine
    // that runs the restored program correctly right up to the first 186 opcode
    // and then quietly takes a conditional jump instead. The variant is part of
    // the topology, so a cross-variant restore fails the topology match.
    const c = new I8086Machine(machineCfg('8086'));
    assert.throws(() => c.loadState(snap), /topology does not match|from a 80186 machine/);

    // The complete v2 checkpoint replaced the older best-effort v1 snapshot,
    // which omitted live component and interrupt state and is intentionally not
    // accepted as a deterministic continuation point.
    const d = new I8086Machine(machineCfg('8086'));
    assert.throws(
        () => d.loadState({ v: 1, variant: '8086', cpu: {}, cycles: 0, mem: new Uint8Array(0), chips: {} }),
        /version 2 required/);
});
