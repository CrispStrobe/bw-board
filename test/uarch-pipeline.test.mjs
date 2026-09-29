// The 5-stage pipeline timing model (src/uarch-pipeline.js) on small kernels,
// run on the real core through the retire trace, against cycle counts derived
// BY HAND from the model's stated rules (the header of uarch-pipeline.js).
// Each derivation is in the comment above its assertion.
//
// Conventions for the tables: cycles = instructions + 4 (fill) + stalls. A
// program ends in `ebreak`, which halts the bare machine without retiring,
// so the trace — and the pipeline — ends at the instruction before it. Loop
// kernels put a `nop` after the loop so the loop-exit branch has a successor
// whose fetch its outcome can delay.
//
// Mutations that go red here (measured when this was written, each alone):
//   forwarding always off (`!this.cfg.forwarding` -> `true`): the load-use,
//     ALU chain, loop, multiplier and diagram kernels (9 cases);
//   no load-use stall (a load's value forwarded like an ALU result: loadLike
//     always false): the load-use kernel, the diagram, the streaming case;
//   predictor never updates (bimodal/gshare update() leave the counter): the
//     bimodal loop kernels;
//   LRU becomes FIFO (a hit does not refresh its age): the cache-conflict kernel;
//   mul/div latency ignored (exLat always 1): the multiplier kernel;
//   a D-cache miss that does not stall: the strided-walk kernel.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RiscV32Machine} from '../src/riscv32-machine.js';
import {assembleRiscv} from '../src/riscv-asm.js';
import {attachTiming} from '../src/riscv32-timing.js';
import {PipelineModel, STALL_REASONS} from '../src/uarch-pipeline.js';

function time(src, cfg = {}) {
    const m = new RiscV32Machine({memSize: 1 << 16});
    m.loadImage(assembleRiscv(src, {textBase: 0x1000, dataBase: 0x8000}).image);
    const t = attachTiming(m.cpu, cfg);
    m.run(1_000_000);
    assert.ok(m.cpu.halted, 'the kernel ran to its ebreak');
    t.model.finish();
    const r = t.report();
    // The accounting identity holds for every run.
    const stalls = STALL_REASONS.reduce((a, k) => a + r[`pipe.stall.${k}`], 0);
    assert.equal(r['cpu.cycles'], r['cpu.insts'] + r['pipe.fill'] + stalls, 'cycles = insts + fill + stalls');
    return {r, t, m};
}

const LOAD_USE = `
    lui  a0, 8            # a0 = 0x8000
    lw   t0, 0(a0)
    addi t1, t0, 1        # uses t0 from the load just before
    lw   t2, 4(a0)
    add  t3, t2, t1       # uses t2 from the load just before
    lw   t4, 8(a0)
    add  t5, t4, t3       # uses t4 from the load just before
    ebreak`;

test('load-use chain, forwarding on: one bubble per load consumed at once', () => {
    // 7 instructions. lui -> lw is an ALU result forwarded to EX: free. Each of
    // the three load -> use pairs costs the one load-use bubble.
    // 7 + 4 + 3 = 14.
    const {r} = time(LOAD_USE);
    assert.equal(r['cpu.insts'], 7);
    assert.equal(r['pipe.stall.loaduse'], 3);
    assert.equal(r['pipe.stall.raw'], 0);
    assert.equal(r['cpu.cycles'], 14);
});

test('load-use chain, forwarding off: a value is read in ID during its producer\'s WB', () => {
    // A consumer's EX is at earliest its producer's WB + 1.
    //   lui  F0 D1 E2 M3 W4
    //   lw   F1 D2-4 E5 M6 W7        (needs a0: E >= 4+1: 2 bubbles)
    //   addi F2-4 D5-7 E8 M9 W10     (needs t0: E >= 7+1: 2)
    //   lw   F5-7 D8 E9 M10 W11      (a0 long written: 0)
    //   add  F8 D9-11 E12 M13 W14    (t2: E >= 11+1: 2)
    //   lw   F9-11 D12 E13 M14 W15   (0)
    //   add  F12 D13-15 E16 M17 W18  (t4: E >= 15+1: 2)
    // 19 cycles = 7 + 4 + 8 raw.
    const {r} = time(LOAD_USE, {forwarding: false});
    assert.equal(r['pipe.stall.raw'], 8);
    assert.equal(r['pipe.stall.loaduse'], 0);
    assert.equal(r['cpu.cycles'], 19);
});

