// Branch predictors (src/uarch-predictor.js) on outcome sequences whose
// prediction counts are derived by hand in the comments.
//
// Mutations that go red here (measured when this was written): a bimodal or
// gshare whose update() never changes a counter (it then predicts not-taken
// forever) reds the loop and alternation counts; a gshare that ignores its
// history (index = pc only, i.e. bimodal) reds the alternation and TTTN cases;
// a BTB that ignores its tag reds the aliasing case.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPredictor, BranchTargetBuffer} from '../src/uarch-predictor.js';

/** Run one branch at `pc` through `outcomes` ('T'/'N'); returns the prediction string. */
function drive(p, outcomes, pc = 0x100) {
    let out = '';
    for (const o of outcomes) {
        const pred = p.predict(pc), taken = o === 'T';
        out += pred ? 'T' : 'N';
        p.update(pc, taken, pred);
    }
    return out;
}
const rep = (s, n) => s.repeat(n);

test('static not-taken: right exactly on the not-taken outcomes', () => {
    const p = createPredictor('static-nt');
    drive(p, rep('TTTN', 25));
    assert.deepEqual([p.stats.correct, p.stats.mispredicts], [25, 75]);
});

test('bimodal: a loop branch (TTTN) mispredicts once per trip after one extra at start', () => {
    const p = createPredictor({kind: 'bimodal', entries: 16});
    // Counter starts at 1 (weakly not-taken). First T: predicted N (miss), ->2.
    // Then T T hit (->3), N predicted T (miss, ->2); every later period: T T T
    // hit, N miss. 25 periods: 1 + 25 = 26 misses.
    const pred = drive(p, rep('TTTN', 25));
    assert.equal(pred.slice(0, 8), 'NTTTTTTT');
    assert.deepEqual([p.stats.predictions, p.stats.correct, p.stats.mispredicts], [100, 74, 26]);
    assert.equal(p.report().accuracy, 0.74);
});

test('bimodal: strict alternation defeats a 2-bit counter completely', () => {
    const p = createPredictor({kind: 'bimodal', entries: 16});
    // 1 -T-> 2 -N-> 1 -T-> 2 …: it always predicts the outcome just seen.
    assert.equal(drive(p, rep('TN', 50)), rep('NT', 50));
    assert.equal(p.stats.mispredicts, 100);
});

test('gshare: global history learns alternation after two misses', () => {
    const p = createPredictor({kind: 'gshare', entries: 16, historyBits: 2});
    // pc 0 -> index = history. b1 T @h0 (ctr 1: miss, ->2) h=1; b2 N @h1 (hit, ->0) h=2;
    // b3 T @h2 (miss, ->2) h=1; b4 N @h1 hit; b5 T @h2 (ctr 2: hit) … 2 misses in 100.
    const pred = drive(p, rep('TN', 50), 0);
    assert.equal(pred.slice(0, 6), 'NNNNTN');
    assert.equal(p.stats.mispredicts, 2);
});

test('gshare: a TTTN loop is learnt exactly once each history pattern is trained', () => {
    const p = createPredictor({kind: 'gshare', entries: 16, historyBits: 4});
    // Index = the last 4 outcomes (pc 0). Contexts met, in order, with their
    // counters starting at 1: 0000 T miss, 0001 T miss, 0011 T miss, 0111 N hit,
    // 1110 T miss, 1101 T miss, 1011 T miss, 0111 N hit — and from then on each
    // of the four steady contexts (1110, 1101, 1011 -> T; 0111 -> N) is trained.
    const pred = drive(p, rep('TTTN', 25), 0);
    assert.equal(pred.slice(0, 12), 'NNNNNNNNTTTN');
    assert.equal(p.stats.mispredicts, 6);
    assert.equal(pred.slice(8), rep('TTTN', 23), 'perfect after two periods');
});

test('predictors keep separate state per branch (by pc)', () => {
    const p = createPredictor({kind: 'bimodal', entries: 64});
    for (let i = 0; i < 4; i++) { p.update(0x100, true, p.predict(0x100)); p.update(0x104, false, p.predict(0x104)); }
    assert.equal(p.predict(0x100), true);
    assert.equal(p.predict(0x104), false);
});

test('BTB: remembers targets, tagged by the full pc (aliases evict, never mis-hit)', () => {
    const b = new BranchTargetBuffer({entries: 4});
    assert.equal(b.lookup(0x0), -1);
    b.update(0x0, 0x40);
    assert.equal(b.lookup(0x0), 0x40);
    // 0x8 indexes the same slot ((pc >>> 1) & 3 = 0): a lookup misses (tag), an update replaces.
    assert.equal(b.lookup(0x8), -1);
    b.update(0x8, 0x80);
    assert.equal(b.lookup(0x0), -1, 'evicted by the alias');
    assert.equal(b.lookup(0x8), 0x80);
    assert.deepEqual(b.stats, {lookups: 5, hits: 2});
});

test('unknown kinds and bad sizes are refused', () => {
    assert.throws(() => createPredictor('tage'), RangeError);
    assert.throws(() => createPredictor({kind: 'bimodal', entries: 100}), RangeError);
    assert.throws(() => new BranchTargetBuffer({entries: 3}), RangeError);
});
