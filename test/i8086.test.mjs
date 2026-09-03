// The 8086 core. The real verification is scripts/grind-i8086.mjs against the
// SingleStepTests 8086 suite — 646,000/646,000 on 2026-09-03. These tests are
// the always-on subset: hand-assembled programs for the behaviors that would
// cost a day each to rediscover, plus a sampled grind when the (out-of-repo,
// 526 MB) vector suite is present locally.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { I8086, Unimplemented } from '../src/i8086.js';

const CF = 0x0001, AF = 0x0010, ZF = 0x0040, DF = 0x0400;

/** A machine with a flat megabyte behind it, code loaded at CS:0000. */
function machine(bytes, { cs = 0x1000, ds = 0x2000, es = 0x3000, ss = 0x4000, sp = 0x0100 } = {}) {
    const mem = new Uint8Array(1 << 20);
    const cpu = new I8086({
        read: (a) => mem[a & 0xfffff],
        write: (a, v) => { mem[a & 0xfffff] = v & 0xff; },
        in: () => 0xff,
        out: () => {},
    });
    cpu.reset();
    cpu.cs = cs; cpu.ip = 0; cpu.ds = ds; cpu.es = es; cpu.ss = ss; cpu.sp = sp;
    mem.set(bytes, cs << 4);
    return { cpu, mem };
}
const run = (cpu, n) => { for (let i = 0; i < n; i++) cpu.step(); };

test('a physical address is (seg << 4) + off, and the segment is the ModR/M default', () => {
    const { cpu, mem } = machine([
        0xbb, 0x34, 0x12,       // MOV BX, 1234h
        0xc6, 0x07, 0x5a,       // MOV BYTE [BX], 5Ah      -> DS:1234
        0xc6, 0x46, 0x00, 0xa5, // MOV BYTE [BP+0], A5h    -> SS:BP, not DS
    ]);
    cpu.bp = 0x0080;
    run(cpu, 3);
    assert.equal(mem[(0x2000 << 4) + 0x1234], 0x5a, 'BX-based access belongs to DS');
    assert.equal(mem[(0x4000 << 4) + 0x0080], 0xa5, 'BP-based access belongs to SS');
});

test('an offset wraps inside its segment: a word at FFFF does not spill into the next paragraph', () => {
    const { cpu, mem } = machine([
        0xbb, 0xff, 0xff,       // MOV BX, FFFFh
        0xc7, 0x07, 0xcd, 0xab, // MOV WORD [BX], ABCDh
    ]);
    run(cpu, 2);
    assert.equal(mem[(0x2000 << 4) + 0xffff], 0xcd, 'low byte at the end of the segment');
    assert.equal(mem[0x2000 << 4], 0xab, 'high byte wraps to offset 0000 of the SAME segment');
});

test('PUSH SP stores the decremented value — the 8086 signature the 286 dropped', () => {
    const { cpu, mem } = machine([0x54]);       // PUSH SP
    cpu.sp = 0x0100;
    run(cpu, 1);
    assert.equal(cpu.sp, 0x00fe);
    const pushed = mem[(0x4000 << 4) + 0xfe] | (mem[(0x4000 << 4) + 0xff] << 8);
    assert.equal(pushed, 0x00fe, 'the value stored is SP AFTER the decrement');
});

test('a string destination is ES:DI even when the source is overridden', () => {
    const { cpu, mem } = machine([
        0x2e, 0xa4,             // CS: MOVSB   -- source CS:SI, destination ES:DI
    ]);
    cpu.si = 0x0500; cpu.di = 0x0600;
    mem[(0x1000 << 4) + 0x0500] = 0x77;         // in CS, where the override points
    mem[(0x2000 << 4) + 0x0500] = 0x11;         // in DS, where it would go unoverridden
    run(cpu, 1);
    assert.equal(mem[(0x3000 << 4) + 0x0600], 0x77, 'source took the override, destination is ES');
    assert.equal(cpu.si, 0x0501);
    assert.equal(cpu.di, 0x0601);
});

