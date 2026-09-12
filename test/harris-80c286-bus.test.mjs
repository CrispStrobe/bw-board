import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DigitalCircuit, bitPins, bitDrives, readBits} from '../src/experimental/digital-circuit.js';
import {Harris80C286Bus} from '../src/experimental/harris-80c286-bus.js';
import {HARRIS_80C286_PLCC, decode286Status, plan286Transfers} from '../src/experimental/harris-80c286-contract.js';

const fault = code => e => e.code === code;
const D = bitPins('d', 16);
const inactive = {reset: 0, ready_n: 0, hold: 0, intr: 0, nmi: 0, pereq: 0, busy_n: 1, error_n: 1};

/** Test peer drives actual nets. It is not an 82C288 model or production RAM. */
function fixture(options = {}) {
    const bus = new Harris80C286Bus({enabled: true, ...options});
    const cpu = bus.part();
    const inputs = [...Object.keys(inactive), ...D];
    const wires = inputs.map(pin => ({from: 'peer', fromTerminal: pin, to: 'cpu', toTerminal: pin}));
    const circuit = new DigitalCircuit({enabled: true,
        parts: [cpu, {id: 'peer', pins: inputs, outputs: inputs}], wires});
    circuit.drive('peer', {...inactive, ...Object.fromEntries(D.map(p => [p, 'Z']))});
    const read = p => circuit.require('cpu', p);
    const f = {
        bus, circuit,
        begin(values = {}) {
            circuit.drive('peer', values); circuit.settle();
            const outputs = bus.beginClock(read);
            circuit.drive('cpu', outputs); circuit.settle();
            return outputs;
        },
        end(values = {}) {
            circuit.drive('peer', values); circuit.settle();
            return bus.endClock(read);
        },
        clock(values = {}) { f.begin(values); return f.end(); },
        boot() {
            for (let i = 0; i < 17; i++) f.clock({reset: 1});
            for (let i = 0; i < 50; i++) f.clock({reset: 0});
            assert.equal(bus.state, 'TI'); assert.equal(bus.phase, 1);
        }
    };
    return f;
}

test('PLCC map preserves all address/data pins, nonsequential data order and supplies', () => {
    assert.equal(HARRIS_80C286_PLCC.length, 69);
    assert.equal(HARRIS_80C286_PLCC[31], 'clk');
    assert.equal(HARRIS_80C286_PLCC[29], 'reset');
    assert.equal(HARRIS_80C286_PLCC[63], 'ready_n');
    assert.equal(HARRIS_80C286_PLCC[36], 'd0');
    assert.equal(HARRIS_80C286_PLCC[37], 'd8');
    assert.equal(HARRIS_80C286_PLCC[50], 'd7');
    for (const p of [...bitPins('a', 24), ...D]) assert.equal(HARRIS_80C286_PLCC.filter(v => v === p).length, 1);
    assert.deepEqual(HARRIS_80C286_PLCC.flatMap((v, i) => v === 'vcc' ? [i] : []), [30, 62]);
    assert.deepEqual(HARRIS_80C286_PLCC.flatMap((v, i) => v === 'vss' ? [i] : []), [9, 35, 60]);
});

test('independent truth table checks all 16 bus status encodings', () => {
    const expected = ['interrupt-acknowledge', 'reserved', 'reserved', 'passive',
        'shutdown', 'memory-read', 'memory-write', 'passive',
        'reserved', 'io-read', 'io-write', 'passive',
        'reserved', 'code-read', 'reserved', 'passive'];
    for (let bits = 0; bits < 16; bits++) {
        assert.equal(decode286Status({cod_inta_n: bits >> 3, m_io: (bits >> 2) & 1,
            s1_n: (bits >> 1) & 1, s0_n: bits & 1}), expected[bits]);
    }
    assert.equal(decode286Status({cod_inta_n: 0, m_io: 1, s1_n: 0, s0_n: 0, a1: 1}), 'halt');
    assert.equal(decode286Status({cod_inta_n: 'X', m_io: 1, s1_n: 0, s0_n: 1}), 'unknown');
});

