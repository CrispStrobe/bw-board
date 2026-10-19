// The CLINT closes the loop: instead of a test poking mip, a program schedules
// a timer tick by writing mtimecmp over MMIO, and the machine's advancing mtime
// raises MTIP on its own — the exact path an RTOS scheduler rides. Proves MMIO
// routing + the timer device + interrupt entry together.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RiscV32Machine} from '../src/riscv32-machine.js';
import {createClint} from '../src/riscv32-clint.js';
import {RiscV32, INTERRUPT} from '../src/riscv32.js';

const U = (op, rd, imm) => ((imm & 0xfffff000) | (rd & 0x1f) << 7 | op) >>> 0;
const I = (op, f3, rd, rs1, imm) => ((imm & 0xfff) << 20 | (rs1 & 0x1f) << 15 | (f3 & 7) << 12 | (rd & 0x1f) << 7 | op) >>> 0;
const S = (op, f3, rs1, rs2, imm) => (((imm >> 5) & 0x7f) << 25 | (rs2 & 0x1f) << 20 | (rs1 & 0x1f) << 15 | (f3 & 7) << 12 | (imm & 0x1f) << 7 | op) >>> 0;
const Bt = (op, f3, rs1, rs2, imm) => (((imm >> 12) & 1) << 31 | ((imm >> 5) & 0x3f) << 25 | (rs2 & 0x1f) << 20 | (rs1 & 0x1f) << 15 | (f3 & 7) << 12 | ((imm >> 1) & 0xf) << 8 | ((imm >> 11) & 1) << 7 | op) >>> 0;
const LUI = (rd, imm) => U(0x37, rd, imm);
const ADDI = (rd, rs1, imm) => I(0x13, 0, rd, rs1, imm);
const SW = (rs2, rs1, imm) => S(0x23, 2, rs1, rs2, imm);
const CSRRW = (rd, rs1, csr) => I(0x73, 1, rd, rs1, csr);
const CSRRS = (rd, rs1, csr) => I(0x73, 2, rd, rs1, csr);
const BEQ = (rs1, rs2, imm) => Bt(0x63, 0, rs1, rs2, imm);
const MRET = () => 0x30200073;
const EBREAK = () => 0x00100073;

const MTVEC = 0x305, MIE = 0x304, MSTATUS = 0x300, MTI = 1 << 7;
const CLINT = 0x02000000, MTIMECMP = CLINT + 0x4000, HANDLER = 0x80;   // handler at word 32

test('a program schedules a CLINT timer tick and is interrupted by mtime', () => {
    const prog = [];
    prog[0]  = LUI(5, MTIMECMP);          // x5 = &mtimecmp (0x02004000)
    prog[1]  = ADDI(6, 0, 200);           // fire after ~200 ticks
    prog[2]  = SW(6, 5, 0);               // mtimecmp_lo = 200
    prog[3]  = SW(0, 5, 4);               // mtimecmp_hi = 0  (default is ~all-ones)
    prog[4]  = ADDI(7, 0, HANDLER);       // x7 = handler
    prog[5]  = CSRRW(0, 7, MTVEC);        // mtvec = handler
    prog[6]  = ADDI(8, 0, MTI);           // MTIE
    prog[7]  = CSRRW(0, 8, MIE);          // mie = MTIE
    prog[8]  = ADDI(9, 0, 0x08);          // mstatus.MIE
    prog[9]  = CSRRS(0, 9, MSTATUS);      // enable interrupts
    prog[10] = ADDI(10, 10, 1);           // (loop) x10++
    prog[11] = BEQ(11, 0, -4);            // while x11 == 0 -> word 10
    prog[12] = EBREAK();
    for (let i = 13; i < 32; i++) prog[i] = 0x00000013;   // NOP pad
    prog[32] = ADDI(11, 11, 1);           // handler: mark handled
    prog[33] = ADDI(6, 0, -1);            // 0xffffffff
    prog[34] = SW(6, 5, 4);               // mtimecmp_hi = ~0 -> never re-fire (x5 preserved)
    prog[35] = MRET();

    const m = new RiscV32Machine();       // CLINT is wired by default
    const bytes = new Uint8Array(prog.length * 4);
    prog.forEach((w, i) => { bytes[i * 4] = w; bytes[i * 4 + 1] = w >>> 8; bytes[i * 4 + 2] = w >>> 16; bytes[i * 4 + 3] = w >>> 24; });
    m.load(bytes, 0);
    m.run(1_000_000);

    assert.ok(m.halted, 'the program reached EBREAK');
    assert.equal(m.cpu.x[11], 1, 'the timer handler ran exactly once');
    assert.ok(m.cpu.x[10] >= 1, 'the loop ran (before the tick) then fell through (after)');
    assert.ok(m.clint.mtime >= 200, 'mtime advanced past the compare');
});

test('the CLINT raises MSIP on a software-interrupt write', () => {
    const cpu = new RiscV32(new Uint8Array(0x1000));
    const clint = createClint(cpu, {});
    clint.store32(0x0000, 1);             // msip = 1
    assert.ok(cpu.csr[0x344] & INTERRUPT.MSI, 'MSIP is pending in mip');
    clint.store32(0x0000, 0);
    assert.ok(!(cpu.csr[0x344] & INTERRUPT.MSI), 'clearing msip lowers MSIP');
});
