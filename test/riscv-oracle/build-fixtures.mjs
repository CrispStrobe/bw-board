#!/usr/bin/env node
// Regenerate the committed oracle fixtures: for each ELF, run Spike with
// --log-commits and store {segments, symbols, trace} in one brotli JSON per
// suite under test/fixtures/riscv-oracle/. CI then replays the traces in
// lockstep against our core with no Spike and no toolchain.
//
//   SPIKE=/path/spike node test/riscv-oracle/build-fixtures.mjs <suite> ELF...
//
// Spike needs `dtc` on PATH. The pins (Spike commit, riscv-tests commit,
// arch-test tag, GCC) are recorded in test/fixtures/riscv-oracle/PROVENANCE.md
// and the ISA string below is written into each fixture.
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {brotliCompressSync, constants as Z} from 'node:zlib';
import {parseSpikeLog, packTraceRows} from './spike-trace.mjs';
import {elfSegments, elfSymbols} from './elf32.mjs';

export const SPIKE_ISA = 'rv32imac_zicsr_zifencei_zicntr_zicclsm_svadu';
const KEEP_SYMS = ['tohost', 'fromhost', 'begin_signature', 'end_signature'];

const here = dirname(fileURLToPath(import.meta.url));
const [suite, ...args] = process.argv.slice(2);
// Programs in code-point order of their names, so the fixture's bytes do not
// depend on the shell's locale collation of the glob that listed them.
const elfs = [...args].sort((a, b) => (basename(a) < basename(b) ? -1 : basename(a) > basename(b) ? 1 : 0));
const spike = process.env.SPIKE || 'spike';
const out = {isa: SPIKE_ISA, tests: {}};
for (const f of elfs) {
    const elf = new Uint8Array(readFileSync(f));
    const r = spawnSync(spike, [`--isa=${SPIKE_ISA}`, '-l', '--log-commits', f],
        {encoding: 'utf8', maxBuffer: 1 << 30, timeout: 300_000});
    if (r.status !== 0) { console.error(`spike failed on ${f}: ${r.stderr.slice(-400)}`); process.exit(1); }
    const {entry, segments} = elfSegments(elf);
    const syms = elfSymbols(elf);
    out.tests[basename(f).replace(/\.elf$/, '')] = {
        entry,
        segments: segments.map(s => ({addr: s.addr, b64: Buffer.from(trimZeros(s.bytes)).toString('base64'), size: s.bytes.length})),
        symbols: Object.fromEntries(KEEP_SYMS.filter(k => syms.has(k)).map(k => [k, syms.get(k)])),
        trace: packTraceRows(parseSpikeLog(r.stderr)),
    };
}
const dir = resolve(here, '../fixtures/riscv-oracle');
mkdirSync(dir, {recursive: true});
// Brotli with a 16 MiB window: the programs share their test scaffolding, so
// the long window deduplicates it across programs (~8x smaller than gzip).
const raw = Buffer.from(JSON.stringify(out));
const buf = brotliCompressSync(raw, {params: {[Z.BROTLI_PARAM_QUALITY]: 11, [Z.BROTLI_PARAM_LGWIN]: 24,
    [Z.BROTLI_PARAM_SIZE_HINT]: raw.length}});
writeFileSync(join(dir, `${suite}.json.br`), buf);
console.log(`${suite}: ${Object.keys(out.tests).length} programs, ${(buf.length / 1024).toFixed(0)} KiB`);

function trimZeros(b) { let n = b.length; while (n > 0 && b[n - 1] === 0) n--; return b.subarray(0, n); }
