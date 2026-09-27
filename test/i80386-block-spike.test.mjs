import test from 'node:test';
import assert from 'node:assert/strict';
import {createI80386BlockSpike} from '../src/experimental/i80386-block-spike.js';
import {createI80386RamBridge} from '../src/experimental/i80386-ram-bridge.js';
import {prevalidateI80386ReadWindow,isI80386ReadWindowValid} from
  '../src/experimental/i80386-read-window.js';
import {ExperimentalI80386ATMachine,
  PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP} from '../src/experimental/i80386-at-machine.js';
import I80386 from '../src/experimental/i80386.js';

test('static WASM bridge executes multiple safe guest instructions per call',async()=>{
  const bridge=await createI80386BlockSpike();
  bridge.setState({regs:[0x1234,0x1234,0,0,0,0,0,0]});
  bridge.setProgram([
    {op:1,dst:3,src:0,width:32,length:2}, // MOV EBX,EAX
    {op:2,dst:3,src:1,width:32,length:2}, // CMP EBX,ECX
    {op:3,dst:3,src:1,width:32,length:2}, // TEST EBX,ECX
  ]);
  assert.deepEqual(bridge.run(0,3,2),{reason:'event',completed:2});
  assert.deepEqual([bridge.state().eip,bridge.state().cycles],[4,2]);
  assert.deepEqual(bridge.run(2,3,1),{reason:'done',completed:1});

  const code=Uint8Array.of(0x89,0xc3,0x39,0xcb,0x85,0xcb);
  const cpu=new I80386({read:a=>code[a]??0,fetch:a=>code[a]??0,write(){}});
  cpu.segmentCaches[1]={base:0,limit:0xffffffff,default32:true,
    present:true,code:true,readable:true,writable:false};
  cpu.eax=cpu.ecx=0x1234;
  cpu.step();cpu.step();cpu.step();
  const state=bridge.state();
  assert.deepEqual([state.regs[0],state.regs[1],state.regs[3],state.eip,state.eflags,state.cycles],
    [cpu.eax,cpu.ecx,cpu.ebx,cpu.eip,cpu.eflags,cpu.cycles]);
});

test('event horizon and fault boundary stop before the next guest instruction',async()=>{
  const bridge=await createI80386BlockSpike();
  bridge.setState({regs:[0x12345678,0,0,0xabcd0000,0,0,0,0],eip:0x100,cycles:9});
  bridge.setProgram([
    {op:1,dst:3,src:0,width:16,length:2},
    {op:0,width:32,length:1},
    {op:255}, // JS interpreter must handle the faulting instruction.
    {op:1,dst:1,src:0,width:32,length:2},
  ]);
  assert.deepEqual(bridge.run(0,4,0),{reason:'event',completed:0});
  assert.deepEqual(bridge.run(0,4,2),{reason:'event',completed:2});
  assert.deepEqual(bridge.state(),{
    regs:[0x12345678,0,0,0xabcd5678,0,0,0,0],eip:0x103,eflags:2,cycles:11});
  assert.deepEqual(bridge.run(2,4,10),{reason:'fault-boundary',completed:0});
  assert.equal(bridge.state().regs[1],0,'later instruction did not run');
  bridge.setProgram([{op:254}]);
  assert.deepEqual(bridge.run(0,1,10),{reason:'unsupported',completed:0});
});

test('bounded CMP/TEST flag results match the JS 386 at both operand widths',async()=>{
  const bridge=await createI80386BlockSpike();
  let seed=0x386c0de;
  const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(const width of [16,32]) for(const op of [2,3]) for(let i=0;i<64;i++) {
    const eax=next(),ebx=next(),length=width===16?3:2;
    bridge.setState({regs:[eax,0,0,ebx,0,0,0,0],eflags:0x202});
    bridge.setProgram([{op,dst:3,src:0,width,length}]);
    assert.deepEqual(bridge.run(0,1,1),{reason:'done',completed:1});
    const code=width===16
      ? Uint8Array.of(0x66,op===2?0x39:0x85,0xc3)
      : Uint8Array.of(op===2?0x39:0x85,0xc3);
    const cpu=new I80386({read:a=>code[a]??0,fetch:a=>code[a]??0,write(){}});
    cpu.segmentCaches[1]={base:0,limit:0xffffffff,default32:true,
      present:true,code:true,readable:true,writable:false};
    cpu.eax=eax;cpu.ebx=ebx;cpu.eflags=0x202;cpu.step();
    const s=bridge.state();
    assert.deepEqual([s.regs[0],s.regs[3],s.eflags,s.eip,s.cycles],
      [cpu.eax,cpu.ebx,cpu.eflags,cpu.eip,cpu.cycles]);
  }
});

