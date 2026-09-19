import test from 'node:test';
import assert from 'node:assert/strict';
import I80386,{UnsupportedI80386} from '../src/experimental/i80386.js';

function fixture(){
  const memory=new Map(),writes=[],reads=[];
  const cpu=new I80386({read:a=>{reads.push(a>>>0);return memory.get(a>>>0)??0;},fetch:a=>memory.get(a>>>0)??0,write:(a,v)=>{writes.push([a>>>0,v&255]);memory.set(a>>>0,v&255);}});
  const put=(at,bytes)=>bytes.forEach((value,index)=>memory.set(at+index,value));
  const dword=at=>((memory.get(at)??0)|((memory.get(at+1)??0)<<8)|((memory.get(at+2)??0)<<16)|((memory.get(at+3)??0)*0x1000000))>>>0;
  return{cpu,memory,writes,reads,put,dword};
}
function descriptor(base,access,limit=0xfffff,flags=0xc0){return[limit,limit>>>8,base,base>>>8,base>>>16,access,flags|((limit>>>16)&15),base>>>24].map(v=>v&255);}
function gate(offset,selector,count=0,type=12,dpl=3){return[offset,offset>>>8,selector,selector>>>8,count&31,0x80|(dpl<<5)|type,offset>>>16,offset>>>24].map(v=>v&255);}
function protectedFixture(){
  const f=fixture();f.cpu.cr0=1;f.cpu.gdtr={base:0x200,limit:0x2f};
  f.put(0x208,descriptor(0x100000,0x9a));f.put(0x210,descriptor(0x120000,0x92));
  f.put(0x218,descriptor(0x140000,0xfa));f.put(0x220,descriptor(0x160000,0xf2));
  f.cpu.tr={selector:0x30,base:0x600,limit:0x67,present:true,type:11};
  f.put(0x604,[0,4,0,0,0x10,0]);return f;
}

test('same-ring protected far CALL and RETF preserve a padded 32-bit return pointer',()=>{
  const f=protectedFixture();f.cpu.cs=8;f.cpu.ss=0x10;f.cpu.esp=0x400;
  f.cpu.segmentCaches[1]=f.cpu._ringCodeDescriptor(8);f.cpu.segmentCaches[2]=f.cpu._ringStackDescriptor(0x10,0,{returnPath:true});
  f.put(0x100000,[0x9a,0,1,0,0,8,0,0xf4]);f.put(0x100100,[0xcb]);
  f.cpu.step();assert.deepEqual([f.cpu.cs,f.cpu.eip,f.cpu.esp],[8,0x100,0x3f8]);
  assert.deepEqual([f.dword(0x1203f8),f.dword(0x1203fc)],[7,8]);
  f.cpu.step();assert.deepEqual([f.cpu.cs,f.cpu.eip,f.cpu.esp],[8,7,0x400]);f.cpu.step();assert.equal(f.cpu.halted,true);
});

test('direct and indirect protected far JMP validate and load same-ring code',()=>{
  const direct=protectedFixture();direct.cpu.cs=8;direct.cpu.ss=0x10;direct.cpu.esp=0x400;
  direct.cpu.segmentCaches[1]=direct.cpu._ringCodeDescriptor(8);direct.cpu.segmentCaches[2]=direct.cpu._ringStackDescriptor(0x10,0,{returnPath:true});
  direct.put(0x100000,[0xea,0,1,0,0,8,0]);direct.cpu.step();
  assert.deepEqual([direct.cpu.cs,direct.cpu.eip,direct.cpu.esp],[8,0x100,0x400]);
  const indirect=protectedFixture();indirect.cpu.cs=8;indirect.cpu.ss=0x10;indirect.cpu.esp=0x400;indirect.cpu.ebx=0x300;
  indirect.cpu.segmentCaches[1]=indirect.cpu._ringCodeDescriptor(8);indirect.cpu.segmentCaches[2]=indirect.cpu._ringStackDescriptor(0x10,0,{returnPath:true});
  indirect.put(0x100000,[0xff,0x2b]);indirect.put(0x300,[0x00,0x01,0,0,8,0]);indirect.cpu.step();
  assert.deepEqual([indirect.cpu.cs,indirect.cpu.eip,indirect.cpu.esp],[8,0x100,0x400]);
});

