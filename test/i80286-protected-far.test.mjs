import test from 'node:test';
import assert from 'node:assert/strict';
import ProtectedI80286,{SEG_CS,SEG_DS,SEG_SS}from'../src/experimental/i80286-protected.js';

function fixture(){
  const mem=new Map(),reads=[],cpu=new ProtectedI80286({read:a=>{reads.push(a);return mem.get(a)??0;},fetch:a=>mem.get(a)??0,write:(a,v)=>mem.set(a,v&255)});
  const put=(a,b)=>b.forEach((v,i)=>mem.set(a+i,v));
  const desc=(a,base,access,limit=0xffff)=>put(a,[limit&255,limit>>8,base&255,base>>8&255,base>>16&255,access,0,0]);
  put(0,[0x0f,1,0x16,0,1,0xb8,1,0,0x0f,1,0xf0,0xea,0,0,8,0]);put(0x100,[0x37,0,0,2,0]);
  desc(0x208,0x100000,0x9a);desc(0x210,0x120000,0x92);desc(0x218,0x130000,0x92);
  desc(0x220,0x140000,0xfa);desc(0x228,0x150000,0xf2);desc(0x230,0x160000,0xf2);
  cpu.cs=0;cpu.ip=0;for(let i=0;i<5;i++)cpu.step();
  return{cpu,mem,reads,put,desc};
}

test('same-ring immediate far CALL and RET preserve CS:IP and stack',()=>{
  const f=fixture();f.put(0x100000,[0x9a,0x10,0,8,0,0xf4]);f.put(0x100010,[0xcb]);
  f.cpu.ip=0;f.cpu.ss=0x18;f.cpu.segmentCaches[SEG_SS]=f.cpu._descriptor(0x18,SEG_SS);f.cpu.sp=0x200;
  f.cpu.step();assert.deepEqual([f.cpu.cs,f.cpu.ip,f.cpu.sp],[8,0x10,0x1fc]);
  assert.deepEqual([f.cpu._rd16(SEG_SS,0x1fc),f.cpu._rd16(SEG_SS,0x1fe)],[5,8]);
  f.cpu.step();assert.deepEqual([f.cpu.cs,f.cpu.ip,f.cpu.sp],[8,5,0x200]);
});

test('JMP through a same-ring call gate transfers without building a frame',()=>{
  const f=fixture();f.put(0x230,[0x20,0,8,0,0xff,0x84,0,0]);f.put(0x100000,[0xea,0,0,0x30,0]);
  f.cpu.ip=0;f.cpu.ss=0x18;f.cpu.segmentCaches[SEG_SS]=f.cpu._descriptor(0x18,SEG_SS);f.cpu.sp=0x200;
  f.cpu.step();assert.deepEqual([f.cpu.cs,f.cpu.ip,f.cpu.sp],[8,0x20,0x200]);
});

