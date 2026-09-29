// The cache timing model (src/uarch-cache.js) against a brute-force
// reference, and against closed-form miss counts.
//
// The reference below is written to be obviously right rather than fast: each
// set is an array of ways plus a list of way numbers in the order the policy
// ranks them (LRU: least recently used first; FIFO: filled first). Random
// replacement draws from the same seeded xorshift32, so all three policies are
// compared access by access — hit or miss, which line was evicted, whether it
// was dirty — on random traces of mixed reads and writes.
//
// Mutations that go red here (measured when this was written): a hit that
// does not refresh the LRU age (LRU silently becomes FIFO) reds the LRU
// cross-check and the LRU/FIFO split case; a store that does not set the dirty
// bit reds the write-back counts; an eviction that picks the NEWEST way reds
// both cross-checks.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CacheModel, CACHE_HIT} from '../src/uarch-cache.js';

class ReferenceCache {
    constructor({size, ways, line, replacement = 'lru', seed = 0x2545f491, writeAllocate = true}) {
        this.ways = ways; this.line = line; this.sets = size / (ways * line);
        this.replacement = replacement; this.writeAllocate = writeAllocate;
        this.set = Array.from({length: this.sets}, () => ({way: new Array(ways).fill(null), order: []}));
        this.seed = seed >>> 0 || 1;
    }
    rand() { let x = this.seed; x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; this.seed = x; return x; }
    access(addr, write) {
        const lineNo = Math.floor(addr / this.line), s = this.set[lineNo % this.sets];
        const w = s.way.findIndex(e => e && e.lineNo === lineNo);
        if (w >= 0) {
            if (this.replacement === 'lru') { s.order.splice(s.order.indexOf(w), 1); s.order.push(w); }
            if (write) s.way[w].dirty = true;
            return {hit: true, evicted: -1, writeback: false};
        }
        if (write && !this.writeAllocate) return {hit: false, evicted: -1, writeback: false};
        let v = s.way.indexOf(null), evicted = -1, writeback = false;
        if (v < 0) {
            v = this.replacement === 'random' ? this.rand() % this.ways : s.order[0];
            evicted = s.way[v].lineNo * this.line; writeback = s.way[v].dirty;
        }
        if (s.order.includes(v)) s.order.splice(s.order.indexOf(v), 1);
        s.order.push(v);
        s.way[v] = {lineNo, dirty: !!write};
        return {hit: false, evicted, writeback};
    }
}

function lcg(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0); }

for (const replacement of ['lru', 'fifo', 'random']) {
    for (const [size, ways, line] of [[256, 1, 16], [512, 2, 16], [1024, 4, 32], [256, 8, 8], [128, 8, 16]]) {
        test(`${replacement} ${size}B ${ways}-way ${line}B lines: every access agrees with the brute-force reference`, () => {
            for (const writeAllocate of [true, false]) {
                const cfg = {size, ways, line, replacement, writeAllocate, seed: 1234};
                const model = new CacheModel(cfg), ref = new ReferenceCache(cfg);
                const rnd = lcg(size * 31 + ways * 7 + line);
                // A working set a little larger than the cache, with locality:
                // mostly nearby lines, some far ones.
                const span = size * 3;
                let hits = 0, evictions = 0, writebacks = 0;
                for (let i = 0; i < 20_000; i++) {
                    const r = rnd();
                    const addr = (r & 7) < 6 ? (r >>> 8) % (size * 2) : (r >>> 4) % span;
                    const write = (r & 0x30) === 0x30;
                    const got = model.access(addr, write) === CACHE_HIT;
                    const want = ref.access(addr, write);
                    assert.equal(got, want.hit, `access ${i} (${addr}, ${write ? 'W' : 'R'}): hit`);
                    assert.equal(model.last.evicted, want.evicted, `access ${i}: evicted line`);
                    assert.equal(model.last.writeback, want.writeback, `access ${i}: write-back`);
                    if (want.hit) hits++;
                    if (want.evicted >= 0) evictions++;
                    if (want.writeback) writebacks++;
                }
                const s = model.stats;
                assert.equal(s.hits, hits); assert.equal(s.misses, 20_000 - hits);
                assert.equal(s.evictions, evictions); assert.equal(s.writebacks, writebacks);
                assert.ok(hits > 1000 && evictions > 1000, 'the trace exercised hits and evictions');
                if (writeAllocate) assert.ok(writebacks > 100, 'and dirty evictions');
            }
        });
    }
}

test('LRU and FIFO differ exactly where a hit should refresh the age', () => {
    // 2-way, one set in use: A B A C. LRU evicts B (A was just used); FIFO evicts A (filled first).
    const addrs = [0x000, 0x100, 0x000, 0x200, 0x000];
    const run = replacement => {
        const c = new CacheModel({size: 64, ways: 2, line: 16, replacement});   // 2 sets
        return addrs.map(a => c.access(a) === CACHE_HIT ? 'H' : 'M').join('');
    };
    assert.equal(run('lru'), 'MMHMH', 'LRU keeps A');
    assert.equal(run('fifo'), 'MMHMM', 'FIFO evicted A');
});

