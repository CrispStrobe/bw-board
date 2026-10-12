// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ERROR_ANCHOR, instrumentBoardError, recordErrorWitness,
    captureWindingErrorComponents} from '../scripts/diagnose-winding-error-components.mjs';
import {diagnosticJson} from '../scripts/diagnose-winding-transient.mjs';

test('instrumentation requires exact single anchor and preserves every original line', () => {
    const original = readFileSync(new URL('../src/board.js', import.meta.url), 'utf8');
    const edited = instrumentBoardError(original);
    assert.ok(edited.includes('recordWindingError(windingErrorWitnesses, {full, half: h2'));
    assert.ok(edited.includes(ERROR_ANCHOR));
    assert.throws(() => instrumentBoardError(original.replace(ERROR_ANCHOR, '')), /exactly one/);
    assert.throws(() => instrumentBoardError(original + ERROR_ANCHOR), /exactly one/);
    const lines = edited.split('\n');
    let cursor = 0;
    for (const line of original.split('\n')) {
        while (cursor < lines.length && lines[cursor] !== line) cursor++;
        assert.ok(cursor < lines.length, `original line missing: ${line}`);
        cursor++;
    }
});

test('component oracle, incoming history snapshot and fixed floor-stop are load-bearing', () => {
    const records = [];
    const full = {nodeVoltages: new Map([['collector', 2]]), converged: true};
    const half = {nodeVoltages: new Map([['collector', 1]]), converged: true};
    const cv = new Map([['CP', 3]]);
    const state = {full, half, firstHalf: half, cv, il: new Map(), cc: new Map(), lv: new Map(),
        timeSec: 1, stepSec: 2e-12, minStepSec: 1e-12, err: 5,
        absoluteVoltage: .1, absoluteCurrent: .01, relativeTolerance: .05};
    for (let i = 0; i < 20; i++) recordErrorWitness(records, state);
    assert.equal(records.length, 9);
    assert.equal(records[0].dominant.normalizedError, 5);
    assert.equal(records[0].dominant.signedDifference, 1);
    cv.set('CP', 999);
    assert.equal(records[0].incoming.cv.CP, 3);
    recordErrorWitness(records, {...state, stepSec: 1e-12});
    assert.equal(records.at(-1).atFloor, true);
    recordErrorWitness(records, {...state, timeSec: 999});
    assert.equal(records.at(-1).timeSec, 1);
    // Executable wrong-scale mutant must violate the independently computed oracle.
    const wrongScale = recordErrorWitness.toString().replace('absolute + relativeTolerance *', 'absolute * relativeTolerance *');
    const mutated = [];
    Function(`return (${wrongScale})`)()(mutated, state);
    assert.notEqual(mutated[0].dominant.normalizedError, 5);
});

test('hosted real caller completes with guarded reuse and no floor witness', async t => {
    const report = await captureWindingErrorComponents();
    assert.equal(report.capture.completed, true);
    assert.equal(report.capture.status.failure, null);
    assert.ok(report.witnesses.length > 0 && report.witnesses.length <= 9);
    assert.ok(report.witnesses.every(witness => !witness.atFloor));
    assert.equal(report.capture.receipt.completed, true);
    assert.ok(report.capture.receipt.work.attempts < 20000);
    assert.equal(report.capture.rows.length, 51);
    assert.notEqual(report.sourceHashes.board, report.sourceHashes.instrumentedBoard);
    t.diagnostic(diagnosticJson({sourceHashes: report.sourceHashes, witnesses: report.witnesses,
        failure: report.capture.status.failure, boundedReceipt: report.capture.receipt}));
});