test('linked conditional branch loops stop at the event budget and match the JS 386',async()=>{
  const bridge=await createI80386BlockSpike();
  bridge.setState({regs:[1,2,0,0,0,0,0,0]});
  bridge.setProgram([
    {op:2,dst:0,src:1,width:32,length:2}, // CMP EAX,ECX
    {op:5,dst:0,src:0,width:32,length:2}, // JNZ back to EIP 0
  ]);
  assert.deepEqual(bridge.run(0,2,5),{reason:'event',completed:5});
  const code=Uint8Array.of(0x39,0xc8,0x75,0xfc);
  const cpu=new I80386({read:a=>code[a]??0,fetch:a=>code[a]??0,write(){}});
  cpu.segmentCaches[1]={base:0,limit:0xffffffff,default32:true,
    present:true,code:true,readable:true,writable:false};
  cpu.eax=1;cpu.ecx=2;
  for(let i=0;i<5;i++)cpu.step();
  const state=bridge.state();
  assert.deepEqual([state.eip,state.eflags,state.cycles],
    [cpu.eip,cpu.eflags,cpu.cycles]);

  bridge.setState({regs:[2,2,0,0,0,0,0,0]});
  assert.deepEqual(bridge.run(0,2,5),{reason:'done',completed:2});
  assert.equal(bridge.state().eip,4);
  bridge.setProgram([{op:6,dst:9,src:0,length:2}]);
  assert.deepEqual(bridge.run(0,1,5),{reason:'unsupported',completed:0});
  assert.throws(()=>bridge.run(0,1,65),RangeError);
});

test('prevalidated physical load reads live shared AT RAM without copying',async()=>{
  const machine=new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP);
  const ramBridge=await createI80386RamBridge();
  ramBridge.attach(machine);
  const bridge=await createI80386BlockSpike({ramBridge});
  assert.equal(bridge.memory,ramBridge.memory);
  assert.equal(bridge.ram,ramBridge.ram);
  const physical=0x120000;
  const code=Uint8Array.of(0x8b,0x05,0,0,0x12,0);
  bridge.ram.set(code,0);
  for(let i=0;i<4;i++)machine._write386(physical+i,[0x78,0x56,0x34,0x12][i]);
  bridge.setState({regs:[0,0,0,0,0,0,0,0]});
  bridge.setProgram([{op:7,dst:0,src:physical,width:32,length:6}]);
  assert.deepEqual(bridge.run(0,1,1),{reason:'done',completed:1});
  const cpu=new I80386({read:a=>bridge.ram[a]??0,fetch:a=>bridge.ram[a]??0,write(){}});
  cpu.segmentCaches[1]={base:0,limit:0xffffffff,default32:true,
    present:true,code:true,readable:true,writable:false};
  cpu.segmentCaches[3]={base:0,limit:0xffffffff,default32:true,
    present:true,code:false,readable:true,writable:true};
  cpu.step();
  assert.deepEqual([bridge.state().regs[0],bridge.state().eip,bridge.state().cycles],
    [cpu.eax,cpu.eip,cpu.cycles]);
  machine._write(physical,0xab); // Host and DMA ingress changes the same bytes.
  bridge.setState({regs:[0xdead0000,0,0,0,0,0,0,0]});
  bridge.setProgram([{op:7,dst:0,src:physical,width:16,length:6}]);
  assert.deepEqual(bridge.run(0,1,1),{reason:'done',completed:1});
  assert.equal(bridge.state().regs[0],0xdead56ab);
  bridge.setProgram([{op:7,dst:0,src:(1<<24)-2,width:32,length:6}]);
  const before=bridge.state();
  assert.deepEqual(bridge.run(0,1,1),{reason:'unsupported',completed:0});
  assert.deepEqual(bridge.state(),before);
});

test('shared load and linked branch observe a host write after an event exit',async()=>{
  const bridge=await createI80386BlockSpike();
  const physical=0x120000;
  bridge.ram.set(Uint8Array.of(0x8b,0x05,0,0,0x12,0,0x39,0xd8,0x75,0xf6),0);
  bridge.ram.set(Uint8Array.of(0x79,0x56,0x34,0x12),physical);
  bridge.setState({regs:[0,0,0,0x12345678,0,0,0,0]});
  bridge.setProgram([
    {op:7,dst:0,src:physical,width:32,length:6},
    {op:2,dst:0,src:3,width:32,length:2},
    {op:5,dst:0,src:0,length:2},
  ]);
  const cpu=new I80386({read:a=>bridge.ram[a]??0,fetch:a=>bridge.ram[a]??0,write(){}});
  cpu.segmentCaches[1]={base:0,limit:0xffffffff,default32:true,
    present:true,code:true,readable:true,writable:false};
  cpu.segmentCaches[3]={base:0,limit:0xffffffff,default32:true,
    present:true,code:false,readable:true,writable:true};
  cpu.ebx=0x12345678;
  assert.deepEqual(bridge.run(0,3,3),{reason:'event',completed:3});
  for(let i=0;i<3;i++)cpu.step();
  assert.deepEqual([bridge.state().eip,bridge.state().eflags],
    [cpu.eip,cpu.eflags]);
  bridge.ram[physical]=0x78; // A host or DMA write becomes visible on retry.
  assert.deepEqual(bridge.run(0,3,3),{reason:'done',completed:3});
  for(let i=0;i<3;i++)cpu.step();
  assert.deepEqual([bridge.state().regs[0],bridge.state().eip,
    bridge.state().eflags,bridge.state().cycles],
  [cpu.eax,cpu.eip,cpu.eflags,cpu.cycles]);
});

