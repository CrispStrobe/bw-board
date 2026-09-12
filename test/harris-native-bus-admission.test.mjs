import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const wasmBytes=process.env.HARRIS_NET_WASM?new Uint8Array(readFileSync(process.env.HARRIS_NET_WASM)):null;
const native={skip:wasmBytes?false:'build native kernel and set HARRIS_NET_WASM; bus admission not exercised'};
const COUNTERS=['attempts','admissions','failures','inputMapVisits','outputMapVisits','externalMapVisits'];

async function rawBus(){
    const {instance}=await WebAssembly.instantiate(wasmBytes,{}),e=instance.exports,v=new DataView(e.memory.buffer);
    let cursor=e.arena_ptr();const alloc=bytes=>{cursor=(cursor+3)&~3;const p=cursor;cursor+=bytes;return p;};
    const p={context:alloc(35*4),offsets:alloc(59*4),ids:alloc(58*4),drivers:alloc(58),live:alloc(58),conflicts:alloc(58),
        ops:alloc(4),staged:alloc(58),published:alloc(58),publishedConflicts:alloc(58),dependencyOffsets:alloc(4),
        dependencies:alloc(4),previous:alloc(58),changed:alloc(58),memory:alloc(32768),states:alloc(9*4),memoryStaged:alloc(9*4),
        protected:alloc(1),inputs:alloc(28),inputConflicts:alloc(28),drives:alloc(8),present:alloc(1),memoryChanged:alloc(1),
        memoryFault:alloc(3*4),inputNets:alloc(28*4),outputIds:alloc(8*4),reverseOffsets:alloc(59*4),reverseOperations:alloc(4),
        affectedOperations:alloc(4),busInputNets:alloc(24*4),busOutputIds:alloc(48*4),busExternalIds:alloc(128*4),
        busExternalValues:alloc(128),lifecycle:alloc(2*4),run:alloc(3*4),results:alloc(18*4),busContext:alloc(11*4),fault:alloc(4*4),
        phaseContext:alloc(16*4),phaseState:alloc(6*4),phaseInputNets:alloc(6*4),controllerIds:alloc(7*4),latchInputNets:alloc(27*4),
        latchIds:alloc(26*4),latchValues:alloc(26),phaseInputs:alloc(27),phaseConflicts:alloc(27),phaseOutputs:alloc(27),
        phaseFault:alloc(2*4),ready:alloc(4),present:alloc(1),phaseLifecycle:alloc(3*4)};
    const put=(at,values)=>values.forEach((n,i)=>v.setUint32(at+4*i,n,true));
    put(p.context,[58,58,p.offsets,p.ids,p.drivers,p.live,p.conflicts,0,p.ops,p.staged,p.published,p.publishedConflicts,8,
        p.dependencyOffsets,p.dependencies,0,p.previous,p.changed,1,p.memory,p.states,p.memoryStaged,p.protected,p.inputs,
        p.inputConflicts,p.drives,p.present,p.memoryChanged,p.memoryFault,p.inputNets,p.outputIds,1,p.reverseOffsets,
        p.reverseOperations,p.affectedOperations]);
    put(p.offsets,Array.from({length:59},(_,i)=>i));put(p.ids,Array.from({length:58},(_,i)=>i));
    new Uint8Array(e.memory.buffer,p.drivers,58).fill(3);put(p.dependencyOffsets,[0]);
    put(p.inputNets,Array(28).fill(57));put(p.outputIds,Array.from({length:8},(_,i)=>i));
    put(p.busInputNets,[48,49,50,51,52,53,54,55,...Array(16).fill(57)]);put(p.busOutputIds,Array.from({length:48},(_,i)=>i));
    put(p.busExternalIds,[...Array.from({length:10},(_,i)=>48+i),...Array(118).fill(0)]);
    new Uint8Array(e.memory.buffer,p.busExternalValues,128).fill(3);
    new Uint8Array(e.memory.buffer,p.busExternalValues,10).set([1,0,0,0,0,1,1,0,1,0]);
    put(p.phaseState,[0,1,0,0,0,0]);put(p.phaseInputNets,[48,55,41,42,43,44]);
    put(p.controllerIds,Array.from({length:7},(_,i)=>i));put(p.latchInputNets,[0,...Array.from({length:26},(_,i)=>i)]);
    put(p.latchIds,Array.from({length:26},(_,i)=>7+i));
    put(p.phaseContext,[p.context,p.phaseState,0,0,p.phaseInputNets,p.controllerIds,p.latchInputNets,p.latchIds,p.latchValues,
        p.phaseInputs,p.phaseConflicts,p.phaseOutputs,p.phaseFault,p.ready,p.present,p.phaseLifecycle]);
    put(p.busContext,[p.context,p.phaseContext,p.busInputNets,p.busOutputIds,p.busExternalIds,p.busExternalValues,10,p.lifecycle,p.run,p.results,1]);
    const words=(at,length)=>Array.from(new Uint32Array(e.memory.buffer,at,length));
    const counters=()=>Object.fromEntries(COUNTERS.map((name,i)=>[name,words(e.bus_admission_counters_ptr(),6)[i]]));
    const fault=()=>words(p.fault,4),life=()=>words(p.lifecycle,2);
    const execution=()=>({drivers:Array.from(new Uint8Array(e.memory.buffer,p.drivers,58)),
        memory:words(p.states,9),memoryStaged:words(p.memoryStaged,9),
        work:words(e.incremental_work_counters_ptr(),12),producer:words(e.producer_work_counters_ptr(),18)});
    const admitMemory=()=>e.admit_owned_memory_context(p.context,p.fault)>>>0;
    const admitBus=()=>e.admit_owned_bus_context(p.busContext,p.fault)>>>0;
    return {e,p,v,put,words,counters,fault,life,execution,admitMemory,admitBus};
}

