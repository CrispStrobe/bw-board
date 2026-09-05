/**
 * Cycle-accurate timing wired into the machine, opt-in.
 *
 * Hermetic: asserts the CONTRACT, not the accuracy. Accuracy needs the 677 MB
 * oracle (98.00% held out, 98.23% in-sample) and cannot run here.
 *
 * The properties that matter are the ones with no symptom when broken: an
 * unmeasured case must fall back rather than guess, a desynchronised queue
 * must stop predicting rather than predict from a stale value, and the 186
 * must be refused rather than quietly given 8088 numbers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, PCXT8086, TIERA8088 } from '../src/i8086-machine.js';
import { I8086 } from '../src/i8086.js';

// mov ax,0 / inc ax / inc ax / dec ax / xor ax,ax / jmp -10
const LOOP = [0xb8, 0x00, 0x00, 0x40, 0x40, 0x48, 0x33, 0xc0, 0xeb, 0xf6];

function machineWithLoop(cfg = PCXT8086) {
    const m = new I8086Machine(cfg);
    const base = I8086.phys(m.cpu.cs, m.cpu.ip);
    for (let i = 0; i < LOOP.length; i++) m.mem[base + i] = LOOP[i];
    return m;
}

test('off by default, and reports nothing rather than zero', () => {
    const m = machineWithLoop();
    assert.equal(m.cycleTimingStats(), null,
        'a machine that was never opted in must report null, not a zeroed record '
        + 'that reads as "measured, and nothing happened"');
    for (let i = 0; i < 200; i++) m.step();
    assert.equal(m.cycleTimingStats(), null);
});

test('predicts nearly every instruction of a branching loop', () => {
    const m = machineWithLoop();
    assert.equal(m.enableI8088CycleTiming(), true);
    for (let i = 0; i < 4000; i++) m.step();
    const s = m.cycleTimingStats();
    assert.ok(s.coverage > 0.98,
        `coverage ${(100 * s.coverage).toFixed(1)}% -- predicted ${s.predicted}, `
        + `fell back ${s.fellBack}`);
    assert.ok(s.resyncs >= 1, 'the loop takes a branch, so it must have resynced');
});

test('a machine with NO branches never syncs, and says so instead of guessing', () => {
    // Empty memory executes opcode 0x00 forever: no branch, so the queue is
    // never known. The honest outcome is total fallback, not a plausible
    // number derived from an assumed queue.
    const m = new I8086Machine(PCXT8086);
    m.enableI8088CycleTiming();
    for (let i = 0; i < 500; i++) m.step();
    const s = m.cycleTimingStats();
    assert.equal(s.predicted, 0, 'nothing can be predicted from an unknown queue');
    assert.equal(s.coverage, 0);
    assert.equal(s.desynced, true);
});

test('cycles charged in timed mode stay plausible against the core', () => {
    // Not an accuracy assertion -- the tables disagree with the core by design,
    // that is the point. But an order-of-magnitude divergence would mean the
    // lookup is returning something that is not a cycle count.
    const plain = machineWithLoop();
    for (let i = 0; i < 3000; i++) plain.step();
    const timed = machineWithLoop();
    timed.enableI8088CycleTiming();
    for (let i = 0; i < 3000; i++) timed.step();
    const ratio = timed.cycles / plain.cycles;
    assert.ok(ratio > 0.5 && ratio < 2.5,
        `timed charged ${timed.cycles} against the core's ${plain.cycles} `
        + `(ratio ${ratio.toFixed(2)}) -- that is not a disagreement, that is a bug`);
});

test('the 80186 is REFUSED, not silently given 8088 numbers', () => {
    // The tables came from an AMD D8088. The 186 changed instruction timings
    // and the queue, and no 186 oracle exists. A silent fallback here would
    // read as support for a variant that was never measured.
    const m = new I8086Machine({ ...TIERA8088, variant: '80186' });
    assert.throws(() => m.enableI8088CycleTiming(), /80186/,
        'enabling 8088 tables on a 186 must throw');
    assert.equal(m.cycleTimingStats(), null, 'and must not half-enable');
});

test('disabling restores the untimed path', () => {
    const m = machineWithLoop();
    m.enableI8088CycleTiming();
    for (let i = 0; i < 500; i++) m.step();
    assert.ok(m.cycleTimingStats().predicted > 0);
    assert.equal(m.enableI8088CycleTiming(false), false);
    assert.equal(m.cycleTimingStats(), null);
    const before = m.cycles;
    for (let i = 0; i < 100; i++) m.step();
    assert.ok(m.cycles > before, 'the machine still runs with timing off');
});
