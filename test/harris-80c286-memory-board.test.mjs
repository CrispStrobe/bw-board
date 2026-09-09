import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {getDevice} from '../src/devices.js';
import {DigitalCircuit, bitPins, bitDrives, readBits} from '../src/experimental/digital-circuit.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {IdealAddressLatch, DigitalBusMemoryAdapter, settleBusMemories} from '../src/experimental/latched-memory-components.js';

registerBusMemory();
const fault = code => e => e.code === code;
const board = options => { const b = createHarrisMemoryBoard({enabled: true, ...options}); b.initialize(); return b; };
function run(b, transaction) {
    b.submit(transaction);
    for (let i = 0; i < 16; i++) {
        const r = b.clock();
        if (r?.last) return r;
    }
    throw new Error('bounded transaction failed to complete');
}

test('board and component adapters require explicit opt-in', () => {
    assert.throws(() => createHarrisMemoryBoard(), fault('EXPERIMENT_DISABLED'));
    assert.throws(() => new IdealAddressLatch(), fault('EXPERIMENT_DISABLED'));
    assert.throws(() => new DigitalBusMemoryAdapter({}), fault('EXPERIMENT_DISABLED'));
});

test('latched board fetches source-owned ROM and round-trips both RAM byte banks', () => {
    const rom = new Uint8Array(65536);
    rom.set([0xea, 0x00, 0x05, 0x00, 0x00], 0xfff0);
    const b = board({rom});
    assert.equal(run(b, {kind: 'code-read', address: 0xfffff0, width: 2}).operand, 0xea);
    assert.equal(run(b, {kind: 'code-read', address: 0xfffff2}).operand, 5);
    run(b, {kind: 'memory-write', address: 0x500, width: 2, value: 0x1234});
    assert.equal(run(b, {kind: 'memory-read', address: 0x500, width: 2}).operand, 0x1234);
    assert.equal(b.inspectMemory('ram0').writes, 1);
    assert.equal(b.inspectMemory('ram1').writes, 1);
    assert.equal(b.capabilities.cpu, false);
    assert.equal(b.capabilities.full82C288, false);
});

test('RAM changes on write-command trailing edge, not assertion, waits or CPU submit', () => {
    const b = board();
    b.submit({kind: 'memory-write', address: 0x500, width: 2, value: 0xbeef});
    for (let i = 0; i < 6; i++) {
        assert.equal(b.clock({ready_n: 1}), null);
        assert.equal(b.inspectMemory('ram0').writes, 0);
        assert.equal(b.inspectMemory('ram0').bytes[0x280], 0);
    }
    assert.equal(b.inspectMemory('ram0').pending.byte, 0xef);
    b.clock({ready_n: 0}); // TC1 of final state
    b.beginClock(); // TC2 still has a low write command
    assert.equal(b.circuit.require('controller', 'mwr_n'), 0);
    assert.equal(b.inspectMemory('ram0').writes, 0);
    assert.equal(b.endClock().operand, 0xbeef);
    assert.equal(b.circuit.require('controller', 'mwr_n'), 1);
    assert.equal(b.inspectMemory('ram0').writes, 1);
    for (let i = 0; i < 4; i++) b.clock();
    assert.equal(b.inspectMemory('ram0').writes, 1, 'no duplicate edge commit');
});

test('byte and odd-word transfers preserve byte bank order and adjacent data', () => {
    const b = board();
    run(b, {kind: 'memory-write', address: 0x500, width: 2, value: 0xaaaa});
    run(b, {kind: 'memory-write', address: 0x502, width: 2, value: 0xbbbb});
    run(b, {kind: 'memory-write', address: 0x501, width: 2, value: 0x1234});
    assert.equal(run(b, {kind: 'memory-read', address: 0x501, width: 2}).operand, 0x1234);
    assert.equal(run(b, {kind: 'memory-read', address: 0x500}).operand, 0xaa);
    assert.equal(run(b, {kind: 'memory-read', address: 0x503}).operand, 0xbb);
});

