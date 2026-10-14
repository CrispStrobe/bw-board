import test from 'node:test';
import assert from 'node:assert/strict';
import I80386,{I80386Fault} from '../src/experimental/i80386.js';

function fixture(values=[0x12,0x80]) {
  const events=[];let cpu;
  cpu=new I80386({fetch(address){events.push([address,cpu.eip,cpu._instructionBytes]);return values[address-0x100]??0;}});
  cpu.segmentCaches[1]={base:0,limit:0xffff,default32:false,present:true,code:true,readable:true,writable:false};
  cpu.eip=0x100;cpu._instructionBytes=3;
  return {cpu,events};
}

test('guarded word callbacks observe each consumed cursor and count update',()=>{
  const {cpu,events}=fixture();
  assert.equal(cpu._fetchN(2),0x8012);
  assert.deepEqual(events,[[0x100,0x100,3],[0x101,0x101,4]]);
  assert.equal(cpu.eip,0x102);assert.equal(cpu._instructionBytes,5);
});

test('each callback value is masked before unsigned little-endian word assembly',()=>{
  for(const [values,expected] of [[[ -1,0x123],0x23ff],[[0,0x180],0x8000],[[256,256],0],[[ -1,-1],0xffff]]){
    const {cpu}=fixture(values);assert.equal(cpu._fetchN(2),expected);
  }
});

test('first-byte exception preserves original object and consumes no cursor',()=>{
  const {cpu}=fixture(),first=new Error('authored first-byte fault'),seen=[];
  cpu.fetch=address=>{seen.push([address,cpu.eip,cpu._instructionBytes]);throw first;};
  assert.throws(()=>cpu._fetchN(2),error=>error===first);
  assert.deepEqual(seen,[[0x100,0x100,3]]);assert.equal(cpu.eip,0x100);assert.equal(cpu._instructionBytes,3);
});

test('second-byte exception retains only the completed first byte',()=>{
  const {cpu}=fixture(),first=new Error('authored second-byte fault'),seen=[];
  cpu.fetch=address=>{seen.push([address,cpu.eip,cpu._instructionBytes]);if(address===0x101)throw first;return 0x34;};
  assert.throws(()=>cpu._fetchN(2),error=>error===first);
  assert.deepEqual(seen,[[0x100,0x100,3],[0x101,0x101,4]]);assert.equal(cpu.eip,0x101);assert.equal(cpu._instructionBytes,4);
});

test('second byte uses the live fetch callback rather than a cached delegate',()=>{
  const {cpu}=fixture(),seen=[];
  cpu.fetch=address=>{seen.push(['first',address,cpu.eip,cpu._instructionBytes]);cpu.fetch=second=>{seen.push(['replacement',second,cpu.eip,cpu._instructionBytes]);return 0x12;};return 0x34;};
  assert.equal(cpu._fetchN(2),0x1234);
  assert.deepEqual(seen,[['first',0x100,0x100,3],['replacement',0x101,0x101,4]]);
});

test('instruction-byte boundary selects the unchanged per-byte fallback',()=>{
  const complete=fixture();complete.cpu._instructionBytes=13;
  assert.equal(complete.cpu._fetchN(2),0x8012);assert.equal(complete.cpu._instructionBytes,15);
  const partial=fixture();partial.cpu._instructionBytes=14;
  assert.throws(()=>partial.cpu._fetchN(2),error=>error instanceof I80386Fault&&error.vector===13);
  assert.deepEqual(partial.events,[[0x100,0x100,14]]);assert.equal(partial.cpu.eip,0x101);assert.equal(partial.cpu._instructionBytes,15);
  const blocked=fixture();blocked.cpu._instructionBytes=15;
  assert.throws(()=>blocked.cpu._fetchN(2),error=>error instanceof I80386Fault&&error.vector===13);
  assert.deepEqual(blocked.events,[]);assert.equal(blocked.cpu.eip,0x100);
});

test('CS boundary faults before the second callback after one consumed byte',()=>{
  const {cpu,events}=fixture();cpu.segmentCaches[1].limit=0x100;
  assert.throws(()=>cpu._fetchN(2),error=>error instanceof I80386Fault&&error.vector===13);
  assert.deepEqual(events,[[0x100,0x100,3]]);assert.equal(cpu.eip,0x101);assert.equal(cpu._instructionBytes,4);
});

test('page crossing re-translates the second byte and preserves partial cursor',()=>{
  const {cpu}=fixture(),translated=[],fetched=[],fault=new I80386Fault(14,0,'authored missing next page');
  cpu.eip=0xfff;
  cpu._translate=linear=>{translated.push(linear);if(linear===0x1000){cpu.cr2=linear;throw fault;}return linear;};
  cpu.fetch=address=>{fetched.push([address,cpu.eip,cpu._instructionBytes]);return 0x34;};
  assert.throws(()=>cpu._fetchN(2),error=>error===fault);
  assert.deepEqual(translated,[0xfff,0x1000]);assert.deepEqual(fetched,[[0xfff,0xfff,3]]);
  assert.equal(cpu.eip,0x1000);assert.equal(cpu._instructionBytes,4);assert.equal(cpu.cr2,0x1000);
});

test('whole instruction restores architecture while retaining consumed-byte diagnostics',()=>{
  const {cpu}=fixture(),fault=new I80386Fault(14,0,'authored immediate fault'),seen=[];
  cpu.eip=0;cpu.eax=0x4321;
  cpu.fetch=address=>{seen.push([address,cpu.eip,cpu._instructionBytes]);if(address===2)throw fault;return address===0?0xb8:0x34;};
  assert.throws(()=>cpu.step(),error=>error===fault);
  assert.deepEqual(seen,[[0,0,0],[1,1,1],[2,2,2]]);assert.equal(cpu.eip,0);assert.equal(cpu.eax,0x4321);assert.equal(cpu.cycles,0);assert.equal(cpu._instructionBytes,2);
});

test('word specialization neither asks RAM32 nor changes physical unsigned addressing',()=>{
  const {cpu}=fixture(),seen=[];
  cpu.fetchRam32=()=>{throw new Error('word must not ask RAM32');};
  cpu._translate=()=>-1;
  cpu.fetch=address=>{seen.push(address);return address===0xffffffff?0x34:0x12;};
  assert.equal(cpu._fetchN(2),0x1234);assert.deepEqual(seen,[0xffffffff,0]);
});
