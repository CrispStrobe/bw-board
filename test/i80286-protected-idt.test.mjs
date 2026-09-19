import test from 'node:test';
import assert from 'node:assert/strict';
import ProtectedI80286, {ProtectedModeFault, SEG_CS, SEG_DS} from '../src/experimental/i80286-protected.js';
import {UnsupportedProtectedMode} from '../src/i8086.js';

const TF=0x100, IF=0x200, OF=0x800, NT=0x4000;

function fixture(deliverProtectedFaults=true) {
  const mem=new Map(), reads=[], writes=[];
  const cpu=new ProtectedI80286({
    read:a=>{reads.push(a>>>0);return mem.get(a>>>0)??0;},
    fetch:a=>{reads.push(a>>>0);return mem.get(a>>>0)??0;},
    write:(a,v)=>{writes.push([a>>>0,v&255]);mem.set(a>>>0,v&255);},
  },{deliverProtectedFaults});
  const put=(a,bytes)=>bytes.forEach((v,i)=>mem.set(a+i,v));
  const word=(a)=>((mem.get(a)??0)|((mem.get(a+1)??0)<<8));
  const desc=(a,base,limit,access)=>put(a,[limit&255,limit>>8,base&255,base>>8&255,base>>16&255,access,0,0]);
  const gate=(vector,offset,{type=6,dpl=0,present=true,selector=0x0b}={})=>
    put(0x400+vector*8,[offset&255,offset>>8,selector&255,selector>>8,0,(present?0x80:0)|(dpl<<5)|type,0,0]);
  return {cpu,mem,reads,writes,put,word,desc,gate};
}

function boot(f,program=[]) {
  f.put(0,[
    0x0f,0x01,0x16,0x00,0x01,       // LGDT [0100]
    0x0f,0x01,0x1e,0x06,0x01,       // LIDT [0106]
    0xb8,0x01,0x00, 0x0f,0x01,0xf0, // MOV AX,1; LMSW AX
    0xea,0x00,0x00,0x08,0x00,       // JMP FAR 0008:0000
  ]);
  f.put(0x100,[0x17,0,0,2,0,0, 0xff,0x07,0,4,0,0]);
  f.desc(0x208,0x100000,0xffff,0x9a); f.desc(0x210,0x120000,0xffff,0x92);
  f.put(0x100000,[0xb8,0x10,0,0x8e,0xd0,0xbc,0x00,0x01,...program]);
  f.cpu.cs=0;f.cpu.ip=0;
  for(let i=0;i<8;i++)f.cpu.step();
  assert.equal(f.cpu.ip,8); assert.equal(f.cpu.sp,0x100);
}

test('same-ring INT gate pushes the full frame, normalizes gate RPL, and IRET restores flags',()=>{
  const f=fixture();boot(f,[0xcd,0x20,0xf4]);f.gate(0x20,0x100,{type:6,dpl:3,selector:0x0b});
  f.put(0x100100,[0xcf]);
  const saved=0x0002|IF|TF|NT|0x3000;f.cpu.flags=saved;
  const writes=f.writes.length;f.cpu.interrupt(0x20);
  assert.equal(f.cpu.cs,8,'gate selector RPL is ignored then CS.RPL is normalized to CPL');
  assert.equal(f.cpu.ip,0x100);assert.equal(f.cpu.sp,0xfa);
  assert.equal(f.word(0x1200fa),8);assert.equal(f.word(0x1200fc),8);assert.equal(f.word(0x1200fe),saved);
  assert.deepEqual(f.writes.slice(writes).slice(-6).map(([a])=>a),
    [0x1200fe,0x1200ff,0x1200fc,0x1200fd,0x1200fa,0x1200fb], 'frame bus order is FLAGS, CS, IP');
  assert.equal(f.cpu.flags&(IF|TF|NT),0,'interrupt gate clears IF, TF, and NT');
  f.cpu.step();
  assert.equal(f.cpu.ip,8);assert.equal(f.cpu.sp,0x100);
  assert.equal(f.cpu.flags&(IF|TF|NT|0x3000),saved&(IF|TF|NT|0x3000),'ring0 IRET restores IF, TF, NT, and IOPL');
  assert.throws(()=>f.cpu.step(),/nested-task IRET|trap\/IDT delivery/,
    'restored NT or TF requires a supported task/trap path before further execution');
});

