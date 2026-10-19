#!/usr/bin/env node
/**
 * Grind src/i8086.js against the SingleStepTests 8086 suite (MIT): 324
 * opcode files × 2,000 vectors, generated on an Intel P80C86A-2 with
 * ArduinoX86. Files sort into PASS / FAIL / NOT-YET (the core throws
 * Unimplemented for opcodes it has not reached), so growth is measurable
 * per session.
 *
 * Out-of-repo suite (526 MB unpacked, so it does not live in the tree):
 *   git clone --depth 1 https://github.com/SingleStepTests/8086 ~/code/8086-vectors
 *
 *   node scripts/grind-i8086.mjs                 # everything
 *   node scripts/grind-i8086.mjs 00 88 D0.6      # just these files
 *   node scripts/grind-i8086.mjs --limit 100     # first 100 vectors per file
 *   node scripts/grind-i8086.mjs --verbose 8F    # every diff, not just the first
 *   node scripts/grind-i8086.mjs --json          # force the JSON encoding
 *
 * TWO ENCODINGS, ONE SUITE. `v1/` is gzipped JSON and `v1_binary/` is gzipped
 * MOO; they carry the same 646,000 vectors (test/moo.test.mjs requires them to
 * agree field for field). The binary form is preferred when present because it
 * is 94 MB against 174 MB and parses without materialising 646,000 objects,
 * which is what makes a per-push CI checkout affordable. Either is accepted.
 *
 * THIS SCRIPT EXITS NON-ZERO, and it counts out loud. It is a CI gate now, and
 * a gate that reports "323 files pass" says nothing about whether it examined
 * 646,000 vectors or none: a suite half checked out, a reader that returns
 * empty tests, a glob that matched nothing all produce a cheerful summary line.
 * So the vector count is printed, zero vectors is a failure with its own
 * message, and any FAIL or NOT-YET file exits 1.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT COMPARE, and both would otherwise
 * fail every vector for reasons that say nothing about correctness:
 *
 *   - CYCLES. The suite's cycle arrays are bus traces from a real chip with
 *     a prefetch queue; an instruction-stepped core has no such thing. The
 *     Z80 grinder compares cycle counts because that suite's counts are
 *     instruction-local. This one cannot.
 *   - THE UNDEFINED FLAGS. The 8086 genuinely leaves flags undefined after
 *     MUL, DIV, the BCD adjusts, and multi-bit shifts, and the hardware is
 *     not reproducible there either. v1/metadata.json carries a per-opcode
 *     (and per-ModR/M-reg) `flags-mask`; both sides are masked with it
 *     before the compare. Ignoring the mask means chasing ghosts that the
 *     silicon itself does not define.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { I8086, Unimplemented } from '../src/i8086.js';
import { readMooFile } from './moo.mjs';

const root = process.env.I8086_VECTORS || join(homedir(), 'code', '8086-vectors');
const forceJson = process.argv.includes('--json');

/** Where the vectors are, and in which encoding. Binary wins when both exist
 *  and `--json` has not been asked for. */
function resolveSource() {
    const bin = join(root, 'v1_binary');
    const jsn = existsSync(join(root, 'v1')) ? join(root, 'v1') : root;
    if (!forceJson && existsSync(bin)) return { dir: bin, moo: true, ext: '.MOO.gz' };
    return { dir: jsn, moo: false, ext: '.json.gz' };
}
const { dir, moo, ext } = resolveSource();
if (!existsSync(dir)) {
    console.error(`suite not found at ${dir} — see header for the clone recipe`);
    process.exit(2);
}

/** metadata.json carries the per-opcode undefined-flag masks and lives beside
 *  the JSON, so a binary-only checkout has to be pointed at it. Without the
 *  masks the DIV and BCD vectors fail rather than pass, so this is loud but
 *  not dangerous — still, name it rather than let someone debug 2,000 flag
 *  diffs. */
const metaPath = [join(root, 'v1', 'metadata.json'), join(root, 'metadata.json'),
    join(dir, 'metadata.json')].find(existsSync);
if (!metaPath) {
    console.error(`metadata.json not found under ${root} — the undefined-flag masks live `
        + 'there, and without them the DIV, MUL and BCD vectors compare bits the silicon '
        + 'does not define. Check out v1/metadata.json beside the vectors.');
    process.exit(2);
}

const argv = process.argv.slice(2);
const verbose = argv.includes('--verbose');
const limitIdx = argv.indexOf('--limit');
const limit = limitIdx !== -1 ? Number(argv[limitIdx + 1]) : Infinity;
const picked = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--limit')
    .map((s) => s.toUpperCase());

const meta = JSON.parse(readFileSync(metaPath, 'utf8')).opcodes;

/** The flags-mask for a test file: `80.4.json.gz` is opcode 80, ModR/M reg 4.
 *  0xffff (compare everything) unless the suite says a flag is undefined. */
const maskFor = (base) => {
    const [op, reg] = base.split('.');
    let e = meta[op];
    if (!e) return 0xffff;
    if (e.reg) e = e.reg[reg ?? '0'] || {};
    return e['flags-mask'] ?? 0xffff;
};

const files = readdirSync(dir).filter((f) => f.endsWith(ext))
    .filter((f) => !picked.length || picked.includes(f.replace(ext, '')))
    .sort();
if (!files.length) { console.error(`no ${ext} test files matched in ${dir}`); process.exit(2); }

/** One opcode file's vectors, from whichever encoding is in use. */
const loadFile = (file) => (moo
    ? readMooFile(join(dir, file)).tests
    : JSON.parse(gunzipSync(readFileSync(join(dir, file))).toString('utf8')));