test('FF far pointer preflights all four bytes before reading the first word',()=>{
  const f=fixture();f.put(0x100000,[0xff,0x1e,0xfe,0xff]);f.cpu.ip=0;
  f.cpu.segmentCaches[SEG_DS]=f.cpu._descriptor(0x10,SEG_DS);f.cpu.segmentCaches[SEG_DS].limit=0xffff;
  const before=f.reads.length;
  assert.throws(()=>f.cpu.step(),e=>e.vector===13&&/limit/.test(e.reason));
  assert.ok(!f.reads.slice(before).includes(0x12fffe),'operand bus was untouched');
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

test('outer RETF validates the return stack before a bad target offset',()=>{
  const f=fixture();f.desc(0x220,0x140000,0xfa,0x10);
  f.cpu.ss=0x18;f.cpu.segmentCaches[SEG_SS]=f.cpu._descriptor(0x18,SEG_SS);f.cpu.sp=0x200;
  // Both the outer SS and the target IP are invalid. Intel RETF ordering
  // requires the selector-coded stack fault before the offset #GP(0).
  for(const [off,value]of [[0,0x20],[2,0x23],[4,0x300],[6,0]])f.cpu._wr16(SEG_SS,0x200+off,value);
  assert.throws(()=>f.cpu._farReturn(0),e=>e.vector===13&&e.errorCode===0&&/null selector/.test(e.reason));
});

function installTasks(f,newIp=0x100){
  f.cpu.gdtr.limit=0x4f;f.desc(0x240,0x170000,0x83,0x2b);f.desc(0x248,0x171000,0x81,0x2b);
  f.cpu.tr={selector:0x40,valid:true,base:0x170000,limit:0x2b};
  f.cpu.ss=0x18;f.cpu.ds=0x10;f.cpu.es=0x10;f.cpu.sp=0x200;
  f.cpu.segmentCaches[SEG_SS]=f.cpu._descriptor(0x18,SEG_SS);
  f.cpu.segmentCaches[SEG_DS]=f.cpu._descriptor(0x10,SEG_DS);
  f.cpu.segmentCaches[0]=f.cpu._descriptor(0x10,0);
  const words=new Map([[0x0e,newIp],[0x10,2],[0x12,0x1111],[0x14,0x2222],[0x16,0x3333],[0x18,0x4444],
    [0x1a,0x300],[0x1c,0x5555],[0x1e,0x6666],[0x20,0x7777],[0x22,0x10],[0x24,8],[0x26,0x18],[0x28,0x10],[0x2a,0]]);
  for(const [off,v]of words)f.put(0x171000+off,[v&255,v>>8]);
}

test('direct JMP task switch saves old image, moves busy, loads registers and sets TS',()=>{
  const f=fixture();installTasks(f);f.put(0x100000,[0xea,0,0,0x48,0]);f.cpu.ip=0;
  f.cpu.step();
  assert.deepEqual([f.cpu.tr.selector,f.cpu.ip,f.cpu.ax,f.cpu.cx,f.cpu.sp],[0x48,0x100,0x1111,0x2222,0x300]);
  assert.equal(f.cpu.msw&8,8);assert.equal(f.mem.get(0x245)&0x0f,1);assert.equal(f.mem.get(0x24d)&0x0f,3);
  assert.equal((f.mem.get(0x17000e)??0)|((f.mem.get(0x17000f)??0)<<8),5);
});

test('task CALL writes backlink and NT IRET returns while clearing outgoing busy',()=>{
  const f=fixture();installTasks(f,0x100);f.put(0x100000,[0x9a,0,0,0x48,0,0xf4]);f.put(0x100100,[0xcf]);f.cpu.ip=0;
  f.cpu.step();assert.equal(f.cpu.flags&0x4000,0x4000);assert.equal((f.mem.get(0x171000)??0),0x40);
  f.cpu.step();assert.deepEqual([f.cpu.tr.selector,f.cpu.ip],[0x40,5]);
  assert.equal(f.mem.get(0x24d)&0x0f,1);assert.equal(f.mem.get(0x245)&0x0f,3);
});

test('task switch preserves static outgoing LDT and exposes post-commit segment faults',()=>{
  const f=fixture();installTasks(f);f.put(0x17002a,[0x5a,0xa5]);f.put(0x171026,[0,0]);
  assert.throws(()=>f.cpu._taskSwitch(0x48,'jmp'),e=>
    e.vector===10&&e.errorCode===0&&e.taskCommitted===true);
  assert.deepEqual([f.cpu.tr.selector,f.mem.get(0x24d)&0x0f,f.mem.get(0x245)&0x0f],[0x48,3,1]);
  assert.deepEqual([f.mem.get(0x17002a),f.mem.get(0x17002b)],[0x5a,0xa5]);
});

test('post-commit task faults retain incoming visibles and sequentially loaded caches',()=>{
  const f=fixture();installTasks(f);f.desc(0x218,0x180000,0x92);f.put(0x171028,[0x58,0]);
  assert.throws(()=>f.cpu._taskSwitch(0x48,'jmp'),e=>e.vector===10&&e.errorCode===0x58&&e.taskCommitted);
  assert.deepEqual([f.cpu.tr.selector,f.cpu.ss,f.cpu.cs,f.cpu.ds],[0x48,0x18,8,0x58]);
  assert.equal(f.cpu.segmentCaches[SEG_SS].base,0x180000);
  assert.equal(f.cpu.segmentCaches[SEG_CS].base,0x100000);
  assert.equal(f.cpu.segmentCaches[SEG_DS].usable,false);
});

test('IDT task gate switches through the TSS and CLTS clears the task-switched bit',()=>{
  const f=fixture();installTasks(f,0x100);f.put(0x100100,[0x0f,0x06,0xf4]);
  f.cpu.deliverProtectedFaults=true;f.cpu.idtr={base:0x180000,limit:0x107};
  f.put(0x180100,[0,0,0x48,0,0,0x85,0,0]);
  f.cpu.interrupt(0x20);assert.deepEqual([f.cpu.tr.selector,f.cpu.ip,f.cpu.msw&8],[0x48,0x100,8]);
  f.cpu.step();assert.equal(f.cpu.msw&8,0);
  f.cpu.cpl=3;f.cpu.msw|=8;f.cpu.ip=0x100;f.cpu.deliverProtectedFaults=false;
  assert.throws(()=>f.cpu.step(),e=>e.vector===13&&e.errorCode===0);assert.equal(f.cpu.msw&8,8);
});

test('IDT task gates push an exception error word on the incoming task stack',()=>{
  const f=fixture();installTasks(f,0x100);f.cpu.deliverProtectedFaults=true;
  f.cpu.idtr={base:0x180000,limit:13*8+7};
  f.put(0x180000+13*8,[0,0,0x48,0,0,0x85,0,0]);
  f.cpu._deliverProtected(13,{returnIp:0,errorCode:0x1234});
  assert.deepEqual([f.cpu.tr.selector,f.cpu.sp,f.cpu._rd16(SEG_SS,0x2fe)],[0x48,0x2fe,0x1234]);
});

test('task-gate target bypasses TSS DPL and task images load an LDT',()=>{
  const f=fixture();installTasks(f,0x100);
  // DPL3 task gate to a DPL0 TSS. The gate alone controls access.
  f.mem.set(0x24d,(f.mem.get(0x24d)&0x9f)|0x80);
  f.desc(0x250,0x172000,0x82,0x1f);f.cpu.gdtr.limit=0x57;
  f.desc(0x172008,0x150000,0xf2);
  f.put(0x17102a,[0x50,0]);f.put(0x171028,[0x0c,0]);
  f.cpu.cpl=3;f.cpu.segmentCaches[SEG_CS]=f.cpu._descriptor(0x23,SEG_CS,{privilegeCpl:3});f.cpu.cs=0x23;
  f.put(0x238,[0,0,0x48,0,0,0xe5,0,0]);
  f.cpu._farTransfer(0,0x38,true);
  assert.deepEqual([f.cpu.tr.selector,f.cpu.ldtr.selector,f.cpu.ldtr.valid,f.cpu.ds],[0x48,0x50,true,0x0c]);
});
