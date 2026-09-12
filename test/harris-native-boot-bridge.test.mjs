import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {createHarrisNativeMemoryBoard} from '../src/experimental/harris-native-memory-board.js';
import {HarrisBootCPU} from '../src/experimental/harris-80c286-boot-cpu.js';
import {createHarrisBootROM, createHarrisLoopROM} from '../src/experimental/harris-boot-rom.js';

registerBusMemory();
const wasmBytes = process.env.HARRIS_NET_WASM ? readFileSync(process.env.HARRIS_NET_WASM) : null;
const optional = {skip: !wasmBytes && 'set HARRIS_NET_WASM to the owned native module'};
const modes = [{}, {admittedGraph: true}, {admittedGraph: true, incrementalGraph: true}];
const word = (board, address) => board.inspectMemory('ram0').bytes[address >> 1] |
    board.inspectMemory('ram1').bytes[address >> 1] << 8;
function cpuFor(board) {
    const cpu = new HarrisBootCPU({enabled: true, board}); cpu.initialize(); return cpu;
}
function reference(rom, options = {}) {
    const board = createHarrisMemoryBoard({enabled: true, rom, romLowAlias: true, ...options});
    const cpu = cpuFor(board); const completions = []; let periods = 0;
    while (cpu.status === 'running' && periods < 2000) {
        const completion = cpu.stepClock(); periods++;
        if (completion) completions.push(completion);
    }
    assert.equal(cpu.status, 'halted'); return {board, cpu, periods, completions};
}
async function native(rom, options = {}) {
    const board = await createHarrisNativeMemoryBoard({enabled: true, wasmBytes, rom, romLowAlias: true, ...options});
    return {board, cpu: cpuFor(board)};
}
function finish(cpu, budget, alternate = false) {
    let periods = 0; const completions = [];
    while (cpu.status === 'running' && periods < 2000) {
        if (alternate && periods % 2 === 0) {
            const completion = cpu.stepClock(); periods++;
            if (completion) completions.push(completion);
        } else {
            const result = cpu.runTransactions({maxPeriods: budget, maxBatchPeriods: Math.min(budget, 256)});
            assert.ok(result.periods > 0 && result.periods <= budget);
            periods += result.periods; completions.push(...result.completions);
        }
    }
    assert.equal(cpu.status, 'halted'); return {periods, completions};
}
function compare(expected, actual, result) {
    assert.deepEqual(actual.cpu.inspect(), expected.cpu.inspect());
    assert.equal(result.periods, expected.periods);
    assert.deepEqual(result.completions, expected.completions);
    for (const bank of ['rom0', 'rom1', 'ram0', 'ram1']) {
        assert.deepEqual(actual.board.inspectMemory(bank).bytes, expected.board.inspectMemory(bank).bytes, bank);
        assert.equal(actual.board.inspectMemory(bank).writes, expected.board.inspectMemory(bank).writes, bank);
    }
}

test('hybrid ROM execution matches every reference transfer, CPU state and mapped byte across budgets', optional, async () => {
    const rom = createHarrisBootROM(), expected = reference(rom);
    assert.equal(expected.cpu.retired, 10); assert.equal(expected.cpu.regs.ax, 0x68ac);
    for (const mode of modes) for (const budget of [1, 2, 3, 7, 256]) {
        const actual = await native(rom, mode); const result = finish(actual.cpu, budget);
        compare(expected, actual, result);
        assert.equal(actual.board.inspectBus().clock, expected.board.bus.clock);
        assert.equal(word(actual.board, 0x504), 0x68ac);
    }
});

test('hybrid loop takes genuine success and mutated failure branches and permits mixed stepping', optional, async () => {
    for (const mismatch of [false, true]) {
        const rom = createHarrisLoopROM();
        if (mismatch) rom[0x120] = 11; // CMP AX,000Bh instead of 000Ah
        const expected = reference(rom);
        assert.equal(expected.cpu.retired, mismatch ? 48 : 47);
        for (const mode of modes) {
            const actual = await native(rom, mode);
            compare(expected, actual, finish(actual.cpu, 7, true));
            assert.equal(word(actual.board, 0x510), mismatch ? 0xdead : 10);
        }
    }
});

