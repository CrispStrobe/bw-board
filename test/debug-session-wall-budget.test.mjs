import test from 'node:test';
import assert from 'node:assert/strict';
import {createDebugSession} from '../src/debug-session.js';

const fake = (rate = 1_000_000, {silentHalt = false} = {}) => {
    let sim = 0n;
    let wall = 0;
    let halt = null;
    let stepping = false;
    let breakNext = false;
    const calls = [];
    const emitHalt = cause => halt?.({cause});
    return {
        calls,
        set rate (value) { rate = value; },
        breakNext: () => { breakNext = true; },
        externalHalt: () => emitHalt('external'),
        now: () => wall,
        target: {
            onHalt: fn => { halt = fn; return () => {}; },
            capabilities: () => ({}),
            position: () => null,
            reset: () => {},
            run: () => {},
            halt: () => { if (!silentHalt) emitHalt('pause'); },
            step: () => { stepping = true; },
            timeNs: () => sim,
            runFor: budget => {
                calls.push(budget);
                const used = stepping ? Math.min(100, budget) : budget;
                sim += BigInt(used);
                wall += used / rate;
                if (stepping) {
                    stepping = false;
                    emitHalt('step');
                    return 'halted';
                }
                if (breakNext) {
                    breakNext = false;
                    emitHalt('breakpoint');
                    return 'halted';
                }
                return 'budget';
            }
        },
        sim: () => Number(sim)
    };
};

test('without wallBudgetMs every existing consumer keeps the legacy one-call path', () => {
    const f = fake();
    const s = createDebugSession(f.target, {
        sliceNs: 10_000_000,
        now: () => { throw new Error('the default path must not consult a wall clock'); }
    });
    s.start();
    assert.equal(s.pump(), 'ran');
    s.setSpeed(2);
    assert.equal(s.pump(), 'ran');
    assert.deepEqual(f.calls, [10_000_000, 20_000_000],
        'one pump remains exactly one runFor call for its whole simulated-time slice');
    assert.equal(s.state().debtNs, 0, 'the opt-in debt mechanism remains inert');
});

test('a wall cap carries simulated-time debt and drains every promised ns when the host recovers', () => {
    const f = fake();
    const s = createDebugSession(f.target, {
        sliceNs: 10_000_000, wallBudgetMs: 4, maxQuantumNs: 2_000_000, now: f.now
    });
    s.start();
    assert.equal(s.pump(), 'ran');
    assert.ok(s.state().debtNs > 0, 'the capped frame must retain its unspent program time');
    s.pump();
    assert.ok(s.state().debtNs > 0, 'a second slow frame must not discard the earlier debt');
    f.rate = 100_000_000;
    s.pump();
    assert.equal(f.sim(), 30_000_000, 'recovery executes every promised nanosecond exactly once');
    assert.equal(s.state().debtNs, 0);
});

test('a step halt returns in its first quantum and clears catch-up debt', () => {
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

test('external halt, speed, step, and stop transitions cannot carry stale debt', () => {
    const f = fake();
    const s = createDebugSession(f.target, {
        sliceNs: 10_000_000, wallBudgetMs: 1, maxQuantumNs: 2_000_000, now: f.now
    });
    s.start();
    s.pump();
    assert.ok(s.state().debtNs > 0);
    f.externalHalt();
    assert.equal(s.state().debtNs, 0, 'an asynchronous halt clears pending catch-up work');

    s.resume();
    s.pump();
    assert.ok(s.state().debtNs > 0);
    s.setSpeed(2);
    assert.equal(s.state().debtNs, 0, 'a speed change starts a new timing promise');

    s.pump();
    assert.ok(s.state().debtNs > 0);
    s.step('insn');
    assert.equal(s.state().debtNs, 0, 'a step cannot inherit free-run debt');

    const quiet = fake(1_000_000, {silentHalt: true});
    const stopped = createDebugSession(quiet.target, {
        sliceNs: 10_000_000, wallBudgetMs: 1, maxQuantumNs: 2_000_000, now: quiet.now
    });
    stopped.start();
    stopped.pump();
    assert.ok(stopped.state().debtNs > 0);
    stopped.stop();
    assert.equal(stopped.state().debtNs, 0,
        'stop clears debt even when a target does not publish its halt callback');
});
