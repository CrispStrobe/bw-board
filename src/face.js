/**
 * Device faces — the descriptor contract and the SIMULATED-mode
 * resolver. A face is a picture of a board with LIVE ELEMENTS: LEDs
 * that blink, displays that show content, pins that read high/low.
 * The doctrine (stc ROADMAP 2026-08-14): ONE descriptor, TWO data
 * sources — this resolver reads the simulator (what WOULD happen); a
 * live-telemetry resolver implements the same snapshot() against the
 * tethered stream (what IS happening) and the face rendering never
 * knows the difference.
 *
 * A descriptor:
 *   { id, title, image?,            // image: the artwork asset key
 *     elements: [{ id, kind,        // led | pin | text | digits |
 *                                   // matrix | lcd | level | needle
 *       bind: { source, ref, field?, activeLow? },
 *       at?: {x, y, w?, h?} }] }    // geometry on the artwork, optional
 *
 * Bind sources:
 *   'pin'    ref 'P1.0'   — MCU pin level via the solved net voltage
 *   'device' ref 'U1'     — a registry device's state; field picks the
 *                           entry (digits, text, level, columns,
 *                           reading, colorIndex...)
 *   'net'    ref netPin   — analog voltage at a probe point (any pin
 *                           name readAnalog accepts)
 *
 * The resolver is deliberately dumb: snapshot() returns
 * { elementId: value } with values in element-kind vocabulary
 * (led → 0/1 after activeLow, digits → array, lcd → text rows,
 * level → number). Rendering, artwork, and interaction live in the
 * app; THIS is the contract both sides meet at, and the part the
 * LEGO-hub faces will reuse unchanged.
 *
 * @module
 */

/** @param {object} descriptor @returns {string[]} problems (empty = valid) */
export function validateFace(descriptor) {
    const problems = [];
    if (!descriptor || typeof descriptor !== 'object') return ['descriptor is not an object'];
    if (!descriptor.id) problems.push('missing id');
    if (!Array.isArray(descriptor.elements)) problems.push('missing elements[]');
    const seen = new Set();
    for (const el of descriptor.elements || []) {
        if (!el.id) { problems.push('element without id'); continue; }
        if (seen.has(el.id)) problems.push(`duplicate element id ${el.id}`);
        seen.add(el.id);
        if (!el.kind) problems.push(`${el.id}: missing kind`);
        if (!el.bind || !el.bind.source || !el.bind.ref) {
            problems.push(`${el.id}: missing bind.source/ref`);
            continue;
        }
        if (!['pin', 'device', 'net'].includes(el.bind.source)) {
            problems.push(`${el.id}: unknown bind source ${el.bind.source}`);
        }
        if (el.bind.source === 'device' && !el.bind.field) {
            problems.push(`${el.id}: device binds need a field`);
        }
    }
    return problems;
}

/**
 * The simulated-mode resolver: reads the board.
 * @param {import('./board.js').BoardImpl} board
 * @param {object} descriptor
 */
export function createFaceResolver(board, descriptor) {
    const problems = validateFace(descriptor);
    if (problems.length) throw new Error(`face ${descriptor && descriptor.id}: ${problems.join('; ')}`);

    const resolveOne = (el) => {
        const b = el.bind;
        if (b.source === 'pin') {
            const v = board.readAnalog(b.ref);
            const high = v > 2.5 ? 1 : 0;
            return b.activeLow ? 1 - high : high;
        }
        if (b.source === 'net') return board.readAnalog(b.ref);
        // device
        const st = board.getDeviceState(b.ref);
        if (!st) return null;
        const value = st[b.field];
        // Kind-level conveniences: a led bound to a boolean-ish field
        // still comes back 0/1; arrays/objects pass through untouched.
        if (el.kind === 'led') return value ? 1 : 0;
        return value === undefined ? null : value;
    };

    return {
        descriptor,
        /** @returns {Record<string, any>} elementId → current value */
        snapshot() {
            const out = {};
            for (const el of descriptor.elements) out[el.id] = resolveOne(el);
            return out;
        },
        /** Only elements whose value changed since the last diff() call. */
        diff() {
            const cur = this.snapshot();
            const prev = this._prev || {};
            const changed = {};
            for (const [k, v] of Object.entries(cur)) {
                if (JSON.stringify(prev[k]) !== JSON.stringify(v)) changed[k] = v;
            }
            this._prev = cur;
            return changed;
        },
    };
}

/**
 * The first face: the YL-39-class 8051 minimum-system board. Element
 * ids are the board's silkscreen vocabulary; the artwork keys resolve
 * in the app's asset layer (bw-parts draws them).
 */
export const YL39_FACE = Object.freeze({
    id: 'yl39',
    title: '8051 minimum system board',
    image: 'boards/yl39',
    elements: [
        ...Array.from({ length: 8 }, (_, i) => ({
            id: `D${i + 1}`, kind: 'led',
            bind: { source: 'pin', ref: `P1.${i}`, activeLow: true },
        })),
        { id: 'SEG', kind: 'digits', bind: { source: 'device', ref: 'SEG1', field: 'digits' } },
        { id: 'BZ', kind: 'led', bind: { source: 'pin', ref: 'P2.3', activeLow: true } },
        { id: 'POT', kind: 'level', bind: { source: 'net', ref: 'P1.7' } },
    ],
});
