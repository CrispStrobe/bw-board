// BasicMachineRunner against the real MS BASIC 1.1 ROM (basic-m6502-bw,
// sibling checkout — MIT, but not vendored here; the suite skips loudly
// when the ROM is absent, same pattern as the vector suites).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { BasicMachineRunner } from '../src/basic-machine-runner.js';

const ROM_PATH = process.env.BASIC_ROM
    || join(homedir(), 'code', 'basic-m6502-bw', 'basic.rom');
const rom = existsSync(ROM_PATH) ? readFileSync(ROM_PATH) : null;

const run = (program, opts) => new BasicMachineRunner({ rom })
    .start(program, opts).runToCompletion();

test('PRINT 2+2 prints 4', (t) => {
    if (!rom) { t.skip(`no ROM at ${ROM_PATH}`); return; }
    const r = run('10 PRINT 2+2');
    assert.equal(r.reason, 'ok');
    assert.match(r.output, /\b4\b/);
});

test('FOR loop output arrives in order', (t) => {
    if (!rom) { t.skip('no ROM'); return; }
    const r = run('10 FOR I=1 TO 3\n20 PRINT I*I\n30 NEXT I');
    assert.equal(r.reason, 'ok');
    const nums = r.output.match(/\d+/g).map(Number);
    assert.deepEqual(nums, [1, 4, 9]);
});

test('infinite loop hits the budget with partial output', (t) => {
    if (!rom) { t.skip('no ROM'); return; }
    const r = run('10 PRINT "X"\n20 GOTO 10', { maxMs: 8000 });
    assert.equal(r.reason, 'budget');
    assert.ok((r.output.match(/X/g) || []).length >= 3,
        `expected repeated X output, got: ${JSON.stringify(r.output.slice(0, 120))}`);
});

test('INPUT consumes scripted answers', (t) => {
    if (!rom) { t.skip('no ROM'); return; }
    const r = run('10 INPUT A\n20 PRINT A*2', { inputs: ['21'] });
    assert.equal(r.reason, 'ok');
    assert.match(r.output, /\b42\b/);
});

test('INPUT with no answers left ends as input-exhausted, not a hang', (t) => {
    if (!rom) { t.skip('no ROM'); return; }
    const r = run('10 PRINT "BEFORE"\n20 INPUT A\n30 PRINT "AFTER"', { maxMs: 20000 });
    assert.equal(r.reason, 'input-exhausted');
    assert.match(r.output, /BEFORE/);
    assert.doesNotMatch(r.output, /AFTER/);
});

test('a syntax error is a result, not a failure', (t) => {
    if (!rom) { t.skip('no ROM'); return; }
    const r = run('10 PRNT "OOPS"');
    assert.equal(r.reason, 'ok');
    // MS BASIC 1.1 error codes are two letters: ?SN ERROR IN 10 (measured)
    assert.match(r.output, /\?SN ERROR IN\s+10/);
});

test('pump() reports incremental output before completion', (t) => {
    if (!rom) { t.skip('no ROM'); return; }
    const runner = new BasicMachineRunner({ rom })
        .start('10 PRINT "A"\n20 GOTO 10', { maxMs: 6000 });
    let sawPartial = false;
    let r;
    do {
        r = runner.pump(50);
        if (!r.done && r.output.includes('A')) sawPartial = true;
    } while (!r.done);
    assert.ok(sawPartial, 'output must be visible while still running');
});
