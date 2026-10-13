// SPDX-License-Identifier: MIT
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {parseReferenceWaveform, sampleReferenceWaveform, referenceIntervalMean} from './diagnose-winding-uic-reference.mjs';

export const TRANSISTOR_CASES = Object.freeze([
    ...[1000, 100000].flatMap((rb, i) => [100, 1000].map((rc, j) =>
        Object.freeze({id: `npn-${2 * i + j + 1}`, rb, rc, c: j ? 1e-8 : 1e-9})))
]);
export const TRANSISTOR_CARD = Object.freeze({model: 'shockley', is: 1e-14, beta: 200, br: 1, n: 1,
    vaf: 0, rb: 0, rc: 0, cje: 0, cjc: 0, tf: 0});
export const TRANSISTOR_TIMES_NS = Object.freeze(Array.from({length: 200}, (_, i) => (i + 1) * 100));
export const TRANSISTOR_LIMITS = Object.freeze({maxAttempts: 20000, maxSolves: 60001, maxAdvances: 200});
export const TRANSISTOR_BOUNDS = Object.freeze({reference: Object.freeze({voltage: 1e-5, current: 1e-7}),
    agreement: Object.freeze({voltage: 1e-4, current: 1e-6})});
const net = (id, ...pins) => ({id, terminals: pins.map(([part, terminal]) => ({part, terminal}))});

export function transistorCase (id) {
    const row = TRANSISTOR_CASES.find(item => item.id === id);
    if (!row) throw new Error(`Unknown reviewed transistor case: ${id}`);
    return row;
}

export function transistorDeck (id, maxStepNs) {
    const row = transistorCase(id);
    if (![.5, .25].includes(maxStepNs)) throw new Error('Unreviewed transistor refinement');
    const temp = .02585 * 1.602176634e-19 / 1.380649e-23 - 273.15;
    return ['Independent authored NPN collector experiment',
        `.options temp=${temp.toPrecision(12)} tnom=${temp.toPrecision(12)} method=gear maxord=2 reltol=1e-9 abstol=1e-14 vntol=1e-11 trtol=1`,
        'VCC supply 0 5', 'VSENSE supply feed 0',
        'VBASE input 0 PULSE(0 1.5 1u 2u 2u 8u 20u)',
        `RB input base ${row.rb}`, `RC feed collector ${row.rc}`,
        'Q1 collector base 0 QM', `C1 collector 0 ${row.c} IC=0`,
        '.model QM NPN(IS=1e-14 BF=200 BR=1 NF=1 NR=1 VAF=0 VAR=0 RB=0 RC=0 RE=0 CJE=0 CJC=0 TF=0 TR=0)',
        '.control', 'set numdgt=15', `tran ${maxStepNs / 100}n 20.1u 0 ${maxStepNs}n uic`,
        'let ref_voltage = v(collector)', 'let ref_current = i(VSENSE)',
        'set wr_singlescale', 'set wr_vecnames', 'wrdata reference.dat ref_voltage ref_current',
        '.endc', '.end', ''].join('\n');
}

export function transistorRefinement (coarse, fine) {
    const complete = arm => arm?.measurements?.length === 200 && arm.measurements.every((row, i) =>
        row.timeNs === TRANSISTOR_TIMES_NS[i] && Number.isFinite(row.voltage) && Number.isFinite(row.current)) &&
        arm.mean?.startNs === 100 && arm.mean?.endNs === 20000 &&
        Number.isFinite(arm.mean.voltage) && Number.isFinite(arm.mean.current);
    if (coarse?.maxStepNs !== .5 || fine?.maxStepNs !== .25 || !complete(coarse) || !complete(fine)) {
        throw new Error('Complete aligned transistor reference required');
    }
    const differences = coarse.measurements.map((row, i) => ({timeNs: row.timeNs,
        voltage: Math.abs(row.voltage - fine.measurements[i].voltage),
        current: Math.abs(row.current - fine.measurements[i].current)}));
    const means = {voltage: Math.abs(coarse.mean.voltage - fine.mean.voltage),
        current: Math.abs(coarse.mean.current - fine.mean.current)};
    return {stable: [...differences, means].every(row => ['voltage', 'current'].every(key =>
        row[key] <= TRANSISTOR_BOUNDS.reference[key])), differences, means};
}

