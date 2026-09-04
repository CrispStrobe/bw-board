#!/usr/bin/env node
/**
 * Grind our CYCLE COUNTS against the SingleStepTests 8088 suite (MIT) — the
 * oracle E6.8.4 has always said is the prerequisite for a cycle model.
 *
 * WHY THIS SCRIPT EXISTS BEFORE ANY BIU CODE. This tier's standing rule is
 * "no grinder, no landing", and E6.8.4b is the record of what happens when it
 * is bent: a prefetch-queue shortcut that looked gradeable by an instrument
 * already in CI turned out not to be gradeable at all, and fifteen minutes of
 * measurement saved a day of building. So the instrument comes first, it
 * establishes the BASELINE before anything is written, and every later claim
 * is a movement of a number this script printed on day one.
 *
 * WHAT THE ORACLE ACTUALLY CARRIES (v2 format, documented in the suite's own
 * README and not guessed at). Per CPU cycle: the ALE pin, the address latch,
 * segment status, the i8288's memory and I/O status lines, the data bus, the
 * bus m-cycle type (CODE/MEMR/MEMW/IOR/IOW/INTA/HALT/PASV), the T-state, and
 * the QUEUE OPERATION — F (first byte of an instruction or prefix), S
 * (subsequent byte), E (queue flushed) — together with the byte read out.
 *
 * That last field is the one that makes a BIU gradeable at all: it says
 * exactly when a byte left the queue and when the queue was thrown away.
 *
 * FOUR SCORES, NOT ONE, so progress is measurable rather than pass/fail — the
 * property grind-i8086.mjs has and the reason its growth was visible per
 * session:
 *
 *   count    total cycles per instruction              <- all we can do today
 *   bus      the sequence of bus m-cycle types
 *   queue    the F/S/E operations and their bytes
 *   tstate   exact T-state alignment
 *
 * ONLY `count` IS IMPLEMENTED. The other three need a BIU that does not exist
 * yet; they are printed as NOT-YET rather than omitted, because a score that
 * is absent reads like a score that passed.
 *
 * A WARNING ABOUT THE COMPARISON ITSELF. Our cycle counts are the published
 * *8086* timings plus the EA cost; this suite is an *8088*, whose eight-bit
 * bus costs four extra cycles on every word access. So a mismatch here is
 * EXPECTED and the baseline is not a defect count -- it is the distance
 * between "the numbers in the Intel table" and "what the silicon did", which
 * is the thing E6.8.4 proposes to close.
 *
 * Out-of-repo suite (2.0 GB whole; the sparse idiom is the same one ci.yml
 * already uses):
 *
 *   git clone --filter=blob:none --sparse --depth 1 \
 *     https://github.com/SingleStepTests/8088 ~/code/8088-vectors
 *   cd ~/code/8088-vectors && git sparse-checkout set --no-cone \
 *     '/v2/metadata.json' '/v2/40.json.gz' '/v2/90.json.gz' '/v2/33.json.gz'
 *
 *   node scripts/grind-i8088-cycles.mjs            # every checked-out file
 *   node scripts/grind-i8088-cycles.mjs 40 90      # just these
 *   node scripts/grind-i8088-cycles.mjs --limit 50
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { I8086, Unimplemented } from '../src/i8086.js';

const root = process.env.I8088_VECTORS || join(homedir(), 'code', '8088-vectors');
const dir = existsSync(join(root, 'v2')) ? join(root, 'v2') : root;
if (!existsSync(dir)) {
    console.error(`suite not found at ${dir} — see the header for the clone recipe`);
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
if (!files.length) { console.error(`no .json.gz matched in ${dir}`); process.exit(2); }

const MB = 1 << 20;
const mem = new Uint8Array(MB);
const cpu = new I8086({
    read: (a) => mem[a & 0xfffff],
    write: (a, v) => { mem[a & 0xfffff] = v & 0xff; },
    in: () => 0xff,                                  // suite README: IN returns FFh
    out: () => {},
});

const REGS = ['ax', 'bx', 'cx', 'dx', 'cs', 'ss', 'ds', 'es', 'sp', 'bp', 'si', 'di', 'ip'];

/**
 * The suite's cycle count for one test.
 *
 * NOT `cycles.length`. The README is explicit: an instruction's trace begins
 * at the queue-status "First Byte" and ends when the FIRST BYTE OF THE NEXT
 * instruction is read from the queue, so the array carries lead-in Ti cycles
 * and a tail that belongs to the next instruction. Measuring the array's
 * length would be measuring the harness rather than the instruction, and it
 * would be wrong by a different amount for every prefix.
 */