test('REP MOVSW runs CX times and STD makes it run backwards', () => {
    const { cpu, mem } = machine([
        0xf3, 0xa5,             // REP MOVSW
        0xfd,                   // STD
        0xf3, 0xa4,             // REP MOVSB
    ]);
    cpu.cx = 4; cpu.si = 0x0100; cpu.di = 0x0200;
    for (let i = 0; i < 8; i++) mem[(0x2000 << 4) + 0x0100 + i] = 0xa0 + i;
    run(cpu, 1);
    assert.equal(cpu.cx, 0);
    assert.equal(cpu.si, 0x0108);
    for (let i = 0; i < 8; i++) assert.equal(mem[(0x3000 << 4) + 0x0200 + i], 0xa0 + i);

    cpu.cx = 3; cpu.si = 0x0300; cpu.di = 0x0400;
    mem[(0x2000 << 4) + 0x0300] = 1; mem[(0x2000 << 4) + 0x02ff] = 2; mem[(0x2000 << 4) + 0x02fe] = 3;
    run(cpu, 2);                                 // STD, then REP MOVSB
    assert.ok(cpu.flags & DF);
    assert.equal(mem[(0x3000 << 4) + 0x0400], 1);
    assert.equal(mem[(0x3000 << 4) + 0x03ff], 2);
    assert.equal(mem[(0x3000 << 4) + 0x03fe], 3);
});

test('DAA on AL=9Ah answers differently depending on AF — the published rule gets this wrong', () => {
    // With AF set the high correction is skipped: 9Ah + 6 = A0h, carry clear.
    const a = machine([0x27]);
    a.cpu.al = 0x9a; a.cpu.flags |= AF;
    run(a.cpu, 1);
    assert.equal(a.cpu.al, 0xa0);
    assert.equal(a.cpu.flags & CF, 0);

    // With AF clear the same AL takes both corrections and carries out.
    const b = machine([0x27]);
    b.cpu.al = 0x9a; b.cpu.flags &= ~AF;
    run(b.cpu, 1);
    assert.equal(b.cpu.al, 0x00);
    assert.ok(b.cpu.flags & CF);
    assert.ok(b.cpu.flags & ZF);
});

test('a shift count is not masked to five bits', () => {
    const { cpu } = machine([
        0xd3, 0xe0,             // SHL AX, CL
    ]);
    cpu.ax = 0x0001; cpu.cl = 33;
    run(cpu, 1);
    // Masked to 5 bits this would be a shift by one and leave 2. The 8086
    // really shifts thirty-three times, so nothing survives.
    assert.equal(cpu.ax, 0);
});

test('SETMO is a real instruction hiding in the shift group', () => {
    const { cpu } = machine([
        0xd0, 0xf0,             // D0 /6 on AL
    ]);
    cpu.al = 0x12;
    run(cpu, 1);
    assert.equal(cpu.al, 0xff, 'the operand becomes all ones');
    assert.equal(cpu.flags & CF, 0);
});

test('SALC, and the 60-6F block aliasing onto the conditional jumps', () => {
    const salc = machine([0xd6]);
    salc.cpu.flags |= CF;
    run(salc.cpu, 1);
    assert.equal(salc.cpu.al, 0xff);

    const jz = machine([0x64, 0x05]);            // 64 decodes as JZ +5
    jz.cpu.flags |= ZF;
    run(jz.cpu, 1);
    assert.equal(jz.cpu.ip, 0x0007);
});

test('PUSHF hands back the bits the 8086 always reads as one', () => {
    const { cpu, mem } = machine([0x9c]);        // PUSHF
    run(cpu, 1);
    const pushed = mem[(0x4000 << 4) + 0xfe] | (mem[(0x4000 << 4) + 0xff] << 8);
    assert.equal(pushed & 0xf002, 0xf002, 'bit 1 and bits 12-15 read as one');
    assert.equal(pushed & 0x0028, 0, 'bits 3 and 5 read as zero');
});

