/**
 * ULA memory contention — per-instruction approximation tests.
 *
 * Hand-computed from the community contention tables (48K: 312 lines ×
 * 224 T-states, contended lines 64-255, contended T-states 0-127 per
 * line, 8-T-state pattern).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { ZXULA } from '../src/zx-ula.js';
import { Z80Machine } from '../src/z80-machine.js';

// ─── ULA.contend() oracle tests ───────────────────────────────────

test('contention delay table: pattern positions 0-7 at active display', () => {
    const ula = new ZXULA(new Uint8Array(65536));
    // Line 64 (first contended line), T-state 0 of the line
    const lineStart = 64 * 224;
    assert.equal(ula.contend(lineStart + 0), 6, 'pattern 0 → 6');
    assert.equal(ula.contend(lineStart + 1), 5, 'pattern 1 → 5');
    assert.equal(ula.contend(lineStart + 2), 4, 'pattern 2 → 4');
    assert.equal(ula.contend(lineStart + 3), 3, 'pattern 3 → 3');
    assert.equal(ula.contend(lineStart + 4), 2, 'pattern 4 → 2');
    assert.equal(ula.contend(lineStart + 5), 1, 'pattern 5 → 1');
    assert.equal(ula.contend(lineStart + 6), 0, 'pattern 6 → 0');
    assert.equal(ula.contend(lineStart + 7), 0, 'pattern 7 → 0');
    // Repeats at offset 8
    assert.equal(ula.contend(lineStart + 8), 6, 'pattern wraps: 8 → 6');
});

test('contention: uncontended half of scan line returns 0', () => {
    const ula = new ZXULA(new Uint8Array(65536));
    const lineStart = 100 * 224; // well into active display
    assert.equal(ula.contend(lineStart + 128), 0, 'T-state 128 → 0');
    assert.equal(ula.contend(lineStart + 200), 0, 'T-state 200 → 0');
});

test('contention: border lines (top and bottom) return 0', () => {
    const ula = new ZXULA(new Uint8Array(65536));
    // Top border: line 0
    assert.equal(ula.contend(0), 0, 'line 0 → 0');
    assert.equal(ula.contend(63 * 224), 0, 'line 63 → 0');
    // Bottom border: line 256+
    assert.equal(ula.contend(256 * 224), 0, 'line 256 → 0');
});

test('contention: 128K timing (70908 T-states, 228/line)', () => {
    const ula = new ZXULA(new Uint8Array(65536), { frameTstates: 70908 });
    // 128K first contended line is 63, 228 T-states per line
    const lineStart = 63 * 228;
    assert.equal(ula.contend(lineStart + 0), 6, '128K pattern 0 → 6');
    assert.equal(ula.contend(lineStart + 7), 0, '128K pattern 7 → 0');
    // Uncontended half
    assert.equal(ula.contend(lineStart + 128), 0, '128K T-state 128 → 0');
});

// ─── Machine-level contention tests ──────────────────────────────

test('config.contention defaults OFF — no penalty', () => {
    const m = new Z80Machine({
        clockHz: 3_500_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }],
        ula: true,
        // contention NOT set
    }, {});
    assert.equal(m._contention, false);
});

test('contended loop takes more cycles than uncontended', () => {
    // Program: LD A,(HL) in a tight loop (7 T-states per iteration
    // without contention, more with). Run from $4000 (contended) vs
    // $8000 (uncontended).
    // LD A,(HL) = 0x7E, DJNZ = 0x10 0xFC (-4 → back to LD A,(HL))
    // LD B,N = 0x06 N
    const prog = [0x06, 0x20, 0x7e, 0x10, 0xfc, 0x76]; // LD B,32; loop: LD A,(HL); DJNZ loop; HALT

    function runAt(base, contention) {
        const m = new Z80Machine({
            clockHz: 3_500_000,
            regions: [{ kind: 'ram', start: 0, end: 0xffff }],
            ula: true,
            contention,
        }, {});
        m.mem.set(prog, base);
        m.cpu.pc = base;
        m.cpu.sp = 0xff00;
        m.cpu.hl = base + 0x100; // HL points into same contended/uncontended region
        // Position the ULA at the start of an active display line so
        // contention is maximally active
        m.cycles = 64 * 224; // line 64, T-state 0
        const startCycles = m.cycles;
        // Run until HALT
        for (let i = 0; i < 500; i++) {
            if (m.step() === 0) break;
        }
        return m.cycles - startCycles;
    }

    // Without contention: both should be identical
    const noContendContended = runAt(0x4000, false);
    const noContendUncontended = runAt(0x8000, false);
    assert.equal(noContendContended, noContendUncontended,
        'without contention flag, both regions take the same cycles');

    // With contention: $4000 should take MORE
    const withContendContended = runAt(0x4000, true);
    const withContendUncontended = runAt(0x8000, true);
    assert.equal(withContendUncontended, noContendUncontended,
        'uncontended region unchanged with contention on');
    assert.ok(withContendContended > withContendUncontended,
        `contended ($4000) should take more: ${withContendContended} vs ${withContendUncontended}`);

    // The difference should be significant (32 iterations × avg ~3 wait states)
    const overhead = withContendContended - withContendUncontended;
    assert.ok(overhead > 20,
        `contention overhead should be significant: ${overhead} T-states`);
});

test('port contention: IN $FE during active display adds penalty', () => {
    // Program at $8000 (uncontended code): IN A,($FE) + HALT
    // IN A,(n) = 0xDB n, HALT = 0x76
    const m = new Z80Machine({
        clockHz: 3_500_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }],
        ula: true,
        contention: true,
    }, {});
    m.mem[0x8000] = 0xdb; m.mem[0x8001] = 0xfe; m.mem[0x8002] = 0x76;
    m.cpu.pc = 0x8000;
    m.cpu.sp = 0xff00;
    // Position at active display for contention
    m.cycles = 64 * 224;
    const start = m.cycles;
    m.step(); // IN A,($FE) — 11 T-states base + contention
    const elapsed = m.cycles - start;

    // Without contention: IN A,(n) = 11 T-states
    const m2 = new Z80Machine({
        clockHz: 3_500_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }],
        ula: true,
        // contention: false (default)
    }, {});
    m2.mem[0x8000] = 0xdb; m2.mem[0x8001] = 0xfe; m2.mem[0x8002] = 0x76;
    m2.cpu.pc = 0x8000;
    m2.cpu.sp = 0xff00;
    m2.cycles = 64 * 224;
    const start2 = m2.cycles;
    m2.step();
    const elapsed2 = m2.cycles - start2;

    assert.ok(elapsed > elapsed2,
        `IN $FE with contention (${elapsed}) should take more than without (${elapsed2})`);
});
