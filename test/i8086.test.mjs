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
    cpu.flags |= 0x0200;                                     // IF only
    run(cpu, 1);
    assert.equal(cpu.cs, 0x9000);
    assert.equal(cpu.ip, 0x1234);
    assert.equal(cpu.flags & 0x0300, 0);
    assert.equal(cpu.sp, 0x00fa, 'FLAGS, CS and IP went on the stack');
});

// ---- the trap flag ------------------------------------------------------
// The suite cannot reach any of this: its README says the interrupt and trap
// flags are not exercised. So these are behavioural, and each one pins a
// decision that i8086.js records at the sampling site rather than a fact the
// vectors handed over.

test('TF raises INT 1 after the instruction, and the handler does not step itself', () => {
    const { cpu, mem } = machine([0x40, 0x40]);       // INC AX; INC AX
    mem[1 * 4] = 0x00; mem[1 * 4 + 1] = 0x70;         // vector 1 -> 0000:7000
    cpu.flags |= 0x0100;                              // TF
    cpu.step();

    assert.equal(cpu.ax, 1, 'the instruction completed BEFORE the trap');
    assert.equal(cpu.cs, 0, 'and the trap took vector 1');
    assert.equal(cpu.ip, 0x7000);
    assert.equal(cpu.flags & 0x0100, 0, 'TF is clear inside the handler');

    // The pushed flags word still has TF set, which is the whole reason an
    // IRET out of a tracer resumes tracing instead of stopping.
    const pushedFlags = mem[((cpu.ss << 4) + cpu.sp + 4) & 0xfffff]
        | (mem[((cpu.ss << 4) + cpu.sp + 5) & 0xfffff] << 8);
    assert.equal(pushedFlags & 0x0100, 0x0100, 'TF was pushed SET');

    // The handler's own first instruction must not trap again.
    const sp = cpu.sp;
    cpu.step();
    assert.equal(cpu.sp, sp, 'nothing further was pushed');
});

test('a segment-register load inhibits the trap for one instruction', () => {
    // MOV SS, AX then MOV SP, imm -- the pair the shadow exists to protect. A
    // trap taken between them would push three words through a half-built
    // stack, which is the same hazard as an IRQ there, so the same shadow
    // covers it. DECIDED, not measured: see the sampling site in i8086.js.
    const { cpu, mem } = machine([0x8e, 0xd0, 0xbc, 0x00, 0x20]);
    mem[1 * 4] = 0x00; mem[1 * 4 + 1] = 0x70;
    cpu.ax = 0x3000;
    cpu.flags |= 0x0100;

    cpu.step();                                   // MOV SS, AX
    assert.equal(cpu.ss, 0x3000);
    assert.equal(cpu.ip, 2, 'no trap: the shadow is up');

    cpu.step();                                   // MOV SP, 2000h
    assert.equal(cpu.ip, 0x7000, 'and now the trap lands, one instruction late');
    // SP was loaded with 2000h and the deferred trap then pushed its three
    // words onto the stack the pair had just finished building — which is
    // the point of deferring it, and is visible here as the six bytes.
    assert.equal(cpu.sp, 0x2000 - 6, 'onto the NEW stack, not the half-built one');
});

test('an INT executed with TF set traces INTO the handler', () => {
    // This is the ordering DEBUG.COM's `t` is built on, and the reason `p`
    // exists beside it: tracing an INT 21h steps into DOS rather than over
    // it. The alternative reading -- require TF to SURVIVE the instruction --
    // would leave a tracer with no trap at all after an INT, and it would
    // lose control of the program entirely at the first DOS call.
    const { cpu, mem } = machine([0xcd, 0x21]);
    mem[0x21 * 4] = 0x34; mem[0x21 * 4 + 1] = 0x12;
    mem[0x21 * 4 + 2] = 0x00; mem[0x21 * 4 + 3] = 0x90;   // 21h -> 9000:1234
    mem[1 * 4] = 0x00; mem[1 * 4 + 1] = 0x70;             //  1h -> 0000:7000
    cpu.flags |= 0x0100;
    cpu.step();

    assert.equal(cpu.cs, 0, 'the trace trap won, and it fired after the INT');
    assert.equal(cpu.ip, 0x7000);
    assert.equal(cpu.sp, 0x00f4, 'two frames on the stack: the INT 21h, then the trap');

    // The trap's own frame must name where the INT went, so a debugger
    // reports the handler's entry point rather than the INT instruction.
    const at = (o) => mem[((cpu.ss << 4) + cpu.sp + o) & 0xfffff]
        | (mem[((cpu.ss << 4) + cpu.sp + o + 1) & 0xfffff] << 8);
    assert.equal(at(0), 0x1234, 'the trapped IP is the handler entry');
    assert.equal(at(2), 0x9000, 'the trapped CS likewise');
});

