import test from 'node:test';
import assert from 'node:assert/strict';
import {createDebugSession} from '../src/debug-session.js';

const fake = (rate = 1_000_000) => {
    let sim = 0n;
    let wall = 0;
    let halt = null;
    let stepping = false;
    let breakNext = false;
    const calls = [];
    return {
        calls,
        set rate (value) { rate = value; },
        breakNext: () => { breakNext = true; },
        now: () => wall,
        target: {
            onHalt: fn => { halt = fn; return () => {}; },
            capabilities: () => ({}), position: () => null,
            reset: () => {}, run: () => {}, halt: () => halt({cause: 'pause'}),
            step: () => { stepping = true; },
            timeNs: () => sim,
            runFor: budget => {
                calls.push(budget);
                const used = stepping ? Math.min(100, budget) : budget;
                sim += BigInt(used);
                wall += used / rate;
                if (stepping) { stepping = false; halt({cause: 'step'}); return 'halted'; }
                if (breakNext) { breakNext = false; halt({cause: 'breakpoint'}); return 'halted'; }
                return 'budget';
            }
        },
        sim: () => Number(sim)
    };
};

test('the default path remains one full simulated-time slice', () => {
    const f = fake();
    const s = createDebugSession(f.target, {sliceNs: 10_000_000});
    s.start();
    assert.equal(s.pump(), 'ran');
    assert.deepEqual(f.calls, [10_000_000]);
});

test('a wall cap carries simulated-time debt and drains it when the host recovers', () => {
    const f = fake();
    const s = createDebugSession(f.target, {
        sliceNs: 10_000_000, wallBudgetMs: 4, maxQuantumNs: 2_000_000, now: f.now
    });
    s.start();
    assert.equal(s.pump(), 'ran');
    assert.ok(s.state().debtNs > 0, 'the capped frame must retain its unspent program time');
    s.pump();
    assert.ok(s.state().debtNs > 0);
    f.rate = 100_000_000;
    s.pump();
    assert.equal(f.sim(), 30_000_000, 'recovery executes every promised nanosecond exactly once');
    assert.equal(s.state().debtNs, 0);
});

test('a step halt returns immediately and discards no catch-up work into the pause', () => {
    const f = fake();
    const s = createDebugSession(f.target, {
        sliceNs: 10_000_000, wallBudgetMs: 4, maxQuantumNs: 2_000_000, now: f.now
    });
    s.step('insn');
    assert.equal(s.pump(), 'halted');
    assert.equal(f.calls.length, 1);
    assert.equal(f.sim(), 100);
    assert.equal(s.state().debtNs, 0);
    assert.equal(s.state().halted, true);
});

test('a breakpoint halt stops the adaptive loop in the same quantum', () => {
    const f = fake();
    const s = createDebugSession(f.target, {
        sliceNs: 10_000_000, wallBudgetMs: 4, maxQuantumNs: 2_000_000, now: f.now
    });
    s.start();
    f.breakNext();
    assert.equal(s.pump(), 'halted');
    assert.equal(f.calls.length, 1, 'no work may run after the halt callback');
    assert.equal(s.state().why.cause, 'breakpoint');
    assert.equal(s.state().debtNs, 0);
});
