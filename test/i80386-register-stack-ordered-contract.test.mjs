import test from 'node:test';
import assert from 'node:assert/strict';
import I80386, {I80386Fault} from '../src/experimental/i80386.js';

function fixture(code,{mode='protected16',stack32=false}={}){
  const memory=new Map(code.map((value,address)=>[address,value]));
  const effects=[];
  let cpu;
  cpu=new I80386({
    fetch(address){effects.push(['fetch',address]);return memory.get(address)??0;},
    read(address){effects.push(['read',address,cpu.esp>>>0,cpu.ebx>>>0]);
      return memory.get(address)??0;},
    write(address,value){effects.push(['write',address,value&255]);
      memory.set(address,value&255);},
  });
  cpu.cr0=1;
  cpu.cs=mode==='vm86'?0:8;
  cpu.ss=mode==='vm86'?0x100:0x10;
  cpu.eflags=mode==='vm86'?0x23002:0x202;
  cpu.segmentCaches[1]={base:0,limit:0xffff,
    default32:mode==='protected32',present:true,code:true,
    readable:true,writable:false};
  cpu.segmentCaches[2]={base:0x1000,limit:0xffff,
    default32:stack32,present:true,code:false,
    readable:true,writable:true};
  cpu.esp=stack32?0x100:0xabcd0100;
  cpu.ebx=0x13572468;
  const step=()=>{const start=effects.length;cpu.step();return effects.slice(start);};
  return {cpu,memory,effects,step};
}

test('protected16 PUSH SP writes entry SP, then POP BX reads before replacing BX',()=>{
  const f=fixture([0x54,0x5b]);
  assert.deepEqual(f.step(),[
    ['fetch',0],['write',0x10fe,0],['write',0x10ff,1],
  ]);
  assert.deepEqual([f.cpu.sp,f.cpu.bx,f.cpu.eflags],
    [0xfe,0x2468,0x202]);
  assert.deepEqual(f.step(),[
    ['fetch',1],['read',0x10fe,0xabcd00fe,0x13572468],
    ['read',0x10ff,0xabcd00fe,0x13572468],
  ]);
  assert.deepEqual([f.cpu.esp,f.cpu.ebx,f.cpu.eip],
    [0xabcd0100,0x13570100,2]);
  assert.equal(f.cpu.eflags,0x202);
  assert.equal(f.cpu._interruptShadow,0);
});

test('POP ESP commits the loaded value after four ordered stack reads',()=>{
  const f=fixture([0x5c],{mode:'protected32'});
  [0x78,0x56,0x34,0x12].forEach((value,index)=>
    f.memory.set(0x1100+index,value));
  const effects=f.step();
  assert.deepEqual(effects.filter(effect=>effect[0]==='read'),[
    ['read',0x1100,0xabcd0100,0x13572468],
    ['read',0x1101,0xabcd0100,0x13572468],
    ['read',0x1102,0xabcd0100,0x13572468],
    ['read',0x1103,0xabcd0100,0x13572468],
  ]);
  assert.deepEqual([f.cpu.esp,f.cpu.eip,f.cpu.eflags],
    [0x12345678,1,0x202]);
});

for(const [mode,code,stack32] of [
  ['vm86',[0x66,0x54,0x66,0x5b],false],
  ['protected32',[0x54,0x5b],false],
])test(`${mode} dword register PUSH/POP keeps operand width independent of SS.B`,()=>{
  const f=fixture(code,{mode,stack32});
  const pushes=f.step();
  assert.deepEqual(pushes.slice(-4),[
    ['write',0x10fc,0],['write',0x10fd,1],
    ['write',0x10fe,0xcd],['write',0x10ff,0xab],
  ]);
  assert.equal(f.cpu.esp,0xabcd00fc);
  const reads=f.step().filter(effect=>effect[0]==='read');
  assert.deepEqual(reads.map(effect=>effect[1]),[0x10fc,0x10fd,0x10fe,0x10ff]);
  assert.ok(reads.every(effect=>effect[2]===0xabcd00fc&&
    effect[3]===0x13572468));
  assert.deepEqual([f.cpu.esp,f.cpu.ebx,f.cpu.eip,f.cpu.eflags],
    [0xabcd0100,0xabcd0100,code.length,
      mode==='vm86'?0x23002:0x202]);
  assert.equal(f.cpu._interruptShadow,0);
});

test('protected32 word operand with SS.B=32 preserves high register and stack bits',()=>{
  const f=fixture([0x66,0x54,0x66,0x5b],
    {mode:'protected32',stack32:true});
  f.cpu.esp=0x1000100;
  f.cpu.segmentCaches[2].limit=0xffffffff;
  assert.deepEqual(f.step().slice(-2),[
    ['write',0x10010fe,0],['write',0x10010ff,1],
  ]);
  assert.equal(f.cpu.esp,0x10000fe);
  assert.deepEqual(f.step().filter(effect=>effect[0]==='read')
    .map(effect=>effect[1]),[0x10010fe,0x10010ff]);
  assert.deepEqual([f.cpu.esp,f.cpu.ebx,f.cpu.eip,f.cpu.eflags],
    [0x1000100,0x13570100,4,0x202]);
});

for(const mode of ['protected16','vm86','protected32'])
  test(`${mode} later stack fault leaves prior register PUSH and RAM bytes committed`,()=>{
    const f=fixture([0x50,0x53],{mode,stack32:mode==='protected32'});
    f.cpu.eax=0x11223344;
    if(mode==='vm86')f.cpu.esp=0xabcd0003;
    else Object.assign(f.cpu.segmentCaches[2],{
      expandDown:true,limit:mode==='protected32'?0xfb:0xfd});
    const firstEffects=f.step();
    const firstWrites=firstEffects.filter(effect=>effect[0]==='write');
    const expectedAddresses=mode==='vm86'?[0x1001,0x1002]:
      mode==='protected32'?[0x10fc,0x10fd,0x10fe,0x10ff]:
        [0x10fe,0x10ff];
    assert.deepEqual(firstWrites.map(effect=>effect[1]),expectedAddresses);
    const first=f.cpu.esp,prior=expectedAddresses.map(address=>
      [address,f.memory.get(address)]);
    const before=f.cpu._snapshotInstruction(),start=f.effects.length;
    assert.throws(()=>f.cpu.step(),error=>error instanceof I80386Fault&&
      error.vector===12);
    assert.deepEqual(f.cpu._snapshotInstruction(),before);
    assert.deepEqual(f.effects.slice(start),[['fetch',1]]);
    assert.equal(f.cpu.esp,first);
    assert.deepEqual(expectedAddresses.map(address=>
      [address,f.memory.get(address)]),prior);
    assert.equal(f.cpu.eip,1);
    assert.equal(f.cpu.eflags,mode==='vm86'?0x23002:0x202);
  });
