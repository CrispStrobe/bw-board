#!/usr/bin/env node
// Compare two fixture files program by program and say WHAT differs: the
// program set, then per program its entry, segments, symbols and the first
// differing trace record.  node compare-fixtures.mjs A.json.br B.json.br
import {readFileSync} from 'node:fs';
import {brotliDecompressSync} from 'node:zlib';
const [a, b] = process.argv.slice(2).map(f => JSON.parse(brotliDecompressSync(readFileSync(f)).toString()));
let diffs = 0;
const say = s => { diffs++; if (diffs <= 40) console.log(s); };
if (a.isa !== b.isa) say(`isa: ${a.isa} vs ${b.isa}`);
const names = new Set([...Object.keys(a.tests), ...Object.keys(b.tests)]);
for (const n of names) {
    const x = a.tests[n], y = b.tests[n];
    if (!x || !y) { say(`${n}: only in ${x ? 'first' : 'second'}`); continue; }
    if (x.entry !== y.entry) say(`${n}: entry ${x.entry} vs ${y.entry}`);
    if (JSON.stringify(x.symbols) !== JSON.stringify(y.symbols)) say(`${n}: symbols ${JSON.stringify(x.symbols)} vs ${JSON.stringify(y.symbols)}`);
    if (JSON.stringify(x.segments) !== JSON.stringify(y.segments)) say(`${n}: segments differ (${x.segments.map(s => s.addr.toString(16) + '+' + s.size)} vs ${y.segments.map(s => s.addr.toString(16) + '+' + s.size)})`);
    const k = x.trace.findIndex((r, i) => JSON.stringify(r) !== JSON.stringify(y.trace[i]));
    if (k >= 0 || x.trace.length !== y.trace.length)
        say(`${n}: trace differs at record ${k} (${x.trace.length} vs ${y.trace.length}): ${JSON.stringify(x.trace[k])} vs ${JSON.stringify(y.trace[k])}`);
}
console.log(diffs ? `${diffs} difference(s)` : 'identical');
process.exitCode = diffs ? 1 : 0;
