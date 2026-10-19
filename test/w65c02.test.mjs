// The W65C02 core. The real verification is scripts/grind-w65c02.mjs against
// the SingleStepTests WDC suite — 2,540,000/2,540,000 on 2026-08-13. These
// tests are the always-on subset: hand-assembled programs plus a sampled
// grind when the (out-of-repo, 1.1 GB) vector suite is present locally.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { W65C02 } from '../src/w65c02.js';

function machine(bytes, org = 0x0200) {
    const mem = new Uint8Array(65536);
    mem.set(bytes, org);
    mem[0xfffc] = org & 0xff; mem[0xfffd] = org >> 8;
    const cpu = new W65C02({ read: (a) => mem[a], write: (a, v) => { mem[a] = v; } });
    cpu.reset();
    return { cpu, mem };
}

test('counted loop: INX/CPX/BNE lands the right value with the right cycles', () => {
    const { cpu, mem } = machine([
        0xa2, 0x00,       // LDX #0
        0xe8,             // loop: INX
        0xe0, 0x05,       // CPX #5
        0xd0, 0xfb,       // BNE loop (-5)
        0x86, 0x42,       // STX $42
        0xdb,             // STP
    ]);
    let guard = 100;
    while (!cpu.stopped && guard--) cpu.step();
    assert.equal(mem[0x42], 5);
    assert.equal(cpu.x, 5);
    // reset 7 + LDX 2 + 5*(INX 2 + CPX 2) + 4*(BNE taken 3) + BNE not 2
    // + STX 3 + STP 3 = 49
    assert.equal(cpu.cycles, 49);
});

test('decimal ADC: 0x19 + 0x28 = 0x47 BCD, one extra cycle', () => {
    const { cpu } = machine([
        0xf8,             // SED
        0x18,             // CLC
        0xa9, 0x19,       // LDA #$19
        0x69, 0x28,       // ADC #$28
    ]);
    for (let i = 0; i < 4; i++) cpu.step();
    assert.equal(cpu.a, 0x47);
    assert.equal(cpu.p & 0x01, 0); // no carry
    assert.equal(cpu.cycles, 7 + 2 + 2 + 2 + 3); // ADC imm is 3 in decimal
});

test('BRK/RTI round-trip: D cleared inside handler, P restored after', () => {
    const { cpu, mem } = machine([
        0xf8,             // SED
        0x00, 0x00,       // BRK (+padding)
        0xea,             // resume: NOP
    ]);
    mem[0xfffe] = 0x00; mem[0xffff] = 0x03; // handler at $0300
    mem[0x0300] = 0x40;                     // RTI
    cpu.step();                             // SED
    cpu.step();                             // BRK -> handler
    assert.equal(cpu.pc, 0x0300);
    assert.equal(cpu.p & 0x08, 0, 'D cleared by BRK on the 65C02');
    assert.equal(cpu.p & 0x04, 0x04, 'I set');
    cpu.step();                             // RTI
    assert.equal(cpu.pc, 0x0203, 'returns past the padding byte');
    assert.equal(cpu.p & 0x08, 0x08, 'D restored by RTI');
});

test('WAI parks the CPU until irq(); I-flag decides vectoring', () => {
    const { cpu, mem } = machine([
        0x58,             // CLI
        0xcb,             // WAI
        0xa9, 0x77,       // LDA #$77 (after interrupt returns)
    ]);
    mem[0xfffe] = 0x00; mem[0xffff] = 0x03;
    mem[0x0300] = 0x40; // RTI
    cpu.step(); cpu.step();
    assert.equal(cpu.waiting, true);
    assert.equal(cpu.step(), 0, 'no progress while waiting');
    assert.equal(cpu.irq(), true);
    assert.equal(cpu.pc, 0x0300);
    cpu.step();         // RTI
    cpu.step();         // LDA
    assert.equal(cpu.a, 0x77);
});

test('STP (DB) stops the CPU dead until reset — the opcode the WDC suite cannot vector', () => {
    // EVIDENCE TIER 2c, NOT 1. STP and WAI are the TWO opcodes whose files in
    // the WDC 65C02 vector suite are EMPTY (cb.json, db.json — 0 bytes): a
    // single-step oracle cannot capture an instruction whose whole effect is to
    // stop stepping. So 254 of 256 opcodes here are ground against silicon and
    // these two are not — they rest on the datasheet plus our reading, and would
    // not catch a shared misreading of either. WAI has its test above; this is
    // STP's, so both untestable-by-grind opcodes now say so in the file rather
    // than only one. (A coverage sweep sees DB "fire" when a NOP-slide reaches
    // it, but firing is not asserting and corpus-execution is not an oracle.)
    const { cpu } = machine([
        0xdb,             // STP
        0xa9, 0x42,       // LDA #$42  — must NEVER execute; the CPU is stopped
    ]);
    const cyc = cpu.step();             // STP
    assert.equal(cyc, 3, 'STP is a 3-cycle instruction');
    assert.equal(cpu.stopped, true, 'STP stops the CPU');
    assert.equal(cpu.step(), 0, 'a stopped CPU makes no progress — step() is a no-op');
    assert.equal(cpu.a, 0x00, 'the instruction after STP never runs');
    // What distinguishes STP from WAI: WAI wakes on IRQ/NMI (asserted above),
    // STP does not — only the RES pin revives a stopped 65C02. So an interrupt
    // must leave it stopped, and reset must clear it.
    assert.equal(cpu.irq(), false, 'STP ignores IRQ — no interrupt is taken');
    assert.equal(cpu.stopped, true, 'and the CPU stays stopped through the IRQ');
    cpu.reset();
    assert.equal(cpu.stopped, false, 'reset is the only thing that clears STP');
});

test('sampled vector grind when the suite is present locally', (t) => {
    const dir = process.env.VECTORS_DIR
        || join(homedir(), 'code', '65x02-vectors', 'wdc65c02', 'v1');
    if (!existsSync(dir)) { t.skip('vector suite not cloned'); return; }
    const mem = new Uint8Array(65536);
    const cpu = new W65C02({ read: (a) => mem[a], write: (a, v) => { mem[a] = v; } });
    // A spread across the traps: decimal ALU, page-cross, WDC bit ops, BRK.
    for (const op of ['00', '69', 'f1', '7d', '7f', 'd7', '6c']) {
        const tests = JSON.parse(readFileSync(join(dir, `${op}.json`), 'utf8')).slice(0, 500);
        for (const v of tests) {
            for (const [addr, val] of v.initial.ram) mem[addr] = val;
            Object.assign(cpu, { pc: v.initial.pc, s: v.initial.s, a: v.initial.a,
                x: v.initial.x, y: v.initial.y, p: v.initial.p });
            const n = cpu.step();
            for (const r of ['pc', 's', 'a', 'x', 'y', 'p']) {
                assert.equal(cpu[r], v.final[r], `${op} "${v.name}" reg ${r}`);
            }
            for (const [addr, val] of v.final.ram) {
                assert.equal(mem[addr], val, `${op} "${v.name}" ram[${addr}]`);
            }
            assert.equal(n, v.cycles.length, `${op} "${v.name}" cycles`);
            for (const [addr] of v.initial.ram) mem[addr] = 0;
            for (const [addr] of v.final.ram) mem[addr] = 0;
        }
    }
});
