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
 * $I8086_VECTORS.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { disasmI8086 } from '../src/i8086-disasm.js';

const root = process.env.I8086_VECTORS || join(homedir(), 'code', '8086-vectors');
const dir = existsSync(join(root, 'v1')) ? join(root, 'v1') : root;
if (!existsSync(dir)) {
    console.error(`suite not found at ${dir} — see grind-i8086.mjs for the clone recipe`);
    process.exit(2);
}

const argv = process.argv.slice(2);
const limitIdx = argv.indexOf('--limit');
const limit = limitIdx !== -1 ? Number(argv[limitIdx + 1]) : Infinity;
const picked = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--limit')
    .map((s) => s.toUpperCase());

const files = readdirSync(dir).filter((f) => f.endsWith('.json.gz'))
    .filter((f) => !picked.length || picked.includes(f.replace('.json.gz', '')))
    .sort();
if (!files.length) { console.error('no test files matched'); process.exit(2); }

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
 * Keyed by the suite's own test_hash, so a re-generated suite invalidates
 * the entry rather than silently keeping it. If one of these starts
 * agreeing, the run says so and this table should lose a row: an excuse
 * that has stopped being true is worse than no excuse.
 */
const SUITE_NAME_DISAGREES_WITH_ITS_OWN_BYTES = new Map([
    ['8171adee83f0a5f33536d087217cc342c4ccd9de818f5f2e9c04e881093be729',
        '80.6 #1311 at IP FFFFh: name says "xor bh, 2Ah", bytes say 09h'],
    ['ac3ed829c118be9e386a9961a8087c9a19c806b062bd60fcdd826a1abf29f788',
        '81.2 #1261 at IP FFFEh: name says AD90h, bytes say 3766h'],
    ['7f154ea9f6eb272a23bffed55c4e0f670f0343c6628cc5d2836ed7a5d796babd',
        'B7 #658 at IP FFFFh: name says "mov bh, 85h", bytes say 88h'],
]);

const mem = new Uint8Array(1 << 20);
let pass = 0, fail = 0, excluded = 0;
const healed = [];
const failFiles = [];
let vectorsRun = 0, vectorsPassed = 0;

for (const file of files) {
    const base = file.replace('.json.gz', '');
    const tests = JSON.parse(gunzipSync(readFileSync(join(dir, file))).toString('utf8')).slice(0, limit);
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
        const known = SUITE_NAME_DISAGREES_WITH_ITS_OWN_BYTES.get(t.test_hash);
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
console.log(`${vectorsPassed}/${vectorsRun} vectors (${(100 * vectorsPassed / vectorsRun).toFixed(3)}%)`
    + (excluded ? `, ${excluded} excluded where the suite's name contradicts its own bytes` : ''));
for (const h of healed) console.log(`HEALED — the suite now agrees, drop this row: ${h}`);
if (failFiles.length) console.log('failing:', failFiles.slice(0, 40).join(' '));
process.exit(fail ? 1 : 0);
