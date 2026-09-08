/**
 * Synthetic, transaction-level master on resolved digital nets. NOT an 80286,
 * an 82C288, or their clock/status protocol. This tests the M1 circuit boundary
 * before a datasheet-grounded CPU sequencer is attached. No production import.
 */
import {DigitalCircuit, CircuitFault, bitPins, bitDrives, readBits} from './digital-circuit.js';

const A = bitPins('a', 24);
const D = bitPins('d', 16);
const BA = bitPins('a', 15);
const BD = bitPins('d', 8);
const CONTROL = ['rd', 'wr', 'low', 'high']; // abstract ACTIVE HIGH controls
const connect = (from, fromTerminal, to, toTerminal) => ({from, fromTerminal, to, toTerminal});

function bank(id, contents, readOnly) {
    const mem = new Uint8Array(32768).fill(readOnly ? 255 : 0);
    mem.set(contents);
    let writes = 0;
    return {
        part: {
            id, pins: [...BA, ...BD, 'ce', 'rd', 'wr'], outputs: BD,
            evaluate(read) {
                const controls = ['ce', 'rd', 'wr'].map(read);
                if (controls[0] === 0 || controls[1] === 0 || controls[2] === 1) return {};
                const address = readBits(BA, read);
                if (controls.some(v => v !== 0 && v !== 1) || address === null) {
                    return Object.fromEntries(BD.map(p => [p, 'X']));
                }
                return bitDrives(BD, mem[address]);
            }
        },
        // Validate all selected banks before committing ANY bank. No writes
        // during settle() or while READY is low; repeated host calls are safe.
        prepare(circuit) {
            if (circuit.require(id, 'ce') === 0 || circuit.require(id, 'wr') === 0) return null;
            if (readOnly) throw new CircuitFault('READ_ONLY', id);
            const address = readBits(BA, p => circuit.require(id, p));
            const value = readBits(BD, p => circuit.require(id, p));
            return () => { mem[address] = value; writes++; };
        },
        inspect: () => ({bytes: mem.slice(), writes})
    };
}

/**
 * Two byte-wide 32K banks each for ROM (FF0000-FFFFFF) and RAM (000000-00FFFF).
 * Wiring is explicit and uses the editor's wire shape. editWires supports
 * broken-wire fixtures without any memory callback bypass. Topology is fixed
 * after construction; reconstruct the experiment to edit it.
 */
