#!/usr/bin/env node
/** Explicitly instrumented F0 occurrence windows. Never a performance benchmark. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync, existsSync, mkdtempSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {join, resolve, dirname} from 'node:path';
import {tmpdir, cpus} from 'node:os';
import {createHash} from 'node:crypto';
import {buildLabwiredSystem} from '../src/labwired-bridge.js';
import {createLabwiredAdapter, plain} from '../src/labwired-adapter.js';
import {validateCensus} from './lib/fastpath-census-receipt.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2), options = {};
for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!['--wasm', '--out', '--source'].includes(key) || !value || value.startsWith('--')
        || options[key]) throw Error('Use exactly --wasm DIRECTORY --out NEW_DIRECTORY --source FULL_COMMIT');
    options[key] = value;
}
for (const key of ['--wasm', '--out', '--source']) assert.ok(options[key], `Required: ${key}`);
const directory = resolve(options['--wasm']), out = resolve(options['--out']);
assert.match(options['--source'], /^[a-f0-9]{40}$/);
assert.equal(readFileSync(join(directory, '..', 'source-head.txt'), 'utf8').trim(), options['--source']);
if (existsSync(out)) throw Error('Refusing to overwrite evidence');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = readFileSync(join(directory, '..', 'sha256.txt'), 'utf8');
const artifact = {};
for (const file of ['labwired_wasm.js', 'labwired_wasm_bg.wasm']) {
    const bytes = readFileSync(join(directory, file));
    const line = manifest.split('\n').find(line => line.endsWith(`  fastpath-census/nodejs/${file}`));
    assert.ok(line, `Missing hash: ${file}`);
    assert.equal(hash(bytes), line.slice(0, 64), `Artifact mismatch: ${file}`);
    artifact[file] = {bytes: bytes.length, sha256: hash(bytes)};
}
const wasm = createRequire(import.meta.url)(join(directory, 'labwired_wasm.js'));
assert.equal(typeof wasm.fastpath_census_reset, 'function', 'explicit instrumented artifact required');
assert.equal(typeof wasm.fastpath_census_snapshot_json, 'function');
const clockHz = 48_000_000, warmupCycles = 200_000, windowCycles = 2_000_000;
const fixture = join(root, 'test/fixtures/labwired/f0-timing');
const receipt = {schema: 'labwired.fastpath-census.v1', diagnosticOnly: true,
    source: options['--source'], node: process.version, cpu: cpus()[0]?.model,
    startedAt: new Date().toISOString(), artifact, warmupCycles, windowCycles,
    compiler: execFileSync('arm-none-eabi-gcc', ['--version'], {encoding: 'utf8'}),
    rustVersion: readFileSync(join(directory, '..', 'rust-version.txt'), 'utf8').trim(),
    bindgenVersion: readFileSync(join(directory, '..', 'bindgen-version.txt'), 'utf8').trim(),
    files: Object.fromEntries(['scripts/probe-labwired-fastpath-census.mjs',
        'scripts/lib/fastpath-census-receipt.mjs', 'src/labwired-bridge.js', 'src/labwired-chips.js',
        'src/labwired-adapter.js', 'src/bin-to-elf.js', 'src/uf2-to-elf.js',
        'test/fixtures/labwired/f0-timing/active.S', 'test/fixtures/labwired/f0-timing/active.ld']
        .map(file => [file, hash(readFileSync(join(root, file)))])),
    limitations: ['instrumented occurrence counts, not time attribution, RTx or optimization acceptance',
        'thread-local aggregate; only one machine runs in each reset window',
        'selected active F0 firmware, no debugger/observers/circuit solving; not all chips',
        '48 MHz engine-reported cycles are not physically calibrated silicon CPI'], workloads: {}};
mkdirSync(out, {recursive: false});
const save = () => writeFileSync(join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
save();
function runCycles (adapter, cycles) {
    let remaining = cycles;
    while (remaining) {
        const budget = Math.min(remaining, 48_000), ran = adapter.sim.step_batch(budget);
        assert.ok(Number.isInteger(ran) && ran > 0 && ran <= budget, 'bounded actual progress');
        remaining -= ran;
    }
}
for (const workload of ['ram', 'gpio']) {
    const temporary = mkdtempSync(join(tmpdir(), 'bw-f0-census-'));
    const elf = join(temporary, 'active.elf'), image = join(temporary, 'active.bin');
    execFileSync('arm-none-eabi-gcc', ['-mcpu=cortex-m0', '-mthumb', '-nostdlib',
        '-Wl,--build-id=none,-T,active.ld', ...(workload === 'gpio' ? ['-DBW_F0_GPIO'] : []),
        'active.S', '-o', elf], {cwd: fixture, stdio: 'pipe'});
    execFileSync('arm-none-eabi-objcopy', ['-O', 'binary', elf, image], {stdio: 'pipe'});
    const firmware = readFileSync(elf), imageBytes = readFileSync(image);
    writeFileSync(join(out, workload + '.elf'), firmware);
    writeFileSync(join(out, workload + '.bin'), imageBytes);
    const built = buildLabwiredSystem({chipKind: 'stm32f030',
        netlist: {parts: [{id: 'f0', kind: 'stm32f030'}], nets: []}});
    assert.equal(built.ok, true);
    assert.deepEqual(built.refusals, []);
    assert.equal(built.clockHz, clockHz);
    const adapter = createLabwiredAdapter({wasm, chipYaml: built.chipYaml, systemYaml: built.systemYaml,
        firmware: new Uint8Array(firmware), firmwareOnly: true, clockHz});
    const result = receipt.workloads[workload] = {elfSha256: hash(firmware), imageSha256: hash(imageBytes),
        chipYamlSha256: hash(built.chipYaml), systemYamlSha256: hash(built.systemYaml), samples: []};
    try {
        runCycles(adapter, warmupCycles);
        let previous = 0;
        for (const high of [false, true, false]) {
            if (workload === 'gpio') adapter.sim.set_board_io_input('PA1', high);
            wasm.fastpath_census_reset();
            runCycles(adapter, windowCycles);
            const counts = JSON.parse(wasm.fastpath_census_snapshot_json());
            const sample = {high, cycles: windowCycles, counts};
            result.samples.push(sample);
            save(); // Preserve raw counts even if validation below fails.
            const summary = validateCensus(counts);
            assert.equal(summary.countedRetired, windowCycles, 'complete active guest window census');
            const bytes = adapter.sim.read_memory(0x20000000, 16);
            const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            const iterations = view.getUint32(0, true), checksum = view.getUint32(4, true);
            const input = view.getUint32(8, true), mirror = view.getUint32(12, true);
            assert.ok(iterations > previous);
            for (const prior of [(checksum ^ 255) >>> 0, mirror]) {
                assert.ok(prior === iterations || prior === iterations - 1, 'RAM receipt consistency');
            }
            let output = null;
            if (workload === 'gpio') {
                assert.equal(input, high ? 2 : 0);
                const snapshot = plain(adapter.sim.get_peripheral_snapshot('gpioPortA'));
                assert.ok(Number.isInteger(snapshot.odr));
                output = snapshot.odr & 1;
                assert.equal(output, high ? 1 : 0);
            } else assert.equal(input, 0);
            Object.assign(sample, {summary, guest: {iterations, checksum, input, mirror, output}});
            previous = iterations;
            save();
        }
    } finally { adapter.sim.free(); }
}
receipt.completedAt = new Date().toISOString();
save();
console.log(JSON.stringify({diagnosticOnly: true, source: receipt.source,
    workloads: Object.fromEntries(Object.entries(receipt.workloads).map(([name, result]) =>
        [name, result.samples.map(sample => sample.summary)]))}));
