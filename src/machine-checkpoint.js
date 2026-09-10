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
