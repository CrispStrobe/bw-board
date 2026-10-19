import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bitDrives} from '../src/experimental/digital-circuit.js';
import {createMemoryCircuitOracle,runNativeMemoryCircuitOracle} from '../scripts/lib/harris-native-memory-circuit-oracle.mjs';
import {createPhaseCircuitOracle,runNativePhaseCircuitOracle} from '../scripts/lib/harris-native-phase-circuit-oracle.mjs';
import {runNativePhaseScheduleOracle} from '../scripts/lib/harris-native-phase-schedule-oracle.mjs';
const wasmBytes=process.env.HARRIS_NET_WASM?new Uint8Array(readFileSync(process.env.HARRIS_NET_WASM)):null;
const native={skip:wasmBytes?false:'build admitted graph prototype and set HARRIS_NET_WASM; native gate not exercised'};
test('admitted native graph retains full memory and phase/schedule oracle agreement',native,async()=>{
    const memory=await runNativeMemoryCircuitOracle({wasmBytes,admittedGraph:true,swapAddress:true});assert.equal(memory.comparisons,1026);
    const phase=await runNativePhaseCircuitOracle({wasmBytes,admittedGraph:true});assert.equal(phase.comparisons,1532);
    const schedule=await runNativePhaseScheduleOracle({wasmBytes,admittedGraph:true});assert.equal(schedule.periods,258);assert.equal(schedule.reads,64);
});
test('admitted graph preserves fault/nonconvergence behavior and still rejects invalid host codes',native,async()=>{
    const f=await createMemoryCircuitOracle({wasmBytes,admittedGraph:true,shortLanes:true});
    assert.equal(f.pass({},1)?.code,'MEMORY_NON_CONVERGENT');f.pass();
    assert.equal(f.pass({...bitDrives(f.D,0x0100),web:0})?.code,'CONTENTION');
    f.pass({...bitDrives(f.D,0x5555)});f.pass({web:1});assert.equal(f.kernel.inspectMemory(0).writes,1);
    const phase=await createPhaseCircuitOracle({wasmBytes,admittedGraph:true});phase.period(phase.passive);
    assert.equal(phase.kernel.capabilities.admittedGraph,true);
    const before=phase.kernel.inspect(),bad=before.driverLevels.slice();bad[0]=255;
    assert.throws(()=>phase.kernel.beginClock(bad),{code:'INVALID_DRIVER_LEVEL'});assert.deepEqual(phase.kernel.inspect(),before);
    assert.equal(phase.call('beginClock',{reset:'Z'})?.code,'FLOATING');assert.equal(phase.kernel.inspectPhase().faulted,true);
});
test('raw native fast entry requires exact private-context admission and failed re-admission revokes it',native,async()=>{
    const {instance}=await WebAssembly.instantiate(wasmBytes,{}),e=instance.exports,base=e.arena_ptr(),v=new DataView(e.memory.buffer);
    const p={context:base,offsets:base+128,ids:base+140,drivers:base+148,live:base+152,conflicts:base+156,ops:base+160,
        staged:base+288,published:base+292,publishedConflicts:base+296,dependencyOffsets:base+300,dependencies:base+308,previous:base+316,changed:base+320,other:base+324};
    const put=(at,values)=>values.forEach((n,i)=>v.setUint32(at+4*i,n,true));
    put(p.context,[2,2,p.offsets,p.ids,p.drivers,p.live,p.conflicts,1,p.ops,p.staged,p.published,p.publishedConflicts,8,
        p.dependencyOffsets,p.dependencies,2,p.previous,p.changed,...new Array(13).fill(0),1]);
    put(p.offsets,[0,1,2]);put(p.ids,[0,1]);put(p.ops,[2,0,1,1]);put(p.dependencyOffsets,[0,2]);put(p.dependencies,[0,1]);
    v.setUint8(p.drivers,1);new Uint8Array(e.memory.buffer,p.published,2).fill(99);
    assert.equal(e.settle_owned_context(p.context)>>>0,0x80000006);assert.deepEqual([...new Uint8Array(e.memory.buffer,p.published,2)],[99,99]);
    assert.equal(e.admit_owned_context(p.context),0);assert.equal(e.settle_owned_context(p.context),2);
    assert.deepEqual([...new Uint8Array(e.memory.buffer,p.published,2)],[1,1]);
    new Uint8Array(e.memory.buffer,p.other,128).set(new Uint8Array(e.memory.buffer,p.context,128));
    assert.equal(e.settle_owned_context(p.other)>>>0,0x80000006);
    v.setUint32(p.ops,99,true);assert.equal(e.admit_owned_context(p.other)>>>0,0x80000004);
    assert.equal(e.settle_owned_context(p.context)>>>0,0x80000006);assert.deepEqual([...new Uint8Array(e.memory.buffer,p.published,2)],[1,1]);
});
