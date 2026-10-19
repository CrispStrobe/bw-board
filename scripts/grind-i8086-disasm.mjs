#!/usr/bin/env node
/**
 * Grind src/i8086-disasm.js against the SingleStepTests 8086 suite (MIT).
 *
 * The suite carries a `name` -- a real disassembly of the instruction -- and
 * a `bytes` array for every one of its 646,000 vectors. That is a text
 * oracle, not just a length one, and it is a stronger standard than either
 * of the other two disassemblers in this tree could be held to: z80-disasm
 * and w65c02-disasm have their LENGTHS ground against vector pc-deltas and
 * their formats spot-checked by hand. Here both halves are checked, and a
 * mismatch prints want/got so the syntax can be read off the failure.
 *
 *   node scripts/grind-i8086-disasm.mjs              # everything
 *   node scripts/grind-i8086-disasm.mjs 8D FF.3      # just these files
 *   node scripts/grind-i8086-disasm.mjs --limit 50   # first 50 per file
 *
 * Suite location as for the core grinder: ~/code/8086-vectors, or
 * $I8086_VECTORS, in either the JSON (`v1/`) or the MOO (`v1_binary/`)
 * encoding. `--json` forces the former.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { disasmI8086 } from '../src/i8086-disasm.js';
import { readMooFile } from './moo.mjs';

const root = process.env.I8086_VECTORS || join(homedir(), 'code', '8086-vectors');
const forceJson = process.argv.includes('--json');
const binDir = join(root, 'v1_binary');
const useMoo = !forceJson && existsSync(binDir);
const ext = useMoo ? '.MOO.gz' : '.json.gz';
const dir = useMoo ? binDir : (existsSync(join(root, 'v1')) ? join(root, 'v1') : root);
if (!existsSync(dir)) {
    console.error(`suite not found at ${dir} — see grind-i8086.mjs for the clone recipe`);
    process.exit(2);
}
const loadFile = (file) => (useMoo
    ? readMooFile(join(dir, file)).tests
    : JSON.parse(gunzipSync(readFileSync(join(dir, file))).toString('utf8')));

const argv = process.argv.slice(2);
const limitIdx = argv.indexOf('--limit');
const limit = limitIdx !== -1 ? Number(argv[limitIdx + 1]) : Infinity;
const picked = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--limit')
    .map((s) => s.toUpperCase());

const files = readdirSync(dir).filter((f) => f.endsWith(ext))
    .filter((f) => !picked.length || picked.includes(f.replace(ext, '')))
    .sort();
if (!files.length) { console.error(`no ${ext} test files matched in ${dir}`); process.exit(2); }

/**
 * Three vectors in which the suite's own `name` contradicts its own `bytes`.
 *
 * All three sit at the very top of a segment (IP FFFEh or FFFFh), where the
 * instruction's last byte comes from offset 0000h of the same segment. The
 * `bytes` array records what the CPU actually fetched -- it is the capture,
 * and the register and memory results agree with it -- while the name was
 * rendered from a byte that was never executed. Disassembling the bytes is
 * therefore RIGHT here and matching the name would be wrong.
 *
 * THE KEY CHANGED, DELIBERATELY, AND IT IS STRONGER. It used to be the
 * suite's `test_hash`. That field exists only in the JSON encoding -- MOO v1.0
 * carries no HASH subchunk -- and this grinder now reads either, so a hash key
 * would have silently excused nothing on a binary run: three vectors would
 * have been GRADED instead of excluded, and since our text is right and the
 * suite's is wrong, all three would have gone red. An exclusion that
 * evaporates when the input format changes is not an exclusion.
 *
 * So the key is now (file, test_num, bytes) -- present in both encodings, and
 * it names the thing the excuse is ABOUT rather than an opaque digest of it.
 * The wrong `name` is recorded as DATA beside it, which is what keeps the
 * HEALED signal alive: if a regenerated suite changes that name, the row stops
 * applying, and if the new name agrees with our text the run says HEALED and
 * this table should lose a row. An excuse that has stopped being true is worse
 * than no excuse.
 *
 * `hash` is kept for a JSON run only, where it is cross-checked rather than
 * trusted: if the hash is present and does not match, the key has drifted onto
 * a different vector and the run says so instead of quietly excusing the wrong
 * one.
 */
