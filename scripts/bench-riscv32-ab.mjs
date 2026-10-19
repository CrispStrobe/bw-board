#!/usr/bin/env node
/**
 * Interleaved A/B throughput of two RISC-V core trees on one workload.
 *
 *   node scripts/bench-riscv32-ab.mjs <workload> <srcA> <srcB> [trials]
 *
 * Each trial is a fresh process (bench-riscv32.mjs --src DIR --json), trials
 * alternate A, B, A, B … so a slow patch of a shared box hits both sides, and
 * medians are reported with the B/A ratio. An A-vs-A pass gives the noise
 * floor: a ratio inside it is not a signal. Report ratios from here; absolute
 * MIPS from a quiet CI runner.
 */
import {spawnSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const [workload, srcA, srcB, trialsArg] = process.argv.slice(2);
const TRIALS = Number(trialsArg ?? 5);
if (!workload || !srcA || !srcB) { console.error('usage: bench-riscv32-ab.mjs <workload> <srcA> <srcB> [trials]'); process.exit(2); }

function one(src) {
    const r = spawnSync(process.execPath, [resolve(here, 'bench-riscv32.mjs'), workload, '--src', src, '--json'],
        {encoding: 'utf8', env: process.env, maxBuffer: 1 << 26});
    const line = r.stdout.trim().split('\n').pop();
    if (r.status !== 0 || !line.startsWith('{')) throw new Error(`bench failed for ${src}: ${r.stderr.slice(-400)}`);
    return JSON.parse(line);
}
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };

function pass(a, b) {
    const ma = [], mb = [];
    let ia, ib;
    for (let t = 0; t < TRIALS; t++) {
        const ra = one(a), rb = one(b);
        ma.push(ra.mips); mb.push(rb.mips); ia = ra.instructions; ib = rb.instructions;
    }
    return {a: median(ma), b: median(mb), ratio: median(mb) / median(ma), ia, ib, ma, mb};
}

const noise = pass(srcA, srcA);
const ab = pass(srcA, srcB);
const f = x => x.toFixed(2);
console.log(`${workload}: A=${srcA}\n           B=${srcB}`);
console.log(`  A ${f(ab.a)} MIPS  B ${f(ab.b)} MIPS  B/A ${f(ab.ratio)}x   (noise floor A/A ${f(noise.ratio)}x; trials ${TRIALS})`);
console.log(`  A trials ${ab.ma.map(f).join(' ')}   B trials ${ab.mb.map(f).join(' ')}`);
if (ab.ia !== ab.ib) console.log(`  NOTE instruction counts differ: A ${ab.ia} B ${ab.ib}`);
