import test from 'node:test';
import assert from 'node:assert/strict';
import ProtectedI80286 from '../src/experimental/i80286-protected.js';

test('hardwareReset uses the 286 hidden reset base until any far CS reload',()=>{
  const mem=new Map(),fetches=[];
  const cpu=new ProtectedI80286({read:a=>mem.get(a)??0,fetch:a=>{fetches.push(a);return mem.get(a)??0;},write:(a,v)=>mem.set(a,v)});
  // A near jump retains the reset-only hidden base. A subsequent far jump to
  // the same visible selector must still replace that hidden base.
  [0xeb,0,0xea,0,1,0,0xf0].forEach((v,i)=>mem.set(0xfffff0+i,v));
  mem.set(0xf0100,0xf4);
  cpu.hardwareReset();
  assert.deepEqual([cpu.cs,cpu.ip,cpu.msw,cpu.idtr.base,cpu.idtr.limit],[0xf000,0xfff0,0xfff0,0,0x3ff]);
  mem.set(0xf0020,0x5a);mem.set(0xff0020,0xa5);
  assert.equal(cpu._rd8(0xf000,0x20),0x5a,'an equal numeric data selector does not inherit hidden CS base');
  assert.equal(cpu._rd8(0xf000,0xfff0),mem.get(0xffff0)??0,
    'a data read at the current IP still uses the data selector cache');
  cpu.step();assert.equal(cpu._resetCodeBase,0xff0000);
  cpu.step();assert.deepEqual([cpu.cs,cpu.ip,cpu._resetCodeBase],[0xf000,0x100,null]);
  cpu.step();assert.equal(cpu.halted,true);
  assert.deepEqual(fetches,[0xfffff0,0xfffff1,0xfffff2,0xfffff3,0xfffff4,0xfffff5,0xfffff6,0xf0100]);
  const state=cpu.getProtectedState();cpu.setProtectedState({...state,resetCodeBase:0xff0000});
  assert.equal(cpu._resetCodeBase,0xff0000,'checkpoint retains the hidden reset base');
});

test('CS override and a PE transition retain the hidden reset cache until far reload',()=>{
  const mem=new Map(),fetches=[];
  const cpu=new ProtectedI80286({read:a=>mem.get(a)??0,fetch:a=>{fetches.push(a);return mem.get(a)??0;},write:(a,v)=>mem.set(a,v)});
  // MOV AX,1; LMSW AX; JMP FAR 0008:0000.
  [0xb8,1,0,0x0f,1,0xf0,0xea,0,0,8,0].forEach((v,i)=>mem.set(0xfffff0+i,v));
  [0xff,0xff,0,0x10,0,0x9a,0,0].forEach((v,i)=>mem.set(0x208+i,v));
  cpu.hardwareReset();cpu.gdtr={base:0x200,limit:0x0f};
  cpu.step();cpu.step();
  assert.equal(cpu.msw&1,1);assert.equal(cpu.segmentCaches[1].base,0xff0000);
  cpu.step();assert.deepEqual([cpu.cs,cpu.ip,cpu._resetCodeBase],[8,0,null]);
  assert.ok(fetches.includes(0xfffff6),'the post-PE far opcode was fetched through the reset cache');

  const data=new Map(),seen=[];
  const prefixed=new ProtectedI80286({read:a=>{seen.push(a);return data.get(a)??0;},fetch:a=>data.get(a)??0,write(){}});
  [0x2e,0xa0,0x20,0].forEach((v,i)=>data.set(0xfffff0+i,v));data.set(0xff0020,0xa5);data.set(0xf0020,0x5a);
  prefixed.hardwareReset();prefixed.step();
  assert.equal(prefixed.al,0xa5);assert.ok(seen.includes(0xff0020),'CS override uses the hidden CS cache identity');
});
