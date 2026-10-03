/** Streaming diagnostic policy, not proof of all166 native/JS counterparts. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ownedUndefinedFlags} from './undefined-of.mjs';
import {bochsResetProfile} from './bochs-reference.mjs';
export const parityPolicy=Object.freeze({
 compared:'Dynamic GPR/EIP/defined EFLAGS (only OF owns exact authenticated SHL count16 lifetime through ADD retirement; raw flags retained)/CR0/CR2/CR3; selectors and represented segment base/limit/default32/presence; GDTR/IDTR; LDTR/TR selector/base/limit/presence and represented type; DR0..3/6/7; logical PC and represented activity state',
 nativeOnly:'Cached selector index/TI/RPL and hidden cache valid/type/DPL/G/AVL, pending_event/event_mask and remaining hidden166 words retained in ordered native-word digest. Whole OFF/ON equality requires identical boundary protocol and separate audited captures.',
 javascriptOnly:'CR4, code/readable/writable semantic cache flags, shutdown and shadow fields retained at named cuts; no invented native field counterpart.',
 boardCoverage:'Scalar cycles/debt/deadline/A20 every return. Full actual chip/controller/PIC board at real due-flush, PIO and named cuts, plus final catchup; no synthetic masking or per-return full-board claim.',
 resetScope:'Private fixed Bochs CPU3 model literals installed once before first instruction; no after-step or RAM normalization. CR0 must stay 7ffffff0; later control-register write semantics are outside this profile.',
});
export function boundedCount(value,max=400000){
 assert.ok(typeof value==='bigint'||typeof value==='number'||typeof value==='string');
 if(typeof value==='string')assert.match(value,/^(0|[1-9][0-9]{0,15})$/);
 const n=Number(value);assert.ok(Number.isSafeInteger(n)&&n>=0&&n<=max);return n;
}
export function wholeNativeWords(n){
 return ['state','extra','segments','system','debug'].flatMap((key,i)=>{assert.ok(Array.isArray(n[key]));assert.equal(n[key].length,[20,20,90,30,6][i]);for(const value of n[key])assert.ok(Number.isInteger(value)&&value>=0&&value<=0xffffffff,key+' uint32');return n[key];});
}
export function compareCpu(n,j,ownedToken){
 const undefinedMask=ownedToken===undefined?0:ownedUndefinedFlags(ownedToken);
 wholeNativeWords(n);const fields=['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3','cs','ds','ss'];
 fields.forEach((key,i)=>assert.equal(key==='eflags'?(n.state[i]&~undefinedMask)>>>0:n.state[i],key==='eflags'?(j[key]&~undefinedMask)>>>0:j[key],'raw '+key));
 assert.equal(n.state[10],bochsResetProfile.cr0,'native CR0 scope');assert.equal(j.cr0,bochsResetProfile.cr0,'JS CR0 scope');
 assert.deepEqual(n.state.slice(16),[j.gdtr.base,j.gdtr.limit,j.idtr.base,j.idtr.limit]);
 assert.deepEqual(n.extra.slice(2,5),[j.es,j.fs,j.gs]);
 assert.deepEqual(n.extra.slice(5,8),n.segments.slice(17,20),'duplicated native CS cached selector fields');
 assert.deepEqual([n.extra[9],n.extra[13],n.extra[14],n.extra[16]],[Number(j.segmentCaches[1].present),j.segmentCaches[1].base>>>0,j.segmentCaches[1].limit>>>0,Number(j.segmentCaches[1].default32)],'duplicated represented CS cache');
 for(const [i,key]of ['es','cs','ss','ds','fs','gs'].entries()){
  const s=n.segments.slice(i*15,i*15+15),c=j.segmentCaches[i];assert.equal(s[0],i);assert.equal(s[1],j[key],key+' selector');
  // Bochs real/v8086 loads leave cached index/TI stale; these have no JS snapshot counterpart.
  // Preserve all raw words and compare duplicated CS fields only within the native snapshot.
  assert.equal(s[10],c.base>>>0,key+' base');assert.equal(s[11],c.limit>>>0,key+' limit');assert.equal(s[13],Number(c.default32),key+' DB');assert.equal(s[6],Number(c.present),key+' present');
 }
 assert.equal((n.segments[25]+n.state[8])>>>0,j.pc,'logical PC');
 for(const [i,key]of ['ldtr','tr'].entries()){
  const s=n.system.slice(i*15,i*15+15),c=j[key];assert.equal(s[0],i+6);assert.equal(s[1],c.selector,key+' selector');assert.equal(s[10],c.base,key+' base');assert.equal(s[11],c.limit,key+' limit');assert.equal(s[6],Number(c.present),key+' present');if(c.type!==undefined)assert.equal(s[9],c.type,key+' represented type');
 }
 assert.deepEqual(n.debug,[...j.debugRegisters.slice(0,4),j.debugRegisters[6],j.debugRegisters[7]],'dynamic debug registers');assert.deepEqual(n.extra.slice(0,2),[j.debugRegisters[6],j.debugRegisters[7]]);
 if(n.activityState!==undefined)assert.equal(n.activityState,j.halted?1:0);assert.equal(j.halted,false);assert.equal(j.shutdown,false);assert.equal(j.eflags&0x200,0);
 assert.equal(n.mappingEpoch,0);assert.equal(n.boardA20,1);
}
export function validateProgress(previous,n){
 const ticks=boundedCount(n.nativeTicks),q=boundedCount(n.successfulQuanta),dn=ticks-previous.n,dq=q-previous.q;
 assert.ok(dn===0||dn===1,'maxN1 independent delta');assert.ok(dq===0||dq===1,'maxQ1 independent delta');
 assert.equal(n.chargedNativeTicks,dn);assert.equal(n.chargedQuanta,dq);
 assert.ok(n.reason===1||n.reason===7||n.reason===3,'budget/event/PIO only; no HLT/IRQ/fault');
 assert.ok(dn||dq||n.reason===7,'zero progress only actual device deadline');
 assert.ok(n.execution&&n.fallback);
 assert.deepEqual(Object.keys(n.fallback).sort(),['bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer'].sort(),'all five fallback counters');
 assert.deepEqual(Object.keys(n.execution).sort(),['attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts'].sort(),'exact execution counters');
 for(const v of Object.values(n.execution))boundedCount(v,Number.MAX_SAFE_INTEGER);
 for(const v of Object.values(n.fallback))assert.equal(boundedCount(v),0,'no fallback');assert.equal(boundedCount(n.execution.faults),0);assert.equal(boundedCount(n.execution.irqDeliveries),0);
 return {n:ticks,q,dn,dq};
}
export function compareTiming(nativeBoard,timing){
 assert.deepEqual({q:nativeBoard.successfulQuanta,cycles:nativeBoard.board.cycles,debt:nativeBoard.board.debt,deadline:nativeBoard.board.deadline,a20Enabled:nativeBoard.board.a20Enabled},timing,'raw board timing');
}
export function comparePorts(nativePorts,jsPorts){
 assert.equal(nativePorts.length,jsPorts.length,'whole actual PIO count');
 for(let i=0;i<jsPorts.length;i++){
  const n=nativePorts[i],j=jsPorts[i];assert.deepEqual([n.ordinal,n.dir,n.port,n.width??8,n.value,n.successfulQuanta,n.cycles],[j.ordinal,j.dir,j.port,j.width,j.value,j.q-1,j.cycles],'whole PIO order/value/preQ clock ownership');
 }
 return {ports:jsPorts.length,coverage:'Complete tape compared once at terminal; first-failure partial tapes retained without parity claim'};
}
/** Constant-space all166 commitment. Framing also binds ALL returned metadata,
 * including independent N/Q, deltas, activity/mapping/callback/execution fields
 * and slice bytes; digest equality is useful only with equal counts. */
export function createBoundaryDigest(){
 const hash=createHash('sha256');let boundaries=0;
 return Object.freeze({
  append(kind,n){assert.ok(['reset','resume','irq','final-inspect'].includes(kind));const words=wholeNativeWords(n);const metadata=Object.fromEntries(Object.keys(n).sort().filter(k=>!['state','extra','segments','system','debug'].includes(k)).map(k=>[k,n[k]]));const header=Buffer.from(JSON.stringify([kind,boundaries,metadata],(_,v)=>typeof v==='bigint'?v.toString():v instanceof Uint8Array?Array.from(v):v)+'\n');const bytes=Buffer.allocUnsafe(166*4);words.forEach((v,i)=>bytes.writeUInt32LE(v,i*4));hash.update(header);hash.update(bytes);boundaries++;},
  finish(){return {boundaries,words:boundaries*166,sha256:hash.digest('hex'),coverage:'Every returned full166 snapshot, canonical uint32LE plus all returned metadata and ordered boundary framing; no snapshot array'};}
 });
}
