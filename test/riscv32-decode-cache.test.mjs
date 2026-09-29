// The predecoded-instruction cache (src/riscv32.js _exec): every way an
// instruction's bytes or its translation can change under it, each case built
// so that ONE invalidation is what makes it pass — the store hook, FENCE.I, the
// translation generation (sfence.vma / satp), and the rule that a 32-bit
// instruction crossing a page is never cached. Every case also runs on a core
// with the cache off and must end in the same state (the uncached core is the
// reference; the Spike lockstep gate, test/riscv32-oracle.test.mjs, holds that
// one to Spike, including riscv-tests' fence_i under virtual memory).
//
// Mutations that go red here (measured when this was written): no store
// invalidation on the fast paths reds the two self-modifying cases, none on
// the slow byte path the mirrored-alias case; slot invalidation that ignores a
// 32-bit instruction starting 2 bytes before the store reds the halfword case;
// a FENCE.I that does not flush reds the host-write case; no generation bump
// on a TLB flush reds both same-page remap cases (a satp write that does not
// flush the TLB reds the satp cases); no privilege in the fetch front reds the
// hand-off case; caching a 32-bit instruction that crosses a page reds the
// page-crossing case; load(), the debugger's poke and a state restore that do
// not flush each red the host-write-through-the-machine case.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RiscV32Machine} from '../src/riscv32-machine.js';
import {createRiscV32Adapter} from '../src/riscv32-adapter.js';
import {createRiscV32DebugTarget} from '../src/riscv32-debug.js';
import {saveRiscvSnapshot, restoreRiscvSnapshot} from '../src/riscv32-snapshot.js';

// ── encoders (the ISA field layout) ──
const I = (op, f3, rd, rs1, imm) => ((imm & 0xfff) << 20 | (rs1 & 0x1f) << 15 | (f3 & 7) << 12 | (rd & 0x1f) << 7 | op) >>> 0;
const S = (f3, rs1, rs2, imm) => (((imm >> 5) & 0x7f) << 25 | (rs2 & 0x1f) << 20 | (rs1 & 0x1f) << 15 | (f3 & 7) << 12 | (imm & 0x1f) << 7 | 0x23) >>> 0;
const B = (f3, rs1, rs2, imm) => (((imm >> 12) & 1) << 31 | ((imm >> 5) & 0x3f) << 25 | (rs2 & 0x1f) << 20 | (rs1 & 0x1f) << 15 |
    (f3 & 7) << 12 | ((imm >> 1) & 0xf) << 8 | ((imm >> 11) & 1) << 7 | 0x63) >>> 0;
const J = (rd, imm) => (((imm >> 20) & 1) << 31 | ((imm >> 1) & 0x3ff) << 21 | ((imm >> 11) & 1) << 20 | ((imm >> 12) & 0xff) << 12 |
    (rd & 0x1f) << 7 | 0x6f) >>> 0;
const LUI = (rd, imm20) => ((imm20 << 12) | (rd & 0x1f) << 7 | 0x37) >>> 0;
const ADDI = (rd, rs1, imm) => I(0x13, 0, rd, rs1, imm);
const ADD = (rd, rs1, rs2) => ((rs2 & 0x1f) << 20 | (rs1 & 0x1f) << 15 | (rd & 0x1f) << 7 | 0x33) >>> 0;
const LW = (rd, rs1, imm) => I(0x03, 2, rd, rs1, imm);
const JALR = (rd, rs1, imm) => I(0x67, 0, rd, rs1, imm);
const CSRW = (csr, rs1) => I(0x73, 1, 0, rs1, csr);
const RET = JALR(0, 1, 0), EBREAK = 0x00100073, FENCE_I = 0x0000100f, SFENCE_VMA = 0x12000073, NOP = ADDI(0, 0, 0);
const A0 = 10, RA = 1, T0 = 5, T1 = 6, T2 = 7, S0 = 8, S1 = 9, S2 = 18, T3 = 28;

