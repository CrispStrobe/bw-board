import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DigitalCircuit} from '../src/experimental/digital-circuit.js';
import {CompiledDigitalCircuit} from '../src/experimental/compiled-digital-circuit.js';
import {captureWiredNetImage} from '../src/experimental/wired-net-image.js';
import {createNativeNetResolver} from '../src/experimental/wired-kernel/net-resolver.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
const wasmBytes=process.env.HARRIS_NET_WASM?new Uint8Array(readFileSync(process.env.HARRIS_NET_WASM)):null;
const native={skip:wasmBytes?false:'build prototype and set HARRIS_NET_WASM; native gate not exercised'};
const fixture=(Circuit,reverse=false)=>new Circuit({enabled:true,parts:['a','b','c'].map(id=>({id,pins:['p','q','in'],outputs:['p','q']})),
    wires:(reverse?[['a','b'],['b','c']]:[['b','c'],['a','b']]).map(([from,to])=>({from,fromTerminal:'p',to,toTerminal:reverse?'q':'p'}))});
const capture=circuit=>captureWiredNetImage({enabled:true,circuit});
const compare=(circuit,image,result)=>{
    const reference=circuit.resolve();
    for(let n=0;n<image.netNames.length;n++) {
        const state=reference.get(image.netNames[n]);assert.equal([0,1,'X','Z'][result.levels[n]],state.value);assert.equal(!!result.conflicts[n],state.conflict);
    }
};
test('typed image is gated, defensive and includes actual edited net membership without settling',()=>{
    assert.throws(()=>captureWiredNetImage(),{code:'EXPERIMENT_DISABLED'});
    for(const Circuit of [DigitalCircuit,CompiledDigitalCircuit])for(const reverse of [false,true]) {
        const circuit=fixture(Circuit,reverse),before=circuit.snapshot;
        circuit.drive('a',{p:1,q:'X'});const drives=circuit.drives,image=capture(circuit);
        assert.deepEqual(circuit.snapshot,before);assert.deepEqual(circuit.drives,drives);
        assert.equal(image.capabilities.cpu,false);assert.equal(image.capabilities.resumableSnapshot,false);
        for(const terminal of image.terminals)assert.equal(image.netNames[terminal.net],circuit.root(terminal.name));
        for(let d=0;d<image.driverNames.length;d++)assert.equal(image.netNames[image.driverNets[d]],circuit.root(image.driverNames[d]));
        image.driverLevels.fill(0);image.netNames.fill('corrupted');assert.deepEqual(circuit.drives,drives);assert.deepEqual(circuit.snapshot,before);
    }
});
test('native resolver agrees with both backends for four-state drivers and edited wires',native,async()=>{
    assert.deepEqual(WebAssembly.Module.imports(await WebAssembly.compile(wasmBytes)),[],'no host callbacks/WASI in this prototype');
    for(const Circuit of [DigitalCircuit,CompiledDigitalCircuit])for(const reverse of [false,true]) {
        const circuit=fixture(Circuit,reverse),image=capture(circuit),resolver=await createNativeNetResolver({enabled:true,image,wasmBytes});
        assert.equal(resolver.capabilities.board,false);
        for(let sample=0;sample<64;sample++) {
            for(let d=0;d<3;d++)circuit.drive(['a','b','c'][d],{p:[0,1,'X','Z'][(sample>>>(d*2))&3],q:[0,1,'X','Z'][(sample+d)&3]});
            compare(circuit,image,resolver.resolve(capture(circuit).driverLevels));
        }
    }
});
test('native admission rejects malformed tables, duplicates and invalid driver levels',native,async()=>{
    const image=capture(fixture(DigitalCircuit));
    await assert.rejects(createNativeNetResolver({image,wasmBytes}),{code:'EXPERIMENT_DISABLED'});
    for(const corrupt of [i=>{i.netOffsets[1]=999;},i=>{i.netDriverIds[0]=999;},i=>{i.netDriverIds[1]=i.netDriverIds[0];}]) {
        const broken=structuredClone(image);corrupt(broken);await assert.rejects(createNativeNetResolver({enabled:true,image:broken,wasmBytes}),{code:'INVALID_NET_IMAGE'});
    }
    const resolver=await createNativeNetResolver({enabled:true,image,wasmBytes}),before=resolver.resolve(),bad=image.driverLevels.slice();bad[0]=4;
    assert.throws(()=>resolver.resolve(bad),{code:'INVALID_DRIVER_LEVEL'});assert.deepEqual(resolver.resolve(),before);
});
test('C validation precedes every output mutation, including late invalid driver codes and IDs',native,async()=>{
    const {instance}=await WebAssembly.instantiate(wasmBytes,{}),e=instance.exports,base=e.arena_ptr(),v=new DataView(e.memory.buffer);
    const offsets=base,ids=base+16,levels=base+32,resolved=base+40,conflicts=base+48;
    for(const error of [1,2]) {
        [0,1,2].forEach((n,i)=>v.setUint32(offsets+4*i,n,true));[0,error===1?99:1].forEach((n,i)=>v.setUint32(ids+4*i,n,true));
        v.setUint8(levels,1);v.setUint8(levels+1,error===2?4:0);
        new Uint8Array(e.memory.buffer,resolved,2).fill(99);new Uint8Array(e.memory.buffer,conflicts,2).fill(99);
        assert.equal(e.resolve_nets(2,2,offsets,ids,levels,resolved,conflicts),error);
        assert.deepEqual([...new Uint8Array(e.memory.buffer,resolved,2)],[99,99]);assert.deepEqual([...new Uint8Array(e.memory.buffer,conflicts,2)],[99,99]);
    }
});
test('native resolution matches a populated wired board across actual memory transaction periods',native,async()=>{
    registerBusMemory();const board=createHarrisMemoryBoard({enabled:true,netBackend:'compiled',memoryScheduling:true,packedBus:true,driveLayouts:true,ramBytes:640*1024,textRAM:true});
    board.initialize();const image=capture(board.circuit),resolver=await createNativeNetResolver({enabled:true,image,wasmBytes});
    board.submit({kind:'memory-write',address:0x501,width:2,value:0xbeef});let completed=false;
    for(let clock=0;clock<32;clock++) {
        const result=board.clock({ready_n:Number(clock<8)});compare(board.circuit,image,resolver.resolve(capture(board.circuit).driverLevels));
        if(result?.last){completed=true;break;}
    }
    assert.ok(completed);assert.equal(board.inspectMemory('ram0').writes+board.inspectMemory('ram1').writes,2);
});
