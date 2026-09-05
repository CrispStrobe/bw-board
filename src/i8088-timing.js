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
    'F7.4': (r) => popcount(r.ax),
    'F6.4': (r) => popcount(r.ax & 0xff),
    'F7.5': (r) => popcount(absw(r.ax)) * 2 + ((r.ax >> 15) & 1),
    'F6.5': (r) => popcount(r.ax & 0xff),
    '99':   (r) => (r.ax >> 15) & 1,
};

/**
 * LINEAR operand term: adds cycles proportionally. Datasheet gives shift or
 * rotate by CL as 8+4n / 20+EA+4n and measurement confirms exactly 4 per
 * count. Keying on CL *categorically* instead scores 57% -- a 19x improvement
 * over ignoring it, and still 42 points short, because it fragments the table
 * across 64 CL values. See VERIFICATION.md, "a large improvement is not
 * evidence of the right model".
 */
const SHIFT_BY_CL = (r) => 4 * (r.cx & 0xff);
const LINEAR = {};
for (let ext = 0; ext < 8; ext++) {
    LINEAR[`D2.${ext}`] = SHIFT_BY_CL;
    LINEAR[`D3.${ext}`] = SHIFT_BY_CL;
}

/** True when the tables cover this opcode key at all. */
export const covered = (opcode) => Object.hasOwn(TABLES, opcode);

/** 32 is the "no modrm byte" slot, matching the generator. */
const modrmSlot = (b) =>
    (b === undefined || b === null) ? 32 : ((b >> 6) << 3) | (b & 7);

/**
 * Cycles for one instruction, given the queue length before it.
 * Returns null when this case was never measured -- callers MUST handle that
 * rather than coerce, since a missing key means "not measured" and turning it
 * into a plausible number is how an unmeasured case becomes an asserted one.
 */
export function predictCycles(opcode, s) {
    const T = TABLES[opcode];
    if (!T) return null;
    const regs = s.regs || { ax: 0, cx: 0 };
    const cat = CATEGORICAL[opcode];
    const lin = LINEAR[opcode];
    const v = cat ? cat(regs) : 0;
    const L = lin ? lin(regs) : 0;
    const key = `${s.queue},${s.length},${s.accesses},${modrmSlot(s.modrm)},`
        + `${s.taken ? 1 : 0},${v}`;
    const base = T.t[key];
    return base === undefined ? null : base + L;
}

/**
 * Queue length after an instruction, given the length before it and the
 * cycles it actually took. Returns null when unmeasured.
 */
export function predictNextQueue(opcode, s) {
    const T = TABLES[opcode];
    if (!T || !T.q) return null;
    const n = T.q[`${s.queue},${s.length},${s.cycles},${s.taken ? 1 : 0}`];
    return n === undefined ? null : n;
}

/**
 * Carries the prefetch queue across instructions so the cycle table can be
 * used by a running machine.
 *
 * Start state: `desynced`. The queue is genuinely unknown before the first
 * flush, and guessing an initial value would make every early prediction
 * quietly wrong. `reset()` after a jump, or the first taken branch, syncs it.
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
     * A null here is a signal to fall back to the core's own cycle count --
     * never to substitute a guess.
     */
    step(opcode, s) {
        const taken = !!s.taken;
        if (this.desynced) {
            // Nothing can be predicted from an unknown queue. A taken branch
            // still restores the state for NEXT time, which is the only way
            // out short of an explicit reset().
            this.misses++;
            if (taken) this.reset();
            return null;
        }
        const cycles = predictCycles(opcode, { ...s, queue: this.queue });
        if (cycles === null) {
            this.misses++;
            // The queue can no longer be advanced, so it is no longer known.
            if (taken) this.reset(); else this.desynced = true;
            return null;
        }
        const next = predictNextQueue(opcode, {
            queue: this.queue, length: s.length, cycles, taken,
        });
        if (next === null) {
            this.hits++;
            if (taken) this.reset(); else this.desynced = true;
            return cycles;
        }
        this.queue = next;
        this.hits++;
        return cycles;
    }
}
