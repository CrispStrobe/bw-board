/**
 * DebugSession — the one owner of time.
 *
 * `sb3-creator/reference/debugger-ui.md` §6: with a debugger in the picture
 * there must be exactly one thing driving the emulator, or ⏸ means different
 * things depending on which tab is open. Today the Code tab's Run does a batch
 * and the Circuit tab runs its own loop; this replaces both for a debug run.
 *
 * ## Why it does not own a rAF
 *
 * bw-board has no runtime dependencies and no DOM, which is what lets it be
 * tested in Node and bundled anywhere. So the session is a state machine you
 * PUMP: the host calls `pump()` once per animation frame, and the session
 * decides how much program time to advance and when to stop. A test calls
 * `pump()` in a loop and gets the same behaviour deterministically, with no
 * timers and no waiting.
 *
 * ## Why the slice is program time, not wall time
 *
 * `runFor` is given a budget in nanoseconds of PROGRAM time — the emulator's
 * own clock. Budgeting in wall time instead would make the simulation run at a
 * speed that depends on the host's CPU, so the same project would blink at
 * different rates on different machines and a `wait 1 second` would not take
 * one second. The default slice is one frame's worth of program time, which
 * makes a simulation track real time on a host that can keep up and degrade
 * into slow motion rather than into wrong behaviour on one that cannot.
 *
 * ## What it does NOT do
 *
 * It does not touch the board. A halted MCU stops calling `advanceTo`, and the
 * board freezes because of that and nothing else — boundary A × D, settled in
 * DEBUG-CONTROL-MODEL §3.1. There is deliberately no `board.pause()` here.
 *
 * @module
 */

/** One frame at 60 Hz, in nanoseconds. */
const FRAME_NS = 16_666_667;

/**
 * Drive a DebugTarget from a host's frame loop.
 *
 * @param {object} target a DebugTarget (see emu8051-debug.js)
 * @param {object} [opts]
 * @param {number} [opts.sliceNs] program time per pump (default: one 60 Hz frame)
 * @param {number} [opts.speed] 1 = real time, 0.25 = quarter speed, 4 = fast
 * @param {number} [opts.wallBudgetMs] optional wall-time allowance for one pump
 * @param {number} [opts.maxQuantumNs] largest runFor call while wall-capped
 * @param {() => number} [opts.now] monotonic milliseconds (injectable for tests)
 * @param {(state: object) => void} [opts.onChange] called whenever the UI state changes
 */