const admitted=async()=>{const k=await rawBus();assert.equal(k.admitMemory(),0);assert.equal(k.admitBus(),0);return k;};

test('bus admission visits every immutable map exactly once',native,async()=>{
    const k=await admitted();
    assert.deepEqual(k.counters(),{attempts:1,admissions:1,failures:0,inputMapVisits:24,outputMapVisits:48,externalMapVisits:10});
    assert.deepEqual(k.fault(),[0,0,0,0]);assert.deepEqual(k.life(),[0,0]);
});

test('bus admission accepts the exact 128-external boundary',native,async()=>{
    const k=await rawBus();assert.equal(k.admitMemory(),0);k.v.setUint32(k.p.busContext+6*4,128,true);
    assert.equal(k.admitBus(),0);assert.equal(k.counters().externalMapVisits,128);
});

test('bus admission refuses each final map entry, bound and live value with its existing receipt',native,async()=>{
    const cases=[
        ['count',0,k=>k.v.setUint32(k.p.busContext+6*4,129,true)],
        ['input',23,k=>k.v.setUint32(k.p.busInputNets+23*4,58,true)],
        ['output',47,k=>k.v.setUint32(k.p.busOutputIds+47*4,58,true)],
        ['external',9,k=>k.v.setUint32(k.p.busExternalIds+9*4,58,true)],
        ['level',9,k=>new Uint8Array(k.e.memory.buffer,k.p.busExternalValues,10)[9]=4]
    ];
    for(const [name,pin,mutate] of cases){
        const k=await rawBus();assert.equal(k.admitMemory(),0);mutate(k);const before=k.execution();
        assert.equal(k.admitBus(),8,name);assert.deepEqual(k.fault(),[8,2,pin,0xffffffff],name);
        assert.deepEqual(k.execution(),before,`${name}: refusal precedes execution mutation`);
        assert.equal(k.counters().attempts,1);assert.equal(k.counters().admissions,0);assert.equal(k.counters().failures,1);
    }
});

test('admitted runtime refuses stale pointer, count and graph-bound authority before a writer',native,async()=>{
    const cases=[
        ['context pointer',0,k=>k.v.setUint32(k.p.busContext,k.p.context+4,true)],
        ['input pointer',2,k=>k.v.setUint32(k.p.busContext+2*4,k.p.busInputNets+4,true)],
        ['output pointer',3,k=>k.v.setUint32(k.p.busContext+3*4,k.p.busOutputIds+4,true)],
        ['external pointer',4,k=>k.v.setUint32(k.p.busContext+4*4,k.p.busExternalIds+4,true)],
        ['value pointer',5,k=>k.v.setUint32(k.p.busContext+5*4,k.p.busExternalValues+1,true)],
        ['count',6,k=>k.v.setUint32(k.p.busContext+6*4,9,true)],
        ['net bound',0,k=>k.v.setUint32(k.p.context,57,true)],
        ['driver bound',1,k=>k.v.setUint32(k.p.context+4,57,true)]
    ];
    for(const [name,,mutate] of cases){
        const k=await admitted();mutate(k);const before=k.execution();
        assert.equal(k.e.begin_bus_memory_clock(k.p.busContext,k.p.fault),8,name);
        assert.deepEqual(k.fault(),[8,2,0,0xffffffff],name);assert.deepEqual(k.execution(),before,`${name}: no writer called`);
    }
});

test('post-admission arena map edits cannot redirect any of the three consumers',native,async()=>{
    {
        const k=await admitted();k.e.bus_initialize(1024);k.v.setUint32(k.p.busInputNets,49,true);
        k.e.begin_bus_memory_clock(k.p.busContext,k.p.fault);
        assert.equal(k.e.bus_inspect(0),1,'gather uses captured reset net, not edited arena input map');
        assert.equal(k.e.bus_inspect(3),0,'captured reset reaches the sequencer without a NEED_RESET fault');
    }
    {
        const k=await admitted();k.e.bus_initialize(1024);k.v.setUint32(k.p.busExternalIds,49,true);
        k.e.begin_bus_memory_clock(k.p.busContext,k.p.fault);
        assert.equal(new Uint8Array(k.e.memory.buffer,k.p.drivers,58)[48],1,
            'external publication uses captured driver ID');
    }
    {
        const k=await admitted();k.e.bus_initialize(1024);k.v.setUint32(k.p.busOutputIds,47,true);
        k.e.begin_bus_memory_clock(k.p.busContext,k.p.fault);
        assert.equal(new Uint8Array(k.e.memory.buffer,k.p.drivers,58)[0],1,
            'CPU output publication uses captured driver ID');
    }
});

