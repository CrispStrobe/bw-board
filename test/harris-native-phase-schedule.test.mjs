import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bitDrives} from '../src/experimental/digital-circuit.js';
import {HARRIS_80C286_STATUS} from '../src/experimental/harris-80c286-contract.js';
import {createPhaseCircuitOracle} from '../scripts/lib/harris-native-phase-circuit-oracle.mjs';
import {runNativePhaseScheduleOracle} from '../scripts/lib/harris-native-phase-schedule-oracle.mjs';
const wasmBytes=process.env.HARRIS_NET_WASM?new Uint8Array(readFileSync(process.env.HARRIS_NET_WASM)):null;
const native={skip:wasmBytes?false:'build schedule prototype and set HARRIS_NET_WASM; native gate not exercised'};
test('portable native schedule oracle retains all periods and sampled reads',native,async()=>{
    const report=await runNativePhaseScheduleOracle({wasmBytes});assert.equal(report.periods,258);assert.equal(report.reads,64);
    assert.equal(report.accepted,true);assert.equal(report.capacityClaim,false);
});
const stepsFor=(f,count=16)=>{
    const steps=[{values:{...f.passive,reset:1}},{values:f.passive}];
    for(let i=0;i<count;i++)for(const kind of ['memory-write','memory-read']) {
        const value=(i*977+0x1234)&65535,active={...f.passive,...HARRIS_80C286_STATUS[kind],...bitDrives(f.A,i*2),bhe_n:0,
            ...(kind==='memory-write'?bitDrives(f.D,value):Object.fromEntries(f.D.map(p=>[p,'Z'])))};
        steps.push({values:active},{values:active},{values:f.passive,read:kind==='memory-read'?value:null},{values:f.passive,read:kind==='memory-read'?value:null});
    }
    return steps;
};
test('native schedule matches every-period oracle final nets, phase and memory without dropping periods',native,async()=>{
    const f=await createPhaseCircuitOracle({wasmBytes,schedule:true}),reference=await createPhaseCircuitOracle({wasmBytes}),steps=stepsFor(f,32);
    const handle=f.kernel.compileSchedule(steps);for(const step of steps)assert.equal(reference.period(step.values),undefined);
    const result=f.kernel.runSchedule(handle);assert.equal(result.periods,258);assert.equal(result.reads,64);
    assert.deepEqual(f.kernel.inspect(),reference.kernel.inspect());assert.deepEqual(f.kernel.inspectPhase(),reference.kernel.inspectPhase());
    for(let bank=0;bank<2;bank++)assert.deepEqual(f.kernel.inspectMemory(bank),reference.kernel.inspectMemory(bank));
});
test('schedule compilation is defensive, instance-owned and admits only its explicit input pins',native,async()=>{
    const f=await createPhaseCircuitOracle({wasmBytes,schedule:true}),other=await createPhaseCircuitOracle({wasmBytes,schedule:true});
    const before=f.kernel.inspect(),steps=stepsFor(f,1),handle=f.kernel.compileSchedule(steps);
    assert.throws(()=>other.kernel.runSchedule(handle),/this native instance/);
    assert.throws(()=>f.kernel.runSchedule({...handle}),/this native instance/);
    assert.throws(()=>f.kernel.compileSchedule([]),RangeError);
    assert.throws(()=>f.kernel.compileSchedule([{values:{ale:0}}]),/explicit input part/);
    assert.throws(()=>f.kernel.compileSchedule([{values:{reset:4}}]),{code:'INVALID_DRIVER_LEVEL'});
    assert.throws(()=>f.kernel.compileSchedule([{values:{},read:65536}]),RangeError);
    assert.deepEqual(f.kernel.inspect(),before);
    steps[0].values.reset='Z';steps[8].read=0; // Neither change may affect the compiled handle.
    const result=f.kernel.runSchedule(handle);assert.equal(result.periods,10);assert.equal(result.reads,2);
    assert.equal(f.kernel.inspectMemory(0).bytes[0],0x34);
});
test('a schedule read mismatch stops at its real boundary without rolling back earlier writes',native,async()=>{
    const f=await createPhaseCircuitOracle({wasmBytes,schedule:true}),steps=stepsFor(f,1);steps[8].read=0xffff;
    let error;try{f.kernel.runSchedule(f.kernel.compileSchedule(steps));}catch(e){error=e;}
    assert.equal(error.code,'CLOCK_SCHEDULE_READ_MISMATCH');assert.equal(error.step,8);assert.equal(error.periods,8);assert.equal(error.reads,0);
    assert.equal(f.kernel.inspectMemory(0).writes,1);assert.equal(f.kernel.inspectMemory(0).bytes[0],0x34);
    assert.equal(f.kernel.inspectPhase().periodOpen,true);assert.equal(f.kernel.inspectPhase().faulted,true);
    assert.throws(()=>f.kernel.beginClock(),{code:'BOARD_FAULTED'});
});
test('raw native schedule validates its last update before touching any pending drive',native,async()=>{
    const {instance}=await WebAssembly.instantiate(wasmBytes,{}),e=instance.exports,base=e.arena_ptr(),v=new DataView(e.memory.buffer);
    const p=base,c=base+64,offsets=base+192,ids=base+204,values=base+208,allowed=base+212,flags=base+216,nets=base+220,expected=base+284,
        stats=base+292,fault=base+300,drivers=base+316;
    v.setUint32(p,c,true);v.setUint32(c,1,true);v.setUint32(c+4,1,true);v.setUint32(c+16,drivers,true);
    [0,0,1].forEach((n,i)=>v.setUint32(offsets+4*i,n,true));v.setUint8(drivers,1);
    for(const kind of ['id','value','permission']) {
        v.setUint32(ids,kind==='id'?1:0,true);v.setUint8(values,kind==='value'?4:0);v.setUint8(allowed,kind==='permission'?0:1);
        assert.equal(e.run_latched_memory_schedule(p,2,1,offsets,ids,values,allowed,flags,nets,expected,stats,fault),7);
        assert.equal(v.getUint32(fault+4,true),6);assert.equal(v.getUint8(drivers),1);assert.equal(v.getUint32(stats,true),0);
    }
});
