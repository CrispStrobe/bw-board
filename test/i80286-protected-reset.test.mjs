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
  cpu.step();assert.equal(cpu._resetCodeBase,0xff0000);
  cpu.step();assert.deepEqual([cpu.cs,cpu.ip,cpu._resetCodeBase],[0xf000,0x100,null]);
  cpu.step();assert.equal(cpu.halted,true);
  assert.deepEqual(fetches,[0xfffff0,0xfffff1,0xfffff2,0xfffff3,0xfffff4,0xfffff5,0xfffff6,0xf0100]);
  const state=cpu.getProtectedState();cpu.setProtectedState({...state,resetCodeBase:0xff0000});
  assert.equal(cpu._resetCodeBase,0xff0000,'checkpoint retains the hidden reset base');
});
