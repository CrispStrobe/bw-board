import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import assert from 'node:assert/strict';

test('the corpus harness emits deterministic machine-readable telemetry', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bw-i8086-corpus-'));
    const report = join(dir, 'report.json');
    try {
        execFileSync(process.execPath, [
            'scripts/run-i8086-corpus.mjs', '--selftest', '--report-json', report,
        ], {cwd: new URL('..', import.meta.url), stdio: 'pipe'});
        const got = JSON.parse(readFileSync(report, 'utf8'));
        assert.equal(got.schema, 'bw-board/i8086-corpus-report/v1');
        assert.equal(got.programs, 4);
        assert.deepEqual(got.tally, {
            MATCH: 0, NOINPUT: 0, ORACLE: 0, DIFFER: 0, EXITED: 1,
            LOOPING: 0, SILENT: 2, HUNG: 1, THREW: 0, NOASM: 0,
        });
        assert.ok(Array.isArray(got.refusals));
        assert.ok(Array.isArray(got.freshDifferences));
        assert.ok(Array.isArray(got.promotedPrograms));
    } finally {
        rmSync(dir, {recursive: true});
    }
});
