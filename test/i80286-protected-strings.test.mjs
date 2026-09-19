import test from 'node:test';
import assert from 'node:assert/strict';
import ProtectedI80286, {ProtectedModeFault,SEG_CS,SEG_DS,SEG_ES,SEG_SS} from '../src/experimental/i80286-protected.js';

function fixture(options={}) {
  const mem=new Map(),reads=[],writes=[];
  const cpu=new ProtectedI80286({
    read:a=>{reads.push(a);return mem.get(a)??0;},
    fetch:a=>mem.get(a)??0,
    write:(a,v)=>{writes.push([a,v&255]);mem.set(a,v&255);},
    in:options.in,out:options.out,intPending:options.intPending,
  });
  const put=(a,b)=>b.forEach((v,i)=>mem.set(a+i,v));
  const desc=(a,base,limit,access)=>put(a,[limit&255,limit>>8,base&255,base>>8&255,base>>16&255,access,0,0]);
  return{cpu,mem,reads,writes,put,desc};
}

function boot(f,program,{dsLimit=0xffff,esAccess=0x92}={}) {
  f.put(0,[0x0f,1,0x16,0,1,0xb8,1,0,0x0f,1,0xf0,0xea,0,0,8,0]);
  f.put(0x100,[0x27,0,0,2,0]);
  f.desc(0x208,0x100000,0xffff,0x9a);f.desc(0x210,0x120000,dsLimit,0x92);
  f.desc(0x218,0x130000,0xffff,0x92);f.desc(0x220,0x140000,0xffff,esAccess);
  f.put(0x100000,[0xb8,0x10,0,0x8e,0xd8,0xb8,0x18,0,0x8e,0xd0,
    0xb8,0x20,0,0x8e,0xc0,0xbc,0,2,...program]);
  f.cpu.cs=0;f.cpu.ip=0;for(let i=0;i<11;i++)f.cpu.step();
  assert.equal(f.cpu.segmentCaches[SEG_DS].base,0x120000);
  assert.equal(f.cpu.segmentCaches[SEG_ES].base,0x140000);
  assert.equal(f.cpu.segmentCaches[SEG_SS].base,0x130000);
}

test('REP MOVSW commits one interruptible iteration per step and retains prefix IP',()=>{
  const f=fixture();boot(f,[0xf3,0xa5,0xf4]);
  Object.assign(f.cpu,{si:0x10,di:0x20,cx:3});
  for(let i=0;i<6;i++)f.mem.set(0x120010+i,0x40+i);
  const prefix=f.cpu.ip;
  f.cpu.step();assert.deepEqual([f.cpu.ip,f.cpu.cx,f.cpu.si,f.cpu.di],[prefix,2,0x12,0x22]);
  assert.deepEqual([f.mem.get(0x140020),f.mem.get(0x140021)],[0x40,0x41]);
  f.cpu.step();assert.deepEqual([f.cpu.ip,f.cpu.cx],[prefix,1]);
  f.cpu.step();assert.deepEqual([f.cpu.ip,f.cpu.cx,f.cpu.si,f.cpu.di],[prefix+2,0,0x16,0x26]);
});

test('a later REP fault preserves completed iterations and restarts at the prefix',()=>{
  const f=fixture();boot(f,[0xf3,0xa5],{dsLimit:0x11});
  Object.assign(f.cpu,{si:0x10,di:0x20,cx:2});f.mem.set(0x120010,0xaa);f.mem.set(0x120011,0xbb);
  const prefix=f.cpu.ip;f.cpu.step();
  const completed=f.cpu.getProtectedState(),writes=f.writes.length;
  assert.throws(()=>f.cpu.step(),e=>e instanceof ProtectedModeFault&&e.vector===13&&e.restartIp===prefix);
  assert.deepEqual(f.cpu.getProtectedState(),completed);assert.equal(f.writes.length,writes);
  assert.deepEqual([f.mem.get(0x140020),f.mem.get(0x140021)],[0xaa,0xbb]);
});