test('byte lanes and odd-word byte order are physical, not an 8086 address mask', () => {
    const plan = (address, width, value = 0) => plan286Transfers({kind: 'memory-write', address, width, value});
    assert.deepEqual(plan(0x123400, 1, 0x56).map(t => [t.address, t.a0, t.bhe_n, t.data]), [[0x123400, 0, 1, 0x56]]);
    assert.deepEqual(plan(0x123401, 1, 0x56).map(t => [t.address, t.a0, t.bhe_n, t.data]), [[0x123401, 1, 0, 0x5600]]);
    assert.deepEqual(plan(0x123400, 2, 0x7856).map(t => [t.address, t.a0, t.bhe_n, t.data]), [[0x123400, 0, 0, 0x7856]]);
    assert.deepEqual(plan(0x123401, 2, 0x7856).map(t => [t.address, t.a0, t.bhe_n, t.data]),
        [[0x123401, 1, 0, 0x5600], [0x123402, 0, 1, 0x78]]);
    assert.throws(() => plan286Transfers({kind: 'io-read', address: 0x10000}), RangeError);
    assert.throws(() => plan(0xffffff, 2), /wrap/);
});

test('gated entry and reset are mandatory; no fabricated boot fetch is emitted', () => {
    assert.throws(() => new Harris80C286Bus(), fault('EXPERIMENT_DISABLED'));
    const f = fixture();
    assert.throws(() => f.clock(), fault('RESET_REQUIRED'));
    f.boot();
    assert.equal(f.bus.pending, null);
    assert.equal(f.bus.capabilities.cpu, false);
    assert.equal(f.bus.capabilities.clockEdges, false);
});

test('opt-in NMI qualifies four low/high periods, latches one edge, and reset clears it',()=>{
    const f=fixture({nmiEnabled:true});f.boot();
    for(let i=0;i<3;i++)f.clock({nmi:1});assert.equal(f.bus.nmiPending,false);
    f.clock({nmi:1});assert.equal(f.bus.takeNMI(),true);
    for(let i=0;i<10;i++)f.clock({nmi:1});assert.equal(f.bus.takeNMI(),false);
    for(let i=0;i<3;i++)f.clock({nmi:0});
    for(let i=0;i<4;i++)f.clock({nmi:1});assert.equal(f.bus.takeNMI(),false);
    for(let i=0;i<4;i++)f.clock({nmi:0});
    for(let i=0;i<4;i++)f.clock({nmi:1});assert.equal(f.bus.nmiPending,true);
    f.clock({reset:1});assert.equal(f.bus.nmiPending,false);
});
test('NMI qualification rejects disconnected nets and does not enable INTR',()=>{
    const f=fixture({nmiEnabled:true});f.boot();
    assert.throws(()=>f.clock({nmi:'Z'}),fault('FLOATING'));
    const g=fixture({nmiEnabled:true});g.boot();
    assert.throws(()=>g.clock({intr:1}),fault('UNSUPPORTED_INPUT'));
});

test('INTA planning is an explicit two-cycle, addressless byte transaction',()=>{
    const plan=plan286Transfers({kind:'interrupt-acknowledge'});
    assert.deepEqual(plan.map(t=>[t.ackIndex,t.width,t.cod_inta_n,t.m_io,t.s1_n,t.s0_n]),[[0,1,0,0,0,0],[1,1,0,0,0,0]]);
    for(const bad of [{address:1},{width:2},{value:1}])
        assert.throws(()=>plan286Transfers({kind:'interrupt-acknowledge',...bad}),RangeError);
    const f=fixture();f.boot();assert.throws(()=>f.bus.submit({kind:'interrupt-acknowledge'}),fault('EXPERIMENT_DISABLED'));
});

