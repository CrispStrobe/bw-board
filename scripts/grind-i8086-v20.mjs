#!/usr/bin/env node
/**
 * Grind src/i8086.js IN ITS 80186 VARIANT against the SingleStepTests v20
 * suite (MIT): the fifteen opcodes the 186 put in holes the 8086 left as
 * decode aliases, plus the shift-count masking that arrived with them.
 *
 * WHY AN NEC V20 SUITE GRADES AN INTEL 186, and where that stops being true.
 * There is no hardware-generated 80186 suite and there is unlikely ever to
 * be one. The V20 (uPD70108) implements the 186's additions with the same
 * encodings and the same semantics, so for THESE opcodes it is the same
 * instruction set, and dbalsom's suite carries `arch` markers that say so
 * per opcode. That makes it a strong oracle and not a perfect one:
 *
 *   - It grades the 186 ADDITIONS. It cannot grade "is this an Intel 186
 *     rather than an NEC V20", because the V20 has its own instructions
 *     (the 0x0F bit-manipulation group, the 8080 emulation mode) that a 186
 *     does not, and this core implements none of them.
 *   - Cycles are not compared, for the same reason grind-i8086.mjs does not
 *     compare them: the arrays are bus traces from a part with a prefetch
 *     queue. Here they are also the WRONG CHIP'S traces.
 *   - `metadata.json` marks 60/61/62 as arch "86" rather than "186" even
 *     though they are PUSHA/POPA/BOUND -- read the `name` field, which says
 *     `pusha`, not the arch marker. That marker is about the V20's own
 *     lineage, not about which Intel part introduced the opcode.
 *
 * So: a pass here is evidence the additions are right, and is NOT a claim of
 * V20 compatibility. The header of src/i8086.js says the same thing.
 *
 * Out-of-repo suite. The full clone is 851 MB; only the fifteen opcodes are
 * needed, so this uses the same pinned-sparse idiom ci.yml uses for the 8086
 * vectors and takes 156 MB:
 *
 *   git clone --filter=blob:none --sparse --depth 1 \
 *     https://github.com/SingleStepTests/v20 ~/code/v20-vectors
 *   cd ~/code/v20-vectors && git sparse-checkout set --no-cone \
 *     '/v1_native/metadata.json' \
 *     '/v1_native/6[0-9A-F].json.gz' '/v1_native/C[01].*.json.gz' \
 *     '/v1_native/C8.json.gz' '/v1_native/C9.json.gz'
 *
 *   node scripts/grind-i8086-v20.mjs             # every 186 opcode
 *   node scripts/grind-i8086-v20.mjs 60 C8       # just these
 *   node scripts/grind-i8086-v20.mjs --limit 100 # first 100 vectors per file
 *   node scripts/grind-i8086-v20.mjs --verbose 62
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { I8086, Unimplemented } from '../src/i8086.js';
import { readMooFile } from './moo.mjs';

const root = process.env.V20_VECTORS || join(homedir(), 'code', 'v20-vectors');
const forceJson = process.argv.includes('--json');

/** Where the vectors are, and in which encoding. Binary wins when both exist
 *  and `--json` has not been asked for. */
function resolveSource() {
    const bin = join(root, 'v1_binary');
    const jsn = existsSync(join(root, 'v1_native')) ? join(root, 'v1_native') : root;
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
const metaPath = [join(root, 'v1_native', 'metadata.json'), join(root, 'metadata.json'),
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

/** The fifteen opcodes this grinder is ABOUT. Anything else in the suite is
 *  a V20 instruction or a plain 8086 one; grinding those here would either
 *  re-test what grind-i8086.mjs already covers or test a chip we do not
 *  claim to be. C0 and C1 are split by ModR/M reg, so they match by prefix. */
const IS186 = (base) => {
    const op = base.split('.')[0];
    return ['60', '61', '62', '68', '69', '6A', '6B', '6C', '6D', '6E', '6F',
        'C0', 'C1', 'C8', 'C9'].includes(op);
};

const files = readdirSync(dir).filter((f) => f.endsWith(ext))
    .filter((f) => IS186(f.replace(ext, '')))
    .filter((f) => !picked.length || picked.some((p) => f.replace(ext, '').startsWith(p)))
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
}, { variant: '80186' });


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

