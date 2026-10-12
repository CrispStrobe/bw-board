// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {LINEAR_ARMS, selectDiagnosticLinearSolver,
    runWindingLinearSolverSensitivity} from '../scripts/diagnose-winding-linear-solver.mjs';
import {WINDING_LIMITS, diagnosticJson} from '../scripts/diagnose-winding-transient.mjs';

test('linear diagnostic changes only exact solver selectors and retains original baseline', () => {
    const source = readFileSync(new URL('../src/mna.js', import.meta.url), 'utf8');
    assert.equal(selectDiagnosticLinearSolver(source, 'cached-sparse'), source);
    const fresh = selectDiagnosticLinearSolver(source, 'fresh-sparse');
    assert.equal(fresh.replace('  const c = null; // diagnostic: no factor reuse', '  const c = _luCache;'), source);
    const dense = selectDiagnosticLinearSolver(source, 'dense');
    assert.match(dense, /return solve\(diagnosticDense, new Float64Array\(b\)\);/);
    assert.match(dense, /diagnosticDense.set\(row, col, A.get\(row, col\)\)/);
    assert.match(dense, /const NR_TOL = 1e-6;/);
    for (const arm of LINEAR_ARMS) {
        assert.throws(() => selectDiagnosticLinearSolver(source.replace('  const c = _luCache;', ''), arm), /exactly one/);
        assert.throws(() => selectDiagnosticLinearSolver(source + '\nfunction solveAssembled(A, b) {', arm), /exactly one/);
    }
    assert.throws(() => selectDiagnosticLinearSolver(source, 'automatic'), /Unknown/);
});

test('fresh solver selector rejects executable accidental cache reuse', () => {
    const source = 'function solveAssembled(A, b) {\n  const c = _luCache;\n return c === null ? 0 : 1;\n}';
    const invoke = body => Function('_luCache', `${body}; return solveAssembled(null, null);`)({});
    assert.equal(invoke(selectDiagnosticLinearSolver(source, 'fresh-sparse')), 0);
    assert.equal(invoke(source), 1, 'original-selector mutant demonstrably reuses cache');
});

test('hosted three real linear-solver arms retain finite authority and honest failure/completion', async t => {
    const report = await runWindingLinearSolverSensitivity();
    assert.deepEqual(report.arms.map(arm => arm.arm), LINEAR_ARMS);
    assert.equal(new Set(report.arms.map(arm => arm.selectedMnaHash)).size, 3);
    assert.equal(report.arms[0].selectedMnaHash, report.sourceHashes.mna);
    const baseline = report.arms[0].capture;
    assert.equal(baseline.completed, true, 'guarded production reuse completes unchanged-policy waveform');
    assert.equal(baseline.status.failure, null);
    for (const {capture} of report.arms) assert.equal(capture.completed, true);
    for (const {arm, capture} of report.arms) {
        assert.deepEqual(capture.initialStorage, {capacitorVoltage: 0, inductorCurrent: 0});
        assert.equal(capture.initialization, null);
        assert.deepEqual(capture.limits, WINDING_LIMITS);
        assert.deepEqual(capture.status.profile, baseline.status.profile);
        assert.ok(capture.rows.every(row => row.qualified === false));
        for (const [key, limit] of Object.entries(WINDING_LIMITS)) {
            assert.ok(capture.receipt.work[key.slice(3).toLowerCase()] <= limit);
        }
        if (capture.completed) {
            assert.equal(capture.status.accuracyMet, true);
            assert.equal(capture.status.failure, null);
            assert.equal(capture.rows.at(-1).timeNs, capture.requestedTimeNs);
        } else assert.ok(capture.error || capture.status.failure);
        t.diagnostic(diagnosticJson({arm, sourceHashes: report.sourceHashes,
            completed: capture.completed, failure: capture.status.failure,
            boundedReceipt: capture.receipt, observations: capture.rows.length}));
    }
});