function acknowledge(f,vector,{extraWaits=1,earlySecond=false,floatVector=false}={}) {
    const completions=[];
    for(let count=0;count<100;count++) {
        const pending=f.bus.pending;
        if(!pending)return completions;
        const second=pending.index===1;
        const ready_n=pending.waits < extraWaits && !(earlySecond&&second) ? 1 : 0;
        const currentVector=typeof vector==='function'?vector(pending.waits):vector;
        const data=Object.fromEntries(D.map((p,i)=>[p,second&&!floatVector&&i<8?(currentVector>>i)&1:'Z']));
        const completion=f.clock({...data,ready_n});if(completion)completions.push(completion);
    }
    assert.fail('INTA did not complete within owned budget');
}
test('INTA ignores floating first-cycle data, samples second vector, and preserves the idle gap',()=>{
    const f=fixture({intrEnabled:true,traceLimit:512});f.boot();
    f.clock({intr:1});assert.equal(f.bus.intrLevel,1);assert.equal(f.bus.pending,null);
    f.clock({intr:0});assert.equal(f.bus.intrLevel,0);
    f.bus.submit({kind:'interrupt-acknowledge'});
    const done=acknowledge(f,0xa5);
    assert.equal(done.length,2);assert.equal(done[0].ackIndex,0);assert.equal(done[0].last,false);
    assert.equal(done[1].ackIndex,1);assert.equal(done[1].last,true);assert.equal(done[1].operand,0xa5);
    const trace=f.bus.getTrace().entries;
    const firstEnd=trace.findIndex(e=>e.completion?.ackIndex===0);
    assert.deepEqual(trace.slice(firstEnd+1,firstEnd+7).map(e=>e.state),Array(6).fill('TI'));
    assert.equal(trace[firstEnd+7].state,'TS');
    const firstTS=trace.findIndex(e=>e.state==='TS');
    for(const e of trace.slice(firstTS,firstEnd+7)) {
        for(const pin of bitPins('a',24))assert.equal(e.drives[pin],'Z');
    }
    const second=trace.slice(firstEnd+7);
    assert.deepEqual(second.map(e=>[e.state,e.phase,e.drives.lock_n]),[
        ['TS',1,0],['TS',2,0],['TC',1,0],['TC',2,0],['TC',1,1],['TC',2,1]
    ]);
    assert.equal(second[3].drives.a0,'Z');assert.equal(second[4].drives.a0,0);
    assert.equal(second[3].drives.bhe_n,'Z');assert.equal(second[4].drives.bhe_n,1);
    for(const e of trace.slice(firstTS))for(const pin of D)assert.equal(e.drives[pin],'Z');
});
test('INTA second cycle refuses missing external wait and missing vector data',()=>{
    const f=fixture({intrEnabled:true});f.boot();f.bus.submit({kind:'interrupt-acknowledge'});
    assert.throws(()=>acknowledge(f,0x40,{earlySecond:true}),fault('INTA_WAIT_REQUIRED'));
    assert.equal(f.bus.faulted,true);
    const g=fixture({intrEnabled:true});g.boot();g.bus.submit({kind:'interrupt-acknowledge'});
    assert.throws(()=>acknowledge(g,0x40,{floatVector:true}),fault('FLOATING'));
});
test('INTA LOCK releases after first TC even with extended waits and vector changes',()=>{
    const f=fixture({intrEnabled:true,traceLimit:512});f.boot();f.bus.submit({kind:'interrupt-acknowledge'});
    const done=acknowledge(f,waits=>waits<3?0x11:0x7e,{extraWaits:3});
    assert.equal(done[0].waits,3);assert.equal(done[1].waits,3);assert.equal(done[1].operand,0x7e);
    const active=f.bus.getTrace().entries.filter(e=>e.state==='TC');
    assert.deepEqual(active.map(e=>e.drives.lock_n),[0,0,1,1,1,1,1,1,0,0,1,1,1,1,1,1]);
});
test('RESET cancels INTA between cycles and removes stale vector/gap state',()=>{
    const f=fixture({intrEnabled:true});f.boot();f.bus.submit({kind:'interrupt-acknowledge'});
    let first;
    for(let i=0;i<20&&!first;i++)first=f.clock({ready_n:0});
    assert.equal(first.ackIndex,0);assert.equal(f.bus.ackGap,6);
    f.clock({reset:1});assert.equal(f.bus.pending,null);assert.equal(f.bus.ackGap,0);assert.equal(f.bus.intrLevel,0);
    f.boot();f.bus.submit({kind:'interrupt-acknowledge'});assert.equal(acknowledge(f,0x31)[1].operand,0x31);
});

test('reset drives documented logical values and rejects 16-period reset', () => {
    const f = fixture();
    for (let i = 0; i < 16; i++) {
        const out = f.begin({reset: 1});
        assert.equal(out.a23, 1); assert.equal(out.a0, 1);
        assert.equal(out.bhe_n, 1); assert.equal(out.s1_n, 1); assert.equal(out.s0_n, 1);
        assert.equal(out.m_io, 0); assert.equal(out.cod_inta_n, 0);
        assert.equal(out.hlda, 0); assert.equal(out.peack_n, 1); assert.equal(out.lock_n, 1);
        for (const p of D) assert.equal(out[p], 'Z');
        f.end();
    }
    assert.throws(() => f.clock({reset: 0}), fault('SHORT_RESET'));
});