function suiteCycles(t) {
    const c = t.cycles || [];
    let first = -1;
    for (let i = 0; i < c.length; i++) {
        if (c[i][9] === 'F') { first = i; break; }
    }
    if (first < 0) return null;
    for (let i = first + 1; i < c.length; i++) {
        if (c[i][9] === 'F') return i - first;       // the next instruction began
    }
    // NO SECOND `F` MEANS NO CYCLE COUNT, and returning `c.length - first`
    // here -- which this did -- returns a LOWER BOUND dressed as a
    // measurement. The README is the reason: an instruction ends when the
    // next one's first byte is read from the queue, and "there is no
    // indication from the CPU when an instruction ends, only when a new one
    // begins." A trace that stops before that has not said how long the
    // instruction was.
    //
    // It is not a rare case. Measured across the three checked-out files:
    // HALF the traces have no second F, and for `inc ax` it is ALL TEN
    // THOUSAND -- so a baseline computed the other way was mostly grading
    // against truncation, and reported 0.0% exact on 40 for that reason
    // rather than for any reason about the core.
    return null;
}

let run = 0, exact = 0, notYet = 0, ungradeable = 0;
const diffs = [];
const perFile = [];

for (const file of files) {
    const base = file.replace('.json.gz', '');
    const tests = JSON.parse(gunzipSync(readFileSync(join(dir, file))).toString('utf8'))
        .slice(0, limit);
    let fileRun = 0, fileExact = 0, threw = null;

    for (const t of tests) {
        const want = suiteCycles(t);
        if (want === null) { ungradeable++; continue; }
        for (const [addr, val] of t.initial.ram) mem[addr] = val;
        for (const r of REGS) cpu[r] = t.initial.regs[r];
        cpu.flags = t.initial.regs.flags;
        cpu.halted = false;
        let got;
        try { got = cpu.step(); } catch (e) {
            if (e instanceof Unimplemented) { threw = e.message; break; }
            threw = `THREW ${e.message}`; break;
        }
        for (const [addr] of t.initial.ram) mem[addr] = 0;
        for (const [addr] of t.final.ram) mem[addr] = 0;
        run++; fileRun++;
        if (got === want) { exact++; fileExact++; } else diffs.push(got - want);
    }
    if (threw) { notYet++; continue; }
    perFile.push([base, fileExact, fileRun, tests[0] && tests[0].name]);
}

diffs.sort((a, b) => a - b);
const median = diffs.length ? diffs[diffs.length >> 1] : 0;
const mean = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : 0;
const within = (n) => diffs.filter((d) => Math.abs(d) <= n).length;

console.log(`\nCYCLE COUNT vs the 8088 suite — ${files.length} file(s), ${run} vectors\n`);
for (const [base, ok, n, name] of perFile) {
    console.log(`  ${base.padEnd(6)} ${String(ok).padStart(5)}/${String(n).padEnd(5)} `
        + `${(100 * ok / (n || 1)).toFixed(1).padStart(5)}%   ${name || ''}`);
}
console.log(`\n  exact:        ${exact}/${run} (${(100 * exact / (run || 1)).toFixed(1)}%)`);
if (diffs.length) {
    console.log(`  within +/-1:  ${(100 * (within(1) + exact) / run).toFixed(1)}%`);
    console.log(`  within +/-4:  ${(100 * (within(4) + exact) / run).toFixed(1)}%`);
    console.log(`  error median: ${median >= 0 ? '+' : ''}${median}   mean ${mean.toFixed(2)}`);
    console.log(`  error range:  ${diffs[0]} .. ${diffs[diffs.length - 1]}`);
}
console.log(`\n  ungradeable:  ${ungradeable} vectors whose trace ends before the next`);
console.log(`                instruction begins, so the suite never states their length.`);
console.log(`                Counted, not skipped: a skip nobody reports reads like a pass.`);
console.log(`\n  bus sequence:  NOT YET — needs a BIU`);
console.log(`  queue ops:     NOT YET — needs a BIU`);
console.log(`  T-state align: NOT YET — needs a BIU`);
if (notYet) console.log(`\n  ${notYet} file(s) the core has not reached`);
console.log(`\nA NEGATIVE MEDIAN MEANS WE UNDERCOUNT. Expected: our numbers are the`);
console.log(`published 8086 timings and this is an 8088, whose 8-bit bus adds four`);
console.log(`cycles to every word access. The baseline is a distance, not a defect count.\n`);