const ALU_CHAIN = `
    addi t0, zero, 1
    addi t0, t0, 1
    addi t0, t0, 1
    addi t0, t0, 1
    addi t0, t0, 1
    addi t0, t0, 1
    ebreak`;

test('a dependent ALU chain: free with forwarding, two bubbles per link without', () => {
    // 6 instructions, 5 back-to-back dependences.
    assert.equal(time(ALU_CHAIN).r['cpu.cycles'], 6 + 4);             // 10
    const off = time(ALU_CHAIN, {forwarding: false}).r;
    assert.equal(off['pipe.stall.raw'], 5 * 2);
    assert.equal(off['cpu.cycles'], 6 + 4 + 10);                       // 20
    assert.equal(off['cpu.cpi'], 20 / 6);
});

const LOOP = `
    addi t0, zero, 10
loop:
    addi t0, t0, -1
    bnez t0, loop         # taken 9 times, then falls through
    nop
    ebreak`;

test('a counted loop under each predictor (resolve in EX: a wrong guess costs 2)', () => {
    // 1 + 10 x 2 + 1 = 22 instructions; the branch runs 10 times: T x9, N x1.
    // static not-taken: the 9 taken branches mispredict: 9 x 2 = 18. 22+4+18 = 44.
    let r = time(LOOP).r;
    assert.equal(r['cpu.insts'], 22);
    assert.deepEqual([r['bp.predictions'], r['bp.mispredicts']], [10, 9]);
    assert.equal(r['pipe.stall.control'], 18);
    assert.equal(r['cpu.cycles'], 44);
    // bimodal, no BTB: 1st predicted N (counter 1), taken: 2. The next 8 are
    // predicted T and taken, but without a BTB the target is known only after
    // decode: 1 each. The exit is predicted T, falls through: 2. 2+8+2 = 12 -> 38.
    r = time(LOOP, {predictor: {kind: 'bimodal'}}).r;
    assert.deepEqual([r['bp.mispredicts'], r['bp.redirect.decode']], [2, 8]);
    assert.equal(r['cpu.cycles'], 38);
    // bimodal + BTB: the 8 correctly predicted taken branches redirect at IF: free.
    // 2 + 2 = 4 -> 30.
    r = time(LOOP, {predictor: {kind: 'bimodal'}, btb: {entries: 16}}).r;
    assert.equal(r['pipe.stall.control'], 4);
    assert.equal(r['cpu.cycles'], 30);
    assert.deepEqual([r['btb.lookups'], r['btb.hits']], [10, 9]);
    // gshare (8 history bits) + BTB: every iteration has a new history
    // (1, 11, 111, … saturating at 0xff only for the 9th and 10th), so every
    // counter it reads is still cold at 1 -> predicts N: the 9 taken branches
    // miss; the 10th reads the counter the 9th trained to 2 -> predicts T,
    // falls through: miss. 10 x 2 = 20 -> 46. Worse than bimodal — warm-up.
    r = time(LOOP, {predictor: {kind: 'gshare', historyBits: 8}, btb: {entries: 16}}).r;
    assert.equal(r['bp.mispredicts'], 10);
    assert.equal(r['cpu.cycles'], 46);
});

test('branches resolved in ID: a cheaper redirect, but the branch needs its operand a stage earlier', () => {
    // static not-taken: 9 redirects x 1. And each bnez reads t0 from the addi
    // just before it: an ALU result reaches the ID comparator one cycle after
    // the producer's EX -> 1 raw bubble per iteration, 10. 22 + 4 + 9 + 10 = 45.
    const r = time(LOOP, {branchResolve: 'ID'}).r;
    assert.equal(r['pipe.stall.control'], 9);
    assert.equal(r['pipe.stall.raw'], 10);
    assert.equal(r['cpu.cycles'], 45);
});

