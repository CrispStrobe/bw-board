/**
 * A set-associative cache TIMING model (E8.2) — it holds tags, not data. The
 * functional core owns every byte; this model only answers "would this access
 * have hit?" and counts what happened, so it can never change a program's
 * result.
 *
 * Geometry: `size` bytes = sets × ways × line. The address splits into
 * [ tag | set index | line offset ]: offset = low log2(line) bits, index = the
 * next log2(sets) bits, tag = the rest. All three sizes must be powers of two.
 *
 * Policy: write-back + write-allocate (the textbook default). A store that
 * misses first fills the line (allocate), then marks it dirty; a dirty line
 * that is evicted costs a write-back. `writeAllocate: false` makes a store miss
 * go straight to memory without filling (write-no-allocate).
 *
 * Replacement, per set:
 *   lru    — evict the way used longest ago (a hit refreshes its age);
 *   fifo   — evict the way filled longest ago (a hit changes nothing);
 *   random — evict a way chosen by a seeded xorshift32 (reproducible).
 * An empty (invalid) way is always filled before anything is evicted.
 *
 * `access(addr, isWrite)` returns an outcome code and leaves the details of
 * the last access in `last` ({hit, set, way, evicted: line address | -1,
 * writeback}). An access that straddles two lines is the CALLER's to split
 * (`accessRange` does it). Stats are plain counters, reset by `resetStats()`
 * without touching the contents (a region of interest over warm caches).
 *
 * test/uarch-cache.test.mjs cross-checks every access outcome against a
 * brute-force reference (per-set lists kept in recency order) on random
 * traces, for every policy.
 *
 * @module
 */

const isPow2 = n => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
const log2 = n => 31 - Math.clz32(n);

export const CACHE_HIT = 0, CACHE_MISS = 1;

export class CacheModel {
    /**
     * @param {{name?: string, size?: number, ways?: number, line?: number,
     *          replacement?: 'lru'|'fifo'|'random', writeAllocate?: boolean,
     *          seed?: number}} [cfg]
     */
    constructor(cfg = {}) {
        const size = cfg.size ?? 4096, ways = cfg.ways ?? 2, line = cfg.line ?? 16;
        if (!isPow2(size) || !isPow2(ways) || !isPow2(line)) {
            throw new RangeError(`cache geometry must be powers of two (size ${size}, ways ${ways}, line ${line})`);
        }
        if (size < ways * line) throw new RangeError(`cache of ${size} bytes cannot hold ${ways} ways of ${line}-byte lines`);
        const replacement = cfg.replacement ?? 'lru';
        if (!['lru', 'fifo', 'random'].includes(replacement)) throw new RangeError(`unknown replacement policy '${replacement}'`);
        this.name = cfg.name ?? 'cache';
        this.size = size; this.ways = ways; this.line = line;
        this.sets = size / (ways * line);
        this.replacement = replacement;
        this.writeAllocate = cfg.writeAllocate !== false;
        this._offBits = log2(line);
        this._setMask = this.sets - 1;
        const n = this.sets * ways;
        this._tag = new Int32Array(n);         // line number (addr >>> offBits) + 1; 0 = invalid
        this._dirty = new Uint8Array(n);
        this._stamp = new Float64Array(n);     // lru: last use; fifo: fill time
        this._clock = 0;
        this._seed = (cfg.seed ?? 0x2545f491) >>> 0 || 1;
        this.last = {hit: false, set: 0, way: -1, evicted: -1, writeback: false};
        this.resetStats();
    }

    resetStats() {
        this.stats = {accesses: 0, reads: 0, writes: 0, hits: 0, misses: 0,
            readMisses: 0, writeMisses: 0, evictions: 0, writebacks: 0};
    }

    /** Forget every line (a cold cache). Stats are kept. */
    invalidateAll() { this._tag.fill(0); this._dirty.fill(0); this._stamp.fill(0); }

