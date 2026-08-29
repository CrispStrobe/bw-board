#!/usr/bin/env node
/**
 * Run the netlist → manifest bridge over the real gallery corpus, and say what
 * it carried and what it refused.
 *
 * This is the tool that MEASURES the claim `LABWIRED-BRIDGE.md` makes. It also
 * emits the fixture the census test runs on, because bw-board's test suite has
 * no gallery of its own and must not grow a dependency on one:
 *
 *   node scripts/labwired-bridge-census.mjs \
 *     --gallery   /path/to/sb3-creator/examples \
 *     --circuit-ui /path/to/bw-circuit-ui \
 *     [--emit test/fixtures/labwired/f030-bench-netlists.json]
 *
 * WHY IT NEEDS bw-circuit-ui AND THE TEST DOES NOT
 * -----------------------------------------------
 * A gallery bench is a DESIGNER file — seated parts, breadboard rows, hole
 * endpoints, three wire dialects mixed in one document. `Circuit.fromJSON` is
 * the one canonical reader for all of that, and it lives in bw-circuit-ui,
 * which is MPL-2.0 while this repo is MIT. So the resolution happens HERE, in a
 * dev-time script nobody bundles, and what lands in `test/fixtures/` is the
 * ENGINE-side result: plain `{parts, nets}`, the same shape `BoardImpl` takes.
 * The test then needs nothing but this repo.
 *
 * The fixture is stamped with the sb3-creator commit it was derived from, so
 * "is this stale?" is answerable by re-running this script against that commit
 * and diffing.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const arg = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? dflt : process.argv[i + 1];
};
const gallery = resolve(arg('gallery', '../sb3-creator/examples'));
const circuitUi = resolve(arg('circuit-ui', '../bw-circuit-ui'));
const emit = arg('emit', null);
const variant = arg('variant', 'circuit.stm32f030.json');
const chipKind = arg('chip-kind', 'stm32f030');

for (const [what, path] of [['gallery', gallery], ['bw-circuit-ui', circuitUi]]) {
    if (!existsSync(path)) {
        console.error(`labwired-bridge-census: no ${what} at ${path}`);
        console.error('  pass --gallery <sb3-creator/examples> --circuit-ui <bw-circuit-ui>');
        process.exit(2);
    }
}

const here = pathToFileURL(join(process.cwd(), '/'));
const { registerAllDevices } = await import(new URL('src/register-all.js', here).href);
registerAllDevices();
const { BoardImpl } = await import(new URL('src/board.js', here).href);
const { inferNetlist, checkWiring } = await import(new URL('src/infer-netlist.js', here).href);
const { buildLabwiredSystem } = await import(new URL('src/labwired-bridge.js', here).href);

const cui = pathToFileURL(join(circuitUi, '/'));
const { setEngine } = await import(new URL('src/engine.js', cui).href);
setEngine({ BoardImpl, inferNetlist, checkWiring });
const { Circuit } = await import(new URL('src/model/circuit.js', cui).href);

const benches = readdirSync(gallery)
    .filter((d) => statSync(join(gallery, d)).isDirectory() && existsSync(join(gallery, d, variant)))
    .sort();

let provenance = arg('source-commit', '');
if (!provenance) {
    try {
        provenance = execFileSync('git', ['-C', gallery, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch { provenance = 'unknown'; }
}

const out = [];
const roleTally = new Map();
const refusalTally = new Map();
const kindTally = new Map();
let loadFailures = 0;

for (const bench of benches) {
    let netlist;
    try {
        const circuit = Circuit.fromJSON(JSON.parse(readFileSync(join(gallery, bench, variant), 'utf8')));
        const b = circuit.board;
        if (!b || !b.parts.length) throw new Error('the loader produced an empty board');
        netlist = {
            parts: b.parts.map((p) => ({ id: p.id, kind: p.kind, params: p.params ?? {} })),
            nets: b.nets.map((n) => ({ id: n.id, terminals: n.terminals })),
        };
    } catch (e) {
        loadFailures++;
        console.log(`LOAD-FAILED ${bench}: ${String(e.message ?? e).split('\n')[0]}`);
        continue;
    }
    const built = buildLabwiredSystem({ netlist, chipKind, name: `bw-${bench}` });
    out.push({ bench, netlist });
    for (const a of built.attachments) {
        if (a.role === 'floating') continue;
        roleTally.set(a.role, (roleTally.get(a.role) ?? 0) + 1);
        for (const p of a.parts) kindTally.set(p.kind, (kindTally.get(p.kind) ?? 0) + 1);
    }
    for (const r of built.refusals) {
        refusalTally.set(r.code, (refusalTally.get(r.code) ?? 0) + 1);
        console.log(`REFUSED ${bench} [${r.code}] ${r.subject}: ${r.reason}`);
    }
}

const line = (m) => [...m].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' ');
console.log(`\nbenches: ${benches.length}   loaded: ${out.length}   load failures: ${loadFailures}`);
console.log(`pad roles:     ${line(roleTally)}`);
console.log(`parts at pads: ${line(kindTally)}`);
console.log(`refusals:      ${refusalTally.size ? line(refusalTally) : 'none'}`);

if (emit) {
    const payload = {
        _note: 'GENERATED by scripts/labwired-bridge-census.mjs — do not hand-edit. '
            + 'Engine-side netlists ({parts, nets}) resolved from the gallery benches named '
            + 'below, so the census test needs neither a gallery nor bw-circuit-ui.',
        variant,
        chipKind,
        sourceRepo: 'CrispStrobe/sb3-creator',
        sourceCommit: provenance,
        generatedFrom: gallery,
        benches: out,
    };
    // One bench per LINE: the file is generated, so what matters about its
    // formatting is that a regeneration diff names the benches that moved
    // rather than reflowing 12,000 lines.
    const head = { ...payload, benches: undefined };
    delete head.benches;
    const body = out.map((b) => ` ${JSON.stringify(b)}`).join(',\n');
    const text = `${JSON.stringify(head, null, 1).replace(/\n?}$/, '')},\n "benches": [\n${body}\n ]\n}\n`;
    writeFileSync(resolve(emit), text);
    console.log(`\nwrote ${emit} (${out.length} netlists, sb3-creator @ ${provenance.slice(0, 8)})`);
}
