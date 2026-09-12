import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DigitalCircuit,bitPins,bitDrives} from '../src/experimental/digital-circuit.js';
import {CompiledDigitalCircuit} from '../src/experimental/compiled-digital-circuit.js';
import {createHarrisMemoryDecoder,createHarrisReadyLogic,createHarrisBusOwner} from '../src/experimental/wired-kernel/evaluator-contract.js';
import {captureWiredNetImage} from '../src/experimental/wired-net-image.js';
import {captureKernelEvaluatorImage} from '../src/experimental/wired-kernel/evaluator-image.js';
import {createNativeOwnedKernel} from '../src/experimental/wired-kernel/owned-kernel.js';
import {runNativeSettleOracle} from '../scripts/lib/harris-native-settle-oracle.mjs';
const wasmBytes=process.env.HARRIS_NET_WASM?new Uint8Array(readFileSync(process.env.HARRIS_NET_WASM)):null;
const native={skip:wasmBytes?false:'build current prototype and set HARRIS_NET_WASM; native gate not exercised'};
const wire=(from,p,to,q=p)=>({from,fromTerminal:p,to,toTerminal:q});
const capture=circuit=>captureWiredNetImage({enabled:true,circuit});
function check(circuit,kernel) {
    const image=capture(circuit),actual=kernel.settle(image.driverLevels),delta=circuit.settle(),after=capture(circuit);
    assert.equal(actual.delta,delta);assert.deepEqual(actual.levels,after.resolvedLevels);assert.deepEqual(actual.conflicts,after.resolvedConflicts);
    assert.deepEqual(actual.driverLevels,after.driverLevels);return actual;
}
test('evaluator admission requires owned identities and original output/compiled-evaluator contracts',async()=>{
    const make=()=>new DigitalCircuit({enabled:true,parts:[createHarrisMemoryDecoder({id:'decoder',lane:0,start:0,end:65536})]});
    const admitted=captureKernelEvaluatorImage({enabled:true,circuit:make()});assert.equal(admitted.operations[0],1);
    assert.equal(admitted.reverseDependencyOffsets.length,admitted.resolvedLevels.length+1);
    assert.equal(admitted.reverseDependencyOffsets.at(-1),admitted.dependencies.length);
    for(let net=0;net<admitted.resolvedLevels.length;net++)for(let p=admitted.reverseDependencyOffsets[net];p<admitted.reverseDependencyOffsets[net+1];p++){
        const operation=admitted.reverseOperations[p],dependencies=admitted.dependencies.slice(admitted.dependencyOffsets[operation],admitted.dependencyOffsets[operation+1]);
        assert.ok(dependencies.includes(net),'reverse dependency entries are exact forward memberships');
    }
    for(const change of [part=>{part.evaluate=()=>({ce_n:0});},part=>{part.compileEvaluate=()=>()=>({ce_n:0});},
        part=>{part.kernelCertificate={...part.kernelCertificate};},part=>{part.outputs.push('extra');}]) {
        const circuit=make();change(circuit.parts.get('decoder'));
        assert.throws(()=>captureKernelEvaluatorImage({enabled:true,circuit}),{code:'UNSUPPORTED_KERNEL_EVALUATOR'});
        await assert.rejects(createNativeOwnedKernel({enabled:true,circuit,wasmBytes:new Uint8Array()}),{code:'UNSUPPORTED_KERNEL_EVALUATOR'});
    }
    const circuit=make();let calls=0;circuit.parts.get('decoder').evaluate=()=>{calls++;return {ce_n:0};};
    await assert.rejects(createNativeOwnedKernel({enabled:true,circuit,wasmBytes:new Uint8Array()}),{code:'UNSUPPORTED_KERNEL_EVALUATOR'});assert.equal(calls,0);
});
test('native decoders match boundaries, aliases, both byte lanes and every unknown address bit on edited nets',native,async()=>{
    const A=bitPins('a',24),pins=[...A,'bhe_n','m_io'];
    for(const Circuit of [DigitalCircuit,CompiledDigitalCircuit])for(const lane of [0,1])for(const swap of [false,true]) {
        const decoder=createHarrisMemoryDecoder({id:'decoder',lane,start:0x10000,end:0x20000,romLowAlias:true});
        const circuit=new Circuit({enabled:true,parts:[{id:'in',pins,outputs:pins},decoder],wires:pins.map(p=>wire('in',p,'decoder',swap?(p==='a1'?'a2':p==='a2'?'a1':p):p))});
        const kernel=await createNativeOwnedKernel({enabled:true,circuit,wasmBytes});
        for(const address of [0,0xffff,0x10000,0x10002,0x1ffff,0x20000,0xeffff,0xf0000,0xfffff,0x100000])for(const mio of [0,1,'X','Z'])for(const bhe of [0,1,'X','Z']) {
            circuit.drive('in',{...bitDrives(A,address),m_io:mio,bhe_n:bhe});check(circuit,kernel);
        }
        for(const pin of A)for(const unknown of ['X','Z']) {
            circuit.drive('in',{...bitDrives(A,0x10000),m_io:1,bhe_n:0,[pin]:unknown});check(circuit,kernel);
        }
    }
});
test('native READY chains preserve staged delta order and strict four-state OR behavior',native,async()=>{
    const circuit=new DigitalCircuit({enabled:true,parts:[{id:'in',pins:['a','b'],outputs:['a','b']},createHarrisReadyLogic({id:'first'}),createHarrisReadyLogic({id:'second'})],
        wires:[wire('in','a','first','external_n'),wire('in','b','first','wait'),wire('first','ready_n','second','external_n'),wire('in','b','second','wait')]});
    const kernel=await createNativeOwnedKernel({enabled:true,circuit,wasmBytes});
    for(const a of [0,1,'X','Z'])for(const b of [0,1,'X','Z']){circuit.drive('in',{a,b});check(circuit,kernel);}
});
test('native owner mux matches held/passive/DMA selection and X/Z outputs',native,async()=>{
    const status=['s1_n','s0_n','cod_inta_n','m_io'];
    for(const dmaTransfer of [false,true]) {
        const pins=['hlda',...status,...(dmaTransfer?status.map(p=>`dma_${p}`):[])];
        const circuit=new DigitalCircuit({enabled:true,parts:[{id:'in',pins,outputs:pins},createHarrisBusOwner({dmaTransfer})],wires:pins.map(p=>wire('in',p,'bus_owner'))});
        const kernel=await createNativeOwnedKernel({enabled:true,circuit,wasmBytes});
        for(let sample=0;sample<1024;sample++) {
            const values=Object.fromEntries(pins.map((p,i)=>[p,[0,1,'X','Z'][(sample>>>(i%5*2))&3]]));
            circuit.drive('in',values);check(circuit,kernel);
        }
    }
});
test('unchanged resolved nets do not spuriously schedule an evaluator or repair its masked output',native,async()=>{
    const pins=['a','b','mask'];const circuit=new DigitalCircuit({enabled:true,parts:[{id:'in',pins,outputs:pins},createHarrisReadyLogic()],
        wires:[wire('in','a','irq_ready','external_n'),wire('in','b','irq_ready','wait'),wire('in','mask','irq_ready','ready_n')]});
    circuit.drive('in',{a:1,b:0,mask:'X'});circuit.settle();const kernel=await createNativeOwnedKernel({enabled:true,circuit,wasmBytes});
    circuit.drive('irq_ready',{ready_n:0});check(circuit,kernel);assert.equal(circuit.drives.get('irq_ready.ready_n'),0);
});
test('native nonconvergence preserves published state and pending delta history permits recovery',native,async()=>{
    const A=bitPins('a',24),pins=[...A,'bhe_n'];
    const circuit=new DigitalCircuit({enabled:true,maxDeltas:2,parts:[{id:'in',pins,outputs:pins},createHarrisMemoryDecoder({id:'decoder',lane:0,start:0,end:65536})],
        wires:[...pins.map(p=>wire('in',p,'decoder')),wire('decoder','ce_n','decoder','m_io')]});
    circuit.drive('in',{...bitDrives(A,0x100),bhe_n:0});circuit.settle();const kernel=await createNativeOwnedKernel({enabled:true,circuit,wasmBytes});
    const published=kernel.inspect();circuit.drive('decoder',{ce_n:0});const input=capture(circuit).driverLevels;
    assert.throws(()=>kernel.settle(input),{code:'NON_CONVERGENT'});assert.throws(()=>circuit.settle(),{code:'NON_CONVERGENT'});
    assert.deepEqual(kernel.inspect(),published);assert.deepEqual(kernel.inspect().levels,capture(circuit).resolvedLevels);
    circuit.drive('decoder',{ce_n:'X'});check(circuit,kernel);
    const bad=capture(circuit).driverLevels;bad[0]=9;assert.throws(()=>kernel.settle(bad),{code:'INVALID_DRIVER_LEVEL'});check(circuit,kernel);
});
test('native operation/dependency admission and delta limits fail before mutating published state',native,async()=>{
    const {instance}=await WebAssembly.instantiate(wasmBytes,{}),e=instance.exports,base=e.arena_ptr(),v=new DataView(e.memory.buffer);
    const p={offsets:base,ids:base+16,drivers:base+24,live:base+28,conflicts:base+32,ops:base+36,staged:base+164,
        published:base+168,publishedConflicts:base+172,dependencyOffsets:base+176,dependencies:base+184,previous:base+188,changed:base+192};
    for(const fault of ['opcode','output','dependency','limit']) {
        new Uint8Array(e.memory.buffer,base,196).fill(0);
        [0,1,2].forEach((n,i)=>v.setUint32(p.offsets+4*i,n,true));[0,1].forEach((n,i)=>v.setUint32(p.ids+4*i,n,true));
        v.setUint8(p.drivers,1);[fault==='opcode'?99:2,0,1,fault==='output'?99:1].forEach((n,i)=>v.setUint32(p.ops+4*i,n,true));
        v.setUint32(p.dependencyOffsets+4,1,true);v.setUint32(p.dependencies,fault==='dependency'?99:0,true);
        new Uint8Array(e.memory.buffer,p.published,2).fill(99);new Uint8Array(e.memory.buffer,p.publishedConflicts,2).fill(99);
        const result=e.settle_owned(2,2,p.offsets,p.ids,p.drivers,p.live,p.conflicts,1,p.ops,p.staged,p.published,p.publishedConflicts,
            fault==='limit'?0:8,p.dependencyOffsets,p.dependencies,1,p.previous,p.changed)>>>0;
        assert.equal(result,(0x80000000|(fault==='limit'?5:4))>>>0);
        assert.deepEqual([...new Uint8Array(e.memory.buffer,p.published,2)],[99,99]);assert.deepEqual([...new Uint8Array(e.memory.buffer,p.publishedConflicts,2)],[99,99]);
        assert.deepEqual([...new Uint8Array(e.memory.buffer,p.drivers,2)],[1,0]);assert.deepEqual([...new Uint8Array(e.memory.buffer,p.previous,2)],[0,0]);
    }
});
test('native combinational oracle agrees at every settle boundary of populated-board memory and I/O periods',native,async()=>{
    const report=await runNativeSettleOracle({wasmBytes});assert.equal(report.accepted,true);assert.equal(report.capacityClaim,false);assert.ok(report.comparisons>200);
});
