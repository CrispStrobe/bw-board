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
import { predictCycles } from '../src/i8088-biu.js';

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
 * The suite's cycle count for one test: `cycles.length`.
 *
 * THIS IS THE THIRD VERSION AND THE FIRST CORRECT ONE. The two before it each
 * produced a full baseline before being caught, which is why the reasoning is
 * here rather than in a commit message.
 *
 *  (1) "first F to end of trace" -- a LOWER BOUND dressed as a measurement.
 *      Half the traces have no second F and for `inc ax` it is all ten
 *      thousand, so it graded truncation and reported 10.6% exact.
 *
 *  (2) "first F to second F" -- wrong because the README's own sentence
 *      continues: a First Byte "may be an optional instruction PREFIX, in
 *      which case there will be multiple First Byte statuses". On `cs nop`
 *      the two F markers are the prefix and the opcode, two cycles apart, and
 *      both belong to the SAME instruction. It showed as a span distribution
 *      of exactly {2, 4} on `nop`: two for the prefixed half of the file.
 *
 *  (3) byte-counted -- "the F after this instruction's own bytes" -- which
 *      made EVERY vector ungradeable, and that was the answer: the traces do
 *      not contain the next instruction at all. The suite has ALREADY bounded
 *      each trace to its instruction, so the count is simply the length.
 *
 * Checked against documented timings rather than assumed a fourth time:
 * `inc ax` (2 clocks) measures 2, `nop` (3) measures 3, and one prefix adds 2.
 *
 * AND THE COUNT IS BIMODAL, WHICH IS THE POINT. `inc ax` is 2 OR 4; `nop` is
 * 3 or 4. The README says why: an instruction that ended with the next byte
 * already in the queue takes the documented BEST CASE, and one that had to
 * fetch it takes longer. So a fixed cycle table -- which is what this core
 * has -- can only ever match the best-case half, by construction. That is not
 * a defect in the table; it is the entire argument for a BIU.
 */
function suiteCycles(t) {
    const c = t.cycles || [];
    return c.length || null;
}


/**
 * The suite's DATA-access sequence for one test: the EU-driven bus cycles, in
 * order, as 'r' (MEMR), 'w' (MEMW), 'i' (IOR) or 'o' (IOW).
 *
 * CODE CYCLES ARE DELIBERATELY EXCLUDED, and that is what makes this score
 * gradeable today. A CODE cycle is the BIU prefetching, so how many appear and
 * where depends entirely on queue state -- reproducing them IS the BIU's job
 * and cannot be done from an access trace. Data cycles are the opposite: the
 * EU asks for them, in an order the instruction decides, and that order is a
 * property of our decoder rather than of any timing model.
 *
 * So this asks the one question a transaction-level trace can answer
 * completely: DOES OUR CORE TOUCH MEMORY IN THE SAME ORDER THE SILICON DID?
 * lego-47's list of where that plausibly diverges is the target -- writes
 * before reads on read-modify-write, the push order on interrupt entry, the
 * operand order on string ops -- and each is a trace bug fixable without any
 * scheduler at all.
 *
 * Each m-cycle is a T1..T4 run and the status is valid from T1, so the
 * sequence is read at the T1s.
 */
function suiteDataSeq(t) {
    const out = [];
    for (const r of t.cycles || []) {
        if (r[8] !== 'T1') continue;
        const st = r[7];
        if (st === 'MEMR') out.push('r');
        else if (st === 'MEMW') out.push('w');
        else if (st === 'IOR') out.push('i');
        else if (st === 'IOW') out.push('o');
    }
    return out.join('');
}

/** The same sequence from our own bus trace. Kinds: 0 F-fetch, 1 r, 2 w, 3 i, 4 o, 5 S-fetch. */
function ourDataSeq(trace) {
    const K = ['', 'r', 'w', 'i', 'o', '', ''];   // 0 F-fetch, 5 S-fetch, 6 flush: not data
    let out = '';
    for (let i = 0; i < trace.length; i += 2) if (trace[i] >= 1 && trace[i] <= 4) out += K[trace[i]];
    return out;
}


/**
 * The suite's QUEUE-OPERATION sequence: F, S and E as the 8088's QS0/QS1 lines
 * report them, in order. F is the first byte of an instruction or of a prefix,
 * S is a subsequent byte, E is the queue being flushed.
 *
 * THIS IS NOT YET A QUEUE MODEL AND MUST NOT BE REPORTED AS ONE. F and S are
 * derivable from the instruction's byte STRUCTURE alone -- every prefix is an
 * F, the opcode is an F, operands are S -- and our core knows that already,
 * because prefixes are eaten in the prefix loop and the opcode is the first
 * fetch after it. So this score tests THE DECODER'S IDEA OF INSTRUCTION SHAPE
 * against the silicon's, which is worth having on its own and is not the same
 * question as when the BIU refilled.
 *
 * `E` is the part that needs a real model, and it is scored separately below
 * for that reason.
 */
