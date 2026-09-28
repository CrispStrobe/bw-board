import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ExperimentalI80386ATMachine,PCAT80386_EXPERIMENTAL_4M} from
  '../src/experimental/i80386-at-machine.js';
import {runOwnedI80386CrossModeIoProof} from
  '../src/experimental/i80386-cross-mode-io-proof.js';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(mode,{immediate=0,ebx=0x30}={}){
  const events=[];
  const machine=new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M,{
    onPortAccess:event=>events.push({type:'port',eip:machine.cpu.eip,...event})});
  const cpu=machine.cpu,wide=mode==='protected32';
  cpu.cr0=mode==='real'?0:1;cpu.cr3=0;cpu.cr4=0;
  cpu.cs=0x1000;cpu.ds=0x2000;cpu.eip=0x100;cpu.ebx=ebx;
  cpu.edx=0x21;cpu.eflags=mode==='vm86'?0x23002:2;
  cpu.segmentCaches[1]={base:0x10000,limit:0xffff,default32:wide,
    present:true,code:true,readable:true,writable:false};
  cpu.segmentCaches[3]={base:0x20000,limit:0xffff,default32:wide,
    present:true,code:false,readable:true,writable:true};
  if(mode==='vm86'){
    cpu.tr={selector:0x28,base:0x30000,limit:0x84,present:true,type:9};
    machine.mem[0x30066]=0x80;machine.mem[0x30067]=0;
    machine.mem[0x30084]=0;
  }
  machine.mem.set([0xec,0x88,wide?0x03:0x07,0x8a,wide?0x03:0x07,
    0x3c,immediate,0x75,0xf7],0x10100);
  machine.mem[0x20000+(ebx&0xffff)]=0xa5;
  machine._chipDebt=0;machine._chipDeadline=10000;
  const read=machine._read386.bind(machine),write=machine._write386.bind(machine);
  machine._read386=function(address){
    if(address===0x20000+(ebx&0xffff))
      events.push({type:'ram-read',address,eip:cpu.eip});
    if(address===0x30066||address===0x30067||address===0x30084)
      events.push({type:'io-bitmap-read',address,eip:cpu.eip});
    return read(address);
  };
  machine._write386=function(address,value){
    if(address===0x20000+(ebx&0xffff))
      events.push({type:'ram-write',address,value,eip:cpu.eip});
    return write(address,value);
  };
  return {machine,events};
}
function state({machine,events}){
  const cpu=machine.cpu;
  return {cpu:cpu._snapshotInstruction(),cpuCycles:cpu.cycles,
    boardCycles:machine.cycles,chipDebt:machine._chipDebt,
    chipDeadline:machine._chipDeadline,
    memory:hash(machine.mem),
    chips:Object.fromEntries(Object.entries(machine.chips).map(([name,chip])=>
      [name,chip.getState?.()])),events};
}
function ordinary(machine,count){for(let i=0;i<count;i++)machine.step();}

for(const mode of ['real','protected16','vm86','protected32']){
  for(const [name,immediate,count,reason] of [
    ['fallthrough',0,5,'branch-fallthrough'],
    ['taken',1,10,'run-budget']]){
    test(`${mode} ${name}: state and ordered port/RAM effects equal ordinary steps`,()=>{
      const fast=fixture(mode,{immediate}),slow=fixture(mode,{immediate});
      const result=runOwnedI80386CrossModeIoProof(fast.machine,{maxInstructions:count});
      ordinary(slow.machine,count);
      assert.deepEqual(result,{accepted:true,completed:count,reason,
        stop:{cs:0x1000,eip:reason==='branch-fallthrough'?0x109:0x100},
        ioReads:count/5});
      assert.deepEqual(state(fast),state(slow));
      assert.deepEqual(fast.events.map(event=>event.type),
        Array(count/5).fill([...(mode==='vm86'?Array(3).fill('io-bitmap-read'):[]),
          'port','ram-write','ram-read']).flat());
    });
  }
}

test('chip deadline exits before the next instruction and ordinary resume matches',()=>{
  const fast=fixture('protected16',{immediate:1});
  const slow=fixture('protected16',{immediate:1});
  for(const fixtureState of [fast,slow]){
    fixtureState.machine.hooks.onPortAccess=event=>{
      fixtureState.events.push({type:'port',eip:fixtureState.machine.cpu.eip,...event});
      fixtureState.machine._chipDeadline=6;
    };
  }
  const result=runOwnedI80386CrossModeIoProof(fast.machine,{maxInstructions:5});
  assert.deepEqual(result,{accepted:true,completed:1,reason:'chip-event-boundary',
    stop:{cs:0x1000,eip:0x101},ioReads:1});
  ordinary(slow.machine,1);
  assert.deepEqual(state(fast),state(slow));
  fast.machine.step();slow.machine.step();
  assert.deepEqual(state(fast),state(slow));
});

