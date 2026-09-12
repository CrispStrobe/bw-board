import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createMemoryCircuitOracle,runNativeMemoryCircuitOracle} from '../scripts/lib/harris-native-memory-circuit-oracle.mjs';
import {runNativePhaseCircuitOracle} from '../scripts/lib/harris-native-phase-circuit-oracle.mjs';
import {runNativePhaseScheduleOracle} from '../scripts/lib/harris-native-phase-schedule-oracle.mjs';
import {assertIncrementalKernelABI} from '../src/experimental/wired-kernel/memory-circuit.js';
const wasmBytes=process.env.HARRIS_NET_WASM?new Uint8Array(readFileSync(process.env.HARRIS_NET_WASM)):null;
const native={skip:wasmBytes?false:'build incremental prototype and set HARRIS_NET_WASM; native gate not exercised'};
const WORK_COUNTERS=['driverComparisons','valueChangingDriverWrites','dirtyNetResolutions','netDriverVisits','evaluatorRows','dependencyProbes',
    'stagedDriverCopies','committedEvaluatorOutputs','publishNetCopies','deltas'];
async function rawKernel({incremental=false,oscillator=false,previousImage=null}={}) {
    const {instance}=await WebAssembly.instantiate(wasmBytes,{}),e=instance.exports,base=e.arena_ptr(),v=new DataView(e.memory.buffer);
    const p={context:base,offsets:base+128,ids:base+144,drivers:base+160,live:base+164,conflicts:base+168,ops:base+172,
        staged:base+300,published:base+304,publishedConflicts:base+308,dependencyOffsets:base+312,dependencies:base+320,previous:base+332,changed:base+336};
    const put=(at,values)=>values.forEach((n,i)=>v.setUint32(at+4*i,n,true));
    const drivers=oscillator?3:4;
    put(p.context,[3,drivers,p.offsets,p.ids,p.drivers,p.live,p.conflicts,1,p.ops,p.staged,p.published,p.publishedConflicts,oscillator?2:8,
        p.dependencyOffsets,p.dependencies,3,p.previous,p.changed,...new Array(13).fill(0),incremental?2:0]);
    put(p.offsets,[0,1,2,drivers]);put(p.ids,oscillator?[0,1,2]:[0,1,2,3]);put(p.dependencyOffsets,[0,3]);put(p.dependencies,[0,1,2]);
    put(p.ops,oscillator?[1,0,0,65536,0,0,1,0,...new Array(24).fill(2)]:[2,0,1,2]);
    const initial=oscillator?[2,0,0]:[3,3,2,3],published=oscillator?[2,0,0]:[3,3,2];
    new Uint8Array(e.memory.buffer,p.drivers,drivers).set(initial);new Uint8Array(e.memory.buffer,p.previous,3).set(previousImage??published);
    new Uint8Array(e.memory.buffer,p.published,3).set(published);
    if(incremental)assert.equal(e.admit_owned_context(p.context),0);
    const inspect=()=>Object.fromEntries(['drivers','live','conflicts','published','publishedConflicts','previous','changed'].map(name=>
        [name,Array.from(new Uint8Array(e.memory.buffer,p[name],name==='drivers'?drivers:3))]));
    const counters=()=>Object.fromEntries(WORK_COUNTERS.map((name,i)=>[name,new Uint32Array(e.memory.buffer,e.incremental_work_counters_ptr(),10)[i]]));
    return {e,p,v,inspect,counters,resetCounters:()=>e.reset_incremental_work_counters(),
        step:levels=>{if(incremental)levels.forEach((code,id)=>assert.equal(e.write_owned_driver(p.context,id,code),0));
            else new Uint8Array(e.memory.buffer,p.drivers,drivers).set(levels);return e.settle_owned_context(p.context)>>>0;}};
}
async function outputKernel({incremental=false}={}) {
    const {instance}=await WebAssembly.instantiate(wasmBytes,{}),e=instance.exports,base=e.arena_ptr(),v=new DataView(e.memory.buffer);
    const p={context:base,offsets:base+256,ids:base+320,drivers:base+384,live:base+416,conflicts:base+448,
        ops:base+512,staged:base+1280,published:base+1312,publishedConflicts:base+1344,
        dependencyOffsets:base+1376,dependencies:base+1408,previous:base+1536,changed:base+1568};
    const put=(at,values)=>values.forEach((n,i)=>v.setUint32(at+4*i,n,true)),nets=10,drivers=10,count=5;
    put(p.context,[nets,drivers,p.offsets,p.ids,p.drivers,p.live,p.conflicts,count,p.ops,p.staged,p.published,p.publishedConflicts,8,
        p.dependencyOffsets,p.dependencies,19,p.previous,p.changed,...new Array(13).fill(0),incremental?2:0]);
    put(p.offsets,Array.from({length:nets+1},(_,i)=>i));put(p.ids,Array.from({length:drivers},(_,i)=>i));
    const or=(a,b,out)=>[2,a,b,out,...new Array(28).fill(0)];
    const mux=[3,4,0,0,1,2,3,0,0,0,0,5,6,7,9,...new Array(17).fill(0)];
    [or(0,1,8),or(2,3,8),mux,mux,mux].forEach((row,i)=>put(p.ops+i*128,row));
    put(p.dependencyOffsets,[0,2,4,9,14,19]);put(p.dependencies,[0,1,2,3,...[0,1,2,3,4],...[0,1,2,3,4],...[0,1,2,3,4]]);
    const initial=[0,0,1,0,0,3,3,3,3,3];
    new Uint8Array(e.memory.buffer,p.drivers,drivers).set(initial);
    new Uint8Array(e.memory.buffer,p.previous,nets).set(initial);new Uint8Array(e.memory.buffer,p.published,nets).set(initial);
    if(incremental)assert.equal(e.admit_owned_context(p.context),0);
    const inspect=()=>({drivers:Array.from(new Uint8Array(e.memory.buffer,p.drivers,drivers)),
        published:Array.from(new Uint8Array(e.memory.buffer,p.published,nets))});
    const counters=()=>Object.fromEntries(WORK_COUNTERS.map((name,i)=>[name,new Uint32Array(e.memory.buffer,e.incremental_work_counters_ptr(),10)[i]]));
    const step=updates=>{for(const [id,code] of Object.entries(updates)){
        if(incremental)assert.equal(e.write_owned_driver(p.context,Number(id),code),0);
        else new Uint8Array(e.memory.buffer,p.drivers,drivers)[id]=code;
    }return e.settle_owned_context(p.context)>>>0;};
    return {e,inspect,counters,step,resetCounters:()=>e.reset_incremental_work_counters()};
}
test('work counters observe existing full and incremental loops and reset without changing state',native,async()=>{
    const checked=await rawKernel(),incremental=await rawKernel({incremental:true});
    assert.equal(incremental.e.incremental_kernel_version(),2);
    assert.equal(typeof incremental.e.write_owned_driver,'function');
    assert.equal(incremental.e.incremental_work_counters_version(),1);
    incremental.resetCounters();
    assert.equal(incremental.step([3,3,2,3]),1);
    assert.deepEqual(incremental.counters(),{
        driverComparisons:4,valueChangingDriverWrites:0,dirtyNetResolutions:3,netDriverVisits:4,evaluatorRows:0,dependencyProbes:0,
        stagedDriverCopies:0,committedEvaluatorOutputs:0,publishNetCopies:0,deltas:1
    });
    const state=incremental.inspect();incremental.resetCounters();
    assert.deepEqual(incremental.counters(),Object.fromEntries(WORK_COUNTERS.map(name=>[name,0])));
    assert.deepEqual(incremental.inspect(),state,'counter reset is observational only');
    assert.equal(incremental.step([3,3,2,3]),1);
    assert.deepEqual(incremental.counters(),{
        driverComparisons:4,valueChangingDriverWrites:0,dirtyNetResolutions:0,netDriverVisits:0,evaluatorRows:0,dependencyProbes:0,
        stagedDriverCopies:0,committedEvaluatorOutputs:0,publishNetCopies:0,deltas:1
    });
    checked.resetCounters();assert.equal(checked.step([3,3,2,3]),1);
    assert.deepEqual(checked.counters(),{
        driverComparisons:4,valueChangingDriverWrites:0,dirtyNetResolutions:3,netDriverVisits:4,evaluatorRows:1,dependencyProbes:3,
        stagedDriverCopies:4,committedEvaluatorOutputs:0,publishNetCopies:3,deltas:1
    });
});
test('incremental ABI gate rejects legacy versions and missing writer exports',()=>{
    const writer=()=>0;
    assert.doesNotThrow(()=>assertIncrementalKernelABI({},false));
    assert.throws(()=>assertIncrementalKernelABI({incremental_kernel_version:()=>1,write_owned_driver:writer},true),/ABI version\/writer mismatch/);
    assert.throws(()=>assertIncrementalKernelABI({incremental_kernel_version:()=>2},true),/ABI version\/writer mismatch/);
    assert.doesNotThrow(()=>assertIncrementalKernelABI({incremental_kernel_version:()=>2,write_owned_driver:writer},true));
});
test('incremental wrapper requires ABI 2 with its writer export and counts one host transition once',native,async()=>{
    const f=await createMemoryCircuitOracle({wasmBytes,admittedGraph:true,incrementalGraph:true});f.pass();f.kernel.resetWorkCounters();
    f.pass({a23:1});const work=f.kernel.inspectWorkCounters();
    assert.equal(work.committedEvaluatorOutputs,2,'a23 changes both decoder outputs in this fixture');
    assert.equal(work.valueChangingDriverWrites-work.committedEvaluatorOutputs,1,'the single host transition is not double counted');
    const missingWriter=wasmBytes.slice(),needle=new TextEncoder().encode('write_owned_driver');let occurrences=0;
    outer:for(let i=0;i<=missingWriter.length-needle.length;i++){
        for(let j=0;j<needle.length;j++)if(missingWriter[i+j]!==needle[j])continue outer;
        missingWriter[i]='x'.charCodeAt(0);occurrences++;
    }
    assert.ok(occurrences>=1,'writer export is present');
    await assert.rejects(createMemoryCircuitOracle({wasmBytes:missingWriter,admittedGraph:true,incrementalGraph:true}),/ABI version\/writer mismatch/);
});
test('driver seam validates before mutation, preserves duplicate order and queues one dirty net',native,async()=>{
    const k=await rawKernel({incremental:true});k.resetCounters();const before=k.inspect();
    assert.equal(k.e.write_owned_driver(k.p.context,4,0),1);assert.equal(k.e.write_owned_driver(k.p.context,0,4),2);
    assert.deepEqual(k.inspect(),before);assert.deepEqual(k.counters(),Object.fromEntries(WORK_COUNTERS.map(name=>[name,0])));
    assert.equal(k.e.write_owned_driver(k.p.context,0,1),0);
    assert.equal(k.e.write_owned_driver(k.p.context,0,0),0);
    assert.equal(k.e.write_owned_driver(k.p.context,0,1),0);
    assert.equal(k.e.settle_owned_context(k.p.context),1);
    assert.equal(k.inspect().drivers[0],1,'the final duplicate write wins');
    assert.equal(k.counters().valueChangingDriverWrites,3,'each real ordered transition is retained');
    assert.equal(k.counters().dirtyNetResolutions,3,'admission nets resolve once; the rewritten driver is not enqueued twice');
});
test('incremental memory oracle compares evaluator and memory-output driver state',native,async()=>{
    const options={wasmBytes,admittedGraph:true,incrementalGraph:true};
    assert.equal((await runNativeMemoryCircuitOracle({...options,swapAddress:true})).comparisons,1026);
});
test('incremental phase oracle compares controller and latch driver state',native,async()=>{
    const options={wasmBytes,admittedGraph:true,incrementalGraph:true};
    assert.equal((await runNativePhaseCircuitOracle(options)).comparisons,1532);
});
test('incremental schedule oracle compares every native host-driver update',native,async()=>{
    const options={wasmBytes,admittedGraph:true,incrementalGraph:true};
    assert.equal((await runNativePhaseScheduleOracle(options)).periods,258);
});
test('incremental resolver matches checked deltas through X/Z, masked changes and conflict-only transitions',native,async()=>{
    const checked=await rawKernel(),incremental=await rawKernel({incremental:true});
    const step=levels=>{assert.equal(incremental.step(levels),checked.step(levels));assert.deepEqual(incremental.inspect(),checked.inspect());};
    step([1,0,3,3]);step([1,0,1,0]);assert.equal(incremental.inspect().publishedConflicts[2],1);
    incremental.resetCounters();step([1,0,2,3]);
    assert.equal(incremental.inspect().publishedConflicts[2],0);assert.equal(incremental.inspect().drivers[2],2);
    assert.equal(incremental.counters().evaluatorRows,0,'conflict-only publication does not schedule a value consumer');
    assert.equal(incremental.counters().publishNetCopies,1,'conflict-only publication commits its diagnostic');
    let seed=0x12345678;
    for(let i=0;i<1024;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;step([seed&3,(seed>>>4)&3,(seed>>>8)&3,(seed>>>12)&3]);}
});
test('incremental nonconvergence preserves published state and recovers using pending/live history',native,async()=>{
    const checked=await rawKernel({oscillator:true}),incremental=await rawKernel({incremental:true,oscillator:true});
    assert.equal(incremental.step([0,0,0]),0x80000003);assert.equal(checked.step([0,0,0]),0x80000003);
    assert.deepEqual(incremental.inspect(),checked.inspect());assert.deepEqual(incremental.inspect().published,[2,0,0]);
    assert.equal(incremental.step([2,0,0]),checked.step([2,0,0]));assert.deepEqual(incremental.inspect(),checked.inspect());
    assert.equal(incremental.counters().publishNetCopies,0,'a queued net that returns to its published state is not copied');
    const retained=await rawKernel({incremental:true,oscillator:true});retained.resetCounters();
    assert.equal(retained.step([0,1,0]),0x80000003);assert.deepEqual(retained.inspect().published,[2,0,0]);
    retained.resetCounters();assert.equal(retained.step([2,1,0]),1);
    assert.deepEqual(retained.inspect().published,[2,1,0],'successful recovery commits a stable candidate retained across failure');
    assert.equal(retained.counters().publishNetCopies,1,'only the retained final difference is copied');
    const readmitted=await rawKernel({incremental:true,oscillator:true});
    assert.equal(readmitted.step([0,1,0]),0x80000003);
    readmitted.v.setUint32(readmitted.p.context,1,true);readmitted.v.setUint32(readmitted.p.context+4,1,true);
    readmitted.v.setUint32(readmitted.p.context+7*4,0,true);readmitted.v.setUint32(readmitted.p.context+15*4,0,true);
    new Uint8Array(readmitted.e.memory.buffer,readmitted.p.published,3)[1]=77;
    assert.equal(readmitted.e.admit_owned_context(readmitted.p.context),0);
    assert.notEqual(readmitted.e.settle_owned_context(readmitted.p.context)>>>0,0x80000003);
    assert.equal(new Uint8Array(readmitted.e.memory.buffer,readmitted.p.published,3)[1],77,
        're-admission of a smaller graph discards publication candidates from the old graph');
});
test('publication candidate queue stays bounded across repeated failed fixpoints',native,async()=>{
    const k=await rawKernel({incremental:true,oscillator:true});
    for(let i=0;i<9000;i++)assert.equal(k.step([0,1,0]),0x80000003);
    assert.deepEqual(k.inspect().published,[2,0,0],'no failed fixpoint becomes observable');
    assert.equal(k.step([2,1,0]),1);assert.deepEqual(k.inspect().published,[2,1,0]);
});
test('sparse evaluator outputs preserve multi-output and duplicate row order within their bound',native,async()=>{
    const checked=await outputKernel(),incremental=await outputKernel({incremental:true});
    const step=updates=>{assert.equal(incremental.step(updates),checked.step(updates));assert.deepEqual(incremental.inspect(),checked.inspect());};
    incremental.resetCounters();step({0:1,1:0,2:0,3:0,4:0});
    assert.deepEqual(incremental.inspect().drivers.slice(5),[1,0,0,0,0],
        'four-output rows keep all outputs while the later duplicate OR row wins driver 8');
    assert.equal(incremental.counters().stagedDriverCopies,0,'sparse rows overwrite their outputs without a driver-image prefill');
    assert.equal(incremental.counters().driverComparisons,10,'five host inputs and five unique evaluator outputs compare once');
    assert.equal(incremental.counters().committedEvaluatorOutputs,5);
    incremental.resetCounters();step({0:0,1:0,2:1,3:0,4:0});
    assert.deepEqual(incremental.inspect().drivers.slice(5),[0,0,1,1,0]);
    assert.equal(incremental.counters().stagedDriverCopies,0);assert.equal(incremental.counters().driverComparisons,10);
    incremental.resetCounters();step({});assert.equal(incremental.counters().stagedDriverCopies,0);
    assert.equal(incremental.counters().driverComparisons,0,'an idle settle compares no evaluator outputs');
});
test('incremental dirty queues initialize unchanged drivers and clear prior changed flags on idle settling',native,async()=>{
    const checked=await rawKernel({previousImage:[0,0,0]}),incremental=await rawKernel({incremental:true,previousImage:[0,0,0]});
    const step=levels=>{assert.equal(incremental.step(levels),checked.step(levels));assert.deepEqual(incremental.inspect(),checked.inspect());};
    step([3,3,2,3]);assert.deepEqual(incremental.inspect().changed,[1,1,1]);
    step([3,3,2,3]);assert.deepEqual(incremental.inspect().changed,[0,0,0]);
    // Multiple changed drivers on one net enqueue it once. Re-admission resets
    // queue state; neither duplicated entries nor old changed flags survive.
    step([1,0,0,1]);step([1,0,2,0]);
    assert.equal(incremental.e.admit_owned_context(incremental.p.context),0);
    step([1,0,2,0]);step([3,3,2,3]);
});
test('incremental admission requires unique membership, bounded caches and the admitted mode',native,async()=>{
    const k=await rawKernel({incremental:true});k.v.setUint32(k.p.context+31*4,1,true);
    assert.equal(k.e.settle_owned_context(k.p.context)>>>0,0x80000006);
    k.v.setUint32(k.p.context+31*4,2,true);k.v.setUint32(k.p.ids+12,0,true);
    assert.equal(k.e.admit_owned_context(k.p.context)>>>0,0x80000006);
    assert.equal(k.e.settle_owned_context(k.p.context)>>>0,0x80000006);
    const {instance}=await WebAssembly.instantiate(wasmBytes,{}),e=instance.exports,base=e.arena_ptr(),v=new DataView(e.memory.buffer);
    const offsets=base+128,dependencyOffsets=offsets+16386*4;
    [16385,0,offsets,0,0,0,0,0,0,0,0,0,8,dependencyOffsets,0,0,0,0,...new Array(13).fill(0),2]
        .forEach((n,i)=>v.setUint32(base+4*i,n,true));
    assert.equal(e.admit_owned_context(base)>>>0,0x80000007);
    assert.equal(e.settle_owned_context(base)>>>0,0x80000006);
});
