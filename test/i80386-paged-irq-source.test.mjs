import test from 'node:test';
import assert from 'node:assert/strict';
import {createPagedIrqOracle} from '../scripts/bochs-cpu3-native-paged-irq/reference.mjs';
import {selector,interruptEip,terminalEip,gate,ramProgram,bootStores,frameStores,markerStores,adTransitions} from '../scripts/bochs-cpu3-native-paged-irq/profile.mjs';

test('actual strict386 JS board delivers one PIC IRQ through a translated 16-bit gate and IRET', async()=>{
 const oracle=await createPagedIrqOracle();let pulsed=false,foundNested=false,priorQ=0;
 for(let i=0;i<128;i++){
  const before=oracle.checkpoint();
  if(!pulsed&&before.cpu.cs===selector&&before.cpu.eip===interruptEip){
   const next=oracle.pulse();assert.equal(next.pic.irr,1);pulsed=true;
   assert.throws(()=>oracle.pulse(),/named STI successor cut/);
  }
  const line=oracle.stage();
  if(before.cpu.cs===selector&&before.cpu.eip===terminalEip){
   assert.deepEqual(line,{asserted:false,changed:false});break;
  }
  const r=oracle.step();assert.equal(r.q,priorQ+1);priorQ=r.q;
  const after=oracle.checkpoint();
  if(after.deliveries.length&&!foundNested){
   const d=after.deliveries[0],a=after.acknowledgements[0];
   assert.deepEqual([d.source,d.vector,d.q,d.instructionAttempt],['irq',0,39,39]);
   assert.deepEqual([a.before.irr,a.before.isr,a.after.irr,a.after.isr],[1,0,0,1]);
   assert.deepEqual(d.frame,[2,0x70,0x18,0,2,2]);
   assert.deepEqual([d.after.cs,d.after.eip,d.after.esp,d.after.eflags&0x200],[selector,0x700a,0xdffa,0]);
   foundNested=true;
  }
 }
 assert.ok(pulsed&&foundNested);const final=oracle.settle();
 assert.deepEqual([final.q,final.instructionAttempt,final.deliveries.length,final.acknowledgements.length],[44,44,1,1]);
 assert.equal(final.pic.isr,1);assert.equal(final.cpu.eip,terminalEip);assert.equal(final.cpu.esp,0xe000);
 assert.deepEqual([...final.pages.idt.subarray(0,8)],gate.bytes);
 assert.deepEqual([...final.pages.code.subarray(0,20)],ramProgram);
 assert.deepEqual([...final.pages.stack.subarray(0xffa,0x1000)],[2,0x70,0x18,0,2,2]);
 assert.deepEqual([...final.pages.stack.subarray(0x100,0x104)],[0x11,0x11,0x22,0x22]);
 const ordinary=final.events.filter(e=>e.kind==='write'&&!e.paging);
 assert.equal(ordinary.length,bootStores.length*4+frameStores.length*2+markerStores.length*2);
 const expectedOrdinary=[...bootStores.map(e=>({...e,kind:'instruction'})),
  ...frameStores.map(e=>({...e,kind:'irq-delivery'})),
  ...markerStores.map(e=>({...e,kind:'instruction'}))]
  .flatMap(e=>e.bytes.map((value,i)=>[e.raw+i,value,e.kind,e.cs,e.ip]));
 assert.deepEqual(ordinary.map(e=>[e.raw,e.after,e.phase.kind,e.phase.cs,e.phase.eip]),expectedOrdinary,
  'exact ordered boot, JS ascending IRQ frame, handler and interrupted stores');
 const paging=final.events.filter(e=>e.kind==='write'&&e.paging);
 assert.equal(paging.length,adTransitions.length*4);
 const dword=bytes=>bytes.reduce((n,b,i)=>(n|b<<(8*i))>>>0,0);
 for(let i=0;i<adTransitions.length;i++){
  const group=paging.slice(i*4,i*4+4),expected=adTransitions[i];
  assert.deepEqual(group.map(e=>e.raw),[0,1,2,3].map(n=>expected.raw+n));
  assert.deepEqual([dword(group.map(e=>e.before)),dword(group.map(e=>e.after)),group[0].phase.cs,group[0].phase.eip],[expected.before,expected.after,expected.cs,expected.ip]);
 }
 for(const [offset,value] of [[0x100,0x11],[0x101,0x11],[0x102,0x22],[0x103,0x22]]){
  assert.equal(ordinary.filter(e=>e.raw===0xc000+offset&&e.after===value).length,1,'exactly one marker byte');
 }
 oracle.close();
});