test('dynamic SIB address loads and LEA match the 386 within a safe RAM window',async()=>{
  const bridge=await createI80386BlockSpike();
  bridge.ram.set(Uint8Array.of(0x8b,0x44,0x8b,0x10,0x8d,0x54,0x8b,0x10),0);
  bridge.ram.set(Uint8Array.of(0x78,0x56,0x34,0x12),0x120018);
  bridge.ram.set(Uint8Array.of(0xef,0xcd,0xab,0x90),0x12001c);
  const program=[
    {op:8,dst:0,width:32,length:4,base:3,index:1,scale:2,disp:16,
      lo:0x120000,hi:0x121000},
    {op:9,dst:2,width:32,length:4,base:3,index:1,scale:2,disp:16},
  ];
  bridge.setProgram(program);
  const cpu=new I80386({read:a=>bridge.ram[a]??0,fetch:a=>bridge.ram[a]??0,write(){}});
  cpu.segmentCaches[1]={base:0,limit:0xffffffff,default32:true,
    present:true,code:true,readable:true,writable:false};
  cpu.segmentCaches[3]={base:0,limit:0xffffffff,default32:true,
    present:true,code:false,readable:true,writable:true};
  for(const index of [2,3]) {
    bridge.setState({regs:[0,index,0,0x120000,0,0,0,0]});
    cpu.eip=0;cpu.eax=cpu.edx=0;cpu.ecx=index;cpu.ebx=0x120000;cpu.cycles=0;
    assert.deepEqual(bridge.run(0,2,2),{reason:'done',completed:2});
    cpu.step();cpu.step();
    assert.deepEqual([bridge.state().regs[0],bridge.state().regs[2],
      bridge.state().eip,bridge.state().cycles],
    [cpu.eax,cpu.edx,cpu.eip,cpu.cycles]);
  }
  bridge.setState({regs:[0xdeadbeef,0x400,0,0x120000,0,0,0,0]});
  const before=bridge.state();
  assert.deepEqual(bridge.run(0,2,2),{reason:'unsupported',completed:0});
  assert.deepEqual(bridge.state(),before);
});

test('host-validated high virtual page maps a dynamic load to physical RAM',async()=>{
  const bridge=await createI80386BlockSpike();
  const put32=(address,value)=>{
    for(let i=0;i<4;i++)bridge.ram[address+i]=(value>>>(8*i))&255;
  };
  const virtualBase=0x80120000, physicalBase=0x120000;
  put32(0x1000,0x2007); // Virtual code page zero -> physical 3000h.
  put32(0x2000,0x3007);
  const directoryIndex=virtualBase>>>22;
  const tableIndex=(virtualBase>>>12)&1023;
  put32(0x1000+directoryIndex*4,0x4007);
  put32(0x4000+tableIndex*4,physicalBase|7);
  bridge.ram.set(Uint8Array.of(0x8b,0x44,0x8b,0x10,0x8d,0x54,0x8b,0x10),0x3000);
  bridge.ram.set(Uint8Array.of(0x78,0x56,0x34,0x12),physicalBase+24);
  bridge.setState({regs:[0,2,0,virtualBase,0,0,0,0]});
  bridge.setProgram([
    {op:8,dst:0,width:32,length:4,base:3,index:1,scale:2,
      disp:0x80000010,lo:physicalBase,hi:physicalBase+0x1000},
    {op:9,dst:2,width:32,length:4,base:3,index:1,scale:2,disp:16},
  ]);
  const cpu=new I80386({
    read:a=>bridge.ram[a]??0,fetch:a=>bridge.ram[a]??0,
    write:(a,v)=>{bridge.ram[a]=v&255;},
  });
  cpu.segmentCaches[1]={base:0,limit:0xffffffff,default32:true,
    present:true,code:true,readable:true,writable:false};
  cpu.segmentCaches[3]={base:0,limit:0xffffffff,default32:true,
    present:true,code:false,readable:true,writable:true};
  cpu.cr0=0x80000001;cpu.cr3=0x1000;cpu.ebx=virtualBase;cpu.ecx=2;
  assert.deepEqual(bridge.run(0,2,2),{reason:'done',completed:2});
  cpu.step();cpu.step();
  assert.deepEqual([bridge.state().regs[0],bridge.state().regs[2],
    bridge.state().eip,bridge.state().cycles],
  [cpu.eax,cpu.edx,cpu.eip,cpu.cycles]);
  assert.equal(cpu.eax,0x12345678);
  assert.equal(cpu.edx,virtualBase+24);
});

