#!/usr/bin/env node
/**
 * Generate src/i8088-cycles.js from the SingleStepTests 8088 v2 suite.
 *
 * WHY THIS IS NAMED i8088 AND NOT i8086, WHICH IS THE REST OF THE TIER'S
 * CONVENTION: the vectors were captured from an AMD D8088 -- 8-bit bus,
 * 4-byte prefetch queue. The 8086 has a 16-bit bus and a 6-byte queue, so its
 * anchors and spans WILL differ, and we have no oracle for it. Naming this
 * i8086 would claim coverage that was never measured, and it would be believed
 * because every neighbouring file is named that way. The inconsistency is
 * deliberate and is itself the gap marker: i8088-cycles.js existing while
 * i8086-cycles.js does not says, at a glance, which part is measured.
 *
 * Model (ROADMAP E6.8.4g), for an instruction that touches memory or I/O:
 *
 *     total = anchor + span + tail + linear
 *
 * with anchor keyed on (queue, length, accesses, modrm) -- the last of these
 * being the documented effective-address table -- and span/tail per (accesses,
 * modrm). Instructions with no data access are predicted directly. `linear` is
 * the proportional operand term (shift/rotate by CL costs 4 cycles per count).
 *
 * Usage:
 *   node scripts/gen-i8088-cycle-tables.mjs [--out src/i8088-cycles.js] [--check]
 *
 * --check regenerates into memory and diffs against the committed file,
 * exiting non-zero on drift. It REFUSES rather than passes when the vectors
 * are absent: a check that cannot run must not look like a check that passed.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';

const VECTORS = process.env.V2_DIR || '/home/claudeuser/code/8088-vectors/';
const DIR = VECTORS.replace(/\/?$/, '/') + 'v2/';
const OUT = (() => {
    const i = process.argv.indexOf('--out');
    return i > 0 ? process.argv[i + 1] : 'src/i8088-cycles.js';
})();
const CHECK = process.argv.includes('--check');

const DATA_BUS = new Set(['MEMR', 'MEMW', 'IOR', 'IOW']);
const PREFIX = new Set([0x26, 0x2e, 0x36, 0x3e, 0xf0, 0xf2, 0xf3]);
const popcount = (v) => { let n = 0; while (v) { n += v & 1; v >>>= 1; } return n; };
const absw = (v) => ((v & 0x8000) ? (-v & 0xffff) : v);

// Operand terms. Categorical: the value selects a different constant.
const CATEGORICAL = {
    'F7.4': (r) => popcount(r.ax),
    'F6.4': (r) => popcount(r.ax & 0xff),
    'F7.5': (r) => popcount(absw(r.ax)) * 2 + ((r.ax >> 15) & 1),
    'F6.5': (r) => popcount(r.ax & 0xff),
    '99':   (r) => (r.ax >> 15) & 1,
};
// Linear: the value adds proportional cycles. Datasheet 8+4n / 20+EA+4n,
// confirmed by measurement (cl=0 -> 8, every +2 of CL adds +8).
const SHIFT_BY_CL = (r) => 4 * (r.cx & 0xff);
const LINEAR = {};
for (let e = 0; e < 8; e++) { LINEAR[`D2.${e}`] = SHIFT_BY_CL; LINEAR[`D3.${e}`] = SHIFT_BY_CL; }

const mode = (arr) => {
    const c = new Map();
    for (const v of arr) c.set(v, (c.get(v) || 0) + 1);
    let best = null, bn = -1;
    for (const [v, n] of c) if (n > bn) { best = v; bn = n; }
    return best;
};
const push = (m, k, v) => (m.get(k) || m.set(k, []).get(k)).push(v);
const modal = (m) => { const o = new Map(); for (const [k, v] of m) o.set(k, mode(v)); return o; };

/** modrm mod/rm packed 0..31, or 32 when the opcode carries no modrm byte. */
function modrmIndex(bytes) {
    let p = 0;
    while (p < bytes.length && PREFIX.has(bytes[p])) p++;
    const m = bytes[p + 1];
    return m === undefined ? 32 : ((m >> 6) << 3) | (m & 7);
}

function tablesFor(opcode, tests) {
    const cat = CATEGORICAL[opcode] || null;
    const lin = LINEAR[opcode] || null;
    const A = new Map(), D = new Map(), S = new Map(), T = new Map();
    for (const x of tests) {
        const idx = [];
        for (let i = 0; i < x.cycles.length; i++) {
            const r = x.cycles[i];
            if (r[8] === 'T1' && DATA_BUS.has(r[7])) idx.push(i);
        }
        const g = x.initial.regs;
        const q = (x.initial.queue || []).length;
        const len = x.bytes.length;
        const m = modrmIndex(x.bytes);
        const v = cat ? cat(g) : 0;
        const L = lin ? lin(g) : 0;
        const fl = ((g.ip + len) & 0xffff) === x.final.regs.ip ? 0 : 1;
        if (!idx.length) { push(D, `${q},${len},${m},${fl},${v}`, x.cycles.length - L); continue; }
        const last = idx[idx.length - 1];
        push(A, `${q},${len},${idx.length},${m},${v}`, idx[0]);
        const span = last - idx[0], tail = x.cycles.length - last;
        if (idx.length >= 2) { push(S, `${idx.length},${m},${v}`, span - L); push(T, `${idx.length},${m},${v}`, tail); }
        else { push(S, `${idx.length},${m},${v}`, span); push(T, `${idx.length},${m},${v}`, tail - L); }
    }
    const flat = (m) => { const o = {}; for (const [k, v] of modal(m)) o[k] = v; return o; };
    return { a: flat(A), d: flat(D), s: flat(S), t: flat(T) };
}

