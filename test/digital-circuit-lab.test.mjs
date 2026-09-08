import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DigitalCircuit} from '../src/experimental/digital-circuit.js';
import {createWiredBusLab} from '../src/experimental/wired-bus-lab.js';

const fault = code => error => error.code === code;
const run = (lab, transaction) => { lab.begin(transaction); return lab.step(); };
const wire = (from, to) => ({from, fromTerminal: 'p', to, toTerminal: 'p'});

test('both entry points require explicit experiment opt-in', () => {
    assert.throws(() => new DigitalCircuit({parts: []}), fault('EXPERIMENT_DISABLED'));
    assert.throws(() => createWiredBusLab(), fault('EXPERIMENT_DISABLED'));
    assert.throws(() => createWiredBusLab({enabled: 'true'}), fault('EXPERIMENT_DISABLED'));
});

test('resolved nets distinguish Z, known values, unknown and named conflicts', () => {
    const c = new DigitalCircuit({enabled: true,
        parts: ['a', 'b', 'c'].map(id => ({id, pins: ['p'], outputs: ['p']})),
        wires: [wire('a', 'b'), wire('b', 'c')]});
    assert.equal(c.read('c', 'p'), 'Z');
    assert.throws(() => c.require('c', 'p'), fault('FLOATING'));
    c.drive('a', {p: 1}); c.settle();
    assert.equal(c.require('c', 'p'), 1);
    c.drive('b', {p: 1}); c.settle();
    assert.equal(c.require('c', 'p'), 1);
    c.drive('b', {p: 0}); c.settle();
    assert.throws(() => c.require('c', 'p'), /CONTENTION.*a.p=1, b.p=0/);
    c.drive('b', {p: 'Z'}); c.drive('a', {p: 'X'}); c.settle();
    assert.throws(() => c.require('c', 'p'), fault('UNKNOWN'));
    const state = c.inspect('a', 'p');
    state.drivers[0].value = 1;
    assert.equal(c.read('a', 'p'), 'X');
});

test('invalid wires, output drives and duplicate pins are refused', () => {
    assert.throws(() => new DigitalCircuit({enabled: true, parts: [], wires: [wire('a', 'b')]}), /unknown terminal/);
    assert.throws(() => new DigitalCircuit({enabled: true,
        parts: [{id: 'a', pins: ['p', 'P']}]}), /duplicate pin/);
    const c = new DigitalCircuit({enabled: true, parts: [{id: 'a', pins: ['p', 'q'], outputs: ['p']}]});
    assert.throws(() => c.drive('a', {p: 1, q: 0}), /not an output/);
    c.settle();
    assert.equal(c.read('a', 'p'), 'Z', 'invalid drive batch is atomic');
});

test('combinational evaluation is independent of part and wire iteration order', () => {
    const parts = [
        {id: 'source', pins: ['p'], outputs: ['p']},
        {id: 'not', pins: ['p', 'q'], outputs: ['q'], evaluate: read => ({q: read('p') === 1 ? 0 : read('p') === 0 ? 1 : 'X'})},
        {id: 'sink', pins: ['p']}
    ];
    const wires = [wire('source', 'not'), {from: 'not', fromTerminal: 'q', to: 'sink', toTerminal: 'p'}];
    for (const reverse of [false, true]) {
        const c = new DigitalCircuit({enabled: true, parts: reverse ? [...parts].reverse() : parts,
            wires: reverse ? [...wires].reverse() : wires});
        c.drive('source', {p: 1}); c.settle(); assert.equal(c.require('sink', 'p'), 0);
        c.drive('source', {p: 0}); c.settle(); assert.equal(c.require('sink', 'p'), 1);
    }
});

test('oscillating logic has a bounded non-convergence error', () => {
    assert.throws(() => new DigitalCircuit({enabled: true, maxDeltas: 5,
        parts: [{id: 'osc', pins: ['p'], outputs: ['p'], evaluate: read => ({p: read('p') === 1 ? 0 : 1})}]}),
    fault('NON_CONVERGENT'));
});