export function createWiredBusLab({enabled = false, rom = new Uint8Array(), editWires = w => w,
    maxWaitTicks = 32, traceLimit = 128} = {}) {
    if (enabled !== true) throw new CircuitFault('EXPERIMENT_DISABLED', 'explicit enabled:true required');
    if (!(rom instanceof Uint8Array) || rom.length > 65536) throw new RangeError('ROM must be Uint8Array, at most 64K');
    for (const [name, value] of Object.entries({maxWaitTicks, traceLimit})) {
        if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(name);
    }
    const parts = [
        {id: 'master', pins: [...A, ...D, ...CONTROL, 'ready'], outputs: [...A, ...D, ...CONTROL]},
        {id: 'ready', pins: ['out'], outputs: ['out']}
    ];
    const wires = [connect('ready', 'out', 'master', 'ready')];
    const banks = [];
    for (const kind of ['rom', 'ram']) for (let lane = 0; lane < 2; lane++) {
        const id = `${kind}${lane}`;
        const bytes = kind === 'rom' ? rom.filter((_, i) => i % 2 === lane) : new Uint8Array();
        const memory = bank(id, bytes, kind === 'rom');
        banks.push(memory);
        parts.push(memory.part);
        const decoder = `${id}_decode`;
        parts.push({id: decoder, pins: [...A, 'lane', 'ce'], outputs: ['ce'], evaluate(read) {
            const selectedLane = read('lane');
            if (selectedLane === 0) return {ce: 0};
            const address = readBits(A, read);
            if (address === null || selectedLane !== 1) return {ce: 'X'};
            return {ce: Number(kind === 'rom' ? address >= 0xff0000 : address < 0x10000)};
        }});
        for (const p of A) wires.push(connect('master', p, decoder, p));
        wires.push(connect('master', lane ? 'high' : 'low', decoder, 'lane'));
        wires.push(connect(decoder, 'ce', id, 'ce'));
        for (let i = 0; i < 15; i++) wires.push(connect('master', A[i + 1], id, BA[i]));
        for (let i = 0; i < 8; i++) wires.push(connect('master', D[i + lane * 8], id, BD[i]));
        for (const p of ['rd', 'wr']) wires.push(connect('master', p, id, p));
    }
    const circuit = new DigitalCircuit({enabled, parts, wires: editWires(wires.map(w => ({...w})))});
    let tick = 0;
    let pending = null;
    let faulted = false;
    let dropped = 0;
    const trace = [];
    const release = () => {
        circuit.drive('master', {...bitDrives(A, 0), rd: 0, wr: 0, low: 0, high: 0,
            ...Object.fromEntries(D.map(p => [p, 'Z']))});
        circuit.settle();
    };
    const record = entry => {
        if (trace.length === traceLimit) { trace.shift(); dropped++; }
        trace.push(Object.freeze({tick, ...entry}));
    };
    release();
    circuit.drive('ready', {out: 1});
    circuit.settle();
    return {
        capabilities: Object.freeze({experimental: true, cpu: null, fidelity: 'synthetic-transactions',
            clockStepping: false, snapshots: false, protectedMode: false}),
        circuit,
        begin({address, width = 1, write = false, value = 0}) {
            if (pending || faulted) throw new CircuitFault('BUS_UNAVAILABLE', 'cancel/reset experiment before reuse');
            if (!Number.isSafeInteger(address) || address < 0 || address > 0xffffff) throw new RangeError('address');
            if (width !== 1 && width !== 2) throw new RangeError('width');
            if (width === 2 && address % 2) throw new CircuitFault('UNSUPPORTED', 'odd word: caller must issue two byte transactions');
            if (typeof write !== 'boolean') throw new TypeError('write must be boolean');
            if (!Number.isInteger(value) || value < 0 || value >= 2 ** (8 * width)) throw new RangeError('value');
            const high = width === 2 || address % 2 === 1;
            const low = width === 2 || !high;
            pending = {address, width, write, value, high, low, waits: 0};
            const data = bitDrives(D, width === 1 && high ? value << 8 : value);
            for (let i = 0; i < 16; i++) if (!write || (i < 8 ? !low : !high)) data[D[i]] = 'Z';
            circuit.drive('master', {...bitDrives(A, address), ...data, rd: Number(!write),
                wr: Number(write), low: Number(low), high: Number(high)});
        },
        setReady(value) { circuit.drive('ready', {out: value}); },
        step() {
            if (!pending || faulted) throw new CircuitFault('BUS_UNAVAILABLE', 'no runnable transaction');
            if (tick >= Number.MAX_SAFE_INTEGER) throw new RangeError('tick overflow');
            tick++;
            try {
                circuit.settle();
                if (!circuit.require('master', 'ready')) {
                    pending.waits++;
                    record({phase: 'wait', address: pending.address, waits: pending.waits});
                    if (pending.waits >= maxWaitTicks) throw new CircuitFault('TIMEOUT', `READY low at ${pending.address.toString(16)}`);
                    return null;
                }
                // Resolve selected lanes even on writes to detect conflicts.
                const selected = D.filter((_, i) => i < 8 ? pending.low : pending.high);
                const data = readBits(selected, p => circuit.require('master', p));
                const commits = pending.write ? banks.map(b => b.prepare(circuit)).filter(Boolean) : [];
                if (pending.write && commits.length !== pending.width) {
                    throw new CircuitFault('UNMAPPED_WRITE', pending.address.toString(16));
                }
                for (const commit of commits) commit();
                const result = Object.freeze({...pending, data, tick});
                record({phase: 'complete', ...result});
                pending = null;
                release();
                return result;
            } catch (error) {
                faulted = true;
                record({phase: 'fault', code: error.code || 'ERROR', message: error.message});
                throw error;
            }
        },
        cancel() { pending = null; faulted = false; release(); },
        inspectMemory(id) {
            const memory = banks.find(b => b.part.id === id);
            if (!memory) throw new Error(`unknown bank ${id}`);
            return memory.inspect();
        },
        getTrace: () => ({dropped, entries: trace.map(e => ({...e}))})
    };
}