test('the multiplier and divider hold EX (a structural hazard)', () => {
    // mul (3 EX cycles) -> 2 bubbles; its dependant addi waits frozen in ID,
    // then gets the product forwarded: no extra. div (16) -> 15 bubbles.
    // 5 instructions + 4 + 2 + 15 = 26.
    const src = `
        addi t1, zero, 3
        mul  t0, t1, t1
        addi t3, t0, 1
        div  t4, t3, t1
        nop
        ebreak`;
    const r = time(src).r;
    assert.equal(r['pipe.stall.muldiv'], 17);
    assert.equal(r['cpu.cycles'], 26);
    assert.equal(time(src, {mulLatency: 1, divLatency: 1}).r['cpu.cycles'], 9);
});

const WALK = `
    lui  a0, 8            # a0 = 0x8000, 16 words
    addi t1, zero, 16
loop:
    lw   t0, 0(a0)
    addi a0, a0, 4
    addi t1, t1, -1
    bnez t1, loop
    nop
    ebreak`;

test('a strided array walk: one D-cache miss per 16-byte line', () => {
    // 2 + 16 x 4 + 1 = 67 instructions. 64 bytes = 4 lines: 4 misses x 10 = 40.
    // Static not-taken: 15 taken branches x 2 = 30. 67 + 4 + 40 + 30 = 141.
    const r = time(WALK, {dcache: {size: 256, ways: 2, line: 16}, missPenalty: 10}).r;
    assert.deepEqual([r['dcache.accesses'], r['dcache.misses'], r['dcache.hits']], [16, 4, 12]);
    assert.equal(r['pipe.stall.dcache'], 40);
    assert.equal(r['pipe.stall.control'], 30);
    assert.equal(r['cpu.cycles'], 141);
    // Stride 16 (one word per line): every access misses: 16 x 10 = 160 -> 261.
    const r16 = time(WALK.replace('addi a0, a0, 4', 'addi a0, a0, 16'), {dcache: {size: 256, ways: 2, line: 16}}).r;
    assert.equal(r16['dcache.misses'], 16);
    assert.equal(r16['cpu.cycles'], 67 + 4 + 160 + 30);
});

test('replacement decides a conflict: LRU keeps the reused line, FIFO evicts it', () => {
    // Direct lines A=0x8000, B=0x8100, C=0x8200 all map to one set of a
    // 2-way 256-byte cache (8 sets of 16 B: set = bits 4..6, all 0).
    // Access order A B A C A. LRU: M M H M(evicts B) H = 3 misses.
    // FIFO: M M H M(evicts A) M = 4 misses. 7 instructions + 4, 10 per miss.
    const src = `
        lui a0, 8
        lw  t0, 0(a0)
        lw  t1, 256(a0)
        lw  t2, 0(a0)
        lw  t3, 512(a0)
        lw  t4, 0(a0)
        nop
        ebreak`;
    const lru = time(src, {dcache: {size: 256, ways: 2, line: 16, replacement: 'lru'}}).r;
    const fifo = time(src, {dcache: {size: 256, ways: 2, line: 16, replacement: 'fifo'}}).r;
    assert.equal(lru['dcache.misses'], 3);
    assert.equal(fifo['dcache.misses'], 4);
    assert.equal(lru['cpu.cycles'], 7 + 4 + 30);
    assert.equal(fifo['cpu.cycles'], 7 + 4 + 40);
});

test('an I-cache miss holds IF: straight-line code costs one miss per line', () => {
    // 8 nops = 32 bytes at 0x1000 = two 16-byte lines: 2 x 10 = 20. 8 + 4 + 20 = 32.
    const r = time('nop\n'.repeat(8) + 'ebreak', {icache: {size: 256, ways: 2, line: 16}}).r;
    assert.deepEqual([r['icache.accesses'], r['icache.misses']], [8, 2]);
    assert.equal(r['cpu.cycles'], 32);
});

