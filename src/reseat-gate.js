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
 *     distinct values (the "edge alphabet, in order"). A board that configures
 *     a port as output before writing its first data byte emits one leading
 *     all-dark edge; that settle edge is an equivalent, not a mismatch, so it
 *     is dropped by default (keepLeadingSettle to demand it).
 */

/**
 * Run one board and capture its change-sampled observable.
 *
 * @param {() => { step: () => unknown }} buildMachine  returns a freshly
 *        constructed, ROM-loaded, reset machine ready to step.
 * @param {object} opts
 * @param {(m: any) => number} opts.read   the observable byte for a machine at
 *        rest between steps (e.g. a port's driven output pins).
 * @param {number} opts.steps              how many steps to run.
 * @returns {{ step: number, value: number }[]}  one row per change; the first
 *          row is the value after step 1.
 */
export function captureObservable(buildMachine, { read, steps }) {
    const m = buildMachine();
    const trace = [];
    let last = -1;
    for (let step = 1; step <= steps; step++) {
        m.step();
        const value = read(m) & 0xff;
        if (value !== last) {
            trace.push({ step, value });
            last = value;
        }
    }
    return trace;
}

/** The ordered distinct values of a trace — its shape ("edge alphabet"). */
function alphabet(trace) {
    const seen = [];
    for (const { value } of trace) if (!seen.includes(value)) seen.push(value);
    return seen;
}

/**
 * Compare two observables. Default is SHAPE (ordered distinct values), which is
 * the right comparison across CPU families that do not share a cycle budget.
 *
 * @param {{step:number,value:number}[]} original
 * @param {{step:number,value:number}[]} reseated
 * @param {object} [opts]
 * @param {boolean} [opts.keepLeadingSettle=false]  include the leading all-dark
 *        settle edge (a port configured output before its first data write).
 *        Off by default: it is an equivalent, not a mismatch.
 * @returns {{ match: boolean, expected: number[], actual: number[],
 *             firstDivergence: number|null, reason: string }}
 */
export function compareObservables(original, reseated, opts = {}) {
    const { keepLeadingSettle = false } = opts;
    const shape = (t) => {
        const a = alphabet(t);
        return !keepLeadingSettle && a.length && a[0] === 0 ? a.slice(1) : a;
    };
    const expected = shape(original);
    const actual = shape(reseated);

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
 * @param {object} original  { build, read, steps }
 * @param {object} reseated  { build, read, steps? }  (steps defaults to original's)
 * @param {object} [opts]    passed to compareObservables
 * @returns {{ verdict: 'MATCH'|'DIFFER', reason: string,
 *             expected: number[], actual: number[],
 *             originalTrace: object[], reseatedTrace: object[] }}
 */
export function reseatGate(original, reseated, opts = {}) {
    const originalTrace = captureObservable(original.build, { read: original.read, steps: original.steps });
    const reseatedTrace = captureObservable(reseated.build, { read: reseated.read, steps: reseated.steps ?? original.steps });
    const cmp = compareObservables(originalTrace, reseatedTrace, opts);
    return {
        verdict: cmp.match ? 'MATCH' : 'DIFFER',
        reason: cmp.reason,
        expected: cmp.expected,
        actual: cmp.actual,
        originalTrace,
        reseatedTrace,
    };
}
