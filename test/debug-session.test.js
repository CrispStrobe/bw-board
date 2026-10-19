/**
 * The session — the one owner of time.
 *
 * Driven against a FAKE target, deliberately: what is under test is the state
 * machine a UI binds to (what ⚑ ⏸ ⏭ ⏹ mean, and what `halted` says while each
 * of them is in flight), not the emulator. The emulator has its own suite next
 * door, and mixing the two would make a failure here ambiguous.
 *
 * The fake is written to the same contract, including the awkward parts: a step
 * does not complete inside the call that arms it, and a budgeted run reports
 * 'budget' without ever looking like a halt.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createDebugSession } from '../src/debug-session.js';

function fakeTarget({ haltAfterNs = null, stepAfterPumps = 1 } = {}) {
    let listeners = [];
    let running = false;
    let tNs = 0n;
    let stepsLeft = 0;
    const calls = [];

    const emit = (cause) => {
        running = false;
        const why = { cause, pc: 0x1234, tasks: [{ task: 'bw_task0', state: 2 }], tNs, skewNs: 0n };
        for (const cb of listeners) cb(why);
    };

    return {
        calls,
        capabilities: () => ({ steps: ['insn', 'block'], breakpoints: ['yield'] }),
        state: () => (running ? 'running' : 'halted'),
        run() { calls.push('run'); running = true; },
        halt() { calls.push('halt'); if (running) emit('user'); },
        reset() { calls.push('reset'); running = false; tNs = 0n; stepsLeft = 0; },
        step(kind) {
            calls.push(`step:${kind}`);
            if (kind === 'line') return { unsupported: 'no line table' };
            stepsLeft = stepAfterPumps;
            running = true;
            return undefined;
        },
        position: () => [{ task: 'bw_task0', state: 0 }],
        timeNs: () => tNs,
        onHalt(cb) { listeners.push(cb); return () => { listeners = listeners.filter((f) => f !== cb); }; },
        runFor(ns) {
            calls.push(`runFor:${ns}`);
            if (!running) return 'idle';
            tNs += BigInt(ns);
            if (stepsLeft > 0 && --stepsLeft === 0) { emit('step'); return 'halted'; }
            if (haltAfterNs !== null && tNs >= BigInt(haltAfterNs)) { emit('breakpoint'); return 'halted'; }
            return 'budget';
        }
    };
}

describe('session: what the UI renders is intent, not the target state', () => {
    it('starts stopped, and ⚑ resets before running', () => {
        const t = fakeTarget();
        const s = createDebugSession(t);
        assert.equal(s.state().intent, 'stopped');
        s.start();
        assert.deepEqual(t.calls, ['reset', 'run']);
        assert.equal(s.state().intent, 'running');
        assert.equal(s.state().halted, false);
    });

    it('stays "running" across frames even though the emulator halts each time', () => {
        // The budget wart is absorbed below this line, but the session must not
        // reintroduce it by consulting target.state() — between pumps a real
        // emulator IS halted, and a UI that read that would flicker.
        const t = fakeTarget();
        const s = createDebugSession(t);
        s.start();
        for (let i = 0; i < 5; i++) {
            assert.equal(s.pump(), 'ran');
            assert.equal(s.state().intent, 'running');
            assert.equal(s.state().halted, false);
        }
    });

    it('⏸ pauses, and the pause is what the UI shows', () => {
        const t = fakeTarget();
        const s = createDebugSession(t);
        s.start();
        s.pump();
        s.pause();
        assert.equal(s.state().intent, 'paused');
        assert.equal(s.state().halted, true);
        assert.equal(s.state().why.cause, 'user');
        assert.equal(s.pump(), 'idle', 'and nothing advances while paused');
    });

    it('▶ resumes from a pause without resetting', () => {
        const t = fakeTarget();
        const s = createDebugSession(t);
        s.start(); s.pump(); s.pause();
        t.calls.length = 0;
        s.resume();
        assert.deepEqual(t.calls, ['run'], 'no reset — that would restart the program');
        assert.equal(s.state().halted, false);
    });

    it('⏹ stops and resets, so the next ⚑ starts from the beginning', () => {
        const t = fakeTarget();
        const s = createDebugSession(t);
        s.start(); s.pump();
        s.stop();
        assert.equal(s.state().intent, 'stopped');
        assert.equal(s.state().why, null);
        assert.ok(t.calls.includes('reset'));
    });
});

describe('session: stepping', () => {
    it('a step ends in a pause, with the position to glow', () => {
        const t = fakeTarget({ stepAfterPumps: 2 });
        const s = createDebugSession(t);
        s.start();
        s.step();
        assert.equal(s.stepping, true);
        assert.equal(s.state().intent, 'running', 'a step really does run, briefly');
        assert.equal(s.pump(), 'ran', 'and may need more than one frame to land');
        assert.equal(s.pump(), 'halted');
        assert.equal(s.stepping, false);
        assert.equal(s.state().halted, true);
        assert.equal(s.state().why.cause, 'step');
        assert.deepEqual(s.state().tasks, [{ task: 'bw_task0', state: 2 }]);
    });

    it('block is the default, because that is what "next" means in blocks', () => {
        const t = fakeTarget();
        const s = createDebugSession(t);
        s.start();
        s.step();
        assert.ok(t.calls.includes('step:block'));
    });

    it('a refused step is passed straight through, and changes nothing', () => {
        const t = fakeTarget();
        const s = createDebugSession(t);
        s.start(); s.pump(); s.pause();
        const r = s.step('line');
        assert.ok(r && r.unsupported, 'the caller can show the reason');
        assert.equal(s.state().intent, 'paused', 'and the session did not start running');
        assert.equal(s.stepping, false);
    });

    it('stepping from stopped resets first, so it steps the program from the top', () => {
        const t = fakeTarget();
        const s = createDebugSession(t);
        s.step('insn');
        assert.equal(t.calls[0], 'reset');
    });
});

describe('session: breakpoints and speed', () => {
    it('a breakpoint pauses the session and carries its reason', () => {
        const t = fakeTarget({ haltAfterNs: 40_000_000 });
        const s = createDebugSession(t);
        s.start();
        let outcome;
        for (let i = 0; i < 10 && outcome !== 'halted'; i++) outcome = s.pump();
        assert.equal(outcome, 'halted');
        assert.equal(s.state().halted, true);
        assert.equal(s.state().why.cause, 'breakpoint');
        assert.equal(s.state().why.pc, 0x1234);
    });

    it('speed scales the slice, and 0 stops advancing without pretending to pause', () => {
        const t = fakeTarget();
        const s = createDebugSession(t, { sliceNs: 1_000_000 });
        s.start();
        s.pump();
        assert.ok(t.calls.includes('runFor:1000000'));

        s.setSpeed(4);
        s.pump();
        assert.ok(t.calls.includes('runFor:4000000'));

        s.setSpeed(0);
        assert.equal(s.pump(), 'idle');
        assert.equal(s.state().intent, 'running', 'still a run, just not moving');
        assert.equal(s.state().halted, false, 'and NOT reported as halted — nothing stopped it');
    });

    it('onChange fires for every transition a UI has to redraw', () => {
        const seen = [];
        const t = fakeTarget({ stepAfterPumps: 1 });
        const s = createDebugSession(t, { onChange: (st) => seen.push(st.intent) });
        s.start();
        s.pause();
        s.resume();
        s.step();
        s.pump();
        s.stop();
        assert.deepEqual(seen, ['running', 'paused', 'running', 'running', 'paused', 'stopped']);
    });
});

describe('session: it does not touch the board', () => {
    it('has no board reference at all', () => {
        // Boundary A × D: a halted MCU stops calling advanceTo and the board
        // freezes because of that, not because anything told it to. A pause()
        // on the board would be a second, competing owner of time.
        const s = createDebugSession(fakeTarget());
        assert.equal(s.board, undefined);
        assert.ok(!Object.keys(s).some((k) => /board|advance/i.test(k)));
    });
});
