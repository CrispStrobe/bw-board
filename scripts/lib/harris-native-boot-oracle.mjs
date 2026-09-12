/** Portable owned-ROM hybrid acceptance oracle; not a capacity benchmark. */
import {registerBusMemory} from '../../src/devices/bus-memory.js';
import {createHarrisBootROM, createHarrisLoopROM} from '../../src/experimental/harris-boot-rom.js';
import {createHarrisMemoryBoard} from '../../src/experimental/harris-80c286-memory-board.js';
import {createHarrisNativeMemoryBoard} from '../../src/experimental/harris-native-memory-board.js';
import {HarrisBootCPU} from '../../src/experimental/harris-80c286-boot-cpu.js';

const equal = (actual, expected, label) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`hybrid boot oracle: ${label}`);
};
const check = (value, label) => {if (!value) throw new Error(`hybrid boot oracle: ${label}`);};
const memoryWord = (board, address) => board.inspectMemory('ram0').bytes[address >> 1] |
    (board.inspectMemory('ram1').bytes[address >> 1] << 8);

export async function runNativeBootOracle({wasmBytes, admittedGraph = false, incrementalGraph = false,
    yieldTask = async () => {}, stopped = () => false} = {}) {
    registerBusMemory();
    const poll = async () => {
        await yieldTask();
        if (stopped()) {const error = new Error('hybrid boot oracle cancelled'); error.code = 'CANCELLED'; throw error;}
    };
    const samples = [];
    for (const name of ['boot', 'loop', 'mismatch']) {
        await poll();
        const rom = name === 'boot' ? createHarrisBootROM() : createHarrisLoopROM();
        if (name === 'mismatch') {
            // Change the owned CMP immediate, forcing its actual failure branch.
            const cmp = rom.findIndex((byte, i) => byte === 0x3d && rom[i + 1] === 10 && rom[i + 2] === 0);
            check(cmp >= 0x100 && cmp < 0xfff0, 'owned comparison location'); rom[cmp + 1] = 11;
        }
        const reference = createHarrisMemoryBoard({enabled: true, rom: rom.slice(), romLowAlias: true, busTraceEnabled: false});
        const native = await createHarrisNativeMemoryBoard({enabled: true, rom: rom.slice(), romLowAlias: true,
            wasmBytes, admittedGraph, incrementalGraph});
        const referenceCPU = new HarrisBootCPU({enabled: true, board: reference, historyLimit: 128});
        const nativeCPU = new HarrisBootCPU({enabled: true, board: native, historyLimit: 128});
        referenceCPU.initialize(); nativeCPU.initialize();
        equal(native.inspectBus().clock, 67, 'physical initialization');
        const expectedCompletions = [], actualCompletions = [];
        let referencePeriods = 0, nativePeriods = 0;
        while (referenceCPU.status === 'running') {
            check(referencePeriods < 10000, 'reference budget');
            const result = referenceCPU.stepClock(); referencePeriods++;
            if (result) expectedCompletions.push(result);
            if (referencePeriods % 256 === 0) await poll();
        }
        while (nativeCPU.status === 'running') {
            check(nativePeriods < 10000, 'native budget');
            const result = nativeCPU.runTransactions({maxPeriods: Math.min(256, 10000 - nativePeriods), maxBatchPeriods: 256});
            check(result.periods > 0, 'native progress');
            nativePeriods += result.periods; actualCompletions.push(...result.completions);
            await poll();
        }
        equal(nativeCPU.status, 'halted', 'halted');
        equal(nativeCPU.inspect(), referenceCPU.inspect(), 'full defined CPU state and history');
        equal(nativePeriods, referencePeriods, 'all executed periods');
        equal(native.inspectBus().clock, reference.bus.clock, 'physical clock');
        equal(actualCompletions, expectedCompletions, 'ordered physical completions');
        equal(native.memoryMap, reference.memoryMap, 'memory topology');
        check(!native.inspectBus().open && !native.inspectLifecycle().periodOpen, 'closed boundary');
        let memoryBytesCompared = 0;
        for (const region of reference.memoryMap) for (const id of region.chips) {
            const actual = native.inspectMemory(id), expected = reference.inspectMemory(id);
            check(actual.bytes.length === expected.bytes.length, `${id} length`);
            for (let i = 0; i < expected.bytes.length; i++)
                check(actual.bytes[i] === expected.bytes[i], `${id} byte ${i}`);
            memoryBytesCompared += expected.bytes.length;
            for (const key of ['writes', 'cycle', 'pending']) equal(actual[key], expected[key], `${id} ${key}`);
        }
        const retired = name === 'boot' ? 10 : name === 'loop' ? 47 : 48;
        equal(nativeCPU.retired, retired, 'expected instruction retirements');
        const words = name === 'boot' ? [0x500, 0x502, 0x504].map(a => memoryWord(native, a)) :
            [0x500, 0x502, 0x504, 0x506, 0x510].map(a => memoryWord(native, a));
        equal(words, name === 'boot' ? [0x1234, 0x5678, 0x68ac] : [1, 2, 3, 4, name === 'loop' ? 10 : 0xdead], 'owned result');
        samples.push({name, retired, periods: nativePeriods, initializationPeriods: 67,
            physicalClock: native.inspectBus().clock, completions: actualCompletions.length,
            memoryBytesCompared, words, ax: nativeCPU.regs.ax, flags: nativeCPU.flags, ip: nativeCPU.ip});
    }
    return {accepted: true, capacityClaim: false, fullNativeCPU: false, fullDOSBoot: false,
        scope: 'owned memory-only ROMs; JS instructions and native actual-net bus', admittedGraph, incrementalGraph, samples};
}
