/** Same-runner A/B measurement of native producer-counter overhead. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync, realpathSync} from 'node:fs';
import {arch, cpus, hostname, loadavg, platform} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';

export const BASE_REVISION = 'a26853ad946edb05e4d3192298207c25437129fa';
export const COUNTER_REVISION = '9b35e08d25a972dcf51b214a054195a7430a3c0e';
export const LEGACY_WORK_COUNTERS = Object.freeze([
    'driverComparisons', 'valueChangingDriverWrites', 'dirtyNetResolutions', 'netDriverVisits',
    'evaluatorRows', 'dependencyProbes', 'stagedDriverCopies', 'committedEvaluatorOutputs',
    'publishNetCopies', 'deltas', 'reverseIndexVisits', 'operationBitsetWordVisits'
]);

const hash = value => createHash('sha256').update(value).digest('hex');
const median = values => {
    const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const quantile = (values, q) => {
    const sorted = [...values].sort((a, b) => a - b), position = (sorted.length - 1) * q;
    const low = Math.floor(position), fraction = position - low;
    return sorted[low] + (sorted[Math.min(low + 1, sorted.length - 1)] - sorted[low]) * fraction;
};

export function summarize(values) {
    assert.ok(Array.isArray(values) && values.length > 0, 'nonempty samples required');
    for (const value of values) assert.ok(Number.isFinite(value) && value > 0, 'positive finite sample required');
    const center = median(values), deviations = values.map(value => Math.abs(value - center));
    return Object.freeze({samples: values.length, median: center, mad: median(deviations),
        q1: quantile(values, 0.25), q3: quantile(values, 0.75), min: Math.min(...values), max: Math.max(...values)});
}

export function interleavedOrder(warmupRounds, measuredRounds) {
    for (const [name, value] of Object.entries({warmupRounds, measuredRounds}))
        assert.ok(Number.isSafeInteger(value) && value > 0, `${name} must be positive`);
    return Array.from({length: warmupRounds + measuredRounds}, (_, index) => ({
        phase: index < warmupRounds ? 'warmup' : 'measured',
        round: index < warmupRounds ? index + 1 : index - warmupRounds + 1,
        order: index % 2 ? ['counter', 'base'] : ['base', 'counter']
    }));
}

export function assertSameSemanticReceipt(actual, expected, label = 'sample') {
    assert.deepEqual(actual, expected, `${label}: state, progress, writes and all legacy counters must match`);
}

const options = {};
function parseOptions(args) {
    for (const arg of args) {
        const match = /^--(experimental|base-dir=(.+)|counter-dir=(.+)|base-wasm=(.+)|counter-wasm=(.+)|iterations=([0-9]+)|warmup-rounds=([0-9]+)|rounds=([0-9]+)|batch-periods=([0-9]+)|wall-budget-ms=([0-9]+(?:\.[0-9]+)?))$/.exec(arg);
        if (!match) throw new Error(`unknown measurement option: ${arg}`);
        const [key, value] = arg.slice(2).split(/=(.*)/s);
        if (Object.hasOwn(options, key)) throw new Error(`duplicate option: --${key}`);
        options[key] = value ?? true;
    }
}
const integer = (name, fallback, maximum) => {
    const value = options[name] === undefined ? fallback : Number(options[name]);
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new RangeError(`${name} 1..${maximum}`);
    return value;
};
const git = (directory, ...args) => execFileSync('git', ['-C', directory, ...args], {encoding: 'utf8'}).trim();
const moduleURL = (directory, path) => pathToFileURL(join(directory, path)).href;

async function loadVariant({name, directory, wasmPath, revision}) {
    directory = realpathSync(directory); wasmPath = realpathSync(wasmPath);
    assert.equal(git(directory, 'rev-parse', 'HEAD'), revision, `${name}: exact revision`);
    assert.equal(git(directory, 'status', '--porcelain'), '', `${name}: clean source tree`);
    const wasmBytes = readFileSync(wasmPath), manifestBytes = readFileSync(join(dirname(wasmPath), 'wired-net-kernel-build.json'));
    const build = JSON.parse(manifestBytes);
    assert.equal(build.wasmSHA256, hash(wasmBytes), `${name}: Wasm build receipt`);
    for (const [path, expected] of Object.entries(build.sourceHashes))
        assert.equal(hash(readFileSync(join(directory, path))), expected, `${name}: source receipt ${path}`);
    const jsPaths = ['src/devices/bus-memory.js', 'src/experimental/harris-80c286-boot-cpu.js',
        'src/experimental/harris-boot-rom.js', 'src/experimental/harris-native-memory-board.js',
        'src/experimental/harris-run-transactions.js'];
    const provenancePaths = [...jsPaths, 'src/experimental/harris-80c286-memory-board.js',
        'src/experimental/wired-kernel/bus-circuit-image.js'];
    const [busMemory, cpuModule, romModule, boardModule, runModule] = await Promise.all(jsPaths.map(path => import(moduleURL(directory, path))));
    busMemory.registerBusMemory();
    return Object.freeze({name, directory, revision, wasmBytes,
        HarrisBootCPU: cpuModule.HarrisBootCPU,
        createROM: romModule.createHarrisStoreLoopROM,
        createBoard: boardModule.createHarrisNativeMemoryBoard,
        runTransactions: runModule.runHarrisTransactions,
        provenance: Object.freeze({revision, wasmSHA256: build.wasmSHA256,
            buildManifestSHA256: hash(manifestBytes), compiler: build.compiler, buildArgs: build.args,
            nativeSourceHashes: build.sourceHashes,
            jsSourceHashes: Object.fromEntries(provenancePaths.map(path => [path, hash(readFileSync(join(directory, path)))]))})});
}

function stateOf(cpu, board) {
    const bus = board.inspectBus();
    const stateHash = hash(JSON.stringify({cpu: cpu.inspect(), bus,
        memory: ['rom0', 'rom1', 'ram0', 'ram1'].map(id => {
            const memory = board.inspectMemory(id);
            return {id, bytes: [...memory.bytes], writes: memory.writes};
        })}));
    return {stateHash, physicalClock: bus.clock, status: cpu.status, retired: cpu.retired,
        writes: [board.inspectMemory('ram0').writes, board.inspectMemory('ram1').writes]};
}

async function sample(variant, {iterations, batchPeriods, wallBudgetMS}) {
    const board = await variant.createBoard({enabled: true, rom: variant.createROM(iterations), romLowAlias: true,
        wasmBytes: variant.wasmBytes, admittedGraph: true, incrementalGraph: true});
    const cpu = new variant.HarrisBootCPU({enabled: true, board});
    cpu.initialize(); board.resetWorkCounters(); global.gc?.();
    let yields = 0;
    const wallStart = performance.now();
    const result = await variant.runTransactions({cpu, maxPeriods: iterations * 32 + 100, batchPeriods, wallBudgetMS,
        yieldTask: () => new Promise(resolve => setImmediate(() => { yields++; resolve(); }))});
    const wallMS = performance.now() - wallStart;
    assert.equal(result.status, 'halted');
    assert.equal(cpu.retired, iterations * 3 + 4);
    const state = stateOf(cpu, board), rawWork = board.inspectWorkCounters();
    assert.deepEqual(Object.keys(rawWork).sort(), [...LEGACY_WORK_COUNTERS].sort(), `${variant.name}: exact legacy counter schema`);
    const work = Object.fromEntries(LEGACY_WORK_COUNTERS.map(name => [name, rawWork[name]]));
    assert.equal(yields, result.chunks - 1, `${variant.name}: one yield between chunks`);
    const semantic = {stateHash: state.stateHash, periods: result.periods, retired: state.retired,
        writes: state.writes, physicalClock: state.physicalClock, chunks: result.chunks, yields, work};
    assert.deepEqual(state.writes, [iterations, iterations]);
    assert.equal(state.physicalClock, result.periods + 67);
    return {label: variant.name, activeMS: result.activeMS, wallMS,
        activePeriodsPerSecond: result.periods * 1000 / result.activeMS,
        wallPeriodsPerSecond: result.periods * 1000 / wallMS, semantic};
}

async function main() {
    parseOptions(process.argv.slice(2));
    if (options.experimental !== true || !options['base-dir'] || !options['counter-dir'] || !options['base-wasm'] || !options['counter-wasm'])
        throw new Error('usage: node --expose-gc scripts/measure-harris-native-counter-overhead.mjs --experimental --base-dir=DIR --counter-dir=DIR --base-wasm=FILE --counter-wasm=FILE');
    const settings = {iterations: integer('iterations', 2048, 65535),
        warmupRounds: integer('warmup-rounds', 2, 10), rounds: integer('rounds', 10, 30),
        batchPeriods: integer('batch-periods', 8192, 8192),
        wallBudgetMS: options['wall-budget-ms'] === undefined ? 1000 : Number(options['wall-budget-ms'])};
    assert.ok(Number.isFinite(settings.wallBudgetMS) && settings.wallBudgetMS > 0 && settings.wallBudgetMS <= 5000, 'wall-budget-ms 0..5000');
    const variants = Object.fromEntries(await Promise.all([
        {name: 'base', directory: options['base-dir'], wasmPath: options['base-wasm'], revision: BASE_REVISION},
        {name: 'counter', directory: options['counter-dir'], wasmPath: options['counter-wasm'], revision: COUNTER_REVISION}
    ].map(async spec => [spec.name, await loadVariant(spec)])));
    const warmups = [], samples = []; let expected = null, sequence = 0;
    for (const group of interleavedOrder(settings.warmupRounds, settings.rounds)) {
        for (let position = 0; position < group.order.length; position++) {
            const value = await sample(variants[group.order[position]], settings);
            expected ??= value.semantic;
            assertSameSemanticReceipt(value.semantic, expected, `${value.label} ${group.phase} ${group.round}`);
            const record = {sequence: ++sequence, phase: group.phase, round: group.round, position: position + 1, ...value};
            (group.phase === 'warmup' ? warmups : samples).push(record);
        }
    }
    const metrics = Object.fromEntries(['base', 'counter'].map(label => {
        const selected = samples.filter(sample => sample.label === label);
        return [label, {activeMS: summarize(selected.map(sample => sample.activeMS)),
            wallMS: summarize(selected.map(sample => sample.wallMS)),
            activePeriodsPerSecond: summarize(selected.map(sample => sample.activePeriodsPerSecond)),
            wallPeriodsPerSecond: summarize(selected.map(sample => sample.wallPeriodsPerSecond))}];
    }));
    const ratios = {
        counterToBaseMedianActiveThroughput: metrics.counter.activePeriodsPerSecond.median / metrics.base.activePeriodsPerSecond.median,
        counterToBaseMedianWallThroughput: metrics.counter.wallPeriodsPerSecond.median / metrics.base.wallPeriodsPerSecond.median,
        medianActiveTimeOverheadPercent: (metrics.counter.activeMS.median / metrics.base.activeMS.median - 1) * 100,
        medianWallTimeOverheadPercent: (metrics.counter.wallMS.median / metrics.base.wallMS.median - 1) * 100
    };
    for (const [name, value] of Object.entries(ratios)) assert.ok(Number.isFinite(value) && value > -100, name);
    const measurementDirectory = realpathSync(fileURLToPath(new URL('..', import.meta.url)));
    const measurementRevision = git(measurementDirectory, 'rev-parse', 'HEAD');
    assert.equal(git(measurementDirectory, 'status', '--porcelain'), '', 'measurement requires a clean harness tree');
    console.log(JSON.stringify({schemaVersion: 1, workload: 'owned-harris-store-loop-memory-only-native-counter-overhead',
        measurementRevision, clean: true, settings,
        host: {hostname: hostname(), platform: platform(), arch: arch(), cpu: cpus()[0]?.model,
            node: process.version, loadavg: loadavg(), exposedGC: typeof global.gc === 'function'},
        variants: Object.fromEntries(Object.entries(variants).map(([name, variant]) => [name, variant.provenance])),
        expected, metrics, ratios, warmups, samples,
        limitations: ['Same hosted job, process and alternating order reduce runner drift but do not make shared-host timing deterministic.',
            'The compared revisions differ only by the producer-counter implementation and its oracle-census entry; each uses its matching fail-closed JS ABI wrapper.',
            'activeMS measures the shared cooperative CPU/native call path and excludes yield waits; wallMS includes host scheduling between bounded chunks.',
            'This receipt measures native counter overhead. It does not use the JavaScript control/instrumented wrapper ratio and approves no optimization or default change.']}, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
