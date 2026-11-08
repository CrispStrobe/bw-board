/** Forward-only 386 debugging. Unsupported legacy decoding is explicit. */
import {createI8086DebugTarget} from './i8086-debug.js';
import {disasmI80386} from './i80386-disasm.js';

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
            stopSides: ['before'], installation: 'sync'}], recording: [],
        // Physical bus addressability, not a declaration of installed RAM.
        spaces: {mem: {read: true, write: false, passiveRead: true,
            addressSpace: 'physical', addressMin: 0, addressMax: 0xffffffff,
            maxReadBytes: 1048576}}});
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
    for (const name of ['setSymbols','symbolAt','writeMem','loadFirmware'])
        target[name] = () => unsupported(name);
    // Forward linear listing in the CURRENT code segment. Addresses are linear
    // (CS cache base + EIP), the same space as code breakpoints and the PC.
    // Paging would need a passive page walk, so it is refused rather than
    // guessed; reads use the observer-only physical path of readMem.
    const codeView = addr => {
        const cpu = machine.cpu;
        if (cpu.cr0 & 0x80000000) return null;
        const cache = cpu.segmentCaches[1];
        const code32 = cache.default32 === true && cpu.protectedMode && !cpu.virtual8086;
        const segmentBase = cache.base >>> 0;
        const mask = code32 ? 0xffffffff : 0xffff;
        const offset = (addr - segmentBase) >>> 0;
        const eip = offset <= mask ? offset : (code32 ? offset : addr & 0xffff);
        return {code32, eip, segmentBase: (addr - eip) >>> 0, mask};
    };
    const validCode = addr => Number.isSafeInteger(addr) && addr >= 0 && addr <= 0xffffffff;
    target.disasm = addr => {
        if (!validCode(addr)) return unsupported('disassembly outside unsigned 32-bit linear space');
        const view = codeView(addr);
        if (!view) return unsupported('disassembly with paging enabled');
        const byte = a => {
            const read = readMem('mem', a >>> 0, 1);
            return read && read.length ? read[0] & 0xff : 0;
        };
        return disasmI80386(byte, addr, {eip: view.eip, code32: view.code32});
    };
    target.nextCodeAddress = (addr, length) => {
        if (!validCode(addr) || !Number.isSafeInteger(length) || length < 0)
            return unsupported('code address progression requires unsigned 32-bit linear addresses');
        const view = codeView(addr);
        if (!view) return unsupported('code address progression with paging enabled');
        return (view.segmentBase + (((view.eip + length) & view.mask) >>> 0)) >>> 0;
    };
    target.captureCheckpoint = () => ({accepted: false, code: 'checkpoint-unsupported', reason: '386 architectural checkpoint is unsupported'});
    target.restoreCheckpoint = () => ({accepted: false, code: 'checkpoint-unsupported', reason: '386 architectural restore is unsupported'});
    target.replayInstruction = () => ({accepted: false, code: 'replay-unsupported', reason: '386 replay is unsupported'});
    target.canApplyReplayInput = () => false;
    target.replayInputRefusal = () => ({code: 'replay-unsupported', reason: '386 replay is unsupported'});
    target.applyReplayInput = () => ({accepted: false, ...target.replayInputRefusal()});
    target.replayRefusalReasons = () => ['386 architectural checkpoint/replay is unsupported'];
    // A deferred ordinary-JS stopped boundary, not a continuous live-disk lease.
    let snapshotBusy = false;
    target.snapshotAtaMaster = async () => {
        const refuse = (code, reason) => ({refused: {code, reason}});
        if (snapshotBusy) return refuse('snapshot-busy', 'A snapshot request is already pending');
        snapshotBusy = true;
        try {
            // A halt/event listener may still be inside machine.step/runFor.
            await Promise.resolve();
            if (target.state() !== 'halted') return refuse('snapshot-running', 'Pause the target before copying its master disk');
            if (adapter.nativeDispatcher) return refuse('snapshot-backend-unsupported', 'Native/background execution is not qualified for this boundary');
            if (typeof adapter.captureAtaMaster !== 'function') return refuse('snapshot-backend-unsupported', 'The adapter has no qualified master-copy operation');
            const subtle = globalThis.crypto?.subtle;
            if (globalThis.isSecureContext === false || typeof subtle?.digest !== 'function')
                return refuse('snapshot-hash-unavailable', 'WebCrypto SHA-256 is unavailable');
            const digest = subtle.digest.bind(subtle);
            const captured = adapter.captureAtaMaster();
            if (captured.refused) return captured;
            let hash;
            try { hash = new Uint8Array(await digest('SHA-256', captured.bytes)); }
            catch { return refuse('snapshot-hash-failed', 'SHA-256 could not hash the detached disk bytes'); }
            if (hash.length !== 32) return refuse('snapshot-hash-failed', 'SHA-256 returned an invalid digest extent');
            return {...captured, sha256: Array.from(hash, byte => byte.toString(16).padStart(2, '0')).join('')};
        } finally { snapshotBusy = false; }
    };
    return target;
}

export default createI80386DebugTarget;