test('INT takes its vector from segment zero and clears IF and TF', () => {
    const { cpu, mem } = machine([0xcd, 0x21]);  // INT 21h
    mem[0x21 * 4] = 0x34; mem[0x21 * 4 + 1] = 0x12;         // IP = 1234h
    mem[0x21 * 4 + 2] = 0x00; mem[0x21 * 4 + 3] = 0x90;     // CS = 9000h
    cpu.flags |= 0x0300;                                     // IF | TF
    run(cpu, 1);
    assert.equal(cpu.cs, 0x9000);
    assert.equal(cpu.ip, 0x1234);
    assert.equal(cpu.flags & 0x0300, 0);
    assert.equal(cpu.sp, 0x00fa, 'FLAGS, CS and IP went on the stack');
});

test('a divide that overflows takes INT 0, and IDIV faults on the magnitude', () => {
    const { cpu, mem } = machine([0xf6, 0xfb]);  // IDIV BL  (F6 /7, not /6)
    mem[0] = 0x00; mem[1] = 0x10;                // vector 0 -> 0000:1000
    cpu.ax = 13140; cpu.bl = 0x9a;               // 13140 / -102 = -128 exactly
    run(cpu, 1);
    assert.equal(cpu.ip, 0x1000, 'a quotient of -128 is out of range on the magnitude check');
    assert.equal(cpu.cs, 0);
});

test('an unimplemented opcode throws rather than passing silently', () => {
    // Every opcode the suite ships is implemented, so this asserts the
    // mechanism, not a gap: FE with reg 2-7 is undefined and unreachable.
    const { cpu } = machine([0xfe, 0xd0]);       // FE /2
    assert.throws(() => cpu.step(), Unimplemented);
});

// ---- sampled grind, only when the suite is on this machine ---------------
const suite = process.env.I8086_VECTORS || join(homedir(), 'code', '8086-vectors', 'v1');
test('sampled vectors from the SingleStepTests 8086 suite', { skip: !existsSync(suite) && 'suite not present' }, () => {
    const meta = JSON.parse(readFileSync(join(suite, 'metadata.json'), 'utf8')).opcodes;
    const maskFor = (base) => {
        const [op, reg] = base.split('.');
        let e = meta[op];
        if (!e) return 0xffff;
        if (e.reg) e = e.reg[reg ?? '0'] || {};
        return e['flags-mask'] ?? 0xffff;
    };
    const REGS = ['ax', 'bx', 'cx', 'dx', 'cs', 'ss', 'ds', 'es', 'sp', 'bp', 'si', 'di', 'ip'];
    const mem = new Uint8Array(1 << 20);
    const cpu = new I8086({
        read: (a) => mem[a & 0xfffff],
        write: (a, v) => { mem[a & 0xfffff] = v & 0xff; },
        in: () => 0xff, out: () => {},
    });
    // Every twentieth file, twenty vectors each: enough to catch a core that
    // has been broken wholesale, cheap enough to run on every commit.
    const files = readdirSync(suite).filter((f) => f.endsWith('.json.gz')).sort()
        .filter((_, i) => i % 20 === 0);
    let checked = 0;
    for (const file of files) {
        const base = file.replace('.json.gz', '');
        const mask = maskFor(base);
        const tests = JSON.parse(gunzipSync(readFileSync(join(suite, file))).toString('utf8')).slice(0, 20);
        for (const t of tests) {
            for (const [addr, val] of t.initial.ram) mem[addr] = val;
            for (const r of REGS) cpu[r] = t.initial.regs[r];
            cpu.flags = t.initial.regs.flags;
            cpu.step();
            const want = { ...t.initial.regs, ...t.final.regs };
            for (const r of REGS) assert.equal(cpu[r], want[r], `${base} #${t.test_num} ${t.name}: ${r}`);
            assert.equal(cpu.flags & mask, want.flags & mask, `${base} #${t.test_num} ${t.name}: flags`);
            for (const [addr] of t.initial.ram) mem[addr] = 0;
            for (const [addr] of t.final.ram) mem[addr] = 0;
            checked++;
        }
    }
    assert.ok(checked > 200, `sampled ${checked} vectors`);
});
