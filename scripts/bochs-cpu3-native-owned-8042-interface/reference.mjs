/** Actual bounded JS reference and explicit native/JS comparison policy. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ExperimentalI80386ATMachine} from '../../src/experimental/i80386-at-machine.js';
import {combinedBoardState} from '../bochs-cpu3-native-combined-paging-ram/host.mjs';
import {fixedSelfTestRom,selfTestBoardConfig,selfTestRomSha256} from './profile.mjs';
const clone=v=>JSON.parse(JSON.stringify(v));
const sha=v=>createHash('sha256').update(v).digest('hex');
const registers=['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3','cs','ds','ss','es','fs','gs'];
export function javascriptCpu(cpu){return clone({...Object.fromEntries(registers.map(k=>[k,cpu[k]>>>0])),cr4:cpu.cr4,pc:cpu.pc>>>0,gdtr:cpu.gdtr,idtr:cpu.idtr,ldtr:cpu.ldtr,tr:cpu.tr,segmentCaches:cpu.segmentCaches,debugRegisters:[...cpu._debugRegisters],halted:cpu.halted,shutdown:cpu.shutdown,interruptShadow:cpu._interruptShadow,nmiShadow:cpu._nmiShadow,debugShadow:cpu._debugShadow,cycles:cpu.cycles});}
export function captureReference(){
 // The generic machine _in/_out hook is one byte and omits a width field.
 let attempts=0;const ports=[],m=new ExperimentalI80386ATMachine(selfTestBoardConfig,{onPortAccess:e=>ports.push({attempt:attempts,cycles:m.cycles,width:8,...e})});
 const {rom}=fixedSelfTestRom();m.loadRom(rom,0xf0000);m.loadRom(rom);m.reset();
 const cut=()=>({cpu:javascriptCpu(m.cpu),board:combinedBoardState(m),witness:Array.from(m.mem.subarray(0x592,0x594))});
 const reset=cut(),steps=[];const deliveries=[];
 for(const method of ['interrupt','_deliverFault']){const original=m.cpu[method];m.cpu[method]=(...args)=>{deliveries.push({method,attempt:attempts});return original.apply(m.cpu,args);};}
 while(!m.cpu.halted&&attempts<512){const before=m.cpu.cycles;attempts++;m.step();assert.equal(m.cpu.cycles-before,1,'one completed real-mode instruction');steps.push({q:attempts,...cut()});}
 assert.ok(m.cpu.halted&&attempts<512);assert.equal(deliveries.length,0);const beforeSettle=cut();m._catchUpChips();const final={...cut(),ramSha256:sha(m.mem)};
 assert.deepEqual(final.witness,[0x55,0x00]);assert.deepEqual(ports.filter(p=>p.dir==='out'&&p.port===0xe9).map(p=>p.value),[0x49]);
 assert.deepEqual(ports.filter(p=>p.dir==='out'&&p.port===0x64).map(p=>p.value),[0xaa,0xab]);assert.equal(final.board.a20Enabled,true);
 return {schema:'bw.js-owned-8042-interface.reference.v1',scope:'Measured ordinary JavaScript fixed-ROM reference; no native or performance claim',romSha256:selfTestRomSha256,configuration:clone(selfTestBoardConfig),reset,attempts,q:attempts,steps,ports,deliveries,beforeSettle,final};
}
export function validateReference(r){
 assert.equal(r.schema,'bw.js-owned-8042-interface.reference.v1');assert.equal(r.romSha256,'000d1c728d63868660479d912d68d546988ff7dfe5375e02effcf0869b2647f9');assert.deepEqual(r.configuration,selfTestBoardConfig);
 assert.ok(Number.isInteger(r.q)&&r.q>0&&r.q<512);assert.equal(r.attempts,r.q);assert.equal(r.steps.length,r.q);assert.deepEqual(r.deliveries,[]);
 r.steps.forEach((s,i)=>{assert.equal(s.q,i+1);assert.equal(s.cpu.cycles,s.q);assert.equal(s.board.cycles,4+6*s.q);});assert.deepEqual(r.final.witness,[0x55,0x00]);assert.equal(r.final.cpu.halted,true);assert.match(r.final.ramSha256,/^[a-f0-9]{64}$/);assert.deepEqual(r,captureReference(),"entire independently remeasured fixed JS reference");return r;
}
export function wholeNativeWords(n){
 return ['state','extra','segments','system','debug'].flatMap((k,i)=>{assert.ok(Array.isArray(n[k]));assert.equal(n[k].length,[20,20,90,30,6][i]);for(const v of n[k])assert.ok(Number.isInteger(v)&&v>=0&&v<=0xffffffff);return n[k];});
}
export const architecturalPolicy=Object.freeze({compared:'GPRs/EIP/EFLAGS/CR0/CR2/CR3, all segment selectors/base/limit/default size/presence, GDTR/IDTR, LDTR/TR selector/base/limit/presence, debug registers and represented activity state',literalModelDifferences:'EDX, CR0, GDTR/IDTR reset limits, LDTR/TR reset cache presence/limits and DR6/DR7; never arbitrary normalization',nativeOnly:'cache valid/type/dpl/granularity/avl, pending_event/event_mask and other hidden166 words: whole OFF/ON equality',javascriptOnly:'CR4, segment code/readable/writable semantic flags, shutdown and interrupt/NMI/debug shadow state: raw retained plus fixed-fixture assertions; no native field counterpart'});
export function compareArchitectural(n,j){
 assert.equal(wholeNativeWords(n).length,166);
 const fields={eax:0,ecx:1,ebx:3,esp:4,ebp:5,esi:6,edi:7,eip:8,eflags:9,cr2:11,cr3:12,cs:13,ds:14,ss:15};
 for(const [k,i]of Object.entries(fields))assert.equal(n.state[i],j[k],k);
 assert.equal(n.state[2],0,'native raw reset EDX persists');assert.equal(j.edx,0x300,'JS raw reset EDX persists');assert.equal(n.state[10],0x7ffffff0,'native raw CPU3 CR0 persists');assert.equal(j.cr0,0,'JS raw CR0 persists');assert.equal(j.cr4,0);
 // Pinned Bochs CPU3 init.cc reset profiles, unchanged by this ROM.
 assert.deepEqual(n.state.slice(16),[0,0xffff,0,0xffff]);assert.deepEqual([j.gdtr,j.idtr],[{base:0,limit:0},{base:0,limit:0x3ff}]);assert.deepEqual(n.extra.slice(2,5),[j.es,j.fs,j.gs]);
 const names=['es','cs','ss','ds','fs','gs'];
 names.forEach((name,i)=>{const s=n.segments.slice(i*15,i*15+15),c=j.segmentCaches[i];assert.equal(s[0],i);assert.equal(s[1],j[name]);assert.equal(s[10],c.base>>>0,`${name} logical cache base`);assert.equal(s[11],c.limit>>>0,`${name} limit`);assert.equal(s[13],Number(c.default32));assert.equal(s[6],Number(c.present));});
 assert.equal((n.segments[25]+n.state[8])>>>0,j.pc,'logical instruction address');if(n.activityState!==undefined)assert.equal(n.activityState,j.halted?1:0,'represented activity state');
 for(const [i,name]of ['ldtr','tr'].entries()){const s=n.system.slice(i*15,i*15+15),c=j[name];assert.equal(s[1],c.selector);assert.equal(s[10],c.base);assert.equal(s[11],0xffff);assert.equal(s[6],1);assert.deepEqual(c,{selector:0,base:0,limit:0,present:false});}
 assert.deepEqual(n.debug,[0,0,0,0,0xffff1ff0,0x400]);assert.deepEqual(j.debugRegisters,Array(8).fill(0));assert.deepEqual(n.extra.slice(0,2),[0xffff1ff0,0x400]);
 assert.equal(n.mappingEpoch,0);assert.equal(n.boardA20,1);assert.equal(j.shutdown,false);assert.equal(j.interruptShadow,0);assert.equal(j.nmiShadow,0);assert.equal(j.debugShadow,0);
 // Bochs DR6/DR7 reserved reset bits and hidden cache/event words have no
 // matching JS representation. Retain them raw; crossmode compares all166.
}
export function compareNativeReference(c,r){
 validateReference(r);assert.equal(c.schema,'bw.native-owned-8042-interface.capture.v1');assert.equal(c.romSha256,r.romSha256);compareArchitectural(c.reset.native,r.reset.cpu);assert.deepEqual(c.reset.board.board,r.reset.board);
 assert.equal(c.steps.length,r.steps.length);
 for(let i=0;i<r.steps.length;i++){const n=c.steps[i],j=r.steps[i];assert.equal(n.q,j.q);assert.equal(n.native.chargedNativeTicks,1);assert.equal(n.native.chargedQuanta,1);assert.equal(Number(n.native.nativeTicks),j.q);assert.equal(Number(n.native.successfulQuanta),j.q);compareArchitectural(n.native,j.cpu);assert.deepEqual(n.board.board,j.board,'whole actual board at every instruction');}
 assert.equal(c.terminal.native.chargedNativeTicks,0);assert.equal(c.terminal.native.chargedQuanta,0);assert.equal(c.terminal.native.reason,4);compareArchitectural(c.terminal.native,r.final.cpu);assert.deepEqual(c.settled.state.board,r.final.board);assert.deepEqual(c.settled.selfTestWitness,r.final.witness);assert.equal(c.settled.ramSha256,r.final.ramSha256);
 for(const n of [c.reset.native,...c.steps.map(s=>s.native),c.terminal.native]){assert.ok(Object.values(n.fallback).every(v=>Number(v)===0));assert.equal(Number(n.execution.faults),0);assert.equal(Number(n.execution.irqDeliveries),0);assert.equal(Number(n.execution.repIterations),0);}
 return {status:'FIXED_8042_INTERFACE_NATIVE_JS_ARCHITECTURAL_AND_WHOLE_BOARD_PASS',instructions:r.q,nativeWordsPerBoundary:166,javascriptPolicy:architecturalPolicy,performanceClaim:false};
}
export function compareNativeModes(off,on){
 assert.equal(off.nativeTrace,false);assert.equal(on.nativeTrace,true);assert.equal(off.steps.length,on.steps.length);
 assert.deepEqual(off.reset,on.reset);assert.deepEqual(off.steps,on.steps);assert.deepEqual(off.terminal,on.terminal);assert.deepEqual(off.settled,on.settled);assert.deepEqual(off.closed,on.closed);
 return {status:'FIXED_8042_INTERFACE_OFF_ON_WHOLE_166_AND_BOARD_RAM_PASS',boundaries:off.steps.length+2,nativeWordsPerBoundary:166};
}
export function compareNativePorts(text,r){
 let previousOrdinal=0;const ports=text.split('\n').filter(s=>s.startsWith('BWSD1\tPORT\t')).map(s=>{const a=s.split('\t');assert.equal(a.length,8);assert.match(a[3],/^[a-f0-9]{1,4}$/);assert.equal(a[4],'1');assert.match(a[5],/^[a-f0-9]{1,8}$/);for(const v of a.slice(6))assert.match(v,/^(0|[1-9][0-9]{0,15})$/);const ordinal=Number(a[7]),attempt=Number(a[6]);assert.ok(Number.isSafeInteger(attempt)&&attempt<=512);assert.ok(Number.isSafeInteger(ordinal)&&ordinal>previousOrdinal,'monotonic PIO trace ordinal');previousOrdinal=ordinal;return {dir:a[2],port:parseInt(a[3],16),width:8,value:parseInt(a[5],16),attempt};});
 // Native PORT is emitted inside the instruction before its completed N/Q.
 assert.deepEqual(ports,r.ports.map(({dir,port,width,value,attempt})=>({dir,port,width,value,attempt:attempt-1})),'entire actual PIO order, bytes and completed-N ownership');return {ports:ports.length};
}
/** Compare every emitted166 CPU word to its saved native boundary. The zero-
 * charge terminal observation emits no additional POST block. Other native
 * chronology remains raw evidence; the PIO comparator checks its whole tape. */
