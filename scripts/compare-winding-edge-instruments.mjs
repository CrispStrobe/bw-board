// SPDX-License-Identifier: MIT
import {pathToFileURL} from 'node:url';
import {EDGE_TIMES_NS, EDGE_WINDOW_NS, REFERENCE_STEPS_NS, refinementReport,
    runWindingEdgeReference} from './diagnose-winding-uic-reference.mjs';
import {AGREEMENT_BOUNDS} from './compare-winding-reference.mjs';

export function readVoltageSampleGrid (data) {
    if (data?.channelType !== 'voltage' || data.capture !== 'sample' || data.count !== 400 ||
        data.startTNs !== 1000025n || data.sampleIntervalNs !== 25n || data.writeIndex !== 400 ||
        data.samples?.length !== 804) throw new Error('Exact nonwrapped voltage sample grid required');
    return EDGE_TIMES_NS.map((timeNs, i) => {
        const value = data.samples[2 * i];
        if (!Number.isFinite(value) || value !== data.samples[2 * i + 1]) {
            throw new Error('Finite equal sample pairs required, not envelope or missing data');
        }
        return {timeNs, voltage: value};
    });
}

export function judgeWindingEdge (engine, reference) {
    if (engine?.completed !== true || engine.receipt?.completed !== true || engine.receipt.failure !== null ||
        engine.receipt.requestedTimeNs !== '1010000' || engine.attachedTimeNs !== '1000000' ||
        engine.initialStorage?.capacitorVoltage !== 0 || engine.initialStorage?.inductorCurrent !== 0 ||
        engine.status?.accuracyMet !== true || engine.status.failure !== null ||
        [['attempts', 20000], ['solves', 60001], ['advances', 200]].some(([key, bound]) =>
            engine.receipt.limits?.[`max${key[0].toUpperCase()}${key.slice(1)}`] !== bound ||
            !Number.isSafeInteger(engine.receipt.work?.[key]) || engine.receipt.work[key] < 0 ||
            engine.receipt.work[key] > bound)) throw new Error('Completed unchanged engine authority required');
    if (reference?.arms?.length !== 3 || reference.arms.some((arm, i) =>
        arm.zeroStorage !== true || arm.maxStepNs !== REFERENCE_STEPS_NS[i] ||
        arm.startupStepNs !== arm.maxStepNs / 100 || arm.mean?.startNs !== EDGE_WINDOW_NS[0] ||
        arm.mean?.endNs !== EDGE_WINDOW_NS[1])) throw new Error('Matched UIC reference authority required');
    const refinement = refinementReport(reference.arms.map(arm => arm.measurements), EDGE_TIMES_NS);
    const meanRefinement = refinementReport(reference.arms.map(arm => [{timeNs: EDGE_WINDOW_NS[0],
        voltage: arm.mean.voltage, current: arm.mean.current}]), [EDGE_WINDOW_NS[0]]);
    if (!refinement.stable || !meanRefinement.stable) throw new Error('All sample and mean refinements required');
    if (engine.samples?.length !== 400 || engine.samples.some((row, i) =>
        row.timeNs !== EDGE_TIMES_NS[i] || !Number.isFinite(row.voltage)) ||
        engine.mean?.startNs !== EDGE_WINDOW_NS[0] || engine.mean?.endNs !== EDGE_WINDOW_NS[1] ||
        !Number.isFinite(engine.mean.voltage) || !Number.isFinite(engine.mean.current)) {
        throw new Error('Exact finite instrument grid and watched interval required');
    }
    const compare = (actual, expected, key) => {
        const signedError = actual - expected;
        return {engine: actual, reference: expected, signedError, absoluteError: Math.abs(signedError),
            bound: AGREEMENT_BOUNDS[key], passed: Math.abs(signedError) <= AGREEMENT_BOUNDS[key]};
    };
    const fine = reference.arms[2];
    const samples = engine.samples.map((row, i) => ({timeNs: row.timeNs,
        voltage: compare(row.voltage, fine.measurements[i].voltage, 'voltage')}));
    const means = {voltage: compare(engine.mean.voltage, fine.mean.voltage, 'voltage'),
        // Engine terminal currents leave the part. SPICE i(LW) enters its first terminal.
        current: compare(engine.mean.current, -fine.mean.current, 'current')};
    return {schema: 'winding-edge-instruments-v1',
        agreement: samples.every(row => row.voltage.passed) && means.voltage.passed && means.current.passed,
        scope: '400 ideal voltage samples and watched signed-current/voltage means; no sim-time current scope claim',
        samples, means, refinement, meanRefinement, engine, reference};
}

export const edgeExitCode = report => report.agreement === true ? 0 : 1;

export async function runWindingEdgeInstruments () {
    const reference = runWindingEdgeReference();
    if (!reference.refinement.stable || !reference.meanRefinement.stable) {
        return {schema: 'winding-edge-instruments-v1', agreement: false,
            failure: 'reference-refinement', engine: null, reference};
    }
    const {createWindingDiagnosticBoard, WINDING_LIMITS} = await import('./diagnose-winding-transient.mjs');
    const board = createWindingDiagnosticBoard();
    const initialStorage = {capacitorVoltage: board.capVoltages.get('CP') ?? 0,
        inductorCurrent: board.inductorCurrents.get('L') ?? 0};
    let handle, attachedTimeNs = null, receipt, error = null;
    try {
        receipt = board.advanceToBoundedStream(1010000n, WINDING_LIMITS, {stepNs: 20000n, onStep: row => {
            if (row.timeNs === 1000000n) {
                attachedTimeNs = String(row.timeNs);
                handle = board.addScopeChannel({type: 'voltage', netId: 'collector', referenceNetId: 'zero',
                    sampleRateHz: 40000000, depth: 402, capture: 'sample'});
                board.meterVoltage('collector', 'zero');
                board.meterCurrent('L', 'a');
            }
        }});
    } catch (failure) { error = failure.message; }
    const status = board.transientAnalysisStatus();
    const engine = {completed: error === null && receipt?.completed === true, error,
        receipt: receipt || status.boundedAdvance, status, initialStorage, attachedTimeNs};
    if (!engine.completed) return {schema: 'winding-edge-instruments-v1', agreement: false,
        failure: 'engine-capture', engine, reference};
    try {
        const data = board.getScopeData(handle);
        engine.scopeData = {...data, samples: Array.from(data.samples)};
        engine.samples = readVoltageSampleGrid(data);
        engine.mean = {startNs: EDGE_WINDOW_NS[0], endNs: EDGE_WINDOW_NS[1],
            voltage: board.meterVoltage('collector', 'zero'), current: board.meterCurrent('L', 'a')};
    } catch (failure) {
        engine.instrumentError = failure.message;
        return {schema: 'winding-edge-instruments-v1', agreement: false,
            failure: 'instrument-acquisition', engine, reference};
    }
    return judgeWindingEdge(engine, reference);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (process.argv.length !== 2) throw new Error('Fixed edge diagnostic accepts no options');
    const report = await runWindingEdgeInstruments();
    console.log(JSON.stringify(report, (_key, value) => typeof value === 'bigint' ? String(value) : value, 2));
    process.exitCode = edgeExitCode(report);
}