test('same-ring JMP through a call gate is valid and execute-only pointer sources fault before reads',()=>{
  const gateJump=protectedFixture();gateJump.put(0x228,gate(0x100,8,0));
  gateJump.cpu.cs=8;gateJump.cpu.ss=0x10;gateJump.cpu.esp=0x400;gateJump.cpu.segmentCaches[1]=gateJump.cpu._ringCodeDescriptor(8);gateJump.cpu.segmentCaches[2]=gateJump.cpu._ringStackDescriptor(0x10,0,{returnPath:true});
  gateJump.put(0x100000,[0xea,0,0,0,0,0x28,0]);gateJump.cpu.step();assert.deepEqual([gateJump.cpu.cs,gateJump.cpu.eip,gateJump.cpu.esp],[8,0x100,0x400]);

  const unreadable=protectedFixture();unreadable.cpu.cs=8;unreadable.cpu.ss=0x10;unreadable.cpu.ebx=0x200;
  unreadable.cpu.segmentCaches[1]=unreadable.cpu._ringCodeDescriptor(8);unreadable.cpu.segmentCaches[1].readable=false;
  unreadable.cpu.segmentCaches[2]=unreadable.cpu._ringStackDescriptor(0x10,0,{returnPath:true});
  unreadable.put(0x100000,[0x2e,0xff,0x2b]);const before=unreadable.reads.length;
  assert.throws(()=>unreadable.cpu.step(),error=>error?.vector===13&&error.errorCode===0);
  assert.equal(unreadable.reads.length,before,'execute-only source faults before pointer operand reads');
});

test('call-gate null inner SS raises TS(0) before old parameter admission',()=>{
  const f=protectedFixture();f.put(0x228,gate(0x100,8,1));f.put(0x608,[0,0]);
  f.cpu.cs=0x1b;f.cpu.ss=0x23;f.cpu.esp=0xffffffff;
  f.cpu.segmentCaches[1]=f.cpu._ringCodeDescriptor(0x1b);f.cpu.segmentCaches[2]=f.cpu._ringStackDescriptor(0x23,3,{returnPath:true});
  f.put(0x140000,[0x9a,0,0,0,0,0x2b,0]);
  assert.throws(()=>f.cpu.step(),error=>error?.vector===10&&error.errorCode===0);
  assert.deepEqual([f.cpu.cs,f.cpu.ss,f.cpu.esp],[0x1b,0x23,0xffffffff]);
});

test('call-gate JMP privilege and CALL target checks precede later faults',()=>{
  const jump=protectedFixture();jump.put(0x208,descriptor(0x100000,0x1a));jump.put(0x228,gate(0x100,8,0));
  jump.cpu.cs=0x1b;jump.cpu.ss=0x23;jump.cpu.esp=0x800;jump.cpu.segmentCaches[1]=jump.cpu._ringCodeDescriptor(0x1b);jump.cpu.segmentCaches[2]=jump.cpu._ringStackDescriptor(0x23,3,{returnPath:true});
  jump.put(0x140000,[0xea,0,0,0,0,0x2b,0]);
  assert.throws(()=>jump.cpu.step(),error=>error?.vector===13&&error.errorCode===8);

  const call=protectedFixture();call.put(0x208,descriptor(0x100000,0x9a,0xff,0x40));call.put(0x228,gate(0x100,8,1));
  call.cpu.cs=0x1b;call.cpu.ss=0x23;call.cpu.esp=0xffffffff;call.cpu.segmentCaches[1]=call.cpu._ringCodeDescriptor(0x1b);call.cpu.segmentCaches[2]=call.cpu._ringStackDescriptor(0x23,3,{returnPath:true});
  call.put(0x140000,[0x9a,0,0,0,0,0x2b,0]);
  assert.throws(()=>call.cpu.step(),error=>error?.vector===13&&error.errorCode===0);
});

