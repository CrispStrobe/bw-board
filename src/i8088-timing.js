/**
 * Cycle prediction for the 8088, over the generated tables in i8088-cycles.js.
 *
 * THE SPLIT IS DELIBERATE: `i8088-cycles.js` is GENERATED DATA, overwritten
 * wholesale by scripts/gen-i8088-cycle-tables.mjs. This file is hand-written
 * LOGIC. Putting the lookup in the generated file would mean every
 * regeneration re-emitted, and could silently revert, hand-edited code.
 *
 * TWO TABLES, AND THE SECOND IS WHAT MAKES THIS USABLE AT ALL:
 *
 *   TABLES[op].t   (queue, length, accesses, modrm, taken, operand) -> cycles
 *   TABLES[op].q   (queue, length, cycles, taken)                   -> next queue
 *
 * The cycle table is keyed on prefetch queue length. Our core models no queue
 * (i8086.js says so explicitly), and supplying a constant for it costs 48
 * points -- 98.0% falls to 50.0%, measured. So the queue must be CARRIED, and
 * the second table is the recurrence that carries it.
 *
 * Held out, 70/30 within each opcode, over 902,100 vectors:
 *
 *   cycles          98.00%
 *   next queue      99.81%
 *
 * The obvious closed form for the queue -- q - len + floor(cycles/4), clamped,
 * zeroed on a taken branch -- scores 33.22%. It is a table for the same reason
 * the cycle model is.
 *
 * DESYNCHRONISATION IS THE REAL HAZARD, and it is handled explicitly. A missed
 * prediction does not merely lose one instruction: the queue stops being
 * known, so every LATER prediction is computed from a wrong queue and is
 * silently wrong rather than absent. So a miss marks the estimator desynced
 * and it returns null until it can resynchronise -- and there is exactly one
 * event after which the queue is known regardless of history: a TAKEN BRANCH
 * flushes it. That is not a heuristic; it is what the hardware does.
 */
import { TABLES, PROVENANCE } from './i8088-cycles.js';

export { PROVENANCE };

const popcount = (v) => { let n = 0; while (v) { n += v & 1; v >>>= 1; } return n; };
const absw = (v) => ((v & 0x8000) ? (-v & 0xffff) : v);

/**
 * CATEGORICAL operand terms: the value selects a different constant. MUL loops
 * over the bits of AX, the IMPLICIT operand -- keying on the source operand
 * instead scores 15.7%, i.e. nothing, and reads as "this feature does not
 * exist".
 */
const CATEGORICAL = {
    'F7.4': (ax) => popcount(ax),
    'F6.4': (ax) => popcount(ax & 0xff),
    'F7.5': (ax) => popcount(absw(ax)) * 2 + ((ax >> 15) & 1),
    'F6.5': (ax) => popcount(ax & 0xff),
    '99':   (ax) => (ax >> 15) & 1,
};

/**
 * LINEAR operand term: adds cycles proportionally. Datasheet gives shift or
 * rotate by CL as 8+4n / 20+EA+4n and measurement confirms exactly 4 per
 * count. Keying on CL *categorically* instead scores 57% -- a 19x improvement
 * over ignoring it, and still 42 points short, because it fragments the table
 * across 64 CL values. See VERIFICATION.md, "a large improvement is not
 * evidence of the right model".
 */
const SHIFT_BY_CL = (ax, cx) => 4 * (cx & 0xff);
const LINEAR = {};
for (let ext = 0; ext < 8; ext++) {
    LINEAR[`D2.${ext}`] = SHIFT_BY_CL;
    LINEAR[`D3.${ext}`] = SHIFT_BY_CL;
}

/** True when the tables cover this opcode key at all. */
export const covered = (opcode) => Object.hasOwn(TABLES, opcode);

/**
 * The generator keys on the instruction's SECOND BYTE -- after prefixes and
 * the opcode -- for every opcode, not only those with a real modrm. For
 * `33 C0` that byte is a modrm; for `B8 00 00` it is half an immediate. The
 * table encodes whichever it was, so callers pass the packed `slot` directly
 * and 32 means "the instruction had no second byte".
 */
const packSlot = (b) =>
    (b === undefined || b === null) ? 32 : ((b >> 6) << 3) | (b & 7);

/**
 * Cycles for one instruction, given the queue length before it.
 *
 * PRIMITIVE ARGUMENTS, NOT AN OPTIONS OBJECT, AND THE REASON IS MEASURED.
 * The first version took `{queue, length, accesses, slot, taken, regs}` and
 * CycleEstimator called it as `predictCycles(op, {...s, queue: this.queue})`.
 * That spread cost **8,016 ns per call** against 791 ns for the two table
 * lookups it wrapped -- ten times more than the work it was arranging. An
 * options object allocated per instruction, with a nested `regs` object and a
 * shape that varies by call site, is not free in a loop this hot.
 *
 * Returns null when this case was never measured. Callers MUST handle that
 * rather than coerce: a missing key means "not measured", and turning it into
 * a plausible number is how an unmeasured case becomes an asserted one.
 */
export function predictCycles(opcode, queue, length, accesses, slot, taken, ax, cx) {
    const T = TABLES[opcode];
    if (T === undefined) return null;
    const cat = CATEGORICAL[opcode];
    const lin = LINEAR[opcode];
    const v = cat === undefined ? 0 : cat(ax, cx);
    const L = lin === undefined ? 0 : lin(ax, cx);
    const base = T.t[`${queue},${length},${accesses},${slot},${taken ? 1 : 0},${v}`];
    return base === undefined ? null : base + L;
}

/**
 * Queue length after an instruction, given the length before it and the cycles
 * it actually took. Returns null when unmeasured.
 */
export function predictNextQueue(opcode, queue, length, cycles, taken) {
    const T = TABLES[opcode];
    if (T === undefined || T.q === undefined) return null;
    const n = T.q[`${queue},${length},${cycles},${taken ? 1 : 0}`];
    return n === undefined ? null : n;
}

/**
 * Carries the prefetch queue across instructions so the cycle table can be
 * used by a running machine.
 *
 * Starts DESYNCED. The queue is genuinely unknown before the first flush, and
 * assuming an initial value would make every early prediction quietly wrong.
 * `reset()` after a jump, or the first taken branch, synchronises it.
 */
export class CycleEstimator {
    constructor() {
        this.queue = 0;
        this.desynced = true;
        this.hits = 0;
        this.misses = 0;
        this.resyncs = 0;
    }

    /** A taken branch flushes the queue, so the state is known again. */
    reset() {
        this.queue = 0;
        if (this.desynced) this.resyncs++;
        this.desynced = false;
    }

    /**
     * @returns {number|null} cycles, or null when unmeasured OR desynced.
     * A null is a signal to fall back to the core's own count -- never to
     * substitute a guess.
     */
    step(opcode, length, accesses, slot, taken, ax, cx) {
        if (this.desynced) {
            // Nothing can be predicted from an unknown queue. A taken branch
            // still restores the state for NEXT time, which is the only way
            // out short of an explicit reset().
            this.misses++;
            if (taken) this.reset();
            return null;
        }
        const cycles = predictCycles(
            opcode, this.queue, length, accesses, slot, taken, ax, cx);
        if (cycles === null) {
            this.misses++;
            // The queue can no longer be advanced, so it is no longer known.
            if (taken) this.reset(); else this.desynced = true;
            return null;
        }
        const next = predictNextQueue(opcode, this.queue, length, cycles, taken);
        this.hits++;
        if (next === null) {
            if (taken) this.reset(); else this.desynced = true;
        } else {
            this.queue = next;
        }
        return cycles;
    }
}
