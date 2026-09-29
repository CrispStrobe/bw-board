// The retired-instruction trace (src/riscv32-trace.js) and the timing
// attachment (src/riscv32-timing.js): the records say what the core did, and
// attaching them changes nothing the core does.
//
// Equivalence is checked on real programs that exercise every path the
// tracer peeks through — FreeRTOS (M-mode traps, timer interrupts, ecall
// exceptions), a compressed-instruction program (RVC), and a clang S-mode
// kernel under Sv32 paging (translation, A/D bits, SBI calls): each runs
// traced (with the full pipeline, caches and predictor) and untraced, and must
// end in the same registers, CSRs, memory, pc and retired count.
//
// Mutations that go red here (measured when this was written): a peek that
// walks through _translate (TLB fill, A/D update, trap) reds the
// no-side-effects case; reading the instruction after the step instead of
// before reds the self-overwriting store; a trace that drops interrupt
// records reds the FreeRTOS chain and the interrupt-record case.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {createHash} from 'node:crypto';
import {RiscV32, INTERRUPT} from '../src/riscv32.js';
import {RiscV32Machine} from '../src/riscv32-machine.js';
import {assembleRiscv} from '../src/riscv-asm.js';
import {loadElfInto} from '../scripts/riscv-elf.mjs';
import {attachRetireTrace, disasmRv32, classifyRv32} from '../src/riscv32-trace.js';
import {attachTiming} from '../src/riscv32-timing.js';
import {STALL_REASONS} from '../src/uarch-pipeline.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = p => new Uint8Array(Buffer.from(readFileSync(join(here, 'fixtures', p), 'utf8').trim(), 'base64'));

function asmMachine(src) {
    const m = new RiscV32Machine({memSize: 1 << 16});
    m.loadImage(assembleRiscv(src, {textBase: 0x1000, dataBase: 0x8000}).image);
    return m;
}

test('records carry pc, class, registers, the data access and the branch outcome', () => {
    const m = asmMachine(`
        lui  a0, 8
        addi t1, zero, 2
    loop:
        sw   t1, 4(a0)
        lw   t2, 4(a0)
        addi t1, t1, -1
        bnez t1, loop
        mul  t3, t2, t1
        jal  ra, fn
        ebreak
    fn: ret`);
    const recs = [];
    attachRetireTrace(m.cpu, r => recs.push(r));
    m.run(1000);
    assert.equal(recs.length, 2 + 2 * 4 + 1 + 1 + 1);
    const [lui, , sw, lw, , bnez1] = recs;
    assert.deepEqual([lui.pc, lui.cls, lui.rd, lui.rs1, lui.len], [0x1000, 'alu', 10, 0, 4]);
    assert.deepEqual([sw.cls, sw.rd, sw.rs1, sw.rs2, sw.memKind, sw.memVa, sw.memPa, sw.memSize], ['store', 0, 10, 6, 'store', 0x8004, 0x8004, 4]);
    assert.deepEqual([lw.cls, lw.rd, lw.memKind, lw.memVa], ['load', 7, 'load', 0x8004]);
    assert.deepEqual([bnez1.cls, bnez1.taken, bnez1.target, bnez1.nextPc], ['branch', true, 0x1008, 0x1008]);
    const bnez2 = recs[9];
    assert.deepEqual([bnez2.taken, bnez2.target, bnez2.nextPc], [false, 0x1008, 0x1018]);
    assert.equal(recs[10].cls, 'mul');
    assert.deepEqual([recs[11].cls, recs[11].taken, recs[11].target], ['jal', true, 0x1024]);
    assert.deepEqual([recs[12].cls, recs[12].rs1, recs[12].nextPc], ['jalr', 1, 0x1020]);
    assert.ok(recs.every((r, i) => r.seq === i && r.priv === 3 && r.trap === null));
    assert.ok(recs.every((r, i) => i === 0 || recs[i - 1].nextPc === r.pc), 'each record continues where the last one went');
});

test('the instruction is the one the step executed, even when the step overwrites it', () => {
    // A store that overwrites ITSELF: after the step its word holds other
    // bits, but the trace must show the store that ran.
    const m = asmMachine(`
        lui  a0, 1            # a0 = 0x1000
        lw   t0, 12(a0)       # t0 = the word at 0x100c ('addi t1, zero, 7')
        sw   t0, 8(a0)        # at 0x1008: overwrites itself
        addi t1, zero, 7
        ebreak`);
    const recs = [];
    attachRetireTrace(m.cpu, r => recs.push(r));
    m.run(100);
    assert.equal(m.mem[0x1008], m.mem[0x100c], 'the store did overwrite itself');
    assert.equal(disasmRv32(recs[2].op, recs[2].pc), 'sw t0, 8(a0)');
    assert.equal(recs[2].cls, 'store');
});

