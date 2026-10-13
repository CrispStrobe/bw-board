// SPDX-License-Identifier: MIT
import {pathToFileURL} from 'node:url';

export const STEP_CASES = Object.freeze([1, -1].flatMap(sign => [0, 33, 67].map(phaseNs =>
    Object.freeze({id: `lm741-${sign > 0 ? 'pos' : 'neg'}-${phaseNs}`, amplitude: sign * .01, phaseNs}))));
export const REFERENCE_CARD = Object.freeze({a0: 200000, gbwHz: 1e6, rOut: 600, inputR: 2e6, loadR: 10000});
export const TIMES_NS = Object.freeze(Array.from({length: 200}, (_, i) => (i + 1) * 100));
export const LIMITS = Object.freeze({maxAttempts: 20000, maxSolves: 60001, maxAdvances: 200});
export const BOUNDS = Object.freeze({voltage: 1e-4, current: 1e-8});
export function stepCase (id) {
    const row = STEP_CASES.find(item => item.id === id);
    if (!row) throw new Error(`Unknown reviewed LM741 case: ${id}`);
    return row;
}

// Independent continuous linear amplifier: A(s)=A0/(1+s/wp), wp=2*pi*GBW/A0.
// KCL at the loaded output: y=k*u+d*Vin, where u is the internal amplifier
// source; follower feedback gives H(s)=(k*A(s)+d)/(1+k*A(s)).
// These coefficients depend on the circuit/card only, never inferred beta,
// model wake times or measured output. A one-nanosecond input ramp is integrated
// analytically, rather than pretending it is an instantaneous step.
export function referenceCoefficients () {
    const {a0, gbwHz, rOut, inputR, loadR} = REFERENCE_CARD;
    const total = 1 / rOut + 1 / inputR + 1 / loadR;
    const k = 1 / rOut / total, d = 1 / inputR / total;
    return {d, gain: (k * a0 + d) / (1 + k * a0), omega: 2 * Math.PI * gbwHz * (k + 1 / a0) * 1e-9};
}
function stepArea (t) {
    if (t <= 0) return 0;
    const {d, gain, omega} = referenceCoefficients();
    return gain * t + (d - gain) * -Math.expm1(-omega * t) / omega;
}
function stepAreaPrimitive (t) {
    if (t <= 0) return 0;
    const {d, gain, omega} = referenceCoefficients();
    return gain * t * t / 2 + (d - gain) * (t / omega + Math.expm1(-omega * t) / (omega * omega));
}
export function referenceVoltage (id, timeNs) {
    const row = stepCase(id), t = timeNs - 10000 - row.phaseNs;
    if (!Number.isFinite(timeNs)) throw new Error('Finite reference time required');
    return row.amplitude * (stepArea(t) - stepArea(t - 1));
}
export function referenceMean (id) {
    const row = stepCase(id), start = 100 - 10000 - row.phaseNs, end = 20000 - 10000 - row.phaseNs;
    const primitive = t => row.amplitude * (stepAreaPrimitive(t) - stepAreaPrimitive(t - 1));
    const voltage = (primitive(end) - primitive(start)) / 19900;
    return {startNs: 100, endNs: 20000, voltage, current: -voltage / REFERENCE_CARD.loadR};
}
export function compareStepCapture (id, engine) {
    stepCase(id);
    if (engine?.caseId !== id || engine.status?.accuracyMet !== true || engine.status.failure !== null ||
        engine.status.profile?.id !== 'precision-v1' || engine.receipt?.completed !== true ||
        engine.receipt.failure !== null || engine.receipt.requestedTimeNs !== '20000' ||
        Object.entries(LIMITS).some(([key, limit]) => {
            const used = engine.receipt.work?.[key.slice(3).toLowerCase()];
            return engine.receipt.limits?.[key] !== limit || !Number.isSafeInteger(used) || used < 0 || used > limit;
        }) || engine.samples?.length !== 200 || TIMES_NS.some((timeNs, i) =>
            engine.samples[i]?.timeNs !== timeNs || !Number.isFinite(engine.samples[i]?.voltage) ||
            !Number.isFinite(engine.samples[i]?.current)) ||
        engine.mean?.startNs !== 100 || engine.mean?.endNs !== 20000 ||
        !Number.isFinite(engine.mean.voltage) || !Number.isFinite(engine.mean.current)) {
        throw new Error('Complete whole-window phase capture required');
    }
    const compare = (actual, expected, key) => ({engine: actual, reference: expected,
        absoluteError: Math.abs(actual - expected), bound: BOUNDS[key], passed: Math.abs(actual - expected) <= BOUNDS[key]});
    const comparisons = engine.samples.map(row => {
        const voltage = referenceVoltage(id, row.timeNs);
        return {timeNs: row.timeNs, voltage: compare(row.voltage, voltage, 'voltage'),
            current: compare(row.current, -voltage / REFERENCE_CARD.loadR, 'current')};
    });
    const ref = referenceMean(id), means = {voltage: compare(engine.mean.voltage, ref.voltage, 'voltage'),
        current: compare(engine.mean.current, ref.current, 'current')};
    return {agreement: [...comparisons, means].every(row => row.voltage.passed && row.current.passed), comparisons, means};
}

