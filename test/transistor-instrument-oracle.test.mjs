// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {TRANSISTOR_CASES, TRANSISTOR_CARD, TRANSISTOR_TIMES_NS, TRANSISTOR_LIMITS,
    transistorDeck, transistorCase, parseTransistorArguments, compareTransistorCapture,
    transistorCaseReport, runTransistorCase} from '../scripts/qualify-transistor-instruments.mjs';

function fixture () {
    return {reference: {caseId: 'npn-3', arms: [.5, .25].map(maxStepNs => ({maxStepNs,
        measurements: TRANSISTOR_TIMES_NS.map(timeNs => ({timeNs, voltage: 2, current: .01})),
        mean: {startNs: 100, endNs: 20000, voltage: 2, current: .01}}))},
    engine: {caseId: 'npn-3', card: {...TRANSISTOR_CARD}, initialCapacitorVoltage: 0,
        status: {profile: {id: 'precision-v1'}, accuracyMet: true, failure: null},
        receipt: {completed: true, failure: null, requestedTimeNs: '20000', limits: {...TRANSISTOR_LIMITS},
            work: {attempts: 200, solves: 600, advances: 200}},
        samples: TRANSISTOR_TIMES_NS.map(timeNs => ({timeNs, voltage: 2, current: -.01})),
        mean: {startNs: 100, endNs: 20000, voltage: 2, current: -.01}}};
}

test('pure transistor manifest/decks bind four immutable circuits and explicit non-storage card', () => {
    assert.equal(TRANSISTOR_CASES.length, 4);
    assert.equal(new Set(TRANSISTOR_CASES.map(row => row.id)).size, 4);
    assert.ok(Object.isFrozen(TRANSISTOR_CASES) && TRANSISTOR_CASES.every(Object.isFrozen));
    assert.ok(Object.isFrozen(TRANSISTOR_CARD));
    assert.deepEqual(parseTransistorArguments([]), TRANSISTOR_CASES.map(row => row.id));
    for (const row of TRANSISTOR_CASES) {
        const deck = transistorDeck(row.id, .25);
        assert.ok(deck.includes(`RB input base ${row.rb}`));
        assert.ok(deck.includes(`RC feed collector ${row.rc}`));
        assert.ok(deck.includes(`C1 collector 0 ${row.c} IC=0`));
        assert.match(deck, /BF=200 BR=1 NF=1 NR=1 VAF=0 VAR=0 RB=0 RC=0 RE=0 CJE=0 CJC=0 TF=0 TR=0/);
        assert.match(deck, /VSENSE supply feed 0/);
        assert.match(deck, /tran 0.0025n 20.1u 0 0.25n uic/);
        assert.equal(transistorCase(row.id), row);
    }
    for (const args of [['--case'], ['--case', 'absent'], ['--relax', '1'], ['--case', 'npn-1', 'extra']]) {
        assert.throws(() => parseTransistorArguments(args));
    }
    assert.throws(() => transistorDeck('npn-1', 1));
});

test('pure transistor comparison refuses drift and preserves failed case reports', () => {
    const pair = fixture(); assert.equal(compareTransistorCapture(pair.engine, pair.reference).agreement, true);
    for (const edit of [
        ({engine}) => {engine.card.beta = 100;},
        ({engine}) => {engine.initialCapacitorVoltage = 1;},
        ({engine}) => {engine.caseId = 'npn-1';},
        ({engine}) => {engine.status.profile.id = 'interactive-v1';},
        ({engine}) => {engine.receipt.completed = false;},
        ({engine}) => {engine.receipt.work.solves = 60002;},
        ({engine}) => {engine.receipt.limits.maxSolves++;},
        ({engine}) => {engine.samples.pop();},
        ({engine}) => {engine.samples[199].timeNs--;},
        ({engine}) => {engine.samples[199].current = NaN;},
        ({engine}) => {engine.mean.startNs = 0;},
        ({reference}) => {reference.arms.reverse();}
    ]) {
        const changed = fixture(); edit(changed);
        assert.throws(() => compareTransistorCapture(changed.engine, changed.reference));
        const report = transistorCaseReport('npn-3', changed.reference, changed.engine);
        assert.equal(report.agreement, false); assert.equal(report.failure, 'capture-authority');
        assert.equal(report.engine, changed.engine);
    }
    const unstable = fixture(); unstable.reference.arms[1].measurements[199].voltage += .001;
    assert.equal(transistorCaseReport('npn-3', unstable.reference, unstable.engine).failure, 'reference-refinement');
    const failed = fixture(); failed.engine.error = 'budget refused';
    assert.equal(transistorCaseReport('npn-3', failed.reference, failed.engine).failure, 'engine-capture');
    const wrong = fixture(); wrong.engine.samples[199].current *= -1;
    assert.equal(compareTransistorCapture(wrong.engine, wrong.reference).agreement, false);
    const crossed = fixture(); crossed.reference.caseId = crossed.engine.caseId = 'npn-1';
    assert.equal(transistorCaseReport('npn-3', crossed.reference, crossed.engine).failure, 'capture-authority');
});