test('transparent latch follows ALE high and holds address, lane and space after ALE closes', () => {
    const latch = new IdealAddressLatch({enabled: true});
    const pins = ['ale', ...bitPins('a', 24), 'bhe_n', 'm_io'];
    const c = new DigitalCircuit({enabled: true, parts: [latch.part(), {id: 'source', pins, outputs: pins}],
        wires: pins.map(p => ({from: 'source', fromTerminal: p, to: 'latch', toTerminal: p}))});
    const update = values => {
        c.drive('source', values); c.settle();
        c.drive('latch', latch.update(p => c.require('latch', p))); c.settle();
    };
    update({...bitDrives(bitPins('a', 24), 0x500), ale: 1, bhe_n: 0, m_io: 1});
    update({...bitDrives(bitPins('a', 24), 0x600), ale: 1});
    assert.equal(readBits(bitPins('a', 24), p => c.require('latch', `q_${p}`)), 0x600);
    update({ale: 0});
    update({...bitDrives(bitPins('a', 24), 0xff1234), bhe_n: 1, m_io: 0});
    assert.equal(readBits(bitPins('a', 24), p => c.require('latch', `q_${p}`)), 0x600);
    assert.equal(c.require('latch', 'q_bhe_n'), 0);
    assert.equal(c.require('latch', 'q_m_io'), 1);
});

test('CPU-side address changes during a write cannot redirect the latched write', () => {
    const b = board();
    b.submit({kind: 'memory-write', address: 0x500, width: 2, value: 0xbeef});
    b.clock(); b.clock(); // address captured during TS2
    b.beginClock({ready_n: 1}); // TC1: latch closed
    b.circuit.drive('cpu', bitDrives(bitPins('a', 24), 0x600)); b.circuit.settle();
    assert.equal(readBits(bitPins('a', 24), p => b.circuit.require('latch', `q_${p}`)), 0x500);
    b.endClock();
    b.clock({ready_n: 0});
    assert.equal(run(b, {kind: 'memory-read', address: 0x500, width: 2}).operand, 0xbeef);
    assert.equal(run(b, {kind: 'memory-read', address: 0x600, width: 2}).operand, 0);
});

test('missing ALE, address, command or data wire causes a named access failure', () => {
    for (const [part, pin] of [['latch', 'ale'], ['latch', 'a23'], ['ram0', 'web'], ['ram0', 'd0'], ['ram0', 'csb']]) {
        assert.throws(() => {
            const b = board({editWires: wires => wires.filter(w => !(w.to === part && w.toTerminal === pin))});
            run(b, {kind: 'memory-read', address: 0x500});
        }, fault('FLOATING'), `${part}.${pin}`);
    }
});

test('shorted data lanes prevent a write commit in both banks', () => {
    const b = board({editWires: wires => [...wires,
        {from: 'cpu', fromTerminal: 'd0', to: 'cpu', toTerminal: 'd8'}]});
    assert.throws(() => run(b, {kind: 'memory-write', address: 0x500, width: 2, value: 0xff00}), fault('CONTENTION'));
    assert.equal(b.inspectMemory('ram0').writes, 0);
    assert.equal(b.inspectMemory('ram1').writes, 0);
});

test('a missing high-bank write-data pin cannot cause a partial low-bank write', () => {
    const b = board({editWires: wires => wires.filter(w => !(w.to === 'ram1' && w.toTerminal === 'd0'))});
    assert.throws(() => run(b, {kind: 'memory-write', address: 0x500, width: 2, value: 0x1234}), fault('FLOATING'));
    assert.equal(b.inspectMemory('ram0').writes, 0);
    assert.equal(b.inspectMemory('ram1').writes, 0);
});

