import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DigitalCircuit} from '../src/experimental/digital-circuit.js';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
registerBusMemory();

// Previous resolver retained only as an independent differential oracle.
function oldResolve() {
    const nets=new Map();
    for(const key of this.parent.keys()) {
        const root=this.root(key);if(!nets.has(root))nets.set(root,[]);
    }
    for(const [key,value] of this.drives)if(value!=='Z')nets.get(this.root(key)).push({pin:key,value});
    return new Map([...nets].map(([key,drivers])=>{
        drivers.sort((a,b)=>a.pin.localeCompare(b.pin));
        const values=new Set(drivers.map(d=>d.value)),conflict=values.has(0)&&values.has(1);
        const value=!values.size?'Z':conflict||values.has('X')?'X':drivers[0].value;
        return [key,{value,conflict,drivers}];
    }));
}
const wire=(a,b)=>({from:a,fromTerminal:'p',to:b,toTerminal:'p'});
test('cached terminals retain case aliases, atomic drive validation and unchanged diagnostics',()=>{
    const c=new DigitalCircuit({enabled:true,parts:[{id:'a',pins:['P','q','input'],outputs:['P','q']}]});
    c.drive('a',{P:1,q:0});c.settle();
    assert.equal(c.require('a','p'),1);
    assert.throws(()=>c.drive('a',{p:0,q:2}),/invalid logic level/);
    assert.throws(()=>c.drive('a',{p:0,input:1}),/not an output a.input/);
    assert.throws(()=>c.drive('missing',{p:0}),/not an output missing.p/);
    assert.throws(()=>c.read('a','missing'),/unknown terminal a.missing/);
    c.settle();assert.equal(c.require('a','P'),1);assert.equal(c.require('a','q'),0);
    c.drive('a',{p:0,P:1});c.settle();assert.equal(c.require('a','p'),1);
    c.drive('a',{P:1,q:0});assert.equal(c.settle(),0);
    assert.deepEqual(c.resolve(),oldResolve.call(c));
});
test('static layout agrees with old resolver for undriven, input-only and all three-driver states',()=>{
    const ids=['z','A','a_1','input'];
    for(const reverse of [false,true]) {
        const parts=ids.map(id=>({id,pins:['p','q'],outputs:id==='input'?[]:['p']}));
        const wires=[wire('z','A'),wire('A','a_1'),wire('a_1','input')];
        const c=new DigitalCircuit({enabled:true,parts:reverse?parts.reverse():parts,wires:reverse?wires.reverse():wires});
        assert.deepEqual(c.resolve(),oldResolve.call(c));
        for(const a of [0,1,'X','Z'])for(const b of [0,1,'X','Z'])for(const d of [0,1,'X','Z']) {
            c.drive('a_1',{p:d});c.drive('z',{p:a});c.drive('A',{p:b});
            assert.deepEqual(c.resolve(),oldResolve.call(c));
        }
        const external=c.resolve();external.clear();
        assert.deepEqual(c.resolve(),oldResolve.call(c));
    }
});
test('combinational deltas and omitted-output releases match old resolution',()=>{
    const options={enabled:true,parts:[
        {id:'src',pins:['p'],outputs:['p']},
        {id:'gate',pins:['p','q'],outputs:['q'],evaluate:read=>read('p')==='Z'?{}:{q:read('p')===1?0:1}},
        {id:'sink',pins:['p']}],wires:[wire('src','gate'),{from:'gate',fromTerminal:'q',to:'sink',toTerminal:'p'}]};
    const fast=new DigitalCircuit(options),old=new DigitalCircuit(options);old.resolve=oldResolve;
    for(const p of [1,0,'Z','X',0,1,'Z']) {
        fast.drive('src',{p});old.drive('src',{p});
        assert.equal(fast.settle(),old.settle());assert.deepEqual(fast.snapshot,old.snapshot);
    }
});
test('wired bus traces, READY waits and memory contents match old resolver',()=>{
    const fast=createHarrisMemoryBoard({enabled:true,ramBytes:131072,textRAM:true});
    const old=createHarrisMemoryBoard({enabled:true,ramBytes:131072,textRAM:true});
    old.circuit.resolve=oldResolve;fast.initialize();old.initialize();
    for(const address of [0x500,0xffff,0x10000,0xb8001])for(const kind of ['memory-write','memory-read']) {
        const t={kind,address,width:2,value:kind==='memory-write'?0xb137:0};fast.submit(t);old.submit(t);
        let complete=false;
        for(let i=0;i<24;i++) {
            const a=fast.clock({ready_n:Number(i<6)}),b=old.clock({ready_n:Number(i<6)});
            assert.deepEqual(a,b);if(a?.last){complete=true;break;}
        }
        assert.ok(complete);assert.deepEqual(fast.bus.getTrace(),old.bus.getTrace());
    }
    for(const id of ['ram0','ram1','ram1_0','ram1_1','text0','text1'])assert.deepEqual(fast.inspectMemory(id),old.inspectMemory(id));
});
test('public resolve does not advance settled reads or swallow pending combinational updates',()=>{
    const c=new DigitalCircuit({enabled:true,parts:[{id:'in',pins:['p'],outputs:['p']},
        {id:'gate',pins:['p','q'],outputs:['q'],evaluate:r=>({q:r('p')})}],wires:[wire('in','gate')]});
    c.drive('in',{p:1});const before=c.inspect('gate','q');const external=c.resolve();
    assert.deepEqual(c.inspect('gate','q'),before);external.get(c.root('in.p')).drivers[0].value=0;
    c.settle();assert.equal(c.require('gate','q'),1);assert.equal(c.require('in','p'),1);
    assert.equal(c.settle(),0);
});
test('nonconvergence preserves the last settled snapshot and a changed input can recover',()=>{
    const c=new DigitalCircuit({enabled:true,maxDeltas:4,parts:[{id:'in',pins:['p'],outputs:['p']},
        {id:'gate',pins:['p','q'],outputs:['q'],evaluate:r=>({q:r('p')===1?(r('q')===1?0:1):0})}],wires:[wire('in','gate')]});
    const before=c.inspect('gate','q');c.drive('in',{p:1});assert.throws(()=>c.settle(),{code:'NON_CONVERGENT'});
    assert.deepEqual(c.inspect('gate','q'),before);c.drive('in',{p:0});c.settle();assert.equal(c.require('gate','q'),0);
});
