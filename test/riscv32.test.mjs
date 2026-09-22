// The RV32IM core (src/riscv32.js): one instruction per step(), flat LE memory.
// Programs are hand-encoded from the ISA field layout, so the test validates
// the DECODER against the spec (not against a toolchain that could share a bug).

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RiscV32} from '../src/riscv32.js';

// ── ISA field encoders (RISC-V unprivileged spec, ch. 2) ────────────
const R = (op, f3, f7, rd, rs1, rs2) =>
    ((f7 & 0x7f) << 25 | (rs2 & 0x1f) << 20 | (rs1 & 0x1f) << 15 | (f3 & 7) << 12 | (rd & 0x1f) << 7 | op) >>> 0;
const I = (op, f3, rd, rs1, imm) =>
    ((imm & 0xfff) << 20 | (rs1 & 0x1f) << 15 | (f3 & 7) << 12 | (rd & 0x1f) << 7 | op) >>> 0;
const S = (op, f3, rs1, rs2, imm) =>
    (((imm >> 5) & 0x7f) << 25 | (rs2 & 0x1f) << 20 | (rs1 & 0x1f) << 15 | (f3 & 7) << 12 | (imm & 0x1f) << 7 | op) >>> 0;
const B = (op, f3, rs1, rs2, imm) =>
    (((imm >> 12) & 1) << 31 | ((imm >> 5) & 0x3f) << 25 | (rs2 & 0x1f) << 20 | (rs1 & 0x1f) << 15 |
     (f3 & 7) << 12 | ((imm >> 1) & 0xf) << 8 | ((imm >> 11) & 1) << 7 | op) >>> 0;
const U = (op, rd, imm) => ((imm & 0xfffff000) | (rd & 0x1f) << 7 | op) >>> 0;

// opcodes/funct helpers
const ADDI = (rd, rs1, imm) => I(0x13, 0, rd, rs1, imm);
const ADD  = (rd, rs1, rs2) => R(0x33, 0, 0x00, rd, rs1, rs2);
const SUB  = (rd, rs1, rs2) => R(0x33, 0, 0x20, rd, rs1, rs2);
const MUL  = (rd, rs1, rs2) => R(0x33, 0, 0x01, rd, rs1, rs2);
const DIV  = (rd, rs1, rs2) => R(0x33, 4, 0x01, rd, rs1, rs2);
const SW   = (rs2, rs1, imm) => S(0x23, 2, rs1, rs2, imm);
const LW   = (rd, rs1, imm) => I(0x03, 2, rd, rs1, imm);
const BNE  = (rs1, rs2, imm) => B(0x63, 1, rs1, rs2, imm);
const LUI  = (rd, imm) => U(0x37, rd, imm);
const ECALL = () => 0x00000073;
const EBREAK = () => 0x00100073;

/** Assemble a word array into a fresh machine memory + CPU. */
function machineOf(words, opts = {}) {
    const mem = new Uint8Array(opts.size || 0x10000);
    words.forEach((w, i) => { const a = i * 4; mem[a] = w & 0xff; mem[a + 1] = (w >>> 8) & 0xff; mem[a + 2] = (w >>> 16) & 0xff; mem[a + 3] = (w >>> 24) & 0xff; });
    return new RiscV32(mem, opts.hooks || {});
}
function run(cpu, max = 100000) { let n = 0; while (!cpu.halted && n++ < max) cpu.step(); return n; }

test('rv32i: a loop sums 1..10 = 55, then stores it to memory', () => {
    // x1=sum, x2=i, x3=limit(11). loop at word 3; bne at word 5 -> imm -8.
    const prog = [
        ADDI(1, 0, 0),          // 0: x1 = 0
        ADDI(2, 0, 1),          // 1: x2 = 1
        ADDI(3, 0, 11),         // 2: x3 = 11
        ADD(1, 1, 2),           // 3: (loop) x1 += x2
        ADDI(2, 2, 1),          // 4: x2 += 1
        BNE(2, 3, -8),          // 5: if x2 != 11 -> word 3
        ADDI(5, 0, 0x100),      // 6: x5 = 0x100
        SW(1, 5, 0),            // 7: mem[0x100] = x1
        LW(6, 5, 0),            // 8: x6 = mem[0x100]
        EBREAK()                // 9: halt
    ];
    const cpu = machineOf(prog);
    run(cpu);
    assert.equal(cpu.x[1], 55, 'sum 1..10');
    assert.equal(cpu.ld32(0x100), 55, 'stored to memory');
    assert.equal(cpu.x[6], 55, 'loaded back');
    assert.ok(cpu.halted, 'EBREAK halted');
});

test('M extension: MUL and signed DIV', () => {
    const prog = [
        ADDI(1, 0, 55),
        ADDI(2, 0, 2),
        MUL(3, 1, 2),           // 110
        DIV(4, 1, 2),           // 27 (55/2 truncates toward zero)
        SUB(5, 3, 1),           // 110 - 55 = 55
        EBREAK()
    ];
    const cpu = machineOf(prog);
    run(cpu);
    assert.equal(cpu.x[3], 110);
    assert.equal(cpu.x[4], 27);
    assert.equal(cpu.x[5], 55);
});

test('x0 is hard-wired to zero; DIV by zero returns -1 (spec)', () => {
    const prog = [
        ADDI(0, 0, 42),         // writing x0 is discarded
        ADDI(1, 0, 10),
        ADDI(2, 0, 0),
        DIV(3, 1, 2),           // 10 / 0 -> -1 per the RISC-V spec
        EBREAK()
    ];
    const cpu = machineOf(prog);
    run(cpu);
    assert.equal(cpu.x[0], 0, 'x0 stays zero');
    assert.equal(cpu.x[3], -1, 'div-by-zero = -1');
});

test('ECALL calls the injected hook (a syscall boundary); LUI sets the high bits', () => {
    let a7 = null;
    const prog = [
        LUI(5, 0x12345000),     // x5 = 0x12345000
        ADDI(17, 0, 93),        // a7 (x17) = 93 (a "syscall number")
        ECALL(),
        EBREAK()
    ];
    const cpu = machineOf(prog, {hooks: {ecall: c => { a7 = c.x[17]; c.halted = true; }}});
    run(cpu);
    assert.equal(cpu.x[5] >>> 0, 0x12345000, 'LUI');
    assert.equal(a7, 93, 'ECALL saw the syscall number in a7');
    assert.ok(cpu.halted, 'the hook halted the machine');
});

test('an illegal instruction traps and halts, it does not run wild', () => {
    const cpu = machineOf([0xffffffff, ADDI(1, 0, 1)]);
    run(cpu);
    assert.ok(cpu.halted, 'halted on the illegal word');
    assert.equal(cpu.trap.cause, 'illegal-instruction');
    assert.equal(cpu.x[1], 0, 'did not execute past the trap');
});
