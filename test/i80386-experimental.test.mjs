import test from 'node:test';
import assert from 'node:assert/strict';
import I80386,{UnsupportedI80386} from '../src/experimental/i80386.js';

function fixture(){
  const mem=new Map(),reads=[],writes=[];
  const cpu=new I80386({read:a=>{reads.push(a>>>0);return mem.get(a>>>0)??0;},fetch:a=>mem.get(a>>>0)??0,
    write:(a,v)=>{writes.push([a>>>0,v&255]);mem.set(a>>>0,v&255);}});
  const put=(a,b)=>b.forEach((v,i)=>mem.set((a+i)>>>0,v));
  return{cpu,mem,reads,writes,put,word:a=>(mem.get(a)??0)|((mem.get(a+1)??0)<<8),
    dword:a=>((mem.get(a)??0)|((mem.get(a+1)??0)<<8)|((mem.get(a+2)??0)<<16)|((mem.get(a+3)??0)*0x1000000))>>>0};
}
function descriptor(base,access=0x9a){return[0xff,0xff,base&255,(base>>>8)&255,(base>>>16)&255,access,0xcf,(base>>>24)&255];}

test('owned real bytes enter 32-bit protected mode and execute SIB, stack, arithmetic, and near control flow',()=>{
  const f=fixture();
  f.put(0,[0x0f,0x01,0x16,0x00,0x01,0x0f,0x20,0xc0,0x66,0x83,0xc8,0x01,0x0f,0x22,0xc0,
    0x66,0xea,0,0,0,0,8,0]);
  f.put(0x100,[0x17,0,0,2,0,0]);f.put(0x208,descriptor(0x100000));f.put(0x210,descriptor(0x120000,0x92));
  f.put(0x100000,[
    0xb8,0x44,0x33,0x22,0x11, 0xbb,0x00,0x02,0,0, 0xb9,3,0,0,0,
    0xba,0x10,0,0,0, 0x8e,0xda, 0x8e,0xd2, 0xbc,0,4,0,0,
    0x89,0x44,0x8b,0x08, 0x83,0xc0,1, 0x50,0x5a,
    0x49,0x75,0xfd, 0xe8,1,0,0,0, 0xf4, 0x43,0xc3,
  ]);
  for(let i=0;i<80&&!f.cpu.halted;i++)f.cpu.step();
  assert.equal(f.cpu.halted,true);assert.equal(f.cpu.protectedMode,true);
  assert.equal(f.mem.get(0x20d),0x9b);assert.equal(f.mem.get(0x215),0x93,'protected segment loads set descriptor accessed bits');
  assert.deepEqual([f.cpu.cs,f.cpu.eip,f.cpu.eax,f.cpu.ebx,f.cpu.ecx,f.cpu.edx,f.cpu.esp],
    [8,47,0x11223345,0x201,0,0x11223345,0x400]);
  assert.equal(f.dword(0x120214),0x11223344,'32-bit SIB store uses DS base and scaled ECX');
});

