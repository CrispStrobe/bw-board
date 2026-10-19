/**
 * Contention FUSE-style vectors — per-instruction timing with the 48K
 * ULA contention model enabled.
 *
 * Each vector: a single instruction at a known frame position, with
 * the expected total cycle count (base + contention). The vectors are
 * OWN-CODE — hand-computed from the community contention tables and
 * the Z80 instruction timing, not copied from FUSE (GPL).
 *
 * Accuracy level: per-instruction approximation. The contention
 * wrapper fires on each bus read/write the Z80 core makes. For
 * single-access instructions (NOP, LD r,r') the result is exact.
 * For multi-access instructions (LD (HL),n, LDIR) the result is
 * approximate — each access sees the frame position AFTER previous
 * contention penalties, which shifts the pattern lookup.
 *
 * Frame geometry: 48K, 312 lines × 224 T/line = 69888 T/frame.
 * Contended: lines 64-255, T-states 0-127 per line.
 * Pattern: offset 0→+6, 1→+5, 2→+4, 3→+3, 4→+2, 5→+1, 6→+0, 7→+0.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Z80Machine } from '../src/z80-machine.js';

/**
 * Run a single instruction from `addr` with contention ON, starting
 * at the given frame T-state. Returns { elapsed, finalPc }.
 */
function runOne(opcodes, addr, frameTstate, opts = {}) {
    const m = new Z80Machine({
        clockHz: 3_500_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }],
        ula: true,
        contention: true,
    }, {});
    m.mem.set(opcodes, addr);
    m.mem[addr + opcodes.length] = 0x76; // HALT sentinel
    m.cpu.pc = addr;
    m.cpu.sp = opts.sp ?? 0xff00;
    if (opts.hl !== undefined) m.cpu.hl = opts.hl;
    if (opts.bc !== undefined) m.cpu.bc = opts.bc;
    if (opts.de !== undefined) m.cpu.de = opts.de;
    if (opts.a !== undefined) m.cpu.a = opts.a;
    // Position the ULA
    m.cycles = frameTstate;
    const start = m.cycles;
    m.step(); // execute ONE instruction
    return { elapsed: m.cycles - start, finalPc: m.cpu.pc };
}

/** Same instruction WITHOUT contention for comparison. */
function runOneNoContend(opcodes, addr, frameTstate, opts = {}) {
    const m = new Z80Machine({
        clockHz: 3_500_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }],
        ula: true,
        contention: false,
    }, {});
    m.mem.set(opcodes, addr);
    m.mem[addr + opcodes.length] = 0x76;
    m.cpu.pc = addr;
    m.cpu.sp = opts.sp ?? 0xff00;
    if (opts.hl !== undefined) m.cpu.hl = opts.hl;
    if (opts.bc !== undefined) m.cpu.bc = opts.bc;
    if (opts.de !== undefined) m.cpu.de = opts.de;
    if (opts.a !== undefined) m.cpu.a = opts.a;
    m.cycles = frameTstate;
    const start = m.cycles;
    m.step();
    return { elapsed: m.cycles - start, finalPc: m.cpu.pc };
}

// Active display line 64, T-state 0 — maximum contention (pattern offset 0 → +6)
const LINE64_T0 = 64 * 224;

// ── Vector suite ──────────────────────────────────────────────────

describe('contention vectors: single instructions at pattern offset 0', () => {

    it('NOP at $4000: 4T base + contention on opcode fetch', () => {
        // NOP = 0x00, 4 T-states, one opcode fetch from contended RAM.
        // At pattern offset 0: +6 contention on the fetch read.
        const r = runOne([0x00], 0x4000, LINE64_T0);
        const base = runOneNoContend([0x00], 0x4000, LINE64_T0);
        assert.equal(base.elapsed, 4, 'NOP base = 4T');
        assert.ok(r.elapsed > base.elapsed, `NOP contended (${r.elapsed}) > base (${base.elapsed})`);
        // The fetch is the first bus access; at pattern 0 it adds 6T.
        // Total should be 10T (4 + 6).
        assert.equal(r.elapsed, 10, 'NOP at pattern 0: 4 + 6 = 10T');
    });

    it('NOP at $8000: uncontended, always 4T', () => {
        const r = runOne([0x00], 0x8000, LINE64_T0);
        assert.equal(r.elapsed, 4, 'NOP at $8000 = 4T regardless of frame position');
    });

    it('LD A,(HL) with HL in contended RAM: 7T + contention', () => {
        // LD A,(HL) = 0x7E, 7 T-states base. Two bus accesses:
        // 1. opcode fetch (at PC), 2. memory read (at HL).
        // With PC=$8000 (uncontended) and HL=$4000 (contended):
        // only the (HL) read is contended.
        const r = runOne([0x7e], 0x8000, LINE64_T0, { hl: 0x4000 });
        const base = runOneNoContend([0x7e], 0x8000, LINE64_T0, { hl: 0x4000 });
        assert.equal(base.elapsed, 7, 'LD A,(HL) base = 7T');
        assert.ok(r.elapsed > 7, `LD A,(HL) contended: ${r.elapsed}T > 7T`);
    });

    it('LD A,(HL) with both PC and HL in contended: more penalty', () => {
        // Both fetch AND data read are contended.
        const r = runOne([0x7e], 0x4000, LINE64_T0, { hl: 0x4100 });
        assert.ok(r.elapsed > 10, `both contended: ${r.elapsed}T should be substantial`);
    });

    it('LD (HL),A writes to contended RAM: contention on write', () => {
        // LD (HL),A = 0x77, 7T base. Opcode fetch + memory write.
        // PC=$8000 (uncontended), HL=$4000 (contended write).
        const r = runOne([0x77], 0x8000, LINE64_T0, { hl: 0x4000, a: 0x42 });
        const base = runOneNoContend([0x77], 0x8000, LINE64_T0, { hl: 0x4000, a: 0x42 });
        assert.equal(base.elapsed, 7, 'LD (HL),A base = 7T');
        assert.ok(r.elapsed > 7, `LD (HL),A write contended: ${r.elapsed}T > 7T`);
    });
});

