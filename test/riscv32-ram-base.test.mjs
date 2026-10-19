// A configurable RAM base lets images linked at the standard riscv `virt` base
// (0x80000000) run — the enabler for Zephyr's qemu_riscv32, xv6 and Linux, which
// all link there rather than at 0x0. The machine translates addresses to its
// flat 0-based `mem` by subtracting `ramBase`; the MMIO devices (CLINT/PLIC/UART)
// sit below RAM and are still routed by absolute address.
//
// The test runs a hand-encoded program placed at 0x80000000: it computes the
// UART address (0x10000000, BELOW the RAM base) and stores 'A' there, then loops.
// That exercises everything the base touches at once: instruction fetch from
// high RAM, a store whose target is an MMIO device below RAM, and the ramBase
// translation — with a default-0 control proving the old behaviour is unchanged.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RiscV32Machine} from '../src/riscv32-machine.js';

// minimal encoders (RISC-V field layout)
const U = (op, rd, imm) => ((imm & 0xfffff000) | (rd & 0x1f) << 7 | op) >>> 0;
const I = (op, f3, rd, rs1, imm) => ((imm & 0xfff) << 20 | (rs1 & 0x1f) << 15 | (f3 & 7) << 12 | (rd & 0x1f) << 7 | op) >>> 0;
const S = (op, f3, rs1, rs2, imm) => (((imm >> 5) & 0x7f) << 25 | (rs2 & 0x1f) << 20 | (rs1 & 0x1f) << 15 | (f3 & 7) << 12 | (imm & 0x1f) << 7 | op) >>> 0;
const LUI = (rd, imm) => U(0x37, rd, imm);
const ADDI = (rd, rs1, imm) => I(0x13, 0, rd, rs1, imm);
const SB = (rs2, rs1, imm) => S(0x23, 0, rs1, rs2, imm);
const EBREAK = () => 0x00100073;

function bytesOf(words) {
    const b = new Uint8Array(words.length * 4);
    words.forEach((w, i) => { b[i*4] = w & 0xff; b[i*4+1] = (w>>>8)&0xff; b[i*4+2] = (w>>>16)&0xff; b[i*4+3] = (w>>>24)&0xff; });
    return b;
}

// x10 = 0x10000000 (UART), x11 = 'A', store byte, halt.
const PROG = [ LUI(10, 0x10000000), ADDI(11, 0, 65), SB(11, 10, 0), EBREAK() ];

function runAt(ramBase) {
    let out = '';
    const m = new RiscV32Machine({ramBase, memSize: 1 << 20}, {onSerial: b => out += String.fromCharCode(b)});
    m.load(bytesOf(PROG), ramBase);        // program at the RAM base
    m.cpu.pc = ramBase >>> 0;
    m.run(100);
    return out;
}

test('a program linked at 0x80000000 runs and reaches the UART below RAM', () => {
    const out = runAt(0x80000000);
    assert.equal(out, 'A', 'fetched + executed from high RAM, and the store reached the UART at 0x10000000');
});

test('ramBase default 0 is unchanged (the same program at 0x0)', () => {
    const out = runAt(0x00000000);
    assert.equal(out, 'A', 'the 0-based path still works');
});

test('load() and the CPU agree on the translation (a store reads back)', () => {
    const m = new RiscV32Machine({ramBase: 0x80000000, memSize: 1 << 20});
    m.load(new Uint8Array([0xde, 0xad, 0xbe, 0xef]), 0x80000100);
    // ld32 at the absolute address returns what load() put there
    assert.equal(m.cpu.ld32(0x80000100) >>> 0, 0xefbeadde, 'absolute load/store round-trips through ramBase');
    // and it landed at flat index 0x100, not 0x80000100 (which would be out of a 1 MiB array)
    assert.equal(m.mem[0x100], 0xde);
});
