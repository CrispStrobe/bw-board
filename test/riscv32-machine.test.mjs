// Increment 2: the A (atomic) extension on the core, and the RiscV32Machine
// wrapper's Linux-style ecall ABI (write + exit). Programs are hand-encoded
// from the ISA field layout so the decoder is checked against the spec.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RiscV32} from '../src/riscv32.js';
import {RiscV32Machine} from '../src/riscv32-machine.js';

const R = (op, f3, f7, rd, rs1, rs2) =>
    ((f7 & 0x7f) << 25 | (rs2 & 0x1f) << 20 | (rs1 & 0x1f) << 15 | (f3 & 7) << 12 | (rd & 0x1f) << 7 | op) >>> 0;
const I = (op, f3, rd, rs1, imm) =>
    ((imm & 0xfff) << 20 | (rs1 & 0x1f) << 15 | (f3 & 7) << 12 | (rd & 0x1f) << 7 | op) >>> 0;
const AMO = (f5, rd, rs1, rs2) =>
    ((f5 & 0x1f) << 27 | (rs2 & 0x1f) << 20 | (rs1 & 0x1f) << 15 | 0x2 << 12 | (rd & 0x1f) << 7 | 0x2f) >>> 0;
const ADDI = (rd, rs1, imm) => I(0x13, 0, rd, rs1, imm);
const SW   = (rs2, rs1, imm) => ((((imm >> 5) & 0x7f) << 25 | (rs2 & 0x1f) << 20 | (rs1 & 0x1f) << 15 | 2 << 12 | (imm & 0x1f) << 7 | 0x23) >>> 0);
const EBREAK = () => 0x00100073;
const ECALL = () => 0x00000073;

function cpuOf(words) {
    const mem = new Uint8Array(0x10000);
    words.forEach((w, i) => { const a = i * 4; mem[a] = w; mem[a + 1] = w >>> 8; mem[a + 2] = w >>> 16; mem[a + 3] = w >>> 24; });
    return new RiscV32(mem);
}
const run = (cpu, max = 100000) => { let n = 0; while (!cpu.halted && n++ < max) cpu.step(); };

test('A extension: AMOADD/AMOSWAP return the old value and write back the new', () => {
    // x4 = 0x200 (address). Seed mem[0x200] = 10 with SW.
    const prog = [
        ADDI(4, 0, 0x200),
        ADDI(5, 0, 10),
        SW(5, 4, 0),            // mem[0x200] = 10
        ADDI(5, 0, 5),
        AMO(0x00, 3, 4, 5),     // AMOADD: x3 = old(10); mem += 5 -> 15
        ADDI(7, 0, 99),
        AMO(0x01, 6, 4, 7),     // AMOSWAP: x6 = old(15); mem = 99
        EBREAK()
    ];
    const cpu = cpuOf(prog);
    run(cpu);
    assert.equal(cpu.x[3], 10, 'AMOADD returned the old value');
    assert.equal(cpu.x[6], 15, 'AMOSWAP returned the post-add value');
    assert.equal(cpu.ld32(0x200), 99, 'memory holds the swapped-in value');
});

test('A extension: LR/SC — a matched pair succeeds, a bare SC fails', () => {
    const prog = [
        ADDI(4, 0, 0x200),
        ADDI(5, 0, 7),
        SW(5, 4, 0),            // mem[0x200] = 7
        AMO(0x02, 8, 4, 0),     // LR.W x8 <- mem (=7), reserve
        ADDI(10, 0, 42),
        AMO(0x03, 9, 4, 10),    // SC.W: reserved -> success (x9=0), mem=42
        ADDI(11, 0, 100),
        AMO(0x03, 12, 4, 11),   // SC.W again, no LR -> fail (x12=1), mem unchanged
        EBREAK()
    ];
    const cpu = cpuOf(prog);
    run(cpu);
    assert.equal(cpu.x[8], 7, 'LR read the memory word');
    assert.equal(cpu.x[9], 0, 'the reserved SC succeeded');
    assert.equal(cpu.ld32(0x200), 42, 'the successful SC wrote back');
    assert.equal(cpu.x[12], 1, 'the unreserved SC failed');
});

test('A extension: AMOMAX is signed, AMOMAXU is unsigned', () => {
    const seed = (val) => [ADDI(4, 0, 0x200), ADDI(5, 0, val & 0xfff), SW(5, 4, 0)];
    // signed: max(-1, 1) = 1 ; unsigned: maxu(0xFFFFFFFF, 1) = 0xFFFFFFFF
    let cpu = cpuOf([...seed(-1), ADDI(6, 0, 1), AMO(0x14, 3, 4, 6), EBREAK()]);
    run(cpu);
    assert.equal(cpu.ld32(0x200) | 0, 1, 'AMOMAX picks the signed-greater 1 over -1');
    cpu = cpuOf([...seed(-1), ADDI(6, 0, 1), AMO(0x1c, 3, 4, 6), EBREAK()]);   // mem = -1 = 0xFFFFFFFF
    run(cpu);
    assert.equal(cpu.ld32(0x200) >>> 0, 0xffffffff, 'AMOMAXU keeps 0xFFFFFFFF over 1');
});

test('RiscV32Machine: a program writes via ecall(64) and exits via ecall(93)', () => {
    let out = '';
    const m = new RiscV32Machine({}, {onSerial: b => { out += String.fromCharCode(b); }});
    // "HI\n" preloaded at 0x400; program writes it to fd 1 then exits 0.
    m.load(new Uint8Array([0x48, 0x49, 0x0a]), 0x400);
    m.load(wordsToBytes([
        ADDI(11, 0, 0x400),     // a1 = buf
        ADDI(12, 0, 3),         // a2 = len
        ADDI(10, 0, 1),         // a0 = fd (stdout)
        ADDI(17, 0, 64),        // a7 = write
        ECALL(),
        ADDI(10, 0, 0),         // a0 = 0
        ADDI(17, 0, 93),        // a7 = exit
        ECALL()
    ]), 0);
    m.run();
    assert.equal(out, 'HI\n', 'the write syscall emitted the buffer');
    assert.equal(m.output, 'HI\n');
    assert.equal(m.exitCode, 0, 'the exit syscall set the code');
    assert.ok(m.halted, 'exit halted the machine');
});

test('RiscV32Machine: an unknown syscall is a no-op, not a crash', () => {
    const m = new RiscV32Machine();
    m.load(wordsToBytes([
        ADDI(17, 0, 214),       // a7 = brk (unimplemented here)
        ECALL(),
        ADDI(17, 0, 93),        // then exit
        ADDI(10, 0, 3),
        ECALL()
    ]), 0);
    assert.doesNotThrow(() => m.run());
    assert.equal(m.exitCode, 3);
});

function wordsToBytes(words) {
    const b = new Uint8Array(words.length * 4);
    words.forEach((w, i) => { b[i * 4] = w; b[i * 4 + 1] = w >>> 8; b[i * 4 + 2] = w >>> 16; b[i * 4 + 3] = w >>> 24; });
    return b;
}