test('ring-3 32-bit call gate copies parameters and RETF imm returns to the outer stack',()=>{
  const f=protectedFixture();f.put(0x228,gate(0x100,8,2));
  f.cpu.cs=0x1b;f.cpu.ss=0x23;f.cpu.esp=0x800;
  f.cpu.segmentCaches[1]=f.cpu._ringCodeDescriptor(0x1b);f.cpu.segmentCaches[2]=f.cpu._ringStackDescriptor(0x23,3,{returnPath:true});
  f.put(0x140000,[0x9a,0,0,0,0,0x2b,0,0xf4]);f.put(0x100100,[0xca,8,0]);
  f.put(0x160800,[0x44,0x33,0x22,0x11,0x88,0x77,0x66,0x55]);
  f.cpu.step();assert.deepEqual([f.cpu.cs,f.cpu.eip,f.cpu.ss,f.cpu.esp],[8,0x100,0x10,0x3e8]);
  assert.deepEqual(Array.from({length:6},(_,index)=>f.dword(0x1203e8+index*4)),[7,0x1b,0x11223344,0x55667788,0x800,0x23]);
  f.cpu.step();assert.deepEqual([f.cpu.cs,f.cpu.eip,f.cpu.ss,f.cpu.esp],[0x1b,7,0x23,0x808]);
});

test('a 16-bit call gate controls frame and parameter width from 32-bit caller code',()=>{
  const f=protectedFixture();f.put(0x228,gate(0x100,8,1,4));
  f.cpu.cs=0x1b;f.cpu.ss=0x23;f.cpu.esp=0x800;
  f.cpu.segmentCaches[1]=f.cpu._ringCodeDescriptor(0x1b);f.cpu.segmentCaches[2]=f.cpu._ringStackDescriptor(0x23,3,{returnPath:true});
  f.put(0x140000,[0x9a,0,0,0,0,0x2b,0]);f.put(0x100100,[0x66,0xca,2,0]);f.put(0x160800,[0x34,0x12]);
  f.cpu.step();assert.deepEqual([f.cpu.cs,f.cpu.eip,f.cpu.ss,f.cpu.esp],[8,0x100,0x10,0x3f6]);
  assert.deepEqual(Array.from({length:5},(_,index)=>(f.memory.get(0x1203f6+index*2)??0)|((f.memory.get(0x1203f7+index*2)??0)<<8)),[7,0x1b,0x1234,0x800,0x23]);
  f.cpu.step();assert.deepEqual([f.cpu.cs,f.cpu.eip,f.cpu.ss,f.cpu.esp],[0x1b,7,0x23,0x802]);
});

test('protected far task descriptors remain explicit refusals without stack mutation',()=>{
  const f=protectedFixture();f.put(0x228,descriptor(0x600,0x89,0x67,0));
  f.cpu.cs=8;f.cpu.ss=0x10;f.cpu.esp=0x400;f.cpu.segmentCaches[1]=f.cpu._ringCodeDescriptor(8);f.cpu.segmentCaches[2]=f.cpu._ringStackDescriptor(0x10,0,{returnPath:true});
  f.put(0x100000,[0x9a,0,0,0,0,0x28,0]);
  assert.throws(()=>f.cpu.step(),error=>error instanceof UnsupportedI80386&&/task/.test(error.message));assert.equal(f.cpu.esp,0x400);
});

test('outer RETF separates operand-size loads from returned stack-address-size discard',()=>{
  const narrow=protectedFixture();narrow.put(0x220,descriptor(0x160000,0xf2,0xffff,0x80));
  narrow.cpu.cs=8;narrow.cpu.ss=0x10;narrow.cpu.esp=0x300;narrow.cpu.segmentCaches[1]=narrow.cpu._ringCodeDescriptor(8);narrow.cpu.segmentCaches[2]=narrow.cpu._ringStackDescriptor(0x10,0,{returnPath:true});
  narrow.put(0x120300,[1,0,0,0,0x1b,0,0,0,0,0,0,0,0xfe,0xff,0x34,0x12,0x23,0,0,0]);
  narrow.cpu._protectedFarReturn(32,4);assert.equal(narrow.cpu.esp,0x12340002);

  const wide=protectedFixture();wide.cpu.cs=8;wide.cpu.ss=0x10;wide.cpu.esp=0x00010300;wide.cpu.segmentCaches[1]=wide.cpu._ringCodeDescriptor(8);wide.cpu.segmentCaches[2]=wide.cpu._ringStackDescriptor(0x10,0,{returnPath:true});
  wide.put(0x130300,[1,0,0x1b,0,0,0,0,0,0xfe,0xff,0x23,0]);
  wide.cpu._protectedFarReturn(16,4);assert.equal(wide.cpu.esp,0x00020002);
});
