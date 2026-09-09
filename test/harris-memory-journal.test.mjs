import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {getDevice} from '../src/devices.js';
import {DigitalBusMemoryAdapter} from '../src/experimental/latched-memory-components.js';
registerBusMemory();

function fixture({kind='62256',writeJournal=false,readOnly=false,custom=false}={}) {
    const base=getDevice(kind),model=custom?{...base,update:(...args)=>base.update(...args)}:base;
    const memory=new DigitalBusMemoryAdapter({enabled:true,id:'memory',kind,model,writeJournal,readOnly});
    const pins=Object.fromEntries(memory.part().pins.map(p=>[p,['vcc','csb','ceb','oeb','web'].includes(p)?1:0]));
    const preview=values=>{Object.assign(pins,values);return memory.preview(p=>pins[p]);};
    const update=values=>{const p=preview(values);p.commit();return p;};
    update({});update({});
    return {memory,preview,update};
}

for(const kind of ['62256','28c256'])for(const readOnly of [false,true])test(`${kind}/${readOnly}: journal retains original storage until commit and matches copy path`,()=>{
    const ref=fixture({kind,readOnly}),fast=fixture({kind,readOnly,writeJournal:true});
    const select=kind==='62256'?'csb':'ceb';
    for(const f of [ref,fast]) {
        f.update({[select]:0,web:0,a0:1,d0:1,d3:1});f.update({});
    }
    const storage=fast.memory.state.mem,before=storage[1];
    const a=ref.preview({web:1}),b=fast.preview({web:1});
    assert.equal(storage[1],before);assert.equal(fast.memory.inspect().writes,0);
    assert.deepEqual(b.drives,a.drives);assert.equal(b.changed,a.changed);
    a.commit();b.commit();
    assert.equal(fast.memory.state.mem,storage);
    assert.deepEqual(fast.memory.inspect(),ref.memory.inspect());
    assert.equal(storage[1],kind==='28c256'&&readOnly?255:9);
});

test('replacing update invalidates journal contract and retains defensive copy fallback',()=>{
    const f=fixture({writeJournal:true,custom:true});f.update({csb:0,web:0,d0:1});f.update({});
    const storage=f.memory.state.mem,preview=f.preview({web:1});assert.equal(storage[0],0);
    preview.commit();assert.notEqual(f.memory.state.mem,storage);assert.equal(f.memory.state.mem[0],1);
});
