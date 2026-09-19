import test from 'node:test';
import assert from 'node:assert/strict';
import ProtectedI80286,{SEG_CS,SEG_DS,SEG_SS}from'../src/experimental/i80286-protected.js';

function fixture(){
  const mem=new Map(),cpu=new ProtectedI80286({read:a=>mem.get(a)??0,fetch:a=>mem.get(a)??0,write:(a,v)=>mem.set(a,v&255)});
  const put=(a,b)=>b.forEach((v,i)=>mem.set(a+i,v));
  const desc=(a,base,access,limit=0xffff)=>put(a,[limit&255,limit>>8,base&255,base>>8&255,base>>16&255,access,0,0]);
  put(0,[0x0f,1,0x16,0,1,0xb8,1,0,0x0f,1,0xf0,0xea,0,0,8,0]);put(0x100,[0x37,0,0,2,0]);
  desc(0x208,0x100000,0x9a);desc(0x210,0x120000,0x92);desc(0x218,0x130000,0x92);
  desc(0x220,0x140000,0xfa);desc(0x228,0x150000,0xf2);desc(0x230,0x160000,0xf2);
  cpu.cs=0;cpu.ip=0;for(let i=0;i<5;i++)cpu.step();
  return{cpu,mem,put,desc};
}

test('same-ring immediate far CALL and RET preserve CS:IP and stack',()=>{
  const f=fixture();f.put(0x100000,[0x9a,0x10,0,8,0,0xf4]);f.put(0x100010,[0xcb]);
  f.cpu.ip=0;f.cpu.ss=0x18;f.cpu.segmentCaches[SEG_SS]=f.cpu._descriptor(0x18,SEG_SS);f.cpu.sp=0x200;
  f.cpu.step();assert.deepEqual([f.cpu.cs,f.cpu.ip,f.cpu.sp],[8,0x10,0x1fc]);
  assert.deepEqual([f.cpu._rd16(SEG_SS,0x1fc),f.cpu._rd16(SEG_SS,0x1fe)],[5,8]);
  f.cpu.step();assert.deepEqual([f.cpu.cs,f.cpu.ip,f.cpu.sp],[8,5,0x200]);
});

test('DPL3 call gate copies parameters to ring0 and RETF imm returns to outer stack',()=>{
  const f=fixture();
  // Gate at selector 30h: offset 0100h, target ring0 CS 8, two parameter words, DPL3 present type4.
  f.put(0x230,[0,1,8,0,2,0xe4,0,0]);f.put(0x100100,[0xca,4,0]);
  f.put(0x140000,[0x9a,0,0,0x33,0,0xf4]);
  f.cpu.cpl=3;f.cpu.segmentCaches[SEG_CS]=f.cpu._descriptor(0x23,SEG_CS,{privilegeCpl:3});f.cpu.cs=0x23;f.cpu.ip=0;
  f.cpu.segmentCaches[SEG_SS]=f.cpu._descriptor(0x2b,SEG_SS,{privilegeCpl:3});f.cpu.ss=0x2b;f.cpu.sp=0x200;
  f.cpu.tr={selector:0x38,valid:true,base:0x160000,limit:0x2b};f.put(0x160002,[0,2,0x18,0]);
  f.cpu._wr16(SEG_SS,0x200,0x1111);f.cpu._wr16(SEG_SS,0x202,0x2222);
  f.cpu.step();assert.deepEqual([f.cpu.cpl,f.cpu.cs,f.cpu.ip,f.cpu.ss,f.cpu.sp],[0,8,0x100,0x18,0x1f4]);
  assert.deepEqual(Array.from({length:6},(_,i)=>f.cpu._rd16(SEG_SS,0x1f4+i*2)),[5,0x23,0x1111,0x2222,0x200,0x2b]);
  f.cpu.step();assert.deepEqual([f.cpu.cpl,f.cpu.cs,f.cpu.ip,f.cpu.ss,f.cpu.sp],[3,0x23,5,0x2b,0x204]);
});

test('call gate privilege and frame limits fault before changing registers or RAM',()=>{
  const f=fixture();f.put(0x230,[0,1,8,0,0,0x84,0,0]); // DPL0 gate
  f.cpu.cpl=3;f.cpu.segmentCaches[SEG_CS]=f.cpu._descriptor(0x23,SEG_CS,{privilegeCpl:3});f.cpu.cs=0x23;f.cpu.ip=0;
  const before=f.cpu.getProtectedState(),mem=new Map(f.mem);
  assert.throws(()=>f.cpu._farTransfer(0,0x33,true),e=>e.vector===13&&e.errorCode===0x30);
  assert.deepEqual(f.cpu.getProtectedState(),before);assert.deepEqual(f.mem,mem);
});
