// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STEP_CASES, REFERENCE_CARD, TIMES_NS, LIMITS, referenceCoefficients, referenceVoltage,
    referenceMean, parseArguments, compareStepCapture, runStepCase} from '../scripts/qualify-lm741-step-phase.mjs';

function fixture (id = 'lm741-pos-33') {
    return {caseId: id, status: {accuracyMet: true, failure: null, profile: {id: 'precision-v1'}},
        receipt: {completed: true, failure: null, requestedTimeNs: '20000', limits: {...LIMITS},
            work: {attempts: 200, solves: 600, advances: 200}},
        samples: TIMES_NS.map(timeNs => ({timeNs, voltage: referenceVoltage(id, timeNs),
            current: -referenceVoltage(id, timeNs) / 10000})), mean: referenceMean(id)};
}
test('pure LM741 manifest/reference preserve signs, phases and integrated means', () => {
    assert.equal(STEP_CASES.length, 6); assert.equal(new Set(STEP_CASES.map(row => row.id)).size, 6);
    assert.ok(Object.isFrozen(STEP_CASES) && STEP_CASES.every(Object.isFrozen) && Object.isFrozen(REFERENCE_CARD));
    assert.deepEqual(parseArguments([]), STEP_CASES.map(row => row.id));
    const {gain, d, omega} = referenceCoefficients();
    assert.ok(gain < 1 && gain > .99999 && d > 0 && d < .001 && omega > .005 && omega < .007);
    for (const row of STEP_CASES) {
        assert.ok(referenceVoltage(row.id, 10000 + row.phaseNs) === 0); // Both signed zeros are physically zero.
        assert.ok(Math.abs(referenceVoltage(row.id, 20000) - row.amplitude * gain) < 1e-12);
        let integral = 0;
        for (let t = 100; t < 20000; t++) integral += (referenceVoltage(row.id, t) + referenceVoltage(row.id, t+1)) / 2;
        assert.ok(Math.abs(referenceMean(row.id).voltage - integral / 19900) < 2e-8);
        assert.equal(compareStepCapture(row.id, fixture(row.id)).agreement, true);
    }
    for (const args of [['--case'], ['--case', 'unknown'], ['--relax', '1'], ['--case', 'lm741-pos-0', 'extra']]) {
        assert.throws(() => parseArguments(args));
    }
    assert.throws(() => referenceVoltage('lm741-pos-0', NaN));
});
test('pure LM741 comparator requires complete authority and the last observation and mean', () => {
    for (const edit of [
        row => {row.caseId = 'lm741-pos-0';}, row => {row.receipt.completed = false;},
        row => {row.receipt.work.attempts = 20001;}, row => {row.receipt.limits.maxSolves++;},
        row => {row.status.profile.id = 'interactive-v1';}, row => {row.samples.pop();},
        row => {delete row.samples[199];},
        row => {row.samples[199].timeNs--;}, row => {row.samples[199].current = NaN;}, row => {row.mean.startNs = 0;}
    ]) {
        const row = fixture(); edit(row); assert.throws(() => compareStepCapture('lm741-pos-33', row));
    }
    const point = fixture(); point.samples[199].voltage += .001;
    assert.equal(compareStepCapture(point.caseId, point).agreement, false);
    const mean = fixture(); mean.mean.current += 1e-7;
    assert.equal(compareStepCapture(mean.caseId, mean).agreement, false);
});
test('pure wrong-pole and final-observation mutants red real comparison callers', async () => {
    const original = readFileSync(new URL('../scripts/qualify-lm741-step-phase.mjs', import.meta.url), 'utf8');
    for (const [anchor, replacement, expected, edit] of [
        ['gbwHz: 1e6', 'gbwHz: 5e5', true, () => {}],
        ['[...comparisons, means].every', '[...comparisons.slice(0, -1), means].every', false,
            row => {row.samples[199].voltage += .001;}]
    ]) {
        assert.equal(original.split(anchor).length - 1, 1);
        const mutant = await import(`data:text/javascript;base64,${Buffer.from(original.replace(anchor, replacement)).toString('base64')}`);
        const row = fixture(); edit(row);
        assert.throws(() => assert.equal(mutant.compareStepCapture(row.caseId, row).agreement, expected), assert.AssertionError);
    }
    assert.equal(readFileSync(new URL('../scripts/qualify-lm741-step-phase.mjs', import.meta.url), 'utf8'), original);
});
test('hosted LM741 dense phase waveforms agree with the continuous linear reference', async t => {
    const json = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item);
    const failures = [];
    for (const {id} of STEP_CASES) {
        const report = await runStepCase(id), {engine, comparisons, ...summary} = report;
        if (engine && !engine.error) {
            assert.equal(engine.modelState.transientModel, 'linear-pole');
            assert.equal(engine.modelState.scheduledWakeNs, null);
            assert.equal(engine.modelState.updateTickNs, null);
        }
        t.diagnostic(json({record: 'lm741-step-summary', ...summary,
            engine: engine && {...engine, samples: undefined, observations: undefined}}));
        for (const row of engine?.observations || []) {
            t.diagnostic(json({record: 'lm741-step-observation', id, ...row}));
        }
        for (const row of comparisons || []) t.diagnostic(json({record: 'lm741-step-comparison', id, ...row}));
        if (!report.agreement) failures.push({id, failure: report.failure || 'continuous-model-disagreement'});
    }
    assert.deepEqual(failures, [], 'disagreement with the continuous model withholds qualification');
    const original = readFileSync(new URL('../scripts/qualify-lm741-step-phase.mjs', import.meta.url), 'utf8');
    const anchor = 'v2: row.amplitude,';
    assert.equal(original.split(anchor).length - 1, 1);
    const source = original.replace(anchor, 'v2: row.amplitude * 1.2,')
        .replaceAll("'../src/board.js'", JSON.stringify(new URL('../src/board.js', import.meta.url).href))
        .replaceAll("'../src/devices/analog-amps.js'", JSON.stringify(new URL('../src/devices/analog-amps.js', import.meta.url).href));
    const mutant = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    const changed = await mutant.runStepCase('lm741-pos-33');
    assert.equal(changed.failure, undefined); assert.equal(changed.engine.receipt.completed, true);
    assert.equal(changed.agreement, false);
    t.diagnostic(json({record: 'lm741-step-amplitude-mutant', completed: true, agreement: false}));
    assert.equal(readFileSync(new URL('../scripts/qualify-lm741-step-phase.mjs', import.meta.url), 'utf8'), original);
});