export function compareTransistorCapture (engine, reference) {
    const definition = transistorCase(reference?.caseId);
    if (engine?.caseId !== definition.id || engine.initialCapacitorVoltage !== 0 ||
        JSON.stringify(engine.card) !== JSON.stringify(TRANSISTOR_CARD) ||
        engine.status?.profile?.id !== 'precision-v1' || engine.status.accuracyMet !== true ||
        engine.status.failure !== null || engine.receipt?.completed !== true || engine.receipt.failure !== null ||
        engine.receipt.requestedTimeNs !== '20000' ||
        Object.entries(TRANSISTOR_LIMITS).some(([key, limit]) => {
            const used = engine.receipt.work?.[key.slice(3).toLowerCase()];
            return engine.receipt.limits?.[key] !== limit || !Number.isSafeInteger(used) || used < 0 || used > limit;
        }) || engine.samples?.length !== 200 || engine.samples.some((row, i) =>
            row.timeNs !== TRANSISTOR_TIMES_NS[i] || !Number.isFinite(row.voltage) || !Number.isFinite(row.current)) ||
        engine.mean?.startNs !== 100 || engine.mean?.endNs !== 20000 ||
        !Number.isFinite(engine.mean.voltage) || !Number.isFinite(engine.mean.current)) {
        throw new Error('Completed matched-card exact-grid transistor capture required');
    }
    if (reference.arms?.length !== 2) throw new Error('Exactly two transistor reference arms required');
    const refinement = transistorRefinement(...reference.arms);
    if (!refinement.stable) throw new Error('Transistor reference refinement failed');
    const compare = (actual, expected, key) => ({engine: actual, reference: expected,
        absoluteError: Math.abs(actual - expected), bound: TRANSISTOR_BOUNDS.agreement[key],
        passed: Math.abs(actual - expected) <= TRANSISTOR_BOUNDS.agreement[key]});
    const fine = reference.arms[1];
    const comparisons = engine.samples.map((row, i) => ({timeNs: row.timeNs,
        voltage: compare(row.voltage, fine.measurements[i].voltage, 'voltage'),
        current: compare(row.current, -fine.measurements[i].current, 'current')}));
    const means = {voltage: compare(engine.mean.voltage, fine.mean.voltage, 'voltage'),
        current: compare(engine.mean.current, -fine.mean.current, 'current')};
    return {agreement: [...comparisons, means].every(row => row.voltage.passed && row.current.passed),
        refinement, comparisons, means};
}

export function transistorCaseReport (id, reference, engine) {
    const report = {schema: 'transistor-instrument-case-v1', definition: transistorCase(id),
        agreement: false, reference, engine};
    try {
        if (reference?.caseId !== id) throw new Error('Reference identity differs from requested transistor case');
        if (!transistorRefinement(...reference.arms).stable) return {...report, failure: 'reference-refinement'};
        if (engine?.error) return {...report, failure: 'engine-capture', error: engine.error};
        return {...report, ...compareTransistorCapture(engine, reference)};
    } catch (error) { return {...report, failure: 'capture-authority', error: error.message}; }
}

function runReference (id, maxStepNs, executable) {
    const deck = transistorDeck(id, maxStepNs), directory = mkdtempSync(join(tmpdir(), 'transistor-reference-'));
    try {
        const child = spawnSync(executable, ['-n', '-b'], {cwd: directory, input: deck, encoding: 'utf8',
            timeout: 120000, maxBuffer: 1048576, env: {...process.env, NGSPICE_MEAS_PRECISION: '15'}});
        if (child.error || child.status !== 0) throw new Error(`Transistor reference process refused: ${child.error || child.stderr}`);
        const table = readFileSync(join(directory, 'reference.dat'), 'utf8');
        const rows = parseReferenceWaveform(table, child.stdout, child.stderr);
        return {maxStepNs, deck, deckSha256: createHash('sha256').update(deck).digest('hex'),
            waveformSha256: createHash('sha256').update(table).digest('hex'), waveformRows: rows.length,
            measurements: sampleReferenceWaveform(rows, TRANSISTOR_TIMES_NS), mean: referenceIntervalMean(rows, 100, 20000)};
    } finally { rmSync(directory, {recursive: true, force: true}); }
}

