#!/usr/bin/env node
/**
 * Grind src/z80.js against the SingleStepTests z80 suite (MIT): 1,604
 * opcode files × 1,000 vectors, full undocumented state (X/Y flags, Q
 * latch, R per-M1, WZ). Files sort into PASS / FAIL / NOT-YET (the core
 * throws on unimplemented opcodes), so growth is measurable per session.
 *
 * Out-of-repo suite:
 *   git clone --depth 1 --filter=blob:none \
 *       https://github.com/SingleStepTests/z80 ~/code/z80-vectors
 *
 *   node scripts/grind-z80.mjs              # everything
 *   node scripts/grind-z80.mjs 00 80 c6     # just these files
 *   FIELDS=pc,sp,a,f,... to narrow the compared fields while iterating.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Z80 } from '../src/z80.js';

const dir = process.env.Z80_VECTORS || join(homedir(), 'code', 'z80-vectors', 'v1');
if (!existsSync(dir)) {
    console.error(`suite not found at ${dir} — see header for the clone recipe`);
    process.exit(2);
}

const picked = process.argv.slice(2).map((s) => s.toLowerCase());
const files = readdirSync(dir).filter((f) => f.endsWith('.json'))
    .filter((f) => !picked.length || picked.includes(f.replace('.json', '').replace(/\s/g, '')))
    .sort();

const REGS = (process.env.FIELDS || 'pc,sp,a,b,c,d,e,f,h,l,i,r,wz,ix,iy,af_,bc_,de_,hl_,im,iff1,iff2')
    .split(',');

const mem = new Uint8Array(65536);
let ports = [];
const cpu = new Z80({
    read: (a) => mem[a & 0xffff],
    write: (a, v) => { mem[a & 0xffff] = v & 0xff; },
    in: (port) => {
        const p = ports.find((x) => x[0] === port && x[2] === 'r');
        return p ? p[1] : 0xff;
    },
    out: () => {},
});

const load = (t) => {
    for (const [addr, val] of t.initial.ram) mem[addr] = val;
    cpu.pc = t.initial.pc; cpu.sp = t.initial.sp;
    cpu.a = t.initial.a; cpu.f = t.initial.f;
    cpu.b = t.initial.b; cpu.c = t.initial.c; cpu.d = t.initial.d; cpu.e = t.initial.e;
    cpu.h = t.initial.h; cpu.l = t.initial.l;
    cpu.i = t.initial.i; cpu.r = t.initial.r; cpu.wz = t.initial.wz;
    cpu.ix = t.initial.ix; cpu.iy = t.initial.iy;
    cpu.af_ = t.initial.af_; cpu.bc_ = t.initial.bc_;
    cpu.de_ = t.initial.de_; cpu.hl_ = t.initial.hl_;
    cpu.im = t.initial.im; cpu.iff1 = t.initial.iff1; cpu.iff2 = t.initial.iff2;
    cpu.q = t.initial.q; cpu.eiLatch = t.initial.ei;
};
const wipe = (t) => {
    for (const [addr] of t.initial.ram) mem[addr] = 0;
    for (const [addr] of t.final.ram) mem[addr] = 0;
};
const readBack = (r) => {
    if (r === 'af_') return cpu.af_; if (r === 'bc_') return cpu.bc_;
    if (r === 'de_') return cpu.de_; if (r === 'hl_') return cpu.hl_;
    return cpu[r];
};

let pass = 0, fail = 0, notYet = 0;
const failFiles = [], notYetFiles = [];
for (const file of files) {
    const tests = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    let filePass = 0;
    let firstFail = null;
    let threw = null;
    for (const t of tests) {
        load(t);
        ports = t.ports || [];
        let n;
        try { n = cpu.step(); } catch (e) { threw = e.message; wipe(t); break; }
        const diffs = [];
        for (const r of REGS) {
            if (readBack(r) !== t.final[r]) diffs.push(`${r}: want ${t.final[r]} got ${readBack(r)}`);
        }
        for (const [addr, val] of t.final.ram) {
            if (mem[addr] !== val) diffs.push(`ram[${addr}]: want ${val} got ${mem[addr]}`);
        }
        if (n !== t.cycles.length) diffs.push(`cycles: want ${t.cycles.length} got ${n}`);
        if (diffs.length) { if (!firstFail) firstFail = { name: t.name, diffs }; }
        else filePass++;
        wipe(t);
    }
    const base = file.replace('.json', '');
    if (threw) { notYet++; notYetFiles.push(base); continue; }
    if (filePass === tests.length) { pass++; continue; }
    fail++;
    failFiles.push(base);
    console.log(`${base}: ${filePass}/${tests.length}  FIRST "${firstFail.name}": ${firstFail.diffs.slice(0, 4).join('; ')}`);
}

console.log(`\n${pass} files pass, ${fail} fail, ${notYet} not yet implemented (of ${files.length})`);
if (failFiles.length) console.log('failing:', failFiles.slice(0, 20).join(' '));
process.exit(fail ? 1 : 0);