test('compressed instructions: raw 16 bits, their expansion, length 2', () => {
    const m = new RiscV32Machine({});
    loadElfInto(m, fixture('riscv-rvc/rvc-hello.elf.b64'));
    const recs = [];
    attachRetireTrace(m.cpu, r => { if (recs.length < 20000) recs.push(r); });
    m.run(2_000_000);
    const c = recs.filter(r => r.len === 2);
    assert.ok(c.length > 100, `compressed instructions were traced (${c.length})`);
    for (const r of c.slice(0, 200)) {
        assert.ok(r.inst <= 0xffff && (r.inst & 3) !== 3);
        assert.equal(r.op & 3, 3, 'expanded to a 32-bit encoding');
        assert.equal(classifyRv32(r.op).cls, r.cls);
    }
    assert.ok(recs.every((r, i) => i === 0 || recs[i - 1].nextPc === r.pc));
});

test('FreeRTOS: traps and interrupts appear as trap records, and the chain is unbroken', () => {
    const m = new RiscV32Machine({memSize: 1 << 20, ecallTraps: true});
    loadElfInto(m, fixture('riscv-freertos/freertos-demo.elf.b64'));
    const recs = [];
    let prev = null, breaks = 0, traps = 0, irqs = 0;
    attachRetireTrace(m.cpu, r => {
        if (prev && prev.nextPc !== r.pc) breaks++;
        if (r.trap) { traps++; if (r.trap.interrupt) irqs++; }
        prev = r;
        if (recs.length < 10) recs.push(r);
    });
    m.run(300_000);
    assert.equal(breaks, 0, 'every record starts where the previous one said the pc went');
    assert.ok(irqs > 5, `timer interrupts traced (${irqs})`);
    assert.ok(traps - irqs > 5, `ecall exceptions traced (${traps - irqs})`);
});

function archState(m) {
    const h = createHash('sha256');
    h.update(m.mem); h.update(new Uint8Array(m.cpu.csr.buffer)); h.update(new Uint8Array(m.cpu.x.buffer));
    return {hash: h.digest('hex'), pc: m.cpu.pc >>> 0, instret: m.cpu.instret, priv: m.cpu.priv, retired: m.cpu.retired};
}

const PROGRAMS = {
    freertos: () => { const m = new RiscV32Machine({memSize: 1 << 20, ecallTraps: true}); loadElfInto(m, fixture('riscv-freertos/freertos-demo.elf.b64')); return m; },
    rvc: () => { const m = new RiscV32Machine({}); loadElfInto(m, fixture('riscv-rvc/rvc-hello.elf.b64')); return m; },
    smode: () => { const m = new RiscV32Machine({memSize: 1 << 22, ramBase: 0x80000000}); loadElfInto(m, fixture('riscv-smode/smode-demo.elf.b64')); return m; }
};
const FULL = {forwarding: true, predictor: {kind: 'gshare'}, btb: {entries: 64},
    icache: {size: 2048, ways: 2, line: 32}, dcache: {size: 2048, ways: 4, line: 32, replacement: 'lru'}};

for (const [name, make] of Object.entries(PROGRAMS)) {
    test(`${name}: timing on changes nothing architectural, and its accounting adds up`, () => {
        const steps = 250_000;
        const plain = make();
        plain.run(steps);
        const timed = make();
        const t = attachTiming(timed.cpu, FULL);
        timed.run(steps);
        assert.deepEqual(archState(timed), archState(plain));
        t.model.finish();
        const r = t.report();
        const stalls = STALL_REASONS.reduce((a, k) => a + r[`pipe.stall.${k}`], 0);
        assert.equal(r['cpu.cycles'], r['cpu.insts'] + r['pipe.fill'] + stalls, 'cycles = insts + fill + stalls');
        assert.equal(r['cpu.insts'] + r['cpu.traps'], t.records, 'every record reached WB');
        assert.equal(r['cpu.insts'], timed.cpu.retired, 'the model retired exactly what the core retired');
        assert.ok(r['cpu.cpi'] > 1 && r['dcache.accesses'] > 100 && r['bp.predictions'] > 100, JSON.stringify([r['cpu.insts'], r['dcache.accesses'], r['bp.predictions']]));
        // Detached, the instance runs the class's own step again.
        t.detach();
        assert.equal(timed.cpu.step, RiscV32.prototype.step);
        timed.run(1000); plain.run(1000);
        assert.deepEqual(archState(timed), archState(plain));
    });
}