test('initialization delay is explicit model policy: 50 complete periods', () => {
    const f = fixture();
    for (let i = 0; i < 17; i++) f.clock({reset: 1});
    for (let i = 0; i < 49; i++) {
        f.clock({reset: 0});
        assert.throws(() => f.bus.submit({kind: 'code-read', address: 0xfffff0}), fault('BUS_UNAVAILABLE'));
    }
    f.clock();
    f.bus.submit({kind: 'code-read', address: 0xfffff0, width: 2});
    const out = f.begin();
    assert.equal(out.a23, 1); assert.equal(out.a20, 1);
    assert.equal(out.a4, 1); assert.equal(out.a0, 0);
    assert.equal(out.cod_inta_n, 1); assert.equal(out.m_io, 1);
    assert.equal(out.s1_n, 0); assert.equal(out.s0_n, 1);
    f.end();
});

test('read uses TS1 TS2 TC1 TC2; READY only sampled at TC2 and is active low', () => {
    const f = fixture(); f.boot();
    f.bus.submit({kind: 'memory-read', address: 0x500, width: 2});
    const phases = [];
    for (let i = 0; i < 3; i++) {
        const out = f.begin({ready_n: 'Z'});
        phases.push([f.bus.state, f.bus.phase, out.s1_n, out.s0_n]);
        assert.equal(f.end(), null);
    }
    assert.deepEqual(phases, [['TS', 1, 0, 1], ['TS', 2, 0, 1], ['TC', 1, 1, 1]]);
    f.begin({ready_n: 1});
    assert.equal(f.end(), null, 'high means wait, not ready');
    assert.equal(f.bus.state, 'TC');
    f.clock({ready_n: 0}); // TC1: early low must not sample floating data
    f.begin();
    const result = f.end(bitDrives(D, 0xabcd));
    assert.equal(result.operand, 0xabcd);
    assert.equal(result.waits, 1);
    assert.equal(f.bus.state, 'TI');
});

test('read data comes from the resolved selected byte lane, at acceptance time', () => {
    const f = fixture(); f.boot();
    f.bus.submit({kind: 'memory-read', address: 0x501});
    for (let i = 0; i < 3; i++) f.clock();
    f.begin();
    assert.equal(f.end(Object.fromEntries(D.slice(8).map((p, i) => [p, (0x97 >> i) & 1]))).operand, 0x97);
    // Unselected low lane stayed floating; requiring it would be a false fault.
    assert.equal(f.circuit.read('cpu', 'd0'), 'Z');
});

test('write drive starts TS2 and survives exactly one subsequent modeled clock', () => {
    const f = fixture(); f.boot();
    f.bus.submit({kind: 'memory-write', address: 0x500, width: 2, value: 0xbeef});
    assert.equal(f.begin().d0, 'Z'); f.end();
    assert.equal(f.begin().d0, 1); f.end();
    f.clock({ready_n: 1}); f.clock(); // complete TC wait
    assert.equal(f.begin().d0, 1); f.end({ready_n: 0}); // next TC1
    f.begin(); const completion = f.end();
    assert.equal(completion.data, 0xbeef);
    assert.equal(f.begin().d0, 1); f.end(); // TI1 hold
    assert.equal(f.begin().d0, 'Z'); f.end(); // TI2 release
});

test('odd-word reads complete two physical cycles in order and assemble little endian', () => {
    const f = fixture(); f.boot();
    f.bus.submit({kind: 'memory-read', address: 0x501, width: 2});
    for (let i = 0; i < 3; i++) f.clock();
    f.begin(); const first = f.end(bitDrives(D, 0x3400));
    assert.equal(first.address, 0x501); assert.equal(first.data, 0x34); assert.equal(first.last, false);
    for (let i = 0; i < 3; i++) f.clock();
    f.begin(); const last = f.end(bitDrives(D, 0x0012));
    assert.equal(last.address, 0x502); assert.equal(last.operand, 0x1234); assert.equal(last.last, true);
});

test('split odd-word writes accept exactly two ordered lanes and reconstruct the operand', () => {
    const f = fixture(); f.boot();
    f.bus.submit({kind: 'memory-write', address: 0x501, width: 2, value: 0xabcd});
    const accepted = [];
    for (let i = 0; i < 8; i++) {
        const result = f.clock();
        if (result) accepted.push(result);
    }
    assert.deepEqual(accepted.map(r => [r.address, r.data, r.last]), [[0x501, 0xcd, false], [0x502, 0xab, true]]);
    assert.equal(accepted[1].operand, 0xabcd);
    assert.equal(f.clock(), null, 'idle does not repeat acceptance');
});

