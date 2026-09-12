import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createNative286MemoryBus} from '../src/experimental/wired-kernel/bus-sequencer.js';
import {createBusSequencerOracle,passiveBusPins,runNativeBusSequencerOracle}
    from '../scripts/lib/harris-native-bus-sequencer-oracle.mjs';
const path=process.env.HARRIS_NET_WASM;
const module=path?await WebAssembly.compile(readFileSync(path)):null;
const optional={skip:!module&&'set HARRIS_NET_WASM to owned native build'};

test('native bus requires explicit gate and valid safe wait limit before build access',async()=>{
    await assert.rejects(createNative286MemoryBus(),{code:'EXPERIMENT_DISABLED'});
    for(const maxWaitStates of [0,-1,NaN,Infinity,1.5])
        await assert.rejects(createNative286MemoryBus({enabled:true,maxWaitStates}),RangeError);
    for(const flag of ['holdEnabled','nmiEnabled','intrEnabled','coprocessorEnabled'])
        await assert.rejects(createNative286MemoryBus({enabled:true,[flag]:true}),{code:'UNSUPPORTED_FEATURE'});
});
test('native memory bus differentially matches all outputs, phases and transfer completions',optional,async()=>{
    const report=await runNativeBusSequencerOracle(module);
    assert.equal(report.transactions,30);assert.equal(report.completions,36);
});
test('17 reset periods and 50 init periods; reset recovery and reset ignored pins',optional,async()=>{
    const h=await createBusSequencerOracle(module);
    assert.equal(h.period(passiveBusPins()).error.code,'RESET_REQUIRED');
    for(let i=0;i<16;i++)h.period({...passiveBusPins(),reset:1,intr:'Z',nmi:'X',pereq:1,busy_n:0,error_n:0});
    assert.equal(h.period(passiveBusPins()).error.code,'SHORT_RESET');
    for(let i=0;i<17;i++)h.period({...passiveBusPins(),reset:1});
    for(let i=0;i<49;i++)h.period(passiveBusPins());
    assert.equal(h.native.inspect().state,'INIT');assert.equal(h.native.inspect().initClocks,1);
    h.period(passiveBusPins());assert.equal(h.native.inspect().state,'TI');
    assert.equal(h.native.inspect().phase,1);
});
test('begin faults preserve reference ordering and faulted recovery state',optional,async()=>{
    for(const [pins,code] of [
        [{reset:'Z',hold:1},'FLOATING'],[{hold:1,pereq:1},'UNSUPPORTED_HOLD'],
        [{pereq:'X',intr:1},'UNKNOWN'],[{intr:1,nmi:'Z'},'UNSUPPORTED_INPUT'],
        [{nmi:'Z',busy_n:0},'FLOATING'],[{busy_n:0,error_n:'X'},'UNSUPPORTED_INPUT'],
        [{error_n:'X'},'UNKNOWN']]) {
        const h=await createBusSequencerOracle(module);h.boot();
        assert.equal(h.call('beginClock',{...passiveBusPins(),...pins}).error.code,code);
        assert.equal(h.native.inspect().open,false);
        assert.equal(h.call('beginClock',passiveBusPins()).error.code,'BUS_FAULTED');
        assert.equal(h.period({...passiveBusPins(),reset:1}).error,undefined);
    }
});
test('READY sampled only at TC2; wait limit mutation and odd-word partial completion preserved',optional,async()=>{
    const h=await createBusSequencerOracle(module,{maxWaitStates:2});h.boot();
    h.submit({kind:'memory-read',address:1,width:2});
    const pins=passiveBusPins();pins.d8=1;
    let first;
    while(!first){const r=h.period(pins);assert.equal(r.error,undefined);first=r.value;}
    assert.equal(first.last,false);assert.equal(first.data,1);
    assert.deepEqual(h.native.inspect().pending.bytes,[1]);
    while(!(h.native.inspect().state==='TC'&&h.native.inspect().phase===2)) {
        assert.equal(h.period({...pins,ready_n:'Z'}).error,undefined);
    }
    h.period({...pins,ready_n:1});h.period({...pins,ready_n:'X'});
    assert.equal(h.period({...pins,ready_n:1}).error.code,'WAIT_LIMIT');
    assert.equal(h.native.inspect().pending.waits,2);
    assert.deepEqual(h.native.inspect().pending.bytes,[1]);
    assert.equal(h.native.inspect().phase,2);assert.equal(h.native.inspect().open,false);
});
test('accepted data samples active lanes only; unknown READY precedes data; no partial byte commit',optional,async()=>{
    for(const failure of ['ready','low','high']) {
        const h=await createBusSequencerOracle(module);h.boot();
        h.submit({kind:'code-read',address:0,width:2});
        while(!(h.native.inspect().state==='TC'&&h.native.inspect().phase===2))h.period(passiveBusPins());
        h.call('beginClock',passiveBusPins());
        const pins={...passiveBusPins(),ready_n:failure==='ready'?'Z':0,d3:failure==='low'?'X':1,d12:'Z'};
        const r=h.call('endClock',pins);
        assert.equal(r.error.code,failure==='low'?'UNKNOWN':'FLOATING');
        assert.deepEqual(h.native.inspect().pending.bytes,[]);
    }
    const h=await createBusSequencerOracle(module);h.boot();h.submit({kind:'memory-read',address:1});
    let done;
    while(!done){const r=h.period({...passiveBusPins(),...Object.fromEntries(Array.from({length:8},(_,i)=>[`d${i}`,'Z']))});
        assert.equal(r.error,undefined);done=r.value;}
    assert.equal(done.operand,0);
});
test('write data survives exactly one following period and reset cancels unfinished odd word',optional,async()=>{
    const h=await createBusSequencerOracle(module);h.boot();
    h.submit({kind:'memory-write',address:1,width:2,value:0x125a});
    let done;while(!done)done=h.period(passiveBusPins()).value;
    assert.equal(done.last,false);assert.equal(done.data,0x5a);
    assert.equal(h.native.inspect().writeHold,1);
    const next=h.call('beginClock',passiveBusPins()).value;
    assert.equal(next.d8,0);assert.equal(next.d9,1);assert.equal(next.d0,'Z');
    h.call('endClock',passiveBusPins());assert.equal(h.native.inspect().writeHold,0);
    h.period({...passiveBusPins(),reset:1});assert.equal(h.native.inspect().pending,null);
});
test('clock order is nonfaulting; unsupported or malformed transactions fail atomically',optional,async()=>{
    const h=await createBusSequencerOracle(module);h.boot();
    assert.equal(h.call('endClock',null).error.code,'CLOCK_ORDER');
    h.call('beginClock',passiveBusPins());assert.equal(h.call('beginClock',null).error.code,'CLOCK_ORDER');
    h.call('endClock',passiveBusPins());assert.equal(h.native.inspect().faulted,false);
    for(const transaction of [null,{}, {kind:'io-read',address:0},{kind:'interrupt-acknowledge'},
        {kind:'memory-read',address:0,locked:true},{kind:'memory-read',address:0,locked:'false'},
        {kind:'memory-read',address:0,hold:true},{kind:'memory-read',address:0,nmi:true},
        {kind:'memory-read',address:0xffffff,width:2},{kind:'memory-read',address:NaN},
        {kind:'memory-write',address:0,width:1,value:256}]) {
        const before=h.native.inspect();assert.throws(()=>h.native.submit(transaction),{code:'UNSUPPORTED_TRANSACTION'});
        assert.deepEqual(h.native.inspect(),before);
    }
    h.submit({kind:'memory-read',address:0xffffff});
    assert.throws(()=>h.native.submit({kind:'io-read',address:0}),{code:'BUS_UNAVAILABLE'});
    while(h.native.inspect().pending)h.period(passiveBusPins());
    h.period(passiveBusPins());
});