function place(m, addr, words) {
    words.forEach((w, i) => { const a = addr + 4 * i; for (let k = 0; k < 4; k++) m.mem[a + k] = (w >>> (8 * k)) & 0xff; });
}
const put16 = (m, addr, h) => { m.mem[addr] = h & 0xff; m.mem[addr + 1] = (h >>> 8) & 0xff; };
const put32 = (m, addr, w) => place(m, addr, [w]);
const runToHalt = (m, max = 100_000) => { let n = 0; while (!m.cpu.halted && n++ < max) m.step(); assert.ok(m.cpu.halted, 'program ran to its ebreak'); };
const runUntilPc = (m, pc, max = 100_000) => { let n = 0; while ((m.cpu.pc >>> 0) !== pc && n++ < max) m.step(); assert.equal(m.cpu.pc >>> 0, pc); };
const state = m => ({x: Array.from(m.cpu.x), pc: m.cpu.pc >>> 0, instret: m.cpu.instret});

// Both cores, the same program and host actions; returns [cached, uncached].
function both(build) {
    return [true, false].map(decodeCache => {
        const m = new RiscV32Machine({memSize: 1 << 20});
        m.cpu.decodeCache = decodeCache;
        build(m);
        return m;
    });
}

test('self-modifying code without FENCE.I: a store over a decoded instruction is seen', () => {
    // target: `addi a0, x0, 1; ret`, executed (so decoded), then its first word
    // is overwritten with `addi a0, x0, 2` by a SW on the SAME page and called
    // again — no FENCE.I. The uncached core sees the new word; so must the cache.
    const [c, u] = both(m => {
        place(m, 0x1000, [
            ADDI(S0, 0, 0),
            J(RA, 0x100 - 4),                           // 0x1004: call 0x1100
            ADD(S0, S0, A0),
            LUI(T0, 1), ADDI(T0, T0, 0x100),            // t0 = 0x1100
            LUI(T1, 0x00200), ADDI(T1, T1, 0x513),      // t1 = addi a0, x0, 2
            S(2, T0, T1, 0),                            // sw t1, 0(t0)
            J(RA, 0x1100 - 0x1020),                     // 0x1020: call 0x1100
            ADD(S0, S0, A0),
            EBREAK
        ]);
        place(m, 0x1100, [ADDI(A0, 0, 1), RET]);
        m.cpu.pc = 0x1000;
        runToHalt(m);
    });
    assert.equal(u.cpu.x[S0], 3, 'reference: 1 then 2');
    assert.equal(c.cpu.x[S0], 3, 'the cache dropped the overwritten instruction');
    assert.deepEqual(state(c), state(u));
});

test('self-modifying code: a halfword store into the UPPER half of a 32-bit instruction is seen', () => {
    // `sh` at target+2 rewrites only the immediate of `addi a0, x0, 1` (to 3):
    // the store lands 2 bytes after the start of the instruction it changes.
    const [c, u] = both(m => {
        place(m, 0x1000, [
            J(RA, 0x100),                               // 0x1000: call 0x1100
            ADDI(S1, A0, 0),
            LUI(T0, 1), ADDI(T0, T0, 0x100),
            ADDI(T1, 0, 0x030),                         // upper half of `addi a0, x0, 3`
            S(1, T0, T1, 2),                            // sh t1, 2(t0)
            J(RA, 0x1100 - 0x1018),                     // 0x1018: call 0x1100
            ADDI(S2, A0, 0),
            EBREAK
        ]);
        place(m, 0x1100, [ADDI(A0, 0, 1), RET]);
        m.cpu.pc = 0x1000;
        runToHalt(m);
    });
    assert.deepEqual([u.cpu.x[S1], u.cpu.x[S2]], [1, 3], 'reference');
    assert.deepEqual([c.cpu.x[S1], c.cpu.x[S2]], [1, 3]);
    assert.deepEqual(state(c), state(u));
});

