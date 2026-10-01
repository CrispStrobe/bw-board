#!/usr/bin/env node
/** Unchanged motion workload; raw sampling/tiering diagnostics, never publication. */
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {cpus, loadavg} from 'node:os';
import {motionProbeResult} from './lib/motion-ab-receipt.mjs';
import {summarizeCpuProfile, parseWasmCompilations, wasmFunctionNames} from './lib/wasm-motion-profile.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const option = name => {
    const index = process.argv.indexOf('--' + name);
    const value = process.argv[index + 1];
    if (index < 0 || !value || value.startsWith('--')) throw Error('Required: --' + name);
    return value;
};
const directory = resolve(option('wasm')), out = resolve(option('out')), mode = option('mode');
const flagsByMode = {
    'trace-default': ['--trace-wasm-compilation-times'],
    'sampled-default': ['--cpu-prof', '--cpu-prof-dir=' + out, '--cpu-prof-name=motion.cpuprofile',
        '--trace-wasm-compilation-times'],
    default: [],
    turbofan: ['--no-liftoff', '--no-wasm-tier-up', '--trace-wasm-compilation-times'],
    liftoff: ['--liftoff', '--no-wasm-tier-up', '--trace-wasm-compilation-times']
};
if (!Object.hasOwn(flagsByMode, mode)) throw Error('Unsupported diagnostic mode');
if (process.env.NODE_OPTIONS) throw Error('Unset NODE_OPTIONS to keep diagnostic flags explicit');
if (existsSync(out)) throw Error('Refusing to overwrite existing diagnostics');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const harness = join(root, 'test/labwired-microbit-motion.test.mjs');
const receipt = {schema: 'labwired.motion-wasm-profile.v1', diagnosticOnly: true, mode,
    node: process.version, cpu: cpus()[0]?.model, loadBefore: loadavg(), startedAt: new Date().toISOString(),
    directory, wasmSha256: hash(join(directory, 'labwired_wasm_bg.wasm')),
    glueSha256: hash(join(directory, 'labwired_wasm.js')), harnessSha256: hash(harness),
    flags: flagsByMode[mode], limitations: ['NODEJS held motion workload; not browser/debugger qualification',
        'sampled/forced-tier timings are diagnostic and must not replace ordinary qualification',
        'CPU profiling may alter compiler tiering; trace-default is collected separately without sampling',
        'shared host without contention isolation; no publication or deployed pin change']};
mkdirSync(out, {recursive: true});
const save = () => writeFileSync(join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
save();
const result = spawnSync(process.execPath, [...receipt.flags, harness], {
    cwd: root, encoding: 'utf8', timeout: 180_000, maxBuffer: 32 * 1024 * 1024,
    env: {...process.env, LABWIRED_WASM: directory,
        LABWIRED_MOTION_REQUIRED: '1', LABWIRED_REQUIRE_MOTION_RTX: '1'}
});
writeFileSync(join(out, 'stdout.txt'), result.stdout || '');
writeFileSync(join(out, 'stderr.txt'), result.stderr || '');
Object.assign(receipt, {exitCode: result.status, signal: result.signal, error: result.error?.message,
    loadAfter: loadavg(), completedAt: new Date().toISOString()});
save(); // Preserve raw evidence even when functional assertions or parsing fail.
Object.assign(receipt, motionProbeResult(result.stdout || '', result.status));
if (mode !== 'default') {
    receipt.compilation = parseWasmCompilations((result.stdout || '') + '\n' + (result.stderr || ''));
    const names = wasmFunctionNames(readFileSync(join(directory, 'labwired_wasm_bg.wasm')));
    for (const row of receipt.compilation.compilations) row.wasmName = names.get(row.index) || null;
    receipt.compilation.cortexM = receipt.compilation.compilations.filter(c =>
        /CortexM|cortex_m|step_internal|step_execute|step_batch/.test(c.wasmName || c.name || ''));
}
if (mode === 'sampled-default') {
    receipt.profileSha256 = hash(join(out, 'motion.cpuprofile'));
    receipt.profile = summarizeCpuProfile(JSON.parse(readFileSync(join(out, 'motion.cpuprofile'))));
}
save();
console.log(JSON.stringify({mode, medianRtx: receipt.medianRtx, minimumRtx: receipt.minimumRtx,
    allWindowsMeet1x: receipt.allWindowsMeet1x, profile: receipt.profile?.topWasmFrames.slice(0, 8),
    compilerTiers: receipt.compilation?.tiers}));
