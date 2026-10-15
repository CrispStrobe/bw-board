import test from 'node:test';
import assert from 'node:assert/strict';
import CPU from '../src/experimental/i80386.js';
import Machine,{PCAT80386_EXPERIMENTAL as config} from '../src/experimental/i80386-at-machine.js';
import {make,execute,observe,CODE} from '../scripts/i80386-at-profile/fixture.mjs';
test('five authored instructions have independently known arithmetic and bus consequence',()=>{
 for(const kind of ['core','at']){const s=make(kind,CPU,Machine,config);const r=execute(s,5);assert.deepEqual(r.state,{ax:2,bx:1,ip:0,word:1});assert.equal(r.cpuCycles,5);assert.equal(r.charges,kind==='at'?30:5);assert.equal(r.ifEnabled,false);assert.equal(r.interrupts,0);}
});
test('direct observation leaves AT debt and peripheral state untouched',()=>{
 const s=make('at',CPU,Machine,config);execute(s,2);assert.equal(s.machine._chipDebt,12);assert.equal(s.machine.chips.cga1.cycles,0);const a=observe(s,2,12);assert.deepEqual(observe(s,2,12),a);assert.equal(a.devices.appliedClocks,0);
});
test('invalid route and faulted engines refuse rather than fabricate zero faults',()=>{
 assert.throws(()=>make('foreign',CPU,Machine,config));const s=make('core',CPU,Machine,config);s.cpu.lastFault={vector:14};assert.throws(()=>observe(s,0,0));assert.deepEqual(Array.from(CODE.slice(0,5)),[64,137,6,0,32]);
});
