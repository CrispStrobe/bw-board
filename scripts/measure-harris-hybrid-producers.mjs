/** Cooperative producer attribution for the default-off Harris memory-only hybrid. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {arch, cpus, hostname, loadavg, platform} from 'node:os';
import {dirname, join} from 'node:path';
import {PerformanceObserver, performance} from 'node:perf_hooks';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {HarrisBootCPU} from '../src/experimental/harris-80c286-boot-cpu.js';
import {createHarrisStoreLoopROM} from '../src/experimental/harris-boot-rom.js';
import {createHarrisNativeMemoryBoard} from '../src/experimental/harris-native-memory-board.js';
import {runHarrisTransactions} from '../src/experimental/harris-run-transactions.js';

const options = {};
for (const arg of process.argv.slice(2)) {
    const match = /^--(experimental|iterations=([0-9]+)|rounds=([0-9]+)|batch-periods=([0-9]+)|wall-budget-ms=([0-9]+(?:\.[0-9]+)?))$/.exec(arg);
    if (!match) throw new Error(`unknown measurement option: ${arg}`);
    const [key, value] = arg.slice(2).split('=');
    if (Object.hasOwn(options, key)) throw new Error(`duplicate option: --${key}`);
    options[key] = value ?? true;
}
if (options.experimental !== true || !process.env.HARRIS_NET_WASM)
    throw new Error('usage: HARRIS_NET_WASM=owned.wasm node --expose-gc scripts/measure-harris-hybrid-producers.mjs --experimental [--iterations=N] [--rounds=N] [--batch-periods=N] [--wall-budget-ms=N]');
const integer = (name, fallback, maximum) => {
    const value = options[name] === undefined ? fallback : Number(options[name]);
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError(`${name} 1..${maximum}`);
    return value;
};
const iterations = integer('iterations', 2048, 65535);
const rounds = integer('rounds', 3, 10);
const batchPeriods = integer('batch-periods', 256, 8192);
const wallBudgetMS = options['wall-budget-ms'] === undefined ? 8 : Number(options['wall-budget-ms']);
if (!Number.isFinite(wallBudgetMS) || wallBudgetMS <= 0 || wallBudgetMS > 1000) throw new RangeError('wall-budget-ms 0..1000');

const wasmBytes = readFileSync(process.env.HARRIS_NET_WASM);
const hash = value => createHash('sha256').update(value).digest('hex');
const build = JSON.parse(readFileSync(join(dirname(process.env.HARRIS_NET_WASM), 'wired-net-kernel-build.json')));
assert.equal(build.wasmSHA256, hash(wasmBytes), 'module must match build receipt');
const sourcePaths = ['scripts/measure-harris-hybrid-producers.mjs',
    'src/experimental/harris-run-transactions.js', 'src/experimental/harris-native-memory-board.js',
    'src/experimental/wired-kernel/bus-circuit-image.js', 'src/experimental/harris-80c286-boot-cpu.js',
    'src/experimental/harris-80c286-memory-board.js', 'src/experimental/harris-boot-rom.js'];
const sourceHashes = Object.fromEntries(sourcePaths.map(path => [path, hash(readFileSync(new URL(`../${path}`, import.meta.url)))]));
for (const [path, expected] of Object.entries(build.sourceHashes)) {
    assert.match(path, /^src\/experimental\/wired-kernel\/[a-z-]+\.c$/);
    const actual = hash(readFileSync(new URL(`../${path}`, import.meta.url)));
    assert.equal(actual, expected, `rebuild for changed source: ${path}`);
    sourceHashes[path] = actual;
}
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
assert.equal(execFileSync('git', ['status', '--porcelain'], {encoding: 'utf8'}), '', 'measurement requires a clean source tree');
registerBusMemory();

const stateOf = (cpu, board) => {
    const bus = board.inspectBus();
    const stateHash = hash(JSON.stringify({cpu: cpu.inspect(), bus,
        memory: ['rom0', 'rom1', 'ram0', 'ram1'].map(id => {
            const memory = board.inspectMemory(id);
            return {id, bytes: [...memory.bytes], writes: memory.writes};
        })}));
    return {stateHash, physicalClock: bus.clock, status: cpu.status, retired: cpu.retired,
        writes: [board.inspectMemory('ram0').writes, board.inspectMemory('ram1').writes]};
};

async function sample(instrumented) {
    const constructionStart = performance.now();
    const raw = await createHarrisNativeMemoryBoard({enabled: true, rom: createHarrisStoreLoopROM(iterations),
        romLowAlias: true, wasmBytes, admittedGraph: true, incrementalGraph: true});
    const constructionMS = performance.now() - constructionStart;
    const timings = {cpuRunMS: 0, nativeAndReceiptMS: 0, pumpMS: 0, submitMS: 0,
        cpuCalls: 0, nativeCalls: 0, pumpCalls: 0, submitCalls: 0, inspectBusCalls: 0, physicalCompletions: 0,
        returnedPeriods: 0, requestedPeriods: 0};
    const completionHash = createHash('sha256');
    let lastCompletion = null;
    const board = {...raw};
    const timed = (timeName, countName, fn, after) => function (...args) {
        const start = performance.now();
        try { const value = fn(...args); after?.(value, args); return value; }
        finally { timings[timeName] += performance.now() - start; timings[countName]++; }
    };
    if (instrumented) {
        board.submit = timed('submitMS', 'submitCalls', raw.submit);
        board.inspectBus = (...args) => { timings.inspectBusCalls++; return raw.inspectBus(...args); };
        board.runUntilCompletion = timed('nativeAndReceiptMS', 'nativeCalls', raw.runUntilCompletion,
            (value, args) => {
                timings.physicalCompletions += value.completions.length;
                timings.returnedPeriods += value.periods;
                timings.requestedPeriods += args[0].maxPeriods;
                completionHash.update(JSON.stringify(value.completions));
                if (value.completions.length) lastCompletion = value.completions.at(-1);
            });
    }
    const cpu = new HarrisBootCPU({enabled: true, board});
    if (instrumented) {
        const pump = cpu._pump.bind(cpu);
        cpu._pump = timed('pumpMS', 'pumpCalls', pump);
    }
    const initializationStart = performance.now();
    cpu.initialize();
    const initializationMS = performance.now() - initializationStart;
    for (const key of Object.keys(timings)) timings[key] = 0;
    raw.resetWorkCounters();
    raw.resetProducerCounters();
    global.gc?.();
    const gc = [];
    const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) gc.push({kind: entry.detail?.kind ?? entry.kind, durationMS: entry.duration});
    });
    observer.observe({entryTypes: ['gc']});
    const heapBefore = process.memoryUsage().heapUsed;
    if (instrumented) {
        const run = cpu.runTransactions.bind(cpu);
        cpu.runTransactions = timed('cpuRunMS', 'cpuCalls', run);
    }
    let yields = 0, yieldWaitMS = 0;
    const wallStart = performance.now();
    const result = await runHarrisTransactions({cpu, maxPeriods: iterations * 32 + 100,
        batchPeriods, wallBudgetMS, yieldTask: () => new Promise(resolve => {
            const start = performance.now();
            setTimeout(() => { yieldWaitMS += performance.now() - start; yields++; resolve(); }, 0);
        })});
    const wallMS = performance.now() - wallStart;
    const heapAfter = process.memoryUsage().heapUsed;
    await new Promise(resolve => setImmediate(resolve));
    observer.disconnect();
    assert.equal(result.status, 'halted');
    assert.equal(cpu.retired, iterations * 3 + 4);
    const state = stateOf(cpu, raw);
    assert.deepEqual(state.writes, [iterations, iterations]);
    assert.equal(state.physicalClock, result.periods + 67, 'successful run must account for every post-initialization physical period');
    assert.equal(yields, result.chunks - 1, 'a halted cooperative run yields between chunks only');
    const work = raw.inspectWorkCounters();
    const producerWork = raw.inspectProducerCounters();
    const producerValues = Object.values(producerWork.producers);
    assert.equal(producerValues.reduce((sum, value) => sum + value.attempts, 0) >>> 0,
        work.driverComparisons, 'producer attempts reconcile with aggregate comparisons');
    assert.equal(producerValues.reduce((sum, value) => sum + value.changes, 0) >>> 0,
        work.valueChangingDriverWrites, 'producer changes reconcile with aggregate changing writes');
    const common = {mode: instrumented ? 'instrumented' : 'control', constructionMS, initializationMS,
        result, wallMS, yields, yieldWaitMS, wallOutsideActiveAndYieldMS: wallMS - result.activeMS - yieldWaitMS,
        activePeriodsPerSecond: result.periods * 1000 / result.activeMS,
        wallPeriodsPerSecond: result.periods * 1000 / wallMS, heapDeltaBytes: heapAfter - heapBefore,
        gc: {events: gc.length, durationMS: gc.reduce((sum, entry) => sum + entry.durationMS, 0), entries: gc},
        work, producerWork, ...state};
    if (!instrumented) return common;
    assert.equal(timings.returnedPeriods, result.periods, 'native returned periods reconcile with cooperative progress');
    assert.equal(timings.nativeCalls, timings.submitCalls + 1, 'one initialized pending transaction precedes measured submits');
    const producers = {
        instructionPumpMS: timings.pumpMS - timings.submitMS,
        busSubmitMS: timings.submitMS,
        nativeAndReceiptMS: timings.nativeAndReceiptMS,
        cpuReceiptControlMS: timings.cpuRunMS - timings.nativeAndReceiptMS - timings.pumpMS,
        cooperativeControlMS: result.activeMS - timings.cpuRunMS
    };
    const categorizedActiveMS = Object.values(producers).reduce((sum, value) => sum + value, 0);
    assert.ok(Math.abs(categorizedActiveMS - result.activeMS) < 1e-6, 'exclusive producer accounting');
    for (const [name, value] of Object.entries({...timings, ...producers, categorizedActiveMS}))
        assert.ok(Number.isFinite(value) && value >= 0, `${name} must be finite and nonnegative`);
    return {...common, timings, completionSHA256: completionHash.digest('hex'), lastCompletion,
        producers, categorizedActiveMS};
}

const samples = [];
let expected = null;
for (let round = 0; round <= rounds; round++) {
    for (const instrumented of round % 2 ? [true, false] : [false, true]) {
        const value = await sample(instrumented);
        const identity = {stateHash: value.stateHash, periods: value.result.periods, retired: value.retired,
            physicalClock: value.physicalClock, writes: value.writes, work: value.work, producerWork: value.producerWork};
        expected ??= identity;
        assert.deepEqual(identity, expected, `${value.mode} round ${round} identity`);
        if (round) samples.push({round, ...value});
    }
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const modes = Object.fromEntries(['control', 'instrumented'].map(mode => {
    const selected = samples.filter(sample => sample.mode === mode);
    return [mode, {medianActivePeriodsPerSecond: median(selected.map(sample => sample.activePeriodsPerSecond)),
        medianWallPeriodsPerSecond: median(selected.map(sample => sample.wallPeriodsPerSecond))}];
}));
const instrumentationActiveThroughputRatio = modes.instrumented.medianActivePeriodsPerSecond /
    modes.control.medianActivePeriodsPerSecond;
assert.ok(Number.isFinite(instrumentationActiveThroughputRatio) && instrumentationActiveThroughputRatio > 0);
console.log(JSON.stringify({schemaVersion: 1, workload: 'owned-harris-store-loop-memory-only-cooperative',
    revision, clean: true, options: {iterations, rounds, batchPeriods, wallBudgetMS},
    host: {hostname: hostname(), platform: platform(), arch: arch(), cpu: cpus()[0]?.model,
        node: process.version, loadavg: loadavg(), exposedGC: typeof global.gc === 'function'},
    wasmSHA256: hash(wasmBytes), sourceHashes, warmupRounds: 1, measuredRounds: rounds,
    expected, modes, instrumentationActiveThroughputRatio, samples,
    limitations: ['Timer wrappers perturb wall-budget cutoffs; compare the paired control before using instrumented timings.',
        'nativeAndReceiptMS combines native execution with JavaScript completion/result materialization; CPU and heap profiles must resolve that split.',
        'GC duration and heap delta are non-additive diagnostics, not exclusive producer time.',
        'One pending fetch is submitted during initialization, so its measured native completion has no measured submit/pump counterpart.',
        'The counted yield uses the production setTimeout(0) primitive; yieldWaitMS remains scheduler and host dependent.',
        'Native work counters wrap modulo 2^32 and driverComparisons excludes the JavaScript bulk-image scan.',
        'Initialization consumes 67 physical periods outside both the measured period numerator and timers.',
        'Memory-only owned workload; not DOS, peripherals, full-native CPU or browser capacity.',
        'Shared-host measurements are selection evidence, not a stable performance guarantee.']}, null, 2));
