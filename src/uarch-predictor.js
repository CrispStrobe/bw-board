/**
 * Branch predictors and a branch target buffer (E8.3) — timing models only.
 * They guess; the functional core decides. A wrong guess costs cycles in the
 * pipeline model (uarch-pipeline.js), never a different result.
 *
 * DIRECTION predictors (conditional branches), each `predict(pc) -> boolean`
 * then `update(pc, taken)` with the real outcome:
 *   static-nt — always "not taken". No state; the baseline.
 *   bimodal   — a table of 2-bit saturating counters indexed by pc. 0,1 say
 *               not-taken, 2,3 say taken; a taken branch counts up, a
 *               not-taken one down. Counters start at 1 (weakly not-taken).
 *   gshare    — the same counters, indexed by pc XOR a global history of the
 *               last `historyBits` outcomes (1 = taken, newest in bit 0), so a
 *               branch's pattern and its neighbours' outcomes pick the counter.
 * The index uses pc >>> 1: with the C extension a branch may sit on any
 * halfword.
 *
 * The BTB (branch target buffer) remembers where a taken branch or jump went:
 * direct-mapped, `entries` slots, tagged with the full pc. The front end can
 * only redirect fetch at IF when the BTB supplies the target.
 *
 * Updates here are immediate and in trace order (a trace-driven model knows
 * every earlier outcome); a real pipeline updates at resolution, a few cycles
 * later. The difference is stated, not hidden: on tight loops a real gshare
 * sees slightly staler history than this one.
 *
 * test/uarch-predictor.test.mjs drives each predictor with known sequences
 * (loops, alternation) whose hit counts are derived by hand.
 *
 * @module
 */

const isPow2 = n => Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;

class DirectionStats {
    constructor() { this.resetStats(); }
    resetStats() { this.stats = {predictions: 0, correct: 0, mispredicts: 0}; }
    _count(pred, taken) {
        this.stats.predictions++;
        if (pred === taken) this.stats.correct++; else this.stats.mispredicts++;
    }
    report() {
        const s = this.stats;
        return {...s, accuracy: s.predictions ? s.correct / s.predictions : 1, kind: this.kind, config: this.config()};
    }
}

export class StaticNotTaken extends DirectionStats {
    get kind() { return 'static-nt'; }
    config() { return {}; }
    predict() { return false; }
    /** Record the outcome of a prediction (the stats), nothing to learn. */
    update(pc, taken, pred) { this._count(pred, taken); }
}

export class Bimodal extends DirectionStats {
    constructor({entries = 512} = {}) {
        super();
        if (!isPow2(entries)) throw new RangeError(`bimodal entries must be a power of two (${entries})`);
        this.entries = entries;
        this.table = new Uint8Array(entries).fill(1);
    }
    get kind() { return 'bimodal'; }
    config() { return {entries: this.entries}; }
    _index(pc) { return (pc >>> 1) & (this.entries - 1); }
    predict(pc) { return this.table[this._index(pc)] >= 2; }
    update(pc, taken, pred) {
        this._count(pred, taken);
        const i = this._index(pc), c = this.table[i];
        this.table[i] = taken ? (c < 3 ? c + 1 : 3) : (c > 0 ? c - 1 : 0);
    }
}

export class Gshare extends DirectionStats {
    constructor({entries = 1024, historyBits = 8} = {}) {
        super();
        if (!isPow2(entries)) throw new RangeError(`gshare entries must be a power of two (${entries})`);
        if (!(historyBits >= 0 && historyBits <= 30)) throw new RangeError(`gshare historyBits out of range (${historyBits})`);
        this.entries = entries;
        this.historyBits = historyBits;
        this.table = new Uint8Array(entries).fill(1);
        this.history = 0;
    }
    get kind() { return 'gshare'; }
    config() { return {entries: this.entries, historyBits: this.historyBits}; }
    _index(pc) { return ((pc >>> 1) ^ this.history) & (this.entries - 1); }
    predict(pc) { return this.table[this._index(pc)] >= 2; }
    update(pc, taken, pred) {
        this._count(pred, taken);
        const i = this._index(pc), c = this.table[i];
        this.table[i] = taken ? (c < 3 ? c + 1 : 3) : (c > 0 ? c - 1 : 0);
        this.history = ((this.history << 1) | (taken ? 1 : 0)) & ((1 << this.historyBits) - 1);
    }
}

export class BranchTargetBuffer {
    constructor({entries = 64} = {}) {
        if (!isPow2(entries)) throw new RangeError(`BTB entries must be a power of two (${entries})`);
        this.entries = entries;
        this._tag = new Int32Array(entries).fill(-1);
        this._target = new Int32Array(entries);
        this.resetStats();
    }
    resetStats() { this.stats = {lookups: 0, hits: 0}; }
    _index(pc) { return (pc >>> 1) & (this.entries - 1); }
    /** The remembered target for `pc`, or -1. Counts a lookup. */
    lookup(pc) {
        this.stats.lookups++;
        const i = this._index(pc);
        if (this._tag[i] === (pc | 0)) { this.stats.hits++; return this._target[i] >>> 0; }
        return -1;
    }
    /** Remember that the control transfer at `pc` went to `target`. */
    update(pc, target) { const i = this._index(pc); this._tag[i] = pc | 0; this._target[i] = target | 0; }
    report() {
        const s = this.stats;
        return {...s, hitRate: s.lookups ? s.hits / s.lookups : 0, config: {entries: this.entries}};
    }
}

/** Build a direction predictor from a config: {kind, entries?, historyBits?}. */
export function createPredictor(cfg = {kind: 'static-nt'}) {
    const kind = typeof cfg === 'string' ? cfg : (cfg.kind ?? 'static-nt');
    const opts = typeof cfg === 'string' ? {} : cfg;
    if (kind === 'static-nt') return new StaticNotTaken();
    if (kind === 'bimodal') return new Bimodal(opts);
    if (kind === 'gshare') return new Gshare(opts);
    throw new RangeError(`unknown branch predictor '${kind}' (static-nt, bimodal, gshare)`);
}