test('owned ROM at reset address is read through both byte lanes, then RAM through the same nets', () => {
    const rom = new Uint8Array(65536);
    // A source-owned far-jump encoding, inspected only; no CPU is executed.
    rom.set([0xea, 0x00, 0x05, 0x00, 0x00], 0xfff0);
    const lab = createWiredBusLab({enabled: true, rom});
    assert.equal(lab.capabilities.cpu, null);
    assert.equal(run(lab, {address: 0xfffff0, width: 2}).data, 0x00ea);
    assert.equal(run(lab, {address: 0xfffff2}).data, 5);
    assert.equal(run(lab, {address: 0xfffff3}).data, 0);
    run(lab, {address: 0x500, width: 2, write: true, value: 0x1234});
    assert.equal(run(lab, {address: 0x500, width: 2}).data, 0x1234);
    assert.equal(run(lab, {address: 0x501}).data, 0x12);
    assert.equal(lab.inspectMemory('ram0').writes, 1);
    assert.equal(lab.inspectMemory('ram1').writes, 1);
});

test('all byte values round-trip in both lanes without altering adjacent bytes', () => {
    const lab = createWiredBusLab({enabled: true});
    for (let value = 0; value < 256; value++) for (let lane = 0; lane < 2; lane++) {
        run(lab, {address: 0x600, width: 2, write: true, value: 0x5a5a});
        run(lab, {address: 0x600 + lane, write: true, value});
        assert.equal(run(lab, {address: 0x600 + lane}).data, value);
        assert.equal(run(lab, {address: 0x601 - lane}).data, 0x5a);
    }
});

test('delayed READY does not duplicate writes and completion occurs on one explicit tick', () => {
    const lab = createWiredBusLab({enabled: true});
    lab.setReady(0);
    lab.begin({address: 0x500, width: 2, write: true, value: 0xbeef});
    for (let i = 0; i < 3; i++) {
        assert.equal(lab.step(), null);
        assert.equal(lab.inspectMemory('ram0').writes, 0);
    }
    lab.setReady(1);
    const result = lab.step();
    assert.equal(result.tick, 4);
    assert.equal(result.waits, 3);
    assert.equal(lab.inspectMemory('ram0').writes, 1);
    assert.throws(() => lab.step(), fault('BUS_UNAVAILABLE'));
    assert.equal(lab.inspectMemory('ram0').writes, 1);
    assert.equal(run(lab, {address: 0x500, width: 2}).data, 0xbeef);
});

test('timeout latches a fault; cancel releases bus without committing a write', () => {
    const lab = createWiredBusLab({enabled: true, maxWaitTicks: 2});
    lab.setReady(0); lab.begin({address: 0, write: true, value: 99});
    assert.equal(lab.step(), null);
    assert.throws(() => lab.step(), fault('TIMEOUT'));
    lab.setReady(1);
    assert.throws(() => lab.step(), fault('BUS_UNAVAILABLE'));
    assert.equal(lab.inspectMemory('ram0').writes, 0);
    lab.cancel();
    assert.equal(run(lab, {address: 0}).data, 0);
});

test('disconnected ROM data and select never fall back to hidden ROM contents', () => {
    for (const terminal of ['d0', 'ce']) {
        const lab = createWiredBusLab({enabled: true,
            editWires: wires => wires.filter(w => !(w.to === 'rom0' && w.toTerminal === terminal))});
        assert.throws(() => run(lab, {address: 0xfffff0}), fault(terminal === 'd0' ? 'FLOATING' : 'UNKNOWN'));
    }
});

test('shorted low and high data lanes report named driver contention', () => {
    const lab = createWiredBusLab({enabled: true, rom: Uint8Array.of(0, 255),
        editWires: wires => [...wires, {from: 'master', fromTerminal: 'd0', to: 'master', toTerminal: 'd8'}]});
    assert.throws(() => run(lab, {address: 0xff0000, width: 2}), /CONTENTION.*rom0.d0=0.*rom1.d0=1/);
});

test('missing write lane is rejected before either bank commits', () => {
    const lab = createWiredBusLab({enabled: true,
        editWires: wires => wires.filter(w => !(w.to === 'ram1' && w.toTerminal === 'd0'))});
    assert.throws(() => run(lab, {address: 0x500, width: 2, write: true, value: 0x1234}), fault('FLOATING'));
    assert.equal(lab.inspectMemory('ram0').writes, 0);
    assert.equal(lab.inspectMemory('ram1').writes, 0);
});