test('register aliases preserve upper halves and operand/address overrides select independently',()=>{
  const f=fixture();f.cpu.eax=0x11223344;f.cpu.ax=0xabcd;assert.equal(f.cpu.eax,0x1122abcd);
  f.cpu.ah=0x55;f.cpu.al=0x66;assert.equal(f.cpu.eax,0x11225566);
  f.cpu.segmentCaches[1]={base:0,limit:0xffff,default32:true,present:true,code:true,writable:false};
  f.cpu.segmentCaches[3]={base:0,limit:0xffff,default32:false,present:true,code:false,writable:true};
  f.cpu.ebx=0x100;f.cpu.esi=4;f.put(0,[0x66,0x67,0x8b,0x00,0xf4]);f.put(0x104,[0x34,0x12]);
  f.cpu.step();assert.equal(f.cpu.eax,0x11221234);f.cpu.step();assert.equal(f.cpu.halted,true);

  const stack=fixture();stack.cpu.segmentCaches[1]={base:0,limit:0xffff,default32:true,present:true,code:true,writable:false};
  stack.cpu.segmentCaches[2]={base:0,limit:0x1ffff,default32:true,present:true,code:false,writable:true};
  stack.cpu.esp=0x10000;stack.cpu.eax=0x12345678;stack.put(0,[0x66,0x50]);stack.cpu.step();
  assert.equal(stack.cpu.esp,0xfffe,'SS.B controls stack addressing independently of 16-bit operand width');
  assert.deepEqual([stack.mem.get(0xfffe),stack.mem.get(0xffff)],[0x78,0x56]);

  const stack16=fixture();stack16.cpu.segmentCaches[1]={base:0,limit:0xffff,default32:true,present:true,code:true,writable:false};
  stack16.cpu.segmentCaches[2]={base:0x20000,limit:0xffff,default32:false,present:true,code:false,writable:true};
  stack16.cpu.esp=0x12340008;stack16.cpu.eax=0x89abcdef;stack16.put(0,[0x50]);stack16.cpu.step();
  assert.equal(stack16.cpu.esp,0x12340004,'B=0 updates SP while preserving the upper ESP half for a dword push');
  assert.equal(stack16.dword(0x20004),0x89abcdef);
  stack16.cpu.eip=0;stack16.cpu.esp=0x12340002;
  assert.throws(()=>stack16.cpu.step(),/segment limit/,'wrapped dword does not bypass the SS limit');

  const repeated=fixture();repeated.cpu.segmentCaches[1]={base:0,limit:0xffff,default32:true,present:true,code:true,writable:false};
  repeated.cpu.ebx=0x100;repeated.cpu.esi=4;repeated.put(0,[0x66,0x66,0xb8,0x34,0x12,0x67,0x67,0x8b,0]);
  repeated.put(0x104,[0x78,0x56,0x34,0x12]);repeated.cpu.step();assert.equal(repeated.cpu.eax,0x1234);
  repeated.cpu.step();assert.equal(repeated.cpu.eax,0x12345678,'repeated 67 remains one address-size override');
});

test('bounded system profile refuses paging and unsupported descriptors without partial mode claims',()=>{
  const f=fixture();f.put(0,[0x0f,0x22,0xc0]);f.cpu.eax=0x80000001;
  assert.throws(()=>f.cpu.step(),e=>e instanceof UnsupportedI80386&&/paging/.test(e.message));
  assert.equal(f.cpu.cr0,0);
});

test('near branch targets use post-displacement EIP and truncate for 16-bit operands',()=>{
  const short=fixture();short.cpu.segmentCaches[1]={base:0,limit:0xffff,default32:true,present:true,code:true,writable:false};
  short.put(0,[0xeb,2,0xf4,0xf4,0xb8,1,0,0,0]);short.cpu.step();assert.equal(short.cpu.eip,4,'EB is relative to the following instruction');

  for(const [bytes,setup,expected]of[
    [[0x66,0xe9,1,0],()=>{},5],
    [[0x66,0x75,1],cpu=>{cpu.eflags&=~0x40;},4],
  ]){
    const f=fixture();f.cpu.segmentCaches[1]={base:0,limit:0xffffffff,default32:true,present:true,code:true,writable:false};
    f.cpu.eip=0xffff0000;f.put(0xffff0000,bytes);setup(f.cpu);f.cpu.step();assert.equal(f.cpu.eip,expected);
  }
  const call=fixture();call.cpu.segmentCaches[1]={base:0,limit:0xffffffff,default32:true,present:true,code:true,writable:false};
  call.cpu.segmentCaches[2]={base:0,limit:0xffff,default32:true,present:true,code:false,writable:true};
  call.cpu.eip=0xffff0000;call.cpu.esp=0x100;call.put(0xffff0000,[0x66,0xe8,1,0]);call.cpu.step();
  assert.deepEqual([call.cpu.eip,call.cpu.esp,call.word(0xfe)],[5,0xfe,4]);

  const narrowCode=fixture();narrowCode.cpu.segmentCaches[1]={base:0,limit:0x1ffff,default32:false,present:true,code:true,writable:false};
  narrowCode.cpu.eip=0x10000;narrowCode.put(0x10000,[0x40,0xf4]);narrowCode.cpu.step();
  assert.equal(narrowCode.cpu.eip,0x10001,'CS.D=0 does not truncate sequential EIP in a large-limit segment');
  narrowCode.cpu.step();assert.equal(narrowCode.cpu.halted,true);

  const crossing=fixture();crossing.cpu.eip=0xffff;crossing.put(0xffff,[0x66]);
  assert.throws(()=>crossing.cpu.step(),/segment limit/,'real-mode instruction fetch does not wrap through offset zero');
});