test('hybrid stalled fetch preserves IP and retirement and resumes without duplicate effects', optional, async () => {
    for (const mode of modes) {
        const actual = await native(createHarrisBootROM(), mode);
        const result = actual.cpu.runTransactions({maxPeriods: 9, maxBatchPeriods: 3, ready_n: 1});
        assert.equal(result.periods, 9); assert.equal(actual.cpu.ip, 0xfff0); assert.equal(actual.cpu.retired, 0);
        finish(actual.cpu, 3);
        assert.equal(actual.cpu.retired, 10); assert.equal(word(actual.board, 0x504), 0x68ac);
        assert.equal(actual.board.inspectMemory('ram0').writes, 3);
    }
});

test('hybrid missing ROM alias and disconnected RAM data fail through actual nets', optional, async () => {
    for (const mode of modes) {
        for (const options of [{romLowAlias: false}, {
            editWires: wires => wires.filter(w => !(w.to === 'ram1' && w.toTerminal === 'd0'))
        }]) {
            const actual = await native(createHarrisBootROM(), {...mode, ...options});
            assert.throws(() => finish(actual.cpu, 256), {code: 'FLOATING'});
            assert.equal(actual.cpu.status, 'faulted');
            assert.equal(actual.board.inspectMemory('ram0').writes, 0);
            assert.equal(word(actual.board, 0x504), 0);
        }
    }
});

test('stalled odd guest store resumes both physical halves with one retirement and no duplicate write', optional, async () => {
    const rom = createHarrisBootROM(); rom.set([0xb8, 0xcd, 0xab, 0xa3, 0x01, 0x05, 0xf4], 0x100);
    for (const mode of modes) {
        const {cpu, board} = await native(rom, mode);
        for (let i = 0; cpu.ip !== 0x106 && i < 100; i++) cpu.stepClock();
        assert.equal(cpu.ip, 0x106); assert.equal(cpu.retired, 2);
        const wait = cpu.runTransactions({maxPeriods: 7, ready_n: 1});
        assert.equal(wait.periods, 7); assert.equal(cpu.retired, 2);
        assert.equal(board.inspectMemory('ram0').writes, 0);
        assert.equal(board.inspectMemory('ram1').writes, 0);
        const first = cpu.runTransactions({maxPeriods: 1});
        assert.equal(first.completions.length, 1); assert.equal(first.completions[0].last, false);
        assert.equal(cpu.retired, 2); assert.equal(board.inspectMemory('ram1').writes, 1);
        assert.equal(board.inspectMemory('ram0').writes, 0);
        finish(cpu, 1);
        assert.equal(cpu.retired, 4);
        assert.equal(board.inspectMemory('ram1').bytes[0x280], 0xcd);
        assert.equal(board.inspectMemory('ram0').bytes[0x281], 0xab);
        assert.equal(board.inspectMemory('ram0').writes, 1); assert.equal(board.inspectMemory('ram1').writes, 1);
    }
});

test('real IN OUT and string I/O programs refuse rather than injecting host services', optional, async () => {
    for (const bytes of [[0xe4, 0x20], [0xe5, 0x20], [0xe6, 0x20], [0xe7, 0x20], [0x6c], [0x6d], [0x6e], [0x6f]]) {
        const rom = createHarrisBootROM(); rom.set([...bytes, 0xf4], 0x100);
        const {cpu, board} = await native(rom, modes[2]);
        assert.throws(() => finish(cpu, 256), {code: 'UNSUPPORTED_TRANSACTION'});
        assert.equal(cpu.status, 'faulted'); assert.equal(cpu.retired, 1);
        assert.equal(board.inspectMemory('ram0').writes, 0); assert.equal(board.inspectMemory('ram1').writes, 0);
    }
});