test('pure transistor polarity and last-point mutations red actual comparison callers', async () => {
    const original = readFileSync(new URL('../scripts/qualify-transistor-instruments.mjs', import.meta.url), 'utf8');
    for (const [anchor, replacement, expected, edit] of [
        ['-fine.measurements[i].current', 'fine.measurements[i].current', true, () => {}],
        ['[...comparisons, means].every', '[...comparisons.slice(0, -1), means].every', false,
            pair => {pair.engine.samples[199].voltage += 1;}]
    ]) {
        assert.equal(original.split(anchor).length - 1, 1);
        const source = original.replace(anchor, replacement).replaceAll("'./diagnose-winding-uic-reference.mjs'",
            JSON.stringify(new URL('../scripts/diagnose-winding-uic-reference.mjs', import.meta.url).href));
        const mutant = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
        const pair = fixture(); edit(pair);
        assert.throws(() => assert.equal(mutant.compareTransistorCapture(pair.engine, pair.reference).agreement, expected),
            assert.AssertionError);
    }
    assert.equal(readFileSync(new URL('../scripts/qualify-transistor-instruments.mjs', import.meta.url), 'utf8'), original);
});

test('pure unavailable-provider CLI preserves all four cases without engine acquisition', () => {
    const child = spawnSync(process.execPath,
        [fileURLToPath(new URL('../scripts/qualify-transistor-instruments.mjs', import.meta.url))],
        {encoding: 'utf8', timeout: 10000, maxBuffer: 1048576,
            env: {...process.env, NGSPICE: 'brickwright-intentionally-unavailable-spice'}});
    assert.equal(child.error, undefined); assert.equal(child.status, 1, child.stderr);
    const reports = child.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(reports.map(row => row.definition.id), TRANSISTOR_CASES.map(row => row.id));
    for (const report of reports) {
        assert.equal(report.agreement, false); assert.equal(report.failure, 'reference-process');
        assert.equal(report.engine, null); assert.deepEqual(report.reference.arms, []);
        assert.match(report.error, /executable unavailable/);
    }
});

test('hosted four-case NPN instruments agree with independently refined SPICE', async t => {
    if (spawnSync(process.env.NGSPICE || 'ngspice', ['--version'], {encoding: 'utf8', timeout: 5000}).status !== 0) {
        t.skip('ngspice unavailable; mandatory census requires it'); return;
    }
    const failures = [], json = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item);
    for (const {id} of TRANSISTOR_CASES) {
        const report = await runTransistorCase(id);
        const {reference, engine, comparisons, refinement, ...summary} = report;
        t.diagnostic(json({record: 'transistor-summary', ...summary,
            engine: engine && {...engine, samples: undefined}, referenceVersion: reference.version}));
        for (const row of comparisons || []) t.diagnostic(json({record: 'transistor-comparison', id, ...row}));
        for (const arm of reference.arms) {
            const {measurements, ...metadata} = arm;
            t.diagnostic(json({record: 'transistor-reference-arm', id, ...metadata}));
            for (const row of measurements) t.diagnostic(json({record: 'transistor-reference-row', id,
                maxStepNs: arm.maxStepNs, ...row}));
        }
        if (!report.agreement) failures.push({id, failure: report.failure || 'engine-disagreement'});
    }
    assert.deepEqual(failures, [], 'four cases must qualify; failures remain in the denominator');
    const original = readFileSync(new URL('../scripts/qualify-transistor-instruments.mjs', import.meta.url), 'utf8');
    const anchor = 'params: {ohms: row.rb}';
    assert.equal(original.split(anchor).length - 1, 1);
    const source = original.replace(anchor, 'params: {ohms: row.rb * 1.2}')
        .replaceAll("'./diagnose-winding-uic-reference.mjs'",
            JSON.stringify(new URL('../scripts/diagnose-winding-uic-reference.mjs', import.meta.url).href))
        .replaceAll("'../src/board.js'", JSON.stringify(new URL('../src/board.js', import.meta.url).href));
    const mutant = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    const changed = await mutant.runTransistorCase('npn-3');
    assert.equal(changed.failure, undefined, 'mutation must complete, not refuse');
    assert.equal(changed.engine.receipt.completed, true); assert.equal(changed.agreement, false);
    t.diagnostic(json({record: 'transistor-physical-resistor-mutant', id: 'npn-3', completed: true,
        agreement: changed.agreement, maxVoltageError: Math.max(...changed.comparisons.map(row => row.voltage.absoluteError))}));
    assert.equal(readFileSync(new URL('../scripts/qualify-transistor-instruments.mjs', import.meta.url), 'utf8'), original);
});
