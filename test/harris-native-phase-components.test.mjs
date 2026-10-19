import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CircuitFault} from '../src/experimental/digital-circuit.js';
import {MemoryPhaseController,IdealAddressLatch} from '../src/experimental/latched-memory-components.js';
import {HARRIS_80C286_STATUS} from '../src/experimental/harris-80c286-contract.js';
import {createNativePhaseComponents,PHASE_INPUTS,LATCH_INPUTS} from '../src/experimental/wired-kernel/phase-components.js';
import {runNativePhaseOracle} from '../scripts/lib/harris-native-phase-oracle.mjs';
const wasmBytes=process.env.HARRIS_NET_WASM?new Uint8Array(readFileSync(process.env.HARRIS_NET_WASM)):null;
const native={skip:wasmBytes?false:'build phase prototype and set HARRIS_NET_WASM; native gate not exercised'};
const encode=values=>Uint8Array.from(PHASE_INPUTS,p=>values[p]??0);
const passive={reset:0,ready_n:0,s1_n:1,s0_n:1,cod_inta_n:0,m_io:0};
const reader=(pins,levels,conflicts=new Uint8Array(levels.length))=>pin=>{
    const slot=pins.indexOf(pin),value=levels[slot];
    if(value>1)throw new CircuitFault(value===3?'FLOATING':conflicts[slot]?'CONTENTION':'UNKNOWN',pin);
    return value;
};
async function fixture(options={}) {
    const ref=new MemoryPhaseController({enabled:true,...options}),kernel=await createNativePhaseComponents({enabled:true,...options,wasmBytes});
    const compare=()=>assert.deepEqual(kernel.inspect(),{state:ref.state,phase:ref.phase,open:ref.open,tcCount:ref.tcCount,kind:ref.kind});
    const call=(method,values,conflicts)=>{
        const levels=encode(values);let actual,expected,aerror,error;
        try{actual=kernel[method](levels,conflicts);}catch(e){aerror=e;}
        try{expected=ref[method](reader(PHASE_INPUTS,levels,conflicts));}catch(e){error=e;}
        assert.equal(aerror?.code,error?.code);compare();
        if(error)return {error:aerror};
        if(method==='previewEnd') {
            assert.equal(actual.ready,expected.ready);
            return {finish:()=>{assert.deepEqual(actual.finish(),expected.finish());compare();assert.deepEqual(kernel.commands(),ref.commands());}};
        }
        assert.deepEqual(actual,expected);assert.deepEqual(kernel.commands(),ref.commands());return {};
    };
    return {ref,kernel,call,compare};
}
test('native phase components are gated and validate explicit feature flags',async()=>{
    await assert.rejects(createNativePhaseComponents(),{code:'EXPERIMENT_DISABLED'});
    await assert.rejects(createNativePhaseComponents({enabled:true,ioEnabled:1}),TypeError);
});
test('portable phase oracle compares wait sequences and latch observations',native,async()=>{
    const report=await runNativePhaseOracle({wasmBytes});assert.equal(report.accepted,true);assert.equal(report.periods,360);
    assert.equal(report.latchComparisons,128);assert.equal(report.capacityClaim,false);
});
test('native controller matches all binary status encodings in every feature configuration',native,async()=>{
    for(const ioEnabled of [false,true])for(const intrEnabled of [false,true])for(let status=0;status<16;status++) {
        const f=await fixture({ioEnabled,intrEnabled});
        f.call('beginClock',{...passive,s1_n:status&1,s0_n:(status>>1)&1,cod_inta_n:(status>>2)&1,m_io:(status>>3)&1});
    }
});
test('native controller preserves TS/TC, READY waits, INTA first-cycle wait and reset boundaries',native,async()=>{
    const f=await fixture({ioEnabled:true,intrEnabled:true});
    for(const kind of ['memory-read','memory-write','code-read','io-read','io-write','interrupt-acknowledge'])for(const waits of [0,1,4]) {
        const active={...passive,...HARRIS_80C286_STATUS[kind]};
        for(let i=0;i<2;i++){f.call('beginClock',active);f.call('previewEnd',active).finish();}
        for(let i=0;i<2*(waits+1);i++) {
            const inputs={...passive,ready_n:Number(i<2*waits)};
            f.call('beginClock',inputs);f.call('previewEnd',inputs).finish();
        }
        assert.equal(f.ref.state,'TI');assert.equal(f.ref.tcCount,waits+1);
    }
    f.call('beginClock',{...passive,...HARRIS_80C286_STATUS['memory-write']});f.call('previewEnd',passive).finish();
    f.call('beginClock',{...passive,reset:1,s1_n:3,s0_n:2});f.call('previewEnd',passive).finish();
    assert.equal(f.ref.state,'TI');assert.equal(f.ref.tcCount,0);
});
test('native controller retains clock-order/status faults, sampled pin order and preview atomicity',native,async()=>{
    const f=await fixture();assert.equal(f.call('previewEnd',passive).error.code,'CLOCK_ORDER');
    for(const p of ['reset','s1_n','s0_n','cod_inta_n','m_io'])for(const value of [2,3])assert.equal(f.call('beginClock',{...passive,[p]:value}).error.code,value===2?'UNKNOWN':'FLOATING');
    const active={...passive,...HARRIS_80C286_STATUS['memory-read']};
    f.call('beginClock',active);assert.equal(f.call('beginClock',active).error.code,'CLOCK_ORDER');f.call('previewEnd',passive).finish();
    assert.equal(f.call('beginClock',passive).error.code,'STATUS_SEQUENCE');
    f.call('beginClock',active);f.call('previewEnd',passive).finish();
    assert.equal(f.call('beginClock',active).error.code,'STATUS_SEQUENCE');
    f.call('beginClock',passive);f.call('previewEnd',{...passive,ready_n:3}).finish(); // TC1 does not sample READY.
    f.call('beginClock',passive);assert.equal(f.call('previewEnd',{...passive,ready_n:3}).error.code,'FLOATING');
    const cf=new Uint8Array(6);cf[1]=1;assert.equal(f.call('previewEnd',{...passive,ready_n:2},cf).error.code,'CONTENTION');
    f.call('previewEnd',passive).finish();
});
test('native latch is transparent only under ALE and never partially samples an invalid word',native,async()=>{
    const kernel=await createNativePhaseComponents({enabled:true,wasmBytes}),ref=new IdealAddressLatch({enabled:true});
    const pass=levels=>{
        let actual,expected,aerror,error;
        try{actual=kernel.updateLatch(levels);}catch(e){aerror=e;}
        try{expected=ref.update(reader(LATCH_INPUTS,levels));}catch(e){error=e;}
        assert.equal(aerror?.code,error?.code);
        const values=Uint8Array.from(ref.signals,p=>ref.values[`q_${p}`]==='X'?2:ref.values[`q_${p}`]);
        assert.deepEqual(kernel.inspectLatch(),values);
        if(!error)assert.deepEqual(actual,Uint8Array.from(ref.signals,p=>expected[`q_${p}`]==='X'?2:expected[`q_${p}`]));
    };
    const levels=new Uint8Array(27);levels.fill(3);levels[0]=0;pass(levels);
    levels.fill(0);levels[0]=1;pass(levels);
    for(let bit=1;bit<27;bit++)for(const value of [2,3]){const invalid=levels.slice();invalid[bit]=value;pass(invalid);}
    for(let sample=0;sample<64;sample++){for(let bit=1;bit<27;bit++)levels[bit]=(sample>>>(bit%6))&1;pass(levels);}
    levels[0]=0;levels.fill(3,1);pass(levels);
    const snapshot=kernel.inspectLatch();snapshot.fill(7);assert.notDeepEqual(kernel.inspectLatch(),snapshot);
});
test('raw native controller counter carries past 32 bits and refuses unsafe overflow atomically',native,async()=>{
    const {instance}=await WebAssembly.instantiate(wasmBytes,{}),e=instance.exports,base=e.arena_ptr(),v=new DataView(e.memory.buffer);
    const out=base+24,present=base+32,fault=base+36;
    const state=high=>[2,2,1,0xffffffff,high,1].forEach((n,i)=>v.setUint32(base+4*i,n,true));
    state(0);assert.equal(e.finish_memory_phase(base,1,out,present,fault),0);
    assert.equal(v.getUint32(base+12,true),0);assert.equal(v.getUint32(base+16,true),1);
    state(0x1fffff);const before=new Uint8Array(e.memory.buffer,base,24).slice();
    new Uint8Array(e.memory.buffer,out,9).fill(99);assert.equal(e.finish_memory_phase(base,0,out,present,fault),9);
    assert.deepEqual(new Uint8Array(e.memory.buffer,base,24),before);assert.ok(new Uint8Array(e.memory.buffer,out,9).every(n=>n===99));
});
