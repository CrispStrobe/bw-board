import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {getDevice} from '../src/devices.js';
import {CircuitFault} from '../src/experimental/digital-circuit.js';
import {DigitalBusMemoryAdapter} from '../src/experimental/latched-memory-components.js';
import {createNativeMemoryBanks,MEMORY_BANK_PINS} from '../src/experimental/wired-kernel/memory-banks.js';
import {runNativeMemoryOracle} from '../scripts/lib/harris-native-memory-oracle.mjs';
registerBusMemory();
const wasmBytes=process.env.HARRIS_NET_WASM?new Uint8Array(readFileSync(process.env.HARRIS_NET_WASM)):null;
const native={skip:wasmBytes?false:'build memory prototype and set HARRIS_NET_WASM; native memory gate not exercised'};
test('portable native memory oracle compares all byte values and a late peer fault',native,async()=>{
    const report=await runNativeMemoryOracle({wasmBytes});
    assert.equal(report.accepted,true);assert.equal(report.capacityClaim,false);assert.equal(report.comparisons,1795);
    assert.equal(report.faults,1);
});
const blank=count=>{const pins=new Uint8Array(count*28);for(let b=0;b<count;b++)pins.set([1,0,1,1,1],b*28);return pins;};
function drive(pins,bank,{address,byte,...values}) {
    for(const [pin,value] of Object.entries(values))pins[bank*28+MEMORY_BANK_PINS.indexOf(pin)]=value;
    if(address!==undefined)for(let bit=0;bit<15;bit++)pins[bank*28+5+bit]=(address>>>bit)&1;
    if(byte!==undefined)for(let bit=0;bit<8;bit++)pins[bank*28+20+bit]=(byte>>>bit)&1;
}
const inspect=ref=>({bytes:ref.inspect().bytes,writes:ref.writes,cycle:ref.state._cycle,addr:ref.state.addr,out:ref.state._out,
    armed:ref.state._armed,pending:ref.state._pending?{...ref.state._pending}:null,
    drives:Uint8Array.from({length:8},(_,i)=>ref.state.drives[`d${i}`]?Number(ref.state.drives[`d${i}`].vTh>2.5):3)});
