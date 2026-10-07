/** Architectural cuts and lossless owned-memory replay for the finite IRQ guest. */
import assert from 'node:assert/strict';
import {boundedCount,wholeNativeWords} from '../bochs-cpu3-native-cold-bios/parity.mjs';
import {comparePagedIrqCpu} from './cpu-comparison.mjs';
import {layout,entries,bootStores,markerStores,terminalEip,selector,wordAt,expectedShadow} from './profile.mjs';
import {nativeFrameStores,nativePagedIrqProfile} from './provider-profile.mjs';
export {wholeNativeWords};

const allPages=Object.keys(layout);
const value=bytes=>bytes.reduce((n,b,i)=>(n|b<<(8*i))>>>0,0);
const nativeAd=Object.values(entries).map(e=>({raw:e.raw,before:e.value,after:e.value|(e===entries.stack?0x60:0x20)}));
const ownPage=raw=>allPages.find(key=>layout[key]===(raw&~4095));
export function irqProgress(previous,n){
 wholeNativeWords(n);
 const ticks=boundedCount(n.nativeTicks),q=boundedCount(n.successfulQuanta),dn=ticks-previous.n,dq=q-previous.q;
 assert.ok((dn===0||dn===1)&&(dq===0||dq===1),'independent N/Q max-one deltas');
 assert.deepEqual([n.chargedNativeTicks,n.chargedQuanta],[dn,dq],'exact charged deltas');
 assert.ok([1,6,7].includes(n.reason),'budget, actual IRQ delivery, or device due');
 if(n.reason===6){assert.deepEqual([dn,dq],[0,0],'zero-Q hardware delivery');assert.equal(n.irqDelivered,1);assert.equal(n.irqVector,0);}else assert.ok(dn||dq||n.reason===7,'no synthetic zero-progress cut');
 assert.ok(ticks<=nativePagedIrqProfile.maxNativeTicks&&q<=nativePagedIrqProfile.maxQuanta);
 assert.equal(n.activityState,0);
 assert.ok(n.execution&&n.fallback);
 assert.deepEqual(Object.keys(n.execution).sort(),['attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts'].sort());
 assert.deepEqual(Object.keys(n.fallback).sort(),['bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer'].sort());
 for(const v of Object.values(n.fallback))assert.equal(boundedCount(v),0,'no fallback');
 for(const key of ['repIterations','repPartial','faults','portCommits','haltIdleCuts'])assert.equal(boundedCount(n.execution[key]),0,key+' forbidden');
 assert.ok(boundedCount(n.execution.irqDeliveries)<=1,'single hardware delivery');
 return {n:ticks,q,dn,dq};
}
export function checkPages(pages){
 assert.deepEqual(Object.keys(pages).sort(),allPages.sort());
 for(const page of Object.values(pages))assert.ok(page instanceof Uint8Array&&page.length===4096);
 return pages;
}
export function comparablePhase(kind,js,dq){
 assert.ok(['reset','resume','line','irq-delivery','final-inspect'].includes(kind));
 if(kind==='reset'||kind==='final-inspect'||kind==='irq-delivery')return true;
 if(kind!=='resume'||dq!==1)return false;
 return !(js.cpu.cr0&0x80000000)||js.cpu.cs===selector&&[0x7001,0x7002,0x7005,0x7008,0x700a,0x700d,0x7010].includes(js.cpu.eip);
}
export function compareCut(native,board,physical,js,label,kind='resume',dq=1){
 wholeNativeWords(native);checkPages(physical);checkPages(js.pages);
 comparePagedIrqCpu(native,js.cpu);
 assert.equal(boundedCount(native.successfulQuanta),js.q,label+' native Q');
 assert.equal(boundedCount(native.nativeTicks),js.q,label+' independent N at completed or delivery cut');
 assert.equal(board.successfulQuanta,js.q,label+' source Q');
 assert.equal(board.nativeTicks,js.q,label+' source N');
 assert.deepEqual([js.cpu.interruptShadow,js.cpu.nmiShadow,js.cpu.debugShadow],expectedShadow(js.cpu.cs,js.cpu.eip));
 if(!comparablePhase(kind,js,dq))return {label,status:'UNMATCHED_PHASE',q:js.q,coverage:'represented CPU and N/Q only; full board and ten pages retained raw without equality claim'};
 assert.deepEqual(board.board,js.board,label+' whole board');
 for(const key of allPages)assert.deepEqual(physical[key],js.pages[key],label+' full physical '+key);
 return {label,status:'ARCHITECTURAL_CUT_PASS',q:js.q,coverage:'represented CPU, whole board, all ten unmasked physical pages; native-only words retained'};
}
export function validateNativeMemory(events,board,physical){
 checkPages(physical);assert.ok(Array.isArray(events)&&events.length<=1024);
 const replay=Object.fromEntries(allPages.map(k=>[k,new Uint8Array(4096)]));
 const generations=new Map(),writes=[];let reads=0;
 for(const [ordinal,event] of events.entries()){
  assert.equal(event.ordinal,ordinal);assert.ok(event.direction==='read'||event.direction==='write');
  assert.ok(Number.isSafeInteger(event.raw)&&event.raw>=0&&event.raw<=0xffffffff);
  assert.ok(Array.isArray(event.bytes)&&event.bytes.length>=1&&event.bytes.length<=16);
  for(const byte of event.bytes)assert.ok(Number.isInteger(byte)&&byte>=0&&byte<=255);
  const key=ownPage(event.raw);assert.ok(key,'owned RAM page');
  const offset=event.raw&4095;assert.ok(offset+event.bytes.length<=4096);
  const page=replay[key];
  if(event.direction==='read'){
   assert.deepEqual(event.bytes,[...page.subarray(offset,offset+event.bytes.length)],'ordered source readback');
   reads++;
  }else{
   const next=(generations.get(key)??0)+1;
   assert.equal(event.generation,next,'one generation per committed write');
   generations.set(key,next);
   if(event.kind==='ad')assert.equal(value(page.subarray(offset,offset+4)),event.before,'AD before actual replay');
   page.set(event.bytes,offset);writes.push(event);
  }
 }
 for(const key of allPages)assert.deepEqual(replay[key],physical[key],'complete physical replay '+key);
 assert.deepEqual(events.filter(e=>e.direction==='read').map(({direction,ordinal,...e})=>e),board.ram.reads);
 assert.deepEqual(events.filter(e=>e.direction==='write').map(({direction,ordinal,...e})=>e),board.ram.writes);
 const boot=writes.filter(e=>e.kind==='boot'),frame=writes.filter(e=>e.kind==='frame'),marker=writes.filter(e=>e.kind==='marker'),ad=writes.filter(e=>e.kind==='ad');
 assert.equal(writes.length,boot.length+frame.length+marker.length+ad.length,'known effects only');
 assert.deepEqual(boot.map(e=>[e.raw,e.bytes]),bootStores.map(e=>[e.raw,e.bytes]),'all fixed boot writes');
 assert.deepEqual(frame.map(e=>[e.raw,e.bytes]),nativeFrameStores.map(e=>[e.raw,e.bytes]),'native FLAGS/CS/IP frame order');
 assert.ok(frame.every(e=>e.nativeTicks===39&&e.successfulQuanta===39),'zero-Q IRQ frame effects');
 assert.deepEqual(marker.map(e=>[e.raw,e.bytes]),markerStores.map(e=>[e.raw,e.bytes]),'handler then interrupted marker once');
 assert.deepEqual(ad.map(e=>[e.raw,e.before,e.after]).sort((a,b)=>a[0]-b[0]),
  nativeAd.map(e=>[e.raw,e.before,e.after]).sort((a,b)=>a[0]-b[0]),'six source-backed native AD writes');
 assert.deepEqual([board.ram.bootStores,board.ram.frameWords,board.ram.markerWords,board.ram.irqAcks],[20,3,2,1]);
 assert.equal(board.ram.storeCount,writes.length);
 assert.deepEqual([board.ram.pic.irr,board.ram.pic.isr,board.ram.pic.vectorBase],[0,1,0]);
 assert.equal(wordAt(physical.table,entries.stack.raw&4095),0xc063);
 assert.deepEqual([...physical.stack.subarray(0xffa,0x1000)],[2,0x70,0x18,0,2,2]);
 assert.deepEqual([...physical.stack.subarray(0x100,0x104)],[0x11,0x11,0x22,0x22]);
 return {reads,writes:writes.length,boot:boot.length,frame:frame.length,marker:marker.length,ad:ad.length,events:events.length};
}
export function terminal(native,board,physical,js){
 assert.equal(js.cpu.cs,selector);assert.equal(js.cpu.eip,terminalEip);
 assert.deepEqual([js.deliveries.length,js.acknowledgements.length],[1,1]);
 assert.equal(boundedCount(native.execution.irqDeliveries),1);
 return compareCut(native,board,physical,js,'returned pre-HLT','final-inspect');
}
