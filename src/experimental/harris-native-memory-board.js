/** Default-off hybrid fixture: JS instructions, native actual-net memory periods.
 * The reference board is an unclocked construction recipe, never live state.
 */
import {CircuitFault} from './digital-circuit.js';
import {createHarrisMemoryBoard} from './harris-80c286-memory-board.js';
import {createNativeMemoryCircuit} from './wired-kernel/memory-circuit.js';

const OPTIONS = new Set(['enabled', 'rom', 'romLowAlias', 'wasmBytes',
    'admittedGraph', 'incrementalGraph', 'maxWaitStates', 'editWires', 'stageAttribution']);
const BANK_IDS = Object.freeze(['rom0', 'rom1', 'ram0', 'ram1']);

export async function createHarrisNativeMemoryBoard(options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options))
        throw new TypeError('native memory board options');
    const {enabled = false, rom = new Uint8Array(), romLowAlias = false, wasmBytes,
        admittedGraph = false, incrementalGraph = false, maxWaitStates = 1024,
        editWires = wires => wires, stageAttribution = false} = options;
    if (enabled !== true) throw new CircuitFault('EXPERIMENT_DISABLED', 'enabled:true required');
    for (const key of Object.keys(options)) if (!OPTIONS.has(key))
        throw new CircuitFault('UNSUPPORTED_BOARD_OPTION', `native memory-only board: ${key}`);
    if (!(rom instanceof Uint8Array) || rom.length > 65536) throw new RangeError('ROM must be at most 64K');
    if (typeof editWires !== 'function') throw new TypeError('editWires');
    if (typeof stageAttribution !== 'boolean') throw new TypeError('stageAttribution');
    // Copy before the first await. Neither later edits to caller ROM nor the
    // discarded JS adapters can mutate this instance's native memory.
    const ownedROM = rom.slice();
    const recipe = createHarrisMemoryBoard({enabled: true, rom: ownedROM, romLowAlias,
        ramBytes: 65536, textRAM: false, netBackend: 'reference', busTraceEnabled: false, editWires});
    const banks = BANK_IDS.map((id, index) => ({id,
        kind: index < 2 ? '28c256' : '62256', readOnly: index < 2,
        contents: index < 2 ? ownedROM.filter((_, offset) => offset % 2 === index) : new Uint8Array()}));
    const native = await createNativeMemoryCircuit({enabled: true, circuit: recipe.circuit,
        banks, wasmBytes, admittedGraph, incrementalGraph, stageAttribution,
        phase: {kind: 'owned-latched-memory-v1', controller: 'controller', latch: 'latch'},
        bus: {kind: 'owned-286-memory-bus-v1', cpu: 'cpu', inputPart: 'inputs', maxWaitStates}});
    const clock = (inputs = {}) => {native.beginClock(inputs); return native.endClock();};
    return Object.freeze({
        capabilities: Object.freeze({experimental: true, hybridCPU: true, nativeMemoryBus: true,
            transactionBatching: true, fidelity: 'hybrid-js-cpu-native-latched-memory',
            cpu: false, fullNativeCPU: false, memoryOnly: true, ramBytes: 65536, textRAM: false,
            io: false, inta: false, intr: false, nmi: false, hold: false, dma: false,
            snapshots: false, resumableSnapshot: false, hotSwap: false, liveCircuit: false,
            prefetch: false, instructionTiming: false, busHaltSignalling: false,
            admittedGraph, incrementalGraph, maxBatchPeriods: 8192}),
        memoryMap: recipe.memoryMap,
        initialize() {
            for (let i = 0; i < 17; i++) clock({reset: 1});
            for (let i = 0; i < 50; i++) clock({reset: 0});
        },
        clock,
        beginClock: native.beginClock,
        endClock: native.endClock,
        submit: native.submit,
        runUntilCompletion: native.runUntilCompletion,
        inspectBus: native.inspectBus,
        inspectLifecycle: native.inspectLifecycle,
        inspectPhase: native.inspectPhase,
        inspectNets: native.inspect,
        inspectWorkCounters: native.inspectWorkCounters,
        resetWorkCounters: native.resetWorkCounters,
        inspectProducerCounters: native.inspectProducerCounters,
        resetProducerCounters: native.resetProducerCounters,
        ...(stageAttribution ? {inspectStageAttribution: native.inspectStageAttribution,
            resetStageAttribution: native.resetStageAttribution} : {}),
        inspectMemory(id) {
            const index = BANK_IDS.indexOf(id);
            if (index < 0) throw new RangeError(`unknown memory ${id}`);
            return native.inspectMemory(index);
        }
    });
}
