// SPDX-License-Identifier: MIT
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {parseReferenceWaveform, sampleReferenceWaveform, referenceIntervalMean} from './diagnose-winding-uic-reference.mjs';

export const MATRIX_CASES = Object.freeze([
    ...[[100, 1e-9], [1000, 1e-9], [1000, 1e-8], [10000, 1e-8]].map(([r, c], i) =>
        Object.freeze({id: `rc-${i + 1}`, family: 'rc', r, c})),
    ...[[100, 1e-4, 1e-9], [200, 1e-4, 1e-9], [100, 1e-3, 1e-9], [1000, 1e-3, 1e-8]].map(([r, l, c], i) =>
        Object.freeze({id: `rlc-${i + 1}`, family: 'rlc', r, l, c})),
    ...[[100, 1e-9], [1000, 1e-9], [100, 1e-8], [1000, 1e-8]].map(([r, c], i) =>
        Object.freeze({id: `diode-${i + 1}`, family: 'diode', r, c}))
]);
export const MATRIX_TIMES_NS = Object.freeze(Array.from({length: 200}, (_, i) => (i + 1) * 100));
export const MATRIX_BOUNDS = Object.freeze({reference: Object.freeze({voltage: 1e-5, current: 1e-7}),
    agreement: Object.freeze({voltage: 1e-4, current: 1e-6})});
const LIMITS = Object.freeze({maxAttempts: 20000, maxSolves: 60001, maxAdvances: 200});
const net = (id, ...pins) => ({id, terminals: pins.map(([part, terminal]) => ({part, terminal}))});

export function matrixCase (id) {
    const selected = MATRIX_CASES.find(row => row.id === id);
    if (!selected) throw new Error(`Unknown reviewed transient case: ${id}`);
    return selected;
}

export function matrixDeck (id, maxStepNs) {
    const row = matrixCase(id);
    if (![.5, .25].includes(maxStepNs)) throw new Error('Unreviewed matrix refinement');
    const temp = .02585 * 1.602176634e-19 / 1.380649e-23 - 273.15;
    const diode = row.family === 'diode';
    const input = diode ? '-1 2' : '0 5';
    return ['Independent authored transient matrix',
        `.options temp=${temp.toPrecision(12)} tnom=${temp.toPrecision(12)} method=gear maxord=2 reltol=1e-9 abstol=1e-14 vntol=1e-11 trtol=1`,
        `VP input 0 PULSE(${input} 1u 2u 2u 8u 20u)`,
        'VSENSE input feed 0',
        ...(row.family === 'rlc' ? [`L1 feed winding ${row.l} IC=0`, `R1 winding out ${row.r}`] :
            [`R1 feed ${diode ? 'anode' : 'out'} ${row.r}`]),
        ...(diode ? ['D1 anode out DM', '.model DM D(IS=1e-12 N=1 RS=.568)'] : []),
        `C1 out 0 ${row.c} IC=0`, ...(row.family === 'rc' ? [] : [`RLOAD out 0 ${diode ? 10000 : 1e7}`]),
        '.control', 'set numdgt=15',
        `tran ${maxStepNs / 100}n 20.1u 0 ${maxStepNs}n uic`,
        'let ref_voltage = v(out)', 'let ref_current = i(VSENSE)',
        'set wr_singlescale', 'set wr_vecnames', 'wrdata reference.dat ref_voltage ref_current',
        '.endc', '.end', ''].join('\n');
}

export function matrixRefinement (coarse, fine) {
    const complete = arm => arm?.measurements?.length === 200 && arm.measurements.every((row, i) =>
        row.timeNs === MATRIX_TIMES_NS[i] && Number.isFinite(row.voltage) && Number.isFinite(row.current)) &&
        arm.mean?.startNs === 100 && arm.mean?.endNs === 20000 &&
        Number.isFinite(arm.mean.voltage) && Number.isFinite(arm.mean.current);
    if (coarse?.maxStepNs !== .5 || fine?.maxStepNs !== .25 || !complete(coarse) || !complete(fine)) {
        throw new Error('Complete aligned finite matrix reference required');
    }
    const differences = coarse.measurements.map((row, i) => ({timeNs: row.timeNs,
        voltage: Math.abs(row.voltage - fine.measurements[i].voltage),
        current: Math.abs(row.current - fine.measurements[i].current)}));
    const means = {voltage: Math.abs(coarse.mean.voltage - fine.mean.voltage),
        current: Math.abs(coarse.mean.current - fine.mean.current)};
    return {stable: [...differences, means].every(row => ['voltage', 'current'].every(key =>
        row[key] <= MATRIX_BOUNDS.reference[key])), bounds: MATRIX_BOUNDS.reference, differences, means};
}