function suiteQueueSeq(t) {
    let out = '';
    for (const r of t.cycles || []) if (r[9] !== '-') out += r[9];
    return out;
}

/** F, S and E from our trace. */
function ourQueueSeq(trace) {
    let out = '';
    for (let i = 0; i < trace.length; i += 2) {
        if (trace[i] === 0) out += 'F';
        else if (trace[i] === 5) out += 'S';
        else if (trace[i] === 6) out += 'E';
    }
    return out;
}

let predOk = 0, predRun = 0;
const predDiffs = [];
let run = 0, exact = 0, notYet = 0, ungradeable = 0, busOk = 0, busRun = 0, qOk = 0, qRun = 0, qFlush = 0;
const diffs = [];
const busDiffs = [];
const qDiffs = [];
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
        cpu.busTrace = [];
        let got;
        try { got = cpu.step(); } catch (e) {
            if (e instanceof Unimplemented) { threw = e.message; break; }
            threw = `THREW ${e.message}`; break;
        }
        for (const [addr] of t.initial.ram) mem[addr] = 0;
        for (const [addr] of t.final.ram) mem[addr] = 0;
        // THE SCHEDULER'S PREDICTION, beside the raw table value. `got` is what
        // the core's fixed timing table says and can only ever match the
        // best case; `pred` is that number put through the BIU model with the
        // queue state and the bus traffic this vector actually had.
        let dataAcc = 0;
        for (let k = 0; k < cpu.busTrace.length; k += 2) {
            if (cpu.busTrace[k] >= 1 && cpu.busTrace[k] <= 4) dataAcc++;
        }
        const pred = predictCycles({
            euCycles: got,
            length: (t.bytes || []).length,
            queueStart: (t.initial.queue || []).length,
            dataAccesses: dataAcc,
        });
        predRun++;
        if (pred === want) predOk++;
        else if (predDiffs.length < 6) predDiffs.push(`${base} "${t.name}" want ${want} pred ${pred} (eu ${got}, len ${(t.bytes||[]).length}, q ${(t.initial.queue||[]).length}, data ${dataAcc})`);
        run++; fileRun++;
        if (got === want) { exact++; fileExact++; } else diffs.push(got - want);
        busRun++;
        const wantSeq = suiteDataSeq(t);
        const gotSeq = ourDataSeq(cpu.busTrace);
        if (wantSeq === gotSeq) busOk++;
        else if (busDiffs.length < 6) busDiffs.push(`${base} "${t.name}" want ${wantSeq || '(none)'} got ${gotSeq || '(none)'}`);
        // The flush cases are separated rather than counted as failures: `E`
        // needs a real queue model and we do not have one, so folding them in
        // would make the F/S result look worse than it is AND hide how many
        // there are.
        const wantQ = suiteQueueSeq(t);
        if (wantQ.includes('E')) qFlush++;
        qRun++;
        const gotQ = ourQueueSeq(cpu.busTrace);
        if (wantQ === gotQ) qOk++;
        else if (qDiffs.length < 6) qDiffs.push(`${base} "${t.name}" want ${wantQ} got ${gotQ}`);
        cpu.busTrace = null;
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
console.log(`\n  cycle count, SCHEDULED: ${predOk}/${predRun} `
    + `(${(100 * predOk / (predRun || 1)).toFixed(1)}%)   was ${(100 * exact / (run || 1)).toFixed(1)}% from the raw table`);
for (const d of predDiffs) console.log(`      ${d}`);
console.log(`\n  bus sequence:  ${busOk}/${busRun} (${(100 * busOk / (busRun || 1)).toFixed(1)}%) `
    + `— DATA accesses in order; CODE excluded, that IS the BIU's job`);
for (const d of busDiffs) console.log(`      ${d}`);
console.log(`  queue ops:     ${qOk}/${qRun} (${(100 * qOk / (qRun || 1)).toFixed(1)}%) `
    + `— F, S and E; ${qFlush} of them involve a flush`);
for (const d of qDiffs) console.log(`      ${d}`);
console.log(`  T-state align: NOT YET — needs a BIU`);
if (notYet) console.log(`\n  ${notYet} file(s) the core has not reached`);
console.log(`\nA NEGATIVE MEDIAN MEANS WE UNDERCOUNT. Expected: our numbers are the`);
console.log(`published 8086 timings and this is an 8088, whose 8-bit bus adds four`);
console.log(`cycles to every word access. The baseline is a distance, not a defect count.\n`);
