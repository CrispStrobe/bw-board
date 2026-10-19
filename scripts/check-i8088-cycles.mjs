#!/usr/bin/env node
/**
 * Score the GENERATED table (src/i8088-cycles.js) against the 8088 v2 oracle.
 *
 * WHAT THIS NUMBER IS, AND IS NOT. The shipped table is fitted on every
 * vector, so scoring it against those same vectors is IN-SAMPLE: it measures
 * whether the table and the lookup path are correct, NOT whether the model
 * generalises. It should be very high, and a high number here is not evidence
 * of anything except that generation and lookup agree.
 *
 * The generalisation estimate is the pilot's HELD-OUT score
 * (scripts/pilot-i8088-schedule.mjs, 70/30 within each opcode): 95.6% over
 * 323 opcodes. Quote that one when asked how good the model is. A score
 * without its split is not a claim.
 *
 * Refuses rather than passes when the vectors are absent.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { TABLES, PROVENANCE } from '../src/i8088-cycles.js';

const VECTORS = process.env.V2_DIR || '/home/claudeuser/code/8088-vectors/';
const DIR = VECTORS.replace(/\/?$/, '/') + 'v2/';
const DATA_BUS = new Set(['MEMR', 'MEMW', 'IOR', 'IOW']);
const PREFIX = new Set([0x26, 0x2e, 0x36, 0x3e, 0xf0, 0xf2, 0xf3]);
const popcount = (v) => { let n = 0; while (v) { n += v & 1; v >>>= 1; } return n; };
const absw = (v) => ((v & 0x8000) ? (-v & 0xffff) : v);

const CATEGORICAL = {
    'F7.4': (r) => popcount(r.ax),
    'F6.4': (r) => popcount(r.ax & 0xff),
    'F7.5': (r) => popcount(absw(r.ax)) * 2 + ((r.ax >> 15) & 1),
    'F6.5': (r) => popcount(r.ax & 0xff),
    '99':   (r) => (r.ax >> 15) & 1,
};
const SHIFT_BY_CL = (r) => 4 * (r.cx & 0xff);
const LINEAR = {};
for (let e = 0; e < 8; e++) { LINEAR[`D2.${e}`] = SHIFT_BY_CL; LINEAR[`D3.${e}`] = SHIFT_BY_CL; }

function modrmIndex(bytes) {
    let p = 0;
    while (p < bytes.length && PREFIX.has(bytes[p])) p++;
    const m = bytes[p + 1];
    return m === undefined ? 32 : ((m >> 6) << 3) | (m & 7);
}

if (!existsSync(DIR)) {
    console.error(`REFUSING: vector directory ${DIR} is absent. Nothing was checked.`);
    console.error('This is NOT a pass.');
    process.exit(2);
}

let hit = 0, miss = 0, nokey = 0;
let qHit = 0, qMiss = 0;
const worst = [];
for (const f of readdirSync(DIR).filter((x) => x.endsWith('.json.gz')).sort()) {
    const op = f.replace('.json.gz', '');
    const T = TABLES[op];
    if (!T) continue;
    const cat = CATEGORICAL[op] || null;
    const lin = LINEAR[op] || null;
    let h = 0, n = 0;
    for (const x of JSON.parse(gunzipSync(readFileSync(DIR + f)).toString())) {
        let accesses = 0;
        for (let i = 0; i < x.cycles.length; i++) {
            const r = x.cycles[i];
            if (r[8] === 'T1' && DATA_BUS.has(r[7])) accesses++;
        }
        const g = x.initial.regs;
        const q = (x.initial.queue || []).length;
        const len = x.bytes.length;
        const m = modrmIndex(x.bytes);
        const v = cat ? cat(g) : 0;
        const L = lin ? lin(g) : 0;
        const fl = ((g.ip + len) & 0xffff) === x.final.regs.ip ? 0 : 1;
        n++;
        const base = T.t[`${q},${len},${accesses},${m},${fl},${v}`];
        if (base === undefined) { nokey++; miss++; }
        else if (base + L === x.cycles.length) { hit++; h++; }
        else miss++;
        // The queue recurrence, scored with the TRUE cycle count so the two
        // failures do not mask one another.
        const nq = T.q[`${q},${len},${x.cycles.length},${fl}`];
        if (nq !== undefined && nq === (x.final.queue || []).length) qHit++; else qMiss++;
    }
    worst.push({ op, pct: n ? 100 * h / n : 0, n });
}
const total = hit + miss;
const qTotal = qHit + qMiss;
console.log(`table: ${PROVENANCE.opcodes} opcodes, generator ${PROVENANCE.generator}, vectors @ ${PROVENANCE.vectors.slice(0, 12)}`);
console.log('IN-SAMPLE (fitted on these same vectors -- validates the lookup, not the model):');
console.log(`  cycles     ${(100 * hit / total).toFixed(2)}%  (${hit}/${total}), missing keys: ${nokey}`);
console.log(`  next queue ${(100 * qHit / qTotal).toFixed(2)}%  (${qHit}/${qTotal})`);
console.log('held-out estimates are 98.00% and 99.81% -- see ROADMAP E6.8.4h');
console.log('\nworst 12 opcodes (cycles):');
for (const w of worst.sort((a, b) => a.pct - b.pct).slice(0, 12)) {
    console.log('  ', w.op.padEnd(7), `${w.pct.toFixed(1)}%`.padStart(7), `(n=${w.n})`);
}
