// SPDX-License-Identifier: MIT
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {bindDiagnosticImports} from './diagnose-winding-newton-sensitivity.mjs';
import {diagnosticJson} from './diagnose-winding-transient.mjs';

export const LINEAR_ARMS = Object.freeze(['cached-sparse', 'fresh-sparse', 'dense']);
const hash = source => createHash('sha256').update(source).digest('hex');
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const origins = {mna: new URL('../src/mna.js', import.meta.url),
    board: new URL('../src/board.js', import.meta.url),
    caller: new URL('./diagnose-winding-transient.mjs', import.meta.url)};

export function selectDiagnosticLinearSolver (source, arm) {
    if (!LINEAR_ARMS.includes(arm)) throw new Error('Unknown diagnostic linear arm');
    const entry = 'function solveAssembled(A, b) {';
    const cache = '  const c = _luCache;';
    if (source.split(entry).length !== 2 || source.split(cache).length !== 2) {
        throw new Error('Expected exactly one reviewed linear solver and cache anchor');
    }
    if (arm === 'cached-sparse') return source;
    if (arm === 'fresh-sparse') return source.replace(cache, '  const c = null; // diagnostic: no factor reuse');
    return source.replace(entry, `${entry}
  // Diagnostic only: copy the same assembled equations into the original
  // dense partial-pivot implementation; never mutate the stamped A or b.
  const diagnosticDense = new Matrix(A.rows, A.cols);
  for (let row = 0; row < A.rows; row++) {
    for (let col = 0; col < A.cols; col++) diagnosticDense.set(row, col, A.get(row, col));
  }
  return solve(diagnosticDense, new Float64Array(b));
`);
}

export async function runWindingLinearSolverSensitivity () {
    const originals = Object.fromEntries(Object.entries(origins).map(([key, url]) => [key, readFileSync(url, 'utf8')]));
    const sourceHashes = Object.fromEntries(Object.entries(originals).map(([key, source]) => [key, hash(source)]));
    const arms = [];
    for (const arm of LINEAR_ARMS) {
        const selected = selectDiagnosticLinearSolver(originals.mna, arm);
        const selectedMna = data(bindDiagnosticImports(selected, origins.mna).source);
        const board = bindDiagnosticImports(originals.board, origins.board, new Map([['./mna.js', selectedMna]]));
        if (board.used.get('./mna.js') !== 2) throw new Error('Both Board imports must select the diagnostic solver');
        const caller = bindDiagnosticImports(originals.caller, origins.caller,
            new Map([['../src/board.js', data(board.source)]]));
        if (caller.used.get('../src/board.js') !== 1) throw new Error('Exact winding caller must select isolated Board');
        const implementation = await import(data(caller.source));
        const capture = implementation.captureWindingDiagnostic({scenario: 'zero-storage', profile: 'precision-v1'});
        for (const [key, url] of Object.entries(origins)) {
            if (hash(readFileSync(url, 'utf8')) !== sourceHashes[key]) throw new Error('Diagnostic mutated original source');
        }
        arms.push({arm, selectedMnaHash: hash(selected), capture});
    }
    return {schema: 'winding-linear-solver-sensitivity-v1', experimentOnly: true,
        productionPolicyChanged: false, oracleAgreement: 'not-tested', sourceHashes, arms};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (process.argv.length !== 2) throw new Error('Fixed linear-solver diagnostic accepts no options');
    const report = await runWindingLinearSolverSensitivity();
    console.log(diagnosticJson(report));
    process.exitCode = report.arms.every(arm => arm.capture.completed) ? 0 : 1;
}