test('LGDT width, descriptor boundaries, and instruction length fail explicitly',()=>{
  const narrow=fixture();narrow.put(0,[0x0f,1,0x16,0x20,0]);narrow.put(0x20,[0xff,0,0x78,0x56,0x34,0x12]);narrow.cpu.step();
  assert.deepEqual(narrow.cpu.gdtr,{limit:0xff,base:0x345678});
  const wide=fixture();wide.put(0,[0x66,0x0f,1,0x16,0x20,0]);wide.put(0x20,[0xff,0,0x78,0x56,0x34,0x12]);wide.cpu.step();
  assert.deepEqual(wide.cpu.gdtr,{limit:0xff,base:0x12345678});

  for(const access of [0xba,0x9e,0x96]){
    const f=fixture();f.cpu.cr0=1;f.cpu.gdtr={base:0x200,limit:0x0f};f.put(0x208,descriptor(0x100000,access));
    const before={...f.cpu.segmentCaches[1]};
    assert.throws(()=>f.cpu._loadSeg(1,8),e=>e instanceof UnsupportedI80386);
    assert.deepEqual(f.cpu.segmentCaches[1],before);
  }
  const rpl=fixture();rpl.cpu.cr0=1;rpl.cpu.gdtr={base:0x200,limit:0x0f};rpl.put(0x208,descriptor(0x100000,0x9a));
  assert.throws(()=>rpl.cpu._loadSeg(1,0x0b),/ring-0/);

  const long=fixture();long.put(0,[...Array(15).fill(0x66),0x90]);const reads=[];long.cpu.fetch=a=>{reads.push(a);return long.mem.get(a)??0;};
  assert.throws(()=>long.cpu.step(),/15-byte/);assert.equal(reads.length,15);
});

test('faulting PUSH preserves ESP and MOV stores do not read their destination',()=>{
  const push=fixture();push.cpu.segmentCaches[1]={base:0,limit:0xffff,default32:true,present:true,code:true,writable:false};
  push.cpu.segmentCaches[2]={base:0,limit:0xff,default32:true,present:true,code:false,writable:true};push.cpu.esp=2;push.put(0,[0x50]);
  assert.throws(()=>push.cpu.step(),/segment limit/);assert.equal(push.cpu.esp,2);assert.equal(push.writes.length,0);

  const store=fixture();store.cpu.segmentCaches[1]={base:0,limit:0xffff,default32:true,present:true,code:true,writable:false};
  store.cpu.eax=0x12345678;store.cpu.ebx=0x200;store.put(0,[0x89,3]);store.cpu.step();
  assert.deepEqual(store.reads,[],'MOV r/m,r performs no destination read');assert.equal(store.dword(0x200),0x12345678);

  const call=fixture();call.cpu.segmentCaches[1]={base:0,limit:3,default32:true,present:true,code:true,writable:false};
  call.cpu.segmentCaches[2]={base:0,limit:0xffff,default32:true,present:true,code:false,writable:true};call.cpu.esp=0x100;
  call.put(0,[0xe8,0x10,0,0,0]);assert.throws(()=>call.cpu.step(),/segment limit/);assert.equal(call.cpu.esp,0x100);

  const far=fixture();far.cpu.cr0=1;far.cpu.gdtr={base:0x200,limit:0x0f};far.put(0x208,[3,0,0,0,0x10,0x9a,0x40,0]);
  far.put(0,[0x66,0xea,4,0,0,0,8,0]);const before={...far.cpu.segmentCaches[1]};
  assert.throws(()=>far.cpu.step(),/far target/);assert.deepEqual(far.cpu.segmentCaches[1],before);

  const ret=fixture();ret.cpu.segmentCaches[1]={base:0,limit:3,default32:true,present:true,code:true,readable:true,writable:false};
  ret.cpu.segmentCaches[2]={base:0,limit:0xffff,default32:true,present:true,code:false,readable:true,writable:true};ret.cpu.esp=0x100;
  ret.put(0,[0xc3]);ret.put(0x100,[4,0,0,0]);assert.throws(()=>ret.cpu.step(),/segment limit/);assert.equal(ret.cpu.esp,0x100);
});