test('unsafe dynamic RAM address exits before load or store with prior I/O committed',()=>{
  const fast=fixture('protected32',{immediate:0,ebx:0xa0000});
  const slow=fixture('protected32',{immediate:0,ebx:0xa0000});
  const before=state(fast);
  const result=runOwnedI80386CrossModeIoProof(fast.machine,{maxInstructions:5});
  assert.deepEqual(result,{accepted:true,completed:1,reason:'ram-slow-exit',
    stop:{cs:0x1000,eip:0x101},ioReads:1});
  ordinary(slow.machine,1);
  assert.notDeepEqual(state(fast),before);
  assert.deepEqual(state(fast),state(slow));
  fast.machine.step();slow.machine.step();
  assert.deepEqual(state(fast),state(slow));
  assert.equal(fast.events.filter(event=>event.type==='port').length,1);
});

test('code mutation and unsafe entry refuse without executing a device read',()=>{
  const changed=fixture('protected16');
  changed.machine.mem[0x10108]=0xf6;
  const before=state(changed);
  assert.deepEqual(runOwnedI80386CrossModeIoProof(changed.machine),
    {accepted:false,completed:0,reason:'code-mismatch'});
  assert.deepEqual(state(changed),before);
  const irq=fixture('protected16');irq.machine.cpu.eflags|=0x200;
  const irqBefore=state(irq);
  assert.deepEqual(runOwnedI80386CrossModeIoProof(irq.machine),
    {accepted:false,completed:0,reason:'fixture-state'});
  assert.deepEqual(state(irq),irqBefore);
});

test('synchronous port callback code mutation exits before the next instruction',()=>{
  const fast=fixture('protected16',{immediate:1}),slow=fixture('protected16',{immediate:1});
  for(const f of [fast,slow]){
    f.machine.hooks.onPortAccess=event=>{
      f.events.push({type:'port',eip:f.machine.cpu.eip,...event});
      f.machine.mem[0x10101]=0x90;
    };
  }
  const result=runOwnedI80386CrossModeIoProof(fast.machine,{maxInstructions:5});
  assert.deepEqual(result,{accepted:true,completed:1,reason:'code-revoked',
    stop:{cs:0x1000,eip:0x101},ioReads:1});
  ordinary(slow.machine,1);
  assert.deepEqual(state(fast),state(slow));
  fast.machine.step();slow.machine.step();
  assert.deepEqual(state(fast),state(slow));
});

test('synchronous port callback translation change exits before RAM access',()=>{
  const fast=fixture('protected32',{immediate:1}),slow=fixture('protected32',{immediate:1});
  for(const f of [fast,slow]){
    f.machine.hooks.onPortAccess=event=>{
      f.events.push({type:'port',eip:f.machine.cpu.eip,...event});
      f.machine.cpu.cr0|=0x80000000;
    };
  }
  const result=runOwnedI80386CrossModeIoProof(fast.machine,{maxInstructions:5});
  assert.deepEqual(result,{accepted:true,completed:1,reason:'identity-change',
    stop:{cs:0x1000,eip:0x101},ioReads:1});
  ordinary(slow.machine,1);
  assert.deepEqual(state(fast),state(slow));
  assert.equal(fast.events.some(event=>event.type==='ram-write'),false);
});

test('VM86 denied I/O bitmap exits before any port read or committed instruction',()=>{
  const fast=fixture('vm86'),slow=fixture('vm86');
  fast.machine.mem[0x30084]=2;
  slow.machine.mem[0x30084]=2;
  const before=state(fast);
  assert.deepEqual(runOwnedI80386CrossModeIoProof(fast.machine),
    {accepted:false,completed:0,reason:'io-permission-slow-exit'});
  assert.deepEqual(state(fast),before);
  fast.machine.step();slow.machine.step();
  assert.deepEqual(state(fast),state(slow));
  assert.equal(fast.events.filter(event=>event.type==='port').length,0);
});

test('synchronous descriptor mutation exits before RAM store',()=>{
  const fast=fixture('protected16'),slow=fixture('protected16');
  for(const f of [fast,slow]){
    f.machine.hooks.onPortAccess=event=>{
      f.events.push({type:'port',eip:f.machine.cpu.eip,...event});
      f.machine.cpu.segmentCaches[3].limit=0x20;
    };
  }
  const result=runOwnedI80386CrossModeIoProof(fast.machine,{maxInstructions:5});
  assert.deepEqual(result,{accepted:true,completed:1,reason:'identity-change',
    stop:{cs:0x1000,eip:0x101},ioReads:1});
  ordinary(slow.machine,1);
  assert.deepEqual(state(fast),state(slow));
  assert.equal(fast.events.some(event=>event.type==='ram-write'),false);
});
