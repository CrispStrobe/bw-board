import test from 'node:test';
import assert from 'node:assert/strict';
import {createI80386Adapter} from '../src/i80386-adapter.js';
import {createI80386DebugTarget} from '../src/i80386-debug.js';
const expected={read:true,write:false,passiveRead:true,addressSpace:'physical',addressMin:0,addressMax:0xffffffff,maxReadBytes:1048576};
function fixture(options={}){const adapter=createI80386Adapter(options);return {machine:adapter.machine,target:createI80386DebugTarget(adapter)};}
test('386 explicitly declares bounded passive physical reads and no writes',()=>{
 const {machine,target}=fixture();let calls=0;
 machine.cpu.read=machine.cpu.fetch=machine.cpu.inPort=()=>{calls++;throw Error('metadata touched bus');};
 machine._read=()=>{calls++;throw Error('metadata touched machine');};
 const caps=target.capabilities();assert.deepEqual(caps.spaces,{mem:expected});
 assert.deepEqual(caps.steps,['insn']);assert.deepEqual(caps.recording,[]);assert.equal(caps.symbols,false);
 assert.equal(caps.runTo[0].space,'code');assert.equal(caps.spaces.mem.addressSpace,'physical');assert.equal(calls,0);
 caps.spaces.mem.addressMax=0;assert.deepEqual(target.capabilities().spaces.mem,expected);
});
test('metadata does not expand physical read guard or allow writes',()=>{
 const {machine,target}=fixture();let calls=0;const addresses=[];machine._read386=address=>{calls++;addresses.push(address);return 0x5a;};
 for(const [address,length] of [[0,1],[0x80000000,1],[0xffffffff,1]]){
  const raw=target.readMem('mem',address,length);assert.ok(raw instanceof Uint8Array);assert.equal(raw.length,1);assert.deepEqual([...raw],[0x5a]);
 }
 assert.equal(calls,3);assert.deepEqual(addresses,[0,0x80000000,0xffffffff]);
 const before=calls;
 for(const [address,length] of [[-1,1],[0x100000000,1],[0xffffffff,2],[0,1048577],[0,-1],[0,0.5],[NaN,1],[true,1]])assert.ok(target.readMem('mem',address,length).unsupported);
 assert.equal(calls,before);assert.ok(target.writeMem('mem',0,1).unsupported);assert.equal(calls,before);
 const empty=target.readMem('mem',0x100000000,0);assert.ok(empty instanceof Uint8Array);assert.equal(empty.length,0);assert.equal(calls,before);
 assert.match(target.readMem('io',Symbol('port'),{}).unsupported,/destructive/);assert.equal(calls,before);
});
test('passive physical inspection preserves VGA latches and fault/translation metadata',()=>{
 const {machine:m,target}=fixture({profile:'freedos-vga'});const c=m.cpu;
 assert.ok(m.vgaMemory,'authored VGA profile must provide VGA memory');
 c.cr2=0x89abcdef;c._translationGeneration=17;m._chipDebt=123;m._chipDeadline=456;
 c._translations[3]={generation:17,page:0x12345,cr3:0x7000,cr4:0,physicalPage:0x23456,writable:true,user:true};
 c._translationTablePages.add(7);c._translationTablePages.add(9);
 const card=m.chips.vga1;
 card.misc=0x67;card.seq[2]=3;card.seq[4]=2;card.gc[5]=0x10;card.gc[6]=0x0e;card.gc[8]=0xff;
 m.vgaMemory.planes[0][0]=0x47;m.vgaMemory.planes[1][0]=0x1f;
 m.vgaMemory.latches.set([0x5a,0xa5,0x36,0xc9]);
 const state=()=>JSON.stringify({cr2:c.cr2,translations:c._translations,generation:c._translationGeneration,pages:[...(c._translationTablePages??[])],latches:[...m.vgaMemory.latches],cycles:m.cycles,debt:m._chipDebt,deadline:m._chipDeadline});
 const before=state();target.regs();assert.deepEqual([...target.readMem('mem',0xb8000,2)],[0x47,0x1f]);target.readMem('mem',0x80000000,1);assert.equal(state(),before);
});

test('physical reads bypass active paging without touching CR2 or translation state',()=>{
 const {machine:m,target}=fixture();const c=m.cpu;
 c.cr0=0x80000001;c.cr3=0x3000;c.cr2=0x89abcdef;
 m.mem.fill(0,0x3000,0x4000);m.mem[0x5000]=0x7b;
 c._translationGeneration=19;c._translations[7]={generation:19,page:7,physicalPage:11};
 c._translationTablePages.add(3);m._chipDebt=123;m._chipDeadline=456;
 const state=()=>JSON.stringify({cr2:c.cr2,translations:c._translations,generation:c._translationGeneration,pages:[...c._translationTablePages],cycles:m.cycles,debt:m._chipDebt,deadline:m._chipDeadline});
 const before=state();assert.deepEqual([...target.readMem('mem',0x5000,1)],[0x7b]);assert.equal(state(),before);
 // A real linear read at this address must encounter the absent PDE; this
 // witnesses that the passive success above did not silently translate it.
 assert.throws(()=>c._readLinear(0x5000,1),error=>error.vector===14);
 assert.equal(c.cr2,0x5000);
});
