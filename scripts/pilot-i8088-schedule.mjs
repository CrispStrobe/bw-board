#!/usr/bin/env node
// Pilot: can per-opcode cycle timing be DERIVED from the 8088 v2 oracle rather
// than hand-authored, and does it generalise?  (ROADMAP E6.8.4g)
//
// Instructions that touch memory or I/O decompose as
//
//     total = anchor + span + tail
//
//   anchor  T-state at which the FIRST data access begins. Set by the prefetch
//           queue AND the effective-address mode -- the documented 8086 EA
//           table (disp-only 6, base-or-index 5, base+index 7/8, +disp 9/11/12).
//           Keying on modrm mod/rm moves anchor accuracy 55% -> 100%.
//   span    offset of the last access relative to the first. Per (opcode, mode).
//   tail    T-states after the last access begins. Per-opcode CONSTANT --
//           measured identical across all 10,000 vectors on every opcode where
//           it is defined at all.
//
// Instructions with no data access are predicted directly from
// (queue, length, branch-taken); there is no anchor to place.
//
// TWO HONEST SPLITS, because calibrating a constant per opcode is not
// verification -- it only counts if it survives data it was not fitted to:
//
//   SPLIT A  held-out VECTORS (70/30 within each opcode). Does the calibration
//            overfit, or does it describe the opcode?
//   SPLIT B  held-out OPCODES (leave-one-out). Does the machinery transfer to
//            an opcode never seen -- i.e. would this reach the ~290 opcodes we
//            have no local vectors for?
//
// Split B is expected to be POOR and that is the finding, not a failure: the
// per-opcode EU prologue cannot be inferred from other opcodes. It is why
// cycle-exact cores (MartyPC's `cycles_i`) carry a per-opcode microcode list.

import { readFileSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

const DIR = process.env.V2_DIR || '/home/claudeuser/code/8088-vectors/v2/';
const DATA_BUS = new Set(['MEMR', 'MEMW', 'IOR', 'IOW']);
const PREFIX = new Set([0x26, 0x2e, 0x36, 0x3e, 0xf0, 0xf2, 0xf3]);

// Opcodes whose EU time depends on an OPERAND VALUE, not just its addressing
// mode. The datasheet states these as ranges (MUL r/m16: 118-133 clocks) rather
// than a single figure, so a fixed per-opcode constant cannot fit them.
// The extra key is the operand the microcode actually loops over -- for MUL
// that is the popcount of AX (the microcode shifts AX and adds on each 1 bit),
// which lifts F7.4 from 15.5% to 63.4% on held-out vectors.
const popcount = (v) => { let n = 0; while (v) { n += v & 1; v >>>= 1; } return n; };
// CATEGORICAL features: the operand value selects a different constant.
const absw = (v) => ((v & 0x8000) ? (-v & 0xffff) : v);
const VARIABLE_LATENCY = {
    'F7.4': (r) => popcount(r.ax),                              // MUL r/m16
    'F6.4': (r) => popcount(r.ax & 0xff),                       // MUL r/m8
    // Signed forms negate to magnitude first, then run the unsigned loop, so
    // the feature is popcount of |AX| *plus* the sign (the negate costs time).
    'F7.5': (r) => `${popcount(absw(r.ax))}_${(r.ax >> 15) & 1}`, // IMUL r/m16
    'F6.5': (r) => popcount(r.ax & 0xff),                        // IMUL r/m8
    '99':   (r) => (r.ax >> 15) & 1,                             // CWD
};

// LINEAR features: the operand adds a PROPORTIONAL number of cycles, so a
// categorical key is the wrong shape -- it fragments the table across 64 CL
// values and scores ~57%. The datasheet gives shift/rotate by CL as 8+4n
// (register) / 20+EA+4n (memory); measured directly, cl=0 -> 8 and every
// +2 of CL adds +8, i.e. exactly 4 cycles per count. Subtracting 4*CL before
// fitting and adding it back when predicting takes these from ~3% to ~99.4%.
const SHIFT_BY_CL = (r) => 4 * (r.cx & 0xff);
const LINEAR_LATENCY = {};
for (let ext = 0; ext < 8; ext++) {
    LINEAR_LATENCY[`D2.${ext}`] = SHIFT_BY_CL;   // shift/rotate r/m8, CL
    LINEAR_LATENCY[`D3.${ext}`] = SHIFT_BY_CL;   // shift/rotate r/m16, CL
}

function modrmKey(bytes) {
    let p = 0;
    while (p < bytes.length && PREFIX.has(bytes[p])) p++;
    const m = bytes[p + 1];
    return m === undefined ? '-' : `${m >> 6}.${m & 7}`;
}

function load(file, opcode) {
    const t = JSON.parse(gunzipSync(readFileSync(DIR + file)).toString());
    const vl = VARIABLE_LATENCY[opcode] || null;
    const ll = LINEAR_LATENCY[opcode] || null;
    const out = [];
    for (const x of t) {
        const idx = [];
        for (let i = 0; i < x.cycles.length; i++) {
            const r = x.cycles[i];
            if (r[8] === 'T1' && DATA_BUS.has(r[7])) idx.push(i);
        }
        const last = idx[idx.length - 1];
        out.push({
            q: (x.initial.queue || []).length,
            len: x.bytes.length,
            n: idx.length,
            m: modrmKey(x.bytes),
            v: vl ? vl(x.initial.regs) : 0,
            L: ll ? ll(x.initial.regs) : 0,
            // One bit: did control transfer? Derived here from the vector, but
            // at predict time our core already knows it (_tookBranch). Using the
            // raw flag word instead fragments the key and scores far worse.
            fl: ((x.initial.regs.ip + x.bytes.length) & 0xffff) === x.final.regs.ip ? 0 : 1,
            anchor: idx.length ? idx[0] : null,
            span: idx.length ? last - idx[0] : 0,
            tail: idx.length ? x.cycles.length - last : 0,
            tot: x.cycles.length,
        });
    }
    return out;
}

const mode = (arr) => {
    const c = new Map();
    for (const v of arr) c.set(v, (c.get(v) || 0) + 1);
    let best = null, bn = -1;
    for (const [v, n] of c) if (n > bn) { best = v; bn = n; }
    return best;
};
const push = (map, k, v) => (map.get(k) || map.set(k, []).get(k)).push(v);
const modalMap = (map) => {
    const m = new Map();
    for (const [k, v] of map) m.set(k, mode(v));
    return m;
};

// Anchor and the no-data direct model are keyed WITHOUT the opcode, so the same
// table is usable on an opcode it was never trained on -- the point of split B.
const aKey = (r) => `${r.q}|${r.len}|${r.n}|${r.m}|${r.v}`;
const dKey = (r) => `${r.q}|${r.len}|${r.m}|${r.fl}|${r.v}`;
const sKey = (r) => `${r.n}|${r.m}|${r.v}`;

function train(rows) {
    const a = new Map(), d = new Map(), sp = new Map(), tl = new Map();
    for (const r of rows) {
        if (r.anchor === null) { push(d, dKey(r), r.tot - r.L); continue; }
        push(a, aKey(r), r.anchor);
        // The shift loop runs BETWEEN the read and the write, so for a
        // read-modify-write form the linear term lands in span, not tail.
        if (r.n >= 2) { push(sp, sKey(r), r.span - r.L); push(tl, sKey(r), r.tail); }
        else { push(sp, sKey(r), r.span); push(tl, sKey(r), r.tail - r.L); }
    }
    return { a: modalMap(a), d: modalMap(d), sp: modalMap(sp), tl: modalMap(tl) };
}

function score(rows, mAnchor, mShape) {
    let hit = 0, n = 0;
    for (const r of rows) {
        n++;
        if (r.anchor === null) {
            if (mAnchor.d.get(dKey(r)) + r.L === r.tot) hit++;
            continue;
        }
        const a = mAnchor.a.get(aKey(r));
        const span = mShape.sp.get(sKey(r)), tail = mShape.tl.get(sKey(r));
        if (a !== undefined && span !== undefined && tail !== undefined
            && a + span + tail + r.L === r.tot) hit++;
    }
    return { hit, n, pct: n ? (100 * hit / n) : 0 };
}

const files = readdirSync(DIR).filter((f) => f.endsWith('.json.gz')).sort();
const pct = (h, n) => `${(100 * h / n).toFixed(1)}%`.padStart(7);
const ALL = process.argv.includes('--all');

// SPLIT A streams: only one opcode's vectors are resident at a time, so this
// runs over the full 302-opcode suite (677 MB gzipped) without holding it all.
console.log('=== SPLIT A: held-out vectors (70/30 within each opcode) ===');
let aH = 0, aN = 0;
const worst = [];
for (const f of files) {
    const op = f.replace('.json.gz', '');
    let rows;
    try { rows = load(f, op); } catch { continue; }
    if (!rows.length) continue;
    const cut = Math.floor(rows.length * 0.7);
    const m = train(rows.slice(0, cut));
    const s = score(rows.slice(cut), m, m);
    aH += s.hit; aN += s.n;
    worst.push({ op, pct: s.pct, n: s.n });
    if (!ALL) console.log(op.padEnd(7), pct(s.hit, s.n), `(${s.hit}/${s.n})`);
    rows = null;
}
console.log('OVERALL'.padEnd(7), pct(aH, aN), `(${aH}/${aN})`, `over ${worst.length} opcodes`);

if (ALL) {
    const hist = { '100%': 0, '>=99': 0, '>=95': 0, '>=90': 0, '>=75': 0, '<75': 0 };
    for (const w of worst) {
        if (w.pct === 100) hist['100%']++;
        else if (w.pct >= 99) hist['>=99']++;
        else if (w.pct >= 95) hist['>=95']++;
        else if (w.pct >= 90) hist['>=90']++;
        else if (w.pct >= 75) hist['>=75']++;
        else hist['<75']++;
    }
    console.log('\nper-opcode distribution:', JSON.stringify(hist));
    console.log('\nworst 25 opcodes (these are where the BIU model is needed):');
    for (const w of worst.sort((a, b) => a.pct - b.pct).slice(0, 25)) {
        console.log('  ', w.op.padEnd(7), pct(w.pct * w.n / 100, w.n), `(n=${w.n})`);
    }
}
