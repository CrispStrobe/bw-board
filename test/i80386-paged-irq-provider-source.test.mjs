import test from 'node:test';
import assert from 'node:assert/strict';
import {createOwnedPagedIrqProvider,derivePagedIrqProvider,parentSha256} from '../scripts/bochs-cpu3-native-paged-irq/provider-derivation.mjs';
import {bootStores} from '../scripts/bochs-cpu3-native-paged-irq/profile.mjs';
import {sha256} from '../scripts/bochs-cpu3-native-owned-clock/derive.mjs';

test('private IRQ provider binds real reset PIC, one paused line and one ACK',async()=>{
 const source=derivePagedIrqProvider();assert.equal(source.baseSha256,parentSha256);assert.equal(sha256(source.bytes).length,64);
 const p=await createOwnedPagedIrqProvider(),c=p.callbacks;
 assert.deepEqual([...c.clockTransfer(new Uint32Array(),1)],[0,0,4,0,6000,0,1]);
 assert.deepEqual(p.stage(),{asserted:false,changed:false});
 assert.throws(()=>p.pulse(),/named N\/Q cut/);
 p.begin();assert.deepEqual([...c.clockTransfer(new Uint32Array(),2)],[0,0,4,0,6000,0,1]);
 const first=bootStores[0];c.writePhysical(first.raw,Uint8Array.from(first.bytes));
 const before=p.callbacks.clockTransfer(Uint32Array.from(Array.from({length:39},()=>[1,2]).flat()),3);
 assert.deepEqual([...before],[39,39,238,234,6000,0,1]);
 assert.throws(()=>c.packedScalar(4,0,0,0),/actual PIC line/);
 p.end();const prior=p.checkpoint();assert.equal(prior.ram.irqAcks,0);assert.equal(prior.ram.writes.length,1);
 p.pulse();assert.deepEqual(p.stage(),{asserted:true,changed:true});
 assert.throws(()=>p.pulse(),/paused once-only/);
 p.begin();c.clockTransfer(new Uint32Array(),2);
 assert.throws(()=>c.clockTransfer(Uint32Array.of(99),3),/word enum/);
 p.end();const denied=p.checkpoint();assert.deepEqual([denied.ram.pic.irr,denied.ram.pic.isr,denied.ram.irqAcks],[1,0,0]);
 assert.deepEqual(denied.ram.writes,prior.ram.writes,'later invalid tape has no RAM effect');
 p.begin();c.clockTransfer(new Uint32Array(),2);
 assert.throws(()=>c.packedScalar(4,1,0,0));
 assert.deepEqual([...c.packedScalar(4,0,0,0)],[0,0,1]);
 assert.throws(()=>c.packedScalar(4,0,0,0),/once-only PIC ACK/);
 p.end();assert.deepEqual(p.stage(),{asserted:false,changed:true});
 const final=p.checkpoint();assert.deepEqual([final.ram.pic.irr,final.ram.pic.isr,final.ram.irqAcks],[0,1,1]);
 assert.deepEqual(final.ram.writes,prior.ram.writes,'ACK denial does not mutate existing RAM effects');
 assert.throws(()=>p.pulse(),/paused once-only/);p.close();
});

test('swallowed nested ACK during a valid tape poisons outer clocks before effects',async()=>{
 const p=await createOwnedPagedIrqProvider(),c=p.callbacks;
 c.clockTransfer(new Uint32Array(),1);p.begin();c.clockTransfer(new Uint32Array(),2);
 const first=bootStores[0];c.writePhysical(first.raw,Uint8Array.from(first.bytes));
 c.clockTransfer(Uint32Array.from(Array.from({length:39},()=>[1,2]).flat()),3);
 p.end();p.pulse();assert.deepEqual(p.stage(),{asserted:true,changed:true});
 const before=p.checkpoint(),count=before.ram.writes.length;
 p.begin();c.clockTransfer(new Uint32Array(),2);
 let nestedDenied=false,nestedStageDenied=false;
 class HostileValidTape extends Uint32Array{get length(){
  try{c.packedScalar(4,0,0,0);}catch(e){nestedDenied=/owned callback lease reentry/.test(String(e));}
  try{p.stage();}catch(e){nestedStageDenied=/paused provider reentry/.test(String(e));}
  return super.length;
 }}
 assert.throws(()=>c.clockTransfer(new HostileValidTape([1,2]),3),{message:'clock tape copy reentry'});
 assert.equal(nestedDenied,true);assert.equal(nestedStageDenied,true);
 assert.throws(()=>c.clockTransfer(Uint32Array.of(1,2),3),/clock reentry/,'mutating callbacks remain denied');
 assert.throws(()=>c.packedScalar(4,0,0,0),/owned callback lease/);
 p.end();const after=p.checkpoint();
 assert.deepEqual([after.nativeTicks,after.successfulQuanta],[39,39]);
 assert.deepEqual([after.ram.pic.irr,after.ram.pic.isr,after.ram.irqAcks],[1,0,0]);
 assert.equal(after.ram.writes.length,count);
 assert.deepEqual(after.ram.writes,before.ram.writes);
 assert.deepEqual(after.ram.pages,before.ram.pages);
 assert.deepEqual(after.generations,before.generations);
 assert.deepEqual(after.board,before.board);
 assert.throws(()=>p.begin());assert.throws(()=>p.stage());
 assert.throws(()=>p.settleCheckpoint());p.close();
});

test('clock commit never revisits caller iterator or accepts changed second-pass words',async()=>{
 const p=await createOwnedPagedIrqProvider(),c=p.callbacks;
 c.clockTransfer(new Uint32Array(),1);p.begin();c.clockTransfer(new Uint32Array(),2);
 let changedPasses=0,lengthReads=0;
 class ChangedSecondPass extends Uint32Array{
 get length(){lengthReads++;return lengthReads===1?super.length:0x40000000;}
 *[Symbol.iterator](){
  changedPasses++;yield changedPasses===1?1:2;yield changedPasses===1?2:1;
 }}
 assert.deepEqual([...c.clockTransfer(new ChangedSecondPass([1,2]),3)],[1,1,10,6,6000,0,1]);
 assert.equal(changedPasses,0,'numeric copy never invokes caller iterator');
 assert.equal(lengthReads,1,'bounded extent is captured once');
 c.clockTransfer(Uint32Array.from(Array.from({length:38},()=>[1,2]).flat()),3);
 p.end();p.pulse();p.stage();
 const before=p.checkpoint();assert.equal(before.ram.pic.irr,1);
 p.begin();c.clockTransfer(new Uint32Array(),2);
 let delayedPasses=0,delayedAck=false;
 class DelayedAckOnSecondPass extends Uint32Array{*[Symbol.iterator](){
  delayedPasses++;if(delayedPasses===2){try{c.packedScalar(4,0,0,0);}catch{delayedAck=true;}}
  yield 1;yield 2;
 }}
 assert.deepEqual([...c.clockTransfer(new DelayedAckOnSecondPass([1,2]),3)],[40,40,244,240,6000,0,1]);
 assert.equal(delayedPasses,0);assert.equal(delayedAck,false);
 p.end();const after=p.checkpoint();
 assert.deepEqual([after.ram.pic.irr,after.ram.pic.isr,after.ram.irqAcks],[1,0,0]);
 assert.deepEqual(after.ram.writes,before.ram.writes);
 p.close();
});