const SUITE_NAME_DISAGREES_WITH_ITS_OWN_BYTES = new Map([
    ['80.6/1311', {
        why: '80.6 #1311 at IP FFFFh: name says "xor bh, 2Ah", bytes say 09h',
        bytes: '128 247 9',
        name: 'xor bh, 2Ah',
        hash: '8171adee83f0a5f33536d087217cc342c4ccd9de818f5f2e9c04e881093be729',
    }],
    ['81.2/1261', {
        why: '81.2 #1261 at IP FFFEh: name says AD90h, bytes say 3766h',
        bytes: '62 129 19 102 55',
        name: 'adc word [ds:bp+di], AD90h',
        hash: 'ac3ed829c118be9e386a9961a8087c9a19c806b062bd60fcdd826a1abf29f788',
    }],
    ['B7/658', {
        why: 'B7 #658 at IP FFFFh: name says "mov bh, 85h", bytes say 88h',
        bytes: '183 136',
        name: 'mov bh, 85h',
        hash: '7f154ea9f6eb272a23bffed55c4e0f670f0343c6628cc5d2836ed7a5d796babd',
    }],
]);

/** The exclusion key: which file, which vector. Both encodings carry it. */
const keyOf = (base, t) => `${base}/${t.test_num}`;

/**
 * Rows whose recorded content did not match the vector they landed on.
 * Nothing is excused on a drifted key -- it is reported and graded normally.
 */
const drifted = [];
/** How many times each row was applied. A row describes ONE vector; applying
 *  it twice means the key is matching things it does not describe. */
const rowUses = new Map();

const mem = new Uint8Array(1 << 20);
let pass = 0, fail = 0, excluded = 0;
const healed = [];
const failFiles = [];
let vectorsRun = 0, vectorsPassed = 0;

for (const file of files) {
    const base = file.replace(ext, '');
    const tests = loadFile(file).slice(0, limit);
    let filePass = 0;
    const firstOfKind = new Map();

    for (const t of tests) {
        for (const [addr, val] of t.initial.ram) mem[addr] = val;
        const { cs, ip } = t.initial.regs;
        const linear = (((cs << 4) + ip) & 0xfffff);
        // The suite renders a relative target from a base IP of ZERO -- as an
        // offset from the instruction's own start, not as an address in the
        // segment it was captured in. `jo 007Ah` on a two-byte jump with a
        // displacement of 78h says so. A debugger pane wants the absolute
        // form, which is what the module does when handed the real IP, so
        // the suite's convention is asked for explicitly here rather than
        // baked into the disassembler.
        const got = disasmI8086((a) => mem[a & 0xfffff], linear, { ip, targetBase: 0 });
        const wantBytes = t.bytes.map((b) => b & 0xff).join(' ');
        const gotBytes = got.bytes.join(' ');
        // `name` is lower-case with single spaces; normalise nothing else --
        // any difference in punctuation or padding is a real difference.
        const want = t.name.trim();
        const row = SUITE_NAME_DISAGREES_WITH_ITS_OWN_BYTES.get(keyOf(base, t));
        // A row applies only if the vector still LOOKS like the one it
        // describes. The hash, where the encoding carries one, is a
        // cross-check on the key rather than the key itself.
        let known = null;
        if (row) {
            // THE BYTES DECIDE WHETHER THIS IS EVEN THE RIGHT VECTOR, and they
            // are checked before the name for a reason found by mutating this
            // very block: with only a name check, a key that matched every
            // vector reported HEALED for all of them, because "the name is not
            // the recorded one AND our text matches it" is true of every
            // correctly disassembled instruction in the suite. The bytes are
            // the stable identity; the name is the thing under adjudication,
            // and a claim about a name is worthless if it is a different
            // instruction's name.
            if (wantBytes !== row.bytes) {
                drifted.push(`${keyOf(base, t)}: bytes are [${wantBytes}], the row describes `
                    + `[${row.bytes}] — the key no longer names that vector, exclusion NOT applied`);
            } else if (t.test_hash && row.hash && t.test_hash !== row.hash) {
                drifted.push(`${keyOf(base, t)}: recorded hash does not match this vector — `
                    + 'the suite was regenerated and the exclusion was NOT applied');
            } else if (want !== row.name) {
                // Same bytes, different name: the suite re-rendered it. If the
                // new name agrees with what the bytes say, this row has healed
                // and the table should shrink.
                if (got.text === want) healed.push(row.why);
                else {
                    drifted.push(`${keyOf(base, t)}: the suite's name changed from `
                        + `"${row.name}" to "${want}" — exclusion NOT applied, re-adjudicate`);
                }
            } else {
                known = row.why;
                rowUses.set(keyOf(base, t), (rowUses.get(keyOf(base, t)) || 0) + 1);
            }
        }
        if (known) {
            // Still required to decode the right BYTES; only the text is excused.
            if (gotBytes !== wantBytes) {
                console.log(`${base} #${t.test_num}: excluded for its text, but the BYTES are wrong`
                    + ` — want [${wantBytes}] got [${gotBytes}]`);
            } else if (got.text === want) healed.push(known);
            filePass++;
            excluded++;
            continue;
        }
        if (got.text === want && gotBytes === wantBytes) filePass++;
        else {
            const kind = `${got.text.split(' ')[0]}|${want.split(' ')[0]}`;
            if (!firstOfKind.has(kind)) {
                firstOfKind.set(kind, `#${t.test_num} want "${want}" [${wantBytes}]`
                    + `  got "${got.text}" [${gotBytes}]`);
            }
        }
        for (const [addr] of t.initial.ram) mem[addr] = 0;
    }

    vectorsRun += tests.length;
    vectorsPassed += filePass;
    if (filePass === tests.length) { pass++; continue; }
    fail++;
    failFiles.push(base);
    console.log(`${base}: ${filePass}/${tests.length}`);
    for (const line of [...firstOfKind.values()].slice(0, 3)) console.log(`    ${line}`);
}

