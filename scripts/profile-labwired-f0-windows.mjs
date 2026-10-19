#!/usr/bin/env node
/** Warmed GPIO-window attribution, never a replacement for ordinary qualification. */
import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {cpus, loadavg} from 'node:os';
import {f0GpioTimingResult, assertSameGpioGuest} from './lib/f0-gpio-profile-receipt.mjs';
import {summarizeCpuProfile, wasmFunctionNames} from './lib/wasm-motion-profile.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const option = name => {
    const i = process.argv.indexOf('--' + name), value = process.argv[i + 1];
    if (i < 0 || !value || value.startsWith('--')) throw Error('Required: --' + name);
    return resolve(value);
};
const directory = option('wasm'), out = option('out');
if (process.env.NODE_OPTIONS || process.env.LABWIRED_WINDOW_PROFILE_OUT) throw Error('Unset inherited profiling controls');
if (existsSync(out)) throw Error('Refusing to overwrite evidence');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const buildInfo = JSON.parse(readFileSync(join(directory, '..', 'BUILD-INFO.json')));
if (!/^[a-f0-9]{40}$/.test(buildInfo.ref)) throw Error('Exact source commit required');
for (const file of ['labwired_wasm.js', 'labwired_wasm_bg.wasm']) {
    const bytes = readFileSync(join(directory, file)), declared = buildInfo.targets.nodejs[file];
    if (bytes.length !== declared.bytes || hash(bytes) !== declared.sha256) throw Error('Artifact mismatch: ' + file);
}
const ordinaryHarness = join(root, 'test/labwired-f0-gpio-profile.test.mjs');
const windowHarness = join(root, 'test/labwired-f0-gpio-window-profile.test.mjs');
const files = [ordinaryHarness, windowHarness, fileURLToPath(import.meta.url),
    join(root, 'scripts/lib/window-cpu-profiler.mjs'), join(root, 'scripts/lib/wasm-motion-profile.mjs'),
    join(root, 'scripts/lib/f0-gpio-profile-receipt.mjs'),
    join(root, 'test/fixtures/labwired/f0-timing/active.S'), join(root, 'test/fixtures/labwired/f0-timing/active.ld')];
const receipt = {schema: 'labwired.f0-window-profile.v1', diagnosticOnly: true,
    startedAt: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model,
    logicalCpus: cpus().length, buildInfo, files: Object.fromEntries(files.map(file => [file.slice(root.length + 1), hash(readFileSync(file))])),
    compiler: spawnSync('arm-none-eabi-gcc', ['--version'], {encoding: 'utf8'}).stdout,
    limitations: ['GPIO guest only; not all chips, firmware, silicon CPI or browser/UI performance',
        'ordinary and profiled timings are separate processes, not a speedup A/B',
        'warm-up precedes sampling but does not prove JIT tiering has finished',
        'profiles cover each warmed cycle window plus profiler boundary/JS validation overhead',
        'guest compilation, initialization, warm-up, board input changes, observations and logging are outside sampling',
        'profiled RTx includes sampling overhead; shares are attribution, not removable-cost estimates',
        'no forced tiers, engine mutation, promotion, app pins or physical acknowledgement changes']};
mkdirSync(out);
const save = () => writeFileSync(join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
save();
function run (label, harness, extraEnv = {}) {
    const before = loadavg();
    const child = spawnSync(process.execPath, [harness], {cwd: root, encoding: 'utf8',
        timeout: 180_000, maxBuffer: 32 * 1024 * 1024,
        env: {...process.env, LABWIRED_WASM: directory, LABWIRED_F0_REQUIRED: '1', LABWIRED_REQUIRE_F0_RTX: '1', ...extraEnv}});
    writeFileSync(join(out, label + '-stdout.txt'), child.stdout || '');
    writeFileSync(join(out, label + '-stderr.txt'), child.stderr || '');
    const result = {flags: [], harness: harness.slice(root.length + 1), loadBefore: before,
        loadAfter: loadavg(), exitCode: child.status, signal: child.signal, error: child.error?.message};
    receipt[label] = result; save(); // Original child output survives parsing errors.
    Object.assign(result, f0GpioTimingResult(child.stdout || '', child.status));
    save();
    return {result, stdout: child.stdout};
}
try {
    run('ordinary', ordinaryHarness);
    const {stdout} = run('profiled', windowHarness, {LABWIRED_WINDOW_PROFILE_OUT: join(out, 'window-profiles')});
    assertSameGpioGuest(receipt.ordinary, receipt.profiled);
    receipt.guestObservationsMatch = true; save();
    const markers = stdout.split('\n').filter(line => line.startsWith('F0_WINDOW_PROFILE '))
        .map(line => JSON.parse(line.slice('F0_WINDOW_PROFILE '.length)));
    if (markers.length !== 5) throw Error('Exactly five profile windows required');
    receipt.windows = markers.map((marker, index) => {
        if (marker.index !== index || marker.profileFile !== `gpio-${index}.cpuprofile` ||
            marker.scope !== 'warmed-cycle-window-with-profiler-boundary-overhead' ||
            marker.warmupCycles !== 6_000_000 || marker.cycles !== 48_000_000 ||
            marker.samplingIntervalMicros !== 1000) throw Error('Profile boundary/provenance mismatch');
        const bytes = readFileSync(join(out, 'window-profiles', marker.profileFile));
        if (hash(bytes) !== marker.profileSha256) throw Error('Raw profile identity mismatch');
        return {...marker, bytes: bytes.length};
    });
    save(); // Bind every raw profile before any attribution can fail.
    const names = wasmFunctionNames(readFileSync(join(directory, 'labwired_wasm_bg.wasm')));
    for (const window of receipt.windows) {
        const raw = JSON.parse(readFileSync(join(out, 'window-profiles', window.profileFile)));
        const summary = summarizeCpuProfile(raw); // Strict: never clamp negative deltas.
        if (!(raw.endTime > raw.startTime) || summary.wasmSamples <= 0) throw Error('Missing actual WASM window samples');
        summary.limitations = receipt.limitations.slice(2, 6);
        for (const frame of summary.topWasmFrames) {
            const index = frame.functionName.match(/wasm-function\[(\d+)\]/)?.[1];
            frame.wasmName = index === undefined ? null : names.get(Number(index)) || null;
        }
        window.summary = summary; save();
    }
    receipt.completedAt = new Date().toISOString(); save();
    console.log(JSON.stringify({source: buildInfo.ref, node: process.version,
        ordinary: receipt.ordinary.workloads.gpio, profiled: receipt.profiled.workloads.gpio,
        windows: receipt.windows.map(w => ({index: w.index, sampledMicros: w.summary.sampledMicros,
            wasmSelfShare: w.summary.wasmSelfShare, topWasmFrames: w.summary.topWasmFrames.slice(0, 8)}))}));
} catch (error) {
    receipt.error = error.message; receipt.failedAt = new Date().toISOString(); save(); throw error;
}
