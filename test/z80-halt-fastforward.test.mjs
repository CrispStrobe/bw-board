// HALT fast-forward: a halted Z80 burned 4 cycles per machine step —
// a ZX game HALTing for the 50 Hz frame interrupt (the Spectrum's
// standard pacing idiom) crawled ~17,500 iterations per frame, costing
// more than a running CPU. The machine now jumps a halted CPU to the
// nearest chip that can actually assert INT (ULA frame, IE-enabled CTC
// channels, TMS9918 VBLANK-with-IE); chips that advance but cannot name
// a horizon veto the jump. Foreign firmware benefits with no changes.
//
// Deterministic (machine steps, not wall-clock) — the three-machine
// load-sensitivity rule.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Z80Machine } from '../src/z80-machine.js';

// IM1 handler at $38: EI; RETI. Program at $100: IM 1; EI; loop: HALT; JR loop.
// One INC HL per wake would need more bytes; the step count carries the proof.
const make = () => {
    const m = new Z80Machine({ clockHz: 3_500_000, regions: [{ kind: 'ram', start: 0, end: 0xffff }], ula: true }, {});
    const img = new Uint8Array(0x200);
    img.set([0xfb, 0xed, 0x4d], 0x38);                    // EI; RETI
    img.set([0xed, 0x56, 0xfb, 0x76, 0x18, 0xfd], 0x100); // IM 1; EI; HALT; JR -3
    m.load(img, 0);
    m.cpu.pc = 0x100; m.cpu.sp = 0xff00;
    return m;
};

test('a halted Z80 jumps to the frame interrupt instead of crawling', () => {
    const m = make();
    let steps = 0;
    const orig = m.step.bind(m);
    m.step = () => { steps++; return orig(); };
    m.advanceToMs(1000); // 3.5M cycles, ~50 ULA frames
    assert.ok(m.cycles >= 3_400_000, `time advanced (${m.cycles})`);
    // parked: ~10 machine steps per frame (jump, INT delivery, EI/RETI,
    // JR, HALT). Crawling was ~17,500 per frame.
    assert.ok(steps < 5000, `parked, not crawling: ${steps} steps for ~50 frames`);
    // and the interrupt is genuinely taken once per frame: ~10 steps per
    // frame means the EI/RETI handler ran (an untaken INT would leave the
    // CPU parked through the whole second in a handful of jumps)
    assert.ok(steps > 250, `the frame interrupt is delivered (${steps} steps)`);
});

test('the veto: an advancing chip without a horizon forces the crawl', () => {
    const m = make();
    m.chips.opaque = { advance () {} };
    let steps = 0;
    const orig = m.step.bind(m);
    m.step = () => { steps++; return orig(); };
    m.advanceToMs(100);
    assert.ok(steps > 50_000, `the veto crawls (${steps} steps)`);
});

test('DI + HALT still deadlocks honestly, but cheaply', () => {
    const m = new Z80Machine({ clockHz: 3_500_000, regions: [{ kind: 'ram', start: 0, end: 0xffff }], ula: true }, {});
    const img = new Uint8Array(0x110);
    img.set([0xf3, 0x76], 0x100); // DI; HALT — nothing can ever wake this
    m.load(img, 0);
    m.cpu.pc = 0x100; m.cpu.sp = 0xff00;
    let steps = 0;
    const orig = m.step.bind(m);
    m.step = () => { steps++; return orig(); };
    m.advanceToMs(1000);
    assert.ok(m.cpu.halted, 'still halted — the deadlock is real, as on silicon');
    assert.ok(m.cycles >= 3_400_000, 'time still passes');
    assert.ok(steps < 5000, `and passes cheaply (${steps} steps)`);
});
