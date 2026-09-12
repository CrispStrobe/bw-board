import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertOwnedMemoryAdmissionABI} from '../src/experimental/wired-kernel/memory-circuit.js';
import {createMemoryCircuitOracle} from '../scripts/lib/harris-native-memory-circuit-oracle.mjs';

const wasmBytes=process.env.HARRIS_NET_WASM?new Uint8Array(readFileSync(process.env.HARRIS_NET_WASM)):null;
const native={skip:wasmBytes?false:'build native kernel and set HARRIS_NET_WASM; memory admission gate not exercised'};
const COUNTERS=['attempts','admissions','failures','inputMapVisits','outputMapVisits','outputAliasComparisons','protectionVisits','runtimeMapVisits'];

test('memory-map admission ABI refuses old modules and missing exports',()=>{
    const good={memory_admission_version:()=>1,memory_admission_counters_version:()=>1,admit_owned_memory_context(){},
        memory_admission_counters_ptr(){},reset_memory_admission_counters(){}};
    assert.doesNotThrow(()=>assertOwnedMemoryAdmissionABI(good));
    for(const name of Object.keys(good))assert.throws(()=>assertOwnedMemoryAdmissionABI({...good,[name]:undefined}),/memory-map admission/,name);
    assert.throws(()=>assertOwnedMemoryAdmissionABI({...good,memory_admission_version:()=>2}),/memory-map admission/);
});

test('admission proves immutable two-bank maps once and runtime leaves its counters unchanged',native,async()=>{
    for(const incrementalGraph of [false,true]){
        const f=await createMemoryCircuitOracle({wasmBytes,admittedGraph:true,incrementalGraph});
        const expected={attempts:1,admissions:1,failures:0,inputMapVisits:56,outputMapVisits:16,
            outputAliasComparisons:120,protectionVisits:2,runtimeMapVisits:0};
        assert.deepEqual(f.kernel.inspectMemoryAdmission(),expected);
        f.pass();f.pass({oeb:0});f.pass({oeb:1});
        assert.deepEqual(f.kernel.inspectMemoryAdmission(),expected,'runtime performs no immutable-map admission work');
    }
});

async function rawMemory(){
    const {instance}=await WebAssembly.instantiate(wasmBytes,{}),e=instance.exports,base=e.arena_ptr(),v=new DataView(e.memory.buffer);
    const p={context:base,offsets:base+256,ids:base+272,drivers:base+320,live:base+352,conflicts:base+368,ops:base+384,
        staged:base+416,published:base+448,publishedConflicts:base+464,dependencyOffsets:base+480,dependencies:base+496,
        previous:base+512,changed:base+528,memory:base+544,states:base+33312,memoryStaged:base+33360,protected:base+33408,
        inputs:base+33424,inputConflicts:base+33456,drives:base+33488,present:base+33504,memoryChanged:base+33520,
        memoryFault:base+33536,inputNets:base+33552,outputIds:base+33664,fault:base+33712};
    const put=(at,values)=>values.forEach((n,i)=>v.setUint32(at+4*i,n,true));
    put(p.context,[1,8,p.offsets,p.ids,p.drivers,p.live,p.conflicts,0,p.ops,p.staged,p.published,p.publishedConflicts,8,
        p.dependencyOffsets,p.dependencies,0,p.previous,p.changed,1,p.memory,p.states,p.memoryStaged,p.protected,p.inputs,
        p.inputConflicts,p.drives,p.present,p.memoryChanged,p.memoryFault,p.inputNets,p.outputIds,1,0,0,0]);
    put(p.offsets,[0,8]);put(p.ids,[0,1,2,3,4,5,6,7]);put(p.dependencyOffsets,[0]);
    new Uint8Array(e.memory.buffer,p.drivers,8).fill(3);new Uint32Array(e.memory.buffer,p.inputNets,28).fill(0);
    put(p.outputIds,[0,1,2,3,4,5,6,7]);new Uint8Array(e.memory.buffer,p.protected,1)[0]=0;
    const counters=()=>Object.fromEntries(COUNTERS.map((name,i)=>[name,new Uint32Array(e.memory.buffer,e.memory_admission_counters_ptr(),8)[i]]));
    const fault=()=>Array.from(new Uint32Array(e.memory.buffer,p.fault,4));
    return {e,p,v,counters,fault};
}

test('combined admission rejects each immutable memory-map defect and revokes graph trust',native,async()=>{
    const cases=[
        ['input net',2,k=>k.v.setUint32(k.p.inputNets+27*4,1,true)],
        ['output driver',3,k=>k.v.setUint32(k.p.outputIds+7*4,8,true)],
        ['duplicate output',4,k=>k.v.setUint32(k.p.outputIds+7*4,0,true)],
        ['protection flag',5,k=>new Uint8Array(k.e.memory.buffer,k.p.protected,1).fill(2)]
    ];
    for(const [name,code,mutate] of cases){
        const k=await rawMemory();mutate(k);assert.equal(k.e.admit_owned_memory_context(k.p.context,k.p.fault),4,name);
        assert.equal(k.fault()[1],code,name);assert.equal(k.e.settle_owned_context(k.p.context)>>>0,0x80000006,`${name} revokes graph`);
        assert.equal(k.counters().attempts,1);assert.equal(k.counters().failures,1);assert.equal(k.counters().admissions,0);
    }
});

test('graph-only admission never grants memory trust and revokes an existing memory grant',native,async()=>{
    const k=await rawMemory();assert.equal(k.e.admit_owned_memory_context(k.p.context,k.p.fault),0);
    assert.deepEqual(k.counters(),{attempts:1,admissions:1,failures:0,inputMapVisits:28,outputMapVisits:8,
        outputAliasComparisons:28,protectionVisits:1,runtimeMapVisits:0});
    assert.equal(k.e.admit_owned_context(k.p.context),0,'legacy graph-only admission remains independently valid');
    assert.equal(k.e.settle_memory_circuit(k.p.context,8,k.p.fault),4,'old wrapper cannot execute with graph trust alone');
    assert.equal(k.fault()[1],10,'the stale memory-map grant is refused before memory work');
});

test('failed combined re-admission revokes the prior same-context grant',native,async()=>{
    const k=await rawMemory();assert.equal(k.e.admit_owned_memory_context(k.p.context,k.p.fault),0);
    k.v.setUint32(k.p.outputIds+7*4,8,true);
    assert.equal(k.e.admit_owned_memory_context(k.p.context,k.p.fault),4);
    assert.equal(k.e.settle_memory_circuit(k.p.context,8,k.p.fault),4);
    assert.equal(k.fault()[1],10);assert.deepEqual(k.counters(),{attempts:2,admissions:1,failures:1,inputMapVisits:56,
        outputMapVisits:16,outputAliasComparisons:49,protectionVisits:1,runtimeMapVisits:0});
});

test('raw checked memory retains per-call mapping validation while admitted runtime performs none',native,async()=>{
    const k=await rawMemory();k.v.setUint32(k.p.context+31*4,0,true);
    assert.equal(k.e.settle_memory_circuit(k.p.context,8,k.p.fault),2,'valid raw map reaches the electrical memory check');
    assert.equal(k.counters().runtimeMapVisits,64,'one-bank raw validation counts 28 inputs, 8 outputs and 28 alias comparisons');
});