export function compareMatrixCase (engine, reference) {
    const definition = matrixCase(reference?.caseId);
    if (engine?.caseId !== definition.id || engine.initialStorage?.capacitorVoltage !== 0 ||
        engine.initialStorage?.inductorCurrent !== (definition.family === 'rlc' ? 0 : null) ||
        engine.status?.profile?.id !== 'precision-v1') {
        throw new Error('Matched case and zero-storage precision initialization required');
    }
    if (reference?.arms?.length !== 2) throw new Error('Exactly two ordered reference arms required');
    const refinement = matrixRefinement(...reference.arms);
    if (!refinement.stable) throw new Error('Matrix reference refinement failed before engine comparison');
    if (engine?.receipt?.completed !== true || engine.receipt.failure !== null || engine.status?.accuracyMet !== true ||
        engine.status.failure !== null || engine.receipt.requestedTimeNs !== '20000' ||
        Object.entries(LIMITS).some(([key, limit]) => engine.receipt.limits?.[key] !== limit ||
            !Number.isSafeInteger(engine.receipt.work?.[key.slice(3).toLowerCase()]) ||
            engine.receipt.work[key.slice(3).toLowerCase()] < 0 || engine.receipt.work[key.slice(3).toLowerCase()] > limit) ||
        engine.samples?.length !== 200 || engine.samples.some((row, i) => row.timeNs !== MATRIX_TIMES_NS[i] ||
            !Number.isFinite(row.voltage) || !Number.isFinite(row.current)) ||
        engine.mean?.startNs !== 100 || engine.mean?.endNs !== 20000 ||
        !Number.isFinite(engine.mean.voltage) || !Number.isFinite(engine.mean.current)) {
        throw new Error('Completed exact-grid matrix engine authority required');
    }
    const compare = (actual, expected, key) => ({engine: actual, reference: expected,
        absoluteError: Math.abs(actual - expected), bound: MATRIX_BOUNDS.agreement[key],
        passed: Math.abs(actual - expected) <= MATRIX_BOUNDS.agreement[key]});
    const fine = reference.arms[1];
    const comparisons = engine.samples.map((row, i) => ({timeNs: row.timeNs,
        voltage: compare(row.voltage, fine.measurements[i].voltage, 'voltage'),
        current: compare(row.current, -fine.measurements[i].current, 'current')}));
    const means = {voltage: compare(engine.mean.voltage, fine.mean.voltage, 'voltage'),
        current: compare(engine.mean.current, -fine.mean.current, 'current')};
    return {agreement: [...comparisons, means].every(row => row.voltage.passed && row.current.passed),
        refinement, comparisons, means};
}

function runReference (id, maxStepNs, executable) {
    const deck = matrixDeck(id, maxStepNs), directory = mkdtempSync(join(tmpdir(), 'transient-matrix-'));
    try {
        const child = spawnSync(executable, ['-n', '-b'], {cwd: directory, input: deck, encoding: 'utf8',
            timeout: 120000, maxBuffer: 1048576, env: {...process.env, NGSPICE_MEAS_PRECISION: '15'}});
        if (child.error || child.status !== 0) throw new Error(`Matrix SPICE process refused: ${child.error || child.stderr}`);
        const table = readFileSync(join(directory, 'reference.dat'), 'utf8');
        const rows = parseReferenceWaveform(table, child.stdout, child.stderr);
        return {maxStepNs, deck, deckSha256: createHash('sha256').update(deck).digest('hex'),
            waveformSha256: createHash('sha256').update(table).digest('hex'), waveformRows: rows.length,
            measurements: sampleReferenceWaveform(rows, MATRIX_TIMES_NS), mean: referenceIntervalMean(rows, 100, 20000)};
    } finally { rmSync(directory, {recursive: true, force: true}); }
}

