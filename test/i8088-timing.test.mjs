/**
 * The cycle-prediction API over the generated 8088 tables.
 *
 * Like test/i8088-cycles.test.mjs this runs WITHOUT the 677 MB oracle, so it
 * asserts contract rather than accuracy. Accuracy is scripts/check-i8088-cycles.mjs
 * (95.82% in-sample) and the pilot's held-out 95.6%; neither can run in CI.
 *
 * The property that matters most here is the NULL CONTRACT. A missing table
 * entry means "never measured", and the one thing the API must never do is
 * turn that into a plausible-looking number -- that is how an unmeasured case
 * silently becomes an asserted one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { predictCycles, covered, PROVENANCE } from '../src/i8088-timing.js';

test('an unmeasured case returns null, never a number', () => {
    //                        opcode, queue, length, accesses, slot, taken, ax, cx
    // Unknown opcode.
    assert.equal(predictCycles('ZZ', 4, 1, 0, 32, false, 0, 0), null);
    // Known opcode, impossible state: a 9-byte instruction with 9 accesses.
    assert.equal(predictCycles('01', 9, 9, 9, 0, false, 0, 0), null);
    // Known opcode, plausible-but-absent key.
    assert.equal(predictCycles('90', 4, 1, 7, 32, false, 0, 0), null);
});

test('a measured case returns a positive integer', () => {
    const n = predictCycles('90', 4, 1, 0, 32, false, 0, 0);
    assert.ok(Number.isInteger(n) && n > 0, `NOP predicted ${n}`);
});

test('covered() agrees with what predictCycles can answer', () => {
    assert.equal(covered('01'), true);
    assert.equal(covered('ZZ'), false);
    // If covered() says yes, an unknown-opcode null must not be the reason a
    // prediction failed -- otherwise callers cannot tell "bad opcode" from
    // "state never measured", which are different bugs.
    assert.equal(predictCycles('ZZ', 0, 1, 0, 32, false, 0, 0), null);
});

test('MUL is CATEGORICAL in popcount(AX), and the feature reaches the lookup', () => {
    // table key m=25 is mod=3/rm=1; F7 /4 means reg=4, so modrm = 0b11_100_001.
    // slot for modrm 0xE1: (3 << 3) | 1 = 25
    const at = (ax) => predictCycles('F7.4', 4, 3, 0, 25, false, ax, 0);
    // ASSERT THE CASE IS EXERCISABLE FIRST. An earlier version of this test
    // guarded the comparison with `if (a !== null && b !== null)`, and both
    // WERE null -- so it passed while asserting nothing at all. A check that
    // cannot run must fail, not pass quietly.
    const p4 = at(0x000f), p6 = at(0x003f), p9 = at(0x01ff);
    for (const [n, v] of [[4, p4], [6, p6], [9, p9]]) {
        assert.notEqual(v, null,
            `popcount ${n} is not in the table -- this test is asserting nothing`);
    }
    // MUL's microcode loops over AX adding on each 1 bit: one cycle per bit.
    assert.equal(p6 - p4, 2, `popcount 4 -> ${p4}, 6 -> ${p6}: expected +1 cycle per set bit`);
    assert.equal(p9 - p6, 3, `popcount 6 -> ${p6}, 9 -> ${p9}: expected +1 cycle per set bit`);
});

test('shift by CL is LINEAR at 4 cycles per count', () => {
    // slot for modrm 0xE0: (3 << 3) | 0 = 24
    const sh = (cl) => predictCycles('D3.0', 4, 2, 0, 24, false, 0, cl);
    const one = sh(1), five = sh(5);
    assert.notEqual(one, null, 'cl=1 is not in the table -- this test is asserting nothing');
    assert.notEqual(five, null, 'cl=5 is not in the table -- this test is asserting nothing');
    // The slope, not merely that they differ: "differs" would still pass if
    // the term had been modelled categorically, which scores 57% and is wrong.
    assert.equal(five - one, 16,
        `shift by CL must cost 4 cycles per count: cl=1 -> ${one}, cl=5 -> ${five}`);
});

test('provenance is re-exported so callers can trace a number back', () => {
    assert.ok(PROVENANCE.vectors && PROVENANCE.source);
});
