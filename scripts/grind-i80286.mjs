// Diagnostic only. All non-passes remain visible; no production CPU/timing claim.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {join} from 'node:path';
import {SST286_REVISION, parseSST286, parseRevocations, executeSST286} from './lib/sst286.mjs';

try {
    const args = process.argv.slice(2), root = process.env.I80286_VECTORS;
    if (!root) throw new Error('Set I80286_VECTORS to an external SingleStepTests/80286 checkout');
    let limit = Infinity;
    const selected = [];
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--limit') {
            limit = Number(args[++i]);
            if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('invalid --limit');
        } else if (/^[0-9A-F]{2,4}(\.[0-7])?$/i.test(args[i])) selected.push(args[i].toUpperCase());
        else throw new Error(`unknown argument ${args[i]}`);
    }
    const git = (...args) => execFileSync('git', ['-C',root,...args], {encoding:'utf8',maxBuffer:4*1024*1024}).trim();
    if (git('rev-parse','HEAD') !== SST286_REVISION) throw new Error(`suite must be pinned to ${SST286_REVISION}`);
    const entries = new Map(git('ls-tree','-r',SST286_REVISION).split('\n').map(line => {
        const [info, path] = line.split('\t'); return [path,info.split(' ')[2]];
    }));
    function verified(path) {
        const bytes = readFileSync(join(root,path));
        const blob = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
        if (blob !== entries.get(path)) throw new Error(`suite content differs from pin: ${path}`);
        return bytes;
    }
    const revocations = parseRevocations(verified('revocation_list.txt').toString('utf8'));
    const inventory = [...entries.keys()].filter(path => /^v1_real_mode\/.*\.MOO.gz$/.test(path)).sort();
    if (inventory.length !== 326) throw new Error(`expected 326 instruction files, got ${inventory.length}`);
    const files = inventory.filter(path => !selected.length || selected.includes(path.split('/')[1].replace('.MOO.gz','')));
    if (!files.length || selected.some(name => !files.includes(`v1_real_mode/${name}.MOO.gz`))) throw new Error('unmatched opcode selection');
    const report = {suiteRevision:SST286_REVISION, backend:'harris-286-boot-subset / test-only semantic memory',
        fullSuite:files.length === inventory.length && limit === Infinity, timingGraded:false, physicalBoardGraded:false,
        files:files.length, available:0, selected:0, executed:0, pass:0, fail:0, unsupported:0, budget:0, revoked:0, reasons:{}};
    for (const path of files) {
        const suite = parseSST286(gunzipSync(verified(path),{maxOutputLength:128*1024*1024}));
        report.available += suite.tests.length;
        const counts = {pass:0,fail:0,unsupported:0,budget:0,revoked:0};
        let firstFailure;
        for (const t of suite.tests.slice(0,limit)) {
            report.selected++;
            if (revocations.has(t.hash)) {counts.revoked++; report.revoked++; continue;}
            const result = executeSST286(t,suite.masks);
            report[result.status]++; counts[result.status]++;
            if (result.executed) report.executed++;
            if (result.reason) report.reasons[result.reason] = (report.reasons[result.reason] ?? 0) + 1;
            if (result.status === 'fail' && !firstFailure) firstFailure = {index:t.index,hash:t.hash,name:t.name,diffs:result.diffs};
        }
        console.log(JSON.stringify({file:path,...counts,...(firstFailure ? {firstFailure} : {})}));
    }
    report.accepted = report.selected > report.revoked && report.fail === 0 && report.unsupported === 0 && report.budget === 0;
    console.log(JSON.stringify({summary:report}));
    process.exitCode = report.accepted ? 0 : 1;
} catch (error) { console.error(error.message); process.exitCode = 2; }
