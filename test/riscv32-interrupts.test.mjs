// M-mode interrupts + CSRs: a hand-encoded program installs a trap handler,
// enables machine timer interrupts, and — with the timer line raised — is
// interrupted, runs its handler, and MRETs back. This is the machinery a
// preemptive RTOS scheduler rides (timer tick -> context switch). No CLINT
// device here: the test raises mip.MTIP directly via setInterruptPending, the
// way a CLINT would.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RiscV32} from '../src/riscv32.js';

const I = (op, f3, rd, rs1, imm) =>
    ((imm & 0xfff) << 20 | (rs1 & 0x1f) << 15 | (f3 & 7) << 12 | (rd & 0x1f) << 7 | op) >>> 0;
const B = (op, f3, rs1, rs2, imm) =>
    (((imm >> 12) & 1) << 31 | ((imm >> 5) & 0x3f) << 25 | (rs2 & 0x1f) << 20 | (rs1 & 0x1f) << 15 |
     (f3 & 7) << 12 | ((imm >> 1) & 0xf) << 8 | ((imm >> 11) & 1) << 7 | op) >>> 0;
const ADDI = (rd, rs1, imm) => I(0x13, 0, rd, rs1, imm);
const CSRRW = (rd, rs1, csr) => I(0x73, 1, rd, rs1, csr);
const CSRRS = (rd, rs1, csr) => I(0x73, 2, rd, rs1, csr);
const BEQ = (rs1, rs2, imm) => B(0x63, 0, rs1, rs2, imm);
const EBREAK = () => 0x00100073;
const MRET = () => 0x30200073;

const MTVEC = 0x305, MIE = 0x304, MSTATUS = 0x300;
const IRQ_MTI = 1 << 7;               // mip/mie machine-timer bit
const HANDLER = 0x40;                 // byte address of the handler (word 16)

function machineOf(words) {
    const mem = new Uint8Array(0x10000);
    words.forEach((w, i) => { const a = i * 4; mem[a] = w; mem[a + 1] = w >>> 8; mem[a + 2] = w >>> 16; mem[a + 3] = w >>> 24; });
    return new RiscV32(mem);
}

test('a machine timer interrupt is taken, handled, and returned from (MRET)', () => {
    const prog = [];
    // word 0..5: install handler, enable MTIE, set mstatus.MIE
    prog[0] = ADDI(5, 0, HANDLER);        // x5 = 0x40
    prog[1] = CSRRW(0, 5, MTVEC);         // mtvec = x5
    prog[2] = ADDI(6, 0, IRQ_MTI);        // x6 = 0x80 (MTIE)
    prog[3] = CSRRW(0, 6, MIE);           // mie = x6
    prog[4] = ADDI(7, 0, 0x08);           // x7 = MSTATUS.MIE
    prog[5] = CSRRS(0, 7, MSTATUS);       // mstatus |= MIE   (interrupt now unmasked)
    // word 6..8: the "application" — count in x10 until the handler sets x11
    prog[6] = ADDI(10, 10, 1);            // (loop) x10++
    prog[7] = BEQ(11, 0, -4);             // while x11 == 0 -> word 6
    prog[8] = EBREAK();
    // handler at word 16 (0x40)
    for (let i = 9; i < 16; i++) prog[i] = 0x00000013;   // NOP padding (addi x0,x0,0)
    prog[16] = ADDI(11, 11, 1);           // x11++  (mark handled)
    prog[17] = CSRRW(0, 0, MIE);          // mie = 0  (stop the timer re-firing)
    prog[18] = MRET();

    const cpu = machineOf(prog);
    cpu.setInterruptPending(IRQ_MTI, true);   // the CLINT would do this when mtime >= mtimecmp
    let n = 0; while (!cpu.halted && n++ < 100000) cpu.step();

    assert.ok(cpu.halted, 'the program reached EBREAK');
    assert.equal(cpu.x[11], 1, 'the trap handler ran exactly once');
    assert.ok(cpu.x[10] >= 1, 'the application made progress before and/or after the trap');
    assert.equal(cpu.csr[0x341] % 4 === 0, true, 'mepc holds the interrupted pc (word-aligned)');
});

test('CSR read/modify/write: CSRRS sets bits and returns the old value; RS x0 does not write', () => {
    // csrrs x1, x2, mscratch (set); then csrrs x3, x0, mscratch (read-only, x0 src)
    const MSCRATCH = 0x340;
    const prog = [
        ADDI(2, 0, 0x55),                 // x2 = 0x55
        CSRRS(1, 2, MSCRATCH),            // x1 = old(0); mscratch |= 0x55
        CSRRS(3, 0, MSCRATCH),            // x3 = mscratch (0x55); x0 src -> no write
        EBREAK()
    ];
    const cpu = machineOf(prog);
    let n = 0; while (!cpu.halted && n++ < 1000) cpu.step();
    assert.equal(cpu.x[1], 0, 'CSRRS returned the old (zero) value');
    assert.equal(cpu.x[3], 0x55, 'the set bits are visible on read-back');
    assert.equal(cpu.csr[MSCRATCH], 0x55);
});

test('an interrupt masked by mstatus.MIE=0 is NOT taken', () => {
    // Same as above but never set mstatus.MIE — the handler must not run.
    const prog = [
        ADDI(5, 0, HANDLER), CSRRW(0, 5, MTVEC),
        ADDI(6, 0, IRQ_MTI), CSRRW(0, 6, MIE),
        ADDI(10, 10, 1), EBREAK()
    ];
    for (let i = 6; i < 16; i++) prog[i] = 0x00000013;
    prog[16] = ADDI(11, 11, 1); prog[17] = MRET();
    const cpu = machineOf(prog);
    cpu.setInterruptPending(IRQ_MTI, true);
    let n = 0; while (!cpu.halted && n++ < 1000) cpu.step();
    assert.equal(cpu.x[11], 0, 'with MIE clear, the timer interrupt stayed masked');
});
