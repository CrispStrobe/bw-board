import test from 'node:test';
import assert from 'node:assert/strict';
import CPU,{I80386Fault} from '../src/experimental/i80386.js';
import {makeFixture,executePasses,ORACLE,EXPECTED,STREAM} from '../scripts/i80386-code16-paired/fixture.mjs';

test('authored 24-form table uses independent arithmetic and exact byte-bus order',()=>{
  const state=makeFixture(CPU,true);
  for(const row of ORACLE){
    const start=state.events.length;
    assert.equal(state.cpu.eip,row.streamOffset);
    assert.equal(state.cpu.step(),1);
    assert.equal(state.cpu.ax,row.expectedAX);
    const events=[];
    for(let i=0;i<row.fetchBytes;i++)events.push(['fetch',0x10000+row.streamOffset+i]);
    for(const address of row.linearReads)events.push(['read',address]);
    assert.deepEqual(state.events.slice(start),events);
    assert.equal(state.cpu.ebx,65520);assert.equal(state.cpu.ebp,32768);assert.equal(state.cpu.esi,48);assert.equal(state.cpu.edi,65533);
  }
  assert.equal(state.cpu.eip,80);assert.equal(state.counters.fetchCount,80);assert.equal(state.counters.readCount,48);assert.equal(state.counters.writeCount,0);
});

test('one tiny pass matches full golden state and unchanged authored memory',()=>{
  const state=makeFixture(CPU),actual=executePasses(state,1),expected={...EXPECTED,passes:1,instructions:24,fetchCount:80,readCount:48,modelUnits:24,cpuCycles:24,fetchAddressSum:EXPECTED.fetchAddressSum/100000,readAddressSum:EXPECTED.readAddressSum/100000,axAccumulator:EXPECTED.axAccumulator/100000};
  assert.deepEqual(actual,expected);
});

test('displacement-fetch faults preserve restart and registers before operand reads',()=>{
  for(const row of [ORACLE[6],ORACLE[8],ORACLE[16]]){
    for(let byte=2;byte<row.fetchBytes;byte++){
      const state=makeFixture(CPU,true);state.cpu.eip=row.streamOffset;state.cpu.eax=0x7654;
      const original=state.cpu.fetch,fault=new I80386Fault(14,0,'authored displacement fault');
      state.cpu.fetch=address=>{if(address===0x10000+row.streamOffset+byte)throw fault;return original(address);};
      assert.throws(()=>state.cpu.step(),error=>error===fault);
      assert.equal(state.cpu.eip,row.streamOffset);assert.equal(state.cpu.eax,0x7654);
      assert.equal(state.counters.readCount,0);assert.equal(state.counters.writeCount,0);assert.equal(state.cpu.cycles,0);
    }
  }
});

test('operand-read fault leaves bases, accumulator and memory intact',()=>{
  const state=makeFixture(CPU,true),fault=new I80386Fault(14,0,'authored operand fault');
  state.cpu.eax=0x4321;state.cpu.read=()=>{throw fault;};
  assert.throws(()=>state.cpu.step(),error=>error===fault);
  assert.equal(state.cpu.eip,0);assert.equal(state.cpu.eax,0x4321);assert.equal(state.cpu.ebx,65520);assert.equal(state.counters.writeCount,0);
});

test('direct addressing and defaults remain different from base register forms',()=>{
  assert.deepEqual(Array.from(STREAM.slice(ORACLE[6].streamOffset,ORACLE[6].streamOffset+4)),[0x8b,0x06,0x34,0x12]);
  assert.equal(ORACLE[6].offset,4660);assert.equal(ORACLE[6].effectiveSegment,'DS');
  assert.equal(ORACLE[14].effectiveSegment,'SS');assert.equal(ORACLE[22].offset,32767);
  assert.deepEqual(ORACLE.slice(0,6).map(row=>row.effectiveSegment),['ES','CS','SS','DS','FS','GS']);
});

test('stopped, faulted or nonordinary engine state cannot emit a positive semantic record',()=>{
  for(const configure of [cpu=>{cpu.halted=true;},cpu=>{cpu.shutdown=true;},cpu=>{cpu.lastFault={vector:14};},cpu=>{cpu.cpuProfile='foreign';}]){
    const state=makeFixture(CPU);configure(state.cpu);
    assert.throws(()=>executePasses(state,1),/engine stopped|engine fault state|ordinary engine configuration/);
  }
});
test('end-of-work cache enablement is observed before semantic issuance',()=>{
  const state=makeFixture(CPU),step=state.cpu.step.bind(state.cpu);let count=0;
  state.cpu.step=()=>{const result=step();if(++count===24)state.cpu._translationCacheEnabled=true;return result;};
  assert.throws(()=>executePasses(state,1),/ordinary engine configuration/);
});
