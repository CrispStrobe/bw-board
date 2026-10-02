import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {f0TimingResult, assertSameF0Guest} from '../scripts/lib/f0-timing-receipt.mjs';

// Synthetic parser fixtures only; these numbers are not benchmark evidence.
function fixture (rates = {ram: 2, gpio: .5}) {
    const lines = [];
    let fails = 0;
    for (const [position, workload] of ['ram', 'gpio'].entries()) {
        lines.push('F0_WASM_GUEST ' + JSON.stringify({workload, elfSha256: 'a'.repeat(64), imageSha256: 'b'.repeat(64)}));
        for (let index = 0; index < 5; index++) {
            const iterations = 1000 + index * 1000;
            const rtx = Array.isArray(rates[workload]) ? rates[workload][index] : rates[workload];
            lines.push('F0_WASM_SAMPLE ' + JSON.stringify({workload, index, cycles: 48_000_000,
                cpuHz: 48_000_000, wallSeconds: 1 / rtx, rtx, iterations,
                checksum: (iterations ^ 255) >>> 0, mirror: iterations - 1,
                input: workload === 'gpio' && index % 2 ? 2 : 0,
                output: workload === 'gpio' ? index % 2 : null}));
        }
        const passed = (Array.isArray(rates[workload]) ? rates[workload] : [rates[workload]]).every(r => r >= 1);
        if (!passed) fails++;
        lines.push(`ok ${position * 2 + 1} - F0 ${workload}: active guest and RAM/MMIO observations`);
        lines.push(`${passed ? 'ok' : 'not ok'} ${position * 2 + 2} - F0 ${workload}: all five 48M-cycle windows meet 1x`);
    }
    lines.push('# tests 4', '# skipped 0', `# fail ${fails}`, `# pass ${4 - fails}`, '# cancelled 0', '# todo 0');
    return {stdout: lines.join('\n'), exitCode: fails ? 1 : 0};
}
const parse = f => f0TimingResult(f.stdout, f.exitCode);
const changeSample = (f, change) => ({...f, stdout: f.stdout.split('\n').map(line => {
    if (!line.startsWith('F0_WASM_SAMPLE ')) return line;
    const sample = JSON.parse(line.slice(15)); change(sample);
    return 'F0_WASM_SAMPLE ' + JSON.stringify(sample);
}).join('\n')});

test('F0 parser retains failed GPIO floor despite passing RAM', () => {
    const p = parse(fixture());
    assert.equal(p.workloads.ram.allWindowsMeet1x, true);
    assert.equal(p.workloads.gpio.allWindowsMeet1x, false);
    assert.equal(p.allWindowsMeet1x, false);
});
test('F0 every-window floor cannot be hidden by a passing median', () => {
    const p = parse(fixture({ram: 2, gpio: [2, 2, .9, 2, 2]}));
    assert.equal(p.workloads.gpio.medianRtx, 2);
    assert.equal(p.workloads.gpio.minimumRtx, .9);
    assert.equal(p.allWindowsMeet1x, false);
    assert.equal(parse(fixture({ram: 2, gpio: 2})).allWindowsMeet1x, true);
    assert.equal(parse(fixture({ram: .5, gpio: .5})).allWindowsMeet1x, false);
});
test('F0 missing windows, provenance, skips, unexpected failure and exits fail closed', () => {
    const f = fixture();
    for (const stdout of [f.stdout.replace(/^F0_WASM_SAMPLE .*\n/m, ''),
        f.stdout.replace(/^F0_WASM_GUEST .*\n/m, ''), f.stdout.replace('# skipped 0', '# skipped 1'),
        f.stdout.replace('ok 1 -', 'not ok 1 -'), f.stdout.replace('# fail 1', '# fail 2'),
        f.stdout.replace('# cancelled 0', '# cancelled 1'), f.stdout.replace('# tests 4', '# tests 5')]) {
        assert.throws(() => parse({...f, stdout}));
    }
    for (const exitCode of [0, 2, null]) assert.throws(() => parse({...f, exitCode}));
});
test('F0 wrong cycles, timing, workload order and duplicate indices fail closed', () => {
    for (const mutate of [s => {s.cycles--;}, s => {s.cpuHz++;}, s => {s.rtx++;},
        s => {s.wallSeconds = 0;}, s => {s.index = 0;}, s => {s.workload = 'other';}]) {
        assert.throws(() => parse(changeSample(fixture(), mutate)));
    }
});
test('F0 invalid RAM or held GPIO receipts fail closed', () => {
    for (const mutate of [s => {s.iterations = 0;}, s => {s.mirror -= 10;},
        s => {s.checksum ^= 128;}, s => {s.input = 99;}, s => {s.output = 99;},
        s => {s.checksum = .5;}]) assert.throws(() => parse(changeSample(fixture(), mutate)));
});
test('F0 comparisons require equal loaded images and every cycle-indexed observation', () => {
    const a = parse(fixture()), b = parse(fixture());
    b.workloads.ram.guest.elfSha256 = 'c'.repeat(64); // Nonloaded ELF metadata may vary.
    assert.doesNotThrow(() => assertSameF0Guest(a, b));
    b.workloads.gpio.guest.imageSha256 = 'c'.repeat(64);
    assert.throws(() => assertSameF0Guest(a, b));
    b.workloads.gpio.guest.imageSha256 = 'b'.repeat(64);
    b.workloads.gpio.guestObservations[3].input = 0;
    assert.throws(() => assertSameF0Guest(a, b));
    assert.throws(() => assertSameF0Guest(a, {}));
});

