import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {changeDiagnosticNewtonTolerance, bindDiagnosticImports, prepareNewtonArm,
    runWindingNewtonSensitivity, NEWTON_ARMS} from '../scripts/diagnose-winding-newton-sensitivity.mjs';
import {WINDING_LIMITS, diagnosticJson} from '../scripts/diagnose-winding-transient.mjs';

test('Newton diagnostic preparation changes only the one reviewed in-memory tolerance', () => {
    assert.deepEqual(NEWTON_ARMS, [1e-6, 1e-10]);
    const baseline = prepareNewtonArm(1e-6), strict = prepareNewtonArm(1e-10);
    assert.ok(baseline.editedMna === baseline.originals.mna, 'baseline retains exact source bytes');
    assert.ok(strict.editedMna.replace('const NR_TOL = 1e-10;', 'const NR_TOL = 1e-6;') === strict.originals.mna,
        'only the reviewed NR tolerance changes');
    assert.deepEqual(baseline.sourceHashes, strict.sourceHashes);
    assert.ok(baseline.originals.board === strict.originals.board, 'same Board source');
    assert.ok(baseline.originals.caller === strict.originals.caller, 'same capture caller');
    const decode = url => Buffer.from(url.split(',')[1], 'base64').toString();
    const captureSource = decode(strict.moduleUrl);
    const boardSource = decode(captureSource.match(/from "(data:text\/javascript;base64,[^"]+)"/)[1]);
    const mnaUrls = [...boardSource.matchAll(/from "(data:text\/javascript;base64,[^"]+)"/g)].map(match => match[1]);
    assert.equal(mnaUrls.length, 2, 'both actual Board imports bind isolated MNA');
    assert.ok(mnaUrls[0] === mnaUrls[1], 'same module instance for both MNA exports');
    const actualMna = decode(mnaUrls[0]);
    assert.match(actualMna, /const NR_TOL = 1e-10;/);
    assert.doesNotMatch(actualMna, /const NR_TOL = 1e-6;/);
    for (const tolerance of [0, 1e-8, 1, NaN]) assert.throws(() => prepareNewtonArm(tolerance));
    assert.throws(() => changeDiagnosticNewtonTolerance('missing', 1e-10), /exactly one/);
    assert.throws(() => changeDiagnosticNewtonTolerance('const NR_TOL = 1e-6; const NR_TOL = 1e-6;', 1e-10), /exactly one/);
});

test('executable original-module routing mutant fails the actual selector assertion', async () => {
    const original = readFileSync(new URL('../scripts/diagnose-winding-newton-sensitivity.mjs', import.meta.url), 'utf8');
    const start = original.indexOf('export function bindDiagnosticImports ');
    const end = original.indexOf('\nexport function prepareNewtonArm ', start);
    assert.ok(start >= 0 && end > start);
    const body = original.slice(start, end);
    const anchor = 'overrides.get(specifier) ?? new URL(specifier, origin).href';
    assert.equal(body.split(anchor).length - 1, 1);
    const mutant = await import(`data:text/javascript;base64,${Buffer.from(
        body.replace(anchor, 'new URL(specifier, origin).href')).toString('base64')}`);
    const result = mutant.bindDiagnosticImports("import {solveMNA} from './mna.js';", 'file:///public-source/src/board.js',
        new Map([['./mna.js', 'data:reviewed-arm']]));
    assert.throws(() => assert.match(result.source, /from "data:reviewed-arm"/), assert.AssertionError);
});

test('diagnostic import binding routes both real Board solver imports to the same isolated arm', () => {
    const source = "import {solveMNA} from './mna.js'; import {junctionModelOf} from './mna.js'; import {getDevice} from './devices.js';";
    const result = bindDiagnosticImports(source, 'file:///public-source/src/board.js', new Map([['./mna.js', 'data:reviewed-arm']]));
    assert.equal(result.used.get('./mna.js'), 2);
    assert.equal(result.source.split('from "data:reviewed-arm"').length - 1, 2);
    assert.match(result.source, /from "file:\/\/\/public-source\/src\/devices.js"/);
});

test('actual fixed-arm Newton sensitivity retains zero storage and finite authority regardless of outcome', async t => {
    const report = await runWindingNewtonSensitivity();
    assert.equal(report.arms.length, 2);
    assert.equal(report.productionPolicyChanged, false);
    assert.equal(report.oracleAgreement, 'not-tested');
    assert.deepEqual(report.arms.map(arm => arm.newtonTolerance), NEWTON_ARMS);
    assert.deepEqual(report.arms[0].sourceHashes, report.arms[1].sourceHashes);
    assert.notEqual(report.arms[0].editedMnaHash, report.arms[1].editedMnaHash);
    assert.deepEqual(report.arms[0].capture.status.profile, report.arms[1].capture.status.profile);
    const baseline = report.arms[0].capture;
    assert.equal(baseline.completed, true, 'current guarded-reuse baseline completes');
    assert.equal(baseline.status.failure, null);
    for (const arm of report.arms) {
        const capture = arm.capture;
        assert.deepEqual(capture.initialStorage, {capacitorVoltage: 0, inductorCurrent: 0});
        assert.equal(capture.initialization, null);
        assert.equal(capture.status.profile.id, 'precision-v1');
        assert.deepEqual(capture.limits, WINDING_LIMITS);
        assert.ok(capture.rows.every(row => row.qualified === false));
        assert.ok(capture.receipt, diagnosticJson(capture));
        for (const [key, limit] of Object.entries(WINDING_LIMITS)) {
            assert.ok(capture.receipt.work[key.slice(3).toLowerCase()] <= limit);
        }
        if (capture.completed) {
            assert.equal(capture.status.accuracyMet, true);
            assert.equal(capture.status.failure, null);
            assert.equal(capture.receipt.completed, true);
            assert.equal(capture.rows.at(-1).timeNs, capture.requestedTimeNs);
        } else {
            assert.ok(capture.error || capture.status.failure);
        }
        t.diagnostic(diagnosticJson({newtonTolerance: arm.newtonTolerance,
            sourceHashes: arm.sourceHashes, editedMnaHash: arm.editedMnaHash,
            completed: capture.completed, failure: capture.status.failure,
            boundedReceipt: capture.receipt, observations: capture.rows.length}));
    }
    // This is method validity, not an assertion that tighter Newton solves fix it.
});
