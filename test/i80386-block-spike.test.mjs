import test from 'node:test';
import assert from 'node:assert/strict';
import {createI80386BlockSpike} from '../src/experimental/i80386-block-spike.js';
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
