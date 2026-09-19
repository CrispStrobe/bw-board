import test from 'node:test';
import assert from 'node:assert/strict';
import ProtectedI80286,{ProtectedModeFault,SEG_DS}from'../src/experimental/i80286-protected.js';

function fixture(program){
  const mem=new Map(),writes=[];
  const cpu=new ProtectedI80286({read:a=>mem.get(a)??0,fetch:a=>mem.get(a)??0,write:(a,v)=>{writes.push([a,v&255]);mem.set(a,v&255);}});
  const put=(a,b)=>b.forEach((v,i)=>mem.set(a+i,v));
  const desc=(a,base,limit,access)=>put(a,[limit&255,limit>>8,base&255,base>>8&255,base>>16&255,access,0,0]);
  put(0,[0x0f,1,0x16,0,1,0xb8,1,0,0x0f,1,0xf0,0xea,0,0,8,0]);put(0x100,[0x2f,0,0,2,0]);
  desc(0x208,0x100000,0xffff,0x9a);desc(0x210,0x120000,0xffff,0x92);desc(0x218,0x130000,0xffff,0x92);
  desc(0x220,0x400,0x0f,0x82);desc(0x228,0x500,0x2b,0x81);desc(0x400,0x150000,0xffff,0xf2);
  put(0x100000,[0xb8,0x10,0,0x8e,0xd8,0xb8,0x18,0,0x8e,0xd0,0xbc,0,2,...program]);
  cpu.cs=0;cpu.ip=0;for(let i=0;i<9;i++)cpu.step();return{cpu,mem,writes,put,desc};
}

test('LLDT/LTR cache system descriptors, set TSS busy, and expose SLDT/STR',()=>{
  const f=fixture([0xb8,0x20,0,0x0f,0,0xd0,0xb8,0x28,0,0x0f,0,0xd8,
    0x0f,0,0xc3,0x0f,0,0xc9,0xf4]);
  while(!f.cpu.halted)f.cpu.step();
  assert.deepEqual(f.cpu.ldtr,{selector:0x20,valid:true,base:0x400,limit:0x0f});
  assert.deepEqual(f.cpu.tr,{selector:0x28,valid:true,base:0x500,limit:0x2b});
  assert.equal(f.mem.get(0x22d),0x83);assert.equal(f.cpu.bx,0x20);assert.equal(f.cpu.cx,0x28);
});

test('LDT index zero is usable and null DS becomes unusable until reloaded',()=>{
  const f=fixture([0xb8,0x20,0,0x0f,0,0xd0,0xb8,4,0,0x8e,0xd8,0xa1,0,0,
    0xb8,0,0,0x8e,0xd8,0xa1,0,0]);f.mem.set(0x150000,0x34);f.mem.set(0x150001,0x12);
  for(let i=0;i<5;i++)f.cpu.step();assert.equal(f.cpu.ax,0x1234);assert.equal(f.cpu.ds,4);
  f.cpu.step();f.cpu.step();assert.equal(f.cpu.segmentCaches[SEG_DS].usable,false);
  assert.throws(()=>f.cpu.step(),e=>e instanceof ProtectedModeFault&&e.vector===13&&e.errorCode===0);
});

test('LLDT and LTR retain ignored selector RPL bits in their visible registers',()=>{
  const f=fixture([0xb8,0x23,0,0x0f,0,0xd0,0xb8,0x2b,0,0x0f,0,0xd8]);
  for(let i=0;i<4;i++)f.cpu.step();
  assert.equal(f.cpu.ldtr.selector,0x23);assert.equal(f.cpu.tr.selector,0x2b);
});

test('LTR rejects busy TSS and LLDT privilege failures atomically',()=>{
  const busy=fixture([0xb8,0x28,0,0x0f,0,0xd8]);busy.mem.set(0x22d,0x83);
  busy.cpu.step();const busyState=busy.cpu.getProtectedState(),busyWrites=busy.writes.length;
  assert.throws(()=>busy.cpu.step(),e=>e instanceof ProtectedModeFault&&e.vector===13);
  assert.deepEqual(busy.cpu.getProtectedState(),busyState);assert.equal(busy.writes.length,busyWrites);
  const user=fixture([0xb8,0x20,0,0x0f,0,0xd0]);user.cpu.step();user.cpu.cpl=3;
  const state=user.cpu.getProtectedState();assert.throws(()=>user.cpu.step(),e=>e instanceof ProtectedModeFault&&e.vector===13&&e.errorCode===0);
  assert.deepEqual(user.cpu.getProtectedState(),state);
});

test('guest IRET enters ring 3, LDT data works, and INT uses the TSS ring-0 stack',()=>{
  const mem=new Map();const put=(a,b)=>b.forEach((v,i)=>mem.set(a+i,v));
  const desc=(a,base,limit,access)=>put(a,[limit&255,limit>>8,base&255,base>>8&255,base>>16&255,access,0,0]);
  const cpu=new ProtectedI80286({read:a=>mem.get(a)??0,fetch:a=>mem.get(a)??0,write:(a,v)=>mem.set(a,v&255)},{deliverProtectedFaults:true});
  put(0,[0x0f,1,0x16,0,1,0x0f,1,0x1e,5,1,0xb8,1,0,0x0f,1,0xf0,0xea,0,0,8,0]);
  put(0x100,[0x37,0,0,2,0,0xff,1,0,3,0]);
  desc(0x208,0x100000,0xffff,0x9a);desc(0x210,0x120000,0xffff,0x92);desc(0x218,0x130000,0xffff,0x92);
  desc(0x220,0x400,0x0f,0x82);desc(0x228,0x500,0x2b,0x81);desc(0x230,0x180000,0xffff,0xf2);
  desc(0x400,0x160000,0xffff,0xfa);desc(0x408,0x170000,0xffff,0xf2);put(0x500+2,[0,3,0x18,0]);
  for(const[vector,offset]of[[0x30,0x100],[0x31,0x120]])put(0x300+vector*8,[offset&255,offset>>8,8,0,0,0xe6,0,0]);
  put(0x100000,[0xb8,0x18,0,0x8e,0xd0,0xbc,0,4,0xb8,0x20,0,0x0f,0,0xd0,
    0xb8,0x28,0,0x0f,0,0xd8,0x68,0x33,0,0x68,0,1,0x68,2,2,0x68,7,0,0x68,0,0,0xcf]);
  put(0x100100,[0xcf]);put(0x100120,[0xf4]);
  put(0x160000,[0xb8,0x0f,0,0x8e,0xd8,0xa1,0,0,0xcd,0x30,0xcd,0x31]);put(0x170000,[0x34,0x12]);
  Object.assign(cpu,{cs:0,ip:0,ds:0,es:0,ss:0,sp:0x100,flags:2});
  let sawInner=false,sawUserReturn=false;
  for(let i=0;i<80&&!cpu.halted;i++){
    cpu.step();
    if(cpu.cpl===0&&cpu.ip===0x100){sawInner=true;
      assert.equal(cpu.sp,0x2f6);assert.equal(mem.get(0x1302fe)|(mem.get(0x1302ff)<<8),0x33);
      assert.equal(mem.get(0x1302fc)|(mem.get(0x1302fd)<<8),0x100);
    }
    if(sawInner&&cpu.cpl===3&&cpu.ip===10)sawUserReturn=true;
  }
  assert.equal(cpu.halted,true);assert.equal(cpu.cpl,0);assert.equal(cpu.ax,0x1234);
  assert.equal(sawInner,true);assert.equal(sawUserReturn,true);
});
