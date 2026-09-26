// Sv32 paging: the two-level page-table walk a supervisor kernel (xv6, Linux)
// uses for virtual memory. Page tables are built by hand in physical memory and
// the walk is driven directly, so this validates the MMU against the privileged
// spec. Faults are delegated to S-mode (as a kernel sets medeleg), so a fault
// lands in scause/stval/stvec. Bare/M-mode is an identity map (the RTOS path is
// unaffected). Combined with the RAM base (0x80000000) this boots a real kernel.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RiscV32} from '../src/riscv32.js';

const SATP = 0x180, MEDELEG = 0x302, MSTATUS = 0x300, STVEC = 0x105, SCAUSE = 0x142, STVAL = 0x143;
const V = 1, R = 2, W = 4, X = 8, U = 16;
const S = 1, M = 3, Um = 0;
const PROOT = 0x1000, PL0 = 0x2000;     // root and level-0 page tables (physical)

function newCpu() {
    const c = new RiscV32(new Uint8Array(1 << 20), {});
    c.csr[MEDELEG] = 0xffffffff;         // a kernel delegates faults to S-mode
    c.csr[STVEC] = 0x900;
    c.csr[0x31a] = 1 << 29;              // menvcfgh.ADUE: hardware A/D updates (Svadu), as the machine's firmware sets
    return c;
}
const w32 = (c, at, v) => { c.mem[at] = v & 0xff; c.mem[at+1] = (v>>>8)&0xff; c.mem[at+2] = (v>>>16)&0xff; c.mem[at+3] = (v>>>24)&0xff; };
const r32 = (c, at) => (c.mem[at] | c.mem[at+1]<<8 | c.mem[at+2]<<16 | c.mem[at+3]<<24) >>> 0;
const setSatp = c => { c.csr[SATP] = ((1 << 31) | (PROOT >>> 12)) >>> 0; };
function mapPage(c, va, pa, perms) {         // 4 KiB page
    w32(c, PROOT + ((va>>>22)&0x3ff)*4, ((PL0>>>12)<<10) | V);              // L1 pointer
    w32(c, PL0 + ((va>>>12)&0x3ff)*4, ((pa>>>12)<<10) | perms | V);         // L0 leaf
}
function mapSuper(c, va, superPa, perms) {   // 4 MiB superpage (leaf at L1)
    w32(c, PROOT + ((va>>>22)&0x3ff)*4, ((superPa>>>12)<<10) | perms | V);
}

test('a mapped 4 KiB page translates (S-mode), keeping the page offset', () => {
    const c = newCpu(); c.priv = S; setSatp(c);
    mapPage(c, 0x00400000, 0x8000, R|W|X);   // kernel page: S-only (no U)
    assert.equal(c._translate(0x00400abc, 'load') >>> 0, 0x8abc);
});

test('an unmapped VA raises a load page fault to S-mode (scause 13, stval=VA)', () => {
    const c = newCpu(); c.priv = S; setSatp(c);
    assert.equal(c._translate(0x00800000, 'load'), null);
    assert.equal(c.csr[SCAUSE] >>> 0, 13, 'load page fault');
    assert.equal(c.csr[STVAL] >>> 0, 0x00800000, 'stval = faulting VA');
    assert.equal(c.pc >>> 0, 0x900, 'pc = stvec');
    assert.equal(c.priv, S);
});

test('a store to a read-only page faults (scause 15)', () => {
    const c = newCpu(); c.priv = S; setSatp(c);
    mapPage(c, 0x00400000, 0x8000, R|U);         // no W
    assert.equal(c._translate(0x00400000, 'store'), null);
    assert.equal(c.csr[SCAUSE] >>> 0, 15, 'store page fault');
});

test('an instruction fetch needs X (fetch of a non-exec page faults, scause 12)', () => {
    const c = newCpu(); c.priv = S; setSatp(c);
    mapPage(c, 0x00400000, 0x8000, R|W|U);       // no X
    assert.equal(c._translate(0x00400000, 'fetch'), null);
    assert.equal(c.csr[SCAUSE] >>> 0, 12, 'instruction page fault');
});

test('S-mode may not touch a U-page without SUM; SUM lets it', () => {
    let c = newCpu(); c.priv = S; setSatp(c);
    mapPage(c, 0x00400000, 0x8000, R|W|X|U);
    assert.equal(c._translate(0x00400000, 'load'), null, 'no SUM → fault');
    c = newCpu(); c.priv = S; setSatp(c);
    mapPage(c, 0x00400000, 0x8000, R|W|X|U);
    c.csr[MSTATUS] |= (1 << 18);                  // SUM
    assert.equal(c._translate(0x00400000, 'load') >>> 0, 0x8000, 'SUM → ok');
});

test('the A and D bits are set on the leaf PTE on access', () => {
    const c = newCpu(); c.priv = S; setSatp(c);
    mapPage(c, 0x00400000, 0x8000, R|W|X);
    c._translate(0x00400000, 'store');
    const pte = r32(c, PL0 + ((0x00400000>>>12)&0x3ff)*4);
    assert.ok(pte & 0x40, 'A set');
    assert.ok(pte & 0x80, 'D set (store)');
});

test('a 4 MiB superpage translates from a level-1 leaf', () => {
    const c = newCpu(); c.priv = S; setSatp(c);
    mapSuper(c, 0x00400000, 0x00800000, R|W|X);          // VA 4–8M → PA 8–12M (S-only)
    assert.equal(c._translate(0x00400abc, 'load') >>> 0, 0x00800abc);
});

test('M-mode is an identity map even with satp set', () => {
    const c = newCpu(); c.priv = M; setSatp(c);
    assert.equal(c._translate(0x00400000, 'load') >>> 0, 0x00400000);
});

test('a full instruction executes through translation (S-mode fetch + load)', () => {
    // Map a code page and a data page; place `lw x5, 0(x6)` at the code VA and a
    // value at the data VA; run one instruction in S-mode and read it back.
    const c = newCpu(); setSatp(c);
    // code VA 0x400000 -> PA 0x8000 (RX); data VA 0x401000 -> PA 0x9000 (RW)
    mapPage(c, 0x00400000, 0x8000, R|X);     // S-only code
    mapPage(c, 0x00401000, 0x9000, R|W);     // S-only data
    // lw x5, 0(x6): I-type opcode 0x03 f3=2 rd=5 rs1=6 imm=0
    const LW = (0 << 20) | (6 << 15) | (2 << 12) | (5 << 7) | 0x03;
    w32(c, 0x8000, LW >>> 0);
    w32(c, 0x9000, 0xcafef00d);
    c.x[6] = 0x00401000;                                  // data VA in x6
    c.priv = S;
    c.pc = 0x00400000;
    c.step();
    assert.equal(c.x[5] >>> 0, 0xcafef00d, 'loaded through Sv32 from the data page');
    assert.equal(c.pc >>> 0, 0x00400004, 'advanced within the code page');
});

test('with menvcfg.ADUE clear (Svade), a clear A bit is a page fault and the PTE is untouched', () => {
    const c = newCpu();
    c.csr[0x31a] = 0;
    mapPage(c, 0x5000, 0x7000, 0x0f);      // V|R|W|X, A=0 D=0
    setSatp(c);
    c.priv = 1;
    const before = r32(c, PL0 + 5 * 4);
    assert.equal(c._translate(0x5004, 'load'), null, 'load faults instead of setting A');
    assert.equal(c.csr[0x142], 13, 'scause = load page fault');
    assert.equal(r32(c, PL0 + 5 * 4), before, 'PTE unchanged');
});
