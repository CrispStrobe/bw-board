/**
 * reseat-gate.js — the reseat gate (ROADMAP §3.8.3), the bw-board half.
 *
 * The owner's ask: an example drawn around one CPU can be RESEATED onto an 8086
 * in the schematic, and still be the same board. "Same board" needs a
 * definition that can FAIL — otherwise "substitute a subsystem" is unbounded.
 * This gate is that definition, and it is written against BEHAVIOUR, not the
 * netlist:
 *
 *   A gate on the netlist ("the reseated circuit has a CPU, an 8255 and a
 *   decoder") passes the moment you write it and cannot fail for the reason
 *   that matters. The gate worth having runs BOTH boards on the SAME program
 *   and demands the SAME OBSERVABLE EDGE SEQUENCE.
 *
 * bw-board is where the gate lives because it is the only place all three
 * extractors AND all three machines coexist; the SUBSTITUTION (circuit →
 * circuit) is bw-circuit-ui's half. This module is deliberately family-agnostic
 * — it never names 6502 or 8086; a caller supplies `buildMachine` and a `read`
 * that returns the observable byte, and the gate compares the resulting edge
 * sequences. That is what lets a W65C22 port and an 8255 port be compared at
 * all.
 *
 * Contract (settled with lego-47, 2026-09-04; see bw-circuit-ui/RESEAT-GATE.md):
 *  #1 Sample on CHANGE, not on a clock. Record (step, value) whenever the
 *     observable byte changes; compare the EDGE SEQUENCE. A clock-sampled trace
 *     hides sub-period rate differences — don't.
 *  Shape vs timing. Two boards reseated across families do NOT share a cycle
 *     budget, so the DEFAULT comparison is SHAPE: the ordered sequence of
 *     distinct values (the "edge alphabet, in order"). Rate is NOT compared by
 *     default (a quarter-speed reseat passes shape) — the caller gets each
 *     board's cadence in the result and can assert on it once it has a shared
 *     time base; see RESEAT-GATE.md. This must not silently become the
 *     definition of "same observable" as the gate generalises.
 *  The settle edge, tied to the DIRECTION write that causes it (lego-47).
 *     The observable is only meaningful once the port is an OUTPUT: before the
 *     direction/mode write the pins are inputs, not "0". So `read` returns
 *     {out, dir}; capture ignores samples while dir is all-input, and the FIRST
 *     value once the port goes live is the baseline, not an edge — UNLESS it is
 *     already nonzero (a data write landed with or before the direction write).
 *     A program whose first real data byte is genuinely 0x00 therefore still
 *     produces that edge; the drop is an explanation (port just became output,
 *     latch still at reset), not a rule that keys off value 0 at position 0.
 */

/**
 * Run one board and capture its change-sampled observable.
 *
 * The observable is a PORT: `read` returns {out, dir} (the output latch and the
 * direction mask). The recorded value is `out & dir` — only driven pins. While
 * the port is all-input (dir === 0) nothing is recorded: the pins are not "0",
 * they are simply not yet the observable. The first live sample is the baseline
 * (recorded only if already nonzero); every change after is an edge. This ties
 * the leading all-dark settle to the direction write instead of to a value.
 *
 * @param {() => { step: () => unknown }} buildMachine  returns a freshly
 *        constructed, ROM-loaded, reset machine ready to step.
 * @param {object} opts
 * @param {(m: any) => {out: number, dir: number}} opts.read  the observable
 *        port for a machine at rest between steps.
 * @param {number} opts.steps              how many steps to run.
 * @returns {{ step: number, value: number }[]}  one row per change.
 */
export function captureObservable(buildMachine, { read, steps }) {
    const m = buildMachine();
    const trace = [];
    let last = -1;
    let live = false;
    for (let step = 1; step <= steps; step++) {
        m.step();
        const { out, dir } = read(m);
        if (!dir) continue;              // port still all-input: not observable yet
        const value = out & dir & 0xff;
        const tMs = typeof m.tMs === 'number' ? m.tMs : null; // real-time base, if the machine has a clock
        if (!live) {                     // port just became an output: baseline
            live = true;
            last = value;
            if (value !== 0) trace.push({ step, value, tMs }); // data already present
            continue;
        }
        if (value !== last) {
            trace.push({ step, value, tMs });
            last = value;
        }
    }
    return trace;
}

/**
 * Cadence of a trace: edge count, mean inter-edge interval in STEPS, and — when
 * the machine carries a clock — the mean interval in real TIME (ms). The step
 * interval is not comparable across CPU families; the time interval IS, which is
 * what the optional timing gate compares.
 */
function cadence(trace) {
    if (trace.length < 2) return { edges: trace.length, meanInterval: null, meanTimeMs: null };
    const stepSpan = trace[trace.length - 1].step - trace[0].step;
    const t0 = trace[0].tMs, t1 = trace[trace.length - 1].tMs;
    const timeSpan = (typeof t0 === 'number' && typeof t1 === 'number') ? t1 - t0 : null;
    return {
        edges: trace.length,
        meanInterval: stepSpan / (trace.length - 1),
        meanTimeMs: timeSpan == null ? null : timeSpan / (trace.length - 1),
    };
}

