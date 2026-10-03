import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const ordinary = read('test/labwired-f0-gpio-profile.test.mjs');
const diagnostic = read('test/labwired-f0-gpio-window-profile.test.mjs');
const region = text => text.slice(text.indexOf('function compile ('), text.indexOf("for (const workload of ['gpio'])"));
test('diagnostic guest compiler, adapter, cycle stepping and observations match ordinary harness', () => {
    assert(region(ordinary).length > 2000);
    assert.equal(region(diagnostic), region(ordinary));
    const functional = text => text.slice(text.indexOf('    test(`F0 ${workload}: active guest'), text.indexOf('    test(`F0 ${workload}: all five'));
    assert.equal(functional(diagnostic), functional(ordinary));
    for (const source of [ordinary, diagnostic]) {
        assert(source.includes('const clockHz = 48_000_000;'));
        assert(source.includes('runCycles(adapter, 6_000_000);'));
        assert(source.includes('index < 5'));
    }
});
test('window sampling follows warm-up and held input and ends before observations/logging', () => {
    assert(diagnostic.indexOf('runCycles(adapter, 6_000_000);') < diagnostic.indexOf('session.connect();'));
    const start = diagnostic.indexOf('const wallSeconds = await withWindowCpuProfile');
    assert(start > 0);
    const body = diagnostic.slice(start, diagnostic.indexOf('}, profile => {', start));
    assert(body.includes('runCycles(adapter, clockHz);'));
    for (const forbidden of ['observe(', 'console.log', 'set_board_io_input', 'compile(', 'makeAdapter(']) assert(!body.includes(forbidden), forbidden);
    assert(diagnostic.indexOf('const sample = observe(adapter, workload, high);', start) > diagnostic.indexOf('profileSha256:', start));
    assert(diagnostic.includes('writeFileSync(join(profileDirectory, profileFile), bytes, {flag: "wx"})'));
    assert(diagnostic.includes('session.disconnect(); adapter.sim.free();'));
});
test('workflow freezes runtimes/repeats, preserves failed originals and cannot promote an engine', () => {
    const workflow = read('.github/workflows/labwired-window-profile.yml');
    assert(workflow.includes("node: ['20.20.2', '22.23.3']"));
    assert(workflow.includes('repeat: [1, 2]'));
    assert(workflow.includes('fail-fast: false'));
    assert(workflow.includes('Retain originals even if timing or profiling fails\n        if: always()'));
    assert(workflow.includes('Original bytes mismatch'));
    assert(!workflow.includes('contents: write'));
    assert(!workflow.includes('publish'));
    const script = read('scripts/profile-labwired-f0-windows.mjs');
    assert(script.includes("diagnosticOnly: true"));
    assert(script.indexOf("run('ordinary', ordinaryHarness)") < script.indexOf("run('profiled', windowHarness"));
    assert(script.includes('assertSameGpioGuest(receipt.ordinary, receipt.profiled)'));
    assert(script.includes('const result = {flags: []'));
    assert(script.indexOf('Bind every raw profile before any attribution') < script.indexOf('summarizeCpuProfile(raw)'));
    assert(script.includes('receipt.error = error.message'));
});