function vectorsSha() {
    try {
        return execFileSync('git', ['-C', VECTORS, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch { return 'unknown'; }
}

function generate() {
    if (!existsSync(DIR)) {
        console.error(`REFUSING: vector directory ${DIR} is absent.`);
        console.error('Nothing was regenerated. This is NOT a pass -- a check that');
        console.error('cannot run must not be reported as a check that succeeded.');
        console.error('Fetch with: git clone --filter=blob:none https://github.com/SingleStepTests/8088');
        process.exit(2);
    }
    const files = readdirSync(DIR).filter((f) => f.endsWith('.json.gz')).sort();
    if (!files.length) {
        console.error(`REFUSING: ${DIR} contains no .json.gz vectors. Nothing regenerated.`);
        process.exit(2);
    }
    const out = {};
    let n = 0;
    for (const f of files) {
        const op = f.replace('.json.gz', '');
        const tests = JSON.parse(gunzipSync(readFileSync(DIR + f)).toString());
        out[op] = tablesFor(op, tests);
        n++;
        if (n % 25 === 0) process.stderr.write(`  ${n}/${files.length}\r`);
    }
    process.stderr.write(`  ${n}/${files.length} opcodes\n`);
    return { opcodes: out, count: n };
}

function render({ opcodes, count }) {
    // BUMP THIS on any change to the table's SHAPE or the features that key
    // it. test/i8088-cycles.test.mjs asserts the committed table carries this
    // exact string, so a bump is what forces a regeneration -- it is the only
    // drift check that can run without the 677 MB of vectors.
    //
    // The failure it CANNOT see is forgetting to bump, which is why this sits
    // at the emit rather than in a config file: whoever changes the shape is
    // looking at this line.
    const gen = 'i8088-cycles/1';
    return `// GENERATED FILE -- do not edit by hand.
// Regenerate: node scripts/gen-i8088-cycle-tables.mjs
// Verify:     node scripts/gen-i8088-cycle-tables.mjs --check
//
// Cycle timing tables for the Intel 8088, DERIVED BY MEASUREMENT from the
// SingleStepTests 8088 test suite (${count} opcodes).
//
// Upstream data:
//   https://github.com/SingleStepTests/8088/  vectors @ ${vectorsSha()}
//   Captured from an AMD D8088 (8441DMA) 1982 by Daniel Balsom.
//
//   MIT License. Copyright (c) 2024 SingleStepTests
//
//   Permission is hereby granted, free of charge, to any person obtaining a
//   copy of this software and associated documentation files (the "Software"),
//   to deal in the Software without restriction, including without limitation
//   the rights to use, copy, modify, merge, publish, distribute, sublicense,
//   and/or sell copies of the Software, and to permit persons to whom the
//   Software is furnished to do so, subject to the following conditions:
//
//   The above copyright notice and this permission notice shall be included in
//   all copies or substantial portions of the Software.
//
//   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL
//   THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
//   FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
//   DEALINGS IN THE SOFTWARE.
//
// The notice above travels WITH THIS FILE deliberately: this table is a
// derived work of MIT-licensed data, and attribution that lives only in a
// checkout nobody ships is attribution that has been lost.

export const PROVENANCE = Object.freeze({
    source: 'https://github.com/SingleStepTests/8088/',
    vectors: ${JSON.stringify(vectorsSha())},
    cpu: 'AMD D8088 8441DMA (C)1982',
    license: 'MIT (c) 2024 SingleStepTests',
    generator: ${JSON.stringify(gen)},
    opcodes: ${count},
});

export const TABLES = ${JSON.stringify(opcodes)};
`;
}

const data = generate();
const text = render(data);
if (CHECK) {
    if (!existsSync(OUT)) { console.error(`REFUSING: ${OUT} does not exist.`); process.exit(2); }
    const have = readFileSync(OUT, 'utf8');
    const strip = (s) => s.replace(/^\/\/ .*$/gm, '');
    if (strip(have) !== strip(text)) {
        console.error(`DRIFT: ${OUT} does not match a fresh generation.`);
        process.exit(1);
    }
    console.log(`${OUT} matches the oracle (${data.count} opcodes).`);
} else {
    writeFileSync(OUT, text);
    console.log(`wrote ${OUT} (${data.count} opcodes, ${(text.length / 1024).toFixed(0)} KB)`);
}