test('self-modifying code through a MIRRORED alias of RAM is seen (the slow store path)', () => {
    // RAM at 0 repeats across the address space (the legacy bare map), so
    // 0x101100 is 0x1100. The store takes the device-routing byte path, not
    // the fast path, and must still drop the decoded word.
    const [c, u] = both(m => {
        place(m, 0x1000, [
            J(RA, 0x100),                               // 0x1000: call 0x1100
            ADDI(S1, A0, 0),
            LUI(T0, 0x101), ADDI(T0, T0, 0x100),        // t0 = 0x101100 (alias of 0x1100)
            LUI(T1, 0x00800), ADDI(T1, T1, 0x513),      // t1 = addi a0, x0, 8
            S(2, T0, T1, 0),
            J(RA, 0x1100 - 0x101c),                     // 0x101c: call 0x1100
            ADDI(S2, A0, 0),
            EBREAK
        ]);
        place(m, 0x1100, [ADDI(A0, 0, 1), RET]);
        m.cpu.pc = 0x1000;
        runToHalt(m);
    });
    assert.ok(c.cpu.ramMirror);
    assert.deepEqual([u.cpu.x[S1], u.cpu.x[S2]], [1, 8], 'reference');
    assert.deepEqual([c.cpu.x[S1], c.cpu.x[S2]], [1, 8]);
    assert.deepEqual(state(c), state(u));
});

test('FENCE.I makes a write the core did not see (the host poking RAM) visible to fetch', () => {
    // The program calls target, spins on a flag, executes FENCE.I, calls target
    // again. The host rewrites target and sets the flag by writing `mem`
    // DIRECTLY — no store the core could observe. FENCE.I is the architectural
    // point where such a write must reach instruction fetch.
    const program = fence => m => {
        place(m, 0x1000, [
            J(RA, 0x100),                               // 0x1000: call 0x1100
            ADDI(S1, A0, 0),
            LUI(T0, 3),                                 // flag at 0x3000
            LW(T1, T0, 0),                              // 0x100c
            B(0, T1, 0, -4),                            // beq t1, x0, 0x100c
            fence,
            J(RA, 0x1100 - 0x1018),                     // 0x1018: call 0x1100
            ADDI(S2, A0, 0),
            EBREAK
        ]);
        place(m, 0x1100, [ADDI(A0, 0, 1), RET]);
        m.cpu.pc = 0x1000;
        runUntilPc(m, 0x100c);
        for (let i = 0; i < 20; i++) m.step();          // spinning
        put32(m, 0x1100, ADDI(A0, 0, 9));               // host write, no flush call
        put32(m, 0x3000, 1);
        runToHalt(m);
    };
    const [c, u] = both(program(FENCE_I));
    assert.deepEqual([u.cpu.x[S1], u.cpu.x[S2]], [1, 9], 'reference');
    assert.deepEqual([c.cpu.x[S1], c.cpu.x[S2]], [1, 9], 'FENCE.I flushed the cache');
    assert.deepEqual(state(c), state(u));
    // Without the FENCE.I the cached core may (and does) keep the old word —
    // the licence the ISA gives an instruction cache, and proof this test
    // exercises a live cache rather than passing because nothing is cached.
    const [c2, u2] = both(program(NOP));
    assert.equal(u2.cpu.x[S2], 9);
    assert.equal(c2.cpu.x[S2], 1, 'no FENCE.I: the stale decoded word ran (the cache is really on)');
});

