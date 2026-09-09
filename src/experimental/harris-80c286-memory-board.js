/** Gated phase-level board: external address latch, controller, and existing RAM/ROM models. */
import {getDevice} from '../devices.js';
import {DigitalCircuit, CircuitFault, bitPins, readBits} from './digital-circuit.js';
import {CompiledDigitalCircuit} from './compiled-digital-circuit.js';
import {Harris80C286Bus} from './harris-80c286-bus.js';
import {HarrisTimerClock} from './harris-8254-adapter.js';
import {IdealAddressLatch, MemoryPhaseController, DigitalBusMemoryAdapter, settleBusMemories} from './latched-memory-components.js';

const A = bitPins('a', 24);
const D = bitPins('d', 16);
const INPUTS = {reset: 0, ready_n: 0, hold: 0, intr: 0, nmi: 0, pereq: 0, busy_n: 1, error_n: 1, vcc: 1, gnd: 0};
const wire = (from, fromTerminal, to, toTerminal) => ({from, fromTerminal, to, toTerminal});

export function createHarrisMemoryBoard({enabled = false, rom = new Uint8Array(), romLowAlias = false, nmiEnabled = false,
    intrEnabled = false, ioEnabled = false, interruptDevice = null, timerDevice = null, fdcDevice = null, dmaDevice = null, keyboardDevice = null,
    timerClockHalfPeriod = 8, ramBytes = 65536, textRAM = false, holdEnabled = false, netBackend = 'reference', busTraceEnabled = true,
    memoryScheduling = false, memoryWriteJournal = false, editWires = wires => wires} = {}) {
    if (enabled !== true) throw new CircuitFault('EXPERIMENT_DISABLED', 'enabled:true required');
    if(!['reference','compiled'].includes(netBackend))throw new TypeError('netBackend must be reference or compiled');
    if(typeof memoryScheduling!=='boolean'||memoryScheduling&&netBackend!=='compiled')throw new TypeError('memoryScheduling requires compiled backend and boolean opt-in');
    if(typeof memoryWriteJournal!=='boolean')throw new TypeError('memoryWriteJournal');
    if (!(rom instanceof Uint8Array) || rom.length > 65536) throw new RangeError('ROM must be at most 64K');
    if (typeof romLowAlias !== 'boolean') throw new TypeError('romLowAlias must be boolean');
    if (!Number.isInteger(ramBytes) || ramBytes < 65536 || ramBytes > 640*1024 || ramBytes % 65536)
        throw new RangeError('ramBytes must be 64 KiB through 640 KiB in 64 KiB increments');
    if (typeof textRAM !== 'boolean') throw new TypeError('textRAM must be boolean');
    for (const kind of ['62256', '28c256']) if (!getDevice(kind)) throw new CircuitFault('MEMORY_MODELS_REQUIRED', 'registerBusMemory() before construction');
    if (interruptDevice && (!intrEnabled || typeof interruptDevice.part !== 'function' || typeof interruptDevice.update !== 'function'))
        throw new TypeError('interruptDevice requires intrEnabled and part/update methods');
    const bus = new Harris80C286Bus({enabled,nmiEnabled,intrEnabled,holdEnabled,traceEnabled:busTraceEnabled});
    const controller = new MemoryPhaseController({enabled,intrEnabled,ioEnabled});
    const picIO = interruptDevice?.ioInterface === 'harris-pic-byte-lanes';
    if (picIO && !ioEnabled) throw new TypeError('PIC port adapter requires ioEnabled:true');
    if (timerDevice && (!picIO || !ioEnabled || timerDevice.ioInterface !== 'harris-pit-byte-lanes' ||
        typeof timerDevice.part !== 'function' || typeof timerDevice.update !== 'function'))
        throw new TypeError('timerDevice requires the PIC/I/O path and a PIT byte-lane adapter');
    if (timerDevice && timerDevice.portBase < interruptDevice.portBase+2 && interruptDevice.portBase < timerDevice.portBase+4)
        throw new CircuitFault('IO_PORT_CONFLICT','PIC and PIT ranges overlap');
    const timerClock = timerDevice ? new HarrisTimerClock({enabled,halfPeriod:timerClockHalfPeriod}) : null;
    if (fdcDevice && (!picIO || !ioEnabled || fdcDevice.ioInterface !== 'harris-fdc-byte-lanes' ||
        typeof fdcDevice.part !== 'function' || typeof fdcDevice.update !== 'function'))
        throw new TypeError('fdcDevice requires the PIC/I/O path and FDC byte-lane adapter');
    if (fdcDevice) for (const [device,size] of [[interruptDevice,2],[timerDevice,4]])
        if (device && fdcDevice.portBase < device.portBase+size && device.portBase < fdcDevice.portBase+8)
            throw new CircuitFault('IO_PORT_CONFLICT','FDC range overlaps another device');
    if (dmaDevice && (!picIO || !ioEnabled || dmaDevice.ioInterface !== 'harris-dma-registers' ||
        typeof dmaDevice.part !== 'function' || typeof dmaDevice.update !== 'function'))
        throw new TypeError('dmaDevice requires the PIC/I/O path and DMA register adapter');
    const dmaTransfer=dmaDevice?.transferEnabled===true;
    if(keyboardDevice&&(!picIO||!ioEnabled||keyboardDevice.ioInterface!=='harris-keyboard-byte-lanes'))throw new TypeError('keyboard requires PIC/I/O');
    if(keyboardDevice)for(const [device,size] of [[interruptDevice,2],[timerDevice,4],[fdcDevice,8]])
        if(device&&0x60<device.portBase+size&&device.portBase<0x64)throw new CircuitFault('IO_PORT_CONFLICT','keyboard ports overlap');
    if ((dmaTransfer||fdcDevice?.transferEnabled)&&!(dmaTransfer&&fdcDevice?.transferEnabled&&holdEnabled))
        throw new TypeError('physical transfers require DMA/FDC transfer opt-ins and holdEnabled');
    if (dmaDevice) for (const [device,size] of [[interruptDevice,2],[timerDevice,4],[fdcDevice,8]])
        for (const [start,end] of [[0,16],[0x81,0x82]])
            if (device && start < device.portBase+size && device.portBase < end)
                throw new CircuitFault('IO_PORT_CONFLICT','DMA registers overlap another device');
    const latch = new IdealAddressLatch({enabled});
    const memories = [];
    const parts = [bus.part(), controller.part(), latch.part(),
        {id: 'inputs', pins: Object.keys(INPUTS), outputs: Object.keys(INPUTS)}];
    const wires = [];
    for (const p of Object.keys(INPUTS).filter(p => p !== 'vcc' && p !== 'gnd' && !(dmaTransfer&&p==='hold') && !(intrEnabled && p === 'ready_n') && !(interruptDevice && p === 'intr')))
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
            for (const p of ir.filter(p=>(!timerDevice||p!=='ir0')&&(!fdcDevice||p!=='ir6')&&(!keyboardDevice||p!=='ir1'))) wires.push(wire('irq_inputs',p,irqPart.id,p));
        }
    }
    const timerPart = timerDevice?.part();
    if (timerPart) {
        parts.push(timerPart,timerClock.part(),{id:'timer_inputs',pins:['gate0'],outputs:['gate0']});
        wires.push(wire('inputs','reset',timerPart.id,'reset'),wire('inputs','reset','timer_clock','reset'),
            wire('timer_clock','clk',timerPart.id,'clk0'),wire('timer_inputs','gate0',timerPart.id,'gate0'),
            wire(timerPart.id,'out0',irqPart.id,'ir0'));
        for (const p of D) wires.push(wire(timerPart.id,p,'cpu',p));
        for (const p of [...A,'bhe_n','m_io']) wires.push(wire('latch',`q_${p}`,timerPart.id,p));
        for (const p of ['ior_n','iow_n']) wires.push(wire('controller',p,timerPart.id,p));
    }
    const fdcPart = fdcDevice?.part();
    if (fdcPart) {
        parts.push(fdcPart);
        wires.push(wire('inputs','reset',fdcPart.id,'reset'),wire(fdcPart.id,'irq6',irqPart.id,'ir6'));
        for (const p of D) wires.push(wire(fdcPart.id,p,'cpu',p));
        for (const p of [...A,'bhe_n','m_io']) wires.push(wire('latch',`q_${p}`,fdcPart.id,p));
        for (const p of ['ior_n','iow_n']) wires.push(wire('controller',p,fdcPart.id,p));
    }
    const keyboardPart=keyboardDevice?.part();
    if(keyboardPart){
        parts.push(keyboardPart);wires.push(wire('inputs','reset',keyboardPart.id,'reset'),wire(keyboardPart.id,'irq1',irqPart.id,'ir1'));
        for(const p of D)wires.push(wire(keyboardPart.id,p,'cpu',p));
        for(const p of [...A,'bhe_n','m_io'])wires.push(wire('latch',`q_${p}`,keyboardPart.id,p));
        for(const p of ['ior_n','iow_n'])wires.push(wire('controller',p,keyboardPart.id,p));
    }
    const dmaPart = dmaDevice?.part();
    if (dmaPart) {
        parts.push(dmaPart,{id:'dma_inputs',pins:['dreq2'],outputs:['dreq2']});
        wires.push(wire('inputs','reset',dmaPart.id,'reset'),wire(dmaTransfer?fdcPart.id:'dma_inputs','dreq2',dmaPart.id,'dreq2'));
        for (const p of D) wires.push(wire(dmaPart.id,p,'cpu',p));
        for (const p of [...A,'bhe_n','m_io']) wires.push(wire('latch',`q_${p}`,dmaPart.id,dmaTransfer?`io_${p}`:p));
        for (const p of ['ior_n','iow_n']) wires.push(wire('controller',p,dmaPart.id,p));
        if(dmaTransfer){
            for(const p of [...A,'bhe_n','m_io','cod_inta_n'])wires.push(wire(dmaPart.id,p,'cpu',p));
            wires.push(wire(dmaPart.id,'hold','cpu','hold'),wire('cpu','hlda',dmaPart.id,'hlda'),
                wire(dmaPart.id,'dack2_n',fdcPart.id,'dack2_n'),wire(dmaPart.id,'tc',fdcPart.id,'tc'),
                wire('cpu','a0',fdcPart.id,'dma_a0'),wire('controller','mwr_n',fdcPart.id,'dma_write_n'));
        }
    }
    if (holdEnabled) {
        const status=['s1_n','s0_n','cod_inta_n','m_io'];
        parts.push({id:'bus_owner',pins:['hlda',...status,...status.map(p=>`q_${p}`),...(dmaTransfer?status.map(p=>`dma_${p}`):[])],outputs:status.map(p=>`q_${p}`),evaluate(read){
            const held=read('hlda');
            const passive=!dmaTransfer||read('dma_s0_n')===1&&read('dma_s1_n')===1;
            return Object.fromEntries(status.map(p=>[`q_${p}`,held===0?read(p):held===1?(passive?Number(p==='s1_n'||p==='s0_n'):read(`dma_${p}`)):'X']));
        }});
        wires.push(wire('cpu','hlda','bus_owner','hlda'));
        for (const p of status) wires.push(wire('cpu',p,'bus_owner',p),wire('bus_owner',`q_${p}`,'controller',p));
        if(dmaTransfer)for(const p of status)wires.push(wire(dmaPart.id,p,'bus_owner',`dma_${p}`));
    } else for (const p of ['s1_n', 's0_n', 'cod_inta_n', 'm_io']) wires.push(wire('cpu', p, 'controller', p));
    for (const p of [...A, 'bhe_n', 'm_io']) wires.push(wire('cpu', p, 'latch', p));
    wires.push(wire('controller', 'ale', 'latch', 'ale'));
    // Every window is backed by two real registered x8 memory adapters.
    // Keep default chip IDs/topology stable; extra banks are explicit parts.
    const regions = [{kind:'rom',id:'rom',start:0xff0000,end:0x1000000},
        ...Array.from({length:ramBytes/65536},(_,bank)=>({kind:'ram',id:bank ? `ram${bank}_` : 'ram',start:bank*65536,end:(bank+1)*65536})),
        ...(textRAM ? [{kind:'ram',id:'text',start:0xb8000,end:0xc0000}] : [])];
    const memoryMap = Object.freeze(regions.map(r=>Object.freeze({...r,
        aliases:Object.freeze(kindAliases(r)),
        chips:Object.freeze([`${r.id}0`,`${r.id}1`])})));
    function kindAliases(region) {
        return region.kind === 'rom' && romLowAlias ? [Object.freeze({start:0xf0000,end:0x100000})] : [];
    }
    for (const region of regions) for (let lane = 0; lane < 2; lane++) {
        const {kind} = region;
        const id = `${region.id}${lane}`;
        const modelKind = kind === 'rom' ? '28c256' : '62256';
        const memory = new DigitalBusMemoryAdapter({enabled, id, kind: modelKind, model: getDevice(modelKind),
            contents: kind === 'rom' ? rom.filter((_, i) => i % 2 === lane) : new Uint8Array(), readOnly: kind === 'rom',writeJournal:memoryWriteJournal});
        memories.push(memory); parts.push(memory.part());
        const decode = `${id}_decode`;
        parts.push({id: decode, pins: [...A, 'bhe_n', 'm_io', 'ce_n'], outputs: ['ce_n'], evaluate(read) {
            if (read('m_io') === 0 || (lane === 0 ? read('a0') === 1 : read('bhe_n') === 1)) return {ce_n: 1};
            const address = readBits(A, read);
            if (address === null || read('m_io') !== 1 || (lane === 1 && read('bhe_n') !== 0)) return {ce_n: 'X'};
            const selected = address >= region.start && address < region.end ||
                kind === 'rom' && romLowAlias && address >= 0xf0000 && address < 0x100000;
            return {ce_n: Number(!selected)};
        }});
        for (const p of [...A, 'bhe_n', 'm_io']) wires.push(wire('latch', `q_${p}`, decode, p));
        wires.push(wire(decode, 'ce_n', id, memory.select));
        for (let i = 0; i < 15; i++) wires.push(wire('latch', `q_a${i + 1}`, id, `a${i}`));
        for (let i = 0; i < 8; i++) wires.push(wire('cpu', D[i + 8 * lane], id, `d${i}`));
        wires.push(wire('controller', 'mrd_n', id, 'oeb'), wire('controller', 'mwr_n', id, 'web'));
        wires.push(wire('inputs', 'vcc', id, 'vcc'), wire('inputs', 'gnd', id, 'gnd'));
    }
    const Circuit=netBackend==='compiled'?CompiledDigitalCircuit:DigitalCircuit;
    const circuit = new Circuit({enabled, parts, wires: editWires(wires.map(w => ({...w})))});
    // Compile bindings once, but keep the reference path dynamically dispatching
    // diagnostic overrides of require/drive. Neither path bypasses resolved nets.
    const bind = id => netBackend === 'compiled' ? circuit.bind(id) : {
        require: pin => circuit.require(id, pin), drive: values => circuit.drive(id, values)
    };
    const cpuPins = bind('cpu'), controllerPins = bind('controller'), latchPins = bind('latch'), inputPins = bind('inputs');
    const irqPins = irqPart && bind(irqPart.id), timerPins = timerPart && bind(timerPart.id);
    const fdcPins = fdcPart && bind(fdcPart.id), dmaPins = dmaPart && bind(dmaPart.id);
    const keyboardPins = keyboardPart && bind(keyboardPart.id), clockPins = timerClock && bind('timer_clock');
    const memoryPins = memories.map(memory => memoryScheduling ? memory.scheduledBinding(bind(memory.id)) : bind(memory.id));
    const masterRead = dmaPart && (pin => pin === 'ready_n' ? controllerPins.require(pin) : dmaPins.require(pin));
    circuit.drive('inputs', INPUTS);
    if (picIO) circuit.drive('irq_inputs',Object.fromEntries(bitPins('ir',8).map(p=>[p,0])));
    if (timerPart) circuit.drive('timer_inputs',{gate0:1});
    if (dmaPart) circuit.drive('dma_inputs',{dreq2:0});
    const settleInterruptDevice = () => {
        if (!irqPart) return;
        circuit.settle();
        if (timerPart) {
            timerPins.drive(timerDevice.update(timerPins.require));
            circuit.settle();
        }
        if (fdcPart) {
            fdcPins.drive(fdcDevice.update(fdcPins.require));
            circuit.settle();
        }
        if (dmaPart) {
            dmaPins.drive(dmaDevice.update(dmaPins.require));
            circuit.settle();
        }
        if(keyboardPart){keyboardPins.drive(keyboardDevice.update(keyboardPins.require));circuit.settle();}
        irqPins.drive(interruptDevice.update(irqPins.require));
        circuit.settle();
    };
    let faulted = false;
    let periodOpen = false;
    return {
        capabilities: Object.freeze({experimental: true, cpu: false, snapshots: false,
            fidelity: 'latched-memory-phase-bridge', full82C288: false, analogSolver: false, nmi:nmiEnabled, intr:intrEnabled,
            io:ioEnabled, programmablePIC:picIO, programmableTimer:!!timerPart, fdcControl:!!fdcPart, dmaRegisters:!!dmaPart, dma:dmaTransfer,
            ramBytes, textRAM, hold:holdEnabled, displayController:false, netBackend, busTraceEnabled, memoryScheduling, memoryWriteJournal}),
        bus, circuit, memoryMap,
        hasPendingNMI() {return bus.nmiPending;},
        takeNMI() {return bus.takeNMI();},
        hasPendingINTR() {return intrEnabled && bus.intrSamples === 4;},
        beginClock(inputs = {}) {
            if (faulted) throw new CircuitFault('BOARD_FAULTED', 'reconstruct board; no automatic rollback');
            if (periodOpen) throw new CircuitFault('CLOCK_ORDER', 'endClock required');
            try {
                inputPins.drive(inputs); circuit.settle();
                if (timerClock) {
                    clockPins.drive(timerClock.advance(clockPins.require));
                    circuit.settle();
                }
                settleInterruptDevice();
                cpuPins.drive(bus.beginClock(cpuPins.require)); circuit.settle();
                if(dmaTransfer){dmaPins.drive(dmaDevice.beginMaster(dmaPins.require));circuit.settle();}
                controllerPins.drive(controller.beginClock(controllerPins.require)); circuit.settle();
                settleInterruptDevice();
                latchPins.drive(latch.update(latchPins.require));
                settleBusMemories(circuit, memories, 8, memoryPins);
                periodOpen = true;
            } catch (error) { faulted = true; throw error; }
        },
        endClock() {
            if (faulted) throw new CircuitFault('BOARD_FAULTED', 'reconstruct board');
            if (!periodOpen) throw new CircuitFault('CLOCK_ORDER', 'beginClock required');
            periodOpen = false;
            try {
                const end = controller.previewEnd(controllerPins.require);
                if (end.ready !== null && end.ready !== cpuPins.require('ready_n')) throw new CircuitFault('READY_MISMATCH', 'CPU and controller see different READY');
                const result = bus.endClock(cpuPins.require);
                if(dmaTransfer){
                    const drives=dmaDevice.endMaster(masterRead);
                    if(drives){dmaPins.drive(drives);settleInterruptDevice();}
                }
                const commands = end.finish();
                if (commands) {
                    controllerPins.drive(commands);
                    settleInterruptDevice();
                    // This command transition, NOT result/callback, makes the
                    // reused memory model commit its pending write.
                    settleBusMemories(circuit, memories, 8, memoryPins);
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