async function fixture(banks) {
    banks=banks.map((b,i)=>({id:`bank${i}`,...b}));
    const refs=banks.map(b=>new DigitalBusMemoryAdapter({enabled:true,...b,model:getDevice(b.kind),writeJournal:true}));
    const kernel=await createNativeMemoryBanks({enabled:true,banks,wasmBytes});
    const pass=(pins,conflicts=new Uint8Array(pins.length))=>{
        const before=refs.map(inspect);let actual,actualError,previews,error;
        try{actual=kernel.preview(pins,conflicts);}catch(e){actualError=e;}
        try{
            previews=refs.map((ref,b)=>{
                try{return ref.preview(pin=>{
                    const index=MEMORY_BANK_PINS.indexOf(['csb','ceb'].includes(pin)?'select':pin),code=pins[b*28+index];
                    if(code>1)throw Object.assign(new CircuitFault(code===3?'FLOATING':conflicts[b*28+index]?'CONTENTION':'UNKNOWN',`${ref.id}.${pin}`),{bank:ref.id,pin});
                    return code;
                });}catch(e){e.bank??=ref.id;throw e;}
            });
            previews.forEach(p=>p.commit());
        }catch(e){error=e;}
        assert.equal(actualError?.code,error?.code,actualError?.message??error?.message);
        if(error) {
            assert.equal(actualError.bank,error.bank);if(error.pin)assert.equal(actualError.pin,error.pin);
            refs.forEach((ref,i)=>{assert.deepEqual(inspect(ref),before[i]);assert.deepEqual(kernel.inspect(i),before[i]);});
        }else {
            for(let i=0;i<refs.length;i++) {
                assert.equal(actual[i].changed,previews[i].changed);
                const expected=previews[i].drives===null?null:Uint8Array.from({length:8},(_,bit)=>previews[i].drives[`d${bit}`]==='Z'?3:previews[i].drives[`d${bit}`]);
                assert.deepEqual(actual[i].drives,expected);assert.deepEqual(kernel.inspect(i),inspect(refs[i]));
            }
        }
        return actualError;
    };
    return {refs,kernel,pass,pins:blank(banks.length)};
}
test('native memory admission is gated and refuses unsupported bank kinds and malformed configuration',async()=>{
    await assert.rejects(createNativeMemoryBanks(),{code:'EXPERIMENT_DISABLED'});
    await assert.rejects(createNativeMemoryBanks({enabled:true,banks:[]}),RangeError);
    await assert.rejects(createNativeMemoryBanks({enabled:true,banks:[{kind:'custom'}]}),/owned/);
    await assert.rejects(createNativeMemoryBanks({enabled:true,banks:[{kind:'62256',readOnly:1}]}),/readOnly/);
    await assert.rejects(createNativeMemoryBanks({enabled:true,banks:[{kind:'62256',contents:new Uint8Array(32769)}]}),/contents/);
    await assert.rejects(createNativeMemoryBanks({enabled:true,banks:[{id:'same',kind:'62256'},{id:'same',kind:'62256'}]}),/duplicate/);
});
test('native RAM/EEPROM previews retain fill, turnaround, latest pending byte and read-only semantics',native,async()=>{
    const f=await fixture([{kind:'62256'},{kind:'28c256'},{kind:'28c256',readOnly:true},{kind:'62256',readOnly:true}]);
    assert.equal(f.kernel.capabilities.board,false);f.pass(f.pins);f.pass(f.pins);
    for(const byte of [0,1,0x55,0xaa,0xff]) {
        for(let b=0;b<4;b++)drive(f.pins,b,{select:0,oeb:1,web:0,address:0x1234,byte});
        f.pass(f.pins);f.pass(f.pins);
        for(let b=0;b<4;b++)drive(f.pins,b,{byte:byte^255});f.pass(f.pins);
        for(let b=0;b<4;b++)drive(f.pins,b,{select:1,web:1});f.pass(f.pins);f.pass(f.pins);
        for(let b=0;b<4;b++){
            assert.equal(f.kernel.inspect(b).bytes[0x1234],b===2?255:byte^255);
            drive(f.pins,b,{select:0,oeb:0,web:1});
        }
        f.pass(f.pins);f.pass(f.pins);
        for(let b=0;b<4;b++)drive(f.pins,b,{select:1,oeb:1});f.pass(f.pins);f.pass(f.pins);
    }
    assert.equal(f.kernel.inspect(2).writes,0);assert.equal(f.kernel.inspect(3).writes,5);
});
test('native memory never commits the unarmed power-on write and preserves write-edge sampling',native,async()=>{
    const f=await fixture([{kind:'62256',contents:Uint8Array.of(0x34)}]);
    drive(f.pins,0,{select:0,web:0,address:0,byte:0xab});f.pass(f.pins);f.pass(f.pins);
    assert.equal(f.kernel.inspect(0).bytes[0],0x34);drive(f.pins,0,{select:1,web:1});f.pass(f.pins);
    assert.equal(f.kernel.inspect(0).writes,0);assert.equal(f.kernel.inspect(0).bytes[0],0x34);
    drive(f.pins,0,{select:0,web:0});f.pass(f.pins);f.pass(f.pins);
    drive(f.pins,0,{select:1,web:1});f.pass(f.pins);assert.equal(f.kernel.inspect(0).bytes[0],0xab);assert.equal(f.kernel.inspect(0).writes,1);
});
test('every byte value traverses native pending-write, trailing edge and read drive',native,async()=>{
    const f=await fixture([{kind:'62256'}]);f.pass(f.pins);f.pass(f.pins);
    for(let byte=0;byte<256;byte++) {
        drive(f.pins,0,{select:0,oeb:1,web:0,address:(byte*127)&32767,byte});f.pass(f.pins);f.pass(f.pins);
        drive(f.pins,0,{select:1,web:1});f.pass(f.pins);
        drive(f.pins,0,{select:0,oeb:0});f.pass(f.pins);f.pass(f.pins);
        assert.equal(f.kernel.inspect(0).bytes[(byte*127)&32767],byte);
        drive(f.pins,0,{select:1,oeb:1});f.pass(f.pins);
    }
    assert.equal(f.kernel.inspect(0).writes,256);
});
test('native memory faults retain pin order and inactive address/data remain genuine dont-cares',native,async()=>{
    const f=await fixture([{kind:'62256'},{kind:'28c256'}]);f.pass(f.pins);f.pass(f.pins);
    for(const unknown of [2,3]) {
        const pins=f.pins.slice();pins.fill(unknown,4,28);f.pass(pins);
        for(const slot of [0,1,2,3,4,...Array.from({length:15},(_,i)=>5+i)]) {
            const active=f.pins.slice();drive(active,0,{select:0,oeb:0,web:1,address:0});active[slot]=unknown;
            assert.equal(f.pass(active).code,unknown===2?'UNKNOWN':'FLOATING');
        }
        for(let bit=0;bit<8;bit++) {
            const active=f.pins.slice();drive(active,1,{select:0,oeb:1,web:0,address:0,byte:0x55});active[28+20+bit]=unknown;
            assert.equal(f.pass(active).code,unknown===2?'UNKNOWN':'FLOATING');
        }
    }
    const pins=f.pins.slice();pins[0]=0;pins[1]=3;assert.equal(f.pass(pins).code,'MEMORY_POWER');
    pins[0]=1;pins[1]=1;assert.equal(f.pass(pins).code,'MEMORY_POWER');
    const conflict=f.pins.slice(),flags=new Uint8Array(conflict.length);conflict[0]=2;flags[0]=1;assert.equal(f.pass(conflict,flags).code,'CONTENTION');
});
test('a late peer-bank fault cannot commit any earlier bank state or byte',native,async()=>{
    const f=await fixture([{kind:'62256'},{kind:'28c256'},{kind:'62256'}]);f.pass(f.pins);f.pass(f.pins);
    for(let b=0;b<3;b++)drive(f.pins,b,{select:0,web:0,address:0x1234+b,byte:0x40+b});f.pass(f.pins);f.pass(f.pins);
    for(let b=0;b<3;b++)drive(f.pins,b,{select:1,web:1});f.pins[56]=0;
    assert.equal(f.pass(f.pins).bank,'bank2');for(let b=0;b<3;b++)assert.equal(f.kernel.inspect(b).writes,0);
    f.pins[56]=1;f.pass(f.pins);
    for(let b=0;b<3;b++){assert.equal(f.kernel.inspect(b).writes,1);assert.equal(f.kernel.inspect(b).bytes[0x1234+b],0x40+b);}
});
test('native memory contents and inspection/output arrays are defensive copies',native,async()=>{
    const contents=Uint8Array.of(0x21),pending=createNativeMemoryBanks({enabled:true,banks:[{kind:'62256',contents}],wasmBytes});
    contents[0]=99;const kernel=await pending;assert.equal(kernel.inspect(0).bytes[0],0x21);
    const copy=kernel.inspect(0);copy.bytes[0]=42;copy.drives.fill(0);assert.equal(kernel.inspect(0).bytes[0],0x21);
    const pins=blank(1);kernel.preview(pins);kernel.preview(pins);drive(pins,0,{select:0,oeb:0});kernel.preview(pins);
    const result=kernel.preview(pins),before=kernel.inspect(0);result[0].drives.fill(0);assert.deepEqual(kernel.inspect(0),before);
    const bad=pins.slice();bad[27]=4;assert.throws(()=>kernel.preview(bad),{code:'INVALID_DRIVER_LEVEL'});assert.deepEqual(kernel.inspect(0),before);
    assert.throws(()=>kernel.preview(new Uint8Array(27)),/dimensions/);
});
test('native write counts carry past 32 bits and refuse unsafe overflow before any peer commits',native,async()=>{
    const {instance}=await WebAssembly.instantiate(wasmBytes,{}),e=instance.exports,base=e.arena_ptr(),v=new DataView(e.memory.buffer);
    const p={memory:base,states:base+65536,staged:base+65608,protected:base+65680,inputs:base+65684,conflicts:base+65740,
        drives:base+65796,present:base+65812,changed:base+65816,fault:base+65820};
    new Uint8Array(e.memory.buffer,p.memory,65536).fill(0x11);
    for(let b=0;b<2;b++) {
        [3,0x1234,0xffffffff,1,1,0x1234,0x40+b,0,0].forEach((n,w)=>v.setUint32(p.states+(b*9+w)*4,n,true));
        new Uint8Array(e.memory.buffer,p.inputs+b*28,28).set([1,0,1,1,1]);
    }
    v.setUint32(p.states+(9+7)*4,0xffffffff,true);v.setUint32(p.states+(9+8)*4,0x1fffff,true);
    const memory=new Uint8Array(e.memory.buffer,p.memory,65536).slice(),states=new Uint8Array(e.memory.buffer,p.states,72).slice();
    const preview=()=>e.preview_memory_banks(2,p.memory,p.states,p.staged,p.protected,p.inputs,p.conflicts,p.drives,p.present,p.changed,p.fault);
    assert.equal(preview(),7);assert.equal(v.getUint32(p.fault+4,true),1);
    assert.deepEqual(new Uint8Array(e.memory.buffer,p.memory,65536),memory);assert.deepEqual(new Uint8Array(e.memory.buffer,p.states,72),states);
    v.setUint32(p.states+(9+8)*4,0,true);assert.equal(preview(),0);
    assert.equal(v.getUint32(p.states+(9+7)*4,true),0);assert.equal(v.getUint32(p.states+(9+8)*4,true),1);
    assert.equal(v.getUint8(p.memory+0x1234),0x40);assert.equal(v.getUint8(p.memory+32768+0x1234),0x41);
});
test('public native memory preview validates caller-owned buffers before any commit',native,async()=>{
    const {instance}=await WebAssembly.instantiate(wasmBytes,{}),e=instance.exports,base=e.arena_ptr(),v=new DataView(e.memory.buffer);
    let end=base;const reserve=size=>{const at=end;end+=size;return at;};
    const p={memory:reserve(32768),states:reserve(36),staged:reserve(36),protected:reserve(1),inputs:reserve(28),
        conflicts:reserve(28),drives:reserve(8),present:reserve(1),changed:reserve(1),fault:reserve(12)};
    v.setUint32(p.states+8,0xffffffff,true);
    new Uint8Array(e.memory.buffer,p.inputs,28).set([1,0,1,1,1]);
    const preview=()=>e.preview_memory_banks(1,p.memory,p.states,p.staged,p.protected,p.inputs,p.conflicts,
        p.drives,p.present,p.changed,p.fault);
    assert.equal(preview(),0);
    const memory=new Uint8Array(e.memory.buffer,p.memory,32768).slice(),states=new Uint8Array(e.memory.buffer,p.states,36).slice();
    const rejects=[
        [p.protected,0,2,9],
        [p.inputs,27,4,5],
        [p.conflicts,27,2,5],
        [p.states,0,4,6],
        [p.states,4,32768,6],
        [p.states,8,256,6],
        [p.states,12,2,6],
        [p.states,16,2,6],
        [p.states,20,32768,6],
        [p.states,24,256,6],
        [p.states,32,0x200000,6]
    ];
    for(const [address,offset,value,code] of rejects){
        const width=address===p.inputs||address===p.conflicts||address===p.protected?1:4;
        const prior=width===1?v.getUint8(address+offset):v.getUint32(address+offset,true);
        if(width===1)v.setUint8(address+offset,value);else v.setUint32(address+offset,value,true);
        const injectedStates=new Uint8Array(e.memory.buffer,p.states,36).slice();
        assert.equal(preview(),code);assert.deepEqual(new Uint8Array(e.memory.buffer,p.memory,32768),memory);
        assert.deepEqual(new Uint8Array(e.memory.buffer,p.states,36),injectedStates);
        if(width===1)v.setUint8(address+offset,prior);else v.setUint32(address+offset,prior,true);
    }
    new Uint8Array(e.memory.buffer,p.inputs,28).set([1,0,1,1,1]);
    v.setUint8(p.inputs+27,1);v.setUint8(p.conflicts+27,1);
    assert.equal(preview(),5);assert.deepEqual(new Uint8Array(e.memory.buffer,p.memory,32768),memory);
    assert.deepEqual(new Uint8Array(e.memory.buffer,p.states,36),states);
});