    _rand() {
        let x = this._seed;
        x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
        this._seed = x;
        return x;
    }

    /** One access to the line holding `addr`. Returns CACHE_HIT or CACHE_MISS. */
    access(addr, isWrite = false) {
        const lineNo = (addr >>> 0) >>> this._offBits;
        const set = lineNo & this._setMask;
        const base = set * this.ways, key = lineNo + 1;
        const st = this.stats, last = this.last;
        st.accesses++;
        if (isWrite) st.writes++; else st.reads++;
        this._clock++;
        last.set = set; last.evicted = -1; last.writeback = false;
        for (let w = 0; w < this.ways; w++) {
            if (this._tag[base + w] === key) {
                st.hits++;
                if (this.replacement === 'lru') this._stamp[base + w] = this._clock;
                if (isWrite) this._dirty[base + w] = 1;
                last.hit = true; last.way = w;
                return CACHE_HIT;
            }
        }
        st.misses++;
        if (isWrite) st.writeMisses++; else st.readMisses++;
        last.hit = false;
        if (isWrite && !this.writeAllocate) { last.way = -1; return CACHE_MISS; }
        // Victim: the first invalid way, else by policy.
        let victim = -1;
        for (let w = 0; w < this.ways; w++) if (this._tag[base + w] === 0) { victim = w; break; }
        if (victim < 0) {
            if (this.replacement === 'random') victim = this._rand() % this.ways;
            else {
                victim = 0;
                for (let w = 1; w < this.ways; w++) if (this._stamp[base + w] < this._stamp[base + victim]) victim = w;
            }
            const i = base + victim;
            st.evictions++;
            last.evicted = ((this._tag[i] - 1) << this._offBits) >>> 0;
            if (this._dirty[i]) { st.writebacks++; last.writeback = true; }
        }
        const i = base + victim;
        this._tag[i] = key;
        this._dirty[i] = isWrite ? 1 : 0;
        this._stamp[i] = this._clock;
        last.way = victim;
        return CACHE_MISS;
    }

    /** Access every line that [addr, addr+size) touches. Returns the number
     *  of those line accesses that missed, and how many dirty lines they
     *  evicted, as {lines, misses, writebacks}. */
    accessRange(addr, size, isWrite = false) {
        const first = (addr >>> 0) >>> this._offBits, lastLine = ((addr >>> 0) + Math.max(1, size) - 1) >>> this._offBits;
        let misses = 0, writebacks = 0, lines = 0;
        for (let l = first; l <= lastLine; l++) {
            lines++;
            if (this.access((l << this._offBits) >>> 0, isWrite) === CACHE_MISS) misses++;
            if (this.last.writeback) writebacks++;
        }
        return {lines, misses, writebacks};
    }

    /** Is the line holding `addr` present? (No side effects: stats, ages untouched.) */
    contains(addr) {
        const lineNo = (addr >>> 0) >>> this._offBits, base = (lineNo & this._setMask) * this.ways;
        for (let w = 0; w < this.ways; w++) if (this._tag[base + w] === lineNo + 1) return true;
        return false;
    }

    /** The contents of one set, oldest first by the policy's age, for a view:
     *  [{way, line (address), dirty, age}] of the valid ways. */
    setContents(set) {
        const out = [];
        for (let w = 0; w < this.ways; w++) {
            const i = set * this.ways + w;
            if (this._tag[i] !== 0) out.push({way: w, line: ((this._tag[i] - 1) << this._offBits) >>> 0,
                dirty: this._dirty[i] === 1, age: this._clock - this._stamp[i]});
        }
        return out;
    }

    /** Stats plus the derived rates, named as the view shows them. */
    report() {
        const s = this.stats;
        return {...s, missRate: s.accesses ? s.misses / s.accesses : 0,
            config: {size: this.size, ways: this.ways, line: this.line, sets: this.sets,
                replacement: this.replacement, writeAllocate: this.writeAllocate}};
    }
}

export default CacheModel;
