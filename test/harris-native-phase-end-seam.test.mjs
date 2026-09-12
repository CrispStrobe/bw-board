import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bitDrives} from '../src/experimental/digital-circuit.js';
import {captureWiredNetImage} from '../src/experimental/wired-net-image.js';
import {HARRIS_80C286_STATUS} from '../src/experimental/harris-80c286-contract.js';
import {createPhaseCircuitOracle} from '../scripts/lib/harris-native-phase-circuit-oracle.mjs';
const wasmBytes=process.env.HARRIS_NET_WASM?new Uint8Array(readFileSync(process.env.HARRIS_NET_WASM)):null;
const native={skip:wasmBytes?false:'build phase circuit v2 and set HARRIS_NET_WASM; native gate not exercised'};
const hostDrivers=f=>new Map(captureWiredNetImage({enabled:true,circuit:f.circuit}).terminals
    .filter(t=>t.name.startsWith('host.')).map(t=>[t.name.slice(5),t.driver]));
const begin=(f,values={})=>{
    const levels=f.kernel.inspect().driverLevels,ids=hostDrivers(f);
    for(const [pin,value] of Object.entries(values))levels[ids.get(pin)]=value==='X'?2:value==='Z'?3:value;
    return f.kernel.beginClock(levels);
};
const period=(f,values)=>{begin(f,values);f.kernel.previewEndClock();return f.kernel.finishEndClock();};
const writeTC2=f=>{
    period(f,f.passive);
    const active={...f.passive,...HARRIS_80C286_STATUS['memory-write'],...bitDrives(f.A,0x500),...bitDrives(f.D,0x1234)};
    period(f,active);period(f,active);period(f,f.passive);begin(f,f.passive);
};
const parity=(a,b)=>{
    assert.deepEqual(a.kernel.inspect(),b.kernel.inspect());
    assert.deepEqual(a.kernel.inspectPhase(),b.kernel.inspectPhase());
    for(let bank=0;bank<2;bank++)assert.deepEqual(a.kernel.inspectMemory(bank),b.kernel.inspectMemory(bank));
};

test('split end preview preserves commands/data and writes only when finish consumes READY',native,async()=>{
    const f=await createPhaseCircuitOracle({wasmBytes});writeTC2(f);
    const before=f.kernel.inspect(),memory=f.kernel.inspectMemory(0);
    assert.equal(memory.writes,0);assert.deepEqual(memory.pending,{a:0x280,byte:0x34});
    assert.equal(f.kernel.previewEndClock().ready,0);
    assert.deepEqual(f.kernel.inspect(),before);
    assert.deepEqual(f.kernel.inspectMemory(0),memory);
    assert.equal(f.kernel.inspectPhase().periodOpen,true);
    assert.equal(f.kernel.inspectPhase().open,true);
    assert.equal(f.kernel.finishEndClock().ready,0);
    assert.equal(f.kernel.inspectPhase().periodOpen,false);
    assert.equal(f.kernel.inspectMemory(0).writes,1);
    assert.equal(f.kernel.inspectMemory(0).bytes[0x280],0x34);
    assert.equal(f.kernel.inspectMemory(1).bytes[0x280],0x12);
});

test('split end ordering errors are recoverable without duplicate trailing edges',native,async()=>{
    const f=await createPhaseCircuitOracle({wasmBytes});
    for(const method of ['previewEndClock','finishEndClock','abortEndClock'])assert.throws(()=>f.kernel[method](),{code:'CLOCK_ORDER'});
    begin(f,f.passive);assert.throws(()=>f.kernel.finishEndClock(),{code:'CLOCK_ORDER'});
    f.kernel.previewEndClock();
    for(const method of ['beginClock','previewEndClock','endClock'])assert.throws(()=>f.kernel[method](),{code:'CLOCK_ORDER'});
    assert.equal(f.kernel.inspectPhase().faulted,false);f.kernel.finishEndClock();
    assert.throws(()=>f.kernel.finishEndClock(),{code:'CLOCK_ORDER'});
    writeTC2(f);f.kernel.previewEndClock();f.kernel.finishEndClock();
    assert.throws(()=>f.kernel.finishEndClock(),{code:'CLOCK_ORDER'});
    assert.equal(f.kernel.inspectMemory(0).writes,1);
    period(f,{...f.passive,reset:1});period(f,f.passive);
    assert.equal(f.kernel.inspectPhase().faulted,false);
});