export function compareNativeTraceSnapshots(text,c){
 const expected=[c.reset.native,...c.steps.map(s=>s.native)],blocks=[];let current=null,previousPostOrdinal=0;
 const lengths={STATE:20,EXTRA:20,SEG:15,SYS:15,DR:6};
 const hex={STATE:new Set(Array.from({length:20},(_,i)=>i)),EXTRA:new Set([0,1,2,3,4,8,13,14,18,19]),SEG:new Set([1,5,10,11]),SYS:new Set([1,5,10,11]),DR:new Set([0,1,2,3,4,5])};
 const order=['STATE','EXTRA',...Array(6).fill('SEG'),...Array(2).fill('SYS'),'DR'];
 for(const line of text.split('\n')){
  if(!line.startsWith('BWSD1\t'))continue;const a=line.split('\t'),tag=a[1];let group,kind;
  if(tag==='RESET'){group='RESET';kind='STATE';}else {const match=/^(RESET|POST)_(STATE|EXTRA|SEG|SYS|DR)$/.exec(tag);if(!match)continue;[,group,kind]=match;}
  if(kind==='STATE'){assert.equal(current,null,'previous native CPU block complete');current={group,parts:[],words:[],n:0,q:0};}
  assert.ok(current&&current.group===group);assert.equal(kind,order[current.parts.length],'complete native CPU tag order');assert.equal(a.length,2+lengths[kind]+(group==='POST'?3:0));
  const words=a.slice(2,2+lengths[kind]).map((v,i)=>{assert.match(v,hex[kind].has(i)?/^[a-f0-9]{1,8}$/:/^[0-9]{1,10}$/);const n=parseInt(v,hex[kind].has(i)?16:10);assert.ok(n<=0xffffffff);return n;});
  if(kind==='SEG')assert.equal(words[0],current.parts.length-2);if(kind==='SYS')assert.equal(words[0],current.parts.length-2);
  if(group==='POST'){const suffix=a.slice(-3);for(const v of suffix)assert.match(v,/^(0|[1-9][0-9]{0,15})$/);const [n,q,ordinal]=suffix.map(Number);assert.ok([n,q,ordinal].every(Number.isSafeInteger)&&n<=512&&q<=512);assert.ok(ordinal>previousPostOrdinal,'monotonic native CPU block ordinal');if(kind==='STATE'){current.n=n;current.q=q;}else {assert.equal(ordinal,previousPostOrdinal+1,'contiguous emitted CPU block');assert.deepEqual([n,q],[current.n,current.q],'snapshot owning N/Q');}previousPostOrdinal=ordinal;}
  current.parts.push(kind);current.words.push(...words);
  if(kind==='DR'){assert.equal(current.words.length,166);blocks.push(current);current=null;}
 }
 assert.equal(current,null);assert.equal(blocks.length,expected.length,'all and only reset plus completed-instruction CPU blocks');
 blocks.forEach((b,i)=>{
  const n=expected[i];assert.equal(b.group,i===0?'RESET':'POST');assert.deepEqual([Number(n.nativeTicks),Number(n.successfulQuanta)],[i,i],'ordinary oneN/oneQ saved boundary');assert.equal(Number(n.execution.faults),0);assert.equal(Number(n.execution.repIterations),0);
  // Pinned cpu.cc: note_completed -> chargeQ/emit166 -> BX_SYNC_TIME/tickN.
  // This fixture forbids REP/faults; it is not a general trace normalization.
  assert.deepEqual([b.n,b.q],[i===0?0:i-1,i],'exact ordinary postQ/preN emitted phase');assert.deepEqual(b.words,wholeNativeWords(n),'all166 emitted CPU words match saved boundary');
 });
 return {emittedBlocks:blocks.length,comparedWords:166*blocks.length,savedBoundaries:expected.length+1,phasePolicy:'ordinary noREP/noFault POST is postQ/preN; RESET0/0',terminalPolicy:'zero-charge terminal has saved snapshot and no additional POST block'};
}