export function createDebugSession(target, opts = {}) {
    const sliceNs = opts.sliceNs ?? FRAME_NS;
    let speed = opts.speed ?? 1;
    const onChange = opts.onChange || (() => {});
    const wallBudgetMs = Number(opts.wallBudgetMs) > 0 ? Number(opts.wallBudgetMs) : null;
    const maxQuantumNs = Math.max(1, Math.round(opts.maxQuantumNs ?? Math.min(sliceNs, 1_000_000)));
    const now = opts.now || (() => typeof performance !== 'undefined' ? performance.now() : Date.now());

    /**
     * What the USER believes is happening, which is not always what the target
     * is doing: between frames the emulator is technically halted (the budget
     * wart), and during a step it is technically running. The UI must follow
     * this, never `target.state()`.
     */
    let intent = 'stopped';       // 'stopped' | 'running' | 'paused'
    let lastHalt = null;
    let stepping = false;
    let pumps = 0;
    let debtNs = 0;
    let rateNsPerMs = null;

    const unsubscribe = target.onHalt((why) => {
        // A halt that reaches here is real: the budget one never leaves the
        // target. Whether the user asked for it (step, pause) or not
        // (breakpoint), the session is now paused and the UI should say so.
        lastHalt = why;
        stepping = false;
        debtNs = 0;
        if (intent !== 'stopped') intent = 'paused';
        emit();
    });

    function snapshot() {
        return {
            intent,
            /** True while the program is stopped somewhere the user can inspect. */
            halted: intent === 'paused',
            /** The last halt, or null. Carries Level 1 position and skewNs. */
            why: lastHalt,
            /** Where every task is, live — cheap enough to read every frame. */
            tasks: lastHalt ? lastHalt.tasks : target.position && target.position(),
            /** A step is in flight. Running, but not the same thing to a user. */
            stepping,
            speed,
            pumps,
            debtNs
        };
    }

    function emit() { onChange(snapshot()); }

    const session = {
        /** What the UI should render. Never derived from target.state(). */
        state: snapshot,

        capabilities: () => target.capabilities(),

        /** ⚑ — from a reset, or resume from a pause. */
        start() {
            // Machine-bench targets (z80/6502) may carry no reset — they
            // boot already-reset from the factory, and a CP/M program's
            // "reset state" (pc $0100) is not the CPU's. Absence means
            // "start from the state the machine is in".
            if (intent === 'stopped' && typeof target.reset === 'function') target.reset();
            debtNs = 0;
            lastHalt = null;
            intent = 'running';
            target.run();
            emit();
        },

        /** ⏸ */
        pause() {
            if (intent !== 'running') return;
            target.halt();          // fires onHalt, which sets intent = 'paused'
        },

        /** ▶ after a ⏸ */
        resume() {
            if (intent !== 'paused') return;
            debtNs = 0;
            lastHalt = null;
            intent = 'running';
            target.run();
            emit();
        },

        /**
         * ⏭ — one block by default, because that is the granularity every
         * target supports and the one a Scratch user means by "next".
         */
        step(kind = 'block', count = 1) {
            if (intent === 'stopped') {
                if (typeof target.reset === 'function') target.reset();
                intent = 'paused';
            }
            debtNs = 0;
            const refusal = target.step(kind, count);
            if (refusal) return refusal;   // {unsupported}, passed straight through
            stepping = true;
            intent = 'running';            // it IS running, for a moment
            emit();
            // A step can complete inside a single pump, or need several (a
            // `block` step runs until the next yield, which may be a whole
            // WAIT away). Pumping until it lands is the host's job, exactly as
            // it is for a free run.
            return undefined;
        },

        /** ⏹ */
        stop() {
            if (intent === 'running') target.halt();
            if (typeof target.reset === 'function') target.reset();
            intent = 'stopped';
            lastHalt = null;
            stepping = false;
            debtNs = 0;
            emit();
        },

        /** 1 = real time. Applies from the next pump. */
        setSpeed(x) { speed = Math.max(0, Number(x) || 0); debtNs = 0; emit(); },

        /**
         * Advance one frame's worth. Call from requestAnimationFrame.
         *
         * Returns what happened, so a host can stop pumping when there is
         * nothing to do: 'ran' | 'halted' | 'idle'.
         */
        pump() {
            pumps++;
            if (intent !== 'running') return 'idle';
            const budget = Math.round(sliceNs * speed);
            if (budget <= 0) return 'idle';      // paused by speed 0, legitimately
            if (wallBudgetMs === null) {
                const outcome = target.runFor(budget);
                if (outcome === 'halted') return 'halted';
                if (outcome === 'idle') {
                    intent = 'paused';
                    emit();
                    return 'idle';
                }
                return 'ran';
            }
            debtNs += budget;
            const deadline = now() + wallBudgetMs;
            let outcome = 'budget';
            let calls = 0;
            while (debtNs > 0) {
                const remainingMs = deadline - now();
                if (calls && remainingMs <= 0.25) break;
                let quantum = maxQuantumNs;
                if (rateNsPerMs !== null) {
                    quantum = Math.max(1, Math.min(maxQuantumNs,
                        Math.floor(rateNsPerMs * remainingMs * 0.8)));
                }
                quantum = Math.min(quantum, debtNs);
                const sim0 = typeof target.timeNs === 'function' ? target.timeNs() : null;
                const wall0 = now();
                outcome = target.runFor(quantum);
                const elapsed = now() - wall0;
                const sim1 = typeof target.timeNs === 'function' ? target.timeNs() : null;
                let advanced = sim0 !== null && sim1 !== null ? Number(sim1 - sim0) : quantum;
                if (!(advanced > 0) && outcome === 'budget') advanced = quantum;
                debtNs = Math.max(0, debtNs - Math.max(0, advanced));
                if (elapsed > 0 && advanced > 0) {
                    const sample = advanced / elapsed;
                    rateNsPerMs = rateNsPerMs === null ? sample : rateNsPerMs * 0.7 + sample * 0.3;
                }
                calls++;
                if (outcome === 'halted') { debtNs = 0; return 'halted'; }
                if (outcome === 'idle') {
                    debtNs = 0;
                    intent = 'paused';
                    emit();
                    return 'idle';
                }
            }
            if (outcome === 'halted') return 'halted';   // onHalt already fired
            if (outcome === 'idle') {
                // The target stopped without telling us — it was never running,
                // or something outside the session halted it. Do not pretend.
                intent = 'paused';
                emit();
                return 'idle';
            }
            return 'ran';
        },

        /** True while a step is still in flight. */
        get stepping() { return stepping; },

        destroy() { if (typeof unsubscribe === 'function') unsubscribe(); }
    };

    return session;
}
