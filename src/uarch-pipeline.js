/**
 * A classic 5-stage in-order pipeline TIMING model (E8.1) — IF ID EX MEM WB,
 * one instruction per stage, driven by the retired-instruction trace
 * (riscv32-trace.js). It charges cycles; it never executes anything.
 *
 * THE MACHINE IT MODELS (Patterson & Hennessy's pipeline, stated so a hand
 * calculation can reproduce every number):
 *   - Each stage takes one cycle unless a latency says more: IF 1 + I-cache
 *     miss cycles, EX `mulLatency` for MUL/MULH*, `divLatency` for DIV/REM,
 *     MEM 1 + D-cache miss cycles. A multi-cycle stage keeps working while it
 *     waits (a miss or a divide overlaps with a freeze from further down).
 *   - A STALL FREEZES the stalled stage and every stage before it; the stage
 *     after it receives a bubble that remembers why it was born. Bubbles are
 *     never squeezed out, so every cycle in which WB retires nothing is one
 *     bubble with one reason, and exactly:
 *         cycles = instructions + fill + Σ stall[reason]
 *     (fill = the 4 cycles before the first WB). Reasons:
 *       loaduse — a consumer waits for a load's value (forwarding on);
 *       raw     — any other read-after-write wait (all of them, forwarding
 *                 off; with forwarding, only a branch resolved in ID);
 *       muldiv  — EX is busy with a multi-cycle multiply/divide;
 *       icache / dcache — a miss holds IF / MEM;
 *       control — fetch waits for a branch/jump to be resolved (wrong-path
 *                 fetches are squashed: the model shows them as bubbles);
 *       trap    — a trap, or an instruction that changes the pc outside the
 *                 branch rules (mret/sret), is taken when it leaves MEM; its
 *                 own WB slot is counted here too (it retires nothing).
 *   - DATA HAZARDS are checked for the instruction in ID against the
 *     youngest older writer of each source register still in EX/MEM/WB.
 *     With forwarding: an ALU result can be used by the EX stage the cycle
 *     after the producer's (last) EX cycle; a load's (or AMO's) the cycle
 *     after its MEM — the one load-use bubble. Without forwarding a value is
 *     read in ID during the producer's WB cycle (the register file writes in
 *     the first half-cycle, reads in the second): back-to-back dependants
 *     cost two bubbles. Stores wait for both sources (the textbook hazard
 *     unit does not special-case store data).
 *   - CONTROL: every fetched instruction gets a predicted next pc. A branch
 *     asks the direction predictor; a predicted-taken branch redirects at IF
 *     when the BTB supplies its target, else at the end of ID (decode knows
 *     the target). jal redirects at IF on a BTB hit, else at the end of ID;
 *     jalr at IF on a correct BTB hit, else when resolved. A wrong guess is
 *     corrected when the branch leaves its resolve stage (`branchResolve`,
 *     EX by default: two bubbles; ID: one, but a branch then needs its
 *     operands a stage earlier). The next correct instruction is fetched the
 *     cycle after.
 *
 * USE: `const p = new PipelineModel(cfg); p.push(rec)…; p.finish()`. Records
 * may arrive one at a time (from a live core); the model simulates as far as
 * it can and waits for the next record. `report()` has the named stats
 * (gem5-style, E8.4); `occupancy()` the per-cycle stage record of the last
 * `recordCycles` cycles for the pipeline diagram.
 *
 * test/uarch-pipeline.test.mjs holds hand-derived cycle counts for small
 * kernels, exactly; mutations of forwarding, the load-use stall, predictor
 * updates and cache replacement each turn it red.
 *
 * @module
 */

import {CacheModel} from './uarch-cache.js';
import {createPredictor, BranchTargetBuffer} from './uarch-predictor.js';

export const STAGES = Object.freeze(['IF', 'ID', 'EX', 'MEM', 'WB']);
const IF = 0, ID = 1, EX = 2, MEM = 3, WB = 4;
export const STALL_REASONS = Object.freeze(['loaduse', 'raw', 'muldiv', 'icache', 'dcache', 'control', 'trap']);
const REASON = [null, 'fill', 'drain', ...STALL_REASONS, 'frozen'];
const CODE = Object.fromEntries(REASON.map((r, i) => [r, i]));

