// SPDX-License-Identifier: MIT
// Diagnostic experiment only: no on-disk source mutation or production policy.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {diagnosticJson} from './diagnose-winding-transient.mjs';

const files = Object.freeze({
    mna: new URL('../src/mna.js', import.meta.url),
    board: new URL('../src/board.js', import.meta.url),
    caller: new URL('./diagnose-winding-transient.mjs', import.meta.url)
});
const sha256 = source => createHash('sha256').update(source).digest('hex');
const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
export const NEWTON_ARMS = Object.freeze([1e-6, 1e-10]);

export function changeDiagnosticNewtonTolerance (source, tolerance) {
    if (!NEWTON_ARMS.includes(tolerance)) throw new Error('Only the two reviewed diagnostic arms are permitted');
    const anchor = 'const NR_TOL = 1e-6;';
    if (source.split(anchor).length - 1 !== 1) throw new Error('Newton diagnostic requires exactly one original tolerance anchor');
    return source.replace(anchor, `const NR_TOL = ${tolerance === 1e-6 ? '1e-6' : '1e-10'};`);
}

// Rebind actual static relative imports. Other dependencies retain their exact
// source modules; both board imports of mna must select the same isolated arm.
export function bindDiagnosticImports (source, origin, overrides = new Map()) {
    const used = new Map([...overrides.keys()].map(key => [key, 0]));
    const rebound = source.replace(/\bfrom\s+(['"])(\.{1,2}\/[^'"]+)\1/g, (_match, _quote, specifier) => {
        if (used.has(specifier)) used.set(specifier, used.get(specifier) + 1);
        return `from ${JSON.stringify(overrides.get(specifier) ?? new URL(specifier, origin).href)}`;
    });
    return {source: rebound, used};
}

export function prepareNewtonArm (tolerance) {
    const originals = Object.fromEntries(Object.entries(files).map(([key, url]) => [key, readFileSync(url, 'utf8')]));
    const editedMna = changeDiagnosticNewtonTolerance(originals.mna, tolerance);
    const mna = bindDiagnosticImports(editedMna, files.mna);
    const board = bindDiagnosticImports(originals.board, files.board, new Map([['./mna.js', dataModule(mna.source)]]));
    if (board.used.get('./mna.js') !== 2) throw new Error('Both reviewed Board MNA imports must select the diagnostic arm');
    const caller = bindDiagnosticImports(originals.caller, files.caller,
        new Map([['../src/board.js', dataModule(board.source)]]));
    if (caller.used.get('../src/board.js') !== 1) throw new Error('The exact winding caller must select its isolated Board');
    return {tolerance, originals, editedMna, moduleUrl: dataModule(caller.source),
        sourceHashes: Object.fromEntries(Object.entries(originals).map(([key, source]) => [key, sha256(source)]))};
}

export async function runWindingNewtonSensitivity () {
    const arms = [];
    for (const tolerance of NEWTON_ARMS) {
        const prepared = prepareNewtonArm(tolerance);
        const implementation = await import(prepared.moduleUrl);
        const capture = implementation.captureWindingDiagnostic({scenario: 'zero-storage', profile: 'precision-v1'});
        for (const [key, url] of Object.entries(files)) {
            if (sha256(readFileSync(url, 'utf8')) !== prepared.sourceHashes[key]) {
                throw new Error(`Diagnostic changed original ${key} source`);
            }
        }
        arms.push({newtonTolerance: tolerance, sourceHashes: prepared.sourceHashes,
            editedMnaHash: sha256(prepared.editedMna), capture});
    }
    return {schema: 'winding-newton-sensitivity-v1', experimentOnly: true,
        productionPolicyChanged: false, oracleAgreement: 'not-tested', arms};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (process.argv.length !== 2) throw new Error('This diagnostic has exactly two fixed arms and accepts no options');
    const report = await runWindingNewtonSensitivity();
    console.log(diagnosticJson(report));
    // A valid experiment is not a completed waveform: retain nonzero CLI exit
    // while either arm refuses, including the known baseline failure.
    process.exitCode = report.arms.every(arm => arm.capture.completed) ? 0 : 1;
}