for(const [memoryScheduling,memoryWriteJournal] of [[false,false],[true,false],[true,true]])test(`a late high-bank preflight fault cannot commit an already-previewed low-bank edge (scheduled=${memoryScheduling},journal=${memoryWriteJournal})`, () => {
    const b = board({netBackend:memoryScheduling?'compiled':'reference',memoryScheduling,memoryWriteJournal,editWires: wires => wires.map(w => w.to === 'ram1' && w.toTerminal === 'vcc' ?
        {...w, fromTerminal: 'busy_n'} : w)});
    b.submit({kind: 'memory-write', address: 0x500, width: 2, value: 0x1234});
    for (let i = 0; i < 3; i++) b.clock();
    b.beginClock();
    b.circuit.drive('inputs', {busy_n: 'Z'}); b.circuit.settle();
    assert.throws(() => b.endClock(), fault('FLOATING'));
    assert.equal(b.inspectMemory('ram0').writes, 0);
    assert.equal(b.inspectMemory('ram1').writes, 0);
    assert.throws(() => b.clock(), fault('BOARD_FAULTED'));
});

for(const memoryScheduling of [false,true])test(`missing memory power is not replaced with a hidden 5V supply (scheduled=${memoryScheduling})`, () => {
    assert.throws(() => board({netBackend:memoryScheduling?'compiled':'reference',memoryScheduling,editWires: wires => wires.filter(w => !(w.to === 'rom0' && w.toTerminal === 'vcc'))}), fault('FLOATING'));
});

test('mismatched CPU/controller READY is rejected before acceptance or write edge', () => {
    const b = board({editWires: wires => wires.map(w => w.to === 'controller' && w.toTerminal === 'ready_n' ?
        {...w, fromTerminal: 'vcc'} : w)});
    b.submit({kind: 'memory-write', address: 0x500, value: 3});
    for (let i = 0; i < 3; i++) b.clock();
    b.beginClock();
    assert.throws(() => b.endClock(), fault('READY_MISMATCH'));
    assert.equal(b.inspectMemory('ram0').writes, 0);
});

test('RESET is not a RAM rollback: terminating an existing write pulse commits its pending byte', () => {
    const b = board();
    b.submit({kind: 'memory-write', address: 0x500, value: 0x42});
    for (let i = 0; i < 4; i++) b.clock({ready_n: 1});
    assert.equal(b.inspectMemory('ram0').writes, 0);
    b.clock({reset: 1});
    assert.equal(b.inspectMemory('ram0').writes, 1);
    assert.equal(b.inspectMemory('ram0').bytes[0x280], 0x42);
    assert.equal(b.bus.pending, null);
});

test('ROM writes are ignored by readOnly memory, without pretending the CPU detects protection', () => {
    const b = board({rom: Uint8Array.of(0x44)});
    run(b, {kind: 'memory-write', address: 0xff0000, value: 0x33});
    assert.equal(run(b, {kind: 'memory-read', address: 0xff0000}).operand, 0x44);
    assert.equal(b.inspectMemory('rom0').writes, 0);
});

test('I/O status is explicitly unsupported by this memory-only controller', () => {
    const b = board();
    b.submit({kind: 'io-read', address: 0});
    assert.throws(() => b.clock(), fault('UNSUPPORTED_COMMAND'));
});

test('reused memory update commits on an external edge without any CPU or completion callback', () => {
    const memory = new DigitalBusMemoryAdapter({enabled: true, id: 'ram', kind: '62256', model: getDevice('62256')});
    const pins = memory.part().pins;
    const c = new DigitalCircuit({enabled: true, parts: [memory.part(), {id: 'source', pins, outputs: pins}],
        wires: pins.map(p => ({from: 'source', fromTerminal: p, to: 'ram', toTerminal: p}))});
    const drive = values => { c.drive('source', values); settleBusMemories(c, [memory]); };
    drive({...bitDrives(bitPins('a', 15), 0x280), ...bitDrives(bitPins('d', 8), 0x5a), vcc: 1, gnd: 0, csb: 1, oeb: 1, web: 1});
    drive({csb: 0, web: 0});
    assert.equal(memory.inspect().writes, 0);
    drive({}); drive({});
    assert.equal(memory.inspect().writes, 0);
    drive({web: 1});
    assert.equal(memory.inspect().writes, 1);
    assert.equal(memory.inspect().bytes[0x280], 0x5a);
    drive({web: 1}); assert.equal(memory.inspect().writes, 1);
});