describe('contention vectors: border timing loop', () => {

    it('DEC B + JR NZ from contended RAM at active display', () => {
        // DEC B = 0x05 (4T), JR NZ taken = 0x20 disp (12T when taken, 7T not taken).
        // disp = -(2+1) = -3 = 0xFD to jump back from $4003 to $4000.
        const prog = [0x05, 0x20, 0xfd, 0x76]; // DEC B; JR NZ, -3; HALT

        function runLoop(base, contention) {
            const m = new Z80Machine({
                clockHz: 3_500_000,
                regions: [{ kind: 'ram', start: 0, end: 0xffff }],
                ula: true, contention,
            }, {});
            m.mem.set(prog, base);
            m.cpu.pc = base;
            m.cpu.sp = 0xff00;
            m.cpu.bc = 0x0400; // B=4
            m.cycles = LINE64_T0;
            const start = m.cycles;
            // Run until HALT (Z80 HALT returns 4T but sets cpu.halted)
            for (let i = 0; i < 100; i++) { m.step(); if (m.cpu.halted) break; }
            // Subtract the HALT's own 4T — we want only the loop
            return m.cycles - start - 4;
        }

        const uncontended = runLoop(0x4000, false);
        const contended = runLoop(0x4000, true);

        // Base: 3 taken iterations × (4+12) + 1 final × (4+7) = 48+11 = 59T
        assert.equal(uncontended, 59, 'border loop base = 59T');
        assert.ok(contended > uncontended + 10,
            `contended (${contended}T) should exceed uncontended (${uncontended}T) by >10T`);
    });

    it('same loop from uncontended RAM: no penalty', () => {
        const prog = [0x05, 0x20, 0xfd, 0x76];
        const m = new Z80Machine({
            clockHz: 3_500_000,
            regions: [{ kind: 'ram', start: 0, end: 0xffff }],
            ula: true, contention: true,
        }, {});
        m.mem.set(prog, 0x8000);
        m.cpu.pc = 0x8000;
        m.cpu.sp = 0xff00;
        m.cpu.bc = 0x0400;
        m.cycles = LINE64_T0;
        const start = m.cycles;
        for (let i = 0; i < 100; i++) { m.step(); if (m.cpu.halted) break; }
        assert.equal(m.cycles - start - 4, 59, 'uncontended loop = exact 59T');
    });
});

describe('contention vectors: pattern offset sweep', () => {

    it('NOP at each pattern offset: penalty decreases 6,5,4,3,2,1,0,0', () => {
        const expected = [6, 5, 4, 3, 2, 1, 0, 0];
        for (let offset = 0; offset < 8; offset++) {
            const r = runOne([0x00], 0x4000, LINE64_T0 + offset);
            const penalty = r.elapsed - 4;
            assert.equal(penalty, expected[offset],
                `NOP at pattern offset ${offset}: penalty ${penalty}, expected ${expected[offset]}`);
        }
    });

    it('NOP during border time (line 0): no contention at any offset', () => {
        for (let offset = 0; offset < 8; offset++) {
            const r = runOne([0x00], 0x4000, offset);
            assert.equal(r.elapsed, 4, `NOP at border line 0 offset ${offset} = 4T`);
        }
    });

    it('NOP during uncontended half of active line (T≥128): no penalty', () => {
        const r = runOne([0x00], 0x4000, LINE64_T0 + 128);
        assert.equal(r.elapsed, 4, 'NOP at T=128 of active line = 4T');
    });
});

