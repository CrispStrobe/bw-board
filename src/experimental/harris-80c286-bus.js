/**
 * Default-off, non-pipelined SYSTEM-CLOCK-PHASE subset of Harris bus sequencing.
 * Not an instruction core; not exact edge/AC timing. See source-backed contract.
 * beginClock drives a complete idealized period; endClock samples its end.
 * The caller must resolve the circuit in between; read(pin) returns a NET level.
 */
import {CircuitFault, bitPins, bitDrives} from './digital-circuit.js';
import {plan286Transfers} from './harris-80c286-contract.js';

const A = bitPins('a', 24);
const D = bitPins('d', 16);
const releaseData = () => Object.fromEntries(D.map(p => [p, 'Z']));
const OUTPUTS = [...A, ...D, 'bhe_n', 's1_n', 's0_n', 'cod_inta_n', 'm_io', 'lock_n', 'hlda', 'peack_n'];
const INPUTS = ['reset', 'ready_n', 'hold', 'intr', 'nmi', 'pereq', 'busy_n', 'error_n'];
const known = (read, pin) => {
    const v = read(pin);
    if (v !== 0 && v !== 1) throw new CircuitFault(v === 'Z' ? 'FLOATING' : 'UNKNOWN', pin);
    return v;
};

export class Harris80C286Bus {
    constructor({enabled = false, maxWaitStates = 1024, traceLimit = 256} = {}) {
        if (enabled !== true) throw new CircuitFault('EXPERIMENT_DISABLED', 'enabled:true required');
        for (const v of [maxWaitStates, traceLimit]) if (!Number.isSafeInteger(v) || v < 1) throw new RangeError('limits');
        this.maxWaitStates = maxWaitStates;
        this.traceLimit = traceLimit;
        this.capabilities = Object.freeze({cpu: false, experimental: true,
            fidelity: 'non-pipelined-system-clock-phases', clockEdges: false,
            systemClockStepping: true, snapshots: false, hold: false, interrupts: false,
            pipelinedAddress: false, protectedMode: false});
        this.state = 'RESET_REQUIRED';
        this.phase = 1;
        this.clock = 0;
        this.open = false;
        this.faulted = false;
        this.resetClocks = 0;
        this.initClocks = 0;
        this.pending = null;
        this.writeHold = 0;
        this.heldData = releaseData();
        this.address = 0xffffff;
        this.control = {bhe_n: 1, s1_n: 1, s0_n: 1, cod_inta_n: 0, m_io: 0};
        this.trace = [];
        this.dropped = 0;
    }

    part(id = 'cpu') { return {id, pins: [...INPUTS, ...OUTPUTS], outputs: [...OUTPUTS]}; }

    submit(transaction) {
        if (this.faulted || this.open || this.pending || this.state !== 'TI') {
            throw new CircuitFault('BUS_UNAVAILABLE', 'reset/init/pending clock or transaction');
        }
        const transfers = plan286Transfers(transaction);
        this.pending = {transfers, index: 0, bytes: [], waits: 0, kind: transaction.kind};
    }

    _record(event) {
        if (this.trace.length === this.traceLimit) { this.trace.shift(); this.dropped++; }
        this.trace.push(Object.freeze({clock: this.clock, ...event}));
    }