test('a faulting MOVS iteration preflights its destination before reading source data',()=>{
  const f=fixture();boot(f,[0xa5],{esAccess:0x90});Object.assign(f.cpu,{si:0x10,di:0x20});
  f.mem.set(0x120010,0x34);f.mem.set(0x120011,0x12);const reads=f.reads.length;
  assert.throws(()=>f.cpu.step(),e=>e instanceof ProtectedModeFault&&e.vector===13);
  assert.ok(!f.reads.slice(reads).includes(0x120010));
});

test('REP with CX zero performs no operand access and advances past the instruction',()=>{
  const f=fixture();boot(f,[0xf3,0xa5]);Object.assign(f.cpu,{si:0x10,di:0x20,cx:0});
  const reads=f.reads.length,writes=f.writes.length,start=f.cpu.ip;f.cpu.step();
  assert.equal(f.cpu.ip,start+2);assert.equal(f.reads.length,reads);assert.equal(f.writes.length,writes);
});

test('DF, source override, REPE CMPS and REPNE SCAS update indices and termination flags',()=>{
  const f=fixture();boot(f,[0xfd,0x36,0xf3,0xa6,0xfc,0xf2,0xae]);
  Object.assign(f.cpu,{si:0x22,di:0x22,cx:2,ax:0x55});
  f.mem.set(0x130022,0x33);f.mem.set(0x140022,0x33);f.cpu.step();f.cpu.step();
  assert.deepEqual([f.cpu.si,f.cpu.di,f.cpu.cx],[0x21,0x21,1]);assert.ok(f.cpu.flags&0x40);
  f.mem.set(0x130021,0x44);f.mem.set(0x140021,0x22);f.cpu.step();
  assert.deepEqual([f.cpu.si,f.cpu.di,f.cpu.cx],[0x20,0x20,0]);assert.ok(!(f.cpu.flags&0x40));
  f.cpu.step();
  f.cpu.cx=2;f.cpu.di=0x30;f.mem.set(0x140030,0x44);f.mem.set(0x140031,0x55);
  f.cpu.step();assert.deepEqual([f.cpu.di,f.cpu.cx],[0x31,1]);
  f.cpu.step();assert.deepEqual([f.cpu.di,f.cpu.cx],[0x32,0]);assert.ok(f.cpu.flags&0x40);
});

test('pending interrupt leaves REP at its prefix and MOV SS shadow covers all iterations',()=>{
  let pending=true;const f=fixture({intPending:()=>pending});boot(f,[0xf3,0xa4]);
  Object.assign(f.cpu,{si:0x10,di:0x20,cx:2,flags:f.cpu.flags|0x200});f.mem.set(0x120010,1);f.mem.set(0x120011,2);
  const prefix=f.cpu.ip;assert.equal(f.cpu.step(),0);assert.deepEqual([f.cpu.ip,f.cpu.cx],[prefix,2]);
  f.cpu.intShadow=1;f.cpu.step();assert.deepEqual([f.cpu.ip,f.cpu.cx,f.cpu.intShadow],[prefix,1,1]);
  pending=false;f.cpu.step();assert.deepEqual([f.cpu.ip,f.cpu.cx,f.cpu.intShadow],[prefix+2,0,0]);
});

test('bounded flag, stack, exchange, unary, shift, and port forms execute in protected mode',()=>{
  const ports=[];const f=fixture({in:p=>p===0x21?0x5a:0,out:(p,v)=>ports.push([p,v])});
  boot(f,[0x68,0x34,0x12,0x58,0x6a,0xff,0x5b,0xf9,0xf5,0xfc,0xfd,
    0xb8,1,0,0xbb,2,0,0x93,0xf7,0xd8,0xd1,0xe0,0xe4,0x21,0xe6,0x22]);
  for(let i=0;i<15;i++)f.cpu.step();
  assert.equal(f.cpu.bx,1);assert.equal(f.cpu.ax&0xff,0x5a);assert.deepEqual(ports,[[0x22,0x5a]]);
});