// ── Sv32 in S-mode, set up by the host ──
// Root table at 0x10000, its level-0 table at 0x11000 (VA 0x00400000-0x007fffff).
// VA 0x400000 → PA 0x20000 (main), VA 0x401000 → PA 0x21000 or 0x22000 (the
// function page being remapped), VA 0x402000 → PA 0x23000 (flag).
const V = 1, R = 2, W = 4, X = 8, A = 0x40, D = 0x80;
const leaf = (pa, perm) => (((pa >>> 12) << 10) | perm | V | A | D) >>> 0;
function sv32(m, {root = 0x10000, l0 = 0x11000, fn = 0x21000, main = 0x20000} = {}) {
    put32(m, root + 4 * 1, (((l0 >>> 12) << 10) | V) >>> 0);
    put32(m, l0 + 4 * 0, leaf(main, R | X));
    put32(m, l0 + 4 * 1, leaf(fn, R | X));
    put32(m, l0 + 4 * 2, leaf(0x23000, R | W));
    return ((1 << 31) | (root >>> 12)) >>> 0;
}
function enterS(m, satp, pc) {
    m.cpu._writeCsr(0x180, satp);
    m.cpu.priv = 1;
    m.cpu.pc = pc;
}
// main at VA 0x400000: call 0x401000, spin on the flag, `sync` (sfence.vma or
// csrw satp, t3), call 0x401000 again.
const remapMain = sync => [
    LUI(T0, 0x401),                                     // t0 = 0x401000
    JALR(RA, T0, 0), ADDI(S1, A0, 0),
    LUI(T1, 0x402),                                     // 0x0c: flag page
    LW(T2, T1, 0),                                      // 0x10
    B(0, T2, 0, -4),                                    // beq t2, x0, 0x10
    sync,
    JALR(RA, T0, 0), ADDI(S2, A0, 0),
    EBREAK
];

test('a remap under the cache: sfence.vma after a PTE change runs the NEW page', () => {
    const [c, u] = both(m => {
        const satp = sv32(m);
        place(m, 0x20000, remapMain(SFENCE_VMA));
        place(m, 0x21000, [ADDI(A0, 0, 1), RET]);       // the function, mapping 1
        place(m, 0x22000, [ADDI(A0, 0, 2), RET]);       // the function, mapping 2
        enterS(m, satp, 0x400000);
        runUntilPc(m, 0x400010);
        for (let i = 0; i < 10; i++) m.step();
        put32(m, 0x11000 + 4, leaf(0x22000, R | X));    // remap VA 0x401000 → PA 0x22000
        put32(m, 0x23000, 1);
        runToHalt(m);
    });
    assert.deepEqual([u.cpu.x[S1], u.cpu.x[S2]], [1, 2], 'reference');
    assert.deepEqual([c.cpu.x[S1], c.cpu.x[S2]], [1, 2], 'the fetch front followed the new translation');
    assert.deepEqual(state(c), state(u));
});

test('a satp switch to another page table runs the other mapping', () => {
    const [c, u] = both(m => {
        const satp1 = sv32(m);
        const satp2 = sv32(m, {root: 0x12000, l0: 0x13000, fn: 0x22000});
        place(m, 0x20000, remapMain(CSRW(0x180, T3)));
        place(m, 0x21000, [ADDI(A0, 0, 1), RET]);
        place(m, 0x22000, [ADDI(A0, 0, 2), RET]);
        m.cpu.x[T3] = satp2 | 0;
        enterS(m, satp1, 0x400000);
        runUntilPc(m, 0x400010);
        put32(m, 0x23000, 1);
        runToHalt(m);
    });
    assert.deepEqual([u.cpu.x[S1], u.cpu.x[S2]], [1, 2], 'reference');
    assert.deepEqual([c.cpu.x[S1], c.cpu.x[S2]], [1, 2]);
    assert.deepEqual(state(c), state(u));
});

