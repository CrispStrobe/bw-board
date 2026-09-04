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
