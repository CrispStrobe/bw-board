#!/usr/bin/env node
/** Actual F0 qualification evidence; a diagnostic success does not waive 1x. */
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
const profile = process.argv.includes('--profile');
if (process.env.NODE_OPTIONS) throw Error('Unset NODE_OPTIONS for ordinary timing');
if (existsSync(out)) throw Error('Refusing to overwrite evidence');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const buildInfo = JSON.parse(readFileSync(join(directory, '..', 'BUILD-INFO.json')));
if (!/^[a-f0-9]{40}$/.test(buildInfo.ref)) throw Error('Exact source commit required');
for (const file of ['labwired_wasm.js', 'labwired_wasm_bg.wasm']) {
    const bytes = readFileSync(join(directory, file)), declared = buildInfo.targets.nodejs[file];
    if (bytes.length !== declared.bytes || hash(bytes) !== declared.sha256) throw Error('Artifact mismatch: ' + file);
}
const harness = join(root, 'test/labwired-f0-gpio-profile.test.mjs');
const receipt = {schema: 'labwired.f0-gpio-profile.v1', diagnosticOnly: true, workloads: ['gpio'],
    startedAt: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model,
    logicalCpus: cpus().length, buildInfo, files: Object.fromEntries([
        harness, fileURLToPath(import.meta.url), join(root, 'scripts/lib/f0-gpio-profile-receipt.mjs'),
        join(root, 'test/fixtures/labwired/f0-timing/active.S'),
        join(root, 'test/fixtures/labwired/f0-timing/active.ld')
    ].map(file => [file.slice(root.length + 1), hash(readFileSync(file))])),
    compiler: spawnSync('arm-none-eabi-gcc', ['--version'], {encoding: 'utf8'}).stdout,
    limitations: ['selected active F0 workloads; not all firmware, silicon CPI or browser/UI qualification',
        '48 MHz scales engine-reported cycles, not physically calibrated instruction timing',
        'production recommended peripheral tick policy, no observers/debugger/circuit solving',
        'shared host; original artifact bytes verified; no app pin or hardware change',
        'ordinary timings separate from whole-process GPIO-only sampled attribution',
        'GPIO profile includes setup, compilation, warm-up and functional tests; not only timed windows',
        'profile percentages are not removable-cost percentages or an optimization qualification']};
mkdirSync(out, {recursive: true});
const save = () => writeFileSync(join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
save();
function run (label, flags) {
    const before = loadavg();
    const child = spawnSync(process.execPath, [...flags, harness], {cwd: root, encoding: 'utf8',
        timeout: 180_000, maxBuffer: 32 * 1024 * 1024,
        env: {...process.env, LABWIRED_WASM: directory, LABWIRED_F0_REQUIRED: '1', LABWIRED_REQUIRE_F0_RTX: '1'}});
    writeFileSync(join(out, label + '-stdout.txt'), child.stdout || '');
    writeFileSync(join(out, label + '-stderr.txt'), child.stderr || '');
    const result = {flags, loadBefore: before, loadAfter: loadavg(), exitCode: child.status,
        signal: child.signal, error: child.error?.message};
    receipt[label] = result;
    save(); // Raw evidence survives malformed/functionally failed runs.
    Object.assign(result, f0GpioTimingResult(child.stdout || '', child.status));
    save();
    return result;
}
run('ordinary', []);
if (profile) {
    run('sampled', ['--cpu-prof', '--cpu-prof-dir=' + out, '--cpu-prof-name=f0-gpio.cpuprofile']);
    assertSameGpioGuest(receipt.ordinary, receipt.sampled);
    const bytes = readFileSync(join(out, 'f0-gpio.cpuprofile'));
    receipt.sampled.profileSha256 = hash(bytes);
    receipt.sampled.profile = summarizeCpuProfile(JSON.parse(bytes));
    const names = wasmFunctionNames(readFileSync(join(directory, 'labwired_wasm_bg.wasm')));
    for (const frame of receipt.sampled.profile.topWasmFrames) {
        const index = frame.functionName.match(/wasm-function\[(\d+)\]/)?.[1];
        frame.wasmName = index === undefined ? null : names.get(Number(index)) || null;
    }
}
receipt.completedAt = new Date().toISOString();
save();
console.log(JSON.stringify({source: buildInfo.ref,
    ordinary: Object.fromEntries(Object.entries(receipt.ordinary.workloads).map(([key, value]) =>
        [key, {medianRtx: value.medianRtx, minimumRtx: value.minimumRtx, allWindowsMeet1x: value.allWindowsMeet1x}])),
    sampledFrames: receipt.sampled?.profile.topWasmFrames.slice(0, 8)}));