/** Default configuration. Every field can be overridden. */
export const PIPELINE_DEFAULTS = Object.freeze({
    forwarding: true,
    branchResolve: 'EX',          // 'EX' | 'ID'
    mulLatency: 3,                // EX cycles for MUL/MULH/MULHSU/MULHU
    divLatency: 16,               // EX cycles for DIV/DIVU/REM/REMU
    predictor: {kind: 'static-nt'},
    btb: null,                    // {entries} or null (no BTB)
    icache: null,                 // CacheModel config or null (a perfect, 1-cycle fetch)
    dcache: null,                 // CacheModel config or null
    missPenalty: 10,              // extra cycles to fill a line from memory
    writebackPenalty: 0,          // extra cycles to write a dirty victim back (0: a write buffer hides it)
    recordCycles: 256             // how many recent cycles occupancy() keeps
});

export class PipelineModel {
    constructor(cfg = {}) {
        const c = {...PIPELINE_DEFAULTS, ...cfg};
        if (c.branchResolve !== 'EX' && c.branchResolve !== 'ID') throw new RangeError(`branchResolve must be 'EX' or 'ID' (${c.branchResolve})`);
        this.cfg = c;
        this.predictor = createPredictor(c.predictor);
        this.btb = c.btb ? new BranchTargetBuffer(c.btb) : null;
        this.icache = c.icache ? new CacheModel({name: 'icache', ...c.icache}) : null;
        this.dcache = c.dcache ? new CacheModel({name: 'dcache', ...c.dcache}) : null;
        this._resolve = c.branchResolve === 'ID' ? ID : EX;
        // Stage contents: an entry {rec, lat, acc, ...} or null (a bubble whose reason is in _bub).
        this._slot = [null, null, null, null, null];
        this._bub = ['fill', 'fill', 'fill', 'fill', 'fill'];
        this._queue = [];
        this._qHead = 0;
        this._needFetch = true;       // IF is free and waiting for the next record
        this._block = null;           // {seq, stage, reason}: fetch waits until seq leaves stage
        this._finishing = false;
        this._cycle = 0;
        // The occupancy ring: per recorded cycle, 5 cells of (seq or -1, reason code).
        this._rN = Math.max(0, c.recordCycles | 0);
        this._rSeq = new Int32Array(this._rN * 5);
        this._rCode = new Uint8Array(this._rN * 5);
        this._rCycle = new Float64Array(this._rN);
        this._rHead = 0;
        this._rLen = 0;
        this._rows = new Map();       // seq -> {pc, op, cls}, insertion (= seq) order
        this.resetStats();
    }

    resetStats() {
        this.stats = {cycles: 0, insts: 0, traps: 0, fill: 0,
            stall: Object.fromEntries(STALL_REASONS.map(r => [r, 0])),
            redirect: {mispredict: 0, decode: 0, jalr: 0, trap: 0}};
        this.predictor.resetStats();
        if (this.btb) this.btb.resetStats();
        if (this.icache) this.icache.resetStats();
        if (this.dcache) this.dcache.resetStats();
    }

    /** Feed one trace record; simulates every cycle it makes decidable. */
    push(rec) {
        this._queue.push(rec);
        this._run();
    }

    /** No more records: drain the pipeline. */
    finish() {
        this._finishing = true;
        this._run();
        // Drained. A later push starts a new fill, as after a reset.
        this._finishing = false;
        this._needFetch = true;
        this._bub.fill('fill');
    }

    get cycle() { return this._cycle; }

    _run() {
        for (;;) {
            if (this._needFetch) {
                if (this._qHead < this._queue.length) this._fetch(this._queue[this._qHead++]);
                else if (this._finishing) { this._slot[IF] = null; this._bub[IF] = 'drain'; }
                else return;                                  // wait for the next record
                this._needFetch = false;
                if (this._qHead > 1024) { this._queue = this._queue.slice(this._qHead); this._qHead = 0; }
            }
            if (this._finishing && this._slot.every(s => s === null) && this._qHead >= this._queue.length) return;
            this._tick();
        }
    }