// ── closed-form miss counts ──

function walk(cache, base, bytes, stride, write = false) {
    for (let a = 0; a < bytes; a += stride) cache.access(base + a, write);
    return cache.stats;
}

test('a strided walk misses once per line, whatever the stride below a line', () => {
    for (const stride of [1, 2, 4, 8, 16]) {
        const c = new CacheModel({size: 1024, ways: 2, line: 16});
        const s = walk(c, 0x8000, 512, stride);
        assert.equal(s.misses, 512 / 16, `stride ${stride}: one compulsory miss per 16-byte line`);
        assert.equal(s.accesses, 512 / stride);
        // The array fits (512 < 1024): a second pass is all hits.
        c.resetStats();
        assert.equal(walk(c, 0x8000, 512, stride).misses, 0, `stride ${stride}: second pass hits`);
    }
    // A stride of a line or more: every access misses.
    const c = new CacheModel({size: 1024, ways: 2, line: 16});
    assert.equal(walk(c, 0, 2048, 32).misses, 64);
});

test('an array larger than an LRU cache: the second pass misses every line again', () => {
    const c = new CacheModel({size: 1024, ways: 4, line: 16});
    walk(c, 0, 2048, 4);
    c.resetStats();
    const s = walk(c, 0, 2048, 4);
    // Sequential over 2x the capacity: by the time a line is reused, LRU has
    // evicted it (the classic LRU pathology), so every line misses again.
    assert.equal(s.misses, 2048 / 16);
    assert.equal(s.hits, 2048 / 4 - 2048 / 16);
});

test('a 32x32 word matrix: row-major touches each line once, column-major thrashes a small cache', () => {
    const N = 32, rowBytes = N * 4;           // 128-byte rows, 4 KiB matrix
    const rowMajor = cfg => { const c = new CacheModel(cfg); for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) c.access(i * rowBytes + j * 4); return c.stats.misses; };
    const colMajor = cfg => { const c = new CacheModel(cfg); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) c.access(i * rowBytes + j * 4); return c.stats.misses; };
    const small = {size: 1024, ways: 1, line: 16};   // 64 sets
    // Row-major: 4 KiB / 16 B = 256 lines, each missed once.
    assert.equal(rowMajor(small), 256);
    // Column-major: element (i, j) is line 8i + j/4, set (8i + j/4) mod 64 —
    // only 8 distinct sets for a column, 32 lines each column, so every line
    // is evicted before its next word is used: all 1024 accesses miss.
    assert.equal(colMajor(small), 1024);
    // 4-way, same size (16 sets): a column uses sets {j/4, j/4 + 8} x 4 ways
    // = 8 lines for 32 — still every access misses.
    assert.equal(colMajor({size: 1024, ways: 4, line: 16}), 1024);
    // A cache that holds the matrix: column-major misses each line once too.
    assert.equal(colMajor({size: 8192, ways: 2, line: 16}), 256);
    // Blocking (8x8 tiles, the loop-order lesson): a tile's 8 rows x 2 lines
    // fit, so the 4 KiB matrix costs its 256 compulsory misses even in the small cache.
    const c = new CacheModel({size: 1024, ways: 2, line: 16});
    for (let bj = 0; bj < N; bj += 8) for (let bi = 0; bi < N; bi += 8)
        for (let j = bj; j < bj + 8; j++) for (let i = bi; i < bi + 8; i++) c.access(i * rowBytes + j * 4);
    assert.equal(c.stats.misses, 256);
});

test('write-back + write-allocate: a written line costs one write-back when it leaves', () => {
    const c = new CacheModel({size: 256, ways: 1, line: 16});   // 16 sets, direct-mapped
    walk(c, 0, 256, 4, true);                                   // write the whole cache
    assert.deepEqual([c.stats.writeMisses, c.stats.writebacks], [16, 0], 'allocated, nothing written back yet');
    walk(c, 256, 256, 16, false);                               // read a conflicting 256 bytes
    assert.equal(c.stats.writebacks, 16, 'every dirty line written back on eviction');
    walk(c, 512, 256, 16, false);
    assert.equal(c.stats.writebacks, 16, 'clean lines leave for free');
    const na = new CacheModel({size: 256, ways: 1, line: 16, writeAllocate: false});
    walk(na, 0, 256, 4, true);
    assert.deepEqual([na.stats.writeMisses, na.stats.evictions, na.contains(0)], [64, 0, false], 'no-allocate: nothing filled');
});

test('geometry is refused, not rounded', () => {
    assert.throws(() => new CacheModel({size: 1000}), RangeError);
    assert.throws(() => new CacheModel({size: 64, ways: 8, line: 16}), RangeError);
    assert.throws(() => new CacheModel({replacement: 'plru'}), RangeError);
    const c = new CacheModel({size: 4096, ways: 4, line: 32});
    assert.equal(c.sets, 32);
});
