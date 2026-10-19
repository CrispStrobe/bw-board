// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {compareWindingReference, runWindingReferenceComparison, comparisonExitCode,
    AGREEMENT_BOUNDS} from '../scripts/compare-winding-reference.mjs';
import {REFERENCE_TIMES_NS, REFINEMENT_BOUNDS} from '../scripts/diagnose-winding-uic-reference.mjs';

function fixture () {
    const engine = {schema: 'winding-transient-diagnostic-v1', scenario: 'zero-storage',
        profile: 'precision-v1', initializationMode: 'zero-storage', initialization: null,
        initialStorage: {capacitorVoltage: 0, inductorCurrent: 0}, completed: true, error: null,
        status: {accuracyMet: true, failure: null}, requestedTimeNs: '1010000', stepNs: '20000',
        limits: {maxAttempts: 20000, maxSolves: 60001, maxAdvances: 200},
        receipt: {completed: true, failure: null, requestedTimeNs: '1010000',
            work: {attempts: 100, solves: 300, advances: 51}},
        rows: Array.from({length: 51}, (_, i) => ({timeNs: String(Math.min((i + 1) * 20000, 1010000)),
            qualified: false, collectorVoltage: 2, inductorCurrent: .03}))};
    const reference = {schema: 'winding-uic-reference-v1',
        refinement: {stable: true, bounds: {...REFINEMENT_BOUNDS}},
        arms: [100, 50, 25].map(maxStepNs => ({maxStepNs, startupStepNs: maxStepNs / 100,
            zeroStorage: true, measurements: REFERENCE_TIMES_NS.map(timeNs =>
                ({timeNs, voltage: 2, current: .03}))}))};
    return {engine, reference};
}

test('pure aligned comparison reports signs, units, fixed bounds and real disagreement', () => {
    const {engine, reference} = fixture();
    let report = compareWindingReference(engine, reference);
    assert.equal(report.agreement, true);
    assert.deepEqual(report.comparisons.map(row => row.timeNs), [500000, 1000000, 1010000]);
    assert.deepEqual(AGREEMENT_BOUNDS, {voltage: .0001, current: .000001});
    engine.rows[24].collectorVoltage += .0002;
    engine.rows[50].inductorCurrent -= .000002;
    report = compareWindingReference(engine, reference);
    assert.equal(report.agreement, false);
    assert.ok(report.comparisons[0].voltage.signedError > 0);
    assert.ok(report.comparisons[2].current.signedError < 0);
    assert.equal(comparisonExitCode(report), 1);
    assert.equal(comparisonExitCode({agreement: true}), 0);
});

test('pure incomplete, shifted, duplicate, nonfinite, OP and forged stability evidence refuses', () => {
    const edits = [
        ({engine}) => {engine.completed = false;},
        ({engine}) => {engine.receipt.completed = false;},
        ({engine}) => {engine.receipt.work.solves = 60002;},
        ({engine}) => {engine.limits.maxAttempts = 30000;},
        ({engine}) => {engine.initialStorage.capacitorVoltage = 5;},
        ({engine}) => {engine.scenario = 'time-zero-op';},
        ({engine}) => {engine.rows.pop();},
        ({engine}) => {engine.rows[24].timeNs = '500001';},
        ({engine}) => {engine.rows[24].timeNs = engine.rows[23].timeNs;},
        ({engine}) => {engine.rows[24].collectorVoltage = NaN;},
        ({reference}) => {reference.arms[2].zeroStorage = false;},
        ({reference}) => {reference.arms[2].measurements[1].voltage += .001;},
        ({reference}) => {reference.arms[2].measurements[1].timeNs++;},
        ({reference}) => {reference.refinement.bounds.voltage = 1;}
    ];
    for (const edit of edits) {
        const pair = fixture(); edit(pair);
        assert.throws(() => compareWindingReference(pair.engine, pair.reference));
    }
});

test('pure executable agreement and success-exit mutants fail the caller oracles', async () => {
    const original = readFileSync(new URL('../scripts/compare-winding-reference.mjs', import.meta.url), 'utf8');
    for (const [anchor, replacement, oracle] of [
        ['values.absoluteError <= values.bound', 'true', module => {
            const {engine, reference} = fixture(); engine.rows[24].collectorVoltage += 1;
            assert.equal(module.compareWindingReference(engine, reference).agreement, false);
        }],
        ['report.agreement === true ? 0 : 1', '0', module => {
            assert.equal(module.comparisonExitCode({agreement: false}), 1);
        }]
    ]) {
        assert.equal(original.split(anchor).length - 1, 1);
        const source = original.replace(anchor, replacement).replaceAll("'./diagnose-winding-uic-reference.mjs'",
            JSON.stringify(new URL('../scripts/diagnose-winding-uic-reference.mjs', import.meta.url).href));
        const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
        assert.throws(() => oracle(module), assert.AssertionError);
    }
    assert.equal(readFileSync(new URL('../scripts/compare-winding-reference.mjs', import.meta.url), 'utf8'), original);
});

test('hosted completed zero-storage engine agrees with independently refined SPICE at shared times', async t => {
    if (spawnSync(process.env.NGSPICE || 'ngspice', ['--version'], {encoding: 'utf8', timeout: 5000}).status !== 0) {
        t.skip('ngspice unavailable; mandatory CI census requires it'); return;
    }
    const report = await runWindingReferenceComparison();
    t.diagnostic(JSON.stringify(report, (_key, value) => typeof value === 'bigint' ? String(value) : value));
    assert.equal(report.agreement, true, JSON.stringify(report.comparisons));
});
