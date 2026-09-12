/** Active execution only; owned memory-only ROM, not DOS/full-board capacity. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname, join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {cpus, hostname, platform, arch, loadavg} from 'node:os';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {createHarrisNativeMemoryBoard} from '../src/experimental/harris-native-memory-board.js';
import {HarrisBootCPU} from '../src/experimental/harris-80c286-boot-cpu.js';
import {createHarrisLoopROM, createHarrisStoreLoopROM} from '../src/experimental/harris-boot-rom.js';

const options = {};
for (const arg of process.argv.slice(2)) {
    const match = /^(--experimental|--iterations=([0-9]+)|--rounds=([0-9]+)|--variants=([a-z,-]+))$/.exec(arg);
    if (!match) throw new Error(`unknown benchmark option: ${arg}`);
    const key = arg.split('=')[0]; if (Object.hasOwn(options, key)) throw new Error(`duplicate option: ${key}`);
    options[key] = arg.includes('=') ? arg.slice(key.length + 1) : true;
}
if (!options['--experimental'] || !process.env.HARRIS_NET_WASM)
    throw new Error('usage: HARRIS_NET_WASM=owned.wasm node scripts/bench-harris-hybrid-cpu.mjs --experimental [--iterations=N] [--rounds=N] [--variants=...]');
const iterations = options['--iterations'] === undefined ? null : Number(options['--iterations']);
if (iterations !== null && (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 65535)) throw new RangeError('iterations 1..65535');
const rounds = options['--rounds'] === undefined ? 5 : Number(options['--rounds']);
if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 10) throw new RangeError('rounds 1..10');
const wasmBytes = readFileSync(process.env.HARRIS_NET_WASM);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const build = JSON.parse(readFileSync(join(dirname(process.env.HARRIS_NET_WASM), 'wired-net-kernel-build.json')));
assert.equal(build.wasmSHA256, hash(wasmBytes), 'module must match build receipt');
const sourceHashes = {};
for (const [path, expectedHash] of Object.entries(build.sourceHashes)) {
    assert.match(path, /^src\/experimental\/wired-kernel\/[a-z-]+\.c$/);
    const actual = hash(readFileSync(new URL(`../${path}`, import.meta.url)));
    assert.equal(actual, expectedHash, `rebuild for changed source: ${path}`); sourceHashes[path] = actual;
}
for (const path of ['scripts/bench-harris-hybrid-cpu.mjs', 'src/experimental/harris-native-memory-board.js',
    'src/experimental/wired-kernel/bus-circuit-image.js',
    'src/experimental/harris-80c286-boot-cpu.js', 'src/experimental/harris-80c286-memory-board.js', 'src/experimental/harris-boot-rom.js'])
    sourceHashes[path] = hash(readFileSync(new URL(`../${path}`, import.meta.url)));
registerBusMemory();
const allVariants = ['reference-js', 'compiled-js', 'hybrid-single', 'hybrid-batched'];
const variants = options['--variants']?.split(',') ?? allVariants;
if (new Set(variants).size !== variants.length || variants.some(v => !allVariants.includes(v))) throw new RangeError('variants');
const samples = Object.fromEntries(variants.map(name => [name, []]));
let expected = null;
for (let round = 0; round <= rounds; round++) {
    // Alternate order, discard one complete warmup round, no UI pacing included.
    for (const name of round % 2 ? [...variants].reverse() : variants) {
        const options = {enabled: true, rom: iterations === null ? createHarrisLoopROM() : createHarrisStoreLoopROM(iterations), romLowAlias: true};
        const board = name.startsWith('hybrid') ? await createHarrisNativeMemoryBoard({
            ...options, wasmBytes, admittedGraph: true, incrementalGraph: true
        }) : createHarrisMemoryBoard({...options, ...(name === 'compiled-js' ? {
            netBackend: 'compiled', memoryScheduling: true, memoryWriteJournal: true, packedBus: true
        } : {})});
        const cpu = new HarrisBootCPU({enabled: true, board}); cpu.initialize();
        const before = performance.now();
        const budget = iterations === null ? 2000 : iterations * 32 + 100;
        const run = name === 'hybrid-batched' ? cpu.runTransactions({maxPeriods: budget, maxBatchPeriods: 256}) : cpu.run(budget);
        const activeMs = performance.now() - before;
        assert.equal(cpu.status, 'halted'); assert.equal(cpu.retired, iterations === null ? 47 : iterations * 3 + 4);
        if (iterations !== null) {
            assert.equal(cpu.regs.ax, iterations); assert.equal(cpu.regs.cx, 0);
            assert.equal(board.inspectMemory('ram0').writes, iterations);
            assert.equal(board.inspectMemory('ram1').writes, iterations);
        }
        const stateHash = hash(JSON.stringify({cpu: cpu.inspect(), memory:
            ['rom0', 'rom1', 'ram0', 'ram1'].map(id => ({id,
                bytes: [...board.inspectMemory(id).bytes], writes: board.inspectMemory(id).writes}))}));
        const periods = run.periods ?? run.clocks;
        if (!expected) expected = {stateHash, periods};
        assert.deepEqual({stateHash, periods}, expected, `${name} round ${round}`);
        if (round) samples[name].push({activeMs, periods, periodsPerSecond: periods * 1000 / activeMs, stateHash});
    }
}
const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const medians = Object.fromEntries(variants.map(name => [name, median(samples[name].map(s => s.periodsPerSecond))]));
console.log(JSON.stringify({schemaVersion: 2, workload: iterations === null ? 'owned-harris-loop-memory-only' : 'owned-harris-store-loop-memory-only', iterations,
    host: {hostname: hostname(), platform: platform(), arch: arch(), cpu: cpus()[0]?.model, node: process.version, loadavg: loadavg()},
    wasmSHA256: hash(wasmBytes), sourceHashes, warmupRounds: 1, measuredRounds: rounds, expected, medians,
    batchedVersusCompiled: medians['hybrid-batched'] && medians['compiled-js'] ? medians['hybrid-batched'] / medians['compiled-js'] : null, samples,
    limitations: ['Initialization and construction excluded from both period and time counts.',
        'Memory-only owned workload; not DOS, peripherals, full-native CPU or browser capacity.',
        'Shared-host measurements are not a stable performance guarantee.']}, null, 2));