test('all byte values exercise both lanes, odd operands, code status and sampled writes',optional,async()=>{
    const h=await createBusSequencerOracle(module,{maxWaitStates:Number.MAX_SAFE_INTEGER});h.boot();
    for(let value=0;value<256;value++) {
        for(const kind of ['memory-read','memory-write','code-read']) {
            h.submit({kind,address:0x70001+(value&1),width:2,value:value|((255-value)<<8)});
            let done;
            for(let bound=0;!done?.last;bound++) {
                assert.ok(bound<20);
                const pins={...passiveBusPins(),...Object.fromEntries(Array.from({length:16},(_,i)=>[`d${i}`,(value>>(i%8))&1]))};
                const result=h.period(pins);assert.equal(result.error,undefined);if(result.value)done=result.value;
            }
            assert.equal(done.operand,kind==='memory-write'?value|((255-value)<<8):value|(value<<8));
        }
    }
});

test('second odd-word data fault retains first byte; writes sample nets rather than trusting submitted data',optional,async()=>{
    for(const kind of ['memory-read','memory-write']) {
        const h=await createBusSequencerOracle(module);h.boot();h.submit({kind,address:1,width:2,value:0x3456});
        let first;while(!first)first=h.period({...passiveBusPins(),d8:1}).value;
        const bytes=[...h.native.inspect().pending.bytes];
        while(!(h.native.inspect().state==='TC'&&h.native.inspect().phase===2))h.period(passiveBusPins());
        h.call('beginClock',passiveBusPins());
        assert.equal(h.call('endClock',{...passiveBusPins(),d4:'X',d8:'Z'}).error.code,'UNKNOWN');
        assert.deepEqual(h.native.inspect().pending.bytes,bytes);
        assert.equal(h.native.inspect().pending.index,1);
    }
});
