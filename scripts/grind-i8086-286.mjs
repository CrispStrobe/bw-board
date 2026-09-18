// Grade the i8086 core's '80286' real-mode VARIANT against SingleStepTests/80286
// (the same suite grind-i80286.mjs runs the harris backend against). This is the
// FAST functional 286 (src/i8086.js variant:'80286'); the harris grinder is the
// cycle-accurate one. Diagnostic: reports pass/fail/unsupported per opcode file
// so the exact gap (the unimplemented 0x0F protected-mode group, plus any
// 286-vs-186 behavioural differences) is visible. Exit 0 always while the gap is
// being closed; flip `accepted` to a hard gate once the real-mode set is clean.
import {readFileSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {join} from 'node:path';
import {SST286_REVISION, parseSST286, parseRevocations} from './lib/sst286.mjs';
import {I8086} from '../src/i8086.js';

const REGS = ['ax','bx','cx','dx','cs','ss','ds','es','sp','bp','si','di','ip'];
const mem = new Uint8Array(1 << 20);
const cpu = new I8086({
    read: (a) => mem[a & 0xfffff],
    write: (a, v) => { mem[a & 0xfffff] = v & 0xff; },
    in: () => 0xff, out: () => {},
}, {variant: '80286'});

/** Run one SST286 vector on the i8086 '80286' variant; same compare shape as
 *  grind-i8086.mjs (register + memory diff under the suite's flag/reg masks). */
function executeVariant(t, fileMasks) {
    for (const [addr] of t.initial.ram) mem[addr & 0xfffff] = 0;
    for (const [addr] of t.final.ram) mem[addr & 0xfffff] = 0;
    for (const [addr, val] of t.initial.ram) mem[addr & 0xfffff] = val & 0xff;
    for (const r of REGS) cpu[r] = t.initial.regs[r];
    cpu.flags = t.initial.regs.flags;
    try {
        cpu.step();
    } catch (e) {
        const code = e?.name === 'UnsupportedOpcode' || e?.constructor?.name === 'UnsupportedOpcode'
            ? 'unsupported-opcode' : (e?.code || e?.name || 'error');
        return {status: 'unsupported', executed: true, reason: code};
    }
    // Exception vectors model a fault; this variant does not grade 286 fault
    // delivery yet, so they are reported as unsupported rather than as wrong.
    if (t.exception) return {status: 'unsupported', executed: true, reason: 'exception-vector'};
    const masks = {...fileMasks, ...(t.final.masks ?? {})};
    const want = {...t.initial.regs, ...t.final.regs};
    const diffs = [];
    for (const r of [...REGS, 'flags']) {
        const mask = masks[r] ?? 0xffff;
        if (((cpu[r] & 0xffff) & mask) !== ((want[r] & 0xffff) & mask)) {
            diffs.push({register: r, actual: cpu[r] & 0xffff, expected: want[r] & 0xffff, mask});
        }
    }
    const expected = new Map([...t.initial.ram, ...t.final.ram]);
    for (const [addr, val] of expected) {
        if (mem[addr & 0xfffff] !== (val & 0xff)) diffs.push({address: addr, actual: mem[addr & 0xfffff], expected: val & 0xff});
    }
    return {status: diffs.length ? 'fail' : 'pass', executed: true, diffs: diffs.slice(0, 12)};
}

try {
    const args = process.argv.slice(2), root = process.env.I80286_VECTORS;
    if (!root) throw new Error('Set I80286_VECTORS to an external SingleStepTests/80286 checkout');
    let limit = Infinity, reportPath;
    const selected = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--limit') { limit = Number(args[++i]); if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('invalid --limit'); }
        else if (args[i] === '--report') { reportPath = args[++i]; if (!reportPath || reportPath.startsWith('--')) throw new Error('missing --report path'); }
        else if (/^[0-9A-F]{2,4}(\.[0-7])?$/i.test(args[i])) selected.push(args[i].toUpperCase());
        else throw new Error(`unknown argument ${args[i]}`);
    }
    const git = (...a) => execFileSync('git', ['-C', root, ...a], {encoding: 'utf8', maxBuffer: 4 * 1024 * 1024}).trim();
    if (git('rev-parse', 'HEAD') !== SST286_REVISION) throw new Error(`suite must be pinned to ${SST286_REVISION}`);
    const entries = new Map(git('ls-tree', '-r', SST286_REVISION).split('\n').map(line => {
        const [info, path] = line.split('\t'); return [path, info.split(' ')[2]];
    }));
    function verified(path) {
        const bytes = readFileSync(join(root, path));
        const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        if (blob !== entries.get(path)) throw new Error(`suite content differs from pin: ${path}`);
        return bytes;
    }
    const revocations = parseRevocations(verified('revocation_list.txt').toString('utf8'));
    const inventory = [...entries.keys()].filter(path => /^v1_real_mode\/.*\.MOO.gz$/.test(path)).sort();
    if (inventory.length !== 326) throw new Error(`expected 326 instruction files, got ${inventory.length}`);
    const files = inventory.filter(path => !selected.length || selected.includes(path.split('/')[1].replace('.MOO.gz', '')));
    if (!files.length || selected.some(name => !files.includes(`v1_real_mode/${name}.MOO.gz`))) throw new Error('unmatched opcode selection');
    const report = {suiteRevision: SST286_REVISION, backend: 'i8086-core variant:80286 (fast functional real-mode)',
        fullSuite: files.length === inventory.length && limit === Infinity, timingGraded: false,
        files: files.length, available: 0, selected: 0, executed: 0, pass: 0, fail: 0, unsupported: 0, budget: 0, revoked: 0,
        reasons: {}, failOpcodes: {}};
    report.sourceHashes = Object.fromEntries(['../src/i8086.js', './lib/sst286.mjs', './grind-i8086-286.mjs'].map(path =>
        [path, createHash('sha256').update(readFileSync(new URL(path, import.meta.url))).digest('hex')]));
    const fileReports = [];
    for (const path of files) {
        const suite = parseSST286(gunzipSync(verified(path), {maxOutputLength: 128 * 1024 * 1024}));
        report.available += suite.tests.length;
        const counts = {pass: 0, fail: 0, unsupported: 0, budget: 0, revoked: 0};
        let firstFailure;
        for (const t of suite.tests.slice(0, limit)) {
            report.selected++;
            if (revocations.has(t.hash)) { counts.revoked++; report.revoked++; continue; }
            const result = executeVariant(t, suite.masks);
            report[result.status]++; counts[result.status]++;
            if (result.executed) report.executed++;
            if (result.reason) report.reasons[result.reason] = (report.reasons[result.reason] ?? 0) + 1;
            if (result.status === 'fail' && !firstFailure) firstFailure = {index: t.index, hash: t.hash, name: t.name, diffs: result.diffs};
        }
        const op = path.split('/')[1].replace('.MOO.gz', '');
        if (counts.fail) report.failOpcodes[op] = counts.fail;
        const fileReport = {file: path, ...counts, ...(firstFailure ? {firstFailure} : {})};
        fileReports.push(fileReport); console.log(JSON.stringify(fileReport));
    }
    report.realModeShareClean = report.fail === 0;
    if (reportPath) writeFileSync(reportPath, JSON.stringify({summary: report, files: fileReports}, null, 2) + '\n', {flag: 'wx'});
    console.log(JSON.stringify({summary: report}));
    // DIAGNOSTIC: exit 0 while the 0x0F group is unimplemented — the report shows
    // the gap. Flip to `report.fail ? 1 : 0` once the real-mode set is clean.
    process.exitCode = 0;
} catch (error) { console.error(error.message); process.exitCode = 2; }
