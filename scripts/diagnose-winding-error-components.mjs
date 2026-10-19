// SPDX-License-Identifier: MIT
// Evidence-only module instrumentation; production sources are never written.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {bindDiagnosticImports} from './diagnose-winding-newton-sensitivity.mjs';
import {diagnosticJson} from './diagnose-winding-transient.mjs';

const boardUrl = new URL('../src/board.js', import.meta.url);
const callerUrl = new URL('./diagnose-winding-transient.mjs', import.meta.url);
const hash = text => createHash('sha256').update(text).digest('hex');
const moduleUrl = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
export const ERROR_ANCHOR = '      const atFloor = hEff <= H_MIN * 1.000001 && err > 1;';

// Self-contained so the exact reviewed function can be embedded in Board.
export function recordErrorWitness (records, state) {
    if (records.some(record => record.atFloor) || !(state.err > 1)) return;
    const {full, half, absoluteVoltage, absoluteCurrent, relativeTolerance} = state;
    const components = [];
    for (const [kind, key, absolute] of [
        ['nodeVoltage', 'nodeVoltages', absoluteVoltage],
        ['capacitorVoltage', 'capVoltagesNext', absoluteVoltage],
        ['inductorCurrent', 'inductorCurrentsNext', absoluteCurrent]
    ]) {
        for (const [id, halfValue] of half[key] ?? []) {
            const fullValue = full[key]?.get(id) ?? 0;
            const scale = absolute + relativeTolerance * Math.max(Math.abs(halfValue), Math.abs(fullValue));
            components.push({kind, id, fullValue, halfValue, signedDifference: fullValue - halfValue,
                scale, normalizedError: Math.abs(fullValue - halfValue) / scale});
        }
    }
    components.sort((a, b) => b.normalizedError - a.normalizedError);
    records.push({timeSec: state.timeSec, stepSec: state.stepSec, error: state.err,
        atFloor: state.stepSec <= state.minStepSec * 1.000001,
        converged: {full: full.converged, firstHalf: state.firstHalf.converged, half: half.converged},
        dominant: components[0], components,
        incoming: Object.fromEntries(['cv', 'il', 'cc', 'lv'].map(key => [key, Object.fromEntries(state[key])]))});
    // Last eight rejects and the first floor witness only: fixed memory bound.
    if (records.length > 9) records.shift();
}

export function instrumentBoardError (source) {
    if (source.split(ERROR_ANCHOR).length - 1 !== 1) throw new Error('Expected exactly one reviewed endpoint-error anchor');
    return `export const windingErrorWitnesses = [];\nconst recordWindingError = ${recordErrorWitness.toString()};\n` +
        source.replace(ERROR_ANCHOR, `      recordWindingError(windingErrorWitnesses, {full, half: h2, firstHalf: h1,
        cv, il, cc, lv, timeSec: t, stepSec: hEff, err, minStepSec: H_MIN,
        absoluteVoltage: ABSTOL_V, absoluteCurrent: ABSTOL_I, relativeTolerance: RELTOL});\n${ERROR_ANCHOR}`);
}

export async function captureWindingErrorComponents () {
    const originalBoard = readFileSync(boardUrl, 'utf8');
    const originalCaller = readFileSync(callerUrl, 'utf8');
    const instrumented = instrumentBoardError(originalBoard);
    const selectedBoard = moduleUrl(bindDiagnosticImports(instrumented, boardUrl).source);
    const caller = bindDiagnosticImports(originalCaller, callerUrl, new Map([['../src/board.js', selectedBoard]]));
    if (caller.used.get('../src/board.js') !== 1) throw new Error('Exact winding caller must select instrumented Board');
    const implementation = await import(moduleUrl(caller.source));
    const capture = implementation.captureWindingDiagnostic({scenario: 'zero-storage', profile: 'precision-v1'});
    const {windingErrorWitnesses} = await import(selectedBoard);
    if (readFileSync(boardUrl, 'utf8') !== originalBoard || readFileSync(callerUrl, 'utf8') !== originalCaller) {
        throw new Error('Diagnostic changed production source');
    }
    return {schema: 'winding-error-components-v1', experimentOnly: true, productionPolicyChanged: false,
        sourceHashes: {board: hash(originalBoard), caller: hash(originalCaller), instrumentedBoard: hash(instrumented)},
        witnesses: windingErrorWitnesses, capture};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (process.argv.length !== 2) throw new Error('This fixed diagnostic accepts no options');
    const report = await captureWindingErrorComponents();
    console.log(diagnosticJson(report));
    process.exitCode = report.capture.completed ? 0 : 1;
}