test('peeks have no side effects: no TLB fill, no A/D update, no trap', () => {
    const m = PROGRAMS.smode();
    m.run(200_000);                                        // well into the paged kernel
    assert.ok(m.cpu.csr[0x180] >>> 31, 'Sv32 is on');
    const before = {tlb: m.cpu._tlbTag.slice(), mem: m.mem.slice(), csr: m.cpu.csr.slice(), traps: m.cpu._traps};
    for (let va = 0; va < 0x100000000; va += 0x10001f3) {
        for (const kind of [0, 1, 2]) m.cpu.peekTranslate(va, kind);
    }
    m.cpu.peekTranslate(m.cpu.pc, 0);
    assert.deepEqual(m.cpu._tlbTag, before.tlb);
    assert.deepEqual(m.mem, before.mem);
    assert.deepEqual(m.cpu.csr, before.csr);
    assert.equal(m.cpu._traps, before.traps);
    // And it agrees with the real walk where one succeeds.
    const pc = m.cpu.pc >>> 0;
    assert.equal(m.cpu.peekTranslate(pc, 0), m.cpu._translate(pc, 'fetch'));
});

test('peekRam refuses device pages instead of reading them', () => {
    const m = new RiscV32Machine({memSize: 1 << 16});
    const reads = [];
    m.cpu.io8.push({base: 0x2000, size: 16, load8: a => { reads.push(a); return 0; }, store8() {}});
    assert.equal(m.cpu.peekRam(0x2004, 1), null);
    assert.deepEqual(reads, [], 'no device read');
    m.mem[0x3000] = 0x12; m.mem[0x3001] = 0x34;
    assert.equal(m.cpu.peekRam(0x3000, 2), 0x3412);
});

test('the disassembler speaks the assembler\'s syntax', () => {
    for (const line of ['add t0, t1, t2', 'sub a0, a1, a2', 'addi sp, sp, -16', 'lw ra, 12(sp)', 'sw s0, 8(sp)',
        'mul t3, t4, t5', 'divu a0, a0, a1', 'lui a5, 0x12345', 'srai t0, t0, 3', 'lbu a1, 0(a0)', 'andi t0, t0, 255',
        'xor a0, a0, a1', 'sltu t0, t1, t2', 'ecall', 'ebreak']) {
        const {image} = assembleRiscv(line, {textBase: 0});
        const b = image.segments[0].bytes;
        const w = (b[0] | b[1] << 8 | b[2] << 16 | b[3] << 24) >>> 0;
        assert.equal(disasmRv32(w, 0), line);
    }
    assert.equal(disasmRv32(0x0000006f /* jal zero, 0 */, 0x100), 'jal zero, 0x100');
});

test('one trace per core: a second attach is refused; detach is idempotent', () => {
    const m = asmMachine('nop\nebreak');
    const h = attachRetireTrace(m.cpu, () => {});
    assert.throws(() => attachRetireTrace(m.cpu, () => {}), /already attached/);
    h.detach(); h.detach();
    const h2 = attachRetireTrace(m.cpu, () => {});
    h2.detach();
    assert.equal(m.cpu.step, RiscV32.prototype.step);
});

test('an interrupt record has no instruction: nothing at its pc ran', () => {
    const {image, symbols} = assembleRiscv(`
        la   t0, h
        csrw mtvec, t0
        addi t1, zero, 8
        csrw mstatus, t1      # MIE
        addi t1, zero, 0x80
        csrw mie, t1          # MTIE
    spin:
        j spin
    h:  ebreak`, {textBase: 0x1000, dataBase: 0x8000});
    const m = new RiscV32Machine({memSize: 1 << 16});
    m.loadImage(image);
    const recs = [];
    attachRetireTrace(m.cpu, r => recs.push(r));
    for (let i = 0; i < 9; i++) m.cpu.step();
    m.cpu.setInterruptPending(INTERRUPT.MTI, true);
    m.cpu.step();
    const last = recs.at(-1);
    assert.equal(recs.at(-2).cls, 'jal');
    assert.deepEqual([last.cls, last.trap.interrupt, last.trap.cause, last.op, last.len, last.nextPc],
        ['trap', true, 7, -1, 0, symbols.get('h')]);
});
