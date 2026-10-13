// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {judgeWindingEdge, readVoltageSampleGrid, edgeExitCode,
    runWindingEdgeInstruments} from '../scripts/compare-winding-edge-instruments.mjs';
import {EDGE_TIMES_NS} from '../scripts/diagnose-winding-uic-reference.mjs';

function fixture () {
    const engine = {completed: true, attachedTimeNs: '1000000',
        initialStorage: {capacitorVoltage: 0, inductorCurrent: 0},
        status: {accuracyMet: true, failure: null},
        receipt: {completed: true, failure: null, requestedTimeNs: '1010000',
            limits: {maxAttempts: 20000, maxSolves: 60001, maxAdvances: 200},
            work: {attempts: 100, solves: 300, advances: 51}},
        samples: EDGE_TIMES_NS.map(timeNs => ({timeNs, voltage: 5})),
        mean: {startNs: 1000000, endNs: 1010000, voltage: 5, current: -.02}};
    const reference = {arms: [100, 50, 25].map(maxStepNs => ({zeroStorage: true, maxStepNs,
        startupStepNs: maxStepNs / 100,
        measurements: EDGE_TIMES_NS.map(timeNs => ({timeNs, voltage: 5, current: .02})),
        mean: {startNs: 1000000, endNs: 1010000, voltage: 5, current: .02}}))};
    return {engine, reference};
}

test('pure edge oracle checks every sample, signs, watched interval and completion authority', () => {
    const pair = fixture(); assert.equal(judgeWindingEdge(pair.engine, pair.reference).agreement, true);
    pair.engine.samples[399].voltage += .001;
    assert.equal(judgeWindingEdge(pair.engine, pair.reference).agreement, false);
    for (const edit of [
        ({engine}) => {engine.completed = false;},
        ({engine}) => {engine.receipt.work.solves = 60002;},
        ({engine}) => {engine.samples.pop();},
        ({engine}) => {engine.samples[0].timeNs++;},
        ({engine}) => {engine.mean.startNs = 0;},
        ({engine}) => {engine.mean.current = NaN;},
        ({reference}) => {reference.arms[2].measurements[399].voltage += .001;},
        ({reference}) => {reference.arms[2].mean.current += .001;},
        ({reference}) => {reference.arms[2].zeroStorage = false;}
    ]) {
        const data = fixture(); edit(data); assert.throws(() => judgeWindingEdge(data.engine, data.reference));
    }
});

test('pure scope grid rejects envelope, display current, shifted time and omitted final sample', () => {
    const samples = new Float64Array(804).fill(5);
    const grid = {channelType: 'voltage', capture: 'sample', count: 400, startTNs: 1000025n,
        sampleIntervalNs: 25n, writeIndex: 400, samples};
    assert.equal(readVoltageSampleGrid(grid).at(-1).timeNs, 1010000);
    for (const edit of [{channelType: 'current'}, {capture: 'envelope'}, {count: 399},
        {startTNs: 1000000n}, {sampleIntervalNs: 26n}, {writeIndex: 0}]) {
        assert.throws(() => readVoltageSampleGrid({...grid, ...edit}));
    }
    samples[799] = 4; assert.throws(() => readVoltageSampleGrid(grid), /pairs/);
    samples[799] = NaN; assert.throws(() => readVoltageSampleGrid(grid), /pairs/);
});

test('pure executable polarity, final-sample and success-exit mutants fail caller oracles', async () => {
    const original = readFileSync(new URL('../scripts/compare-winding-edge-instruments.mjs', import.meta.url), 'utf8');
    for (const [anchor, replacement, oracle] of [
        ['-fine.mean.current', 'fine.mean.current', module => {
            const pair = fixture(); assert.equal(module.judgeWindingEdge(pair.engine, pair.reference).agreement, true);
        }],
        ['samples.every(row => row.voltage.passed)', 'samples.slice(0, -1).every(row => row.voltage.passed)', module => {
            const pair = fixture(); pair.engine.samples[399].voltage += 1;
            assert.equal(module.judgeWindingEdge(pair.engine, pair.reference).agreement, false);
        }],
        ['report.agreement === true ? 0 : 1', '0', module => {
            assert.equal(module.edgeExitCode({agreement: false}), 1);
        }]
    ]) {
        assert.equal(original.split(anchor).length - 1, 1);
        let source = original.replace(anchor, replacement);
        for (const name of ['diagnose-winding-uic-reference', 'compare-winding-reference']) {
            source = source.replaceAll(`'./${name}.mjs'`, JSON.stringify(new URL(`../scripts/${name}.mjs`, import.meta.url).href));
        }
        const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
        assert.throws(() => oracle(module), assert.AssertionError);
    }
    assert.equal(edgeExitCode({agreement: false}), 1);
    assert.equal(readFileSync(new URL('../scripts/compare-winding-edge-instruments.mjs', import.meta.url), 'utf8'), original);
});

test('hosted winding falling-edge voltage scope and signed meter means agree with refined SPICE', async t => {
    if (spawnSync(process.env.NGSPICE || 'ngspice', ['--version'], {encoding: 'utf8', timeout: 5000}).status !== 0) {
        t.skip('ngspice unavailable; mandatory CI census requires it'); return;
    }
    const report = await runWindingEdgeInstruments();
    // Bound individual log records. Keep all original bracketing rows, not
    // just a summary verdict, without one enormous diagnostic JSON line.
    const json = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item);
    const {reference, engine, samples, refinement, ...summary} = report;
    t.diagnostic(json({record: 'winding-edge-summary', ...summary,
        engine: engine && {...engine, samples: undefined},
        referenceRefinement: reference.refinement.stable, meanRefinement: reference.meanRefinement}));
    for (const sample of samples || []) t.diagnostic(json({record: 'winding-edge-comparison', ...sample}));
    for (const sample of engine?.samples || []) t.diagnostic(json({record: 'winding-edge-engine', ...sample}));
    for (const arm of [...reference.arms, reference.normalOp]) {
        const {measurements, ...metadata} = arm;
        t.diagnostic(json({record: 'winding-edge-reference-arm', ...metadata}));
        for (const measurement of measurements) t.diagnostic(json({record: 'winding-edge-reference-row',
            maxStepNs: arm.maxStepNs, zeroStorage: arm.zeroStorage, ...measurement}));
    }
    for (const difference of reference.refinement.differences) {
        t.diagnostic(json({record: 'winding-edge-refinement', ...difference}));
    }
    assert.equal(report.agreement, true, JSON.stringify({failure: report.failure,
        means: report.means, refinement: report.reference.refinement.stable,
        meanRefinement: report.reference.meanRefinement.stable}));
});
