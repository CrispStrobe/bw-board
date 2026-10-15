/** Forward-only 386 debugging. Unsupported legacy decoding is explicit. */
import {createI8086DebugTarget} from './i8086-debug.js';

const unsupported = operation => ({unsupported: `386 ${operation} is not implemented by this forward-debug target`});
const validRange = (address, length) => Number.isSafeInteger(address) && address >= 0 &&
    Number.isSafeInteger(length) && length >= 0 && length <= 1048576 && address + length <= 0x100000000;

/** Copy architectural scalars only; never checkpoint, translate or touch a bus. */
export function captureI80386Registers(machine) {
    const cpu = machine.cpu;
    const result = {};
    for (const name of ['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3','cr4'])
        result[name] = cpu[name] >>> 0;
    for (const name of ['cs','ds','es','ss','fs','gs']) result[name] = cpu[name] & 0xffff;
    result.pc = cpu.pc >>> 0; // cached CS base + EIP, not visible selector << 4
    result.pcSpace = 'linear';
    result.protectedMode = cpu.protectedMode;
    result.virtual8086 = cpu.virtual8086;
    result.cpl = cpu.currentPrivilegeLevel;
    // Scalar cache fields keep event diffs value-based, with no live aliases.
    for (const [id, name] of ['es','cs','ss','ds','fs','gs'].entries())
        for (const [key, value] of Object.entries(cpu.segmentCaches[id]))
            result[name + 'Cache' + key[0].toUpperCase() + key.slice(1)] = value;
    for (const name of ['gdtr','idtr','ldtr','tr'])
        for (const [key, value] of Object.entries(cpu[name]))
            result[name + key[0].toUpperCase() + key.slice(1)] = value;
    for (let i = 0; i < cpu._debugRegisters.length; i++) result['dr' + i] = cpu._debugRegisters[i] >>> 0;
    result.cpuCycles = cpu.cycles;
    result.halted = cpu.halted;
    result.shutdown = cpu.shutdown;
    result.cycles = machine.cycles;
    return result;
}

export function createI80386DebugTarget(adapter) {
    const machine = adapter.machine;
    const target = createI8086DebugTarget(adapter, {cpuId: 'i80386', debugArchitecture: {
        // Synthetic completed-instruction count, not AT board scheduling time.
        timeDomain: 'i80386-completed-instructions',
        rewindLabel: 'rewind',
        eventClock: () => machine.cpu.cycles,
        timeHz: () => null,
        sharedEventClock: true,
        addressMax: 0xffffffff,
        unsignedMemoryAddresses: true,
        memoryAddress: address => address >>> 0,
        // No observer-only read on writes: VGA/MMIO reads can change devices.
        captureWriteBefore: false,
        pcOf: cpu => cpu.pc >>> 0,
        captureRegisters: () => captureI80386Registers(machine),
        captureInstruction: address => ({address, addressSpace: 'linear', unsupported: '386 mode-aware decoding unavailable'})
    }});
    const capabilities = target.capabilities.bind(target);
    const setBreakpoint = target.setBreakpoint.bind(target);
    const step = target.step.bind(target);
    const readMem = target.readMem.bind(target);
    target.capabilities = () => ({...capabilities(), steps: ['insn'], symbols: false,
        runTo: [{kind: 'address', space: 'code', addressMin: 0, addressMax: 0xffffffff,
            stopSides: ['before'], installation: 'sync'}], recording: []});
    target.regs = () => captureI80386Registers(machine);
    target.setBreakpoint = spec => {
        if (!spec || typeof spec !== 'object') return unsupported('breakpoint specification');
        if ((spec.kind === 'code' && (!Number.isSafeInteger(spec.addr) || spec.addr < 0 || spec.addr > 0xffffffff)) ||
            (spec.kind === 'write' && (!Number.isSafeInteger(spec.addr) || spec.addr < 0 ||
                !Number.isSafeInteger(spec.len ?? 1) || (spec.len ?? 1) < 1 || spec.addr + (spec.len ?? 1) > 0x100000000)))
            return unsupported('unsigned 32-bit breakpoint range');
        if (spec.symbol != null || spec.seg != null) return unsupported('symbol or selector:offset breakpoint');
        return setBreakpoint(spec); // code: linear PC; write: physical byte bus
    };
    target.step = (kind, count = 1) => kind === 'insn' && Number.isSafeInteger(count) && count > 0
        ? step(kind, count) : unsupported('step kind/count');
    target.readMem = (space, address, length) => space === 'io'
        ? readMem(space, address, length)
        : space === 'mem' && validRange(address, length)
            ? readMem(space, address, length) : unsupported('physical memory read range');
    for (const name of ['setSymbols','symbolAt','disasm','nextCodeAddress','writeMem','loadFirmware'])
        target[name] = () => unsupported(name);
    target.captureCheckpoint = () => ({accepted: false, code: 'checkpoint-unsupported', reason: '386 architectural checkpoint is unsupported'});
    target.restoreCheckpoint = () => ({accepted: false, code: 'checkpoint-unsupported', reason: '386 architectural restore is unsupported'});
    target.replayInstruction = () => ({accepted: false, code: 'replay-unsupported', reason: '386 replay is unsupported'});
    target.canApplyReplayInput = () => false;
    target.replayInputRefusal = () => ({code: 'replay-unsupported', reason: '386 replay is unsupported'});
    target.applyReplayInput = () => ({accepted: false, ...target.replayInputRefusal()});
    target.replayRefusalReasons = () => ['386 architectural checkpoint/replay is unsupported'];
    return target;
}

export default createI80386DebugTarget;
