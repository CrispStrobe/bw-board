// The shared machine-checkpoint contract, used by m6502-machine.js,
// z80-machine.js and i8086-machine.js. A machine exposes checkpointSupport()
// (is the current state fully serialisable, and if not why not),
// checkpointTopology() (a stable string identifying the built machine, so a
// checkpoint cannot restore onto a different one), captureCheckpoint() (an
// envelope: schema + topology + a machine time domain + saveState()) and
// restoreCheckpoint() (validate the envelope, then loadState()). Completeness
// is a property of the CONTRACT, not of saveState: a chip with no paired state
// codec makes the machine unsupported, so capture REFUSES rather than dropping
// the chip into a checkpoint that would restore to a divergent machine.

export const MACHINE_CHECKPOINT_SCHEMA = 1;

export const cloneCheckpointValue = value => {
    if (typeof structuredClone !== 'function') {
        throw new Error('checkpoint refused: structuredClone is unavailable');
    }
    return structuredClone(value);
};

const stable = value => {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map(key =>
            `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
};

export const statePair = component => {
    if (component && typeof component.getState === 'function' &&
        typeof component.setState === 'function') return ['getState', 'setState'];
    if (component && typeof component.saveState === 'function' &&
        typeof component.loadState === 'function') return ['saveState', 'loadState'];
    return null;
};

export const checkpointTopology = (architecture, config, chips, devices, extra = {}) => stable({
    architecture,
    config,
    chips: Object.keys(chips || {}).sort().map(name => ({
        name, type: chips[name]?.constructor?.name || 'Object'
    })),
    devices: Object.keys(devices || {}).sort().map(name => ({
        name, type: devices[name]?.constructor?.name || 'Object'
    })),
    ...extra
});

export const checkpointSupport = (chips, devices, reasons = []) => {
    const missing = [...reasons];
    for (const [group, components] of [['chip', chips], ['device', devices || {}]]) {
        for (const [name, component] of Object.entries(components || {})) {
            if (!statePair(component)) missing.push(`${group} '${name}' has no paired state codec`);
        }
    }
    return missing.length ? {supported: false, reasons: missing} : {supported: true, reasons: []};
};

export const checkpointRefusal = support => ({
    refused: support.reasons.join('; '),
    code: 'INCOMPLETE_CHECKPOINT_STATE',
    details: {reasons: [...support.reasons]}
});

export const validateCheckpointEnvelope = (checkpoint, topology) => {
    if (!checkpoint || checkpoint.schema !== MACHINE_CHECKPOINT_SCHEMA) {
        return {refused: 'checkpoint schema is not supported', code: 'CHECKPOINT_SCHEMA_MISMATCH'};
    }
    if (checkpoint.topology !== topology) {
        return {refused: 'checkpoint belongs to a different machine topology', code: 'CHECKPOINT_TOPOLOGY_MISMATCH'};
    }
    if (!checkpoint.state || typeof checkpoint.state !== 'object') {
        return {refused: 'checkpoint has no machine state', code: 'INVALID_CHECKPOINT'};
    }
    return null;
};

// ─── the state body, which is where the three machines used to diverge ──────
//
// validateCheckpointEnvelope above judges the WRAPPER: schema, topology, and
// that there is a state object at all. Nothing judged the state BODY, and each
// machine grew its own answer: m6502 and z80 carried near-identical inline
// clauses inside restoreCheckpoint, and the 8086 -- converged onto the shared
// contract on 2026-09-10 -- carried none. Measured on that tree, restoring an
// 8086 from a truncated memory image was ACCEPTED and left the destination's
// own bytes past the end of the image, where m6502 refused the same input by
// name. A convergence that removes a divergence must not introduce one, so the
// common clauses live here and each machine keeps only what is genuinely its
// own (z80's tape and 128K banks, m6502's pin levels and cycle counter).
//
// The refusal MESSAGE is deliberately the one m6502/z80 already returned, so
// existing callers and tests keep working; `details.reason` names which clause
// fired, because "incomplete" alone cannot be acted on.

/**
 * Shape-compare a restored value against a freshly-captured sample of the same
 * thing. Array lengths may legitimately vary (a UART RX queue); typed memory
 * blocks may not. Moved here from m6502-machine.js, which was its only home.
 */
export const sameCheckpointShape = (actual, expected) => {
    if (ArrayBuffer.isView(expected)) {
        return ArrayBuffer.isView(actual) && actual.constructor === expected.constructor &&
            actual.length === expected.length;
    }
    if (Array.isArray(expected)) return Array.isArray(actual);
    if (expected && typeof expected === 'object') {
        if (!actual || typeof actual !== 'object' || Array.isArray(actual)) return false;
        const a = Object.keys(actual).sort();
        const e = Object.keys(expected).sort();
        return a.length === e.length && e.every((key, index) => key === a[index] &&
            sameCheckpointShape(actual[key], expected[key]));
    }
    return typeof actual === typeof expected;
};

const stateRefusal = reason => ({
    refused: 'checkpoint machine state is incomplete',
    code: 'INVALID_CHECKPOINT',
    details: {reason}
});

/**
 * The clauses every machine needs, in the order that makes the cheapest and
 * most specific failure win.
 *
 * @param {object} state            the checkpoint's state body
 * @param {object} spec
 * @param {number} spec.version     the saveState format version this machine writes
 * @param {number} spec.memBytes    the exact size of this machine's memory image
 * @param {string[]} spec.cpuKeys   every CPU field the snapshot must carry
 * @param {object} spec.chips       the live chip map, for a name-set comparison
 * @param {object} [spec.devices]   the live device map, likewise
 * @param {object} [spec.shape]     a freshly-captured saveState() to shape-check against
 * @returns {null|{refused: string, code: string, details: object}}
 */
export function validateCheckpointState (state, {version, memBytes, cpuKeys, chips, devices, shape = null}) {
    if (!state || typeof state !== 'object') return stateRefusal('state is not an object');
    if (state.v !== version) return stateRefusal(`state version ${state.v} is not the supported version ${version}`);
    // The memory image is checked for BOTH type and exact length. A short image
    // is the dangerous direction: `mem.set` accepts it and silently leaves the
    // tail as the destination machine had it, which restores a machine that is
    // wrong rather than one that failed.
    if (!(state.mem instanceof Uint8Array)) {
        return stateRefusal(`memory image is ${state.mem === null ? 'null' : typeof state.mem}, not a Uint8Array`);
    }
    if (state.mem.length !== memBytes) {
        return stateRefusal(`memory image is ${state.mem.length} bytes, not ${memBytes}`);
    }
    if (!state.cpu || typeof state.cpu !== 'object') return stateRefusal('state has no CPU record');
    const missingCpu = cpuKeys.filter(key => !Object.hasOwn(state.cpu, key));
    if (missingCpu.length) return stateRefusal(`CPU fields missing: ${missingCpu.join(', ')}`);
    for (const [group, live, saved] of [
        ['chip', chips || {}, state.chips],
        ['device', devices || {}, state.devices]
    ]) {
        const expected = Object.keys(live).sort();
        const actual = Object.keys(saved || {}).sort();
        if (JSON.stringify(expected) !== JSON.stringify(actual)) {
            return stateRefusal(`${group} set is [${actual}] but this machine has [${expected}]`);
        }
    }
    if (shape) {
        for (const key of ['cpu', 'chips', 'devices']) {
            if (key in shape && !sameCheckpointShape(state[key], shape[key])) {
                return stateRefusal(`${key} does not match the shape this machine captures`);
            }
        }
    }
    return null;
}