/** The ordered distinct values of a trace — its shape ("edge alphabet"). */
function alphabet(trace) {
    const seen = [];
    for (const { value } of trace) if (!seen.includes(value)) seen.push(value);
    return seen;
}

/**
 * Compare two observables by SHAPE — the ordered distinct values ("edge
 * alphabet, in order"). This is the right comparison across CPU families that
 * do not share a cycle budget. The leading all-dark settle is already excluded
 * upstream in captureObservable (tied to the direction write), so this is a
 * straight sequence comparison. Rate is deliberately NOT compared here — see
 * reseatGate's cadence report and RESEAT-GATE.md.
 *
 * @param {{step:number,value:number}[]} original
 * @param {{step:number,value:number}[]} reseated
 * @returns {{ match: boolean, expected: number[], actual: number[],
 *             firstDivergence: number|null, reason: string }}
 */
export function compareObservables(original, reseated) {
    const expected = alphabet(original);
    const actual = alphabet(reseated);

    let firstDivergence = null;
    const n = Math.max(expected.length, actual.length);
    for (let i = 0; i < n; i++) {
        if (expected[i] !== actual[i]) { firstDivergence = i; break; }
    }
    const match = firstDivergence === null;

    const hex = (v) => (v === undefined ? '—' : '0x' + v.toString(16).padStart(2, '0'));
    let reason;
    if (match) {
        reason = `match: ${expected.length} distinct values in the same order`;
    } else if (actual.length === 0) {
        reason = 'reseated board produced NO edges — the program drives a port the '
            + 'reseat did not wire to the observable (nothing lights)';
    } else {
        reason = `diverge at edge ${firstDivergence}: expected ${hex(expected[firstDivergence])}, `
            + `got ${hex(actual[firstDivergence])}`;
    }
    return { match, expected, actual, firstDivergence, reason };
}

/**
 * The gate: run an original board and a reseated board on the same program,
 * capture each observable, and report whether the reseat preserved behaviour.
 *
 * @param {object} original  { build, read, steps }  read: (m) => {out, dir}
 * @param {object} reseated  { build, read, steps? }  (steps defaults to original's)
 * @param {object} [opts]
 * @param {object} [opts.timing]  enable the BEHAVIOURAL rate gate (off by
 *        default). `{ tolerance = 0.25, expectedRatio = 1 }`: shape alone cannot
 *        see a reseat that lights the right LEDs at the wrong SPEED, so with a
 *        shared time base (both boards' edges timestamped in real ms) this
 *        additionally requires the reseat's real-time cadence to be
 *        expectedRatio× the original's, within tolerance. A reseat that walks
 *        the right sequence at a quarter the rate then goes RED, where shape
 *        alone stays green. Cross-family the boards do not share a clock, so
 *        `expectedRatio` is the caller's model of what "same speed" means; same
 *        board at a wrong clock uses the default 1.
 * @returns {{ verdict: 'MATCH'|'DIFFER', reason: string,
 *             expected: number[], actual: number[], cadence: object,
 *             timing: object|null, originalTrace: object[], reseatedTrace: object[] }}
 */
export function reseatGate(original, reseated, opts = {}) {
    const originalTrace = captureObservable(original.build, { read: original.read, steps: original.steps });
    const reseatedTrace = captureObservable(reseated.build, { read: reseated.read, steps: reseated.steps ?? original.steps });
    const cmp = compareObservables(originalTrace, reseatedTrace);
    const cad = { original: cadence(originalTrace), reseated: cadence(reseatedTrace) };

    let verdict = cmp.match ? 'MATCH' : 'DIFFER';
    let reason = cmp.reason;

    // Behavioural (rate) gate — opt-in, and only meaningful once the shape
    // already matches (a rate check on a wrong sequence is noise).
    let timing = null;
    if (opts.timing && cmp.match) {
        const tolerance = opts.timing.tolerance ?? 0.25;
        const expectedRatio = opts.timing.expectedRatio ?? 1;
        const o = cad.original.meanTimeMs, r = cad.reseated.meanTimeMs;
        if (o == null || r == null || o === 0) {
            timing = { ok: null, reason: 'no shared time base — a machine has no clock (meanTimeMs null)' };
        } else {
            const ratio = r / o;
            const ok = ratio >= expectedRatio * (1 - tolerance) && ratio <= expectedRatio * (1 + tolerance);
            timing = { ok, ratio, expectedRatio, tolerance, originalMs: o, reseatedMs: r };
            if (!ok) {
                verdict = 'DIFFER';
                reason = `shape matches but RATE differs: reseat walks at ${ratio.toFixed(2)}× the original's `
                    + `real-time cadence (${r.toFixed(3)}ms vs ${o.toFixed(3)}ms per edge; expected ${expectedRatio}× ±${Math.round(tolerance * 100)}%)`;
            }
        }
    }
    return { verdict, reason, expected: cmp.expected, actual: cmp.actual, cadence: cad, timing, originalTrace, reseatedTrace };
}
