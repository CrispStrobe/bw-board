import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {bitDrives} from '../src/experimental/digital-circuit.js';
import {CompiledDigitalCircuit} from '../src/experimental/compiled-digital-circuit.js';
import {assertOwnedMemoryPreviewABI,createNativeMemoryCircuit} from '../src/experimental/wired-kernel/memory-circuit.js';
import {createMemoryCircuitOracle,runNativeMemoryCircuitOracle} from '../scripts/lib/harris-native-memory-circuit-oracle.mjs';
const wasmBytes=process.env.HARRIS_NET_WASM?new Uint8Array(readFileSync(process.env.HARRIS_NET_WASM)):null;
const native={skip:wasmBytes?false:'build memory circuit prototype and set HARRIS_NET_WASM; native gate not exercised'};
test('owned circuit memory preview has a separate fail-closed ABI',native,async()=>{
    const {instance}=await WebAssembly.instantiate(wasmBytes,{}),e=instance.exports;
    assert.equal(e.memory_circuit_version(),3);
    assert.equal(e.preview_owned_memory_banks,undefined,'owned fast path stays internal to the circuit');
});
test('owned memory preview ABI rejects stale versions and missing exports',()=>{
    const good={memory_circuit_version:()=>3};
    assert.doesNotThrow(()=>assertOwnedMemoryPreviewABI(good));
    for(const name of Object.keys(good))assert.throws(()=>assertOwnedMemoryPreviewABI({...good,[name]:undefined}),/version mismatch/,name);
    assert.throws(()=>assertOwnedMemoryPreviewABI({...good,memory_circuit_version:()=>2}),/version mismatch/);
});
test('native memory circuit gate is explicit',async()=>{
    await assert.rejects(createNativeMemoryCircuit(),{code:'EXPERIMENT_DISABLED'});
});
for(const swapAddress of [false,true])test(`native coupled memory loop preserves all bytes and actual edited wiring (swap=${swapAddress})`,native,async()=>{
    const report=await runNativeMemoryCircuitOracle({wasmBytes,swapAddress});
    assert.equal(report.accepted,true);assert.equal(report.comparisons,1026);assert.equal(report.faults,1);assert.equal(report.capacityClaim,false);
});
test('native memory circuit agrees with compiled reference, including read-only EEPROM and lane selects',native,async()=>{
    const f=await createMemoryCircuitOracle({wasmBytes,Circuit:CompiledDigitalCircuit,readOnly:true});f.pass();
    f.pass({...bitDrives(f.A,0x100),...bitDrives(f.D,0x1234),web:0});f.pass({web:1});
    assert.equal(f.kernel.inspectMemory(0).bytes[0x80],0x34);assert.equal(f.kernel.inspectMemory(1).bytes[0x80],255);
    f.pass({...bitDrives(f.A,0x101),...bitDrives(f.D,0xabcd),web:0});f.pass({web:1});
    assert.equal(f.kernel.inspectMemory(0).writes,1);assert.equal(f.kernel.inspectMemory(1).writes,0);
    f.pass({...bitDrives(f.A,0x102),...bitDrives(f.D,0x7654),web:0,bhe_n:1});f.pass({web:1});
    assert.equal(f.kernel.inspectMemory(0).writes,2);
});
test('shorted byte lanes fault before either bank commits and can recover',native,async()=>{
    const f=await createMemoryCircuitOracle({wasmBytes,shortLanes:true});f.pass();
    assert.equal(f.pass({...bitDrives(f.D,0x0100),web:0})?.code,'CONTENTION');
    assert.equal(f.kernel.inspectMemory(0).writes,0);assert.equal(f.kernel.inspectMemory(1).writes,0);
    f.pass({...bitDrives(f.D,0x5555)});f.pass({web:1});assert.equal(f.kernel.inspectMemory(0).writes,1);
});
test('memory fixed-point limit preserves per-pass progress and permits retry',native,async()=>{
    const f=await createMemoryCircuitOracle({wasmBytes});
    assert.equal(f.pass({},1)?.code,'MEMORY_NON_CONVERGENT');f.pass();
    f.pass({...bitDrives(f.D,0xabcd),web:0});f.pass({web:1});
    assert.equal(f.pass({...Object.fromEntries(f.D.map(p=>[p,'Z'])),oeb:0},1)?.code,'MEMORY_NON_CONVERGENT');f.pass();
    assert.equal(f.kernel.inspectMemory(0).out,0xcd);
});
test('native memory circuit refuses model/state imports and invalid inputs without state mutation',native,async()=>{
    const f=await createMemoryCircuitOracle({wasmBytes});f.pass();
    for(const extra of [{model:{}},{state:{}}])await assert.rejects(createNativeMemoryCircuit({enabled:true,circuit:f.circuit,
        banks:[{id:'low',kind:'62256',...extra}],wasmBytes}),/import unsupported/);
    const before=f.kernel.inspect(),memory=f.kernel.inspectMemory(0),bad=before.driverLevels.slice();bad[0]=7;
    assert.throws(()=>f.kernel.settleMemories(bad),{code:'INVALID_DRIVER_LEVEL'});
    assert.throws(()=>f.kernel.settleMemories(undefined,0),RangeError);
    assert.deepEqual(f.kernel.inspect(),before);assert.deepEqual(f.kernel.inspectMemory(0),memory);
    memory.bytes.fill(99);before.levels.fill(99);assert.notDeepEqual(f.kernel.inspect(),before);
    assert.notDeepEqual(f.kernel.inspectMemory(0),memory);
});
test('raw native memory mapping validation precedes any net/state mutation',native,async()=>{
    const {instance}=await WebAssembly.instantiate(wasmBytes,{}),e=instance.exports,base=e.arena_ptr(),v=new DataView(e.memory.buffer);
    const context=base,input=base+128,output=base+240,fault=base+272,sentinel=base+288;
    const set=(i,n)=>v.setUint32(context+4*i,n,true);
    // Mapping failure must happen before even dereferencing deliberately absent net tables.
    set(0,1);set(1,8);set(18,1);set(29,input);set(30,output);set(19,sentinel);set(20,sentinel);
    new Uint8Array(e.memory.buffer,sentinel,64).fill(0x5a);
    for(const kind of ['input','output','duplicate']) {
        new Uint8Array(e.memory.buffer,input,112).fill(0);
        for(let i=0;i<8;i++)v.setUint32(output+4*i,i,true);
        if(kind==='input')v.setUint32(input+108,1,true);
        if(kind==='output')v.setUint32(output+28,8,true);
        if(kind==='duplicate')v.setUint32(output+28,0,true);
        assert.equal(e.settle_memory_circuit(context,8,fault),4);
        assert.equal(v.getUint32(fault+4,true),kind==='input'?2:kind==='output'?3:4);
        assert.ok(new Uint8Array(e.memory.buffer,sentinel,64).every(n=>n===0x5a));
    }
});
