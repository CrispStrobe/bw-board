import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHarrisMemoryBoard} from '../src/experimental/harris-80c286-memory-board.js';
import {registerBusMemory} from '../src/devices/bus-memory.js';
import {bitPins} from '../src/experimental/digital-circuit.js';
registerBusMemory();
const make=()=>{const b=createHarrisMemoryBoard({enabled:true,holdEnabled:true});b.initialize();return b;};
test('HOLD remains gated; enabled idle handoff releases bus drivers and resumes queued work',()=>{
    const off=createHarrisMemoryBoard({enabled:true});off.initialize();assert.throws(()=>off.clock({hold:1}),{code:'UNSUPPORTED_HOLD'});
    const b=make();b.clock({hold:1});assert.equal(b.circuit.require('cpu','hlda'),1);
    for(const p of [...bitPins('a',24),...bitPins('d',16),'bhe_n','lock_n'])assert.equal(b.circuit.read('cpu',p),'Z');
    b.submit({kind:'memory-write',address:0x500,width:2,value:0xabcd});
    for(let i=0;i<8;i++)assert.equal(b.clock({hold:1,ready_n:1}),null);
    assert.equal(b.inspectMemory('ram0').writes,0);
    let r;for(let i=0;i<16;i++){r=b.clock({hold:0,ready_n:0});if(r?.last)break;}
    assert.equal(r?.operand,0xabcd);assert.equal(b.circuit.require('cpu','hlda'),0);
});
test('HOLD finishes a READY-stalled write and its data hold before releasing ownership',()=>{
    const b=make();b.submit({kind:'memory-write',address:0x500,width:2,value:0x1234});
    for(let i=0;i<4;i++)b.clock({ready_n:1});
    for(let i=0;i<6;i++){assert.equal(b.clock({hold:1,ready_n:1}),null);assert.equal(b.circuit.require('cpu','hlda'),0);}
    let r;for(let i=0;i<4;i++){r=b.clock({ready_n:0});if(r?.last)break;}
    assert.equal(r?.operand,0x1234);assert.equal(b.inspectMemory('ram0').writes,1);
    b.submit({kind:'memory-read',address:0x500,width:2});
    for(let i=0;i<4;i++)b.clock();assert.equal(b.circuit.require('cpu','hlda'),1);
    assert.equal(b.inspectMemory('ram0').writes,1);assert.equal(b.bus.pending.kind,'memory-read');
});
test('locked split transfer cannot yield midway and RESET revokes HLDA',()=>{
    const b=make();b.submit({kind:'memory-write',address:0x501,width:2,value:0xbeef,locked:true});
    let r;for(let i=0;i<20;i++){r=b.clock({hold:1});assert.equal(b.circuit.require('cpu','hlda'),0);if(r?.last)break;}
    assert.equal(r?.operand,0xbeef);
    for(let i=0;i<4;i++)b.clock();assert.equal(b.circuit.require('cpu','hlda'),1);
    b.clock({reset:1});assert.equal(b.circuit.require('cpu','hlda'),0);assert.equal(b.bus.pending,null);
});
