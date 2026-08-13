#!/usr/bin/env node
/**
 * Grind src/w65c02.js against the SingleStepTests 65x02 vector suite
 * (WDC 65C02 variant): ~10k vectors per opcode, 256 opcodes. For each
 * vector: load registers + sparse RAM, execute ONE instruction, compare
 * registers, every touched RAM cell, and the cycle count (cycles.length).
 *
 * The suite is 1.1 GB and lives OUTSIDE the repo:
 *   git clone --depth 1 --filter=blob:none --sparse \
 *       https://github.com/SingleStepTests/65x02 ~/code/65x02-vectors
 *   cd ~/code/65x02-vectors && git sparse-checkout set wdc65c02/v1
 *
 *   node scripts/grind-w65c02.mjs               # all 256 opcodes
 *   node scripts/grind-w65c02.mjs a9 7d f8      # just these
 *   VECTORS_DIR=... to point elsewhere
 *
 * Exit 0 only on 2.56M/2.56M. Per failing opcode: pass count and the
 * first mismatch in full (vector name, expected vs got).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { W65C02 } from '../src/w65c02.js';

const dir = process.env.VECTORS_DIR
    || join(homedir(), 'code', '65x02-vectors', 'wdc65c02', 'v1');
if (!existsSync(dir)) {
    console.error(`vector suite not found at ${dir} — see header for the clone recipe`);
    process.exit(2);
}

const picked = process.argv.slice(2).map((s) => s.toLowerCase());
const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
    .filter((f) => !picked.length || picked.includes(f.replace('.json', '')))
    .sort();

const mem = new Uint8Array(65536);
const cpu = new W65C02({
    read: (a) => mem[a & 0xffff],
    write: (a, v) => { mem[a & 0xffff] = v & 0xff; },
});

let totalPass = 0, totalFail = 0;
const failingOpcodes = [];

for (const file of files) {
    const raw = readFileSync(join(dir, file), 'utf8');
    if (!raw.trim()) { console.log(`${file.replace('.json', '')}: empty in the suite (WAI/STP are not single-steppable) — skipped`); continue; }
    const tests = JSON.parse(raw);
    let pass = 0;
    let firstFail = null;
    for (const t of tests) {
        for (const [addr, val] of t.initial.ram) mem[addr] = val;
        cpu.pc = t.initial.pc; cpu.s = t.initial.s;
        cpu.a = t.initial.a; cpu.x = t.initial.x; cpu.y = t.initial.y;
        cpu.p = t.initial.p;
        cpu.stopped = false; cpu.waiting = false;
        const n = cpu.step();

        const diffs = [];
        for (const r of ['pc', 's', 'a', 'x', 'y', 'p']) {
            if (cpu[r] !== t.final[r]) diffs.push(`${r}: want ${t.final[r]} got ${cpu[r]}`);
        }
        for (const [addr, val] of t.final.ram) {
            if (mem[addr] !== val) diffs.push(`ram[${addr}]: want ${val} got ${mem[addr]}`);
        }
        if (n !== t.cycles.length) diffs.push(`cycles: want ${t.cycles.length} got ${n}`);

        if (diffs.length) {
            if (!firstFail) firstFail = { name: t.name, diffs, p0: t.initial.p };
        } else pass++;

        // Restore only what this vector touched — cheaper than re-zeroing 64K.
        for (const [addr] of t.initial.ram) mem[addr] = 0;
        for (const [addr] of t.final.ram) mem[addr] = 0;
    }
    const fail = tests.length - pass;
    totalPass += pass; totalFail += fail;
    if (fail) {
        failingOpcodes.push(file.replace('.json', ''));
        console.log(`${file.replace('.json', '')}: ${pass}/${tests.length}  FIRST: "${firstFail.name}" p0=${firstFail.p0.toString(2).padStart(8, '0')} — ${firstFail.diffs.join('; ')}`);
    }
}

console.log(`\n${totalPass}/${totalPass + totalFail} vectors pass across ${files.length} opcodes`);
if (failingOpcodes.length) console.log(`failing opcodes: ${failingOpcodes.join(' ')}`);
process.exit(totalFail ? 1 : 0);