    /** A record enters IF: I-cache access, prediction, fetch block. */
    _fetch(rec) {
        let lat = 1;
        if (this.icache && rec.len > 0) {
            const r = this.icache.accessRange(rec.ppc >= 0 ? rec.ppc : rec.pc, rec.len, false);
            lat += r.misses * this.cfg.missPenalty + r.writebacks * this.cfg.writebackPenalty;
        }
        const e = {rec, lat, acc: 0, loadLike: false};
        this._slot[IF] = e;
        this._bub[IF] = null;
        const fall = (rec.pc + rec.len) >>> 0;
        let stage = -1, reason = 'control';
        if (rec.cls === 'trap' || (rec.cls !== 'branch' && rec.cls !== 'jal' && rec.cls !== 'jalr' && rec.nextPc !== fall)) {
            stage = MEM; reason = 'trap';
            this.stats.redirect.trap++;
        } else if (rec.cls === 'branch') {
            const pred = this.predictor.predict(rec.pc);
            const t = this.btb ? this.btb.lookup(rec.pc) : -1;
            this.predictor.update(rec.pc, rec.taken, pred);
            if (pred && t >= 0) {                               // redirected at IF to the BTB's target
                if (!(rec.taken && t === rec.target)) { stage = this._resolve; this.stats.redirect.mispredict++; }
            } else if (pred) {                                  // predicted taken, target known after decode
                if (rec.taken) { stage = ID; this.stats.redirect.decode++; } else { stage = this._resolve; this.stats.redirect.mispredict++; }
            } else if (rec.taken) { stage = this._resolve; this.stats.redirect.mispredict++; }
            if (this.btb && rec.taken) this.btb.update(rec.pc, rec.target);
        } else if (rec.cls === 'jal') {
            const t = this.btb ? this.btb.lookup(rec.pc) : -1;
            if (t !== rec.nextPc) { stage = ID; this.stats.redirect.decode++; }
            if (this.btb) this.btb.update(rec.pc, rec.nextPc);
        } else if (rec.cls === 'jalr') {
            const t = this.btb ? this.btb.lookup(rec.pc) : -1;
            if (t !== rec.nextPc) { stage = this._resolve; this.stats.redirect.jalr++; }
            if (this.btb) this.btb.update(rec.pc, rec.nextPc);
        }
        if (stage >= 0) this._block = {seq: rec.seq, stage, reason};
        // EX / MEM latencies known from the record.
        e.exLat = rec.cls === 'mul' ? this.cfg.mulLatency : rec.cls === 'div' ? this.cfg.divLatency : 1;
        e.loadLike = rec.rd !== 0 && (rec.memKind === 'load' || rec.memKind === 'amo' || rec.cls === 'amo');
        if (this._rN > 0) this._rows.set(rec.seq, {pc: rec.pc, op: rec.op, cls: rec.cls});
    }

    /** Would the instruction in ID see its operands in time to leave ID now? */
    _hazard(e, adv) {
        const rec = e.rec;
        const inId = this._resolve === ID && (rec.cls === 'branch' || rec.cls === 'jalr');
        for (let k = 0; k < 2; k++) {
            const src = k === 0 ? rec.rs1 : rec.rs2;
            if (src === 0) continue;
            let p = null, ps = -1;
            for (let s = EX; s <= WB; s++) {
                const q = this._slot[s];
                if (q !== null && q.rec.rd === src && q.rec.cls !== 'trap') { p = q; ps = s; break; }
            }
            if (p === null) continue;
            let ok;
            if (!this.cfg.forwarding) ok = ps === WB;
            else if (inId) ok = p.loadLike ? ps === WB : ps >= MEM;
            else ok = p.loadLike ? (ps === WB || (ps === MEM && adv[MEM])) : (ps > EX || adv[EX]);
            if (!ok) return this.cfg.forwarding && p.loadLike && !inId ? 'loaduse' : 'raw';
        }
        return null;
    }

