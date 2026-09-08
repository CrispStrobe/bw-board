/** Ideal digital bridge components. NOT complete 82C288/74xx electrical models. */
import {CircuitFault, bitPins} from './digital-circuit.js';
import {decode286Status} from './harris-80c286-contract.js';

const requireLevel = (read, pin) => {
    const value = read(pin);
    if (value !== 0 && value !== 1) throw new CircuitFault(value === 'Z' ? 'FLOATING' : 'UNKNOWN', pin);
    return value;
};
const gate = enabled => {
    if (enabled !== true) throw new CircuitFault('EXPERIMENT_DISABLED', 'enabled:true required');
};

/** Transparent while ALE is high, retained while low; no hidden address path. */
export class IdealAddressLatch {
    constructor({enabled = false, id = 'latch'} = {}) {
        gate(enabled);
        this.id = id;
        this.signals = [...bitPins('a', 24), 'bhe_n', 'm_io'];
        this.values = Object.fromEntries(this.signals.map(p => [`q_${p}`, 'X']));
    }
    part() {
        return {id: this.id, pins: ['ale', ...this.signals, ...Object.keys(this.values)], outputs: Object.keys(this.values)};
    }
    update(read) {
        if (requireLevel(read, 'ale')) {
            // Validate the complete input word before modifying the latch.
            this.values = Object.fromEntries(this.signals.map(p => [`q_${p}`, requireLevel(read, p)]));
        }
        return {...this.values};
    }
}

/**
 * Status-driven phase controller. Learns phase from the two status periods;
 * never reads CPU.state, pending, transfers, or acceptance callbacks. ALE is
 * high in TS2; command low in TC; READY low at TC2 releases the command.
 * This deliberately omits 82C288 edge timing, CMDLY and bus arbitration.
 * I/O strobes and INTA are separate, explicit opt-ins.
 */
export class MemoryPhaseController {
    constructor({enabled = false, id = 'controller', intrEnabled = false, ioEnabled = false} = {}) {
        gate(enabled); this.id = id; this.state = 'TI'; this.phase = 1; this.open = false;
        if (typeof intrEnabled !== 'boolean') throw new TypeError('intrEnabled');
        if (typeof ioEnabled !== 'boolean') throw new TypeError('ioEnabled');
        this.ioEnabled = ioEnabled;
        this.intrEnabled = intrEnabled; this.tcCount = 0;
        this.kind = null;
    }
    part() {
        const extra = [...(this.intrEnabled ? ['inta_n','inta_wait'] : []), ...(this.ioEnabled ? ['ior_n','iow_n'] : [])];
        return {id: this.id, pins: ['reset', 'ready_n', 's1_n', 's0_n', 'cod_inta_n', 'm_io', 'ale', 'mrd_n', 'mwr_n',...extra],
            outputs: ['ale', 'mrd_n', 'mwr_n',...extra]};
    }
    commands() {
        const ack = this.kind === 'interrupt-acknowledge';
        return {ale: Number(this.state === 'TS' && this.phase === 2 && !ack),
            mrd_n: Number(!(this.state === 'TC' && ['memory-read','code-read'].includes(this.kind))),
            mwr_n: Number(!(this.state === 'TC' && this.kind === 'memory-write')),
            ...(this.ioEnabled ? {ior_n:Number(!(this.state === 'TC' && this.kind === 'io-read')),
                iow_n:Number(!(this.state === 'TC' && this.kind === 'io-write'))} : {}),
            ...(this.intrEnabled ? {inta_n:Number(!(ack && this.state === 'TC')),
                inta_wait:Number(ack && this.state === 'TC' && this.tcCount === 0)} : {})};
    }
    beginClock(read) {
        if (this.open) throw new CircuitFault('CLOCK_ORDER', 'controller clock still open');
        if (requireLevel(read, 'reset')) { this.state = 'TI'; this.phase = 1; this.kind = null; this.tcCount = 0; }
        else {
            const signals = Object.fromEntries(['s1_n', 's0_n', 'cod_inta_n', 'm_io'].map(p => [p, requireLevel(read, p)]));
            const kind = decode286Status(signals);
            if (this.state === 'TI' && kind !== 'passive') {
                if (!['code-read', 'memory-read', 'memory-write',...(this.intrEnabled ? ['interrupt-acknowledge'] : []),
                    ...(this.ioEnabled ? ['io-read','io-write'] : [])].includes(kind)) throw new CircuitFault('UNSUPPORTED_COMMAND', kind);
                this.state = 'TS'; this.phase = 1; this.kind = kind;
                this.tcCount = 0;
            } else if (this.state === 'TS' && kind !== this.kind || this.state === 'TC' && kind !== 'passive') {
                throw new CircuitFault('STATUS_SEQUENCE', `${this.state}/${this.phase}: ${kind}`);
            }
        }
        this.open = true;
        return this.commands();
    }
    previewEnd(read) {
        if (!this.open) throw new CircuitFault('CLOCK_ORDER', 'controller clock not open');
        const ready = this.state === 'TC' && this.phase === 2 ? requireLevel(read, 'ready_n') : null;
        return {ready, finish: () => {
            this.open = false;
            if (this.state === 'TS') {
                if (this.phase === 1) this.phase = 2;
                else { this.state = 'TC'; this.phase = 1; }
            } else if (this.state === 'TC') {
                if (this.phase === 2) this.tcCount++;
                if (this.phase === 1) this.phase = 2;
                else if (ready === 0) { this.state = 'TI'; this.phase = 1; }
                else this.phase = 1;
            }
            // Outputs only change at the command's trailing edge here. A new
            // TS/ALE/TC phase is driven by beginClock on the next period.
            return this.state === 'TI' ? this.commands() : null;
        }};
    }
}

