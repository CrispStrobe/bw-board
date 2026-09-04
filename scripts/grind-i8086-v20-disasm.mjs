#!/usr/bin/env node
/**
 * Grind src/i8086-disasm.js IN ITS 80186 VARIANT against the disassembly
 * strings the SingleStepTests v20 suite (MIT) ships with every vector.
 *
 * The 8086 half of this module is held to 646,000/646,000 on TEXT and LENGTH,
 * which is a stronger standard than either of the other two disassemblers in
 * this tree reaches. The 186 half is held to the same one here, against the
 * same kind of oracle, so a 186 debugger pane is not a downgrade.
 *
 * WHY THIS MATTERS MORE THAN THE CORE GRIND DID. A core that renders an
 * opcode wrong computes a wrong answer and something eventually notices. A
 * DISASSEMBLER that renders it wrong is read by a person who then believes
 * it -- `pusha` shown as `jo` is not a missing feature, it is a confident
 * lie, and a pane that lies is worse than a pane that is blank.
 *
 * THE ONE PLACE WE DELIBERATELY DISAGREE WITH THE ORACLE. The suite's own
 * disassembler drops the three-operand IMUL's immediate: bytes 69 0C 86 DA
 * render as `imul cx, word [ds:si]`, with DA86h nowhere in the text. That is
 * lossy in exactly the way a debugger pane must not be, so the module prints
 * all three operands by default and takes `v20Syntax: true` for the suite's
 * two -- the same bargain `targetBase: 0` already strikes for relative
 * targets. The grinder asks for the test convention; the product does not
 * inherit it.
 *
 * EXCLUSIONS, counted and printed even when green, because a skip nobody
 * reports reads exactly like a pass:
 *
 *   - REPC / REPNC (0x64 / 0x65). NEC prefixes. An 80186 has no such
 *     instruction and this module does not invent one.
 *   - Shift counts above 31 are NOT excluded here. Unlike the core grind,
 *     a disassembler renders the count byte as it was ENCODED and never
 *     masks it, so `shl al, 21h` is the right text on both parts and the
 *     V20's different execution is not this module's problem.
 *
 * Suite, sparse -- the full clone is 851 MB and the fifteen opcodes are 156:
 *
 *   git clone --filter=blob:none --sparse --depth 1 \\
 *     https://github.com/SingleStepTests/v20 ~/code/v20-vectors
 *   cd ~/code/v20-vectors && git sparse-checkout set --no-cone \\
 *     '/v1_native/metadata.json' \\
 *     '/v1_native/6[0-9A-F].json.gz' '/v1_native/C[01].*.json.gz' \\
 *     '/v1_native/C8.json.gz' '/v1_native/C9.json.gz'
 *
 *   node scripts/grind-i8086-v20-disasm.mjs
 *   node scripts/grind-i8086-v20-disasm.mjs 60 C8 --verbose
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { disasmI8086 } from '../src/i8086-disasm.js';
import { readMooFile } from './moo.mjs';

const root = process.env.V20_VECTORS || join(homedir(), 'code', 'v20-vectors');
const forceJson = process.argv.includes('--json');
const binDir = join(root, 'v1_binary');
const useMoo = !forceJson && existsSync(binDir);
const ext = useMoo ? '.MOO.gz' : '.json.gz';
const dir = useMoo ? binDir : (existsSync(join(root, 'v1_native')) ? join(root, 'v1_native') : root);
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

/** The fifteen opcodes the 186 added. Everything else in the suite is either
 *  a plain 8086 instruction, already ground at 646,000/646,000 by
 *  grind-i8086-disasm.mjs, or an NEC instruction this module does not claim. */
const IS186 = (base) => ['60', '61', '62', '68', '69', '6A', '6B', '6C', '6D',
    '6E', '6F', 'C0', 'C1', 'C8', 'C9'].includes(base.split('.')[0]);

const files = readdirSync(dir).filter((f) => f.endsWith(ext))
    .filter((f) => IS186(f.replace(ext, '')))
    .filter((f) => !picked.length || picked.some((q) => f.replace(ext, '').startsWith(q)))
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
/* The 8086 grinder carries three rows here -- vectors at IP FFFEh/FFFFh whose
 * `name` was rendered from a byte that was never fetched. None of them are
 * 186 opcodes, so this map starts EMPTY and every row added to it must be
 * justified against the v20 suite on its own evidence. An exclusion inherited
 * from another suite would be an excuse, not a finding. */
const SUITE_NAME_DISAGREES_WITH_ITS_OWN_BYTES = new Map([]);

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
let pass = 0, fail = 0, excluded = 0, skippedPrefix = 0;
const healed = [];
const failFiles = [];
let vectorsRun = 0, vectorsPassed = 0;

for (const file of files) {
    const base = file.replace(ext, '');
    const tests = loadFile(file).slice(0, limit);
    let filePass = 0;
    const skipsBefore = skippedPrefix;
    const firstOfKind = new Map();

    for (const t of tests) {
        // REPC / REPNC are NEC prefixes (0x65 / 0x64) with no 186 meaning.
        // Counted and printed rather than quietly dropped.
        if (/^rep[cn]/.test(t.name || '')) { skippedPrefix++; continue; }
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
        const got = disasmI8086((a) => mem[a & 0xfffff], linear, { ip, targetBase: 0, variant: '80186', v20Syntax: true });
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

    // Excluded vectors are not RUN, so they are not counted as run. A
    // denominator that includes them would report a lower score for a
    // grinder that examined the same vectors correctly.
    const graded = tests.length - (skippedPrefix - skipsBefore);
    vectorsRun += graded;
    vectorsPassed += filePass;
    if (filePass === graded) { pass++; continue; }
    fail++;
    failFiles.push(base);
    console.log(`${base}: ${filePass}/${graded}`);
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
console.log(`excluded: ${skippedPrefix} REPC/REPNC (NEC-only prefix, no 186 equivalent)`);
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
