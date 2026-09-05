/**
 * Cycle prediction for the 8088, over the generated tables in i8088-cycles.js.
 *
 * THE SPLIT IS DELIBERATE: `i8088-cycles.js` is GENERATED DATA and is
 * overwritten wholesale by scripts/gen-i8088-cycle-tables.mjs. This file is
 * hand-written LOGIC. Putting the lookup in the generated file would mean
 * every regeneration re-emitted, and could silently revert, code that was
 * edited by hand.
 *
 * The model (ROADMAP E6.8.4g), for an instruction that touches memory or I/O:
 *
 *     total = anchor + span + tail + linear
 *
 *   anchor   T-state the first data access begins. Keyed on the prefetch queue
 *            length, instruction length, access count and the modrm mod/rm
 *            field -- the last being the documented effective-address table.
 *   span     offset of the last access from the first.
 *   tail     T-states after the last access begins; a per-opcode constant.
 *   linear   proportional operand term; shift/rotate by CL costs 4 per count.
 *
 * Instructions with no data access are predicted directly from (queue, length,
 * modrm, branch-taken, operand).
 *
 * ACCURACY, WITH ITS SPLIT, because a score without one is not a claim:
 *   95.6% held out (70/30 within each opcode, over 323 opcodes)
 *   95.82% in-sample -- validates the lookup, NOT that the model generalises
 *
 * `null` is returned when the table has no entry, and callers MUST handle it
 * rather than coerce: a missing key means "not measured", and turning that
 * into a plausible number is how an unmeasured case becomes an asserted one.
 */
import { TABLES, PROVENANCE } from './i8088-cycles.js';

export { PROVENANCE };

const popcount = (v) => { let n = 0; while (v) { n += v & 1; v >>>= 1; } return n; };
const absw = (v) => ((v & 0x8000) ? (-v & 0xffff) : v);

/**
 * Operand-dependent latency, in two KINDS that must not be conflated --
 * measured cost of getting this wrong was 40 points (VERIFICATION.md,
 * "a large improvement is not evidence of the right model").
 *
 * CATEGORICAL: the operand value selects a different constant. MUL loops over
 * the bits of AX, the IMPLICIT operand -- keying on the source operand instead
 * scores 15.7%, i.e. nothing, and reads as "this feature does not exist".
 */
const CATEGORICAL = {
    'F7.4': (r) => popcount(r.ax),                                  // MUL r/m16
    'F6.4': (r) => popcount(r.ax & 0xff),                           // MUL r/m8
    'F7.5': (r) => popcount(absw(r.ax)) * 2 + ((r.ax >> 15) & 1),   // IMUL r/m16
    'F6.5': (r) => popcount(r.ax & 0xff),                           // IMUL r/m8
    '99':   (r) => (r.ax >> 15) & 1,                                // CWD
};

/**
 * LINEAR: the operand adds proportional cycles. Datasheet gives shift/rotate
 * by CL as 8+4n (register) / 20+EA+4n (memory); measurement confirms exactly
 * 4 cycles per count. Keying on CL *categorically* instead scores 57% -- a
 * 19x improvement over not modelling it at all, and still 42 points short.
 */
const SHIFT_BY_CL = (r) => 4 * (r.cx & 0xff);
const LINEAR = {};
for (let ext = 0; ext < 8; ext++) {
    LINEAR[`D2.${ext}`] = SHIFT_BY_CL;
    LINEAR[`D3.${ext}`] = SHIFT_BY_CL;
}

/** Opcodes the tables cover. */
export const covered = (opcode) => Object.hasOwn(TABLES, opcode);

/**
 * Predict the T-state count for one executed instruction.
 *
 * @param {string} opcode   table key: '01', 'F7.4', 'D3.0' -- opcode byte in
 *                          uppercase hex, plus '.<reg>' for a modrm-extended
 *                          group.
 * @param {object} s
 * @param {number} s.queue    prefetch queue length BEFORE the instruction
 * @param {number} s.length    instruction length in bytes, prefixes included
 * @param {number} s.accesses  data (non-fetch) bus accesses it performed
 * @param {number} [s.modrm]   raw modrm byte, omitted if the opcode has none
 * @param {boolean} [s.taken]  did control transfer (our core's _tookBranch)
 * @param {object} [s.regs]    {ax, cx} BEFORE the instruction; only needed for
 *                             the operand-dependent opcodes above
 * @returns {number|null} cycles, or null when this case was never measured
 */
export function predictCycles(opcode, s) {
    const t = TABLES[opcode];
    if (!t) return null;

    const regs = s.regs || { ax: 0, cx: 0 };
    const cat = CATEGORICAL[opcode];
    const lin = LINEAR[opcode];
    const v = cat ? cat(regs) : 0;
    const L = lin ? lin(regs) : 0;
    // 32 is the "no modrm byte" slot, matching the generator.
    const m = s.modrm === undefined || s.modrm === null
        ? 32 : ((s.modrm >> 6) << 3) | (s.modrm & 7);

    if (!s.accesses) {
        const d = t.d[`${s.queue},${s.length},${m},${s.taken ? 1 : 0},${v}`];
        return d === undefined ? null : d + L;
    }
    const a = t.a[`${s.queue},${s.length},${s.accesses},${m},${v}`];
    const k = `${s.accesses},${m},${v}`;
    const span = t.s[k], tail = t.t[k];
    if (a === undefined || span === undefined || tail === undefined) return null;
    return a + span + tail + L;
}