async function capture (id) {
    const row = stepCase(id);
    const [{BoardImpl}, {registerAnalogAmps}] = await Promise.all([
        import('../src/board.js'), import('../src/devices/analog-amps.js')]);
    registerAnalogAmps();
    const board = new BoardImpl(5); board.configureTransientAnalysis('precision-v1');
    const net = (name, ...pins) => ({id: name, terminals: pins.map(([part, terminal]) => ({part, terminal}))});
    board.setNetlist([
        {id: 'VP', kind: 'vsource', params: {volts: 15}, terminals: ['pos', 'neg']},
        {id: 'VN', kind: 'vsource', params: {volts: 15}, terminals: ['pos', 'neg']},
        {id: 'VIN', kind: 'vsource', params: {wave: 'spice-pulse', v1: 0, v2: row.amplitude,
            td: (10000 + row.phaseNs) * 1e-9, tr: 1e-9, tf: 1e-9, pw: 20e-6, per: 100e-6}, terminals: ['pos', 'neg']},
        {id: 'G', kind: 'gnd', params: {}, terminals: ['gnd']},
        {id: 'U', kind: 'lm741', params: {inputOffsetV: 0},
            terminals: ['offset_1', 'inn', 'inp', 'vneg', 'offset_5', 'out', 'vpos', 'nc']},
        {id: 'RL', kind: 'resistor', params: {ohms: 10000}, terminals: ['a', 'b']}
    ], [net('zero', ['VP', 'neg'], ['VN', 'pos'], ['VIN', 'neg'], ['G', 'gnd'], ['RL', 'b']),
        net('positive', ['VP', 'pos'], ['U', 'vpos']), net('negative', ['VN', 'neg'], ['U', 'vneg']),
        net('input', ['VIN', 'pos'], ['U', 'inp']), net('out', ['U', 'out'], ['U', 'inn'], ['RL', 'a'])]);
    board.setPower(true); board.reset();
    const vId = board.addScopeChannel({type: 'voltage', netId: 'out', referenceNetId: 'zero',
        capture: 'sample', sampleRateHz: 1e7, depth: 202});
    const iId = board.addScopeChannel({type: 'current', partId: 'RL', terminal: 'a',
        currentClock: 'simulation', sampleRateHz: 1e7, depth: 202});
    const result = {caseId: id};
    try {
        result.receipt = board.advanceToBoundedStream(20000n, LIMITS, {stepNs: 100n, onStep: ({timeNs}) => {
            if (timeNs === 100n) {board.meterVoltage('out', 'zero'); board.meterCurrent('RL', 'a');}
        }});
        const v = board.getScopeData(vId), c = board.getScopeData(iId);
        if ([v, c].some(data => data.count !== 200 || data.writeIndex !== 200 || data.startTNs !== 100n ||
            data.sampleIntervalNs !== 100n || data.capture !== 'sample') || c.currentClock !== 'simulation') {
            throw new Error('LM741 instrument metadata refused');
        }
        result.samples = TIMES_NS.map((timeNs, i) => {
            if (v.samples[2*i] !== v.samples[2*i+1] || c.samples[2*i] !== c.samples[2*i+1]) {
                throw new Error('LM741 sample pairs refused');
            }
            return {timeNs, voltage: v.samples[2*i], current: c.samples[2*i]};
        });
        result.mean = {startNs: 100, endNs: 20000, voltage: board.meterVoltage('out', 'zero'),
            current: board.meterCurrent('RL', 'a')};
    } catch (error) { result.error = error.message; }
    result.status = board.transientAnalysisStatus(); result.receipt ||= result.status.boundedAdvance;
    const state = board.getDeviceState('U');
    result.modelState = {powered: state.powered, inputCommonMode: state.inputCommonMode,
        updateTickNs: String(state._spec.tickNs)};
    return result;
}
export async function runStepCase (id) {
    const report = {schema: 'lm741-step-phase-v1', definition: stepCase(id), referenceCard: REFERENCE_CARD,
        agreement: false, engine: null};
    try {
        report.engine = await capture(id);
        if (report.engine.error) return {...report, failure: 'engine-capture', error: report.engine.error};
        return {...report, ...compareStepCapture(id, report.engine)};
    } catch (error) { return {...report, failure: 'capture-authority', error: error.message}; }
}
export function parseArguments (args) {
    if (!args.length) return STEP_CASES.map(row => row.id);
    if (args.length !== 2 || args[0] !== '--case') throw new Error('Usage: qualify-lm741-step-phase.mjs [--case reviewed-id]');
    return [stepCase(args[1]).id];
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    let passed = true;
    for (const id of parseArguments(process.argv.slice(2))) {
        const report = await runStepCase(id);
        console.log(JSON.stringify(report, (_key, value) => typeof value === 'bigint' ? String(value) : value));
        passed &&= report.agreement;
    }
    process.exitCode = passed ? 0 : 1;
}
