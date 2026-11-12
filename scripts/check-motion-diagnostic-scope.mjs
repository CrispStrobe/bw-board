#!/usr/bin/env node
/** Narrow first-introduction scope admission; actual focused controls run separately. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const MOTION_DIAGNOSTIC_PATHS = Object.freeze({
    '.github/workflows/labwired-motion-source-profile.yml': 'added',
    '.github/workflows/ci-tier-gate.yml': 'modified',
    'LANES.md': 'modified',
    'docs/LABWIRED-MOTION-SOURCE-DIAGNOSTIC.md': 'added',
    'scripts/prepare-labwired-motion-diagnostic.mjs': 'added',
    'scripts/check-motion-diagnostic-scope.mjs': 'added',
    'test/labwired-motion-source-diagnostic.test.mjs': 'added',
    'test/motion-diagnostic-scope.test.mjs': 'added'
});

export function admitMotionDiagnosticScope ({before, after, files, expectedHead, expectedPR}) {
    assert.ok(typeof expectedHead === 'string' && /^[a-f0-9]{40}$/.test(expectedHead), 'exact expected head required');
    assert.ok(Number.isSafeInteger(expectedPR) && expectedPR > 0, 'exact PR identity required');
    assert.ok(before && after && typeof before === 'object' && typeof after === 'object', 'successful PR metadata required');
    assert.ok(before.number === expectedPR && before.number === after.number, 'PR identity');
    for (const pull of [before, after]) {
        assert.equal(pull.state, 'open', 'open PR required');
        assert.equal(pull.head?.sha, expectedHead, 'same head before/after file enumeration');
        assert.equal(pull.head?.repo?.full_name, 'CrispStrobe/bw-board', 'owned head');
        assert.equal(pull.base?.repo?.full_name, 'CrispStrobe/bw-board', 'owned base');
        assert.equal(pull.base?.ref, 'master', 'canonical base');
        assert.ok(typeof pull.base?.sha === 'string' && /^[a-f0-9]{40}$/.test(pull.base.sha), 'exact base identity');
        assert.ok(Number.isSafeInteger(pull.changed_files) && pull.changed_files > 0, 'nonempty file count');
    }
    assert.equal(before.base.sha, after.base.sha, 'stable base identity');
    assert.equal(before.changed_files, after.changed_files, 'stable file count');
    assert.ok(Array.isArray(files) && files.length === after.changed_files, 'complete file enumeration');
    const names = new Set();
    for (const row of files) {
        assert.ok(row && typeof row.filename === 'string' && typeof row.status === 'string', 'valid file row');
        assert.ok(!names.has(row.filename), 'unique file rows'); names.add(row.filename);
        assert.ok(!Object.hasOwn(row, 'previous_filename'), 'renames not admitted');
        assert.ok(Object.hasOwn(MOTION_DIAGNOSTIC_PATHS, row.filename), 'outside diagnostic-only scope');
        assert.equal(row.status, MOTION_DIAGNOSTIC_PATHS[row.filename], 'exact first-introduction status');
    }
    assert.deepEqual([...names].sort(), Object.keys(MOTION_DIAGNOSTIC_PATHS).sort(), 'complete exact diagnostic path set');
    return {diagnosticOnly: true, head: expectedHead, paths: [...names].sort(), focusedControlsRequired: true};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const [beforePath, pagesPath, afterPath, expectedHead, expectedPR] = process.argv.slice(2);
    assert.ok(beforePath && pagesPath && afterPath, 'PR metadata and complete pages required');
    const json = path => JSON.parse(readFileSync(path, 'utf8'));
    const pages = json(pagesPath);
    assert.ok(Array.isArray(pages) && pages.length > 0 && pages.every(Array.isArray), 'successful paginated file API response required');
    console.log(JSON.stringify(admitMotionDiagnosticScope({before: json(beforePath), after: json(afterPath),
        files: pages.flat(), expectedHead, expectedPR: Number(expectedPR)})));
}
