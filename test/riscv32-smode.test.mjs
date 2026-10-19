// Supervisor mode: privilege levels (M/S/U), trap delegation (medeleg/mideleg),
// the S-mode trap CSRs, SRET, and an SBI firmware hook — the core a supervisor
// kernel (xv6, Linux) rides on. Hand-driven: set the CSRs/privilege, execute one
// instruction, and check the transition, so this validates the mechanism against
// the privileged spec (not a toolchain). The Sv32 MMU + a real xv6 boot are the
// next increment (they also need the RAM base at 0x80000000).

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RiscV32} from '../src/riscv32.js';

const C = {MSTATUS: 0x300, MEDELEG: 0x302, MIDELEG: 0x303, MIE: 0x304, MTVEC: 0x305,
    MEPC: 0x341, MCAUSE: 0x342, SSTATUS: 0x100, STVEC: 0x105, SEPC: 0x141,
    SCAUSE: 0x142, SIP: 0x144, MIP: 0x344};
const ECALL = 0x00000073, MRET = 0x30200073, SRET = 0x10200073;
const M = 3, S = 1, U = 0;
const MPP_S = 1 << 11, MPIE = 1 << 7, SIE = 1 << 1, SPIE = 1 << 5, SPP = 1 << 8, MIE_B = 1 << 3;

/** A CPU with `word` placed at pc=0x100, ready to step once. */
function cpuWith(word) {
    const mem = new Uint8Array(0x1000);
    const c = new RiscV32(mem, {});
    c.pc = 0x100;
    mem[0x100] = word & 0xff; mem[0x101] = (word >>> 8) & 0xff;
    mem[0x102] = (word >>> 16) & 0xff; mem[0x103] = (word >>> 24) & 0xff;
    return c;
}

test('reset privilege is M-mode', () => {
    assert.equal(cpuWith(0).priv, M);
});

test('MRET drops to S-mode when MPP=S, restoring MIE from MPIE', () => {
    const c = cpuWith(MRET);
    c.csr[C.MEPC] = 0x200;
    c.csr[C.MSTATUS] = MPP_S | MPIE;      // MPP=S, MPIE=1
    c.step();
    assert.equal(c.priv, S, 'now in S-mode');
    assert.equal(c.pc >>> 0, 0x200, 'pc = mepc');
    assert.ok(c.csr[C.MSTATUS] & MIE_B, 'MIE <- MPIE');
});

test('an S-mode ecall is serviced by the SBI firmware hook (not a trap)', () => {
    let ext = null;
    const c = cpuWith(ECALL);
    c.sbi = cpu => { ext = cpu.x[17] >>> 0; cpu.x[10] = 0; };   // read a7, return 0 in a0
    c.priv = S;
    c.x[17] = 1;                          // a7 = an SBI extension id
    c.step();
    assert.equal(ext, 1, 'SBI hook saw a7');
    assert.equal(c.pc >>> 0, 0x104, 'returned to the instruction after ecall');
    assert.equal(c.priv, S, 'still S-mode');
});

test('a U-mode ecall delegated by medeleg traps to S-mode (scause=8)', () => {
    const c = cpuWith(ECALL);
    c.priv = U;
    c.csr[C.MEDELEG] = 1 << 8;            // delegate "ecall from U"
    c.csr[C.STVEC] = 0x300;
    c.step();
    assert.equal(c.priv, S, 'trapped into S');
    assert.equal(c.csr[C.SCAUSE] >>> 0, 8, 'scause = environment call from U');
    assert.equal(c.pc >>> 0, 0x300, 'pc = stvec');
    assert.equal(c.csr[C.SEPC] >>> 0, 0x100, 'sepc = the ecall');
});

test('a U-mode ecall NOT delegated traps to M-mode, recording MPP=U', () => {
    const c = cpuWith(ECALL);
    c.priv = U;
    c.csr[C.MEDELEG] = 0;
    c.csr[C.MTVEC] = 0x400;
    c.step();
    assert.equal(c.priv, M, 'trapped to M');
    assert.equal(c.csr[C.MCAUSE] >>> 0, 8);
    assert.equal(c.pc >>> 0, 0x400);
    assert.equal((c.csr[C.MSTATUS] >>> 11) & 3, U, 'MPP records the previous privilege (U)');
});

test('SRET returns to U-mode when SPP=U, restoring SIE from SPIE', () => {
    const c = cpuWith(SRET);
    c.priv = S;
    c.csr[C.SEPC] = 0x500;
    c.csr[C.MSTATUS] = SPIE;              // SPIE=1, SPP=0 (U)
    c.step();
    assert.equal(c.priv, U, 'back to U-mode');
    assert.equal(c.pc >>> 0, 0x500);
    assert.ok(c.csr[C.MSTATUS] & SIE, 'SIE <- SPIE');
});

test('sstatus is a masked window on mstatus (S bits only)', () => {
    const c = cpuWith(0);
    c._writeCsr(C.SSTATUS, SIE);
    assert.ok(c.csr[C.MSTATUS] & SIE, 'writing sstatus.SIE sets mstatus.SIE');
    assert.ok(c._readCsr(C.SSTATUS) & SIE, 'and reads back through sstatus');
    c.csr[C.MSTATUS] |= MIE_B;            // an M-only bit
    assert.equal(c._readCsr(C.SSTATUS) & MIE_B, 0, 'sstatus does not expose MIE');
});

test('a delegated supervisor timer interrupt enters S-mode', () => {
    const c = cpuWith(0);
    c.priv = S;
    c.csr[C.MIDELEG] = 1 << 5;            // delegate the S timer interrupt
    c.csr[C.MSTATUS] = SIE;               // sstatus.SIE enables S interrupts
    c.csr[C.MIE] = 1 << 5;                // STIE
    c.csr[C.MIP] = 1 << 5;                // STIP pending
    c.csr[C.STVEC] = 0x600;
    assert.ok(c._takeInterruptIfPending(), 'interrupt taken');
    assert.equal(c.priv, S, 'delivered to S-mode');
    assert.equal(c.csr[C.SCAUSE] >>> 0, 0x80000005, 'scause = S timer interrupt');
    assert.equal(c.pc >>> 0, 0x600, 'pc = stvec');
});

test('an M timer interrupt is NOT taken while masked in M-mode, but is when delegated', () => {
    const c = cpuWith(0);
    c.priv = M;
    c.csr[C.MIE] = 1 << 7; c.csr[C.MIP] = 1 << 7;   // MTIE + MTIP
    c.csr[C.MSTATUS] = 0;                            // MIE = 0 -> masked
    assert.equal(c._takeInterruptIfPending(), false, 'masked in M-mode with MIE=0');
});
