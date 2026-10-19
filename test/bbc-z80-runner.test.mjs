// BbcZ80Runner against the real BBCBASIC.COM (rtrussell/BBCZ80, zlib —
// shippable, but not vendored in this repo; sibling checkout, skip
// loudly when absent — clone recipe in scripts/bbcz80-smoke.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { BbcZ80Runner } from '../src/bbc-z80-runner.js';

const COM_PATH = process.env.BBCZ80_COM
    || join(homedir(), 'code', 'BBCZ80', 'bin', 'cpm', 'BBCBASIC.COM');
const com = existsSync(COM_PATH) ? readFileSync(COM_PATH) : null;

const run = (program, opts) => new BbcZ80Runner({ com })
    .start(program, opts).runToCompletion();

test('PRINT 2+2 prints 4', (t) => {
    if (!com) { t.skip(`no BBCBASIC.COM at ${COM_PATH}`); return; }
    const r = run('10 PRINT 2+2');
    assert.equal(r.reason, 'ok');
    assert.match(r.output, /\b4\b/);
});

test('FOR loop output arrives in order', (t) => {
    if (!com) { t.skip('no COM'); return; }
    const r = run('10 FOR I=1 TO 3\n20 PRINT I*I\n30 NEXT I');
    assert.equal(r.reason, 'ok');
    const nums = r.output.match(/\d+/g).map(Number);
    assert.deepEqual(nums, [1, 4, 9]);
});

test('infinite loop hits the budget with partial output', (t) => {
    if (!com) { t.skip('no COM'); return; }
    const r = run('10 PRINT "X"\n20 GOTO 10', { maxSteps: 30_000_000 });
    assert.equal(r.reason, 'budget');
    assert.ok((r.output.match(/X/g) || []).length >= 3,
        `expected repeated X output, got: ${JSON.stringify(r.output.slice(0, 120))}`);
});

test('INPUT consumes scripted answers', (t) => {
    if (!com) { t.skip('no COM'); return; }
    const r = run('10 INPUT A\n20 PRINT A*2', { inputs: ['21'] });
    assert.equal(r.reason, 'ok');
    assert.match(r.output, /\b42\b/);
});

test('INPUT with no answers left ends as input-exhausted, not a hang', (t) => {
    if (!com) { t.skip('no COM'); return; }
    const r = run('10 PRINT "BEFORE"\n20 INPUT A\n30 PRINT "AFTER"');
    assert.equal(r.reason, 'input-exhausted');
    assert.match(r.output, /BEFORE/);
    assert.doesNotMatch(r.output, /AFTER/);
});

test('an error is a result, not a failure', (t) => {
    if (!com) { t.skip('no COM'); return; }
    const r = run('10 PRNT "OOPS"');
    assert.equal(r.reason, 'ok');
    assert.match(r.output, /Mistake|Syntax error/i);
});

test('pump() reports incremental output before completion', (t) => {
    if (!com) { t.skip('no COM'); return; }
    const runner = new BbcZ80Runner({ com })
        .start('10 PRINT "A"\n20 GOTO 10', { maxSteps: 30_000_000 });
    let sawPartial = false;
    let r;
    do {
        r = runner.pump(500_000);
        if (!r.done && r.output.includes('A')) sawPartial = true;
    } while (!r.done);
    assert.ok(sawPartial, 'output must be visible while still running');
});
