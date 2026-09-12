/** Saved construction recipe, NOT a live snapshot or general Circuit Editor loader. */
import {CircuitFault} from './digital-circuit.js';
import {createHarrisMemoryBoard} from './harris-80c286-memory-board.js';
import {HarrisBootCPU} from './harris-80c286-boot-cpu.js';

const PROFILE = 'harris-latched-memory-v1';
const BACKEND = 'harris-286-boot-subset';
const PARTS = [
    ['cpu', BACKEND], ['controller', 'ideal-memory-phase-controller'],
    ['latch', 'ideal-address-latch'], ['inputs', 'digital-inputs'],
    ...['rom0', 'rom1', 'ram0', 'ram1'].flatMap(id => [
        [id, id.startsWith('rom') ? '28c256' : '62256'], [id + '_decode', 'profile-address-decoder']
    ])
].map(([id, type]) => ({id, type}));
const fail = (code, detail) => { throw new CircuitFault(code, detail); };
const gate = enabled => { if (enabled !== true) fail('EXPERIMENT_DISABLED', 'enabled:true required'); };
const copy = value => JSON.parse(JSON.stringify(value));
function keys(value, expected) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) {
        fail('INVALID_CIRCUIT_DOCUMENT', 'unexpected or missing fields');
    }
}
function validate(doc) {
    keys(doc, ['format', 'version', 'profile', 'backend', 'romLowAlias', 'rom', 'parts', 'wires']);
    if (doc.format !== 'bw-experimental-circuit' || doc.version !== 1 || doc.profile !== PROFILE)
        fail('UNSUPPORTED_CIRCUIT_PROFILE', 'unknown format, version or profile');
    if (doc.backend !== BACKEND) fail('UNSUPPORTED_BACKEND', String(doc.backend));
    if (typeof doc.romLowAlias !== 'boolean' || !Array.isArray(doc.rom) || doc.rom.length > 65536 ||
        Array.from(doc.rom).some(b => !Number.isInteger(b) || b < 0 || b > 255))
        fail('INVALID_CIRCUIT_DOCUMENT', 'invalid ROM or alias');
    if (!Array.isArray(doc.parts) || doc.parts.length !== PARTS.length)
        fail('UNSUPPORTED_PARTS', 'fixed profile inventory required');
    const remaining = new Map(PARTS.map(p => [p.id, p.type]));
    for (const part of doc.parts) {
        keys(part, ['id', 'type']);
        if (!remaining.has(part.id) || remaining.get(part.id) !== part.type)
            fail('UNSUPPORTED_PARTS', 'unknown, duplicate or mismatched part');
        remaining.delete(part.id);
    }
    if (!Array.isArray(doc.wires) || doc.wires.length > 4096)
        fail('INVALID_CIRCUIT_DOCUMENT', 'wire limit is 4096');
    for (const wire of doc.wires) {
        keys(wire, ['from', 'fromTerminal', 'to', 'toTerminal']);
        if (Object.values(wire).some(v => typeof v !== 'string'))
            fail('INVALID_CIRCUIT_DOCUMENT', 'wire endpoints must be strings');
    }
}

export function createHarrisCircuitDocument({enabled = false, rom = new Uint8Array(), romLowAlias = false} = {}) {
    gate(enabled);
    let wires;
    // Reuse the authoritative topology builder; no clock or CPU execution occurs.
    createHarrisMemoryBoard({enabled, rom, romLowAlias, editWires(value) { wires = value; return value; }});
    return {format: 'bw-experimental-circuit', version: 1, profile: PROFILE, backend: BACKEND,
        romLowAlias, rom: [...rom], parts: copy(PARTS), wires};
}

export function loadHarrisCircuitSession(document, {enabled = false} = {}) {
    gate(enabled);
    const parsed = typeof document === 'string' ? JSON.parse(document) : document;
    validate(parsed);
    const recipe = copy(parsed);
    const board = createHarrisMemoryBoard({enabled, rom: Uint8Array.from(recipe.rom),
        romLowAlias: recipe.romLowAlias, editWires: () => copy(recipe.wires)});
    const cpu = new HarrisBootCPU({enabled, board});
    const breakpoints = new Set();
    let stoppedAt = null;
    const unsupported = () => fail('UNSUPPORTED_DEBUG_OPERATION', 'no live snapshots, mutation, hot swap or physical-memory peeks');
    const budget = n => { if (!Number.isSafeInteger(n) || n < 1) throw new RangeError('maxClocks'); };
    const result = (reason, clocks) => ({reason, clocks, cpu: cpu.inspect()});
    function execute(maxClocks, singleInstruction, ready_n) {
        budget(maxClocks);
        if (ready_n !== 0 && ready_n !== 1) throw new RangeError('ready_n');
        const retired = cpu.retired;
        const skip = singleInstruction ? null : stoppedAt;
        stoppedAt = null;
        let clocks = 0;
        while (cpu.status === 'running' && clocks < maxClocks) {
            const state = cpu.inspect();
            const address = state.csBase + state.ip;
            if (!singleInstruction && state.instructionBoundary && breakpoints.has(address) &&
                !(clocks === 0 && skip === address)) {
                stoppedAt = address;
                return result('breakpoint', clocks);
            }
            cpu.stepClock(ready_n); clocks++;
            if (singleInstruction && cpu.retired !== retired) return result(cpu.status === 'running' ? 'instruction' : cpu.status, clocks);
        }
        return result(cpu.status === 'running' ? 'budget-exhausted' : cpu.status, clocks);
    }
    return Object.freeze({
        capabilities: Object.freeze({experimental: true, profile: PROFILE, backend: BACKEND,
            savedConfiguration: true, snapshots: false, clockStep: true, instructionStep: true,
            physicalCodeBreakpoints: true, bankInspection: true, netInspection: true,
            boundaryD: false, hotSwap: false, liveEditing: false}),
        initialize() {
            if (cpu.status !== 'uninitialized') fail('SESSION_ALREADY_INITIALIZED', 'reload recipe for a fresh machine');
            cpu.initialize(); return cpu.inspect();
        },
        inspect: () => cpu.inspect(),
        exportConfiguration: () => copy(recipe),
        inspectBank: id => board.inspectMemory(id),
        inspectNet: (id, pin) => board.circuit.inspect(id, pin),
        trace: () => board.bus.getTrace(),
        stepClock(ready_n = 0) { stoppedAt = null; cpu.stepClock(ready_n); return result('clock', 1); },
        stepInstruction: (maxClocks = 4096, ready_n = 0) => execute(maxClocks, true, ready_n),
        run: (maxClocks = 4096, ready_n = 0) => execute(maxClocks, false, ready_n),
        setBreakpoint(address) {
            if (!Number.isInteger(address) || address < 0 || address > 0xffffff) throw new RangeError('24-bit physical address required');
            breakpoints.add(address);
        },
        clearBreakpoint: address => breakpoints.delete(address),
        cancel() { cpu.cancel(); stoppedAt = null; },
        saveState: unsupported, restoreState: unsupported, readMem: unsupported,
        writeMem: unsupported, setRegisters: unsupported, setBackend: unsupported
    });
}