test('the occupancy record is the classic diagram (load-use, forwarding on)', () => {
    const {t} = time(LOAD_USE, {recordCycles: 64});
    const o = t.occupancy();
    assert.equal(o.cycles, 14);
    const row = seq => {
        const r = o.rows[seq];
        let s = '';
        for (let c = 0; c < o.cycles; c++) {
            const cell = r.cells.find(k => k.cycle === c);
            s += !cell ? '.' : ('FDXMW'['IF ID EX MEM WB'.split(' ').indexOf(cell.stage)]) [cell.hold ? 'toLowerCase' : 'toUpperCase']();
        }
        return s;
    };
    assert.equal(o.rows[1].text, 'lw t0, 0(a0)');
    assert.equal(row(1), '.FDXMW........');
    assert.equal(row(2), '..FdDXMW......', 'addi held one cycle in ID: the load-use bubble');
    assert.equal(o.rows[2].cells[1].hold, 'loaduse');
    assert.equal(row(3), '...fFDXMW.....', 'the next instruction is frozen in IF behind it');
    assert.ok(o.bubbles.some(b => b.cycle === 4 && b.stage === 'EX' && b.reason === 'loaduse'), 'the bubble itself, in EX');
    assert.equal(row(6), '........FdDXMW');
});

test('records may arrive one at a time or all at once: the same timing', () => {
    // Synthetic trace: independent ALU ops, a load and its consumer.
    const recs = [];
    const alu = (rd, rs1) => ({cls: 'alu', rd, rs1, rs2: 0, memKind: '', len: 4, taken: false});
    for (let i = 0; i < 20; i++) recs.push(i % 5 === 3 ? {cls: 'load', rd: 7, rs1: 2, rs2: 0, memKind: 'load', memVa: 0x100 + i * 4, memPa: 0x100 + i * 4, memSize: 4, len: 4} : alu(5 + (i % 3), i % 5 === 4 ? 7 : 0));
    recs.forEach((r, i) => { r.seq = i; r.pc = 0x1000 + 4 * i; r.nextPc = r.pc + 4; r.ppc = r.pc; r.op = 0x13; });
    const a = new PipelineModel({dcache: {size: 64, ways: 1, line: 16}});
    for (const r of recs) a.push(r);
    a.finish();
    const b = new PipelineModel({dcache: {size: 64, ways: 1, line: 16}});
    b.push(recs[0]); b.push(recs[1]);
    for (const r of recs.slice(2)) b.push(r);
    b.finish();
    assert.deepEqual(a.report(), b.report());
    // 20 + 4 + 4 load-use + 4 D-cache misses (0x10c, 0x120, 0x134, 0x148: four lines) x 10.
    assert.equal(a.report()['pipe.stall.loaduse'], 4);
    assert.equal(a.report()['cpu.cycles'], 20 + 4 + 4 + 40);
});

test('the RISC-V debug target: timing on, the diagram and stats read back, a reset starts fresh', async () => {
    const {createDebugTarget} = await import('../src/debug-target-factory.js');
    const {image} = assembleRiscv(LOAD_USE, {textBase: 0x1000, dataBase: 0x8000});
    const {target} = await createDebugTarget('riscv32', {image});
    assert.equal(target.timing(), null, 'off by default');
    assert.ok(target.capabilities().extensions.timing.predictors.includes('gshare'));
    assert.deepEqual(target.setTiming({branchResolve: 'MEM'}), {refused: "branchResolve must be 'EX' or 'ID' (MEM)"});
    assert.equal(target.setTiming({forwarding: true}), undefined);
    target.step('insn', 3);
    target.runFor(1e6);
    let v = target.timing();
    assert.ok(v.stats['cpu.insts'] < 3, 'three retired instructions are still in flight in the pipeline');
    target.run();
    while (target.runFor(1e6) !== 'halted');
    v = target.timing(64);
    assert.equal(v.stats['cpu.cycles'], 14, 'drained at the halt: the hand-derived 14 cycles');
    assert.equal(v.occupancy.rows[2].text, 'addi t1, t0, 1');
    assert.equal(v.config.forwarding, true);
    target.reset();
    assert.equal(target.timing().stats['cpu.cycles'], 0, 'a reset starts a fresh model');
    target.setTiming(null);
    assert.equal(target.timing(), null);
    // A new config is a fresh model from the next instruction (a new target here:
    // a program-mode reset() does not return to the image entry — see ROADMAP R-gaps).
    const {target: t2} = await createDebugTarget('riscv32', {image});
    t2.setTiming({forwarding: false});
    t2.run();
    while (t2.runFor(1e6) !== 'halted');
    assert.equal(t2.timing().stats['cpu.cycles'], 19);
});