    _tick() {
        const slot = this._slot, bub = this._bub;
        for (let s = 0; s < 5; s++) if (slot[s] !== null) slot[s].acc++;
        // Decide back to front. adv[s]: stage s's content (instruction or
        // bubble) moves on at the end of this cycle. why[s]: a held stage's reason.
        const adv = [false, false, false, false, true], hold = [null, null, null, null, null];   // hold[s]: why a stage kept its instruction
        let frozen = false, born = null;
        const bornAt = [null, null, null, null, null];
        // MEM
        if (slot[MEM] !== null && slot[MEM].acc < slot[MEM].memLat) { frozen = true; hold[MEM] = 'dcache'; bornAt[WB] = 'dcache'; }
        else adv[MEM] = true;
        // EX
        if (frozen) { if (slot[EX] !== null) hold[EX] = 'frozen'; }
        else if (slot[EX] !== null && slot[EX].acc < slot[EX].exLat) { frozen = true; hold[EX] = 'muldiv'; bornAt[MEM] = 'muldiv'; }
        else adv[EX] = true;
        // ID
        if (frozen) { if (slot[ID] !== null) hold[ID] = 'frozen'; }
        else if (slot[ID] !== null) {
            born = this._hazard(slot[ID], adv);
            if (born) { frozen = true; hold[ID] = born; bornAt[EX] = born; } else adv[ID] = true;
        } else adv[ID] = true;
        // IF
        if (frozen) { if (slot[IF] !== null) hold[IF] = 'frozen'; }
        else if (slot[IF] !== null && slot[IF].acc < slot[IF].lat) { hold[IF] = 'icache'; bornAt[ID] = 'icache'; }
        else adv[IF] = true;

        this._record(hold);

        // Retire / count WB.
        const st = this.stats;
        st.cycles++;
        if (slot[WB] === null) {
            if (bub[WB] === 'fill') st.fill++;
            else if (bub[WB] in st.stall) st.stall[bub[WB]]++;
        } else if (slot[WB].rec.cls === 'trap') { st.stall.trap++; st.traps++; }
        else st.insts++;

        // Fetch unblock: the blocking instruction leaves its resolve stage now.
        const blk = this._block;
        if (blk !== null && adv[blk.stage] && slot[blk.stage] !== null && slot[blk.stage].rec.seq === blk.seq) this._block = null;

        // Move.
        for (let s = WB; s >= ID; s--) {
            if (adv[s - 1]) {
                const e = slot[s - 1];
                slot[s] = e; bub[s] = e === null ? bub[s - 1] : null;
                if (e !== null) this._enter(e, s);
            } else if (adv[s]) {
                slot[s] = null; bub[s] = bornAt[s];
            }
        }
        this._cycle++;
        if (adv[IF]) {
            if (this._block !== null) { slot[IF] = null; bub[IF] = this._block.reason; }
            else this._needFetch = true;
        }
    }

    /** An instruction enters stage s: start its clock there, access the D-cache in MEM. */
    _enter(e, s) {
        e.acc = 0;
        if (s === MEM) {
            let lat = 1;
            const rec = e.rec;
            if (this.dcache && rec.memKind) {
                const r = this.dcache.accessRange(rec.memPa >= 0 ? rec.memPa : rec.memVa, rec.memSize, rec.memKind !== 'load');
                lat += r.misses * this.cfg.missPenalty + r.writebacks * this.cfg.writebackPenalty;
            }
            e.memLat = lat;
        }
    }

    _record(hold) {
        const n = this._rN;
        if (n === 0) return;
        const at = this._rHead, base = at * 5;
        for (let s = 0; s < 5; s++) {
            const e = this._slot[s];
            if (e === null) { this._rSeq[base + s] = -1; this._rCode[base + s] = CODE[this._bub[s]] ?? 0; }
            else { this._rSeq[base + s] = e.rec.seq; this._rCode[base + s] = hold[s] === null ? 0 : CODE[hold[s]]; }
        }
        this._rCycle[at] = this._cycle;
        this._rHead = (at + 1) % n;
        if (this._rLen < n) this._rLen++;
        if (this._rows.size > 4 * n + 16) {                 // forget rows older than the window
            const oldest = (this._rHead - this._rLen + n) % n;
            let min = Infinity;
            for (let k = 0; k < this._rLen && min === Infinity; k++) {
                const b = ((oldest + k) % n) * 5;
                for (let s = 0; s < 5; s++) if (this._rSeq[b + s] >= 0) min = Math.min(min, this._rSeq[b + s]);
            }
            for (const seq of this._rows.keys()) { if (seq < min) this._rows.delete(seq); else break; }
        }
    }

