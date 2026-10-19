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
    #netLayout;
    #dirty = new Set();
    #resolved = new Map();
    #snapshotDirty = new Set();
    #evalDirty = new Set();
    #evaluators;
    #topologyReady=false;
    #terminals = new Map();
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
        // Topology is fixed after construction. Resolve only changing levels,
        // not net membership or diagnostic driver ordering, on each delta.
        const nets = new Map();
        for (const key of this.parent.keys()) {
            const root = this.root(key);
            this.parent.set(key, root);
            if (!nets.has(root)) nets.set(root, []);
        }
        for (const key of this.outputs) nets.get(this.root(key)).push(key);
        this.#netLayout = [...nets].map(([root, pins]) =>
            [root, pins.sort((a, b) => a.localeCompare(b))]);
        this.#netLayout = new Map(this.#netLayout);
        this.#dirty = new Set(this.#netLayout.keys());
        this.#topologyReady=true;
        for (const [id, part] of this.parts) {
            const terminals = new Map();
            for (const pin of part.pins) {
                const key = endpoint(id, pin);
                terminals.set(pin.toLowerCase(), {key, root:this.parent.get(key), output:this.outputs.has(key)});
            }
            this.#terminals.set(id, terminals);
        }
        this.snapshot = new Map();
        this.#evaluators=[...this.parts].filter(([,part])=>part.evaluate).map(([id,part])=>
            ({id,part,first:true,roots:new Set(part.pins.map(p=>this.root(endpoint(id,p))))}));
        this.settle();
    }

    root(key) {
        if(this.#topologyReady){const root=this.parent.get(key);if(root===undefined)throw new Error(`unknown terminal ${key}`);return root;}
        if (!this.parent.has(key)) throw new Error(`unknown terminal ${key}`);
        let root = key;
        while (this.parent.get(root) !== root) root = this.parent.get(root);
        return root;
    }

    drive(part, values) {
        const updates = [];
        const terminals = this.#terminals.get(part);
        for (const pin of Object.keys(values)) {
            const terminal = terminals?.get(pin.toLowerCase());
            const value = values[pin];
            if (!terminal?.output) throw new Error(`not an output ${endpoint(part,pin)}`);
            if (!LEVELS.has(value)) throw new Error(`invalid logic level ${value}`);
            updates.push(terminal, value);
        }
        for (let i=0;i<updates.length;i+=2) {
            const {key,root}=updates[i], value=updates[i+1];
            if(this.drives.get(key)!==value){this.#dirty.add(root);this.drives.set(key, value);}
        }
    }

    #terminal(part, pin) {
        const terminal=this.#terminals.get(part)?.get(String(pin).toLowerCase());
        if(!terminal)throw new Error(`unknown terminal ${endpoint(part,pin)}`);
        return terminal;
    }

    resolve() {
        return new Map([...this.#resolveLevels()].map(([key,state])=>[key,{...state,drivers:state.drivers.map(d=>({...d}))}]));
    }
    #resolveLevels() {
        for (const root of this.#dirty) {
            const pins=this.#netLayout.get(root);
            const drivers = [];
            let levels = 0;
            for (const pin of pins) {
                const value = this.drives.get(pin);
                if (value === undefined || value === 'Z') continue;
                drivers.push({pin, value});
                levels |= value === 0 ? 1 : value === 1 ? 2 : 4;
            }
            const conflict = (levels & 3) === 3;
            const value = !levels ? 'Z' : conflict || (levels & 4) ? 'X' : drivers[0].value;
            if(this.#resolved.get(root)?.value!==value)this.#evalDirty.add(root);
            this.#resolved.set(root, {value, conflict, drivers});
            this.#snapshotDirty.add(root);
        }
        this.#dirty.clear();
        return this.#resolved;
    }

    settle() {
        const cached=this.resolve===DigitalCircuit.prototype.resolve;
        if(cached&&!this.#dirty.size&&!this.#evalDirty.size&&!this.#snapshotDirty.size)return 0;
        for (let delta = 0; delta < this.maxDeltas; delta++) {
            const snapshot = this.resolve===DigitalCircuit.prototype.resolve?this.#resolveLevels():this.resolve();
            const changed=this.#evalDirty;this.#evalDirty=new Set();
            const before = new Map();
            const updates = [];
            for (const entry of this.#evaluators) {
                const {id,part}=entry;
                if(cached&&!entry.first){let affected=false;for(const root of entry.roots)if(changed.has(root)){affected=true;break;}if(!affected)continue;}
                entry.first=false;
                const values = part.evaluate(pin => snapshot.get(this.#terminal(id, pin).root).value);
                // A combinational part must describe EVERY output each time:
                // omission releases it, never retains an accidental latch.
                for (const pin of Object.keys(values)) {
                    if (!part.outputs.includes(pin)) throw new Error(`undeclared output ${id}.${pin}`);
                }
                updates.push([id, Object.fromEntries(part.outputs.map(pin => [pin, values[pin] ?? 'Z']))]);
            }
            for (const [id,values] of updates)for(const pin of Object.keys(values)){
                const key=endpoint(id,pin);if(!before.has(key))before.set(key,this.drives.get(key));
            }
            for (const [id, values] of updates) this.drive(id, values);
            if ([...before].every(([k, v]) => this.drives.get(k) === v)) {
                if(this.resolve===DigitalCircuit.prototype.resolve){
                    for(const root of this.#snapshotDirty)this.snapshot.set(root,snapshot.get(root));
                    this.#snapshotDirty.clear();
                }else this.snapshot=new Map(snapshot);
                return delta;
            }
        }
        throw new CircuitFault('NON_CONVERGENT', `digital network did not settle in ${this.maxDeltas} deltas`);
    }

    inspect(part, pin) {
        const state = this.snapshot.get(this.#terminal(part, pin).root);
        return {...state, drivers: state.drivers.map(d => ({...d}))};
    }

    // Internal readers need a scalar, not a defensive copy of diagnostics.
    // Keep inspect() copying for callers that can mutate its returned arrays.
    read(part, pin) { return this.snapshot.get(this.#terminal(part, pin).root).value; }

    require(part, pin) {
        const state = this.snapshot.get(this.#terminal(part, pin).root);
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
