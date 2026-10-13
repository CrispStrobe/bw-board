// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MATRIX_CASES, MATRIX_TIMES_NS, matrixDeck, matrixCase, parseMatrixArguments,
    matrixRefinement, compareMatrixCase, runMatrixCase} from '../scripts/qualify-transient-matrix.mjs';

function fixture () {
    const reference = {caseId: 'rc-2', arms: [1, .5].map(maxStepNs => ({maxStepNs,
        measurements: MATRIX_TIMES_NS.map(timeNs => ({timeNs, voltage: 2, current: .01})),
        mean: {startNs: 100, endNs: 20000, voltage: 2, current: .01}}))};
    const engine = {caseId: 'rc-2', initialStorage: {capacitorVoltage: 0, inductorCurrent: null},
        status: {profile: {id: 'precision-v1'}, accuracyMet: true, failure: null},
        receipt: {completed: true, failure: null, requestedTimeNs: '20000',
            limits: {maxAttempts: 20000, maxSolves: 60001, maxAdvances: 200},
            work: {attempts: 200, solves: 600, advances: 200}},
        samples: MATRIX_TIMES_NS.map(timeNs => ({timeNs, voltage: 2, current: -.01})),
        mean: {startNs: 100, endNs: 20000, voltage: 2, current: -.01}};
    return {engine, reference};
}

test('pure reviewed matrix/decks have twelve unique immutable cases, explicit IC and no exporter', () => {
    assert.equal(MATRIX_CASES.length, 12); assert.equal(new Set(MATRIX_CASES.map(row => row.id)).size, 12);
    assert.ok(Object.isFrozen(MATRIX_CASES) && MATRIX_CASES.every(Object.isFrozen));
    assert.deepEqual(parseMatrixArguments([]), MATRIX_CASES.map(row => row.id));
    for (const row of MATRIX_CASES) {
        const deck = matrixDeck(row.id, .5);
        assert.match(deck, /C1 out 0 .* IC=0/); assert.match(deck, / uic\n/);
        assert.match(deck, /VSENSE input feed 0/); assert.match(deck, /let ref_current = i\(VSENSE\)/);
        assert.match(deck, /tran 0.005n 20.1u 0 0.5n uic/);
        if (row.family === 'rlc') assert.match(deck, /L1 feed winding .* IC=0/);
        if (row.family === 'diode') assert.match(deck, /\.model DM D\(IS=1e-12 N=1 RS=.568\)/);
        assert.equal(matrixCase(row.id), row);
    }
    for (const args of [['--case'], ['--case', 'invented'], ['--relax', '1'], ['--case', 'rc-1', 'extra']]) {
        assert.throws(() => parseMatrixArguments(args));
    }
    assert.throws(() => matrixDeck('rc-1', 2));
});

test('pure matrix comparator requires stable reference, complete work/grid and exact watched means', () => {
    const pair = fixture(); assert.equal(compareMatrixCase(pair.engine, pair.reference).agreement, true);
    for (const edit of [
        ({engine}) => {engine.caseId = 'rc-1';},
        ({engine}) => {engine.initialStorage.capacitorVoltage = 2;},
        ({engine}) => {engine.status.profile.id = 'interactive-v2';},
        ({engine}) => {engine.receipt.completed = false;},
        ({engine}) => {engine.receipt.work.attempts = 20001;},
        ({engine}) => {engine.samples.pop();},
        ({engine}) => {engine.samples[199].timeNs--;},
        ({engine}) => {engine.mean.startNs = 0;},
        ({engine}) => {engine.mean.current = NaN;},
        ({reference}) => {reference.arms.reverse();},
        ({reference}) => {reference.arms[1].measurements[199].voltage += .001;}
    ]) {
        const data = fixture(); edit(data); assert.throws(() => compareMatrixCase(data.engine, data.reference));
    }
    const wrong = fixture(); wrong.engine.samples[199].current *= -1;
    assert.equal(compareMatrixCase(wrong.engine, wrong.reference).agreement, false);
    const held = fixture(); held.engine.mean.voltage += .01;
    assert.equal(compareMatrixCase(held.engine, held.reference).agreement, false);
    assert.equal(matrixRefinement(...pair.reference.arms).stable, true);
});

