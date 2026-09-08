/** Experimental ideal digital nets. No analog or CPU timing claim. */
const LEVELS = new Set([0, 1, 'X', 'Z']);
const endpoint = (part, pin) => `${part}.${String(pin).toLowerCase()}`;

export class CircuitFault extends Error {
    constructor(code, detail) {
        super(`${code}: ${detail}`);
        this.name = 'CircuitFault';
        this.code = code;
    }
}

/**
 * Immutable topology in Circuit Editor's {parts,wires} shape. Each part declares
 * pins and outputs; optional evaluate(read) is a PURE combinational function.
 * All functions see one resolved snapshot per delta. Stateful commits belong
 * outside settle(), which may invoke evaluate more than once.
 */
export class DigitalCircuit {
    constructor({enabled = false, parts, wires = [], maxDeltas = 32}) {
        if (enabled !== true) throw new CircuitFault('EXPERIMENT_DISABLED', 'explicit enabled:true required');
        if (!Number.isSafeInteger(maxDeltas) || maxDeltas < 1) throw new RangeError('maxDeltas');
        if (!Array.isArray(parts) || !Array.isArray(wires)) throw new TypeError('parts/wires must be arrays');
        this.maxDeltas = maxDeltas;
        this.parts = new Map();
        this.parent = new Map();
        this.drives = new Map();
        this.outputs = new Set();
        for (const part of parts) {
            if (typeof part.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(part.id) || this.parts.has(part.id)) {
                throw new Error('invalid/duplicate part id');
            }
            if (!Array.isArray(part.pins) || part.pins.some(p => typeof p !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(p))) {
                throw new Error(`invalid pins: ${part.id}`);
            }
            const pins = part.pins.map(p => endpoint(part.id, p));
            if (new Set(pins).size !== pins.length) throw new Error(`duplicate pin: ${part.id}`);
            this.parts.set(part.id, {...part, pins: [...part.pins], outputs: [...(part.outputs || [])]});
            for (const pin of pins) this.parent.set(pin, pin);
            for (const pin of part.outputs || []) {
                const key = endpoint(part.id, pin);
                if (!this.parent.has(key)) throw new Error(`unknown output ${key}`);
                this.outputs.add(key);
            }
        }
        for (const wire of wires) {
            const a = this.root(endpoint(wire.from, wire.fromTerminal));
            const b = this.root(endpoint(wire.to, wire.toTerminal));
            // Canonical names make diagnostics independent of wire ordering.
            if (a !== b) this.parent.set(a < b ? b : a, a < b ? a : b);
        }
        this.settle();
    }

    root(key) {
        if (!this.parent.has(key)) throw new Error(`unknown terminal ${key}`);
        let root = key;
        while (this.parent.get(root) !== root) root = this.parent.get(root);
        return root;
    }

    drive(part, values) {
        const updates = [];
        for (const [pin, value] of Object.entries(values)) {
            const key = endpoint(part, pin);
            if (!this.outputs.has(key)) throw new Error(`not an output ${key}`);
            if (!LEVELS.has(value)) throw new Error(`invalid logic level ${value}`);
            updates.push([key, value]);
        }
        for (const [key, value] of updates) this.drives.set(key, value);
    }

    resolve() {
        const nets = new Map();
        for (const key of this.parent.keys()) {
            const root = this.root(key);
            if (!nets.has(root)) nets.set(root, []);
        }
        for (const [key, value] of this.drives) {
            if (value !== 'Z') nets.get(this.root(key)).push({pin: key, value});
        }
        return new Map([...nets].map(([key, drivers]) => {
            drivers.sort((a, b) => a.pin.localeCompare(b.pin));
            const values = new Set(drivers.map(d => d.value));
            const conflict = values.has(0) && values.has(1);
            const value = !values.size ? 'Z' : conflict || values.has('X') ? 'X' : drivers[0].value;
            return [key, {value, conflict, drivers}];
        }));
    }

    settle() {
        for (let delta = 0; delta < this.maxDeltas; delta++) {
            const snapshot = this.resolve();
            const before = new Map(this.drives);
            const updates = [];
            for (const [id, part] of this.parts) {
                if (!part.evaluate) continue;
                const values = part.evaluate(pin => snapshot.get(this.root(endpoint(id, pin))).value);
                // A combinational part must describe EVERY output each time:
                // omission releases it, never retains an accidental latch.
                for (const pin of Object.keys(values)) {
                    if (!part.outputs.includes(pin)) throw new Error(`undeclared output ${id}.${pin}`);
                }
                updates.push([id, Object.fromEntries(part.outputs.map(pin => [pin, values[pin] ?? 'Z']))]);
            }
            for (const [id, values] of updates) this.drive(id, values);
            if (this.drives.size === before.size && [...this.drives].every(([k, v]) => before.get(k) === v)) {
                this.snapshot = snapshot;
                return delta;
            }
        }
        throw new CircuitFault('NON_CONVERGENT', `digital network did not settle in ${this.maxDeltas} deltas`);
    }

    inspect(part, pin) {
        const state = this.snapshot.get(this.root(endpoint(part, pin)));
        return {...state, drivers: state.drivers.map(d => ({...d}))};
    }

    // Internal readers need a scalar, not a defensive copy of diagnostics.
    // Keep inspect() copying for callers that can mutate its returned arrays.
    read(part, pin) { return this.snapshot.get(this.root(endpoint(part, pin))).value; }

    require(part, pin) {
        const state = this.snapshot.get(this.root(endpoint(part, pin)));
        if (state.value === 0 || state.value === 1) return state.value;
        throw new CircuitFault(state.conflict ? 'CONTENTION' : state.value === 'Z' ? 'FLOATING' : 'UNKNOWN',
            `${endpoint(part, pin)} (${state.drivers.map(d => `${d.pin}=${d.value}`).join(', ') || 'no driver'})`);
    }
}

export const bitPins = (prefix, width) => Array.from({length: width}, (_, i) => `${prefix}${i}`);
export const bitDrives = (pins, value) => Object.fromEntries(pins.map((pin, i) => [pin, (value >>> i) & 1]));
export function readBits(pins, read) {
    let value = 0;
    for (let i = 0; i < pins.length; i++) {
        const bit = read(pins[i]);
        if (bit !== 0 && bit !== 1) return null;
        value += bit * 2 ** i;
    }
    return value;
}
