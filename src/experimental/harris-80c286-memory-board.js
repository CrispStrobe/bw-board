/** Gated phase-level board: external address latch, controller, and existing RAM/ROM models. */
import {getDevice} from '../devices.js';
import {DigitalCircuit, CircuitFault, bitPins, readBits} from './digital-circuit.js';
import {Harris80C286Bus} from './harris-80c286-bus.js';
import {IdealAddressLatch, MemoryPhaseController, DigitalBusMemoryAdapter, settleBusMemories} from './latched-memory-components.js';

const A = bitPins('a', 24);
const D = bitPins('d', 16);
const INPUTS = {reset: 0, ready_n: 0, hold: 0, intr: 0, nmi: 0, pereq: 0, busy_n: 1, error_n: 1, vcc: 1, gnd: 0};
const wire = (from, fromTerminal, to, toTerminal) => ({from, fromTerminal, to, toTerminal});

export function createHarrisMemoryBoard({enabled = false, rom = new Uint8Array(), romLowAlias = false, nmiEnabled = false,
    intrEnabled = false, ioEnabled = false, interruptDevice = null, editWires = wires => wires} = {}) {
    if (enabled !== true) throw new CircuitFault('EXPERIMENT_DISABLED', 'enabled:true required');
    if (!(rom instanceof Uint8Array) || rom.length > 65536) throw new RangeError('ROM must be at most 64K');
    if (typeof romLowAlias !== 'boolean') throw new TypeError('romLowAlias must be boolean');
    for (const kind of ['62256', '28c256']) if (!getDevice(kind)) throw new CircuitFault('MEMORY_MODELS_REQUIRED', 'registerBusMemory() before construction');
    if (interruptDevice && (!intrEnabled || typeof interruptDevice.part !== 'function' || typeof interruptDevice.update !== 'function'))
        throw new TypeError('interruptDevice requires intrEnabled and part/update methods');
    const bus = new Harris80C286Bus({enabled,nmiEnabled,intrEnabled});
    const controller = new MemoryPhaseController({enabled,intrEnabled,ioEnabled});
    const picIO = interruptDevice?.ioInterface === 'harris-pic-byte-lanes';
    if (picIO && !ioEnabled) throw new TypeError('PIC port adapter requires ioEnabled:true');
    const latch = new IdealAddressLatch({enabled});
    const memories = [];
    const parts = [bus.part(), controller.part(), latch.part(),
        {id: 'inputs', pins: Object.keys(INPUTS), outputs: Object.keys(INPUTS)}];
    const wires = [];
    for (const p of Object.keys(INPUTS).filter(p => p !== 'vcc' && p !== 'gnd' && !(intrEnabled && p === 'ready_n') && !(interruptDevice && p === 'intr')))
        wires.push(wire('inputs', p, 'cpu', p));
    for (const p of ['reset', ...(intrEnabled ? [] : ['ready_n'])]) wires.push(wire('inputs', p, 'controller', p));
    if (intrEnabled) {
        // External ideal-digital wait logic, shared by CPU and controller.
        // No CPU pending/phase/transaction callback supplies READY.
        parts.push({id:'irq_ready',pins:['external_n','wait','ready_n'],outputs:['ready_n'],evaluate(read) {
            const a=read('external_n'),b=read('wait');
            return {ready_n:[a,b].every(v=>v===0||v===1)?a|b:'X'};
        }});
        wires.push(wire('inputs','ready_n','irq_ready','external_n'),wire('controller','inta_wait','irq_ready','wait'),
            wire('irq_ready','ready_n','cpu','ready_n'),wire('irq_ready','ready_n','controller','ready_n'));
    }
    const irqPart = interruptDevice?.part();
    if (irqPart) {
        parts.push(irqPart);
        wires.push(wire('inputs','reset',irqPart.id,'reset'),wire('controller','inta_n',irqPart.id,'inta_n'),wire(irqPart.id,'intr','cpu','intr'));
        for (const p of bitPins('d',picIO ? 16 : 8)) wires.push(wire(irqPart.id,p,'cpu',p));
        if (picIO) {
            for (const p of [...A,'bhe_n','m_io']) wires.push(wire('latch',`q_${p}`,irqPart.id,p));
            for (const p of ['ior_n','iow_n']) wires.push(wire('controller',p,irqPart.id,p));
            const ir = bitPins('ir',8);
            parts.push({id:'irq_inputs',pins:ir,outputs:ir});
            for (const p of ir) wires.push(wire('irq_inputs',p,irqPart.id,p));
        }
    }
    for (const p of ['s1_n', 's0_n', 'cod_inta_n', 'm_io']) wires.push(wire('cpu', p, 'controller', p));
    for (const p of [...A, 'bhe_n', 'm_io']) wires.push(wire('cpu', p, 'latch', p));
    wires.push(wire('controller', 'ale', 'latch', 'ale'));
    for (const kind of ['rom', 'ram']) for (let lane = 0; lane < 2; lane++) {
        const id = `${kind}${lane}`;
        const modelKind = kind === 'rom' ? '28c256' : '62256';
        const memory = new DigitalBusMemoryAdapter({enabled, id, kind: modelKind, model: getDevice(modelKind),
            contents: kind === 'rom' ? rom.filter((_, i) => i % 2 === lane) : new Uint8Array(), readOnly: kind === 'rom'});
        memories.push(memory); parts.push(memory.part());
        const decode = `${id}_decode`;
        parts.push({id: decode, pins: [...A, 'bhe_n', 'm_io', 'ce_n'], outputs: ['ce_n'], evaluate(read) {
            if (read('m_io') === 0 || (lane === 0 ? read('a0') === 1 : read('bhe_n') === 1)) return {ce_n: 1};
            const address = readBits(A, read);
            if (address === null || read('m_io') !== 1 || (lane === 1 && read('bhe_n') !== 0)) return {ce_n: 'X'};
            const inROM = address >= 0xff0000 || (romLowAlias && address >= 0xf0000 && address < 0x100000);
            return {ce_n: Number(!(kind === 'rom' ? inROM : address < 0x10000))};
        }});
        for (const p of [...A, 'bhe_n', 'm_io']) wires.push(wire('latch', `q_${p}`, decode, p));
        wires.push(wire(decode, 'ce_n', id, memory.select));
        for (let i = 0; i < 15; i++) wires.push(wire('latch', `q_a${i + 1}`, id, `a${i}`));
        for (let i = 0; i < 8; i++) wires.push(wire('cpu', D[i + 8 * lane], id, `d${i}`));
        wires.push(wire('controller', 'mrd_n', id, 'oeb'), wire('controller', 'mwr_n', id, 'web'));
        wires.push(wire('inputs', 'vcc', id, 'vcc'), wire('inputs', 'gnd', id, 'gnd'));
    }
    const circuit = new DigitalCircuit({enabled, parts, wires: editWires(wires.map(w => ({...w})))});
    circuit.drive('inputs', INPUTS);
    if (picIO) circuit.drive('irq_inputs',Object.fromEntries(bitPins('ir',8).map(p=>[p,0])));
    const settleInterruptDevice = () => {
        if (!irqPart) return;
        circuit.settle();
        circuit.drive(irqPart.id,interruptDevice.update(p=>circuit.require(irqPart.id,p)));
        circuit.settle();
    };
    let faulted = false;
    let periodOpen = false;
    return {
        capabilities: Object.freeze({experimental: true, cpu: false, snapshots: false,
            fidelity: 'latched-memory-phase-bridge', full82C288: false, analogSolver: false, nmi:nmiEnabled, intr:intrEnabled,
            io:ioEnabled, programmablePIC:picIO}),
        bus, circuit,
        hasPendingNMI() {return bus.nmiPending;},
        takeNMI() {return bus.takeNMI();},
        hasPendingINTR() {return intrEnabled && bus.intrSamples === 4;},
        beginClock(inputs = {}) {
            if (faulted) throw new CircuitFault('BOARD_FAULTED', 'reconstruct board; no automatic rollback');
            if (periodOpen) throw new CircuitFault('CLOCK_ORDER', 'endClock required');
            try {
                circuit.drive('inputs', inputs); circuit.settle(); settleInterruptDevice();
                circuit.drive('cpu', bus.beginClock(p => circuit.require('cpu', p))); circuit.settle();
                circuit.drive('controller', controller.beginClock(p => circuit.require('controller', p))); circuit.settle();
                settleInterruptDevice();
                circuit.drive('latch', latch.update(p => circuit.require('latch', p)));
                settleBusMemories(circuit, memories);
                periodOpen = true;
            } catch (error) { faulted = true; throw error; }
        },
        endClock() {
            if (faulted) throw new CircuitFault('BOARD_FAULTED', 'reconstruct board');
            if (!periodOpen) throw new CircuitFault('CLOCK_ORDER', 'beginClock required');
            periodOpen = false;
            try {
                const end = controller.previewEnd(p => circuit.require('controller', p));
                if (end.ready !== null && end.ready !== circuit.require('cpu', 'ready_n')) throw new CircuitFault('READY_MISMATCH', 'CPU and controller see different READY');
                const result = bus.endClock(p => circuit.require('cpu', p));
                const commands = end.finish();
                if (commands) {
                    circuit.drive('controller', commands);
                    settleInterruptDevice();
                    // This command transition, NOT result/callback, makes the
                    // reused memory model commit its pending write.
                    settleBusMemories(circuit, memories);
                }
                return result;
            } catch (error) { faulted = true; throw error; }
        },
        clock(inputs = {}) { this.beginClock(inputs); return this.endClock(); },
        initialize() {
            for (let i = 0; i < 17; i++) this.clock({reset: 1});
            for (let i = 0; i < 50; i++) this.clock({reset: 0});
        },
        submit(transaction) {
            if (faulted || periodOpen) throw new CircuitFault('BOARD_FAULTED', 'board unavailable');
            bus.submit(transaction);
        },
        inspectMemory(id) {
            const memory = memories.find(m => m.id === id);
            if (!memory) throw new Error(`unknown memory ${id}`);
            return memory.inspect();
        }
    };
}
