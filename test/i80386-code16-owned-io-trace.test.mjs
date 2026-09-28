import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import I80386 from '../src/experimental/i80386.js';
import {runOwnedI80386Code16IoTrace} from
  '../src/experimental/i80386-code16-owned-io-trace.js';

const dir=mkdtempSync(join(tmpdir(),'bw-owned-io-trace-test-'));
let image;
try{
  const obj=join(dir,'guest.o'),elf=join(dir,'guest.elf'),bin=join(dir,'guest.bin');
  execFileSync('as',['--32','-o',obj,new URL('./fixtures/i80386-win16-io-boundary.S',import.meta.url).pathname]);
  execFileSync('ld',['-m','elf_i386','-Ttext','0x7c00','-o',elf,obj]);
  execFileSync('objcopy',['-O','binary',elf,bin]);
  image=readFileSync(bin);
}finally{rmSync(dir,{recursive:true,force:true});}
const oracle=JSON.parse(readFileSync(new URL('../docs/receipts/2026-09-28-i80386-win16-io-boundary-oracle.json',import.meta.url)));
const hash=data=>createHash('sha256').update(data).digest('hex');
const ownedSource=readFileSync(new URL('./fixtures/i80386-win16-io-boundary.S',import.meta.url));
const coreSource=readFileSync(new URL('../src/experimental/i80386.js',import.meta.url));
assert.equal(hash(ownedSource),oracle.sourceHashes['test/fixtures/i80386-win16-io-boundary.S']);
assert.equal(hash(coreSource),oracle.sourceHashes['src/experimental/i80386.js']);
assert.equal(hash(image),oracle.imageSha256);

function fixture(cmpImmediate=1){
  const memory=new Uint8Array(0x10000);memory.set(image,0x7c00);
  memory[0x7c33]=cmpImmediate;
  let reads=0;
  const cpu=new I80386({read:a=>memory[a]??0,fetch:a=>memory[a]??0,
    write:(a,v)=>memory[a]=v&255,
    inPort:(port,width)=>{assert.deepEqual([port,width],[0x21,8]);reads++;return 0xa5;},
    outPort:()=>{throw new Error('unexpected output before acceptance checkpoint');}});
  cpu.cr0=0x11;cpu.gdtr={base:0x7c50,limit:23};
  cpu.cs=8;cpu.ds=cpu.ss=0x10;cpu.eip=0x7c2e;
  cpu.esp=0x7000;cpu.eax=0xa5;cpu.edx=0x21;cpu.eflags=6;
  cpu.segmentCaches[1]=cpu._descriptor(8);
  cpu.segmentCaches[2]=cpu._descriptor(0x10);
  cpu.segmentCaches[3]=cpu._descriptor(0x10);
  return {cpu,memory,get reads(){return reads;}};
}
function checkpoint({cpu,reads,memory}){
  return {eax:cpu.eax,ebx:cpu.ebx,ecx:cpu.ecx,edx:cpu.edx,
    esp:cpu.esp,ebp:cpu.ebp,esi:cpu.esi,edi:cpu.edi,
    cs:cpu.cs,ds:cpu.ds,ss:cpu.ss,es:cpu.es,fs:cpu.fs,gs:cpu.gs,
    eip:cpu.eip,eflags:cpu.eflags,cr0:cpu.cr0,cycles:cpu.cycles,
    reads,memorySha256:hash(memory),instructionSnapshot:cpu._snapshotInstruction()};
}
function referenceFields({cpu}){
  return {cs:cpu.cs,ds:cpu.ds,ss:cpu.ss,es:cpu.es,fs:cpu.fs,gs:cpu.gs,
    eip:cpu.eip,eflags:cpu.eflags,bx:cpu.ebx&0xffff,
    dx:cpu.edx&0xffff,al:cpu.eax&255};
}

test('one bounded call takes the branch and exits before IN; ordinary resume reads once',()=>{
  const fast=fixture(),slow=fixture();
  const result=runOwnedI80386Code16IoTrace(fast.cpu,{stepsUntilChipEvent:3});
  for(let step=0;step<3;step++)slow.cpu.step();
  assert.deepEqual(result,{accepted:true,completed:3,reason:'io-required',
    stop:{cs:8,eip:0x7c3c},branchTaken:true});
  assert.equal(fast.reads,0);
  assert.deepEqual(checkpoint(fast),checkpoint(slow));
  assert.deepEqual(referenceFields(fast),oracle.reference.before);
  assert.equal(oracle.bochs.outputHex,'a54b');
  fast.cpu.step();slow.cpu.step();
  assert.equal(fast.reads,1);
  assert.deepEqual(checkpoint(fast),checkpoint(slow));
  assert.deepEqual(referenceFields(fast),oracle.reference.after);
});

test('chip deadline at one or two instructions refuses without changing state',()=>{
  for(const budget of [1,2]){
    const fast=fixture(),before=checkpoint(fast);
    assert.deepEqual(runOwnedI80386Code16IoTrace(fast.cpu,
      {stepsUntilChipEvent:budget}),
    {accepted:false,completed:0,reason:'chip-deadline'});
    assert.deepEqual(checkpoint(fast),before);
  }
});

test('CMP immediate two takes fallthrough with exact ordinary state',()=>{
  const fast=fixture(2),slow=fixture(2);
  fast.cpu.ebx=slow.cpu.ebx=0xdeadbeef;
  const result=runOwnedI80386Code16IoTrace(fast.cpu,{stepsUntilChipEvent:3});
  for(let step=0;step<3;step++)slow.cpu.step();
  assert.deepEqual(result,{accepted:true,completed:3,reason:'branch-fallthrough',
    stop:{cs:8,eip:0x7c36},branchTaken:false});
  assert.deepEqual(checkpoint(fast),checkpoint(slow));
  assert.equal(fast.reads,0);
  fast.cpu.step();slow.cpu.step();
  assert.deepEqual(checkpoint(fast),checkpoint(slow));
  assert.equal(fast.cpu.al,'F'.charCodeAt(0));
});

test('code mutation is refused before any state or port change',()=>{
  const fixtureState=fixture();
  fixtureState.memory[0x7c35]=0x07;
  const before=checkpoint(fixtureState);
  assert.deepEqual(runOwnedI80386Code16IoTrace(fixtureState.cpu,
    {stepsUntilChipEvent:3}),
  {accepted:false,completed:0,reason:'code-mismatch'});
  assert.deepEqual(checkpoint(fixtureState),before);
});
