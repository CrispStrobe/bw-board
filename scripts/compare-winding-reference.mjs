// SPDX-License-Identifier: MIT
import {pathToFileURL} from 'node:url';
import {refinementReport, REFERENCE_STEPS_NS, REFINEMENT_BOUNDS,
    runWindingUicReference} from './diagnose-winding-uic-reference.mjs';

export const SHARED_TIMES_NS = Object.freeze([500000, 1000000, 1010000]);
// Existing winding oracle's engineering envelope, declared before sampling.
// This is not the integrator's local truncation-error guarantee.
export const AGREEMENT_BOUNDS = Object.freeze({voltage: 100e-6, current: 1e-6});
const LIMITS = Object.freeze({maxAttempts: 20000, maxSolves: 60001, maxAdvances: 200});

export function compareWindingReference (engine, reference) {
    if (engine?.schema !== 'winding-transient-diagnostic-v1' ||
        engine.scenario !== 'zero-storage' || engine.profile !== 'precision-v1' ||
        engine.initializationMode !== 'zero-storage' || engine.initialization !== null ||
        engine.initialStorage?.capacitorVoltage !== 0 || engine.initialStorage?.inductorCurrent !== 0 ||
        engine.completed !== true || engine.error !== null || engine.status?.accuracyMet !== true ||
        engine.status.failure !== null || engine.receipt?.completed !== true || engine.receipt.failure !== null ||
        engine.requestedTimeNs !== '1010000' || engine.stepNs !== '20000' ||
        engine.receipt.requestedTimeNs !== '1010000' ||
        Object.entries(LIMITS).some(([key, bound]) => engine.limits?.[key] !== bound ||
            !Number.isSafeInteger(engine.receipt.work?.[key.slice(3).toLowerCase()]) ||
            engine.receipt.work[key.slice(3).toLowerCase()] < 0 ||
            engine.receipt.work[key.slice(3).toLowerCase()] > bound)) {
        throw new Error('Completed zero-storage engine authority required');
    }
    if (!Array.isArray(engine.rows) || engine.rows.length !== 51 || engine.rows.some((row, i) =>
        row.timeNs !== String(Math.min((i + 1) * 20000, 1010000)) || row.qualified !== false ||
        !Number.isFinite(row.collectorVoltage) || !Number.isFinite(row.inductorCurrent))) {
        throw new Error('Complete exact engine observation grid required');
    }
    if (reference?.schema !== 'winding-uic-reference-v1' || reference.arms?.length !== 3 ||
        reference.arms.some((arm, i) => arm.zeroStorage !== true ||
            arm.maxStepNs !== REFERENCE_STEPS_NS[i] || arm.startupStepNs !== arm.maxStepNs / 100)) {
        throw new Error('Three matched zero-storage reference arms required');
    }
    // Recompute stability; neither a claimed stable flag nor substituted bounds
    // can authorize comparison with an insufficiently refined reference.
    const refinement = refinementReport(reference.arms.map(arm => arm.measurements));
    if (!refinement.stable || reference.refinement?.stable !== true ||
        Object.keys(REFINEMENT_BOUNDS).some(key => reference.refinement.bounds?.[key] !== REFINEMENT_BOUNDS[key])) {
        throw new Error('Independent fixed-bound reference refinement required');
    }
    const fine = reference.arms[2].measurements;
    const comparisons = SHARED_TIMES_NS.map(timeNs => {
        const actual = engine.rows.find(row => row.timeNs === String(timeNs));
        const expected = fine.find(row => row.timeNs === timeNs);
        const voltage = {engine: actual.collectorVoltage, reference: expected.voltage};
        const current = {engine: actual.inductorCurrent, reference: expected.current};
        for (const [key, values] of Object.entries({voltage, current})) {
            values.signedError = values.engine - values.reference;
            values.absoluteError = Math.abs(values.signedError);
            values.bound = AGREEMENT_BOUNDS[key];
            values.passed = values.absoluteError <= values.bound;
        }
        return {timeNs, voltage, current};
    });
    return {schema: 'winding-reference-comparison-v1',
        agreement: comparisons.every(row => row.voltage.passed && row.current.passed),
        scope: 'three existing committed observation times only; falling edge and instruments unqualified',
        bounds: AGREEMENT_BOUNDS, comparisons, engine, reference};
}

export const comparisonExitCode = report => report.agreement === true ? 0 : 1;

export async function runWindingReferenceComparison () {
    // Dynamic import keeps pure comparison controls free of engine execution.
    const {captureWindingDiagnostic} = await import('./diagnose-winding-transient.mjs');
    const reference = runWindingUicReference();
    if (!refinementReport(reference.arms.map(arm => arm.measurements)).stable) {
        throw new Error('Independent reference is unstable; engine agreement not tested');
    }
    const engine = captureWindingDiagnostic({scenario: 'zero-storage', profile: 'precision-v1'});
    return compareWindingReference(engine, reference);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (process.argv.length !== 2) throw new Error('Fixed winding comparison accepts no options');
    const report = await runWindingReferenceComparison();
    console.log(JSON.stringify(report, (_key, value) => typeof value === 'bigint' ? String(value) : value, 2));
    process.exitCode = comparisonExitCode(report);
}
