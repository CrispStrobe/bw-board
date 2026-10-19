#!/usr/bin/env node
// Developer tool: run ELFs on Spike (-l --log-commits) and lockstep-compare our
// core against each trace; optionally pack the traces as committed fixtures.
//
//   SPIKE=/path/to/spike node test/riscv-oracle/spike-lockstep.mjs [--pack OUTDIR] ELF...
//
// Spike needs `dtc` on PATH. The ISA string is the hart we implement.
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {basename, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {parseSpikeLog, packTrace} from './spike-trace.mjs';
import {lockstep} from './lockstep.mjs';

export const SPIKE_ISA = 'rv32imac_zicsr_zifencei_zicntr_zicclsm_svadu';
// zicclsm: misaligned loads/stores in hardware, as ours. svadu: menvcfg.ADUE selects hardware A/D updates.

const args = process.argv.slice(2);
let pack = null;
if (args[0] === '--pack') { pack = args[1]; args.splice(0, 2); mkdirSync(pack, {recursive: true}); }
const spike = process.env.SPIKE || 'spike';
let bad = 0;
for (const f of args) {
    const r = spawnSync(spike, [`--isa=${SPIKE_ISA}`, '-l', '--log-commits', f],
        {encoding: 'utf8', maxBuffer: 1 << 30, timeout: 120_000});
    const recs = parseSpikeLog(r.stderr);
    const res = lockstep(new Uint8Array(readFileSync(f)), recs);
    const name = basename(f).replace(/\.elf$/, '');
    if (res.ok) console.log(`ok   ${name.padEnd(34)} ${res.compared} records`);
    else { bad++; console.log(`DIFF ${name}\n${res.diff}\n`); }
    if (pack) writeFileSync(join(pack, name + '.trace.gz'), packTrace(recs));
}
console.log(`${args.length - bad}/${args.length} agree with Spike`);
process.exitCode = bad ? 1 : 0;
