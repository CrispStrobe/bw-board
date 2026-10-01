import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {summarizeCpuProfile, parseWasmCompilations, wasmFunctionNames, assertCompilerMode} from '../scripts/lib/wasm-motion-profile.mjs';

test('WASM names map trace function indices without compiling the module', () => {
    const header = [0, 97, 115, 109, 1, 0, 0, 0];
    const bytes = Uint8Array.from([...header, 0, 11, 4, 110, 97, 109, 101, 1, 4, 1, 73, 1, 120]);
    assert.equal(wasmFunctionNames(bytes).get(73), 'x');
    assert.equal(wasmFunctionNames(Uint8Array.from(header)).size, 0);
    assert.throws(() => wasmFunctionNames(bytes.subarray(0, bytes.length - 1)));
    assert.throws(() => wasmFunctionNames(Uint8Array.from([1, 2, 3])));
});

const profile = () => ({nodes: [
    {id: 1, callFrame: {functionName: '(root)', url: ''}},
    {id: 2, callFrame: {functionName: 'wasm-function[73]', url: 'wasm://wasm/module', lineNumber: 0}},
    {id: 3, callFrame: {functionName: 'runCycles', url: 'file:///test.mjs', lineNumber: 1}}
], samples: [2, 2, 3], timeDeltas: [100, 200, 100]});

test('sampling uses actual sample IDs and time deltas, not unsampled hit counts', () => {
    const result = summarizeCpuProfile(profile());
    assert.equal(result.samples, 3);
    assert.equal(result.wasmSamples, 2);
    assert.equal(result.wasmSelfShare, .75);
    assert.equal(result.topWasmFrames[0].selfMicros, 300);
    assert.equal(result.topFrames[1].functionName, 'runCycles');
});
test('incomplete, unknown and inconsistent samples fail closed', () => {
    for (const mutate of [p => { p.samples = []; }, p => { p.timeDeltas.pop(); },
        p => { p.samples[0] = 999; }, p => { p.timeDeltas[0] = -1; },
        p => { p.nodes.push(p.nodes[0]); }, p => { p.nodes[0].callFrame = null; }]) {
        const p = profile(); mutate(p); assert.throws(() => summarizeCpuProfile(p));
    }
});
test('compiler traces preserve each tier, body size, module and function', () => {
    const result = parseWasmCompilations([
        'Compiled function 0xabc#73 using Liftoff, took 1 ms and 12 bytes; bodysize 77465 codesize 100',
        'Compiled function 0xabc#73 using TurboFan, took 2.5 ms and 32 / 40 max/total bytes; bodysize 77465 codesize 80 name CortexM::step_batch'
    ].join('\n'));
    assert.deepEqual(result.tiers, {Liftoff: 1, TurboFan: 1});
    assert.equal(result.cortexM.length, 1);
    assert.equal(result.compilations[0].name, null);
    assert.equal(result.compilations[1].compileMs, 2.5);
    assert.equal(result.largestBodies[0].bodyBytes, 77465);
    assert.throws(() => parseWasmCompilations('no actual trace'));
    assert.throws(() => parseWasmCompilations('Compiled function NEW FORMAT'));
});
test('forced compiler modes reject mixed, missing or opposite-tier evidence', () => {
    const rows = (...tiers) => ({compilations: tiers.map(tier => ({tier}))});
    assert.doesNotThrow(() => assertCompilerMode('liftoff', rows('Liftoff')));
    assert.doesNotThrow(() => assertCompilerMode('turbofan', rows('TurboFan')));
    for (const mode of ['liftoff', 'turbofan']) {
        assert.throws(() => assertCompilerMode(mode, rows()));
        assert.throws(() => assertCompilerMode(mode, rows('Liftoff', 'TurboFan')));
        assert.throws(() => assertCompilerMode(mode, rows('unknown')));
    }
    assert.throws(() => assertCompilerMode('liftoff', rows('TurboFan')));
    assert.throws(() => assertCompilerMode('turbofan', rows('Liftoff')));
    assert.doesNotThrow(() => assertCompilerMode('trace-default', rows('Liftoff', 'TurboFan')));
});

test('hosted profiling is opt-in and follows the unchanged ordinary A/B', () => {
    const workflow = readFileSync(new URL('../.github/workflows/labwired-motion-ab.yml', import.meta.url), 'utf8');
    assert.match(workflow, /profile:\n[\s\S]*?type: boolean\n        default: false/);
    assert.ok(workflow.indexOf('node scripts/probe-labwired-motion-ab.mjs') <
        workflow.indexOf('node scripts/profile-labwired-motion.mjs'));
    assert.match(workflow, /for mode in trace-default sampled-default turbofan liftoff/);
    assert.match(workflow, /Retain raw results even if the diagnostic itself fails\n        if: always\(\)/);
    const script = readFileSync(new URL('../scripts/profile-labwired-motion.mjs', import.meta.url), 'utf8');
    assert.match(script, /LABWIRED_MOTION_REQUIRED: '1', LABWIRED_REQUIRE_MOTION_RTX: '1'/);
    assert.match(script, /diagnosticOnly: true/);
    assert.match(script, /liftoff: \['--liftoff-only', '--no-wasm-tier-up', '--no-wasm-dynamic-tiering'/);
    assert.ok(script.indexOf('save(); // Retain contradictory traces') < script.indexOf('assertCompilerMode(mode,'));
    assert.ok(script.indexOf("writeFileSync(join(out, 'stdout.txt')") < script.indexOf('Object.assign(receipt, motionProbeResult'));
});