const MB = 1 << 20;
const mem = new Uint8Array(MB);
const cpu = new I8086({
    read: (a) => mem[a & 0xfffff],
    write: (a, v) => { mem[a & 0xfffff] = v & 0xff; },
    // "All reads of IO port addresses should return 0xFF" — suite README.
    in: () => 0xff,
    out: () => {},
});

const REGS = ['ax', 'bx', 'cx', 'dx', 'cs', 'ss', 'ds', 'es', 'sp', 'bp', 'si', 'di', 'ip'];

const load = (t) => {
    for (const [addr, val] of t.initial.ram) mem[addr] = val;
    for (const r of REGS) cpu[r] = t.initial.regs[r];
    cpu.flags = t.initial.regs.flags;
    cpu.halted = false;
};
const wipe = (t) => {
    for (const [addr] of t.initial.ram) mem[addr] = 0;
    for (const [addr] of t.final.ram) mem[addr] = 0;
};

let pass = 0, fail = 0, notYet = 0;
const failFiles = [], notYetFiles = [];
let vectorsRun = 0, vectorsPassed = 0;

for (const file of files) {
    const base = file.replace(ext, '');
    const mask = maskFor(base);
    const tests = loadFile(file).slice(0, limit);
    let filePass = 0;
    let firstFail = null;
    let threw = null;

    for (const t of tests) {
        load(t);
        try { cpu.step(); } catch (e) {
            if (e instanceof Unimplemented) { threw = e.message; wipe(t); break; }
            threw = `THREW ${e.message}`;
            wipe(t);
            break;
        }
        const diffs = [];
        // Registers absent from `final` are unchanged, so the expectation is
        // the initial state with the final delta laid over it.
        const want = { ...t.initial.regs, ...t.final.regs };
        for (const r of REGS) {
            if (cpu[r] !== want[r]) diffs.push(`${r}: want ${want[r]} got ${cpu[r]}`);
        }
        const wf = want.flags & mask, gf = cpu.flags & mask;
        if (wf !== gf) {
            diffs.push(`flags: want ${wf.toString(2).padStart(16, '0')} got ${gf.toString(2).padStart(16, '0')}`
                + ` (differ in ${(wf ^ gf).toString(16)})`);
        }
        // A DIV or IDIV that overflows takes INT 0, and INT pushes FLAGS --
        // including the bits this very opcode leaves undefined. Comparing
        // that word byte-exactly would contradict the mask we just applied
        // to the same value in a register, so the pushed word is compared
        // under the mask too. This is the suite's own undefined-flag
        // contract followed through to where the flags landed; it is not a
        // licence to ignore stack contents, and every other pushed byte is
        // still compared exactly.
        let maskedLo = -1;
        if (mask !== 0xffff && want.sp === ((t.initial.regs.sp - 6) & 0xffff)) {
            maskedLo = (((want.ss & 0xffff) << 4) + ((want.sp + 4) & 0xffff)) & 0xfffff;
            const got = mem[maskedLo] | (mem[maskedLo + 1] << 8);
            const ram = Object.fromEntries(t.final.ram);
            const exp = (ram[maskedLo] ?? 0) | ((ram[maskedLo + 1] ?? 0) << 8);
            if ((got & mask) !== (exp & mask)) {
                diffs.push(`pushed flags: want ${(exp & mask).toString(16)} got ${(got & mask).toString(16)}`);
            }
        }
        for (const [addr, val] of t.final.ram) {
            if (addr === maskedLo || addr === maskedLo + 1) continue;
            if (mem[addr] !== val) diffs.push(`ram[${addr}]: want ${val} got ${mem[addr]}`);
        }
        if (diffs.length) {
            if (!firstFail) firstFail = { name: t.name, num: t.test_num, diffs };
            if (verbose) console.log(`  ${base} #${t.test_num} "${t.name}": ${diffs.join('; ')}`);
        } else filePass++;
        wipe(t);
    }

    vectorsRun += tests.length;
    vectorsPassed += filePass;
    if (threw) {
        notYet++; notYetFiles.push(base);
        if (verbose) console.log(`${base}: ${threw}`);
        continue;
    }
    if (filePass === tests.length) { pass++; continue; }
    fail++;
    failFiles.push(base);
    console.log(`${base}: ${filePass}/${tests.length}  FIRST #${firstFail.num} "${firstFail.name}": `
        + firstFail.diffs.slice(0, 4).join('; '));
}

console.log(`\n${pass} files pass, ${fail} fail, ${notYet} not yet implemented (of ${files.length})`);
console.log(`${vectorsPassed}/${vectorsRun} vectors `
    + `(${vectorsRun ? (100 * vectorsPassed / vectorsRun).toFixed(3) : '0.000'}%)`
    + ` from ${moo ? 'MOO' : 'JSON'} at ${dir}`);

// A grind that examined nothing prints the same happy summary as one that
// examined everything. This is the assertion that separates them, and it is
// the reason this script can be a CI gate at all.
if (vectorsRun === 0) {
    console.error('FAILED: zero vectors were examined. The files matched but carried no '
        + 'tests — a truncated checkout, an empty reader, or a --limit of 0.');
    process.exit(1);
}
if (fail || notYet) {
    console.error(`FAILED: ${fail} file(s) with wrong results, ${notYet} not yet implemented.`);
    process.exit(1);
}
if (failFiles.length) console.log('failing:', failFiles.slice(0, 40).join(' '));
if (notYetFiles.length) console.log('not yet:', notYetFiles.slice(0, 40).join(' '));
process.exit(fail || notYet ? 1 : 0);