// REMAPPING THE PAGE THE PC IS ON. The cases above call into the remapped
// page, and leaving a page re-validates the fetch front anyway; here the code
// never leaves VA 0x400000 while that page is remapped under it: PA 0x20000
// and PA 0x24000 hold the same loop, and differ only in the instruction after
// the sync. Every instruction of the loop has run (so is decoded) before the
// remap, and the host remaps at the top of an iteration: the sync then flushes
// the TLB and the very next fetch, on the same virtual page, must come from the
// new physical page. Only the translation generation (moved by that TLB
// flush) can tell the fetch front its page is gone.
const samePage = (sync, s2) => [
    LUI(T1, 0x402),                                     // flag page
    LW(T2, T1, 0),                                      // 0x04: top of the loop
    sync,                                               // 0x08
    ADDI(S2, 0, s2),                                    // 0x0c: the one difference
    B(0, T2, 0, -12),                                   // 0x10: beq t2, x0, 0x04
    EBREAK
];
for (const [name, viaSatp] of [['sfence.vma', false], ['a satp write', true]]) {
    test(`remapping the page the pc is on, then ${name}: the next instruction comes from the NEW page`, () => {
        const [c, u] = both(m => {
            const satp1 = sv32(m);
            const satp2 = sv32(m, {root: 0x12000, l0: 0x13000, main: 0x24000});
            const sync = viaSatp ? CSRW(0x180, T3) : SFENCE_VMA;
            place(m, 0x20000, samePage(sync, 1));
            place(m, 0x24000, samePage(sync, 2));
            m.cpu.x[T3] = satp1 | 0;                    // the loop's csrw re-selects the SAME table...
            enterS(m, satp1, 0x400000);
            runUntilPc(m, 0x400004);
            for (let i = 0; i < 12; i++) m.step();      // three turns on the old page: all decoded
            runUntilPc(m, 0x400004);                    // the top of a turn
            assert.equal(m.cpu.x[S2], 1);
            if (viaSatp) m.cpu.x[T3] = satp2 | 0;       // ...until now: the next one switches tables
            else put32(m, 0x11000, leaf(0x24000, R | X));   // remap VA 0x400000 → PA 0x24000
            put32(m, 0x23000, 1);
            runToHalt(m);
        });
        assert.equal(u.cpu.x[S2], 2, 'reference');
        assert.equal(c.cpu.x[S2], 2, 'the fetch front dropped the old page');
        assert.deepEqual(state(c), state(u));
    });
}

test('a host that changes the privilege directly (as a boot hand-off does) is not served the old page', () => {
    // Run in M-mode (no translation: VA 0x1000 is PA 0x1000), then the host
    // puts the hart in S-mode with paging on, where VA 0x1000 maps to PA
    // 0x25000 — other code at the same address. No trap, no xret, no CSR
    // instruction moves the generation; the privilege itself must.
    const [c, u] = both(m => {
        const root = 0x14000, l0 = 0x15000;
        put32(m, root, (((l0 >>> 12) << 10) | V) >>> 0);                      // VA 0x000xxxxx → l0
        put32(m, l0 + 4 * 1, leaf(0x25000, R | X));                          // VA 0x1000 → PA 0x25000
        place(m, 0x1000, [ADDI(S1, S1, 1), J(0, -4)]);                      // PA 0x1000: count in s1
        place(m, 0x25000, [ADDI(S2, 0, 7), EBREAK]);                        // PA 0x25000
        m.cpu.pc = 0x1000;
        for (let i = 0; i < 20; i++) m.step();                             // decoded, front on VA page 1
        // Straight into the CSR file, as bootLinux sets firmware state: no
        // CSR instruction, so no generation moves — only the privilege does.
        m.cpu.csr[0x180] = ((1 << 31) | (root >>> 12)) >>> 0;
        m.cpu.priv = 1;
        m.cpu.pc = 0x1000;
        runToHalt(m);
    });
    assert.equal(u.cpu.x[S2], 7, 'reference');
    assert.equal(c.cpu.x[S2], 7, 'the privilege is part of the fetch front');
});