async function captureEngine (id) {
    const row = matrixCase(id), diode = row.family === 'diode', currentPart = row.family === 'rlc' ? 'L' : 'R';
    const {BoardImpl} = await import('../src/board.js');
    const board = new BoardImpl(5); board.configureTransientAnalysis('precision-v1');
    const parts = [
        {id: 'P', kind: 'vsource', params: {wave: 'spice-pulse', v1: diode ? -1 : 0,
            v2: diode ? 2 : 5, td: 1e-6, tr: 2e-6, tf: 2e-6, pw: 8e-6, per: 20e-6}, terminals: ['pos', 'neg']},
        {id: 'G', kind: 'gnd', params: {}, terminals: ['gnd']},
        {id: 'R', kind: 'resistor', params: {ohms: row.r}, terminals: ['a', 'b']},
        {id: 'C', kind: 'capacitor', params: {farads: row.c}, terminals: ['a', 'b']}
    ];
    const nets = [net('input', ['P', 'pos'], [currentPart, 'a']),
        net('zero', ['P', 'neg'], ['G', 'gnd'], ['C', 'b']), net('out', ['C', 'a'])];
    if (row.family === 'rlc') {
        parts.push({id: 'L', kind: 'inductor', params: {henrys: row.l}, terminals: ['a', 'b']});
        nets.push(net('winding', ['L', 'b'], ['R', 'a'])); nets[2].terminals.push({part: 'R', terminal: 'b'});
    } else if (diode) {
        parts.push({id: 'D', kind: 'diode', params: {model: 'shockley', is: 1e-12, n: 1, rs: .568}, terminals: ['anode', 'cathode']});
        nets.push(net('anode', ['R', 'b'], ['D', 'anode'])); nets[2].terminals.push({part: 'D', terminal: 'cathode'});
    } else nets[2].terminals.push({part: 'R', terminal: 'b'});
    if (row.family !== 'rc') {
        parts.push({id: 'RL', kind: 'resistor', params: {ohms: diode ? 10000 : 1e7}, terminals: ['a', 'b']});
        nets[1].terminals.push({part: 'RL', terminal: 'b'}); nets[2].terminals.push({part: 'RL', terminal: 'a'});
    }
    board.setNetlist(parts, nets); board.setPower(true); board.reset();
    const voltage = board.addScopeChannel({type: 'voltage', netId: 'out', referenceNetId: 'zero',
        capture: 'sample', sampleRateHz: 1e7, depth: 202});
    const current = board.addScopeChannel({type: 'current', partId: currentPart, terminal: 'a',
        currentClock: 'simulation', sampleRateHz: 1e7, depth: 202});
    const result = {caseId: id, initialStorage: {capacitorVoltage: board.capVoltages.get('C'),
        inductorCurrent: row.family === 'rlc' ? board.inductorCurrents.get('L') ?? 0 : null}};
    try {
        result.receipt = board.advanceToBoundedStream(20000n, LIMITS, {stepNs: 100n, onStep: ({timeNs}) => {
            if (timeNs === 100n) {board.meterVoltage('out', 'zero'); board.meterCurrent(currentPart, 'a');}
        }});
        const v = board.getScopeData(voltage), c = board.getScopeData(current);
        if ([v, c].some(data => data.count !== 200 || data.startTNs !== 100n || data.sampleIntervalNs !== 100n ||
            data.capture !== 'sample' || data.writeIndex !== 200) || c.currentClock !== 'simulation') {
            throw new Error('Matrix instrument metadata/grid refused');
        }
        result.samples = MATRIX_TIMES_NS.map((timeNs, i) => {
            if (v.samples[2 * i] !== v.samples[2 * i + 1] || c.samples[2 * i] !== c.samples[2 * i + 1]) {
                throw new Error('Matrix instrument sample pairs refused');
            }
            return {timeNs, voltage: v.samples[2 * i], current: c.samples[2 * i]};
        });
        result.mean = {startNs: 100, endNs: 20000, voltage: board.meterVoltage('out', 'zero'), current: board.meterCurrent(currentPart, 'a')};
    } catch (error) { result.error = error.message; }
    result.status = board.transientAnalysisStatus(); result.receipt ||= result.status.boundedAdvance;
    return result;
}

export async function runMatrixCase (id, executable = process.env.NGSPICE || 'ngspice') {
    const definition = matrixCase(id), reference = {caseId: id, arms: []};
    const report = {schema: 'transient-matrix-case-v1', definition, agreement: false, reference, engine: null};
    try {
        const version = spawnSync(executable, ['--version'], {encoding: 'utf8', timeout: 5000});
        if (version.error || version.status !== 0) throw new Error('Independent SPICE executable unavailable');
        reference.version = version.stdout + version.stderr;
        for (const step of [.5, .25]) reference.arms.push(runReference(id, step, executable));
    } catch (error) { return {...report, failure: 'reference-process', error: error.message}; }
    if (!matrixRefinement(...reference.arms).stable) return {...report, failure: 'reference-refinement'};
    report.engine = await captureEngine(id);
    if (report.engine.error) return {...report, failure: 'engine-capture'};
    return {...report, ...compareMatrixCase(report.engine, reference)};
}

export function parseMatrixArguments (args) {
    if (args.length === 0) return MATRIX_CASES.map(row => row.id);
    if (args.length !== 2 || args[0] !== '--case') throw new Error('Usage: qualify-transient-matrix.mjs [--case reviewed-id]');
    return [matrixCase(args[1]).id];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    let passed = true;
    for (const id of parseMatrixArguments(process.argv.slice(2))) {
        const report = await runMatrixCase(id);
        console.log(JSON.stringify(report, (_key, value) => typeof value === 'bigint' ? String(value) : value));
        passed &&= report.agreement === true;
    }
    process.exitCode = passed ? 0 : 1;
}
