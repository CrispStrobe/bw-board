// SPDX-License-Identifier: MIT
import {pathToFileURL} from 'node:url';
import {BoardImpl} from '../src/board.js';

export const WINDING_LIMITS = Object.freeze({maxAttempts: 20000, maxSolves: 60001, maxAdvances: 200});
export const WINDING_CASES = Object.freeze(['zero-storage', 'time-zero-op', 'dc-turnoff']);
const profiles = ['precision-v1', 'interactive-v2'];
const net = (id, ...pins) => ({id, terminals: pins.map(([part, terminal]) => ({part, terminal}))});

export function validateWindingOptions ({scenario = 'zero-storage', profile = 'precision-v1'} = {}) {
    if (!WINDING_CASES.includes(scenario)) throw new Error(`Unknown winding case: ${scenario}`);
    if (!profiles.includes(profile)) throw new Error(`Unknown diagnostic profile: ${profile}`);
    return {scenario, profile};
}

export function createWindingDiagnosticBoard (options = {}) {
    const {scenario, profile} = validateWindingOptions(options);
    const dc = scenario === 'dc-turnoff';
    const board = new BoardImpl(5);
    board.configureTransientAnalysis(profile);
    board.setNetlist([
        {id: 'V', kind: 'vsource', params: {volts: 5}, terminals: ['pos', 'neg']},
        {id: 'G', kind: 'gnd', params: {}, terminals: ['gnd']},
        {id: 'P', kind: 'vsource', params: {wave: 'spice-pulse',
            v1: dc ? 5 : 0, v2: dc ? 0 : 5, td: dc ? 1e-6 : 0,
            tr: 1e-6, tf: 1e-6, pw: .001, per: .003}, terminals: ['pos', 'neg']},
        {id: 'RB', kind: 'resistor', params: {ohms: 22700}, terminals: ['a', 'b']},
        {id: 'Q', kind: 'npn', params: {model: 'shockley', is: 1e-14, beta: 100,
            br: 1, vaf: 100}, terminals: ['base', 'collector', 'emitter']},
        {id: 'L', kind: 'inductor', params: {henrys: .005}, terminals: ['a', 'b']},
        {id: 'R', kind: 'resistor', params: {ohms: 10}, terminals: ['a', 'b']},
        // No redundant vf: IS/n/RS own this authored Shockley model and its DC admission.
        {id: 'D', kind: 'diode', params: {model: 'shockley', is: 1e-12, n: 1, rs: .568},
            terminals: ['anode', 'cathode']},
        {id: 'CP', kind: 'capacitor', params: {farads: 12e-12}, terminals: ['a', 'b']},
        {id: 'RP', kind: 'resistor', params: {ohms: 1e7}, terminals: ['a', 'b']}
    ], [
        net('supply', ['V', 'pos'], ['L', 'a'], ['D', 'cathode']),
        net('zero', ['V', 'neg'], ['P', 'neg'], ['G', 'gnd'], ['Q', 'emitter'], ['CP', 'b'], ['RP', 'b']),
        net('drive', ['P', 'pos'], ['RB', 'a']), net('base', ['RB', 'b'], ['Q', 'base']),
        net('winding', ['L', 'b'], ['R', 'a']),
        net('collector', ['R', 'b'], ['Q', 'collector'], ['D', 'anode'], ['CP', 'a'], ['RP', 'a'])
    ]);
    board.setPower(true);
    board.reset();
    return board;
}

export function captureWindingDiagnostic (options = {}) {
    const {scenario, profile} = validateWindingOptions(options);
    const board = createWindingDiagnosticBoard({scenario, profile});
    const dc = scenario === 'dc-turnoff';
    const endNs = dc ? 20000n : 1010000n;
    const stepNs = dc ? 100n : 20000n;
    const rows = [];
    let initialization = null, initialStorage = null, receipt = null, error = null;
    let phase = 'initialization';
    try {
        if (scenario !== 'zero-storage') initialization = board.initializeTransientFromOperatingPoint();
        // Fresh Board storage defaults are zero; an OP must expose its solved storage instead.
        initialStorage = {capacitorVoltage: board.capVoltages.get('CP') ?? 0,
            inductorCurrent: board.inductorCurrents.get('L') ?? 0};
        phase = 'capture';
        receipt = board.advanceToBoundedStream(endNs, WINDING_LIMITS, {stepNs, onStep: row => {
            rows.push({timeNs: String(row.timeNs), qualified: row.qualified,
                collectorVoltage: board.nodeVoltage('collector'),
                inductorCurrent: board.inductorCurrents.get('L'), work: row.work});
        }});
    } catch (failure) {
        error = {phase, message: failure.message};
    }
    const status = board.transientAnalysisStatus();
    receipt ||= status.boundedAdvance ?? null;
    const completed = error === null && receipt?.completed === true && status.accuracyMet === true;
    return {schema: 'winding-transient-diagnostic-v1', scenario, profile,
        initializationMode: scenario === 'zero-storage' ? 'zero-storage' : 'public-time-zero-operating-point',
        requestedTimeNs: String(endNs), stepNs: String(stepNs), limits: {...WINDING_LIMITS},
        initialStorage, initialization, completed, oracleAgreement: 'not-tested',
        receipt, error, status, rows};
}

export const diagnosticExitCode = report => report.completed === true ? 0 : 1;
export const diagnosticJson = report => JSON.stringify(report, (_key, value) =>
    typeof value === 'bigint' ? String(value) : value instanceof Map ? Object.fromEntries(value) : value, 2);

export function parseWindingArguments (args) {
    const options = {};
    for (let i = 0; i < args.length; i++) {
        if (!['--case', '--profile'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) {
            throw new Error('Usage: node scripts/diagnose-winding-transient.mjs [--case zero-storage|time-zero-op|dc-turnoff] [--profile precision-v1|interactive-v2]');
        }
        const key = args[i] === '--case' ? 'scenario' : 'profile';
        if (Object.hasOwn(options, key)) throw new Error(`Duplicate diagnostic option: ${args[i]}`);
        options[key] = args[++i];
    }
    return validateWindingOptions(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const report = captureWindingDiagnostic(parseWindingArguments(process.argv.slice(2)));
    console.log(diagnosticJson(report));
    process.exitCode = diagnosticExitCode(report);
}