test('a 32-bit instruction crossing a page: remapping the SECOND page changes it', () => {
    // `addi a0, x0, 5` at VA 0x400ffe: its low half (0x0513) on the main page,
    // its high half (the immediate) at VA 0x401000 — PA 0x21000 says 5, PA
    // 0x22000 says 7 — followed by `ret`. Only the second page is remapped, so
    // a cached copy keyed by the first page would be stale.
    const [c, u] = both(m => {
        const satp = sv32(m);
        const main = [
            LUI(T0, 0x401), ADDI(T0, T0, -2),           // t0 = 0x400ffe
            JALR(RA, T0, 0), ADDI(S1, A0, 0),
            LUI(T1, 0x402),                             // 0x10
            LW(T2, T1, 0),                              // 0x14
            B(0, T2, 0, -4),
            SFENCE_VMA,
            JALR(RA, T0, 0), ADDI(S2, A0, 0),
            EBREAK
        ];
        place(m, 0x20000, main);
        put16(m, 0x20ffe, 0x0513);
        put16(m, 0x21000, 0x0050); put32(m, 0x21002, RET);
        put16(m, 0x22000, 0x0070); put32(m, 0x22002, RET);
        enterS(m, satp, 0x400000);
        runUntilPc(m, 0x400014);
        for (let i = 0; i < 10; i++) m.step();
        put32(m, 0x11000 + 4, leaf(0x22000, R | X));
        put32(m, 0x23000, 1);
        runToHalt(m);
    });
    assert.deepEqual([u.cpu.x[S1], u.cpu.x[S2]], [5, 7], 'reference');
    assert.deepEqual([c.cpu.x[S1], c.cpu.x[S2]], [5, 7], 'the page-crossing instruction was re-fetched');
    assert.deepEqual(state(c), state(u));
});

test('host writes through the machine (load, a debugger poke, a snapshot restore) are seen without FENCE.I', () => {
    // call target, keep a0 in s1, spin at 0x1008. Each host write below
    // replaces target after it has been decoded; the program is re-entered
    // at 0x1000 with no FENCE.I anywhere.
    const program = m => {
        place(m, 0x1000, [J(RA, 0x100), ADDI(S1, A0, 0), J(0, 0)]);
        place(m, 0x1100, [ADDI(A0, 0, 1), RET]);
        m.cpu.pc = 0x1000;
        runUntilPc(m, 0x1008);
        assert.equal(m.cpu.x[S1], 1);
    };
    const again = (m, want, how) => {
        m.cpu.pc = 0x1000;
        runUntilPc(m, 0x1008);
        assert.equal(m.cpu.x[S1], want, how);
    };
    for (const decodeCache of [true, false]) {
        const tag = decodeCache ? 'cached' : 'uncached';
        // machine.load()
        const m = new RiscV32Machine({memSize: 1 << 20});
        m.cpu.decodeCache = decodeCache;
        program(m);
        m.load(new Uint8Array([0x13, 0x05, 0x40, 0x00]), 0x1100);           // addi a0, x0, 4
        again(m, 4, `${tag}: machine.load() is seen`);
        // the debugger's memory write
        const adapter = createRiscV32Adapter({config: {memSize: 1 << 20}});
        adapter.machine.cpu.decodeCache = decodeCache;
        program(adapter.machine);
        createRiscV32DebugTarget(adapter).writeMem('mem', 0x1100, new Uint8Array([0x13, 0x05, 0x50, 0x00]));   // addi a0, x0, 5
        again(adapter.machine, 5, `${tag}: a debugger poke is seen`);
        // a snapshot restore over a machine that decoded the old code
        const donor = new RiscV32Machine({memSize: 1 << 20});
        place(donor, 0x1000, [J(RA, 0x100), ADDI(S1, A0, 0), J(0, 0)]);
        place(donor, 0x1100, [ADDI(A0, 0, 6), RET]);
        donor.cpu.pc = 0x1000;
        const snap = saveRiscvSnapshot(donor);
        const r = new RiscV32Machine({memSize: 1 << 20});
        r.cpu.decodeCache = decodeCache;
        program(r);
        restoreRiscvSnapshot(r, snap);
        runUntilPc(r, 0x1008);
        assert.equal(r.cpu.x[S1], 6, `${tag}: a snapshot restore is seen`);
    }
});
