#!/usr/bin/env node
/**
 * Run 8086 programs through the Tier B stack and report what happened.
 *
 * This is the instrument that turns "the tier is built" into a number, and
 * its whole value depends on not flattering itself. So the classification
 * below has no "pass" in it. A program that loads, runs, exits cleanly and
 * prints NOTHING is not a success -- it is a program that did nothing, and
 * on this corpus that usually means a service returned carry and the code
 * took an error branch straight to the exit. Those are counted separately
 * from programs that actually produced output.
 *
 *   EXITED     terminated through int 21h/4Ch or int 20h, WITH output
 *   SILENT     terminated cleanly and produced nothing -- suspicious
 *   BUDGET     still running when the step budget ran out. Either an
 *              interactive program waiting for a key, or a hang. The
 *              report says which by whether stdin was ever asked for.
 *   THREW      the core hit an opcode it does not implement, or the loader
 *              refused the file. The message names it.
 *   NOASM      an .asm source with no assembler wired in yet.
 *
 * The most useful output is not the tally, it is the REFUSAL HISTOGRAM: every
 * {int, ah} a program asked for and did not get, summed across the corpus and
 * sorted. That is the to-do list, measured rather than guessed -- the same
 * method that showed 2,862 of 3,109 int 21h calls in the textbook corpus are
 * three services.
 *
 *   node scripts/run-i8086-corpus.mjs --selftest
 *   node scripts/run-i8086-corpus.mjs path/to/dir [more...]
 *   node scripts/run-i8086-corpus.mjs --budget 20000000 --verbose file.com
 *
 * ASSEMBLER HOOK. `--assembler <module>` loads an ES module that must export
 * `assemble(source, {name}) -> { bytes: Uint8Array, format: 'com'|'exe'|'boot' }`
 * and throw on failure. Nothing is wired in yet; until then .asm files count
 * as NOASM rather than being silently skipped, because a skip reads the same
 * as a pass in a summary line.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { I8086Machine } from '../src/i8086-machine.js';
import { createDos8086, DOSBOX8086 } from '../src/i8086-dos.js';
import { Unimplemented } from '../src/i8086.js';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, dflt) => {
    const i = argv.indexOf(name);
    return i === -1 ? dflt : argv[i + 1];
};
const BUDGET = Number(value('--budget', 5_000_000));
const VERBOSE = flag('--verbose');
const paths = argv.filter((a, i) => !a.startsWith('--')
    && argv[i - 1] !== '--budget' && argv[i - 1] !== '--assembler');

let assembler = null;
const asmPath = value('--assembler', null);
if (asmPath) {
    const mod = await import(asmPath.startsWith('.') || asmPath.startsWith('/')
        ? asmPath : `../${asmPath}`);
    if (typeof mod.assemble !== 'function') {
        console.error(`${asmPath} exports no assemble(); see the header for the contract`);
        process.exit(2);
    }
    assembler = mod.assemble;
}

/** Two synthetic programs, so the harness can prove itself with no corpus. */
const SELFTEST = [
    {
        name: 'selftest-hello.com',
        bytes: Uint8Array.from([
            0xba, 0x0c, 0x01, 0xb4, 0x09, 0xcd, 0x21,        // print [010Ch]
            0xb8, 0x00, 0x4c, 0xcd, 0x21,                     // exit 0
            0x6f, 0x6b, 0x24,                                 // 'ok$'
        ]),
        expect: 'EXITED',
    },
    {
        name: 'selftest-silent.com',
        bytes: Uint8Array.from([0xb8, 0x00, 0x4c, 0xcd, 0x21]),
        expect: 'SILENT',
    },
    {
        name: 'selftest-spin.com',
        bytes: Uint8Array.from([0xeb, 0xfe]),
        expect: 'BUDGET',
    },
    {
        name: 'selftest-refused.com',
        bytes: Uint8Array.from([0xb4, 0x99, 0xcd, 0x21, 0xb8, 0x00, 0x4c, 0xcd, 0x21]),
        expect: 'SILENT',                                     // exits, prints nothing
    },
];

/** Which loader a file wants, from what is actually in it. */
function classify(bytes, name) {
    const ext = extname(name).toLowerCase();
    if (ext === '.asm' || ext === '.s' || ext === '.inc') return 'asm';
    if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) return 'exe';
    if (bytes.length === 512 && bytes[510] === 0x55 && bytes[511] === 0xaa) return 'boot';
    if (ext === '.bin' && bytes.length >= 512 && bytes[510] === 0x55 && bytes[511] === 0xaa) return 'boot';
    return 'com';
}

