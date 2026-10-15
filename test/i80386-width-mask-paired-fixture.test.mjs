import test from 'node:test';
import assert from 'node:assert/strict';
import CPU,{I80386Fault} from '../src/experimental/i80386.js';
import {makeFixture,executePasses,EXPECTED,STREAM,ORACLE} from '../scripts/i80386-width-mask-paired/fixture.mjs';

// Authored integer/bit arithmetic, independent of either engine arm.
const EAX=[0x12345671,0x12345670,0x12345771,0x12345670,0x12355671,0x12345670,
 ...Array(6).fill(0x12345670),0x123456f0,0x12345670,0x1234d670,0x12345670,0x92345670,0x12345670,...Array(6).fill(0x12345670)];
const FLAGS=[6,2,6,2,6,2,6,2,6,2,6,2,0x86,2,0x82,2,0x82,2,0x46,0x46,0x46,2,2,2];

test('all24 real instructions match authored arithmetic, width flags and exact byte-bus order',()=>{
 const s=makeFixture(CPU,true);
 for(let i=0;i<24;i++){
  const row=ORACLE[i],start=s.events.length;assert.equal(s.cpu.eip,row.offset);assert.equal(s.cpu.step(),1);
  assert.equal(s.cpu.eax,EAX[i]);assert.equal(s.cpu.eflags,FLAGS[i]);
  const expected=row.bytes.map((_,j)=>['fetch',0x10000+row.offset+j]);
  if(i>=6&&i<12){
   const bytes=[1,1,2,2,4,4][i-6];
   for(let j=0;j<bytes;j++)expected.push(['read',0x2000+j]);
   const written=[i%2===0?0x11:0x10,0x32,0x54,0x76];
   for(let j=0;j<bytes;j++)expected.push(['write',0x2000+j,written[j]]);
  }
  assert.deepEqual(s.events.slice(start),expected,`row${i}`);
 }
 assert.equal(STREAM.length,106);assert.equal(s.cpu.eip,106);
 assert.deepEqual(s.counters,{fetchCount:106,readCount:14,writeCount:14,writeAddressSum:114702,fetchAddressSum:6952381,readAddressSum:114702});
 assert.deepEqual(Array.from(s.memory.slice(0x2000,0x2004)),[0x10,0x32,0x54,0x76]);
});

test('one tiny pass matches independently frozen full-state memory digest and work oracle',()=>{
 const actual=executePasses(makeFixture(CPU),1),expected={...EXPECTED,passes:1,instructions:24,fetchCount:106,readCount:14,writeCount:14,modelUnits:24,cpuCycles:24,fetchAddressSum:6952381,readAddressSum:114702,writeAddressSum:114702,axAccumulator:564227};
 assert.deepEqual(actual,expected);
});

test('operand-size overrides retain upper accumulator halves and default-width source bytes',()=>{
 assert.deepEqual(Array.from(STREAM.slice(10,16)),[0x66,5,1,0,1,0]);
 const s=makeFixture(CPU);executePasses(s,2);assert.equal(s.cpu.eax,0x12345670);assert.equal(s.cpu.ebx,0xfff0);assert.equal(s.cpu.ebp,0x8000);assert.equal(s.cpu.esp,0xfffe);
});

test('first/second memory read faults retain original object without fabricated writes or progress',()=>{
 for(const address of [0x2000,0x2001]){
  const s=makeFixture(CPU,true);s.cpu.eip=ORACLE[8].offset;const original=s.cpu.read,fault=new I80386Fault(14,0,'authored operand fault');
  s.cpu.read=a=>{if(a===address)throw fault;return original(a);};
  assert.throws(()=>s.cpu.step(),e=>e===fault);assert.equal(s.cpu.eip,ORACLE[8].offset);assert.equal(s.cpu.cycles,0);assert.equal(s.counters.writeCount,0);assert.equal(s.cpu.eflags,2);
 }
});

test('second byte write fault preserves actual partial byte effect and architectural restart',()=>{
 const s=makeFixture(CPU);s.cpu.eip=ORACLE[8].offset;const original=s.cpu.write,fault=new I80386Fault(14,2,'authored write fault');
 s.cpu.write=(a,v)=>{if(a===0x2001)throw fault;original(a,v);};
 assert.throws(()=>s.cpu.step(),e=>e===fault);assert.equal(s.cpu.eip,ORACLE[8].offset);assert.equal(s.cpu.cycles,0);assert.equal(s.memory[0x2000],0x11);assert.equal(s.memory[0x2001],0x32);
});

test('stopped, faulted and nonordinary cache/profile state cannot issue positive semantic facts',()=>{
 for(const mutate of [c=>{c.halted=true;},c=>{c.shutdown=true;},c=>{c.lastFault={vector:14};},c=>{c.cpuProfile='foreign';}]){
  const s=makeFixture(CPU);mutate(s.cpu);assert.throws(()=>executePasses(s,1),/engine stopped|engine fault state|ordinary engine configuration/);
 }
});
