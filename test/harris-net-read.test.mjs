import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DigitalCircuit,CircuitFault} from '../src/experimental/digital-circuit.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
registerBusMemory();

// Previous defensive-copy read path, retained here only as a differential oracle.
function oldRequire(part,pin) {
    const state=this.inspect(part,pin);
    if(state.value===0||state.value===1)return state.value;
    throw new CircuitFault(state.conflict?'CONTENTION':state.value==='Z'?'FLOATING':'UNKNOWN',
        `${part}.${String(pin).toLowerCase()} (${state.drivers.map(d=>`${d.pin}=${d.value}`).join(', ')||'no driver'})`);
}
test('direct net readers agree with old copied reads for every two-driver level combination',()=>{
    const c=new DigitalCircuit({enabled:true,parts:[{id:'a',pins:['p'],outputs:['p']},{id:'b',pins:['p'],outputs:['p']}],
        wires:[{from:'a',fromTerminal:'p',to:'b',toTerminal:'p'}]});
    for(const a of [0,1,'X','Z'])for(const b of [0,1,'X','Z']) {
        c.drive('a',{p:a});c.drive('b',{p:b});c.settle();
        assert.equal(c.read('a','P'),c.inspect('a','P').value);
        let expected;
        try {expected={value:oldRequire.call(c,'a','P')};}catch(e){expected={code:e.code,message:e.message};}
        let actual;
        try {actual={value:c.require('a','P')};}catch(e){actual={code:e.code,message:e.message};}
        assert.deepEqual(actual,expected);
    }
});
test('inspection is still defensive and direct reads use the last settled snapshot',()=>{
    const c=new DigitalCircuit({enabled:true,parts:[{id:'a',pins:['p'],outputs:['p']}]});
    c.drive('a',{p:1});c.settle();const state=c.inspect('a','p');
    state.value=0;state.drivers[0].value=0;state.drivers.length=0;
    assert.equal(c.require('a','p'),1);assert.equal(c.inspect('a','p').drivers[0].value,1);
    c.drive('a',{p:0});assert.equal(c.read('a','p'),1);c.settle();assert.equal(c.require('a','p'),0);
});
test('wired odd/bank-boundary reads and READY writes have identical traces with copied or direct reads',()=>{
    const fast=createHarrisMemoryBoard({enabled:true,ramBytes:131072,textRAM:true});
    const old=createHarrisMemoryBoard({enabled:true,ramBytes:131072,textRAM:true});
    old.circuit.require=oldRequire;old.circuit.read=function(p,n){return this.inspect(p,n).value;};
    fast.initialize();old.initialize();
    for(const [address,value] of [[0x500,0x1234],[0xffff,0xbeef],[0x10000,0x5678],[0xb8001,0x0741]]) {
        for(const kind of ['memory-write','memory-read']) {
            const transaction={kind,address,value:kind==='memory-write'?value:0,width:2};
            fast.submit(transaction);old.submit(transaction);
            let complete=false;
            for(let i=0;i<24;i++) {
                const input={ready_n:Number(i<6)},a=fast.clock(input),b=old.clock(input);
                assert.deepEqual(a,b);if(a?.last){complete=true;break;}
            }
            assert.ok(complete);assert.deepEqual(fast.bus.getTrace(),old.bus.getTrace());
        }
    }
    for(const id of ['ram0','ram1','ram1_0','ram1_1','text0','text1'])assert.deepEqual(fast.inspectMemory(id),old.inspectMemory(id));
});