/**
 * Adapter for the EXISTING registered bus-memory update model, using 0/5V.
 * No analog stamp/voltage/current simulation. Call preview for every bank,
 * then commit all previews. Writes remain the model's edge-triggered writes.
 */
export class DigitalBusMemoryAdapter {
    constructor({enabled = false, id, kind, model, contents = new Uint8Array(), readOnly = false}) {
        gate(enabled);
        if (!['62256', '28c256'].includes(kind) || !model?.init || !model?.update) throw new TypeError('registered bus-memory model required');
        if (!(contents instanceof Uint8Array) || contents.length > 32768) throw new RangeError('contents');
        this.id = id; this.kind = kind; this.model = model;
        this.select = kind === '62256' ? 'csb' : 'ceb';
        this.device = {id, kind, params: {contents: contents.slice(), readOnly}};
        this.state = model.init(this.device); this.writes = 0;
    }
    part() { return {id: this.id, pins: [...this.model.terminals], outputs: bitPins('d', 8)}; }
    preview(read) {
        if (requireLevel(read, 'vcc') !== 1 || requireLevel(read, 'gnd') !== 0) throw new CircuitFault('MEMORY_POWER', this.id);
        const oe = requireLevel(read, 'oeb');
        const we = requireLevel(read, 'web');
        // With both commands inactive, address/select are don't-cares. They
        // MUST be valid during an access; no floating input becomes a byte.
        const sel = oe === 1 && we === 1 ? 1 : requireLevel(read, this.select);
        const active = sel === 0;
        const values = {vcc: 5, gnd: 0, oeb: oe * 5, web: we * 5, [this.select]: sel * 5};
        for (const p of bitPins('a', 15)) values[p] = active ? requireLevel(read, p) * 5 : 0;
        for (const p of bitPins('d', 8)) values[p] = active && we === 0 ? requireLevel(read, p) * 5 : 0;
        const cycle = !active ? 'idle' : we === 0 ? 'write' : oe === 0 ? 'read' : 'idle';
        const leavingWrite = this.state._cycle === 'write' && cycle !== 'write';
        const protectedROM = this.kind === '28c256' && this.device.params.readOnly;
        const willWrite = leavingWrite && this.state._armed && this.state._pending && !protectedROM;
        const next = {...this.state, drives: {...this.state.drives},
            _pending: this.state._pending ? {...this.state._pending} : null,
            // The reused model can modify storage ONLY on this transition.
            // Copy then, so a failed peer-bank preflight cannot partially write.
            mem: leavingWrite ? this.state.mem.slice() : this.state.mem};
        const changed = this.model.update(this.device, next, p => values[p]);
        const drives = Object.fromEntries(bitPins('d', 8).map(p => [p,
            next.drives[p] ? Number(next.drives[p].vTh > 2.5) : 'Z']));
        return {changed, drives, commit: () => { this.state = next; if (willWrite) this.writes++; }};
    }
    inspect() { return {bytes: this.state.mem.slice(), writes: this.writes, cycle: this.state._cycle,
        pending: this.state._pending ? {...this.state._pending} : null}; }
}

export function settleBusMemories(circuit, memories, maxPasses = 8) {
    if (!Number.isSafeInteger(maxPasses) || maxPasses < 1) throw new RangeError('maxPasses');
    for (let pass = 0; pass < maxPasses; pass++) {
        circuit.settle();
        const previews = memories.map(memory => memory.preview(p => circuit.require(memory.id, p)));
        for (let i = 0; i < memories.length; i++) {
            previews[i].commit(); circuit.drive(memories[i].id, previews[i].drives);
        }
        circuit.settle();
        if (!previews.some(p => p.changed)) return;
    }
    throw new CircuitFault('MEMORY_NON_CONVERGENT', `no fixpoint after ${maxPasses} passes`);
}
