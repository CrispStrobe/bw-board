import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fast286ExitCode, fast286Verdict} from '../scripts/lib/fast286-verdict.mjs';

const clean = () => ({files: 326, available: 65200, selected: 65200, executed: 65200,
    pass: 65200, fail: 0, unsupported: 0, budget: 0, revoked: 0});

test('FAST 286 verdict accepts a complete accounted sample', () => {
    assert.deepEqual(fast286Verdict(clean()), {accepted: true, reason: 'all-executed-vectors-pass'});
});

test('fail, unsupported and budget results are blocking', () => {
    for (const status of ['fail', 'unsupported', 'budget']) {
        const report = clean(); report.pass--; report[status]++;
        assert.equal(fast286Verdict(report).accepted, false, status);
        assert.equal(fast286ExitCode(report), 1, `${status} must make the CLI red`);
    }
});

test('missing, incomplete and malformed accounting cannot pass vacuously', () => {
    for (const mutate of [
        r => { r.files = 0; r.available = 0; r.selected = 0; r.executed = 0; r.pass = 0; },
        r => { r.executed--; },
        r => { r.selected++; },
        r => { r.pass = NaN; },
        r => { r.pass = 0; r.executed = 0; r.revoked = r.selected; },
        r => { r.fullSuite = true; r.available++; },
    ]) {
        const report = clean(); mutate(report);
        assert.equal(fast286Verdict(report).accepted, false);
    }
});

test('consecutive vectors see fresh zero-filled memory', async () => {
    const {executeVariant} = await import('../scripts/grind-i8086-286.mjs');
    const regs = () => Object.fromEntries(['ax','bx','cx','dx','cs','ss','ds','es','sp','bp','si','di','ip','flags']
        .map(name => [name, name === 'flags' ? 2 : name === 'ip' ? 0x100 : 0]));
    const firstRegs = regs(); firstRegs.ax = 0xbeef;
    const first = {initial: {regs: firstRegs, ram: [[0x100,0xa3],[0x101,0x00],[0x102,0x02],[0x103,0xf4]]},
        final: {regs: {ip: 0x104}, ram: [[0x200,0xef],[0x201,0xbe]], masks: {}}, exception: null};
    assert.equal(executeVariant(first, {}).status, 'pass');
    const second = {initial: {regs: regs(), ram: [[0x100,0xa1],[0x101,0x00],[0x102,0x02],[0x103,0xf4]]},
        final: {regs: {ax: 0, ip: 0x104}, ram: [], masks: {}}, exception: null};
    assert.equal(executeVariant(second, {}).status, 'pass',
        'the prior unlisted write at 0x200 must read as zero in the next vector');
});

test('FAST runner rejects nonzero writes absent from expected final memory', async () => {
    const {executeVariant} = await import('../scripts/grind-i8086-286.mjs');
    const regs = Object.fromEntries(['ax','bx','cx','dx','cs','ss','ds','es','sp','bp','si','di','ip','flags']
        .map(name => [name, name === 'flags' ? 2 : name === 'ip' ? 0x100 : 0]));
    regs.ax = 0xbeef;
    const vector = {initial: {regs, ram: [[0x100,0xa3],[0x101,0x00],[0x102,0x02],[0x103,0xf4]]},
        final: {regs: {ip: 0x104}, ram: [], masks: {}}, exception: null};
    const result = executeVariant(vector, {});
    assert.equal(result.status, 'fail');
    assert.ok(result.diffs.some(diff => diff.address === 0x200 && diff.actual === 0xef && diff.expected === 0));
});

test('CLI refuses missing corpus and invalid limits before producing a report', () => {
    const cli = new URL('../scripts/grind-i8086-286.mjs', import.meta.url);
    for (const [args, root, pattern] of [[[], '', /Set I80286_VECTORS/],
        [['--limit', '0'], '/unused', /invalid --limit/],
        [['--limit', 'NaN'], '/unused', /invalid --limit/]]) {
        const result = spawnSync(process.execPath, [cli.pathname, ...args],
            {encoding: 'utf8', env: {...process.env, I80286_VECTORS: root}});
        assert.equal(result.status, 2); assert.match(result.stderr, pattern); assert.equal(result.stdout, '');
    }
});