test('F0 tooling keeps ordinary timing separate, verifies artifacts and preserves failures', () => {
    const tool = readFileSync(new URL('../scripts/probe-labwired-f0.mjs', import.meta.url), 'utf8');
    assert.match(tool, /bytes.length !== declared.bytes \|\| hash\(bytes\) !== declared.sha256/);
    assert.match(tool, /LABWIRED_F0_REQUIRED: '1', LABWIRED_REQUIRE_F0_RTX: '1'/);
    assert.match(tool, /Refusing to overwrite evidence/);
    assert.match(tool, /Unset NODE_OPTIONS for ordinary timing/);
    assert.ok(tool.indexOf("run('ordinary', [])") < tool.indexOf("run('sampled',"));
    assert.ok(tool.indexOf("label + '-stdout.txt'") < tool.indexOf('f0TimingResult(child.stdout'));
    const workflow = readFileSync(new URL('../.github/workflows/labwired-f0-profile.yml', import.meta.url), 'utf8');
    assert.match(workflow, /profile:\n[\s\S]*?type: boolean\n        default: false/);
    assert.match(workflow, /Retain raw evidence including failed timing windows\n        if: always\(\)/);
    assert.ok(workflow.indexOf('node scripts/probe-labwired-f0.mjs') < workflow.indexOf('node scripts/profile-labwired-motion.mjs'));
    assert.doesNotMatch(workflow, /contents: write|publish=true/);
});

test('F0 A/B uses ordinary verified children and matches both images and observations', () => {
    const tool = readFileSync(new URL('../scripts/probe-labwired-f0-ab.mjs', import.meta.url), 'utf8');
    assert.match(tool, /order: \['baseline', 'candidate', 'candidate', 'baseline'\]/);
    assert.match(tool, /assertSameF0Guest\(receipt.runs\[0\].capture.ordinary, result.ordinary\)/);
    assert.match(tool, /result.sampled \|\| result.ordinary.flags.length/);
    assert.match(tool, /allWindowsMeet1x: samples.every\(s => s.rtx >= 1\)/);
    assert.doesNotMatch(tool, /--profile|--cpu-prof/);
    const workflow = readFileSync(new URL('../.github/workflows/labwired-motion-ab.yml', import.meta.url), 'utf8');
    assert.match(workflow, /f0:\n[\s\S]*?type: boolean\n        default: false/);
    assert.match(workflow, /if: inputs.f0/);
    assert.ok(workflow.indexOf('node scripts/probe-labwired-motion-ab.mjs') <
        workflow.indexOf('node scripts/probe-labwired-f0-ab.mjs'));
});
