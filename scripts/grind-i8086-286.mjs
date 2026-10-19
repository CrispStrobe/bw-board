// Grade the i8086 core's '80286' real-mode VARIANT against SingleStepTests/80286
// (the same suite grind-i80286.mjs runs the harris backend against). This is the
// FAST functional 286 (src/i8086.js variant:'80286'). The separate Harris
// grinder exercises a test-only semantic adapter; neither runner grades timing
// or a physical board. This command is a hard functional gate.
import {readFileSync, writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {SST286_REVISION, parseSST286, parseRevocations} from './lib/sst286.mjs';
import {fast286ExitCode, fast286Verdict} from './lib/fast286-verdict.mjs';
import {I8086} from '../src/i8086.js';

const REGS = ['ax','bx','cx','dx','cs','ss','ds','es','sp','bp','si','di','ip'];
const mem = new Uint8Array(1 << 24);
const generation = new Uint32Array(1 << 24);
let currentGeneration = 0;
const writes = new Set();
const cpu = new I8086({
    read: (a) => generation[a & 0xffffff] === currentGeneration ? mem[a & 0xffffff] : 0,
    write: (a, v) => { a &= 0xffffff; mem[a] = v & 0xff; generation[a] = currentGeneration; writes.add(a); },
    in: () => 0xff, out: () => {},
}, {variant: '80286'});

/** Run one SST286 vector on the i8086 '80286' variant; same compare shape as
 *  grind-i8086.mjs (register + memory diff under the suite's flag/reg masks). */
function executeVariant(t, fileMasks) {
    currentGeneration = (currentGeneration + 1) >>> 0;
    if (currentGeneration === 0) { generation.fill(0); currentGeneration = 1; }
    writes.clear();
    for (const [addr, val] of t.initial.ram) {
        const a = addr & 0xffffff; mem[a] = val & 0xff; generation[a] = currentGeneration;
    }
    // Fresh internal state each vector: the cpu is reused, and leftover halted /
    // _rep / _seg / msw from the prior test's terminating HALT would corrupt the
    // next. reset() clears them (and sets msw to 0xfff0, matching executeSST286);
    // the register overlay below then installs this vector's initial state.
    cpu.reset();
    for (const r of REGS) cpu[r] = t.initial.regs[r];
    cpu.flags = t.initial.regs.flags;
    // Capture the vector the CPU delivers (fault or software INT) so exception
    // vectors can be graded, not just skipped. Reset per test; only the primary
    // delivery fires it (the injected HALT below does not).
    let observedInterrupt = null;
    cpu.onInterrupt = (e) => { if (observedInterrupt === null) observedInterrupt = e.vector; };
    try {
        cpu.step();                       // the instruction under test
        // SST286 terminates every test with an injected HALT (0xF4): the CPU
        // executes the instruction AND that HALT, so the recorded final ip is
        // one past it. Consume it here (matching executeSST286) without
        // corrupting the memory the final state compares against.
        if (!cpu.halted) {
            const p = cpu._phys(cpu.cs, cpu.ip);
            const saved = cpu.read(p);
            cpu.write(p, 0xf4);
            cpu.step();
            cpu.write(p, saved);
        }
    } catch (e) {
        const code = e?.name === 'UnsupportedOpcode' || e?.constructor?.name === 'UnsupportedOpcode'
            ? 'unsupported-opcode' : (e?.code || e?.name || 'error');
        return {status: 'unsupported', executed: true, reason: code};
    }
    // Exception vectors are graded, not skipped: the 286 delivers the fault
    // inline (rewinding to the faulting IP for restart faults, jumping through
    // the real-mode IVT), and the HALT-consume above steps the handler's
    // injected terminator — leaving the CPU in the post-delivery state the suite
    // records. The delivered vector is compared against t.exception.number.
    const masks = {...fileMasks, ...(t.final.masks ?? {})};
    const want = {...t.initial.regs, ...t.final.regs};
    const diffs = [];
    if (observedInterrupt !== (t.exception?.number ?? null)) {
        diffs.push({interrupt: observedInterrupt, expected: t.exception?.number ?? null});
    }
    for (const r of [...REGS, 'flags']) {
        const mask = masks[r] ?? 0xffff;
        if (((cpu[r] & 0xffff) & mask) !== ((want[r] & 0xffff) & mask)) {
            diffs.push({register: r, actual: cpu[r] & 0xffff, expected: want[r] & 0xffff, mask});
        }
    }
    const expected = new Map([...t.initial.ram, ...t.final.ram]);
    for (const addr of new Set([...expected.keys(), ...writes])) {
        const val = expected.get(addr) ?? 0;
        // The pushed FLAGS word (at t.exception.flagAddress, two bytes) carries
        // the flags mask so undefined flag bits are not graded; every other byte
        // is compared exactly. Mirrors executeSST286's memory comparison.
        const shift = t.exception ? (addr - t.exception.flagAddress) : -1;
        const mask = (shift === 0 || shift === 1) ? ((masks.flags ?? 0xffff) >> (shift * 8)) & 0xff : 0xff;
        const actual = cpu.read(addr);
        if ((actual & mask) !== ((val & 0xff) & mask)) {
            diffs.push({address: addr, actual, expected: val & 0xff, mask});
        }
    }
    return {status: diffs.length ? 'fail' : 'pass', executed: true, diffs: diffs.slice(0, 12)};
}

export {executeVariant};

const invokedAsCLI = process.argv[1] !== undefined
    && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsCLI) try {
    const args = process.argv.slice(2), root = process.env.I80286_VECTORS;
    if (!root) throw new Error('Set I80286_VECTORS to an external SingleStepTests/80286 checkout (e.g. ~/code/80286-vectors)');
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
        fullSuite: files.length === inventory.length && limit === Infinity,
        timingGraded: false, physicalBoardGraded: false,
        files: files.length, available: 0, selected: 0, executed: 0, pass: 0, fail: 0, unsupported: 0, budget: 0, revoked: 0,
        reasons: {}, failOpcodes: {}};
    report.sourceHashes = Object.fromEntries(['../src/i8086.js', './lib/sst286.mjs', './lib/fast286-verdict.mjs', './grind-i8086-286.mjs'].map(path =>
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
            if (!['pass', 'fail', 'unsupported', 'budget'].includes(result.status)) {
                throw new Error(`unknown execution status: ${result.status}`);
            }
            report[result.status]++; counts[result.status]++;
            if (result.executed) report.executed++;
            if (result.reason) report.reasons[result.reason] = (report.reasons[result.reason] ?? 0) + 1;
            if (result.status === 'fail' && !firstFailure) firstFailure = {index: t.index, hash: t.hash, name: t.name, diffs: result.diffs,
                initIp: t.initial.regs.ip, finIp: t.final.regs.ip, bytes: t.bytes, bytesLen: t.bytes.length,
                init: {si: t.initial.regs.si, di: t.initial.regs.di, cx: t.initial.regs.cx, flags: t.initial.regs.flags},
                fin: {si: t.final.regs.si, di: t.final.regs.di, cx: t.final.regs.cx}, exc: t.exception?.number ?? null};
        }
        const op = path.split('/')[1].replace('.MOO.gz', '');
        if (counts.fail) report.failOpcodes[op] = counts.fail;
        const fileReport = {file: path, ...counts, ...(firstFailure ? {firstFailure} : {})};
        fileReports.push(fileReport); console.log(JSON.stringify(fileReport));
    }
    report.coverage = limit === Infinity ? 'full' : `first-${limit}-per-file`;
    Object.assign(report, fast286Verdict(report));
    if (reportPath) writeFileSync(reportPath, JSON.stringify({summary: report, files: fileReports}, null, 2) + '\n', {flag: 'wx'});
    console.log(JSON.stringify({summary: report}));
    process.exitCode = fast286ExitCode(report);
} catch (error) { console.error(error.message); process.exitCode = 2; }