test('back-to-back write/read holds old write data through TS1 then releases before read data', () => {
    const f = fixture(); f.boot();
    f.bus.submit({kind: 'memory-write', address: 0, value: 1});
    for (let i = 0; i < 4; i++) f.clock();
    f.bus.submit({kind: 'memory-read', address: 2});
    assert.equal(f.begin().d0, 1); f.end(); // new TS1 holds the previous write
    assert.equal(f.begin().d0, 'Z'); f.end(); // TS2 has released it
    f.clock(bitDrives(D, 0x22)); // peer may now drive read data, no CPU contention
    f.begin();
    assert.equal(f.end().operand, 0x22);
});

test('back-to-back writes change data only in the second TS phase', () => {
    const f = fixture(); f.boot();
    f.bus.submit({kind: 'memory-write', address: 0, value: 1});
    for (let i = 0; i < 4; i++) f.clock();
    f.bus.submit({kind: 'memory-write', address: 2, value: 2});
    let out = f.begin(); assert.equal(out.d0, 1); assert.equal(out.d1, 0); f.end();
    out = f.begin(); assert.equal(out.d0, 0); assert.equal(out.d1, 1); f.end();
    f.clock(); f.begin(); assert.equal(f.end().operand, 2);
});

test('I/O cycles preserve port space and reject truncation', () => {
    const f = fixture(); f.boot();
    assert.throws(() => f.bus.submit({kind: 'io-read', address: 0x10000}), RangeError);
    f.bus.submit({kind: 'io-read', address: 0x1234});
    const out = f.begin();
    for (let i = 16; i < 24; i++) assert.equal(out[`a${i}`], 0);
    assert.equal(out.m_io, 0); assert.equal(out.cod_inta_n, 1);
    f.end();
});

test('unwired READY/data and a shorted write bus fail on resolved nets', () => {
    for (const mode of ['ready', 'data', 'contention']) {
        const f = fixture(); f.boot();
        f.bus.submit({kind: mode === 'contention' ? 'memory-write' : 'memory-read', address: 0,
            value: mode === 'contention' ? 1 : 0});
        for (let i = 0; i < 3; i++) f.clock();
        f.begin();
        assert.throws(() => f.end(mode === 'ready' ? {ready_n: 'Z'} : mode === 'contention' ? {d0: 0} : {}),
            fault(mode === 'contention' ? 'CONTENTION' : 'FLOATING'));
        assert.throws(() => f.clock(), fault('BUS_FAULTED'));
    }
});

test('unsupported asynchronous interfaces are refused, including HOLD during reset', () => {
    const f = fixture();
    assert.throws(() => f.clock({reset: 1, hold: 1}), fault('UNSUPPORTED_HOLD'));
    for (const pin of ['hold', 'intr', 'nmi', 'pereq', 'busy_n', 'error_n']) {
        const g = fixture(); g.boot();
        assert.throws(() => g.clock({[pin]: pin.endsWith('_n') ? 0 : 1}),
            fault(pin === 'hold' ? 'UNSUPPORTED_HOLD' : 'UNSUPPORTED_INPUT'));
    }
});

test('RESET abandons a waiting write, removes the data drive and requires reinitialization', () => {
    const f = fixture(); f.boot();
    f.bus.submit({kind: 'memory-write', address: 0, value: 1});
    for (let i = 0; i < 4; i++) f.clock({ready_n: 1});
    assert.equal(f.bus.state, 'TC');
    const out = f.begin({reset: 1});
    assert.equal(out.d0, 'Z'); assert.equal(f.bus.pending, null);
    f.end();
    assert.throws(() => f.bus.submit({kind: 'memory-read', address: 0}), fault('BUS_UNAVAILABLE'));
});

test('host wait limit is bounded and cannot be recovered by merely changing READY', () => {
    const f = fixture({maxWaitStates: 1}); f.boot();
    f.bus.submit({kind: 'memory-read', address: 0});
    for (let i = 0; i < 3; i++) f.clock({ready_n: 1});
    f.begin(); assert.throws(() => f.end(), fault('WAIT_LIMIT'));
    assert.throws(() => f.clock({ready_n: 0}), fault('BUS_FAULTED'));
    f.boot();
});

test('clock order and transaction overlap are explicit errors', () => {
    const f = fixture(); f.boot();
    assert.throws(() => f.end(), fault('CLOCK_ORDER'));
    f.begin();
    assert.throws(() => f.begin(), fault('CLOCK_ORDER'));
    assert.throws(() => f.bus.submit({kind: 'memory-read', address: 0}), fault('BUS_UNAVAILABLE'));
    f.end();
    f.bus.submit({kind: 'memory-read', address: 0});
    assert.throws(() => f.bus.submit({kind: 'memory-read', address: 1}), fault('BUS_UNAVAILABLE'));
});