function runOne(name, raw) {
    let bytes = raw;
    let kind = classify(bytes, name);

    if (kind === 'asm') {
        if (!assembler) return { name, verdict: 'NOASM', note: 'no assembler wired in' };
        try {
            const out = assembler(Buffer.from(bytes).toString('utf8'), { name });
            bytes = out.bytes;
            kind = out.format || 'com';
        } catch (e) {
            return { name, verdict: 'THREW', note: `assembly failed: ${e.message}` };
        }
    }

    const m = new I8086Machine(DOSBOX8086);
    let dos;
    try {
        dos = createDos8086(m).install();
        if (kind === 'exe') dos.loadExe(bytes);
        else if (kind === 'boot') dos.loadBoot(bytes);
        else dos.loadCom(bytes);
    } catch (e) {
        return { name, verdict: 'THREW', note: `load refused: ${e.message}`, kind };
    }

    let steps = 0;
    try {
        while (!dos.terminated && steps < BUDGET) { dos.step(); steps++; }
    } catch (e) {
        const what = e instanceof Unimplemented ? e.message : `${e.name}: ${e.message}`;
        return { name, kind, verdict: 'THREW', note: what, steps, report: dos.report() };
    }

    const report = dos.report();
    const screen = dos.screenText().filter((l) => l.length).length;
    const printed = report.stdout.length > 0 || screen > 0;
    // A boot sector never "exits" -- it has nowhere to exit to. Reaching the
    // budget having drawn something is the success case for one, so it is
    // classified on OUTPUT rather than on termination.
    if (kind === 'boot') {
        return {
            name, kind, steps, report,
            verdict: printed ? 'EXITED' : (steps >= BUDGET ? 'BUDGET' : 'SILENT'),
        };
    }
    if (!dos.terminated) return { name, kind, steps, report, verdict: 'BUDGET' };
    return { name, kind, steps, report, verdict: printed ? 'EXITED' : 'SILENT' };
}

function collect(p) {
    const st = statSync(p);
    if (!st.isDirectory()) return [p];
    const out = [];
    for (const e of readdirSync(p, { withFileTypes: true })) {
        const full = join(p, e.name);
        if (e.isDirectory()) out.push(...collect(full));
        else if (/\.(com|exe|bin|asm|s)$/i.test(e.name)) out.push(full);
    }
    return out;
}

// ---- run ------------------------------------------------------------------
const results = [];
if (flag('--selftest')) {
    for (const t of SELFTEST) {
        const r = runOne(t.name, t.bytes);
        r.expected = t.expect;
        results.push(r);
    }
} else {
    if (!paths.length) {
        console.error('give a file or directory, or --selftest. See the header.');
        process.exit(2);
    }
    for (const p of paths) {
        if (!existsSync(p)) { console.error(`no such path: ${p}`); process.exit(2); }
        for (const f of collect(p)) {
            results.push(runOne(basename(f), new Uint8Array(readFileSync(f))));
        }
    }
}

const tally = {};
const refusals = new Map();
for (const r of results) {
    tally[r.verdict] = (tally[r.verdict] || 0) + 1;
    for (const u of r.report?.unsupported || []) {
        const k = `int ${u.int.toString(16).padStart(2, '0')}h AH=${u.ah.toString(16).padStart(2, '0')}h`;
        refusals.set(k, (refusals.get(k) || 0) + u.count);
    }
    if (VERBOSE || r.verdict === 'THREW') {
        console.log(`${r.verdict.padEnd(6)} ${r.name}${r.note ? ` -- ${r.note}` : ''}`
            + (r.report?.stdout ? `  out: ${JSON.stringify(r.report.stdout.slice(0, 60))}` : ''));
    }
}

console.log(`\n${results.length} programs:`);
for (const k of ['EXITED', 'SILENT', 'BUDGET', 'THREW', 'NOASM']) {
    if (tally[k]) console.log(`  ${String(tally[k]).padStart(5)}  ${k}`);
}
if (refusals.size) {
    console.log('\nrefused services, most wanted first -- this is the to-do list:');
    for (const [k, n] of [...refusals].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
        console.log(`  ${String(n).padStart(5)}  ${k}`);
    }
}

let exit = 0;
if (flag('--selftest')) {
    const wrong = results.filter((r) => r.verdict !== r.expected);
    for (const r of wrong) console.log(`SELFTEST MISMATCH ${r.name}: want ${r.expected}, got ${r.verdict}`);
    // A harness that cannot tell a working program from a silent one, or a
    // hang from an exit, would report a green corpus made of nothing.
    console.log(wrong.length ? `\nselftest FAILED (${wrong.length})` : '\nselftest ok');
    exit = wrong.length ? 1 : 0;
}
process.exit(exit);