test('read window uses an existing TLB mapping and rejects page-table changes',async()=>{
  const machine=new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP);
  const ramBridge=await createI80386RamBridge();
  ramBridge.attach(machine);
  const native=await createI80386BlockSpike({ramBridge});
  const cpu=machine.cpu, virtualBase=0x80120000, linear=virtualBase+24;
  const put32=(address,value)=>{
    for(let i=0;i<4;i++)machine._write386(address+i,(value>>>(8*i))&255);
  };
  cpu.segmentCaches[3]={base:0,limit:0xffffffff,default32:true,
    present:true,code:false,readable:true,writable:true};
  cpu.cr0=0x80000001;cpu.cr3=0x1000;
  put32(0x1800,0x4007); // PDE for virtual 80120000h.
  const pte=0x4000+(((virtualBase>>>12)&1023)*4);
  put32(pte,0x120007);
  const generationBefore=cpu._translationGeneration;
  assert.equal(prevalidateI80386ReadWindow(machine,linear),null,
    'speculative prevalidation must not walk an uncached page');
  assert.equal(cpu._translationGeneration,generationBefore);
  assert.equal(native.ram[pte]&0x20,0,'prevalidation did not set PTE accessed');
  assert.equal(cpu.cr2,0,'prevalidation did not deliver an early page fault');
  assert.equal(cpu._translate(linear),0x120018);
  const window=prevalidateI80386ReadWindow(machine,linear);
  assert.equal(window?.delta,0x80000000);
  assert.equal(isI80386ReadWindowValid(window),true);
  native.ram.set(Uint8Array.of(0x78,0x56,0x34,0x12),0x120018);
  native.setState({regs:[0,2,0,virtualBase,0,0,0,0]});
  native.setProgram([{op:8,dst:0,width:32,length:4,base:3,index:1,scale:2,
    disp:(window.delta+16)>>>0,lo:window.lo,hi:window.hi}]);
  assert.deepEqual(native.run(0,1,1),{reason:'done',completed:1});
  assert.equal(native.state().regs[0],0x12345678);
  put32(pte,0x130007); // The board's write ingress invalidates the TLB.
  assert.equal(isI80386ReadWindowValid(window),false);
  assert.equal(prevalidateI80386ReadWindow(machine,linear),null);
  assert.equal(cpu._translate(linear),0x130018);
  const remapped=prevalidateI80386ReadWindow(machine,linear);
  assert.equal(isI80386ReadWindowValid(remapped),true);
  native.ram.set(Uint8Array.of(0xef,0xcd,0xab,0x90),0x130018);
  native.setState({regs:[0,2,0,virtualBase,0,0,0,0]});
  native.setProgram([{op:8,dst:0,width:32,length:4,base:3,index:1,scale:2,
    disp:(remapped.delta+16)>>>0,lo:remapped.lo,hi:remapped.hi}]);
  assert.deepEqual(native.run(0,1,1),{reason:'done',completed:1});
  assert.equal(native.state().regs[0],0x90abcdef);
  machine._a20Enabled=false;
  assert.equal(isI80386ReadWindowValid(remapped),false);
});

test('a later out-of-window load exits after earlier native retirement',async()=>{
  const bridge=await createI80386BlockSpike();
  bridge.setState({regs:[0x12345678,0,0xdeadbeef,0x121000,0,0,0,0],
    eip:0x100,eflags:0x202,cycles:9});
  bridge.setProgram([
    {op:1,dst:1,src:0,width:32,length:2},
    {op:8,dst:2,width:32,length:4,base:3,index:8,scale:0,disp:0,
      lo:0x120000,hi:0x121000},
    {op:9,dst:0,width:32,length:4,base:3,index:8,scale:0,disp:0},
  ]);
  assert.deepEqual(bridge.run(0,3,3),{reason:'unsupported',completed:1});
  assert.deepEqual(bridge.state(),{
    regs:[0x12345678,0x12345678,0xdeadbeef,0x121000,0,0,0,0],
    eip:0x102,eflags:0x202,cycles:10});
});