test('preview input faults and explicit sampling abort never commit an armed write',native,async()=>{
    for(const abort of [false,true]) {
        const f=await createPhaseCircuitOracle({wasmBytes});
        period(f,f.passive);
        const active={...f.passive,...HARRIS_80C286_STATUS['memory-write'],...bitDrives(f.A,0x500),...bitDrives(f.D,0xabcd)};
        period(f,active);period(f,active);period(f,f.passive);
        begin(f,{...f.passive,ready_n:abort?0:'Z'});
        if(abort){f.kernel.previewEndClock();f.kernel.abortEndClock();}
        else assert.throws(()=>f.kernel.previewEndClock(),{code:'FLOATING'});
        assert.equal(f.kernel.inspectMemory(0).writes,0);assert.equal(f.kernel.inspectMemory(1).writes,0);
        assert.equal(f.kernel.inspectPhase().faulted,true);assert.equal(f.kernel.inspectPhase().periodOpen,false);
        for(const method of ['beginClock','endClock','previewEndClock','finishEndClock','abortEndClock']) {
            assert.throws(()=>f.kernel[method](),{code:'BOARD_FAULTED'});
        }
        // Faulted boards require reconstruction; RESET is not an implicit rollback.
        assert.throws(()=>begin(f,{...f.passive,reset:1}),{code:'BOARD_FAULTED'});
    }
});

test('split path matches composite/reference periods through reads, waits and reset write edges',native,async()=>{
    for(const mode of [{},{admittedGraph:true},{admittedGraph:true,incrementalGraph:true}]) {
        const f=await createPhaseCircuitOracle({wasmBytes,...mode}),ref=await createPhaseCircuitOracle({wasmBytes,...mode});
        const steps=[{...f.passive,reset:1},f.passive];
        for(let i=0;i<8;i++)for(const kind of ['memory-write','memory-read']) {
            const active={...f.passive,...HARRIS_80C286_STATUS[kind],...bitDrives(f.A,i*2),
                ...(kind==='memory-write'?bitDrives(f.D,i*977):Object.fromEntries(f.D.map(p=>[p,'Z'])))};
            steps.push(active,active,...Array.from({length:2*((i%3)+1)},(_,j)=>({...f.passive,ready_n:Number(j<2*(i%3))})));
        }
        const active={...f.passive,...HARRIS_80C286_STATUS['memory-write'],...bitDrives(f.A,0x500),...bitDrives(f.D,0xabcd)};
        steps.push(active,active,{...f.passive,ready_n:1},{...f.passive,reset:1},f.passive);
        for(const values of steps){period(f,values);assert.equal(ref.period(values),undefined);parity(f,ref);}
    }
});

test('schedule refuses a previewed period before mutating any pending driver',native,async()=>{
    const f=await createPhaseCircuitOracle({wasmBytes,schedule:true});writeTC2(f);f.kernel.previewEndClock();
    const before=f.kernel.inspect();
    const handle=f.kernel.compileSchedule([{values:{reset:1,a0:1,d0:1}}]);
    assert.throws(()=>f.kernel.runSchedule(handle),{code:'CLOCK_ORDER',periods:0,reads:0});
    assert.deepEqual(f.kernel.inspect(),before);assert.equal(f.kernel.inspectMemory(0).writes,0);
    f.kernel.finishEndClock();assert.equal(f.kernel.inspectMemory(0).writes,1);
    assert.equal(f.kernel.runSchedule(handle).periods,1);
});

test('native finish consumes one captured READY even if a future native sampler changes the net',native,async t=>{
    // Test-only export interception reaches the private ABI without adding a
    // mutable memory/driver escape hatch to the production wrapper.
    const instantiate=WebAssembly.instantiate;let e,context;
    const mock=t.mock.method(WebAssembly,'instantiate',async(...args)=>{
        const result=await instantiate(...args);e=result.instance.exports;
        return {...result,instance:{exports:{...e,preview_latched_memory_clock(p,fault){context=p;return e.preview_latched_memory_clock(p,fault);}}}};
    });
    const f=await createPhaseCircuitOracle({wasmBytes});mock.mock.restore();writeTC2(f);
    assert.equal(f.kernel.previewEndClock().ready,0);
    const view=new DataView(e.memory.buffer),word=p=>view.getUint32(p,true),c=word(context),drivers=word(c+4*4);
    view.setUint8(drivers+hostDrivers(f).get('ready_n'),1);
    assert.ok((e.settle_owned_context(c)>>>0)<0x80000000);
    const readyNet=word(word(context+4*4)+4),published=word(c+10*4);
    assert.equal(view.getUint8(published+readyNet),1);
    assert.equal(f.kernel.finishEndClock().ready,0);
    assert.equal(f.kernel.inspectPhase().state,'TI');assert.equal(f.kernel.inspectMemory(0).writes,1);
});

test('phase v1 artifacts are explicitly refused instead of using the shorter lifecycle allocation',native,async t=>{
    const instantiate=WebAssembly.instantiate;
    t.mock.method(WebAssembly,'instantiate',async(...args)=>{
        const result=await instantiate(...args);
        return {...result,instance:{exports:{...result.instance.exports,phase_circuit_version:()=>1}}};
    });
    await assert.rejects(createPhaseCircuitOracle({wasmBytes}),/rebuild native phase circuit.*v2 required/);
});