    beginClock(read) {
        if (this.open) throw new CircuitFault('CLOCK_ORDER', 'endClock required');
        if (this.clock >= Number.MAX_SAFE_INTEGER) throw new RangeError('clock overflow');
        try {
            const reset = known(read, 'reset');
            if (reset) {
                if (this.state !== 'RESET' || this.faulted) this.resetClocks = 0;
                this.state = 'RESET'; this.phase = 1;
                this.pending = null; this.writeHold = 0;
                this.address = 0xffffff;
                this.control = {bhe_n: 1, s1_n: 1, s0_n: 1, cod_inta_n: 0, m_io: 0};
                this.faulted = false;
            } else {
                if (this.faulted) throw new CircuitFault('BUS_FAULTED', 'assert RESET to recover');
                if (this.state === 'RESET_REQUIRED') throw new CircuitFault('RESET_REQUIRED', 'assert RESET first');
                if (this.state === 'RESET') {
                    // p.6 says MORE THAN 16 periods; use 17, not an off-by-one 16.
                    if (this.resetClocks < 17) throw new CircuitFault('SHORT_RESET', `${this.resetClocks} complete periods; require 17`);
                    this.state = 'INIT'; this.initClocks = 50; this.phase = 1;
                }
            }
            // Fail closed instead of silently ignoring yet-unimplemented pins.
            if (known(read, 'hold')) throw new CircuitFault('UNSUPPORTED_HOLD', this.state);
            if (!reset) for (const pin of ['intr', 'nmi', 'pereq']) {
                if (known(read, pin)) throw new CircuitFault('UNSUPPORTED_INPUT', pin);
            }
            if (!reset) for (const pin of ['busy_n', 'error_n']) {
                if (!known(read, pin)) throw new CircuitFault('UNSUPPORTED_INPUT', pin);
            }
            if (this.state === 'TI' && this.phase === 1 && this.pending) {
                this.state = 'TS';
                const t = this.pending.transfers[this.pending.index];
                this.address = t.address;
                this.control = {bhe_n: t.bhe_n, s1_n: t.s1_n, s0_n: t.s0_n,
                    cod_inta_n: t.cod_inta_n, m_io: t.m_io};
            }
            let data = this.writeHold ? this.heldData : releaseData();
            const transfer = this.pending?.transfers[this.pending.index];
            if (transfer?.kind.endsWith('write') && (this.state === 'TC' || this.state === 'TS' && this.phase === 2)) {
                data = bitDrives(D, transfer.data);
                // Inactive lanes are not used; represent them as high-Z in this
                // subset, not a claim about the silicon's unused-byte values.
                for (let i = 0; i < 16; i++) if (i < 8 ? transfer.a0 !== 0 : transfer.bhe_n !== 0) data[D[i]] = 'Z';
            }
            this.period = {state: this.state, phase: this.phase, held: this.writeHold > 0};
            const status = this.state === 'TS' ? this.control : {...this.control, s1_n: 1, s0_n: 1};
            this.outputs = {...bitDrives(A, this.address), ...status, ...data, lock_n: 1, hlda: 0, peack_n: 1};
            this.open = true;
            return {...this.outputs};
        } catch (error) { this.faulted = true; throw error; }
    }

    endClock(read) {
        if (!this.open) throw new CircuitFault('CLOCK_ORDER', 'beginClock required');
        this.open = false;
        this.clock++;
        const {state, phase, held} = this.period;
        let completion = null;
        let readySample = null;
        try {
            if (held) this.writeHold--;
            if (state === 'RESET') this.resetClocks++;
            else if (state === 'INIT') {
                if (--this.initClocks === 0) { this.state = 'TI'; this.phase = 2; }
            } else if (state === 'TS' && phase === 2) this.state = 'TC';
            else if (state === 'TC' && phase === 2) {
                const ready = known(read, 'ready_n');
                readySample = ready;
                if (ready) {
                    this.pending.waits++;
                    if (this.pending.waits >= this.maxWaitStates) throw new CircuitFault('WAIT_LIMIT', 'host diagnostic, not hardware timeout');
                } else {
                    const t = this.pending.transfers[this.pending.index];
                    const bytes = [];
                    for (const start of [0, 8]) {
                        if (start === 0 ? t.a0 !== 0 : t.bhe_n !== 0) continue;
                        let byte = 0;
                        for (let i = 0; i < 8; i++) byte |= known(read, D[start + i]) << i;
                        bytes.push(byte);
                    }
                    // Only report acceptance. A connected memory/controller owns
                    // writes and their edges; the sequencer has no backing RAM.
                    completion = Object.freeze({kind: t.kind, address: t.address, width: t.width,
                        data: bytes[0] | ((bytes[1] || 0) << 8), waits: this.pending.waits,
                        last: this.pending.index === this.pending.transfers.length - 1});
                    this.pending.bytes.push(...bytes);
                    if (t.kind.endsWith('write')) {
                        this.writeHold = 1;
                        this.heldData = Object.fromEntries(D.map(p => [p, this.outputs[p]]));
                    }
                    if (completion.last) {
                        completion = Object.freeze({...completion,
                            operand: this.pending.bytes[0] | ((this.pending.bytes[1] || 0) << 8)});
                        this.pending = null;
                    } else { this.pending.index++; this.pending.waits = 0; }
                    this.state = 'TI';
                }
            }
            this._record({state, phase, address: this.address,
                s1_n: this.outputs.s1_n, s0_n: this.outputs.s0_n,
                bhe_n: this.outputs.bhe_n, readySample,
                drives: Object.freeze({...this.outputs}), completion});
            if (state !== 'RESET') this.phase = this.phase === 1 ? 2 : 1;
            return completion;
        } catch (error) {
            this.faulted = true;
            this._record({state, phase, fault: error.code || 'ERROR'});
            throw error;
        }
    }

    getTrace() { return {dropped: this.dropped, entries: this.trace.map(e => ({...e}))}; }
}