async function captureEngine (id) {
    const row = transistorCase(id);
    const {BoardImpl} = await import('../src/board.js');
    const board = new BoardImpl(5); board.configureTransientAnalysis('precision-v1');
    board.setNetlist([
        {id: 'VCC', kind: 'vsource', params: {volts: 5}, terminals: ['pos', 'neg']},
        {id: 'P', kind: 'vsource', params: {wave: 'spice-pulse', v1: 0, v2: 1.5,
            td: 1e-6, tr: 2e-6, tf: 2e-6, pw: 8e-6, per: 20e-6}, terminals: ['pos', 'neg']},
        {id: 'G', kind: 'gnd', params: {}, terminals: ['gnd']},
        {id: 'RB', kind: 'resistor', params: {ohms: row.rb}, terminals: ['a', 'b']},
        {id: 'RC', kind: 'resistor', params: {ohms: row.rc}, terminals: ['a', 'b']},
        {id: 'Q', kind: 'npn', params: {...TRANSISTOR_CARD}, terminals: ['base', 'collector', 'emitter']},
        {id: 'C', kind: 'capacitor', params: {farads: row.c}, terminals: ['a', 'b']}
    ], [net('zero', ['G', 'gnd'], ['VCC', 'neg'], ['P', 'neg'], ['Q', 'emitter'], ['C', 'b']),
        net('supply', ['VCC', 'pos'], ['RC', 'a']), net('input', ['P', 'pos'], ['RB', 'a']),
        net('base', ['RB', 'b'], ['Q', 'base']), net('collector', ['RC', 'b'], ['Q', 'collector'], ['C', 'a'])]);
    board.setPower(true); board.reset();
    const voltage = board.addScopeChannel({type: 'voltage', netId: 'collector', referenceNetId: 'zero',
        capture: 'sample', sampleRateHz: 1e7, depth: 202});
    const current = board.addScopeChannel({type: 'current', partId: 'RC', terminal: 'a',
        currentClock: 'simulation', sampleRateHz: 1e7, depth: 202});
    const result = {caseId: id, card: {...TRANSISTOR_CARD}, initialCapacitorVoltage: board.capVoltages.get('C')};
    try {
        result.receipt = board.advanceToBoundedStream(20000n, TRANSISTOR_LIMITS, {stepNs: 100n, onStep: ({timeNs}) => {
            if (timeNs === 100n) {board.meterVoltage('collector', 'zero'); board.meterCurrent('RC', 'a');}
        }});
        const v = board.getScopeData(voltage), c = board.getScopeData(current);
        if ([v, c].some(data => data.count !== 200 || data.startTNs !== 100n || data.sampleIntervalNs !== 100n ||
            data.capture !== 'sample' || data.writeIndex !== 200) || c.currentClock !== 'simulation') {
            throw new Error('Transistor instrument metadata/grid refused');
        }
        result.samples = TRANSISTOR_TIMES_NS.map((timeNs, i) => {
            if (v.samples[2 * i] !== v.samples[2 * i + 1] || c.samples[2 * i] !== c.samples[2 * i + 1]) {
                throw new Error('Transistor instrument sample pairs refused');
            }
            return {timeNs, voltage: v.samples[2 * i], current: c.samples[2 * i]};
        });
        result.mean = {startNs: 100, endNs: 20000, voltage: board.meterVoltage('collector', 'zero'),
            current: board.meterCurrent('RC', 'a')};
    } catch (error) { result.error = error.message; }
    result.receipt ||= board.transientAnalysisStatus().boundedAdvance;
    result.status = board.transientAnalysisStatus(); return result;
}

export async function runTransistorCase (id, executable = process.env.NGSPICE || 'ngspice') {
    const definition = transistorCase(id), reference = {caseId: id, arms: []};
    const report = {schema: 'transistor-instrument-case-v1', definition, agreement: false, reference, engine: null};
    try {
        const version = spawnSync(executable, ['--version'], {encoding: 'utf8', timeout: 5000});
        if (version.error || version.status !== 0) throw new Error('Independent SPICE executable unavailable');
        reference.version = version.stdout + version.stderr;
        for (const step of [.5, .25]) reference.arms.push(runReference(id, step, executable));
    } catch (error) { return {...report, failure: 'reference-process', error: error.message}; }
    try {
        if (!transistorRefinement(...reference.arms).stable) return {...report, failure: 'reference-refinement'};
    } catch (error) { return {...report, failure: 'reference-authority', error: error.message}; }
    try { report.engine = await captureEngine(id); }
    catch (error) { return {...report, failure: 'engine-capture', error: error.message}; }
    return transistorCaseReport(id, reference, report.engine);
}

export function parseTransistorArguments (args) {
    if (!args.length) return TRANSISTOR_CASES.map(row => row.id);
    if (args.length !== 2 || args[0] !== '--case') throw new Error('Usage: qualify-transistor-instruments.mjs [--case reviewed-id]');
    return [transistorCase(args[1]).id];
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    let passed = true;
    for (const id of parseTransistorArguments(process.argv.slice(2))) {
        const report = await runTransistorCase(id);
        console.log(JSON.stringify(report, (_key, value) => typeof value === 'bigint' ? String(value) : value));
        passed &&= report.agreement === true;
    }
    process.exitCode = passed ? 0 : 1;
}