describe('contention vectors: port I/O', () => {

    it('OUT ($FE),A from uncontended code: port contention only', () => {
        // OUT (n),A = 0xD3 n, 11T base.
        // Code at $8000 (uncontended), port $FE (ULA, contended).
        const r = runOne([0xd3, 0xfe], 0x8000, LINE64_T0, { a: 7 });
        const base = runOneNoContend([0xd3, 0xfe], 0x8000, LINE64_T0, { a: 7 });
        assert.equal(base.elapsed, 11, 'OUT (n),A base = 11T');
        assert.ok(r.elapsed > 11, `OUT $FE contended: ${r.elapsed}T > 11T`);
    });

    it('IN A,($FE) from uncontended code: port contention', () => {
        const r = runOne([0xdb, 0xfe], 0x8000, LINE64_T0);
        const base = runOneNoContend([0xdb, 0xfe], 0x8000, LINE64_T0);
        assert.equal(base.elapsed, 11, 'IN A,(n) base = 11T');
        assert.ok(r.elapsed > 11, `IN $FE contended: ${r.elapsed}T > 11T`);
    });

    it('OUT to odd port ($FF): no port contention', () => {
        // Odd ports are NOT ULA-decoded, no port contention.
        const r = runOne([0xd3, 0xff], 0x8000, LINE64_T0, { a: 0 });
        const base = runOneNoContend([0xd3, 0xff], 0x8000, LINE64_T0, { a: 0 });
        assert.equal(r.elapsed, base.elapsed, 'odd port = no port contention');
    });
});

describe('contention vectors: LDIR (block transfer)', () => {

    it('LDIR from contended → uncontended: source reads are contended', () => {
        // LDIR = ED B0, 21T per iteration (when BC>1), 16T final.
        // Source at $4000 (contended), dest at $8000 (uncontended).
        const m = new Z80Machine({
            clockHz: 3_500_000,
            regions: [{ kind: 'ram', start: 0, end: 0xffff }],
            ula: true, contention: true,
        }, {});
        m.mem[0x8000] = 0xed; m.mem[0x8001] = 0xb0; m.mem[0x8002] = 0x76;
        // Fill source
        for (let i = 0; i < 4; i++) m.mem[0x4000 + i] = 0x41 + i;
        m.cpu.pc = 0x8000;
        m.cpu.sp = 0xff00;
        m.cpu.hl = 0x4000; // source (contended)
        m.cpu.de = 0x9000; // dest (uncontended)
        m.cpu.bc = 4;      // 4 bytes
        m.cycles = LINE64_T0;
        const start = m.cycles;
        // LDIR repeats internally; step once per iteration until BC=0
        while (m.cpu.bc > 0) m.step();
        const contended = m.cycles - start;

        // Verify data transferred
        for (let i = 0; i < 4; i++) {
            assert.equal(m.mem[0x9000 + i], 0x41 + i, `byte ${i} transferred`);
        }

        // Same without contention
        const m2 = new Z80Machine({
            clockHz: 3_500_000,
            regions: [{ kind: 'ram', start: 0, end: 0xffff }],
            ula: true, contention: false,
        }, {});
        m2.mem[0x8000] = 0xed; m2.mem[0x8001] = 0xb0; m2.mem[0x8002] = 0x76;
        for (let i = 0; i < 4; i++) m2.mem[0x4000 + i] = 0x41 + i;
        m2.cpu.pc = 0x8000; m2.cpu.sp = 0xff00;
        m2.cpu.hl = 0x4000; m2.cpu.de = 0x9000; m2.cpu.bc = 4;
        m2.cycles = LINE64_T0;
        const start2 = m2.cycles;
        while (m2.cpu.bc > 0) m2.step();
        const uncontended = m2.cycles - start2;

        // Base: 3 × 21 + 1 × 16 = 79T
        assert.equal(uncontended, 79, 'LDIR 4 bytes base = 79T');
        assert.ok(contended > uncontended,
            `LDIR from contended (${contended}T) > base (${uncontended}T)`);
    });
});

describe('contention vectors: contention gate (config.contention)', () => {

    it('identical cycles with contention OFF regardless of address', () => {
        // Verify the gate works: same instruction at $4000 and $8000
        // should produce identical cycles when contention is off.
        const opcodes = [0x7e]; // LD A,(HL)
        const r4 = runOneNoContend(opcodes, 0x4000, LINE64_T0, { hl: 0x4100 });
        const r8 = runOneNoContend(opcodes, 0x8000, LINE64_T0, { hl: 0x8100 });
        assert.equal(r4.elapsed, r8.elapsed,
            `contention OFF: $4000 (${r4.elapsed}T) === $8000 (${r8.elapsed}T)`);
    });
});