test('byte aliases, MOVZX/MOVSX, and two-operand IMUL preserve native 32-bit state',()=>{
  const f=fixture();f.cpu.segmentCaches[1]={base:0,limit:0xffff,default32:true,present:true,code:true,writable:false};
  f.put(0,[0xb0,0x80,0xb4,0xff,0x0f,0xbe,0xdc,0x0f,0xb6,0xc4,0xb9,3,0,0,0,0xba,0xfe,0xff,0xff,0xff,0x0f,0xaf,0xca,0xf4]);
  for(let i=0;i<10&&!f.cpu.halted;i++)f.cpu.step();
  assert.deepEqual([f.cpu.eax,f.cpu.ebx,f.cpu.ecx,f.cpu.edx],[255,0xffffffff,0xfffffffa,0xfffffffe]);
  assert.equal(f.cpu.eflags&0x801,0,'fitting IMUL clears CF and OF');

  const overflow=fixture();overflow.cpu.segmentCaches[1]={base:0,limit:0xffff,default32:true,present:true,code:true,writable:false};
  overflow.cpu.eax=0x7fffffff;overflow.cpu.ecx=2;overflow.put(0,[0x0f,0xaf,0xc1]);overflow.cpu.step();
  assert.equal(overflow.cpu.eax,0xfffffffe);assert.equal(overflow.cpu.eflags&0x801,0x801);
  const byteFlags=fixture();byteFlags.cpu.segmentCaches[1]={base:0,limit:0xffff,default32:true,present:true,code:true,writable:false};byteFlags.cpu.eax=0xf0;byteFlags.cpu.ebx=0x70;byteFlags.put(0,[0x30,0xd8]);byteFlags.cpu.step();
  assert.equal(byteFlags.cpu.al,0x80);assert.equal(byteFlags.cpu.eflags&0xc4,0x80,'byte XOR sets SF from bit 7 and computes PF/ZF');
});

test('protected data access respects execute-only and non-writable code descriptors',()=>{
  const write=fixture();write.cpu.cr0=1;write.cpu.segmentCaches[1]={base:0,limit:0xffff,default32:true,present:true,code:true,readable:true,writable:false};write.cpu.eax=1;write.cpu.ebx=0x100;write.put(0,[0x2e,0x89,3]);
  assert.throws(()=>write.cpu.step(),/non-writable/);assert.equal(write.writes.length,0);
  const read=fixture();read.cpu.cr0=1;read.cpu.segmentCaches[1]={base:0,limit:0xffff,default32:true,present:true,code:true,readable:false,writable:false};read.cpu.ebx=0x100;read.put(0,[0x2e,0x8b,3]);const before=read.reads.length;
  assert.throws(()=>read.cpu.step(),/execute-only/);assert.equal(read.reads.length,before);
});

test("bounded shifts honor operand width, count masking, and count-one overflow", () => {
  const f = fixture();
  f.cpu.segmentCaches[1] = {
    base: 0,
    limit: 0xffff,
    default32: true,
    present: true,
    code: true,
    writable: false,
  };
  f.cpu.eax = 0x40000001;
  f.put(0, [0xc1, 0xe0, 1, 0xc1, 0xe8, 1, 0xc1, 0xf8, 1]);
  f.cpu.step();
  assert.equal(f.cpu.eax, 0x80000002);
  assert.equal(f.cpu.eflags & 0x801, 0x800);
  f.cpu.step();
  assert.equal(f.cpu.eax, 0x40000001);
  assert.equal(f.cpu.eflags & 0x801, 0x800);
  f.cpu.step();
  assert.equal(f.cpu.eax, 0x20000000);
  assert.equal(f.cpu.eflags & 0x801, 1);
  const zero = fixture();
  zero.cpu.segmentCaches[1] = {
    base: 0,
    limit: 0xffff,
    default32: true,
    present: true,
    code: true,
    writable: false,
  };
  zero.cpu.eax = 0x80000000;
  zero.cpu.ecx = 32;
  zero.cpu.eflags = 0x8d7;
  zero.put(0, [0xd3, 0xe0]);
  zero.cpu.step();
  assert.deepEqual([zero.cpu.eax, zero.cpu.eflags], [0x80000000, 0x8d7]);
});