test('every bus, graph and memory re-admission attempt revokes the preceding bus grant',native,async()=>{
    {
        const k=await admitted();k.v.setUint32(k.p.busOutputIds+47*4,58,true);
        assert.equal(k.admitBus(),8,'failed bus re-admission');k.v.setUint32(k.p.busOutputIds+47*4,47,true);
        k.v.setUint32(k.p.lifecycle+4,0,true);const before=k.execution();
        assert.equal(k.e.begin_bus_memory_clock(k.p.busContext,k.p.fault),8);assert.deepEqual(k.execution(),before);
    }
    for(const [name,readmit] of [
        ['successful memory',k=>k.admitMemory()],
        ['successful graph',k=>k.e.admit_owned_context(k.p.context)>>>0],
        ['failed memory',k=>{new Uint8Array(k.e.memory.buffer,k.p.protected,1)[0]=2;
            const result=k.admitMemory();new Uint8Array(k.e.memory.buffer,k.p.protected,1)[0]=0;return result;}],
        ['failed graph',k=>{k.v.setUint32(k.p.context+31*4,2,true);
            const result=k.e.admit_owned_context(k.p.context)>>>0;k.v.setUint32(k.p.context+31*4,1,true);return result;}]
    ]){
        const k=await admitted();const result=readmit(k);assert.equal(result===0,name.startsWith('successful'),name);const before=k.execution();
        assert.equal(k.e.begin_bus_memory_clock(k.p.busContext,k.p.fault),8,`${name} re-admission revokes bus`);
        assert.deepEqual(k.execution(),before);
    }
});

test('mid-period re-admission invalidates the end edge before phase preview or memory commit',native,async()=>{
    const k=await admitted();k.e.bus_initialize(1024);assert.equal(k.e.begin_bus_memory_clock(k.p.busContext,k.p.fault),0);
    assert.equal(k.admitMemory(),0,'same-address memory re-admission revokes the derived bus grant');
    const before=k.execution();assert.equal(k.e.end_bus_memory_clock(k.p.busContext,k.p.fault),8);
    assert.deepEqual(k.fault(),[8,2,0,0xffffffff]);assert.deepEqual(k.execution(),before,'end refusal precedes preview and commit');
});

test('logical, sequencer and counter reset preserve mapping authority and live-level refusal',native,async()=>{
    const k=await admitted();k.e.reset_bus_admission_counters();k.e.bus_initialize(1024);
    new Uint8Array(k.e.memory.buffer,k.p.busExternalValues,10)[9]=255;const before=k.execution();
    assert.equal(k.e.begin_bus_memory_clock(k.p.busContext,k.p.fault),8);
    assert.deepEqual(k.fault(),[8,2,9,0xffffffff]);assert.deepEqual(k.execution(),before);
    assert.deepEqual(k.counters(),{attempts:0,admissions:0,failures:0,inputMapVisits:0,outputMapVisits:0,externalMapVisits:0});
});

test('raw mode retains full final-entry map and live-level validation',native,async()=>{
    for(const [name,pin,mutate] of [
        ['input',23,k=>k.v.setUint32(k.p.busInputNets+23*4,58,true)],
        ['output',47,k=>k.v.setUint32(k.p.busOutputIds+47*4,58,true)],
        ['external',9,k=>k.v.setUint32(k.p.busExternalIds+9*4,58,true)],
        ['level',9,k=>new Uint8Array(k.e.memory.buffer,k.p.busExternalValues,10)[9]=4]
    ]){
        const k=await rawBus();k.v.setUint32(k.p.busContext+10*4,0,true);mutate(k);const before=k.execution();
        assert.equal(k.e.begin_bus_memory_clock(k.p.busContext,k.p.fault),8,name);
        assert.deepEqual(k.fault(),[8,2,pin,0xffffffff]);assert.deepEqual(k.execution(),before);
    }
});

test('raw mode accepts count 128 and refuses 129 before a writer',native,async()=>{
    {
        const k=await rawBus();assert.equal(k.admitMemory(),0);k.v.setUint32(k.p.busContext+10*4,0,true);
        k.v.setUint32(k.p.busContext+6*4,128,true);k.e.bus_initialize(1024);
        assert.equal(k.e.begin_bus_memory_clock(k.p.busContext,k.p.fault),0,'exact raw count boundary');
    }
    {
        const k=await rawBus();k.v.setUint32(k.p.busContext+10*4,0,true);k.v.setUint32(k.p.busContext+6*4,129,true);
        const before=k.execution();assert.equal(k.e.begin_bus_memory_clock(k.p.busContext,k.p.fault),8);
        assert.deepEqual(k.fault(),[8,2,0,0xffffffff]);assert.deepEqual(k.execution(),before,'raw count refusal precedes a writer');
    }
});
