// SPDX-License-Identifier: MIT
// Independent reference characterization, not engine-generated golden data.
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export const REFERENCE_TIMES_NS = Object.freeze([25, 500000, 1000000, 1001200,
    1002000, 1002100, 1002500, 1003000, 1005000, 1010000]);
export const REFERENCE_STEPS_NS = Object.freeze([100, 50, 25]);
export const REFINEMENT_BOUNDS = Object.freeze({voltage: 1e-5, current: 1e-9});
export const MEASUREMENT_PRECISION = 15;

export function referenceProcessOptions (deck) {
    return {input: deck, encoding: 'utf8', timeout: 120000, maxBuffer: 1048576,
        // Supplemental batch measurement setting. Interactive FIND also has
        // a hard-coded short print/store path; authoritative values use wrdata.
        env: {...process.env, NGSPICE_MEAS_PRECISION: String(MEASUREMENT_PRECISION)}};
}

export function windingReferenceDeck (maxStepNs, zeroStorage = true) {
    if (!REFERENCE_STEPS_NS.includes(maxStepNs)) throw new Error('Unreviewed reference step');
    if (typeof zeroStorage !== 'boolean') throw new Error('Initialization must be explicit');
    const temp = .02585 * 1.602176634e-19 / 1.380649e-23 - 273.15;
    return ['Independent zero-storage winding reference',
        `.options temp=${temp.toPrecision(12)} tnom=${temp.toPrecision(12)} method=gear maxord=2 reltol=1e-9 abstol=1e-14 vntol=1e-11 trtol=1`,
        'VCC supply 0 5', 'VP drive 0 PULSE(0 5 0 1u 1u 1m 3m)',
        'RB drive base 22700', 'Q1 collector base 0 QM',
        `LW supply winding 5m${zeroStorage ? ' IC=0' : ''}`,
        'RW winding collector 10', 'DF collector supply DM',
        `CP collector 0 12p${zeroStorage ? ' IC=0' : ''}`, 'RP collector 0 10meg',
        '.model QM NPN(IS=1e-14 BF=100 BR=1 VAF=100)',
        '.model DM D(IS=1e-12 N=1 RS=.568)',
        '.control', 'set numdgt=15',
        `tran ${maxStepNs}n 1.011m 0 ${maxStepNs}n${zeroStorage ? ' uic' : ''}`,
        'let ref_voltage = v(collector)', 'let ref_current = i(LW)',
        'set wr_singlescale', 'set wr_vecnames',
        'wrdata reference.dat ref_voltage ref_current',
        '.endc', '.end', ''].join('\n');
}

export function parseReferenceWaveform (table, stdout = '', stderr = '') {
    if (/Error:|timestep too small|out of interval|failed|fatal/i.test(stdout + stderr)) {
        throw new Error(`Reference solve/measurement refused: ${stdout}\n${stderr}`);
    }
    if (Buffer.byteLength(table) > 8 * 1048576) throw new Error('Reference table exceeds finite authority');
    const lines = table.trim().split(/\r?\n/);
    if (lines.shift().trim().replace(/\s+/g, ' ') !== 'time ref_voltage ref_current') {
        throw new Error('Unexpected reference vector/time authority');
    }
    const rows = lines.map(line => {
        const tokens = line.trim().split(/\s+/);
        if (tokens.length !== 3 || tokens.some(token => !/^[+-]?\d+\.\d{12,}[eE][+-]?\d+$/.test(token))) {
            throw new Error('Reference waveform needs three full-precision columns');
        }
        const values = tokens.map(Number);
        if (!values.every(Number.isFinite)) throw new Error('Nonfinite reference waveform');
        return {timeSec: values[0], voltage: values[1], current: values[2], raw: line};
    });
    if (rows.length < 2 || rows.some((row, i) => i && row.timeSec <= rows[i - 1].timeSec)) {
        throw new Error('Reference waveform must contain strictly ordered time rows');
    }
    return rows;
}

export function sampleReferenceWaveform (rows) {
    return REFERENCE_TIMES_NS.map(timeNs => {
        const at = timeNs * 1e-9;
        if (at < rows[0].timeSec || at > rows.at(-1).timeSec) throw new Error('Reference measurement outside waveform');
        let low = 0, high = rows.length - 1;
        while (high - low > 1) {
            const mid = Math.floor((low + high) / 2);
            if (rows[mid].timeSec <= at) low = mid; else high = mid;
        }
        const left = rows[low], right = rows[high];
        const fraction = (at - left.timeSec) / (right.timeSec - left.timeSec);
        const voltage = left.voltage + fraction * (right.voltage - left.voltage);
        const current = left.current + fraction * (right.current - left.current);
        return {timeNs, voltage, current, bracket: {left, right, fraction}};
    });
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
        const directory = mkdtempSync(join(tmpdir(), 'winding-reference-'));
        try {
            const child = spawnSync(executable, ['-n', '-b'], {...referenceProcessOptions(deck), cwd: directory});
            if (child.error || child.status !== 0) throw new Error(`Reference process failed: ${child.error || child.stderr}`);
            const table = readFileSync(join(directory, 'reference.dat'), 'utf8');
            const rows = parseReferenceWaveform(table, child.stdout, child.stderr);
            return {maxStepNs, zeroStorage, deck, deckSha256: createHash('sha256').update(deck).digest('hex'),
                waveformSha256: createHash('sha256').update(table).digest('hex'), waveformRows: rows.length,
                measurements: sampleReferenceWaveform(rows), stdout: child.stdout, stderr: child.stderr};
        } finally {
            // Only the freshly created, task-owned solver directory is removed.
            rmSync(directory, {recursive: true, force: true});
        }
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