test('trace is bounded, deterministic and cannot mutate sequencer records', () => {
    const run = () => {
        const f = fixture({traceLimit: 3}); f.boot();
        return f.bus.getTrace();
    };
    assert.deepEqual(run(), run());
    assert.equal(run().dropped, 64);
    const f = fixture(); f.boot();
    const trace = f.bus.getTrace(); trace.entries[0].clock = -1;
    assert.equal(f.bus.getTrace().entries[0].clock, 1);
});

test('a new RESET after a qualification fault must itself last 17 periods', () => {
    const f = fixture();
    for (let i = 0; i < 16; i++) f.clock({reset: 1});
    assert.throws(() => f.clock({reset: 0}), fault('SHORT_RESET'));
    f.clock({reset: 1});
    assert.throws(() => f.clock({reset: 0}), fault('SHORT_RESET'));
    assert.equal(f.bus.resetClocks, 1);
});

test('bus trace opt-out preserves every period and fault qualification', () => {
    assert.throws(() => fixture({traceEnabled: 0}), /traceEnabled/);
    const on = fixture(), off = fixture({traceEnabled: false});
    for (const f of [on, off]) { f.boot(); f.bus.submit({kind:'memory-write', address:0x101, width:2, value:0x1234}); }
    for (let i = 0; i < 24; i++) {
        assert.deepEqual(off.begin(), on.begin());
        assert.deepEqual(off.end(), on.end());
        for (const key of ['state','phase','clock','address','resetClocks','intrSamples','nmiPending'])
            assert.deepEqual(off.bus[key], on.bus[key], key);
    }
    assert.ok(on.bus.getTrace().entries.length > 0);
    assert.deepEqual(off.bus.getTrace(), {dropped:0, entries:[]});
    for (const traceEnabled of [true, false]) {
        const f = fixture({traceEnabled});
        for(let i=0;i<16;i++)f.clock({reset:1});
        assert.throws(() => f.clock({reset:0}), fault('SHORT_RESET'));
    }
});

test('code fetch reaches an owned ROM through explicit nets; disconnects cannot boot invisibly', () => {
    for (const disconnected of [null, 'd0', 'a23']) {
        const bus = new Harris80C286Bus({enabled: true});
        const A = bitPins('a', 24);
        const controls = [...Object.keys(inactive), 'oe'];
        const rom = new Uint8Array(65536);
        rom.set([0xea, 0x00, 0x05, 0x00, 0x00], 0xfff0); // owned far-jump bytes, not executed
        const wires = [
            ...Object.keys(inactive).map(pin => ({from: 'control', fromTerminal: pin, to: 'cpu', toTerminal: pin})),
            {from: 'control', fromTerminal: 'oe', to: 'rom', toTerminal: 'oe'},
            ...[...A, ...D].filter(p => p !== disconnected).map(pin => ({from: 'cpu', fromTerminal: pin, to: 'rom', toTerminal: pin}))
        ];
        const circuit = new DigitalCircuit({enabled: true, wires, parts: [bus.part(),
            {id: 'control', pins: controls, outputs: controls},
            {id: 'rom', pins: [...A, ...D, 'oe'], outputs: D, evaluate(read) {
                if (read('oe') !== 1) return {};
                const address = readBits(A, read);
                if (address === null) return Object.fromEntries(D.map(p => [p, 'X']));
                if (address < 0xff0000) return {};
                const index = address - 0xff0000;
                return bitDrives(D, rom[index] | (rom[index + 1] << 8));
            }}]});
        circuit.drive('control', {...inactive, oe: 0});
        const read = p => circuit.require('cpu', p);
        const clock = (reset, oe = 0) => {
            circuit.drive('control', {reset, oe}); circuit.settle();
            circuit.drive('cpu', bus.beginClock(read)); circuit.settle();
            return bus.endClock(read);
        };
        for (let i = 0; i < 17; i++) clock(1);
        for (let i = 0; i < 50; i++) clock(0);
        bus.submit({kind: 'code-read', address: 0xfffff0, width: 2});
        // The test drives OE explicitly; this is NOT an 82C288 controller.
        for (let i = 0; i < 3; i++) clock(0);
        if (disconnected) assert.throws(() => clock(0, 1), fault(disconnected === 'd0' ? 'FLOATING' : 'UNKNOWN'));
        else assert.equal(clock(0, 1).operand, 0x00ea);
    }
});