/** The leading prefix bytes of an encoding, in order. Prefixes precede the
 *  opcode, so this stops at the first byte that is not one. 0x64/0x65 are in
 *  the list because on an NEC part they ARE prefixes (REPNC/REPC) -- which is
 *  the whole question this function exists to answer. */
const PREFIXES = new Set([0x26, 0x2e, 0x36, 0x3e, 0xf0, 0xf1, 0xf2, 0xf3, 0x64, 0x65]);
const leadingPrefixes = (bytes) => {
    const out = [];
    for (const b of bytes) { if (!PREFIXES.has(b & 0xff)) break; out.push(b & 0xff); }
    return out;
};

/** Is this vector NEC-prefixed -- REPC (0x65) or REPNC (0x64)?
 *
 *  IDENTIFIED BY THE BYTES, NOT BY THE NAME, and then cross-checked against
 *  the name. lego-47's point about its own exclusion rows applies here: the
 *  bytes are the stable identity and the text is the thing under
 *  adjudication, so an exclusion keyed on text can quietly widen to cover
 *  vectors it does not describe and look identical to a clean run. If the two
 *  ever disagree the run FAILS rather than picking one, because a
 *  disagreement means this function has drifted from what it claims. */
const necPrefixed = (t, base) => {
    const byBytes = leadingPrefixes(t.bytes || []).some((b) => b === 0x64 || b === 0x65);
    const byName = /^rep[cn]/.test(t.name || '');
    if (byBytes !== byName) {
        console.error(`FAILED: ${base} "${t.name}" [${(t.bytes || []).join(' ')}] -- the bytes say `
            + `${byBytes ? '' : 'no '}NEC prefix and the name says ${byName ? '' : 'no '}NEC prefix. `
            + 'The exclusion test has drifted from what it excludes.');
        process.exit(1);
    }
    return byBytes;
};

let pass = 0, fail = 0, notYet = 0, skippedPrefix = 0, skippedCount = 0;
const failFiles = [], notYetFiles = [];
let vectorsRun = 0, vectorsPassed = 0;

for (const file of files) {
    const base = file.replace(ext, '');
    const mask = maskFor(base);
    const tests = loadFile(file).slice(0, limit);
    let filePass = 0;
    const beforeSkips = skippedPrefix + skippedCount;
    let firstFail = null;
    let threw = null;

    for (const t of tests) {
        // TWO EXCLUSIONS, BOTH COUNTED AND BOTH NAMED. A skip that is not
        // reported reads exactly like a pass in a summary line, so these are
        // tallied and printed even when everything else is green.
        //
        // (1) REPC / REPNC (0x65 / 0x64) are NEC prefixes. An 80186 has no
        //     such instruction -- those encodings are undefined on it -- so a
        //     vector that uses one is testing a chip this core does not claim
        //     to be. About a quarter of the INS/OUTS vectors.
        // (2) A shift count above 31 on C0/C1. The V20 does not mask the
        //     count and the 186 does, so these vectors disagree with a
        //     correct 186 BY DESIGN. Measured: masking on scores 470/600 on
        //     C0.4+C1.4 and off scores 579/600 -- the difference IS this
        //     exclusion, and pretending otherwise would either grade the
        //     wrong chip or delete a real 186 behaviour to make a number.
        if (necPrefixed(t, base)) { skippedPrefix++; continue; }
        if ((base.startsWith('C0') || base.startsWith('C1'))
            && (t.bytes[t.bytes.length - 1] & 0xff) > 31) { skippedCount++; continue; }
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

    vectorsRun += tests.length - (skippedPrefix + skippedCount - beforeSkips);
    vectorsPassed += filePass;
    if (threw) {
        notYet++; notYetFiles.push(base);
        if (verbose) console.log(`${base}: ${threw}`);
        continue;
    }
    if (filePass === tests.length - (skippedPrefix + skippedCount - beforeSkips)) { pass++; continue; }
    fail++;
    failFiles.push(base);
    console.log(`${base}: ${filePass}/${tests.length - (skippedPrefix + skippedCount - beforeSkips)}  FIRST #${firstFail.num} "${firstFail.name}": `
        + firstFail.diffs.slice(0, 4).join('; '));
}

console.log(`\nexcluded: ${skippedPrefix} REPC/REPNC (NEC-only prefix, no 186 equivalent), `
    + `${skippedCount} shift counts >31 (V20 does not mask, a 186 does)`);
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