test('trap gates preserve IF; INT3 and INTO save the following IP',()=>{
  for(const [bytes,vector,nextIp] of [[[0xcc],3,9],[[0xce],4,9],[[0xcd,0x21],0x21,10]]) {
    const f=fixture();boot(f,bytes);f.gate(vector,0x120,{type:7,dpl:3});f.cpu.flags=0x0002|IF|OF;
    f.cpu.step();
    assert.equal(f.cpu.ip,0x120);assert.ok(f.cpu.flags&IF,'trap gate preserves IF');
    assert.equal(f.word(0x1200fa),nextIp,'software interrupt saves the following IP');
  }
  const noOverflow=fixture();boot(noOverflow,[0xce]);noOverflow.cpu.flags=2;noOverflow.cpu.step();
  assert.equal(noOverflow.cpu.ip,9,'INTO does nothing when OF is clear');
});

test('a supported #GP is delivered with restart IP and error code',()=>{
  const f=fixture();boot(f,[0x8b,0x06,0x10,0x00]);
  // Keep the loaded DS cache but narrow its limit so the word read faults.
  f.cpu.segmentCaches[SEG_DS].limit=0x10;f.gate(13,0x140,{type:6});
  const start=f.cpu.ip;f.cpu.step();
  assert.equal(f.cpu.ip,0x140);assert.equal(f.cpu.sp,0xf8);
  assert.equal(f.word(0x1200f8),0,'data-limit #GP error code');
  assert.equal(f.word(0x1200fa),start,'fault frame restarts the instruction');
  assert.equal(f.cpu.ax,0x10,'faulting MOV did not commit');
});

test('delivered #UD has no error word while #NP and #SS retain their error frames',()=>{
  const cases=[
    {name:'#UD',vector:6,program:[0x8e,0xc8],setup(){},error:null,restart:8},
    {name:'#NP',vector:11,program:[0xb8,0x18,0,0x8e,0xd8],setup(f){
      f.cpu.gdtr.limit=0x1f;f.desc(0x218,0x140000,0xffff,0x12);
    },error:0x18,restart:11},
    {name:'#SS',vector:12,program:[0x36,0x8b,0x06,0xff,0xff],setup(){},error:0,restart:8},
  ];
  for(const c of cases) {
    const f=fixture();boot(f,c.program);c.setup(f);f.gate(c.vector,0x1c0+c.vector*2,{type:6});
    if(c.name==='#NP')f.cpu.step();
    const ax=f.cpu.ax,data=f.mem.get(0x12ffff),writes=f.writes.length;
    f.cpu.step();
    assert.equal(f.cpu.ip,0x1c0+c.vector*2,c.name);
    if(c.error===null) {
      assert.equal(f.cpu.sp,0xfa);assert.equal(f.word(0x1200fa),c.restart);
    } else {
      assert.equal(f.cpu.sp,0xf8);assert.equal(f.word(0x1200f8),c.error);
      assert.equal(f.word(0x1200fa),c.restart);
    }
    assert.equal(f.cpu.ax,ax,`${c.name} faulting operand did not commit`);
    assert.equal(f.mem.get(0x12ffff),data,`${c.name} faulting operand did not write data`);
    assert.ok(f.writes.length>writes,'only the architectural frame/descriptor effects were added');
  }
});

test('bad software gate faults through #GP with the IDT error code',()=>{
  const f=fixture();boot(f,[0xcd,0x22]);
  f.gate(0x22,0x100,{type:5,dpl:3}); // task gate is an explicit unsupported boundary
  assert.throws(()=>f.cpu.step(),UnsupportedProtectedMode);

  const invalid=fixture();boot(invalid,[0xcd,0x22]);
  invalid.gate(0x22,0x100,{type:4,dpl:3});invalid.gate(13,0x160,{type:6});
  invalid.cpu.step();
  assert.equal(invalid.cpu.ip,0x160);
  assert.equal(invalid.word(0x1200f8),(0x22<<3)|2);
  assert.equal(invalid.word(0x1200fa),8,'gate-validation #GP restarts INT');
});

