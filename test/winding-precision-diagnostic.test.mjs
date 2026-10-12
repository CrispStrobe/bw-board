import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {captureWindingDiagnostic, diagnosticExitCode, diagnosticJson, parseWindingArguments,
    validateWindingOptions, WINDING_LIMITS} from '../scripts/diagnose-winding-transient.mjs';

test('winding CLI refuses unknown, duplicate and incomplete options', () => {
    assert.deepEqual(parseWindingArguments([]), {scenario: 'zero-storage', profile: 'precision-v1'});
    assert.deepEqual(parseWindingArguments(['--case', 'dc-turnoff', '--profile', 'interactive-v2']),
        {scenario: 'dc-turnoff', profile: 'interactive-v2'});
    for (const args of [['--case'], ['--case', 'invented'], ['--profile', 'precision-v2'],
        ['--case', '--profile'], ['--raise-budget', '30000'], ['--case', 'zero-storage', '--case', 'time-zero-op']]) {
        assert.throws(() => parseWindingArguments(args));
    }
    assert.throws(() => validateWindingOptions({profile: 'interactive-v1'}));
    assert.deepEqual(WINDING_LIMITS, {maxAttempts: 20000, maxSolves: 60001, maxAdvances: 200});
    assert.ok(Object.isFrozen(WINDING_LIMITS));
    assert.equal(diagnosticExitCode({completed: false}), 1);
    assert.equal(diagnosticExitCode({completed: true}), 0);
    assert.deepEqual(JSON.parse(diagnosticJson({time: 1n, states: new Map([['C', 2]])})),
        {time: '1', states: {C: 2}});
});

const summarize = report => diagnosticJson({scenario: report.scenario, initialStorage: report.initialStorage,
    completed: report.completed, work: report.status.work, failure: report.status.failure,
    receipt: report.receipt, observations: report.rows.length});

test('fresh zero-storage precision run preserves its actual failure and provisional observations', t => {
    const run = spawnSync(process.execPath,
        [fileURLToPath(new URL('../scripts/diagnose-winding-transient.mjs', import.meta.url))],
        {encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024});
    assert.equal(run.error, undefined, String(run.error));
    assert.equal(run.status, 1, run.stderr || run.stdout);
    const report = JSON.parse(run.stdout);
    t.diagnostic(summarize(report));
    assert.equal(report.profile, 'precision-v1');
    assert.deepEqual(report.initialStorage, {capacitorVoltage: 0, inductorCurrent: 0});
    assert.equal(report.initialization, null);
    assert.equal(report.completed, false, 'known failing diagnostic, NOT a successful waveform regression');
    assert.equal(diagnosticExitCode(report), 1);
    assert.equal(report.status.accuracyMet, false);
    assert.equal(report.status.failure?.code, 'minimum-step-accuracy-unmet');
    assert.ok(report.status.failure.timeSec >= .001001 && report.status.failure.timeSec <= .001003);
    assert.equal(report.status.failure.stepSec, report.status.profile.minStepSec);
    assert.ok(report.status.failure.normalizedError > 1);
    assert.ok(report.receipt && !report.receipt.completed);
    assert.ok(report.rows.length > 0 && report.rows.every(row => row.qualified === false));
    assert.equal(report.oracleAgreement, 'not-tested');
    for (const [key, bound] of Object.entries(WINDING_LIMITS)) {
        const counter = key.slice(3).toLowerCase();
        assert.ok(report.status.work[counter] <= bound, `${counter} retains the whole-capture ceiling`);
    }
    // CI preserves actual observations, rather than publishing invented failure magnitudes.
    assert.doesNotThrow(() => JSON.parse(diagnosticJson(report)));
});

test('same pulse with public OP initialization is a distinct initial state, not a zero-storage repair', t => {
    const report = captureWindingDiagnostic({scenario: 'time-zero-op'});
    t.diagnostic(summarize(report));
    assert.equal(report.initializationMode, 'public-time-zero-operating-point');
    assert.ok(report.initialization?.converged);
    assert.ok(report.initialStorage.capacitorVoltage > 4.9);
    assert.ok(report.initialStorage.inductorCurrent > 0);
    assert.equal(report.completed, true, diagnosticJson(report));
    assert.equal(report.oracleAgreement, 'not-tested');
    assert.equal(report.rows.at(-1).timeNs, report.requestedTimeNs);
    assert.ok(report.rows.every(row => row.qualified === false));
});

test('DC-initialized falling edge completes without changing precision policy or budgets', t => {
    const report = captureWindingDiagnostic({scenario: 'dc-turnoff'});
    t.diagnostic(summarize(report));
    assert.equal(report.completed, true, diagnosticJson(report));
    assert.equal(report.status.profile.id, 'precision-v1');
    assert.equal(report.status.accuracyMet, true);
    assert.equal(report.status.failure, null);
    assert.equal(report.rows.length, 200);
    assert.equal(report.rows.at(-1).timeNs, '20000');
    assert.equal(diagnosticExitCode(report), 0);
    assert.ok(report.initialStorage.inductorCurrent > .1);
});

test('diagnostic CLI failure status is executable and cannot be replaced by successful exit', async () => {
    const original = readFileSync(new URL('../scripts/diagnose-winding-transient.mjs', import.meta.url), 'utf8');
    const anchor = 'report.completed === true ? 0 : 1';
    assert.equal(original.split(anchor).length - 1, 1);
    const source = original.replace(anchor, '0').replace("'../src/board.js'",
        JSON.stringify(new URL('../src/board.js', import.meta.url).href));
    const mutant = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    assert.throws(() => assert.equal(mutant.diagnosticExitCode({completed: false}), 1), assert.AssertionError);
    assert.equal(readFileSync(new URL('../scripts/diagnose-winding-transient.mjs', import.meta.url), 'utf8'), original);
});