test('unmapped addresses and ROM writes are not silently accepted', () => {
    for (const [tx, code] of [
        [{address: 0x10000}, 'FLOATING'],
        [{address: 0x10000, write: true, value: 1}, 'UNMAPPED_WRITE'],
        [{address: 0xfffff0, write: true, value: 1}, 'READ_ONLY']
    ]) {
        const lab = createWiredBusLab({enabled: true});
        assert.throws(() => run(lab, tx), fault(code));
    }
});

test('odd words are explicitly unsupported; manual split bytes remain correct', () => {
    const lab = createWiredBusLab({enabled: true});
    assert.throws(() => lab.begin({address: 0x501, width: 2}), fault('UNSUPPORTED'));
    run(lab, {address: 0x501, write: true, value: 0x34});
    run(lab, {address: 0x502, write: true, value: 0x12});
    assert.equal(run(lab, {address: 0x501}).data + 256 * run(lab, {address: 0x502}).data, 0x1234);
});

test('trace is bounded, reports dropped records and returns defensive copies', () => {
    const lab = createWiredBusLab({enabled: true, traceLimit: 2});
    for (let address = 0; address < 5; address++) run(lab, {address});
    const trace = lab.getTrace();
    assert.equal(trace.dropped, 3);
    assert.deepEqual(trace.entries.map(e => e.tick), [4, 5]);
    trace.entries[0].tick = 123;
    assert.equal(lab.getTrace().entries[0].tick, 4);
});

test('repeated identical circuits produce identical result and trace', () => {
    const execute = () => {
        const lab = createWiredBusLab({enabled: true});
        run(lab, {address: 12, write: true, value: 57});
        run(lab, {address: 12});
        return lab.getTrace();
    };
    assert.deepEqual(execute(), execute());
});

test('a missing READY wire is floating, not permission to complete', () => {
    const lab = createWiredBusLab({enabled: true,
        editWires: wires => wires.filter(w => w.from !== 'ready')});
    assert.throws(() => run(lab, {address: 0, write: true, value: 9}), fault('FLOATING'));
    assert.equal(lab.inspectMemory('ram0').writes, 0);
});

test('a data short during a write cannot commit either bank', () => {
    const lab = createWiredBusLab({enabled: true,
        editWires: wires => [...wires, {from: 'master', fromTerminal: 'd0', to: 'master', toTerminal: 'd8'}]});
    assert.throws(() => run(lab, {address: 0, width: 2, write: true, value: 0xff00}), fault('CONTENTION'));
    assert.equal(lab.inspectMemory('ram0').writes, 0);
    assert.equal(lab.inspectMemory('ram1').writes, 0);
});

test('pending transaction cannot be replaced, and cancellation releases data pins', () => {
    const lab = createWiredBusLab({enabled: true});
    lab.begin({address: 0, write: true, value: 7});
    assert.throws(() => lab.begin({address: 2}), fault('BUS_UNAVAILABLE'));
    lab.cancel();
    assert.equal(lab.circuit.read('master', 'd0'), 'Z');
    assert.equal(lab.inspectMemory('ram0').writes, 0);
    assert.equal(run(lab, {address: 0}).data, 0);
});

test('argument validation rejects truncated addresses and invalid transaction values', () => {
    for (const options of [{maxWaitTicks: 0}, {traceLimit: Infinity}, {rom: [1]}]) {
        assert.throws(() => createWiredBusLab({enabled: true, ...options}), RangeError);
    }
    const lab = createWiredBusLab({enabled: true});
    for (const address of [-1, 0x1000000, 0.5, NaN]) assert.throws(() => lab.begin({address}), RangeError);
    assert.throws(() => lab.begin({address: 0, value: 256}), RangeError);
    assert.throws(() => lab.begin({address: 0, write: 1}), TypeError);
    assert.throws(() => lab.begin({address: 0, width: 4}), RangeError);
    assert.equal(run(lab, {address: 0}).data, 0, 'invalid requests left no pending work');
});