test('entry and IRET preflight prevent partial stack or cache commits',()=>{
  const f=fixture();boot(f,[0xcd,0x20]);f.gate(0x20,0x100,{type:6,dpl:3});f.gate(12,0x180,{type:6});
  f.desc(0x208,0x100000,0x0f,0x9b); // competing target-IP #GP must lose to stack #SS
  f.cpu.sp=4;const before=f.cpu.getProtectedState(),writes=f.writes.length;
  assert.throws(()=>f.cpu.step(),e=>e instanceof UnsupportedProtectedMode&&/after #12/.test(e.message),
    '#SS delivery on the same exhausted stack refuses nested delivery before target-IP #GP');
  assert.deepEqual(f.cpu.getProtectedState(),before);assert.equal(f.writes.length,writes);

  const iret=fixture(true);boot(iret,[0xcf]);
  iret.cpu.sp=0xfa;iret.put(0x1200fa,[0x00,0x01,0x08,0x00,0x02,0x00]);
  iret.desc(0x208,0x100000,0xff,0x9b);
  const iretBefore=iret.cpu.getProtectedState(),iretWrites=iret.writes.length;
  assert.throws(()=>iret.cpu.step(),e=>e instanceof UnsupportedProtectedMode&&/after #13/.test(e.message));
  assert.deepEqual(iret.cpu.getProtectedState(),iretBefore);
  assert.equal(iret.writes.length,iretWrites,'invalid IRET did not set descriptor A or change stack');
});

test('external interrupts set EXT in IDT delivery errors',()=>{
  const f=fixture();boot(f,[0x90]);f.gate(0x30,0,{type:4});f.gate(13,0x1a0,{type:6});
  // Public interrupt faults while validating vector 30h, then the host sees
  // that delivery fault directly; automatic nesting is deliberately absent.
  assert.throws(()=>f.cpu.interrupt(0x30),e=>e instanceof ProtectedModeFault&&e.errorCode===((0x30<<3)|3));

  const nullTarget=fixture();boot(nullTarget,[0x90]);nullTarget.gate(0x31,0,{type:6,selector:0});
  assert.throws(()=>nullTarget.cpu.interrupt(0x31),e=>e instanceof ProtectedModeFault&&e.vector===13&&e.errorCode===1,
    'external null target selector reports EXT with a zero selector index');
});

test('IRET with current NT set refuses task return independently of TF',()=>{
  const f=fixture();boot(f,[0xcf]);f.cpu.flags=0x4002;
  const before=f.cpu.getProtectedState(),writes=f.writes.length;
  assert.throws(()=>f.cpu.step(),e=>e instanceof UnsupportedProtectedMode&&/nested-task IRET/.test(e.message));
  assert.deepEqual(f.cpu.getProtectedState(),before);assert.equal(f.writes.length,writes);
});

test('same-ring entry accepts SP=0 but rejects partial frames from SP=2 or 4',()=>{
  const zero=fixture();boot(zero,[0x90]);zero.gate(0x20,0x100,{type:6});zero.cpu.sp=0;
  zero.cpu.interrupt(0x20);
  assert.equal(zero.cpu.sp,0xfffa);assert.equal(zero.word(0x12fffa),8);
  assert.equal(zero.word(0x12fffc),8);assert.equal(zero.word(0x12fffe),2);

  for(const sp of [2,4]) {
    const f=fixture();boot(f,[0x90]);f.gate(0x20,0x100,{type:6});f.gate(12,0x180,{type:6});
    f.desc(0x208,0x100000,0xffff,0x9a);f.cpu.sp=sp;
    const before=f.cpu.getProtectedState(),writes=f.writes.length;
    assert.throws(()=>f.cpu.interrupt(0x20),e=>e instanceof ProtectedModeFault&&e.vector===12);
    assert.deepEqual(f.cpu.getProtectedState(),before);assert.equal(f.writes.length,writes);
    assert.equal(f.mem.get(0x20d),0x9a,'failed entry did not set target descriptor accessed bit');
  }
});
