import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {createHarrisNativeMemoryBoard} from '../src/experimental/harris-native-memory-board.js';

registerBusMemory();
const wasmBytes = process.env.HARRIS_NET_WASM ? readFileSync(process.env.HARRIS_NET_WASM) : null;
const optional = {skip: !wasmBytes && 'set HARRIS_NET_WASM to owned native build'};
const modes = [{}, {admittedGraph: true}, {admittedGraph: true, incrementalGraph: true}];
const create = options => createHarrisNativeMemoryBoard({enabled: true, wasmBytes, ...options});
const transfer = (board, transaction) => {
    board.submit(transaction);
    const completions = [];
    for (let i = 0; i < 32; i++) {
        const result = board.clock({ready_n: 0});
        if (result) {completions.push(result); if (result.last) return completions;}
    }
    throw new Error('test transaction budget exhausted');
};

test('native board requires explicit opt-in and refuses unsupported options', async () => {
    await assert.rejects(createHarrisNativeMemoryBoard(), {code: 'EXPERIMENT_DISABLED'});
    for (const key of ['ioEnabled', 'intrEnabled', 'holdEnabled', 'textRAM', 'ramBytes', 'snapshots', 'netBackend'])
        await assert.rejects(create({[key]: true}), {code: 'UNSUPPORTED_BOARD_OPTION'});
    await assert.rejects(create({rom: new Uint8Array(65537)}), RangeError);
});

test('native board initializes real periods and exposes only native defensive state', optional, async () => {
    const rom = Uint8Array.from([0x12, 0x34, 0x56]);
    const pending = create({rom, romLowAlias: true}); rom.fill(0);
    const board = await pending;
    assert.equal(board.inspectBus().clock, 0);
    assert.equal(board.inspectBus().state, 'RESET_REQUIRED');
    board.initialize();
    assert.equal(board.inspectBus().clock, 67);
    assert.equal(board.inspectBus().state, 'TI');
    assert.deepEqual(Array.from(board.inspectMemory('rom0').bytes.slice(0, 3)), [0x12, 0x56, 0xff]);
    assert.deepEqual(Array.from(board.inspectMemory('rom1').bytes.slice(0, 2)), [0x34, 0xff]);
    const copy = board.inspectMemory('rom0'); copy.bytes.fill(0);
    assert.equal(board.inspectMemory('rom0').bytes[0], 0x12);
    assert.throws(() => board.inspectMemory(0), RangeError);
    for (const name of ['circuit', 'bus', 'restore', 'snapshot', 'settleMemories', 'compileSchedule'])
        assert.equal(board[name], undefined);
    assert.equal(board.capabilities.transactionBatching, true);
    assert.equal(board.capabilities.fullNativeCPU, false);
    assert.ok(Object.isFrozen(board.memoryMap[0].aliases));
    assert.equal(transfer(board, {kind: 'code-read', address: 0xf0000, width: 2}).at(-1).operand, 0x3412);
    transfer(board, {kind: 'memory-write', address: 0xff0000, width: 2, value: 0xffff});
    assert.equal(board.inspectMemory('rom0').bytes[0], 0x12);
    assert.equal(board.inspectMemory('rom0').writes, 0);
});

test('native actual wiring and physical transactions match independent reference in each kernel mode', optional, async () => {
    const editWires = wires => wires.map(w => w.to === 'ram0' && ['a0', 'a1'].includes(w.toTerminal) ?
        {...w, toTerminal: w.toTerminal === 'a0' ? 'a1' : 'a0'} : w);
    for (const mode of modes) {
        const native = await create({...mode, editWires});
        const reference = createHarrisMemoryBoard({enabled: true, busTraceEnabled: false, editWires});
        native.initialize(); reference.initialize();
        for (const transaction of [
            {kind: 'memory-write', address: 2, width: 2, value: 0x1234},
            {kind: 'memory-write', address: 7, width: 2, value: 0xabcd},
            {kind: 'memory-read', address: 2, width: 2},
            {kind: 'memory-read', address: 7, width: 2}
        ]) assert.deepEqual(transfer(native, transaction), transfer(reference, transaction));
        for (const id of ['rom0', 'rom1', 'ram0', 'ram1'])
            assert.deepEqual(native.inspectMemory(id).bytes, reference.inspectMemory(id).bytes);
        assert.equal(native.inspectMemory('ram0').bytes[2], 0x34);
        assert.equal(native.inspectMemory('ram0').bytes[1], 0);
        assert.equal(native.inspectBus().clock, reference.bus.clock);
    }
});

test('bounded waits and odd-word continuation preserve physical write count', optional, async () => {
    const board = await create(); board.initialize();
    board.submit({kind: 'memory-write', address: 1, width: 2, value: 0xabcd});
    assert.equal(board.runUntilCompletion({maxPeriods: 7, inputs: {ready_n: 1}}).completed, false);
    assert.equal(board.inspectMemory('ram1').writes, 0);
    const first = board.runUntilCompletion({maxPeriods: 1, inputs: {ready_n: 0}});
    assert.equal(first.completions[0].last, false);
    assert.equal(board.inspectMemory('ram1').writes, 1);
    const second = board.runUntilCompletion({maxPeriods: 4});
    assert.equal(second.completed, true);
    assert.equal(second.completions[0].operand, 0xabcd);
    assert.equal(board.inspectMemory('ram0').writes, 1);
    assert.equal(board.inspectMemory('ram1').writes, 1);
});

test('native board refuses unsupported transactions and preserves numeric boundaries', optional, async () => {
    const board = await create(); board.initialize();
    const before = board.inspectBus();
    for (const transaction of [
        {kind: 'io-read', address: 0}, {kind: 'interrupt-acknowledge', address: 0},
        {kind: 'memory-write', address: 0, locked: true},
        {kind: 'memory-write', address: 2 ** 32, value: 0},
        {kind: 'memory-write', address: 0, value: 2 ** 32}
    ]) {assert.throws(() => board.submit(transaction), {code: 'UNSUPPORTED_TRANSACTION'}); assert.deepEqual(board.inspectBus(), before);}
    for (const [pin, value, code] of [['hold', 1, 'UNSUPPORTED_HOLD'], ['intr', 1, 'UNSUPPORTED_INPUT'],
        ['nmi', 1, 'UNSUPPORTED_INPUT'], ['pereq', 1, 'UNSUPPORTED_INPUT']]) {
        const active = await create(); active.initialize();
        assert.throws(() => active.clock({[pin]: value}), {code});
    }
});

test('missing alias or disconnected memory data faults instead of hidden transfer success', optional, async () => {
    for (const mode of modes) {
        const noAlias = await create(mode); noAlias.initialize();
        assert.throws(() => transfer(noAlias, {kind: 'code-read', address: 0xf0000}), {code: 'FLOATING'});
        const broken = await create({...mode, editWires: wires => wires.filter(w =>
            !(w.from === 'cpu' && w.fromTerminal === 'd0' && w.to === 'ram0'))});
        broken.initialize();
        assert.throws(() => transfer(broken, {kind: 'memory-write', address: 0, value: 0x12}), {code: 'FLOATING'});
        assert.equal(broken.inspectMemory('ram0').writes, 0);
        assert.equal(broken.inspectMemory('ram0').bytes[0], 0);
        assert.equal(broken.inspectLifecycle().faulted, true);
        assert.throws(() => broken.clock(), {code: 'BOARD_FAULTED'});
    }
});