    /**
     * The recorded window as a pipeline diagram: {firstCycle, cycles, rows,
     * bubbles}. rows: one per instruction seen in the window, oldest first:
     *   {seq, pc, op, cls, cells: [{cycle, stage: 'IF'…'WB', hold: reason|null}]}
     * `hold` is set in a cycle the instruction could not leave its stage —
     * its own reason (loaduse, raw, muldiv, icache, dcache) or 'frozen' when a
     * stall further down held it. bubbles: {cycle, stage, reason} for every
     * empty stage in the window (reason: fill, drain or a stall reason).
     */
    occupancy(lastCycles = this._rN) {
        const n = this._rN, len = Math.min(lastCycles, this._rLen);
        const rows = new Map(), bubbles = [];
        let first = this._cycle;
        for (let k = 0; k < len; k++) {
            const at = (this._rHead - len + k + n) % n, b = at * 5, cycle = this._rCycle[at];
            if (k === 0) first = cycle;
            for (let s = 0; s < 5; s++) {
                const seq = this._rSeq[b + s], code = this._rCode[b + s];
                if (seq < 0) { bubbles.push({cycle, stage: STAGES[s], reason: REASON[code]}); continue; }
                let r = rows.get(seq);
                if (!r) { const m = this._rows.get(seq) || {}; r = {seq, pc: m.pc, op: m.op, cls: m.cls, cells: []}; rows.set(seq, r); }
                r.cells.push({cycle, stage: STAGES[s], hold: code === 0 ? null : REASON[code]});
            }
        }
        return {firstCycle: first, cycles: len, rows: [...rows.values()].sort((a, c) => a.seq - c.seq), bubbles};
    }

    /** Named statistics (E8.4). */
    report() {
        const s = this.stats, stalls = Object.values(s.stall).reduce((a, b) => a + b, 0);
        const insts = s.insts, per = n => insts ? n / insts : 0;
        const bp = this.predictor.report();
        return {
            'cpu.cycles': s.cycles, 'cpu.insts': insts, 'cpu.traps': s.traps,
            'cpu.cpi': per(s.cycles), 'cpu.ipc': s.cycles ? insts / s.cycles : 0,
            'pipe.fill': s.fill, 'pipe.stalls': stalls,
            ...Object.fromEntries(STALL_REASONS.map(r => [`pipe.stall.${r}`, s.stall[r]])),
            ...Object.fromEntries(STALL_REASONS.map(r => [`cpi.${r}`, per(s.stall[r])])),
            'cpi.base': insts ? 1 : 0, 'cpi.fill': per(s.fill),
            'bp.kind': bp.kind, 'bp.predictions': bp.predictions, 'bp.correct': bp.correct,
            'bp.mispredicts': bp.mispredicts, 'bp.accuracy': bp.accuracy,
            'bp.redirect.mispredict': s.redirect.mispredict, 'bp.redirect.decode': s.redirect.decode,
            'bp.redirect.jalr': s.redirect.jalr, 'bp.redirect.trap': s.redirect.trap,
            ...(this.btb ? prefixed('btb', this.btb.report()) : {}),
            ...(this.icache ? prefixed('icache', this.icache.report()) : {}),
            ...(this.dcache ? prefixed('dcache', this.dcache.report()) : {})
        };
    }
}

function prefixed(name, rep) {
    const out = {};
    for (const [k, v] of Object.entries(rep)) if (k !== 'config') out[`${name}.${k}`] = v;
    return out;
}

export default PipelineModel;