console.log(`\n${pass} files pass, ${fail} fail (of ${files.length})`);
console.log(`${vectorsPassed}/${vectorsRun} vectors `
    + `(${vectorsRun ? (100 * vectorsPassed / vectorsRun).toFixed(3) : '0.000'}%)`
    + ` from ${useMoo ? 'MOO' : 'JSON'} at ${dir}`
    + (excluded ? `, ${excluded} excluded where the suite's name contradicts its own bytes` : ''));
for (const h of new Set(healed)) console.log(`HEALED — the suite now agrees, drop this row: ${h}`);
for (const d of drifted) console.log(`DRIFTED — ${d}`);
if (failFiles.length) console.log('failing:', failFiles.slice(0, 40).join(' '));

// Same argument as the core grinder: "323 files pass" is printed just as
// happily by a run that examined nothing.
if (vectorsRun === 0) {
    console.error('FAILED: zero vectors were examined.');
    process.exit(1);
}
// A key that matches too much looks identical to a clean run in the summary
// line, so it is asserted rather than hoped for. Each row describes exactly
// one vector: excusing more vectors than there are rows, or applying one row
// twice, means the key has stopped naming what it claims to.
if (excluded > SUITE_NAME_DISAGREES_WITH_ITS_OWN_BYTES.size) {
    console.error(`FAILED: ${excluded} vectors excused but only `
        + `${SUITE_NAME_DISAGREES_WITH_ITS_OWN_BYTES.size} rows exist — the key is matching too much.`);
    process.exit(1);
}
const overused = [...rowUses].filter(([, n]) => n > 1);
if (overused.length) {
    console.error(`FAILED: ${overused.map(([k, n]) => `${k} applied ${n}x`).join(', ')} — `
        + 'a row describes one vector and must be applied once.');
    process.exit(1);
}
if (drifted.length) {
    console.error(`FAILED: ${drifted.length} exclusion row(s) no longer name the vector they `
        + 'describe. Re-adjudicate them; do not widen the key.');
    process.exit(1);
}
process.exit(fail ? 1 : 0);
