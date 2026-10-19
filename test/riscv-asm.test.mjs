// The local RV32IM assembler (src/riscv-asm.js): the in-browser route that makes
// the riscv32 console programmable from assembly. Two kinds of check:
//   1. ENCODING — assemble one instruction and compare the 32-bit word against
//      the value hand-derived from the ISA field layout (the encoder is verified
//      against the spec, not against itself).
//   2. END TO END — assemble a whole program and RUN it on RiscV32Machine, the
//      same core the shipped clang fixtures boot on, asserting its ECALL output.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assembleRiscv, RiscvAsmError} from '../src/riscv-asm.js';
import {RiscV32Machine} from '../src/riscv32-machine.js';

/** Assemble one instruction at address 0 and return its first 32-bit word. */
function word(src) {
    const r = assembleRiscv(src, {textBase: 0, dataBase: 0x8000});
    const s = r.image.segments.find(s => s.addr === 0);
    return (s.bytes[0] | (s.bytes[1] << 8) | (s.bytes[2] << 16) | (s.bytes[3] << 24)) >>> 0;
}
const hex = n => '0x' + (n >>> 0).toString(16).padStart(8, '0');

test('R-type / I-type / load / store / branch / M encodings match the ISA layout', () => {
    assert.equal(hex(word('addi x1, x2, 5')), hex(0x00510093), 'addi');
    assert.equal(hex(word('add x1, x2, x3')), hex(0x003100b3), 'add');
    assert.equal(hex(word('sub x1, x2, x3')), hex(0x403100b3), 'sub');
    assert.equal(hex(word('lw x5, 8(x6)')), hex(0x00832283), 'lw');
    assert.equal(hex(word('sw x5, 12(x6)')), hex(0x00532623), 'sw');
    assert.equal(hex(word('mul x1, x2, x3')), hex(0x023100b3), 'mul');
    assert.equal(hex(word('divu x1, x2, x3')), hex(0x023150b3), 'divu');
    assert.equal(hex(word('ecall')), hex(0x00000073), 'ecall');
    assert.equal(hex(word('slli x1, x2, 4')), hex(0x00411093), 'slli');
});

test('ABI register names alias the numbered registers', () => {
    // addi a0, sp, 0  == addi x10, x2, 0
    assert.equal(word('addi a0, sp, 0'), word('addi x10, x2, 0'));
    assert.equal(word('mv ra, gp'), word('addi x1, x3, 0'));
});

test('pseudo-instructions expand to the canonical base instructions', () => {
    assert.equal(word('nop'), 0x00000013, 'nop = addi x0,x0,0');
    assert.equal(word('mv x1, x2'), word('addi x1, x2, 0'));
    assert.equal(word('ret'), word('jalr x0, ra, 0'));
    assert.equal(word('not x1, x2'), word('xori x1, x2, -1'));
    // li with a small value is one addi (its reserved second word is a nop)
    const li = assembleRiscv('li a0, 42', {textBase: 0});
    assert.equal(li.image.segments[0].bytes.length, 8, 'li reserves two words');
});

test('a branch/label offset is a real PC-relative encoding', () => {
    // beq x0,x0,label ; label two words ahead → offset +8
    const w = word('beq x0, x0, tgt\n nop\n tgt: nop');
    // B-type: imm=8 → bit layout; funct3=0, op=0x63. Hand value:
    assert.equal(hex(w), hex(0x00000463), 'beq +8');
});

test('out-of-range immediates and misalignments are refused, not truncated', () => {
    assert.throws(() => assembleRiscv('addi x1, x2, 4096'), RiscvAsmError, '12-bit imm overflow');
    assert.throws(() => assembleRiscv('lw x1, 5000(x2)'), RiscvAsmError, '12-bit offset overflow');
    assert.throws(() => assembleRiscv('mv x1'), RiscvAsmError, 'wrong operand count');
    assert.throws(() => assembleRiscv('frobnicate x1, x2'), RiscvAsmError, 'unknown instruction');
});

/** Assemble, load onto the core, run to halt, return the ECALL console output. */
function runImage(src) {
    const r = assembleRiscv(src, {textBase: 0x1000, dataBase: 0x8000});
    let out = '';
    const m = new RiscV32Machine({memSize: 1 << 20, ramBase: 0}, {onSerial: b => { out += String.fromCharCode(b); }});
    for (const s of r.image.segments) m.cpu.mem.set(s.bytes, s.addr);
    m.cpu.pc = r.entry;
    let steps = 0;
    while (!m.cpu.halted && steps < 500000) { m.step(); steps++; }
    return {out, halted: m.cpu.halted, steps};
}

test('a "hello" program assembles and prints over the ECALL console', () => {
    const {out, halted} = runImage(`
        .globl _start
    _start:
        li a7, 64          # SYS_write
        li a0, 1           # stdout
        la a1, msg
        li a2, 15
        ecall
        li a7, 93          # SYS_exit
        li a0, 0
        ecall
        .data
    msg: .string "Hello, RISC-V!\\n"
    `);
    assert.equal(halted, true, 'the program exits via ecall');
    assert.equal(out, 'Hello, RISC-V!\n');
});

test('arithmetic, the M extension, loads/stores and a divide all run correctly', () => {
    // 7 * 6 = 42; print the two decimal digits via divu/remu.
    const {out} = runImage(`
    _start:
        li   t0, 7
        li   t1, 6
        mul  t2, t0, t1        # 42
        li   t3, 10
        divu t4, t2, t3        # 4
        remu t5, t2, t3        # 2
        addi t4, t4, 48        # '4'
        addi t5, t5, 48        # '2'
        la   a1, buf
        sb   t4, 0(a1)
        sb   t5, 1(a1)
        li   a7, 64
        li   a0, 1
        li   a2, 2
        ecall
        li   a7, 93
        li   a0, 0
        ecall
        .data
    buf: .zero 2
    `);
    assert.equal(out, '42', 'the computed product printed as decimal');
});

test('a loop with a backward branch sums 1..5 and prints 15', () => {
    const {out} = runImage(`
    _start:
        li   t0, 0             # sum
        li   t1, 1             # i
        li   t2, 6             # limit
    loop:
        bge  t1, t2, done
        add  t0, t0, t1
        addi t1, t1, 1
        j    loop
    done:                      # sum = 15 → print '1','5'
        li   t3, 10
        divu t4, t0, t3
        remu t5, t0, t3
        addi t4, t4, 48
        addi t5, t5, 48
        la   a1, buf
        sb   t4, 0(a1)
        sb   t5, 1(a1)
        li   a7, 64
        li   a0, 1
        li   a2, 2
        ecall
        li   a7, 93
        li   a0, 0
        ecall
        .data
    buf: .zero 2
    `);
    assert.equal(out, '15');
});