test('TF clear costs nothing, and clearing it mid-run stops the tracing', () => {
    const { cpu, mem } = machine([0x40, 0x9d, 0x40]);  // INC AX; POPF; INC AX
    mem[1 * 4] = 0x00; mem[1 * 4 + 1] = 0x70;
    // A flags word with TF clear, ready for POPF to load.
    cpu.sp = 0x00fe;
    mem[((cpu.ss << 4) + 0xfe) & 0xfffff] = 0x02;
    mem[((cpu.ss << 4) + 0xff) & 0xfffff] = 0xf0;

    cpu.step();                                   // INC AX, TF clear
    assert.equal(cpu.ip, 1, 'no trap when TF is clear');

    cpu.flags |= 0x0100;
    cpu.step();                                   // POPF loads TF=0
    // Sampled BEFORE, so this one still traps: a POPF that clears TF is the
    // last traced instruction, not the first untraced one.
    assert.equal(cpu.ip, 0x7000, 'the trap uses the flag as it was on entry');
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

test('WAIT (9B) with no coprocessor is a transparent 4-cycle NOP, not a halt', () => {
    // WAIT samples the 8087's TEST# pin; with no coprocessor there is nothing to
    // wait for, so it must fall straight through — advance IP past its one byte,
    // touch no register or flag, not halt (it is not HLT), and leave execution
    // to flow into the next instruction.
    //
    // EVIDENCE TIER 2c/3, NOT 1 (VERIFICATION.md). No oracle covers 0x9b — the
    // SingleStepTests 8086 suite excludes WAIT ("The WAIT instruction is not
    // included"), and no hand-assembled program above reaches it. Every other
    // assertion in this file that names an opcode ultimately rests on the 646k
    // grind; this one does not. It asserts the datasheet contract and our
    // implementation of it, and would NOT catch a shared misreading of either.
    // It is the reason WAIT was the one opcode the core executed that nothing
    // exercised; it does not make WAIT better-verified than the 45 the grind
    // checks, only no longer unexercised.
    const { cpu } = machine([
        0x9b,                   // WAIT
        0xb8, 0x34, 0x12,       // MOV AX, 1234h
    ]);
    cpu.ax = 0xdead;
    cpu.flags |= CF | ZF;       // arbitrary live flags that must survive it
    const flags0 = cpu.flags, ax0 = cpu.ax;

    const cycles = cpu.step();  // WAIT
    assert.equal(cycles, 4, 'WAIT is a 4-cycle instruction');
    assert.equal(cpu.ip, 1, 'WAIT advances IP past its single opcode byte');
    assert.equal(cpu.ax, ax0, 'WAIT changes no register');
    assert.equal(cpu.flags, flags0, 'WAIT changes no flag');
    assert.equal(cpu.halted, false, 'WAIT is not HLT — the CPU keeps running');
    // The interrupt shadow is where a wrongly-"transparent" instruction does
    // the damage IP+1 will not show: a segment-register load raises it to delay
    // interrupts by one instruction (MOV SS,AX -> intShadow 1). WAIT must raise
    // no such shadow — it leaves the pending-interrupt boundary exactly as it
    // found it.
    assert.equal(cpu.intShadow, 0, 'WAIT raises no interrupt shadow');

    cpu.step();                 // MOV AX, 1234h
    assert.equal(cpu.ax, 0x1234, 'execution flows through WAIT into the next instruction');
});
