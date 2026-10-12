// SPDX-License-Identifier: MIT
// Independent reference characterization, not engine-generated golden data.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export const REFERENCE_TIMES_NS = Object.freeze([25, 500000, 1000000, 1001200,
    1002000, 1002100, 1002500, 1003000, 1005000, 1010000]);
export const REFERENCE_STEPS_NS = Object.freeze([100, 50, 25]);
export const REFINEMENT_BOUNDS = Object.freeze({voltage: 1e-5, current: 1e-9});
export const MEASUREMENT_PRECISION = 15;

export function referenceProcessOptions (deck) {
    return {input: deck, encoding: 'utf8', timeout: 120000, maxBuffer: 1048576,
        // `numdgt` controls tables, not `meas`: force its separate authority.
        env: {...process.env, NGSPICE_MEAS_PRECISION: String(MEASUREMENT_PRECISION)}};
}

export function windingReferenceDeck (maxStepNs, zeroStorage = true) {
    if (!REFERENCE_STEPS_NS.includes(maxStepNs)) throw new Error('Unreviewed reference step');
    if (typeof zeroStorage !== 'boolean') throw new Error('Initialization must be explicit');
    const temp = .02585 * 1.602176634e-19 / 1.380649e-23 - 273.15;
    return ['Independent zero-storage winding reference',
        `.options temp=${temp.toPrecision(12)} tnom=${temp.toPrecision(12)} method=gear maxord=2 reltol=1e-7 abstol=1e-12 vntol=1e-9`,
        'VCC supply 0 5', 'VP drive 0 PULSE(0 5 0 1u 1u 1m 3m)',
        'RB drive base 22700', 'Q1 collector base 0 QM',
        `LW supply winding 5m${zeroStorage ? ' IC=0' : ''}`,
        'RW winding collector 10', 'DF collector supply DM',
        `CP collector 0 12p${zeroStorage ? ' IC=0' : ''}`, 'RP collector 0 10meg',
        '.model QM NPN(IS=1e-14 BF=100 BR=1 VAF=100)',
        '.model DM D(IS=1e-12 N=1 RS=.568)',
        '.control', 'set numdgt=15',
        `tran ${maxStepNs}n 1.011m 0 ${maxStepNs}n${zeroStorage ? ' uic' : ''}`,
        ...REFERENCE_TIMES_NS.flatMap((ns, i) => [
            `meas tran v${i} FIND v(collector) AT=${ns * 1e-9}`,
            `meas tran i${i} FIND i(LW) AT=${ns * 1e-9}`]),
        '.endc', '.end', ''].join('\n');
}

export function parseReferenceMeasurements (stdout, stderr = '') {
    if (/Error:|timestep too small|out of interval|failed|fatal/i.test(stdout + stderr)) {
        throw new Error(`Reference solve/measurement refused: ${stdout}\n${stderr}`);
    }
    const scalar = name => {
        const matches = [...stdout.matchAll(new RegExp(`^${name}\\s*=\\s*([-+\\deE.]+)\\s*$`, 'gm'))];
        if (matches.length !== 1 || !Number.isFinite(Number(matches[0][1]))) {
            throw new Error(`Expected one finite reference measurement ${name}`);
        }
        if (!/^[+-]?\d+\.\d{12,}[eE][+-]?\d+$/.test(matches[0][1])) {
            throw new Error(`Insufficient printed measurement precision for ${name}`);
        }
        return Number(matches[0][1]);
    };
    return REFERENCE_TIMES_NS.map((timeNs, i) => ({timeNs, voltage: scalar(`v${i}`), current: scalar(`i${i}`)}));
}

export function refinementReport (captures) {
    if (captures.length !== 3 || captures.some((rows, arm) => rows.length !== REFERENCE_TIMES_NS.length ||
        rows.some((row, i) => row.timeNs !== REFERENCE_TIMES_NS[i] ||
            !Number.isFinite(row.voltage) || !Number.isFinite(row.current)))) {
        throw new Error('Reference refinement requires all three complete aligned finite captures');
    }
    const differences = REFERENCE_TIMES_NS.map((timeNs, i) => ({timeNs,
        voltage: captures.slice(1).map((rows, arm) => Math.abs(rows[i].voltage - captures[arm][i].voltage)),
        current: captures.slice(1).map((rows, arm) => Math.abs(rows[i].current - captures[arm][i].current))}));
    const stable = differences.every(row => ['voltage', 'current'].every(key =>
        row[key].every(delta => delta <= REFINEMENT_BOUNDS[key])));
    return {stable, bounds: REFINEMENT_BOUNDS, differences};
}

export function runWindingUicReference (executable = process.env.NGSPICE || 'ngspice') {
    const version = spawnSync(executable, ['--version'], {encoding: 'utf8', timeout: 5000});
    if (version.error || version.status !== 0) throw new Error('Independent ngspice executable unavailable');
    const run = (maxStepNs, zeroStorage) => {
        const deck = windingReferenceDeck(maxStepNs, zeroStorage);
        const process = spawnSync(executable, ['-n', '-b'], referenceProcessOptions(deck));
        if (process.error || process.status !== 0) throw new Error(`Reference process failed: ${process.error || process.stderr}`);
        return {maxStepNs, zeroStorage, deck, deckSha256: createHash('sha256').update(deck).digest('hex'),
            measurements: parseReferenceMeasurements(process.stdout, process.stderr),
            stdout: process.stdout, stderr: process.stderr};
    };
    const arms = REFERENCE_STEPS_NS.map(step => run(step, true));
    const normalOp = run(25, false);
    return {schema: 'winding-uic-reference-v1', independentReferenceOnly: true,
        engineAgreement: 'not-tested', measurementPrecision: MEASUREMENT_PRECISION,
        version: version.stdout + version.stderr,
        refinement: refinementReport(arms.map(arm => arm.measurements)), arms, normalOp};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (process.argv.length !== 2) throw new Error('Fixed reference diagnostic accepts no options');
    const report = runWindingUicReference();
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.refinement.stable ? 0 : 1;
}
