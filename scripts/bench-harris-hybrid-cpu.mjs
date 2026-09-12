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
import {createHarrisLoopROM} from '../src/experimental/harris-boot-rom.js';

if (process.argv.length !== 3 || process.argv[2] !== '--experimental' || !process.env.HARRIS_NET_WASM)
    throw new Error('usage: HARRIS_NET_WASM=owned.wasm node scripts/bench-harris-hybrid-cpu.mjs --experimental');
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
    'src/experimental/harris-80c286-boot-cpu.js', 'src/experimental/harris-80c286-memory-board.js'])
    sourceHashes[path] = hash(readFileSync(new URL(`../${path}`, import.meta.url)));
registerBusMemory();
const variants = ['reference-js', 'compiled-js', 'hybrid-single', 'hybrid-batched'];
const samples = Object.fromEntries(variants.map(name => [name, []]));
let expected = null;
for (let round = 0; round < 6; round++) {
    // Alternate order, discard one complete warmup round, no UI pacing included.
    for (const name of round % 2 ? [...variants].reverse() : variants) {
        const options = {enabled: true, rom: createHarrisLoopROM(), romLowAlias: true};
        const board = name.startsWith('hybrid') ? await createHarrisNativeMemoryBoard({
            ...options, wasmBytes, admittedGraph: true, incrementalGraph: true
        }) : createHarrisMemoryBoard({...options, ...(name === 'compiled-js' ? {
            netBackend: 'compiled', memoryScheduling: true, memoryWriteJournal: true, packedBus: true
        } : {})});
        const cpu = new HarrisBootCPU({enabled: true, board}); cpu.initialize();
        const before = performance.now();
        const run = name === 'hybrid-batched' ? cpu.runTransactions({maxPeriods: 2000, maxBatchPeriods: 256}) : cpu.run(2000);
        const activeMs = performance.now() - before;
        assert.equal(cpu.status, 'halted'); assert.equal(cpu.retired, 47);
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
console.log(JSON.stringify({schemaVersion: 1, workload: 'owned-harris-loop-memory-only',
    host: {hostname: hostname(), platform: platform(), arch: arch(), cpu: cpus()[0]?.model, node: process.version, loadavg: loadavg()},
    wasmSHA256: hash(wasmBytes), sourceHashes, warmupRounds: 1, measuredRounds: 5, expected, medians,
    batchedVersusCompiled: medians['hybrid-batched'] / medians['compiled-js'], samples,
    limitations: ['Initialization and construction excluded from both period and time counts.',
        'Short memory-only owned workload; not DOS, peripherals, full-native CPU or browser capacity.',
        'Shared-host measurements are not a stable performance guarantee.']}, null, 2));