test('pure real comparator final-point and polarity mutants fail caller assertions', async () => {
    const original = readFileSync(new URL('../scripts/qualify-transient-matrix.mjs', import.meta.url), 'utf8');
    for (const [anchor, replacement, edit] of [
        ['-fine.measurements[i].current', 'fine.measurements[i].current', () => {}],
        ['[...comparisons, means].every', '[...comparisons.slice(0, -1), means].every', pair => {
            pair.engine.samples[199].voltage += 1;
        }]
    ]) {
        assert.equal(original.split(anchor).length - 1, 1);
        const source = original.replace(anchor, replacement).replaceAll("'./diagnose-winding-uic-reference.mjs'",
            JSON.stringify(new URL('../scripts/diagnose-winding-uic-reference.mjs', import.meta.url).href));
        const mutant = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
        const pair = fixture(); edit(pair);
        assert.throws(() => assert.equal(mutant.compareMatrixCase(pair.engine, pair.reference).agreement,
            anchor.startsWith('-') ? true : false), assert.AssertionError);
    }
    assert.equal(readFileSync(new URL('../scripts/qualify-transient-matrix.mjs', import.meta.url), 'utf8'), original);
});

test('hosted twelve-case transient matrix preserves every refusal and compares instruments against SPICE', async t => {
    if (spawnSync(process.env.NGSPICE || 'ngspice', ['--version'], {encoding: 'utf8', timeout: 5000}).status !== 0) {
        t.skip('ngspice unavailable; mandatory census requires it'); return;
    }
    const failures = [];
    const json = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item);
    for (const {id} of MATRIX_CASES) {
        const report = await runMatrixCase(id);
        const {reference, engine, comparisons, refinement, ...summary} = report;
        t.diagnostic(json({record: 'matrix-summary', ...summary,
            engine: engine && {...engine, samples: undefined}, referenceVersion: reference.version}));
        for (const row of comparisons || []) t.diagnostic(json({record: 'matrix-comparison', id, ...row}));
        for (const arm of reference.arms) {
            const {measurements, ...metadata} = arm;
            t.diagnostic(json({record: 'matrix-reference-arm', id, ...metadata}));
            for (const row of measurements) t.diagnostic(json({record: 'matrix-reference-row', id,
                maxStepNs: arm.maxStepNs, ...row}));
        }
        if (!report.agreement) failures.push({id, failure: report.failure || 'engine-disagreement'});
    }
    assert.deepEqual(failures, [], 'all reviewed cases must qualify; refusals do not count as passes');
    // Perturb the actual circuit, not the expected numbers. This must complete
    // yet disagree with its unchanged independent reference; a process/refusal
    // error is not evidence that the electrical oracle is load-bearing.
    const original = readFileSync(new URL('../scripts/qualify-transient-matrix.mjs', import.meta.url), 'utf8');
    const anchor = 'params: {ohms: row.r}';
    assert.equal(original.split(anchor).length - 1, 1);
    const source = original.replace(anchor, 'params: {ohms: row.r * 1.2}')
        .replaceAll("'./diagnose-winding-uic-reference.mjs'",
            JSON.stringify(new URL('../scripts/diagnose-winding-uic-reference.mjs', import.meta.url).href))
        .replaceAll("'../src/board.js'", JSON.stringify(new URL('../src/board.js', import.meta.url).href));
    const mutant = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    const changedCircuit = await mutant.runMatrixCase('rc-2');
    assert.equal(changedCircuit.failure, undefined, 'model mutant must be a completed comparison, not refusal');
    assert.equal(changedCircuit.engine.receipt.completed, true);
    assert.equal(changedCircuit.agreement, false, 'wrong actual resistor must disagree with unchanged SPICE');
    t.diagnostic(json({record: 'matrix-physical-resistor-mutant', id: 'rc-2',
        completed: changedCircuit.engine.receipt.completed, agreement: changedCircuit.agreement,
        maxVoltageError: Math.max(...changedCircuit.comparisons.map(row => row.voltage.absoluteError))}));
    assert.equal(readFileSync(new URL('../scripts/qualify-transient-matrix.mjs', import.meta.url), 'utf8'), original);
});

test('hosted unavailable-provider CLI refuses with a nonzero exit and no engine acquisition', () => {
    const child = spawnSync(process.execPath,
        [fileURLToPath(new URL('../scripts/qualify-transient-matrix.mjs', import.meta.url)), '--case', 'rc-2'],
        {encoding: 'utf8', timeout: 10000, maxBuffer: 1048576,
            env: {...process.env, NGSPICE: 'brickwright-intentionally-unavailable-spice'}});
    assert.equal(child.error, undefined); assert.equal(child.status, 1, child.stderr);
    const report = JSON.parse(child.stdout.trim());
    assert.equal(report.definition.id, 'rc-2'); assert.equal(report.agreement, false);
    assert.equal(report.failure, 'reference-process'); assert.equal(report.engine, null);
    assert.deepEqual(report.reference.arms, []);
    assert.match(report.error, /executable unavailable/);
});
