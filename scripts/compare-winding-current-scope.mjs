// SPDX-License-Identifier: MIT
import {pathToFileURL} from 'node:url';
import {EDGE_TIMES_NS, REFERENCE_STEPS_NS, refinementReport, runWindingEdgeReference} from './diagnose-winding-uic-reference.mjs';

export function readCurrentSampleGrid (data) {
    if (data?.channelType !== 'current' || data.currentClock !== 'simulation' || data.capture !== 'sample' ||
        data.startTNs !== 1000025n || data.sampleIntervalNs !== 25n || data.count !== 400 ||
        data.writeIndex !== 400 || data.samples?.length !== 804) throw new Error('Exact simulation-current grid required');
    return EDGE_TIMES_NS.map((timeNs, i) => {
        const current = data.samples[2 * i];
        if (!Number.isFinite(current) || current !== data.samples[2 * i + 1]) throw new Error('Finite current pairs required');
        return {timeNs, current};
    });
}

export function compareCurrentSamples (samples, reference) {
    if (reference?.arms?.length !== 3 || reference.arms.some((arm, i) => arm.zeroStorage !== true ||
        arm.maxStepNs !== REFERENCE_STEPS_NS[i] || arm.startupStepNs !== arm.maxStepNs / 100)) {
        throw new Error('Three matched UIC reference arms required');
    }
    if (!refinementReport(reference.arms.map(arm => arm.measurements), EDGE_TIMES_NS).stable) {
        throw new Error('Fixed reference refinement required before current agreement');
    }
    if (samples?.length !== 400 || samples.some((row, i) => row.timeNs !== EDGE_TIMES_NS[i] ||
        !Number.isFinite(row.current))) throw new Error('Complete exact current grid required');
    const comparisons = samples.map((row, i) => {
        // Positive engine terminal current leaves L.a; positive SPICE i(LW) enters it.
        const expected = -reference.arms[2].measurements[i].current;
        const error = row.current - expected;
        return {timeNs: row.timeNs, engine: row.current, reference: expected,
            signedError: error, absoluteError: Math.abs(error), bound: 1e-6, passed: Math.abs(error) <= 1e-6};
    });
    return {agreement: comparisons.every(row => row.passed), comparisons};
}

export const currentScopeExitCode = report => report.agreement === true ? 0 : 1;

export async function runWindingCurrentScope () {
    const reference = runWindingEdgeReference();
    const report = {schema: 'winding-current-scope-v1', agreement: false, reference, engine: null};
    if (!reference.refinement.stable) return {...report, failure: 'reference-refinement'};
    const {createWindingDiagnosticBoard, WINDING_LIMITS} = await import('./diagnose-winding-transient.mjs');
    const board = createWindingDiagnosticBoard();
    const engine = {initialStorage: {capacitorVoltage: board.capVoltages.get('CP') ?? 0,
        inductorCurrent: board.inductorCurrents.get('L') ?? 0}};
    report.engine = engine;
    let handle;
    try {
        engine.receipt = board.advanceToBoundedStream(1010000n, WINDING_LIMITS, {stepNs: 20000n, onStep: row => {
            if (row.timeNs === 1000000n) {
                handle = board.addScopeChannel({type: 'current', partId: 'L', terminal: 'a',
                    currentClock: 'simulation', sampleRateHz: 40000000, depth: 402});
                engine.attachedTimeNs = String(row.timeNs);
            }
        }});
        engine.status = board.transientAnalysisStatus();
        engine.voltageChannels = board.getScopeChannels().filter(id => board.getScopeData(id).channelType === 'voltage').length;
        if (engine.voltageChannels !== 0) throw new Error('Standalone current grid proof must not use voltage channels');
        if (!engine.receipt.completed || !engine.status.accuracyMet) throw new Error('Incomplete current capture');
        const data = board.getScopeData(handle);
        engine.scopeData = {...data, samples: Array.from(data.samples)};
        engine.samples = readCurrentSampleGrid(data);
        // Display polling is forbidden from inserting or relabelling clocked samples.
        board.sampleCurrentChannels();
        if (board.getScopeData(handle).count !== 400) throw new Error('Display poll altered simulation ring');
        return {...report, ...compareCurrentSamples(engine.samples, reference)};
    } catch (failure) {
        engine.error = failure.message;
        engine.status = board.transientAnalysisStatus();
        engine.receipt ||= engine.status.boundedAdvance;
        return {...report, failure: 'current-scope-acquisition'};
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (process.argv.length !== 2) throw new Error('Fixed current-scope diagnostic accepts no options');
    const report = await runWindingCurrentScope();
    console.log(JSON.stringify(report, (_key, value) => typeof value === 'bigint' ? String(value) : value, 2));
    process.exitCode = currentScopeExitCode(report);
}
