import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const workflow = readFileSync(new URL('../.github/workflows/ci-tier-gate.yml', import.meta.url), 'utf8');
const shell = workflow.split('        run: |\n')[1].split('\n').map(line => line.startsWith('          ') ? line.slice(10) : line).join('\n');
const head = 'a'.repeat(40);

function runGate({hasLocal = 'true', hasFull = 'false', body = '', rows = [{filename: 'src/board.js', status: 'modified'}]} = {}) {
    const temp = mkdtempSync(join(tmpdir(), 'bw-ci-local-gate-'));
    mkdirSync(join(temp, 'bin'));
    writeFileSync(join(temp, 'files.txt'), rows.map(row => row.filename).join('\n') + '\n');
    writeFileSync(join(temp, 'body.txt'), body + '\n');
    writeFileSync(join(temp, 'bin', 'gh'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const path = args.find(arg => arg.startsWith('repos/'));
if (!path) process.exit(46);
if (path.endsWith('/files')) console.log(fs.readFileSync(process.env.FAKE_FILES, 'utf8').trim());
else console.log(fs.readFileSync(process.env.FAKE_BODY, 'utf8').trim());
`, {mode: 0o755});
    try {
        return spawnSync('/bin/bash', ['-c', shell], {
            cwd: new URL('../', import.meta.url),
            encoding: 'utf8',
            timeout: 15000,
            maxBuffer: 512 * 1024,
            env: {
                PATH: join(temp, 'bin') + ':' + process.env.PATH,
                RUNNER_TEMP: temp,
                GH_TOKEN: 'fixture-no-network',
                REPO: 'CrispStrobe/bw-board',
                PR: '733',
                EXPECTED_HEAD: head,
                HAS_FULL: hasFull,
                HAS_LOCAL: hasLocal,
                FAKE_FILES: join(temp, 'files.txt'),
                FAKE_BODY: join(temp, 'body.txt'),
            },
        });
    } finally {
        rmSync(temp, {recursive: true, force: true});
    }
}

test('CI gate accepts exact-head local/Kaggle validation without the thorough tier', () => {
    assert.match(workflow, /ci:local/);
    assert.match(workflow, /HAS_LOCAL/);
    assert.match(workflow, /Local-validation:/);
    assert.match(workflow, /PASS/);
    assert.match(workflow, /EXPECTED_HEAD/);
    assert.match(workflow, /does not start the thorough GitHub tier/);
    const result = runGate({body: `Local-validation: ${head} PASS local: node --test`});
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /exact-head validation present/);
});

test('CI gate rejects missing, stale or prefix-only local evidence', () => {
    for (const body of [
        '',
        `Local-validation: ${head} local: node --test`,
        'Local-validation: ' + 'b'.repeat(40) + ' PASS local: node --test',
        `prefix Local-validation: ${head} PASS local: node --test`,
    ]) {
        const result = runGate({body});
        assert.notEqual(result.status, 0, body);
        assert.match(result.stdout, /ci:local requires/);
    }
});

test('CI gate keeps docs-only and first-introduction diagnostic behavior', () => {
    const docs = runGate({hasLocal: 'false', rows: [{filename: 'docs/example.md', status: 'added'}]});
    assert.equal(docs.status, 0, docs.stderr);
    assert.match(docs.stdout, /Docs-only PR/);
    assert.match(workflow, /check-motion-diagnostic-scope\.mjs/);
    assert.match(workflow, /every other enabled fast check remains required/);
});
