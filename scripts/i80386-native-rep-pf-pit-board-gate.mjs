/** Source-bound actual-board compact REP/two-PF/PIT proof. No full reset parity. */
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertRepPfPitOracle} from './i80386-rep-pf-pit-oracle.mjs';
import {NativeRepPfPitHost,repSha,repBudgets,parseRepRpcLine,encodeRepReply,repBoardConfig} from './bochs-cpu3-native-rep-pf-pit/host.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const fail=m=>{throw Error(`native REP/PF/PIT proof: ${m}`);};
const check=(v,m)=>{if(!v)fail(m);};
const equal=(a,b,m)=>assert.deepEqual(a,b,`native REP/PF/PIT proof: ${m}`);
const boundaryKinds=['ordinary','rep-element','fault-delivery','irq-delivery','prefetch-pagewalk'];
const stateNames=['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3','cs','ds','ss','gdtrBase','gdtrLimit','idtrBase','idtrLimit'];
const extraNames=['dr6','dr7','es','fs','gs','csIndex','csTi','csRpl','csValid','csPresent','csDpl','csSegment','csType','csBase','csLimit','csGranular','csDefault32','csAvailable','pendingEvent','eventMask'];
const segmentNames=['index','selector','selectorIndex','ti','rpl','valid','present','dpl','segment','type','base','limit','granular','default32','available'];
const finalNames=['nativeTicks','successfulQuanta','attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts','rpcRequests','rpcReplies','nativeTickCallbacks','quantumCallbacks'];
export function parseRepNativeLog(stderr){
  const rows=stderr.split('\n').filter(line=>line.startsWith('BWS'));
  check(rows.length>0,'BWS11 evidence absent');
  const result={records:[],events:[],slices:[],apiProbes:{},resetSegments:[],resetSystem:[]};let nextOrdinal=1;
  const d=v=>{check(/^(0|[1-9][0-9]*)$/.test(v)&&Number.isSafeInteger(Number(v)),'noncanonical native decimal');return Number(v);};
  const h=(v,n=8)=>{check(new RegExp(`^[0-9a-f]{${n}}$`).test(v),'noncanonical native hex');return parseInt(v,16);};
  const object=(names,p,hexWidths={})=>Object.fromEntries(names.map((name,i)=>[name,Object.hasOwn(hexWidths,i)?h(p[i],hexWidths[i]):d(p[i])]));
  const state=p=>object(stateNames,p,Object.fromEntries(stateNames.map((_,i)=>[i,[13,14,15,17,19].includes(i)?4:8])));
  const extra=p=>object(extraNames,p,{0:8,1:8,2:4,3:4,4:4,8:8,13:8,14:8,18:8,19:8});
  const segment=p=>object(segmentNames,p,{1:4,5:8,10:8,11:8});
  const event=(tag,data)=>{equal(data.ordinal,nextOrdinal++,'raw event ordinal');result.events.push({tag,...data});};
  const once=(key,data)=>{check(!Object.hasOwn(result,key),`duplicate ${key}`);result[key]=data;};
  for(const line of rows){
    const [prefix,tag,...p]=line.split('\t');check(prefix==='BWS11'&&!p.some(x=>x===''),'proof prefix or empty field');
    result.records.push({tag,fields:p});
    if(['RESET','STATE'].includes(tag)){equal(p.length,20,tag+' fields');once(tag==='RESET'?'resetState':'finalState',state(p));}
    else if(['RESET_EXTRA','EXTRA'].includes(tag)){equal(p.length,20,tag+' fields');once(tag==='RESET_EXTRA'?'resetExtra':'finalExtra',extra(p));}
    else if(['RESET_SEG','RESET_SYS'].includes(tag)){equal(p.length,15,'reset segment fields');result[tag==='RESET_SEG'?'resetSegments':'resetSystem'].push(segment(p));}
    else if(tag==='RESET_DR'){equal(p.length,6,'reset debug fields');once('resetDebug',p.map(v=>h(v)));}
    else if(['POST_STATE','POST_EXTRA','POST_SEG','POST_SYS','POST_DR'].includes(tag)){
      const base={POST_STATE:20,POST_EXTRA:20,POST_SEG:15,POST_SYS:15,POST_DR:6}[tag];equal(p.length,base+3,tag+' fields');
      const data=tag==='POST_STATE'?{state:state(p)}:tag==='POST_EXTRA'?{extra:extra(p)}:['POST_SEG','POST_SYS'].includes(tag)?{segment:segment(p)}:{debug:p.slice(0,6).map(v=>h(v))};
      event(tag,{...data,nativeTicks:d(p[base]),successfulQuanta:d(p[base+1]),ordinal:d(p[base+2])});
    }else if(tag==='ACTIVATE'){equal(p.length,4,'activation fields');once('activation',{cs:h(p[0],4),eip:h(p[1]),copiedBytes:d(p[2]),a20:d(p[3])});}
    else if(tag==='READY'){equal(p.length,4,'ready fields');once('ready',{cs:h(p[0],4),eip:h(p[1]),nativeTicks:d(p[2]),successfulQuanta:d(p[3])});}
    else if(tag==='PROBE'){equal(p.length,2,'probe fields');check(!Object.hasOwn(result.apiProbes,p[0]),'duplicate API probe');result.apiProbes[p[0]]=p[1];}
    else if(tag==='CMD'){equal(p.length,6,'command fields');event(tag,{seq:d(p[0]),verb:p[1],arg0:d(p[2]),arg1:d(p[3]),deadline:p[4],ordinal:d(p[5])});}
    else if(tag==='ATTEMPT'){
      equal(p.length,8,'attempt fields');const ilen=d(p[6]);check(ilen>=1&&ilen<=15&&new RegExp(`^[0-9a-f]{${2*ilen}}$`).test(p[7]),'actual instruction length/bytes');
      event(tag,{cs:h(p[0],4),eip:h(p[1]),nativeTicks:d(p[2]),successfulQuanta:d(p[3]),ordinal:d(p[4]),physicalPC:h(p[5]),ilen,hex:p[7]});
    }else if(tag==='PREFETCH'){equal(p.length,4,'prefetch fields');event(tag,{physicalPC:h(p[0]),nativeTicks:d(p[1]),successfulQuanta:d(p[2]),ordinal:d(p[3])});}
    else if(tag==='RPC_REQ'){
      equal(p.length,9,'request mirror fields');event(tag,{seq:d(p[0]),operation:p[1],arg0:d(p[2]),arg1:d(p[3]),arg2:d(p[4]),payload:p[5],nativeTicks:d(p[6]),successfulQuanta:d(p[7]),ordinal:d(p[8])});
    }else if(tag==='RPC_REP'){equal(p.length,5,'scalar reply mirror fields');event(tag,{seq:d(p[0]),value:d(p[1]),nativeTicks:d(p[2]),successfulQuanta:d(p[3]),ordinal:d(p[4])});}
    else if(tag==='RPC_MEM'){
      equal(p.length,10,'memory reply mirror fields');check(/^(?:[0-9a-f]{2}){1,16}$/.test(p[4]),'memory mirror bytes');
      event(tag,{seq:d(p[0]),decoded:h(p[1]),class:d(p[2]),effect:d(p[3]),hex:p[4],generation:d(p[5]),mappingEpoch:d(p[6]),nativeTicks:d(p[7]),successfulQuanta:d(p[8]),ordinal:d(p[9])});
    }else if(tag==='RPC_PAGE'){
      equal(p.length,9,'page reply mirror fields');check(/^[0-9a-f]{64}$/.test(p[4]),'page mirror hash');
      event(tag,{seq:d(p[0]),decoded:h(p[1]),generation:d(p[2]),class:d(p[3]),sha256:p[4],mappingEpoch:d(p[5]),nativeTicks:d(p[6]),successfulQuanta:d(p[7]),ordinal:d(p[8])});
    }else if(tag==='RPC_PIO'){equal(p.length,7,'PIO reply mirror');event(tag,{seq:d(p[0]),value:d(p[1]),a20:d(p[2]),mappingEpoch:d(p[3]),nativeTicks:d(p[4]),successfulQuanta:d(p[5]),ordinal:d(p[6])});}
    else if(tag==='COMMIT'){equal(p.length,10,'cache commit fields');check(d(p[2])>=1&&d(p[2])<=16&&new RegExp(`^[0-9a-f]{${2*d(p[2])}}$`).test(p[3]),'commit width/bytes');event(tag,{raw:h(p[0]),decoded:h(p[1]),length:d(p[2]),hex:p[3],generation:d(p[4]),mappingEpoch:d(p[5]),nativeTicks:d(p[6]),successfulQuanta:d(p[7]),ordinal:d(p[8]),boundaryKind:p[9]});}
    else if(tag==='ALIAS_UPDATE'){equal(p.length,8,'cache alias fields');check(/^[0-9a-f]{64}$/.test(p[4]),'alias SHA');event(tag,{rawPage:h(p[0]),decodedPage:h(p[1]),generation:d(p[2]),mappingEpoch:d(p[3]),sha256:p[4],nativeTicks:d(p[5]),successfulQuanta:d(p[6]),ordinal:d(p[7])});}
    else if(tag==='COHERENCE'){equal(p.length,8,'coherence fields');check(['rom-only-publish','pagewalk-publish'].includes(p[0])&&['0','1'].includes(p[2]),'coherence kind/A20');event(tag,{reason:p[0],mappingEpoch:d(p[1]),a20:d(p[2]),aliases:d(p[3]),nativeTicks:d(p[4]),successfulQuanta:d(p[5]),ordinal:d(p[6]),boundaryKind:p[7]});}
    else if(tag==='BOUNDARY'){equal(p.length,6,'boundary fields');check(boundaryKinds.includes(p[0]),'boundary kind');event(tag,{kind:p[0],attemptCS:h(p[1],4),attemptEIP:h(p[2]),nativeTicks:d(p[3]),successfulQuanta:d(p[4]),ordinal:d(p[5])});}
    else if(tag==='FAULT_BEGIN'){equal(p.length,8,'fault begin');event(tag,{vector:d(p[0]),error:d(p[1]),cr2:h(p[2]),cs:h(p[3],4),eip:h(p[4]),nativeTicks:d(p[5]),successfulQuanta:d(p[6]),ordinal:d(p[7])});}
    else if(tag==='FAULT_DELIVERED'){equal(p.length,9,'fault delivered');event(tag,{vector:d(p[0]),error:d(p[1]),cr2:h(p[2]),cs:h(p[3],4),eip:h(p[4]),sp:h(p[5]),nativeTicks:d(p[6]),successfulQuanta:d(p[7]),ordinal:d(p[8])});}
    else if(tag==='IRQ_ACK'){equal(p.length,6,'irq ack');event(tag,{vector:h(p[0],2),cs:h(p[1],4),eip:h(p[2]),nativeTicks:d(p[3]),successfulQuanta:d(p[4]),ordinal:d(p[5])});}
    else if(tag==='IRQ_DELIVERED'){equal(p.length,7,'irq delivered');event(tag,{vector:h(p[0],2),cs:h(p[1],4),eip:h(p[2]),sp:h(p[3]),nativeTicks:d(p[4]),successfulQuanta:d(p[5]),ordinal:d(p[6])});}
    else if(tag==='IRQ_LINE'){equal(p.length,4,'irq line');check(d(p[0])<=1,'line level');event(tag,{level:d(p[0]),nativeTicks:d(p[1]),successfulQuanta:d(p[2]),ordinal:d(p[3])});}
    else if(tag==='PAGE_CHUNK'){equal(p.length,3,'raw page chunk fields');check(/^[0-9a-f]{128}$/.test(p[2]),'raw page chunk bytes');d(p[0]);d(p[1]);}
    else if(tag==='QUANTUM'){
      equal(p.length,10,'quantum fields');event(tag,{kind:d(p[0]),cs:h(p[1],4),eip:h(p[2]),postECX:h(p[3]),postCX:h(p[4],4),postEDI:h(p[5]),preQ:d(p[6]),successfulQuanta:d(p[7]),nativeTicks:d(p[8]),ordinal:d(p[9])});
    }else if(tag==='NATIVE_TICK'){equal(p.length,5,'tick fields');event(tag,{count:d(p[0]),preTick:d(p[1]),nativeTicks:d(p[2]),successfulQuanta:d(p[3]),ordinal:d(p[4])});}
    else if(tag==='MEM'){equal(p.length,9,'byte memory fields');event(tag,{rw:p[0],raw:h(p[1]),decoded:h(p[2]),class:p[3],value:h(p[4],2),effect:p[5],nativeTicks:d(p[6]),ordinal:d(p[7]),why:p[8]});}
    else if(tag==='EXEC'){equal(p.length,8,'execute fields');event(tag,{rawPage:h(p[0]),decodedPage:h(p[1]),class:p[2],nativeTicks:d(p[3]),ordinal:d(p[4]),generation:d(p[5]),sha256:p[6],mappingEpoch:d(p[7])});}
    else if(tag==='PORT'){equal(p.length,6,'port fields');event(tag,{direction:p[0],port:h(p[1],4),width:d(p[2]),value:h(p[3]),nativeTicks:d(p[4]),ordinal:d(p[5])});}
    else if(tag==='HALT_IDLE'){equal(p.length,7,'halt idle fields');check(['0','512'].includes(p[3]),'halt IF');event(tag,{nativeTicks:d(p[0]),cs:h(p[1],4),eip:h(p[2]),ifFlag:d(p[3])===512,activity:d(p[4]),pending:h(p[5]),ordinal:d(p[6])});}
    else if(tag==='SLICE'){
      equal(p.length,38,'slice fields');const names=['cmdSeq','requestedNativeTicks','effectiveNativeTicks','chargedNativeTicks','requestedQuanta','chargedQuanta','reason','entryCs','entryEip','exitCs','exitEip','beforeNativeTicks','afterNativeTicks','beforeQuanta','afterQuanta','attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts','entryIf','exitIf','entryActivity','exitActivity','entryPending','exitPending','eventDue','pendingIrq','irqDelivered','irqVector','pendingFault','faultVector','faultError','faultCr2','portCommitted'];
      result.slices.push(object(names,p,{7:4,8:8,9:4,10:8,27:8,28:8,36:8}));
    }else if(tag==='FINAL'){equal(p.length,14,'final counter fields');once('finalCounters',object(finalNames,p));}
    else if(tag==='CALLBACKS'){equal(p.length,5,'callback fields');once('callbacks',object(['physicalReads','physicalWrites','executePages','nativeTickCallbacks','quantumCallbacks'],p));}
    else if(tag==='FALLBACK'){equal(p.length,5,'fallback fields');once('fallback',object(['bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer'],p));}
    else if(tag==='DEACTIVATE'){equal(p,['proof-complete'],'completion');once('deactivated',true);}
    else fail(`unknown native record ${tag}`);
  }
  for(const key of ['resetState','resetExtra','resetDebug','activation','ready','finalState','finalCounters','callbacks','fallback','deactivated'])check(Object.hasOwn(result,key),`missing ${key}`);
  equal(result.resetSegments.map(s=>s.index),[0,1,2,3,4,5],'complete reset segment caches');equal(result.resetSystem.map(s=>s.index),[6,7],'raw LDTR/TR caches');return result;
}

export const repBuildPins=Object.freeze({bochsRevision:'0e45b736ef9792eb9b752b0a35db49eaf2faea47',
 binarySha256:'a00e4cd0232cbcb3ef28ab4ba26a508da36d16052e8ab6a1516d0599f7c30a3e',configSha256:'d4945445c2412c0b4e8c5cac80cee28d443bb438c36c9ea6b1bb5196147f1e8c',runtimeSha256:'474010ee15c83f2e21edd7478077b3c3adf7f2d61a3cc6d27b727cb3589374ac'});
export const repCensus=Object.freeze({nativeTicks:137,successfulQuanta:135,completed:132,repIterations:5,faults:2,irqDeliveries:1,physicalReads:76,physicalWrites:60,executePages:14,rpcRequests:432,
 attempts:{continuous:135,budget1:137,budget2:135,budget257:135},repPartial:{continuous:1,budget1:3,budget2:1,budget257:1},haltIdleCuts:{continuous:2,budget1:1,budget2:1,budget257:2}});
export const repResetDifferences=Object.freeze({fullResetParity:false,comparisonMasks:null,
 rawReset:{edx:{javascript:0x300,native:0},cr0:{javascript:0,native:0x7ffffff0},gdtrLimit:{javascript:0,native:0xffff},idtrLimit:{javascript:0x3ff,native:0xffff},dr6:{javascript:0,native:0xffff1ff0},dr7:{javascript:0,native:0x400}},
 cr0Writes:{javascript:[0x11,0x80000011],native:[0x7ffffff1,0xfffffff1],source:'bochs/cpu/crregs.cc:1082'},
 guestRegisterProvenance:{rawCr0ReadPC:0x112,witnessStorePC:0x115,firstOverwritePC:0x1c4,gdtLoadPC:0x1b8,idtLoadPC:0x1be,edx:'guest never overwrites reset EDX'},
 budgetResumeDecodes:{mode:'budget1',sites:[{Q:73,N:73,CX:2,DI:0x5000},{Q:86,N:87,CX:1,DI:0x5004}],scope:'two exact effect-free REP redecodes after one-quantum budget cut; all raw entries retained'},
 repCheckpoint:{scope:'successful nonfinal protected16/address16/data32 REP STOSL element hook',javascript:'restart EIP',native:'decoded end RIP',nativeSource:'bochs/cpu/cpu.cc RIP increment before repeat callback'},
 rawGuestWitness:{javascript:[0,3,0,0,0,0,0,0],native:[0,0,0,0,0xf0,0xff,0xff,0x7f]}});
export const repBusDifferences=Object.freeze({fullByteBusOrderParity:false,nativeBudgetByteBusOrderParity:true,
 rule:'three-same-privilege-32bit-protected-delivery-ordinary-RAM-stack-frames',
 nativeSource:{path:'bochs/cpu/exception.cc',sha256:'c56022d1ce3a50ec9266e77f5b5cfcab29a8b6a84ceea3f4e25853e5c7460f2d',lines:[680,681,682,683,684,685]},
 javascriptOrder:'ascending byte addresses at completed frame',nativeOrder:'flags then CS then EIP then optional error, each word little-endian',
 pagewalkDifferences:{fullCallbackParity:false,rule:'native combined accessed/dirty versus JS separate A then D on five first-write translations',writeByteCounts:{javascript:56,native:36},nativeSource:{path:'bochs/cpu/paging.cc',sha256:'3ab63124df3b393624bcd2bf0f8878d56ec638bc0ebdfd1e23cf70d154a122b1',lines:[1262,1270]},scope:'exact sparse fixture code/data/delivery linear-address roles and PDE/PTE A/D transitions; native read/write TLB walk callbacks are retained separately from JS; all raw callbacks retained'},
 ordinaryReadRules:{farJump:{pc:0x1cd,Q:35,descriptor:0x608,bytes:8,javascriptReads:2,nativeReads:1},iret:[{pc:0x2ac,Q:85},{pc:0x2ac,Q:101},{pc:0x2d3,Q:119}],iretNativeOrder:[0x8ffc,0x8ff8,0x8ff4],iretJavascriptOrder:[0x8ff4,0x8ff8,0x8ffc],nativeSource:{path:'bochs/cpu/iret.cc',sha256:'afd03e8eef2e9e90470314c807161ebb2ad44397b29c3f775dec7a866b2dbdae',lines:[126,127,128]}},
 deliveries:[{kind:'fault',Q:73,sp:0x8ff0,eip:0x22c,error:2,flags:0x10046},{kind:'fault',Q:90,sp:0x8ff0,eip:0x237,error:2,flags:0x10046},{kind:'irq',Q:108,sp:0x8ff4,eip:0x255,flags:0x246}],
 scope:'exact fixture delivery sites; mapped RAM SS=10/base0/SP9000; no generic permutation, fault-partial frame, MMIO or other stack operation'});
// Guards/transport census is finalized against the new native adapter before source freeze.
export const repGuards=Object.freeze({
  'unsupported-span-width':'host-physical-read','physical-overflow':'host-physical-read',
  'unsafe-execute-ram':'unsafe-execute-page','unsupported-rep':'unsupported-rep','prefetch-non-pagewalk-write':'prefetch-non-pagewalk-write','execute-pending-write':'coherence-pending-boundary','native-a20-off':'native-a20-mask','stale-cache-generation':'execute-cache-generation','write-stage-bound':'write-stage-precondition','write-generation-overflow':'write-stage-precondition','unsafe-execute-mmio':'unsafe-execute-page','unsafe-execute-unmapped':'unsafe-execute-page',
  'unexpected-pio':'host-port-out','bochs-ram-read':'Bochs-RAM-read-fallback','bochs-ram-write':'Bochs-RAM-write-fallback',
  'bochs-direct-pointer':'Bochs-direct-pointer-fallback','bochs-pio':'Bochs-PIO-fallback','bochs-timer':'Bochs-timer-fallback','unknown-trap':'unexpected-fault',
});
export const repTransports=Object.freeze({
  'command-sequence':'rpc-command-sequence','command-prefix':'rpc-command','command-zero-budget':'rpc-run-budget',
  'command-overlong-line':'rpc-line-bound','scalar-sequence':'rpc-reply','scalar-range':'rpc-reply-range',
  'page-generation':'rpc-page-metadata','page-classification':'rpc-page-metadata','page-decoded':'rpc-page-metadata',
  'page-chunk-order':'rpc-page-chunk','page-chunk-width':'rpc-byte-length','page-end-sequence':'rpc-page-end','page-digest':'rpc-page-sha256',
  'memory-classification':'host-memory-classification','memory-write-commit':'host-write-commit','memory-generation':'rpc-memory-generation','memory-epoch':'rpc-memory-generation','page-epoch':'rpc-page-metadata',
});
let jsOracle;
export function qualifiedRepJsOracle(){
 if(!jsOracle){const bytes=gunzipSync(readFileSync(new URL('../docs/receipts/2026-10-01-i80386-js-rep-pf-pit-oracle-capture.json.gz',import.meta.url)));
  equal(repSha(bytes),'f2c3187c40173f64b0acb51cd86d0ca9ce8a250b5d634fc4e9a2c3d95c56fe1e','qualified actual JS receipt');jsOracle=JSON.parse(bytes);assertRepPfPitOracle(jsOracle);}
 return jsOracle;
}
const guestDifferenceSites=Object.freeze({readCr0:{pc:0x112,hex:'0f20c0'},storeCr0Witness:{pc:0x115,hex:'66a31405'},loadGdt:{pc:0x1b8,hex:'2e0f0116f002'},loadIdt:{pc:0x1be,hex:'2e0f011ef602'},initializeEax:{pc:0x1c4,hex:'66b811000000'}});
function guestProvenance(rom){
 const js=qualifiedRepJsOracle(),out={};
 for(const [name,site] of Object.entries(guestDifferenceSites)){
  equal(Buffer.from(rom.subarray(site.pc,site.pc+site.hex.length/2)).toString('hex'),site.hex,'declared raw-register provenance operand '+name);
  const step=js.steps.find(s=>s.before.eip===site.pc);check(step&&step.completed,'actual guest provenance site '+name);out[name]=step.quantum;
 }
 return out;
}
function expectedState(js,{reset=false,rep=false,q=Infinity,provenance}={}){
 const beforeGdt=reset||q<provenance.loadGdt,beforeIdt=reset||q<provenance.loadIdt;
 const s=Object.fromEntries(stateNames.map(n=>[n,n==='gdtrBase'?js.gdtr.base:n==='gdtrLimit'?(beforeGdt?0xffff:js.gdtr.limit):n==='idtrBase'?js.idtr.base:n==='idtrLimit'?(beforeIdt?0xffff:js.idtr.limit):js[n]]));
 s.edx=0;if(!reset&&q>=provenance.readCr0&&q<provenance.initializeEax)s.eax=0x7ffffff0;
 s.cr0=(js.cr0|0x7ffffff0)>>>0;if(rep&&js.ecx)s.eip=qualifiedRepJsOracle().rom.symbols.rep_fill+3;
 return s;
}
function hostReplay(arm,rom){
 const host=new NativeRepPfPitHost(rom);let request=null,wire=[],at=0,running=false,seq=0,stopped=false;
 const outgoing=arm.rpc.toNative,incoming=arm.rpc.fromNative;equal(incoming[0],'BWR11\tREADY\tf000\t0000fff0\t0\t0','actual READY');
 const take=line=>equal(outgoing[at++],line,'RPC chronology/reply bytes');
 for(const line of incoming.slice(1)){
  const r=parseRepRpcLine(line);
  if(r.kind==='REQ'){
   if(!running){const c=parseRepRpcLine(outgoing[at++]);equal([c.kind,c.verb,c.seq],['CMD','RUN',++seq],'RUN command order');equal([c.arg0,c.arg1,c.deadline],[600,repBudgets[arm.mode],'18446744073709551615'],'independent native/Q caps');host.beginRun();running=true;}
   wire=encodeRepReply(host.handleRequest(r));for(const reply of wire)take(reply);
  }else{
   equal(r.kind,'DONE','incoming completion');
   if(r.verb==='RUN'){
    if(!running){const c=parseRepRpcLine(outgoing[at++]);equal([c.verb,c.seq],['RUN',++seq],'empty RUN command');equal([c.arg0,c.arg1,c.deadline],[600,repBudgets[arm.mode],'18446744073709551615'],'terminal independent caps');host.beginRun();}
    equal(r.seq,seq,'RUN DONE seq');
    const slice=arm.native.slices.find(s=>s.cmdSeq===seq);check(slice,'DONE lacks actual SLICE');
    equal([r.reason,r.chargedNativeTicks,r.chargedQuanta,r.cs,r.eip,r.totalNativeTicks,r.totalQuanta,r.attempts,r.completed,r.repIterations,r.faults,r.ifFlag,r.activity,r.irqDelivered],
     [slice.reason,slice.chargedNativeTicks,slice.chargedQuanta,slice.exitCs,slice.exitEip,slice.afterNativeTicks,slice.afterQuanta,slice.attempts,slice.completed,slice.repIterations,slice.faults,slice.exitIf===512,slice.exitActivity,!!slice.irqDelivered],'complete RUN DONE/raw SLICE mirror');
    host.endRun();running=false;
    equal([r.totalNativeTicks,r.totalQuanta],[host.nativeTicks,host.successfulQuanta],'DONE actual clock tuple');
    if(r.reason===4&&r.chargedNativeTicks===0&&r.chargedQuanta===0){host.finish();const stop=parseRepRpcLine(outgoing[at++]);equal([stop.verb,stop.seq],['STOP',++seq],'STOP command');stopped=true;}
    else {const staged=host.stageLine();if(staged.changed){const c=parseRepRpcLine(outgoing[at++]);equal([c.verb,c.seq,c.arg0,c.arg1,c.deadline],['LINE',++seq,Number(staged.asserted),0,'0'],'actual LINE command');}}
   }else if(r.verb==='LINE')equal([r.seq,r.value,r.totalNativeTicks,r.totalQuanta],[seq,Number(host.lineAsserted),host.nativeTicks,host.successfulQuanta],'LINE DONE');
   else equal([stopped,r.verb,r.seq,r.value,r.totalNativeTicks,r.totalQuanta],[true,'STOP',seq,0,host.nativeTicks,host.successfulQuanta],'STOP DONE');
  }
 }
 equal(incoming.map(parseRepRpcLine).filter(r=>r.kind==='DONE'&&r.verb==='RUN').length,arm.native.slices.length,'one DONE per raw slice');equal(at,outgoing.length,'all outgoing RPC consumed');check(stopped,'terminal STOP absent');
 equal(host.journal,arm.host.journal,'actual host replay journal');equal(host.bus,arm.host.bus,'actual host byte ledger');equal(host.chipAdvances,arm.host.chipAdvances,'whole chip advance journal');
 return host;
}
function assertResetCaches(native,js){
 equal(native.resetExtra,{dr6:0xffff1ff0,dr7:0x400,es:0,fs:0,gs:0,csIndex:0x1e00,csTi:0,csRpl:0,csValid:7,csPresent:1,csDpl:0,csSegment:1,csType:3,csBase:0xffff0000,csLimit:0xffff,csGranular:0,csDefault32:0,csAvailable:0,pendingEvent:0,eventMask:0xf40},'raw reset extra/cache state');
 for(const seg of native.resetSegments)equal(seg,{index:seg.index,selector:seg.index===1?0xf000:0,selectorIndex:seg.index===1?0x1e00:0,ti:0,rpl:0,valid:7,present:1,dpl:0,segment:1,type:3,base:js.reset.cpu.segmentCaches[seg.index].base,limit:0xffff,granular:0,default32:0,available:0},'complete raw reset segment');
 for(const seg of native.resetSystem)equal(seg,{index:seg.index,selector:0,selectorIndex:0,ti:0,rpl:0,valid:1,present:1,dpl:0,segment:0,type:seg.index===6?2:11,base:0,limit:0xffff,granular:0,default32:0,available:0},'complete raw reset system segment');
}
function assertSegment(s,js,resetSegments){
 const name=['es','cs','ss','ds','fs','gs'][s.index],cache=js.segmentCaches[s.index];check(cache,'JS segment cache');
 const protectedLoaded=Object.hasOwn(cache,'access');
 equal([s.selector,s.base,s.limit,s.present,s.dpl,s.segment,s.granular,s.default32,s.available],
  [js[name],cache.base,cache.limit,1,cache.dpl??0,1,0,Number(cache.default32),0],'full segment descriptor/cache attributes');
 equal([s.selectorIndex,s.ti,s.rpl],[protectedLoaded?js[name]>>>3:resetSegments[s.index].selectorIndex,0,js[name]&3],'raw selector parsed provenance');
 equal(s.type,protectedLoaded?cache.access&15:3,'native segment type/accessed attribute');
 check([1,3,5,7].includes(s.valid),'native cache valid flags');
}
export function assertNativeRepPfPitArmProof(arm,rom){
 const js=qualifiedRepJsOracle(),provenance=guestProvenance(rom);equal(repSha(rom),js.rom.sha256,'owned immutable ROM');equal(arm.requestedBudget,repBudgets[arm.mode],'actual arm requested Q budget');equal([arm.artifacts.exitCode,arm.artifacts.signal],[0,null],'actual native exit');
 const native=parseRepNativeLog(arm.raw.stderr);equal(native.activation,{cs:0xf000,eip:0xfff0,copiedBytes:0,a20:1},'cold activation no RAM seed');equal(native.ready,{cs:0xf000,eip:0xfff0,nativeTicks:0,successfulQuanta:0},'native ready/reset clock');equal(native,arm.native,'raw parser binding');const host=hostReplay(arm,rom);
 equal(arm.host.initial,host.initial,'initial actual board');equal(arm.host.reset,host.reset,'single reset epoch');equal(arm.host.seed,host.seed,'actual initial backing');
 equal(native.resetState,expectedState(js.reset.cpu,{reset:true,provenance}),'named raw reset fields');
 equal(native.resetDebug,[0,0,0,0,0xffff1ff0,0x400],'raw native reset debug');assertResetCaches(native,js);equal(native.apiProbes,{'resume-before-activation':'rejected','irq-before-activation':'rejected','zero-native-budget':'rejected','zero-quantum-budget':'rejected','null-callbacks':'rejected','incomplete-native-tick':'rejected','incomplete-quantum':'rejected','due-now':'zero-work','invalid-irq-line':'rejected','callback-reentry':'rejected','line-reentry':'rejected'},'all actual API probes');
 equal(native.resetSegments.map(s=>s.index),[0,1,2,3,4,5],'reset segment inventory');equal(native.resetSystem.map(s=>s.index),[6,7],'reset system inventory');
 equal(native.fallback,{bochsRamReads:0,bochsRamWrites:0,bochsDirectPointers:0,bochsPio:0,bochsTimer:0},'zero fallback exact shape');
 const quanta=native.events.filter(e=>e.tag==='QUANTUM'),faults=native.events.filter(e=>e.tag==='FAULT_DELIVERED'),irqs=native.events.filter(e=>e.tag==='IRQ_DELIVERED');
 equal(quanta.length,135,'bounded successful work census');equal(faults.length,2,'two PF');equal(irqs.length,1,'one IRQ');equal(host.machine.cycles,814,'reset plus actual Q clocks');equal(host.machine.cpu.cycles,0,'no JS CPU execution');
 let q=0,n=0,nativeLine=0,pending=[],boundary=null,postCount=0,checkpoint=js.reset.cpu,postSegments=[],postSystem=[],postExtra=null,published=false,pages=new Map(),currentAttempt=null,activeRpc=null,workWrites=new Map(),workOperations=new Map(),checkpointBoard=js.reset.board,latestHost={board:host.reset};
 for(const e of native.events){
  if(activeRpc)check(e.tag===({MEM:'RPC_MEM',PAGE:'RPC_PAGE',REP:'RPC_REP'})[activeRpc.reply.kind],'reply must immediately complete owned synchronous RPC');
  if(e.tag==='RPC_REQ'){check(!activeRpc,'RPC request reentry');activeRpc=host.journal.find(x=>x.kind==='request'&&x.request.seq===e.seq);check(activeRpc,'extra raw RPC request');}
  else if(['RPC_REP','RPC_MEM','RPC_PAGE'].includes(e.tag)){check(activeRpc&&activeRpc.request.seq===e.seq,'reply order/sequence');latestHost=activeRpc.after;activeRpc=null;}
  if(boundary)check(['COMMIT','COHERENCE','POST_STATE','POST_EXTRA','POST_SEG','POST_SYS','POST_DR'].includes(e.tag),'boundary publication/checkpoint must finish before CPU or clock advance');
  if(e.tag==='QUANTUM'){
   equal(e.nativeTicks,n,'Q independent N tuple');equal([e.preQ,e.successfulQuanta],[q,q+1],'Q ledger');
   const step=js.steps.find(s=>s.completed&&s.quantum===q+1);check(step,'successful quantum qualified step');
   check(currentAttempt,'quantum lacks actual instruction attempt');
   const opcode=currentAttempt.hex;
   const kind=opcode==='66f3ab'&&(step.before.ecx&0xffff)!==0?1:0;
   equal([e.kind,e.cs,e.eip,e.postECX,e.postCX,e.postEDI],[kind,currentAttempt.cs,currentAttempt.eip,step.after.ecx,step.after.ecx&0xffff,step.after.edi],'quantum kind/site and committed REP progress');q++;
  }
  else if(e.tag==='NATIVE_TICK'){equal([e.count,e.preTick,e.nativeTicks,e.successfulQuanta],[1,n,n+1,q],'independent native tick ledger');n++;}
  else if(Object.hasOwn(e,'nativeTicks'))equal([e.nativeTicks,e.successfulQuanta??q],[n,q],'raw event clock chronology');
  if(e.tag==='IRQ_LINE')nativeLine=e.level;
  if(e.tag==='MEM'&&e.why==='data'){if(!workOperations.has(q+1))workOperations.set(q+1,[]);workOperations.get(q+1).push({rw:e.rw,raw:e.raw,decoded:e.decoded,value:e.value});}
  if(e.tag==='MEM'&&e.rw==='W'&&e.why==='data'){if(!workWrites.has(q+1))workWrites.set(q+1,[]);workWrites.get(q+1).push({raw:e.raw,decoded:e.decoded,value:e.value});}
  if(e.tag==='RPC_PAGE'){const r=host.journal.find(x=>x.kind==='request'&&x.request.seq===e.seq);check(r&&r.request.operation==='PAGE','page request mirror');equal([e.decoded,e.generation,e.class,e.sha256,e.mappingEpoch],[r.reply.decoded,0,2,r.reply.sha256,0],'immutable ROM page mirror');check(!pages.has(r.request.arg0)&&pages.size<32,'persistent ROM page slots');pages.set(r.request.arg0,r.reply);}
  else if(e.tag==='EXEC'){check(!pending.length&&!boundary,'execute before complete publication');equal(e.rawPage,(checkpoint.pc&0xfffff000)>>>0,'execute admission current architectural page');const page=pages.get(e.rawPage);check(page,'execute before page admission');equal([e.decodedPage,e.class,e.generation,e.sha256,e.mappingEpoch],[page.decoded,'rom',0,page.sha256,0],'execute ROM pointer SHA/generation');}
  else if(e.tag==='ATTEMPT'){check(!pending.length&&!boundary,'attempt before complete publication');equal([e.cs,e.eip,e.physicalPC],[checkpoint.cs,checkpoint.eip,checkpoint.pc],'attempt current architectural PC');currentAttempt=e;const page=pages.get((e.physicalPC&0xfffff000)>>>0);check(page,'instruction cache page absent');const bytes=Buffer.concat(page.chunks.map(c=>Buffer.from(c.hex,'hex')));equal(e.hex,bytes.subarray(e.physicalPC&4095,(e.physicalPC&4095)+e.ilen).toString('hex'),'actual decoded instruction bytes from immutable page');}
  else if(e.tag==='PREFETCH'){equal(e.physicalPC,checkpoint.pc,'actual prefetch current architectural PC');}
  else if(e.tag==='RPC_MEM'){
   const r=host.journal.find(x=>x.kind==='request'&&x.request.seq===e.seq);check(r,'memory actual RPC');
   equal([e.decoded,e.class,e.effect,e.hex,e.generation,e.mappingEpoch],[r.reply.decoded,r.reply.class,r.reply.effect,r.reply.hex,r.reply.generation,0],'memory reply mirror');
   if(r.request.operation==='WRITE'&&r.reply.class===1)pending.push(r);
  }else if(e.tag==='BOUNDARY'){check(!boundary,'nested boundary');if(e.kind==='prefetch-pagewalk')for(const p of pending){const mem=native.events.filter(x=>x.tag==='MEM'&&x.rw==='W'&&x.raw>=p.request.arg0&&x.raw<p.request.arg0+p.request.arg1&&x.ordinal<e.ordinal).slice(-p.request.arg1);check(mem.length===p.request.arg1&&mem.every(x=>['pde-ad-write','pte-ad-write'].includes(x.why)),'prefetch drains only pagewalk A/D effects');}if(['ordinary','rep-element'].includes(e.kind)){
    const quantum=quanta.find(x=>x.successfulQuanta===q);check(quantum,'work boundary without successful quantum');
    equal(e.kind,quantum.kind===1?'rep-element':'ordinary','work boundary exact quantum kind');
    equal([e.attemptCS,e.attemptEIP],[quantum.cs,quantum.eip],'work boundary exact quantum attempt');
   }boundary=e;postCount=0;postSegments=[];postSystem=[];postExtra=null;published=false;}
  else if(e.tag==='COMMIT'){
   check(boundary&&!published,'commit lacks uncompleted owning boundary');equal([e.nativeTicks,e.successfulQuanta],[boundary.nativeTicks,boundary.successfulQuanta],'commit exact owning boundary tuple');const p=pending.shift();check(p,'extra cache commit');
   equal([e.raw,e.decoded,e.length,e.hex,e.generation,e.mappingEpoch,e.boundaryKind],[p.request.arg0,p.reply.decoded,p.request.arg1,p.request.payload,p.reply.generation,0,boundary.kind],'exact acknowledged RAM commit');
  }else if(e.tag==='COHERENCE'){
   check(boundary&&!pending.length&&!published,'incomplete or duplicate effects publication');published=true;equal([e.nativeTicks,e.successfulQuanta],[boundary.nativeTicks,boundary.successfulQuanta],'coherence exact owning boundary tuple');equal([e.reason,e.mappingEpoch,e.a20,e.aliases,e.boundaryKind],[boundary.kind==='prefetch-pagewalk'?'pagewalk-publish':'rom-only-publish',0,1,0,boundary.kind],'explicit ROM-only effect publication');
  }else if(e.tag==='POST_STATE'){
   check(boundary&&published,'post state without completed boundary publication');
   if(['ordinary','rep-element'].includes(boundary.kind)){
    const step=js.steps.find(s=>s.completed&&s.quantum===q);check(step,'JS work checkpoint');const expected=expectedState(step.after,{rep:boundary.kind==='rep-element',q,provenance});
    checkpoint=step.after;checkpointBoard=step.boardAfter;equal(e.state,expected,'successful raw CPU checkpoint and named differences');
   }else if(['fault-delivery','irq-delivery'].includes(boundary.kind)){
    const d=js.deliveries.find(d=>d.quantum===q&&d.kind===(boundary.kind==='fault-delivery'?'fault':'irq'));check(d,'JS delivery boundary');checkpoint=d.after.cpu;checkpointBoard=d.after.board;equal(e.state,expectedState(d.after.cpu,{q,provenance}),'zero-work delivery CPU');
   }else equal(e.state,expectedState(checkpoint,{q,provenance}),'pagewalk publication retains current raw CPU state');
   equal(latestHost.board,checkpointBoard,'every work/delivery/pagewalk boundary complete actual board state');
   postCount++;
  }else if(e.tag==='POST_EXTRA'){
   check(boundary&&postCount===1&&!postExtra,'full extra checkpoint order');postExtra=e.extra;
   // CPU3 signal_INTR/clear_INTR owns bit10; set_IF owns the fixed-profile event mask.
   equal([e.extra.pendingEvent,e.extra.eventMask],[nativeLine?0x400:0,(checkpoint.eflags&0x200)?0x100:0xf40],'raw native pending interrupt and IF event mask');
   equal([e.extra.dr6,e.extra.dr7,e.extra.es,e.extra.fs,e.extra.gs],[0xffff1ff0,0x400,checkpoint.es,checkpoint.fs,checkpoint.gs],'raw debug/extra selectors');
  }else if(e.tag==='POST_SEG'){
   check(boundary&&postExtra,'segment outside full checkpoint');equal(e.segment.index,postSegments.length,'full six segment order');assertSegment(e.segment,checkpoint,native.resetSegments);postSegments.push(e.segment);
  }else if(e.tag==='POST_SYS'){
   equal(e.segment,native.resetSystem[postSystem.length],'raw system caches unchanged');postSystem.push(e.segment);
  }else if(e.tag==='POST_DR'){
   check(postCount===1&&postExtra&&postSegments.length===6&&postSystem.length===2,'full boundary checkpoint ordering');equal(e.debug,native.resetDebug,'all debug registers');
   const cs=postSegments[1];equal([postExtra.csIndex,postExtra.csTi,postExtra.csRpl,postExtra.csValid,postExtra.csPresent,postExtra.csDpl,postExtra.csSegment,postExtra.csType,postExtra.csBase,postExtra.csLimit,postExtra.csGranular,postExtra.csDefault32,postExtra.csAvailable],
    [cs.selectorIndex,cs.ti,cs.rpl,cs.valid,cs.present,cs.dpl,cs.segment,cs.type,cs.base,cs.limit,cs.granular,cs.default32,cs.available],'full extra/CS cache mirror');boundary=null;
  }
  else if(['ATTEMPT','EXEC'].includes(e.tag))check(!pending.length&&!boundary,'CPU fetch before committed effects');
 }
 equal([q,host.successfulQuanta],[135,135],'final Q ledger');equal(n,host.nativeTicks,'final independent N');check(!pending.length&&!boundary,'terminal pending effects');
 const rq=host.journal.filter(e=>e.kind==='request');
 const rqProjection=r=>[r.seq,r.operation,r.arg0,r.arg1,r.arg2,r.payload,r.nativeTicks,r.successfulQuanta];
 equal(native.events.filter(e=>e.tag==='RPC_REQ').map(rqProjection),rq.map(e=>rqProjection(e.request)),'all raw RPC request mirrors');
 equal(native.events.filter(e=>e.tag==='RPC_REP').map(e=>[e.seq,e.value]),rq.filter(e=>e.reply.kind==='REP').map(e=>[e.reply.seq,e.reply.value]),'all raw scalar reply mirrors');
 equal(native.records.filter(r=>r.tag==='PAGE_CHUNK').map(r=>r.fields),rq.filter(e=>e.reply.kind==='PAGE').flatMap(e=>e.reply.chunks.map(c=>[String(e.reply.seq),String(c.index),c.hex])),'all raw page payload chunks');
 const counts=native.finalCounters;
 equal([counts.nativeTicks,counts.successfulQuanta,counts.faults,counts.irqDeliveries,counts.repIterations,counts.quantumCallbacks,counts.nativeTickCallbacks],[n,q,2,1,5,q,n],'raw final independent counters');
 equal(Object.keys(native.callbacks).sort(),['executePages','nativeTickCallbacks','physicalReads','physicalWrites','quantumCallbacks'],'callback exact shape');
 const requestRows=host.journal.filter(e=>e.kind==='request');
 equal(native.callbacks,{physicalReads:requestRows.filter(e=>e.request.operation==='READ').length,physicalWrites:requestRows.filter(e=>e.request.operation==='WRITE').length,executePages:native.events.filter(e=>e.tag==='EXEC').length,nativeTickCallbacks:n,quantumCallbacks:q},'actual callback summary');
 equal([counts.rpcRequests,counts.rpcReplies],[requestRows.length,requestRows.length],'all synchronous RPC completed');
 equal(counts.attempts,native.events.filter(e=>e.tag==='ATTEMPT').length,'actual attempt rows');
 equal(counts.completed+counts.repPartial+counts.faults,counts.attempts,'attempt/completion/partial/fault covariance');equal([counts.completed,counts.attempts,counts.repPartial,counts.haltIdleCuts],[repCensus.completed,repCensus.attempts[arm.mode],repCensus.repPartial[arm.mode],repCensus.haltIdleCuts[arm.mode]],'measured bounded completion/resume/physical-idle census');equal(native.callbacks,{physicalReads:76,physicalWrites:60,executePages:14,nativeTickCallbacks:137,quantumCallbacks:135},'measured fixed native callback census');
 equal(counts.portCommits,native.events.filter(e=>e.tag==='PORT').length,'PIO commit census');
 const records=native.records;let attemptCount=0,idleCount=0,portCount=0,sliceAt=0;
 for(const record of records){if(record.tag==='ATTEMPT')attemptCount++;if(record.tag==='HALT_IDLE')idleCount++;if(record.tag==='PORT')portCount++;
  if(record.tag==='SLICE'){const slice=native.slices[sliceAt++];equal([slice.attempts,slice.portCommits,slice.haltIdleCuts],[attemptCount,portCount,idleCount],'raw cumulative slice witness');equal([slice.requestedQuanta,slice.requestedNativeTicks],[repBudgets[arm.mode],600],'each raw slice requested caps');check(slice.chargedQuanta<=repBudgets[arm.mode]&&slice.chargedNativeTicks<=slice.effectiveNativeTicks,'native cap overrun');}}
 equal(counts.haltIdleCuts,idleCount,'physical HALT count retained');check(idleCount>=1&&idleCount<=2,'bounded terminal idle observations');
 for(const step of js.steps.filter(s=>s.completed)){
  const expected=js.events.filter(e=>e.kind==='write'&&!e.paging&&e.ordinal>=step.firstOrdinal&&e.ordinal<=step.lastOrdinal&&!js.deliveries.some(d=>e.ordinal>=d.firstOrdinal&&e.ordinal<=d.lastOrdinal)).map(e=>({raw:e.address,decoded:e.decoded,value:e.decoded>=0x510&&e.decoded<0x518?repResetDifferences.rawGuestWitness.native[e.decoded-0x510]:e.value}));
  equal(workWrites.get(step.quantum)??[],expected,'ordered ordinary/REP per-Q data writes with only raw reset witnesses');
  let operations=js.events.filter(e=>['read','write'].includes(e.kind)&&!e.paging&&!(e.kind==='read'&&e.decoded>=0x9000&&e.decoded<0xb000)&&e.ordinal>=step.firstOrdinal&&e.ordinal<=step.lastOrdinal&&!js.deliveries.some(d=>e.ordinal>=d.firstOrdinal&&e.ordinal<=d.lastOrdinal)).map(e=>({rw:e.kind==='write'?'W':'R',raw:e.address,decoded:e.decoded,value:e.kind==='write'&&e.decoded>=0x510&&e.decoded<0x518?repResetDifferences.rawGuestWitness.native[e.decoded-0x510]:e.value}));
  const rules=repBusDifferences.ordinaryReadRules;
  if(step.quantum===rules.farJump.Q){equal(step.before.eip,rules.farJump.pc,'exact far jump read site');const first=operations.slice(0,8),second=operations.slice(8,16);equal(first,second,'JS two descriptor reads retained');equal(first.map(e=>[e.rw,e.raw]),Array.from({length:8},(_,i)=>['R',0x608+i]),'descriptor exact eight-byte read');operations=[...first,...operations.slice(16)];}
  if(rules.iret.some(r=>r.Q===step.quantum)){equal(step.before.eip,rules.iret.find(r=>r.Q===step.quantum).pc,'exact IRET read site');equal(operations.slice(0,12).map(e=>[e.rw,e.raw]),Array.from({length:12},(_,i)=>['R',0x8ff4+i]),'JS exact ascending IRET frame reads');operations=[...operations.slice(8,12),...operations.slice(4,8),...operations.slice(0,4),...operations.slice(12)];}
  equal(workOperations.get(step.quantum)??[],operations,'strict per-Q ordered data bus with only four declared read rules');
 }
 const actualBytes=host.bus;let byteAt=0;const memEvents=native.events.filter(e=>e.tag==='MEM');
 for(const e of memEvents){const b=actualBytes[byteAt++];check(b,'extra native byte callback');equal([e.rw,e.raw,e.decoded,e.class,e.value,e.effect,e.nativeTicks],[b.kind==='write'?'W':'R',b.raw,b.decoded,({1:'ram',2:'rom',4:'unmapped'})[b.class],b.value,({1:'ram-read',2:'ram-commit',3:'rom-read',4:'rom-ignored',7:'open-bus',8:'unmapped-ignored'})[b.effect],b.nativeTicks],'every native physical byte is actual board callback');}
 equal(byteAt,actualBytes.length,'all actual board bytes retained');
 const walkSites=[
  {Q:44,linear:js.steps.find(s=>s.completed&&s.quantum===44).after.pc,role:'code-after-PG'},
  {Q:71,linear:0x4ff8,role:'REP-first-write'},
  {Q:73,linear:0x5000,role:'failed-REP-write'},{Q:73,linear:14*8,role:'PF-IDT-read'},{Q:73,linear:0x9000-4,role:'PF-frame-write'},
  {Q:77,linear:0x520,role:'first-CR2-witness-write'},{Q:78,linear:0xa000+5*4,role:'PTE5-repair-write'},
  {Q:83,linear:js.steps.find(s=>s.completed&&s.quantum===83).after.pc,role:'code-after-first-CR3-reload'},
  {Q:84,linear:0x9000-4,role:'first-IRET-stack-read'},{Q:84,linear:0x600+8,role:'first-IRET-code-descriptor-read'},
  {Q:85,linear:0x5000,role:'REP-retry-write'},{Q:90,linear:0x6000,role:'failed-ordinary-write'},{Q:90,linear:0x9000-4,role:'second-PF-frame-write'},
  {Q:94,linear:0x528,role:'second-CR2-witness-write'},{Q:95,linear:0xa000+6*4,role:'PTE6-repair-write'},
  {Q:99,linear:js.steps.find(s=>s.completed&&s.quantum===99).after.pc,role:'code-after-second-CR3-reload'},
  {Q:100,linear:0x9000-4,role:'second-IRET-stack-read'},{Q:100,linear:0x600+8,role:'second-IRET-code-descriptor-read'},
  {Q:101,linear:0x6000,role:'ordinary-retry-write'},{Q:107,linear:0x530,role:'STI-successor-write'},{Q:108,linear:0x9000-4,role:'IRQ-frame-write'}];
 const tableReads=[];
 for(const r of requestRows.filter(e=>e.request.operation==='READ')){
  const bytes=actualBytes.map((b,i)=>({...b,why:memEvents[i].why})).filter(b=>b.seq===r.request.seq);
  if(!bytes.some(b=>['pde-read','pte-read'].includes(b.why)))continue;
  check(bytes.length===4&&bytes.every(b=>b.why===bytes[0].why)&&r.request.arg1===4,'whole typed PDE/PTE read');
  tableReads.push([r.request.successfulQuanta,r.request.arg0,bytes[0].why]);
 }
 equal(tableReads,walkSites.flatMap(site=>[[site.Q,0x9000+((site.linear>>>22)&1023)*4,'pde-read'],[site.Q,0xa000+((site.linear>>>12)&1023)*4,'pte-read']]),'PDE/PTE reads derive exact fixture code/data/delivery linear-address roles');
 const adWrites=[];
 for(const r of requestRows.filter(e=>e.request.operation==='WRITE')){
  const bytes=actualBytes.map((b,i)=>({...b,why:memEvents[i].why})).filter(b=>b.seq===r.request.seq);
  if(!bytes.some(b=>['pde-ad-write','pte-ad-write'].includes(b.why)))continue;
  check(bytes.length===4&&bytes.every(b=>b.why===bytes[0].why)&&r.request.arg1===4&&(r.request.arg0&3)===0,'whole typed table A/D update');
  const old=bytes.reduce((v,b,i)=>v+b.before*2**(8*i),0)>>>0,next=Buffer.from(r.request.payload,'hex').readUInt32LE(0);
  check((old&1)!==0&&next!==old&&((next^old)&~0x60)===0&&(next|old)===next,'A/D update preserves base/present/permission and only sets accessed/dirty');
  if(bytes[0].why==='pde-ad-write')equal([r.request.arg0,next^old],[0x9000,0x20],'PDE accessed-only write');
  else check([0xa000,0xa010,0xa014,0xa018,0xa020,0xa028,0xa3c0].includes(r.request.arg0),'PTE A/D targets exact sparse mapping');
  adWrites.push([r.request.successfulQuanta,r.request.arg0,next,bytes[0].why]);
 }
 equal(adWrites,[[44,0x9000,0xa023,'pde-ad-write'],[44,0xa3c0,0xf0023,'pte-ad-write'],[71,0xa010,0x4063,'pte-ad-write'],[73,0xa000,0x23,'pte-ad-write'],[73,0xa020,0x8063,'pte-ad-write'],[77,0xa000,0x63,'pte-ad-write'],[78,0xa028,0xa063,'pte-ad-write'],[85,0xa014,0x5063,'pte-ad-write'],[101,0xa018,0x6063,'pte-ad-write']],'source-backed retained native pagewalk bit-transition ledger');
 equal(native.events.filter(e=>e.tag==='FAULT_BEGIN').length,2,'exact failed attempt begin count');
 equal(native.events.filter(e=>e.tag==='IRQ_ACK').length,1,'exact eligible interrupt ACK count');
 for(const [index,rule] of repBusDifferences.deliveries.entries()){
  const delivered=index<2?faults[index]:irqs[0];equal([delivered.successfulQuanta,delivered.sp,delivered.vector,delivered.cs,delivered.eip],[rule.Q,rule.sp,index<2?14:32,8,index<2?js.rom.symbols.pf_handler:js.rom.symbols.irq_handler],'exact declared delivery site');
  const begin=native.events.filter(e=>e.ordinal<delivered.ordinal&&e.tag===(index<2?'FAULT_BEGIN':'IRQ_ACK')).at(-1);check(begin,'delivery begin absent');
  if(index<2){
   equal([begin.vector,begin.error,begin.cr2,begin.cs,begin.eip,begin.nativeTicks,begin.successfulQuanta],[14,2,index===0?0x5000:0x6000,8,rule.eip,index===0?73:91,rule.Q],'exact failed attempt page-fault begin');
   equal([delivered.error,delivered.cr2,delivered.nativeTicks],[2,begin.cr2,begin.nativeTicks+1],'fault delivery retains cause and charges only independent native tick');
  }else equal([begin.vector,begin.cs,begin.eip,begin.nativeTicks,begin.successfulQuanta,delivered.nativeTicks],[32,8,js.rom.symbols.after_shadow,110,108,110],'IRQ ACK exact STI successor eligibility and zero-work delivery');

  const writes=memEvents.filter(e=>e.ordinal>begin.ordinal&&e.ordinal<delivered.ordinal&&e.rw==='W'&&e.raw>=rule.sp&&e.raw<0x9000);
  const words=index<2?[[0x8ffc,rule.flags],[0x8ff8,8],[0x8ff4,rule.eip],[0x8ff0,2]]:[[0x8ffc,rule.flags],[0x8ff8,8],[0x8ff4,rule.eip]];
  const expected=words.flatMap(([address,value])=>Array.from({length:4},(_,i)=>({raw:address+i,value:(value>>>(8*i))&255})));
  equal(writes.map(e=>({raw:e.raw,value:e.value})),expected,'narrow native delivery word/byte order and RF');
 }
 const expectedBacking=Buffer.alloc(repBoardConfig.memoryBytes);Buffer.from(rom).copy(expectedBacking,0xf0000);Buffer.from(rom).copy(expectedBacking,repBoardConfig.experimentalResetRomAliasBase??0xff0000);
 equal(repSha(expectedBacking),arm.host.seed.sha256,'fresh actual zero-RAM plus immutable ROM seed');
 for(const e of js.events.filter(e=>e.kind==='write')){if(e.decoded<0xa0000)expectedBacking[e.decoded]=e.value;}
 Buffer.from(repResetDifferences.rawGuestWitness.native).copy(expectedBacking,0x510);
 equal(repSha(host.machine.mem),repSha(expectedBacking),'entire actual backing with only named raw reset witness difference');
 equal(arm.host.final.memorySha256,repSha(host.machine.mem),'actual final backing digest');
 const edges=host.journal.filter(e=>e.kind==='pit-output');equal(edges.map(e=>[e.channel,e.level,e.successfulQuanta,e.boardCycles]),[[0,1,72,436]],'actual active edge after one REP success');
 const requestJournal=host.journal.filter(e=>e.kind==='request');
 equal(requestJournal.filter(e=>e.request.operation==='QUANTUM').map(e=>[e.request.arg0,e.request.arg1,e.request.arg2]),quanta.map(e=>[e.kind,0,0]),'raw quantum kind matches actual host RPC');
 for(const e of requestJournal.filter(e=>e.request.operation==='QUANTUM')){const step=js.steps.find(s=>s.completed&&s.quantum===e.after.successfulQuanta);equal(e.after.board,step.boardAfter,'every successful quantum whole configured board/debt');}
 const final=arm.host.final;equal(final.after.board,js.final.board,'complete terminal board/chips/debt');equal(final.destination,js.final.destination,'four REP destination words');equal(final.page6,js.final.page6,'ordinary/one REP words');equal(final.pte5,js.final.pte5,'first repaired PTE');equal(final.pte6,js.final.pte6,'second repaired PTE');
 equal(final.resetWitness,repResetDifferences.rawGuestWitness.native,'raw native reset witness');equal(host.marker,Array.from(Buffer.from('RPPT001')),'actual PIO marker');
 return {successfulQuanta:q,nativeTicks:n,faults:2,irq:32,boardClocks:814};
}

const historyCache=new Map(),inventoryCache=new Map();
function historicalBlob(revision,file){
  const key=revision+':'+file;
  // Commit-qualified blobs are immutable. Internal callers only hash or decode these bytes.
  if(historyCache.has(key))return historyCache.get(key);
  try{
    const bytes=execFileSync('git',['show',key],{cwd:root,maxBuffer:4<<20,stdio:['ignore','pipe','pipe']});
    historyCache.set(key,bytes);return bytes;
  }catch(error){
    const detail={revision,status:error.status??null,signal:error.signal??null,code:error.code??null,
      stderr:Buffer.isBuffer(error.stderr)?error.stderr.toString('utf8'):String(error.stderr??''),message:error.message};
    fail(`historical source blob unavailable ${file}; git show failure ${JSON.stringify(detail)}`);
  }
}
function historicalInventory(revision){
  if(inventoryCache.has(revision))return inventoryCache.get(revision);
  const runner='scripts/run-i80386-native-rep-pf-pit-board-gate.mjs';
  const text=historicalBlob(revision,runner).toString('utf8');
  const literal=text.match(/const sourceSeeds=\[([\s\S]*?)\];/);
  check(literal,'captured runner literal source inventory');
  const seeds=[...literal[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
  check(seeds.length>0&&literal[1].replace(/'[^']+'/g,'').replace(/[\s,]/g,'')==='','captured source seeds must be literal strings');
  const queue=seeds.map(f=>path.posix.normalize(path.posix.join('scripts',f))),found=new Set();
  const patterns=[/\b(?:import|export)\s+(?:[^;]*?\sfrom\s*)?['"](\.[^'"]+)['"]/g,/\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g];
  while(queue.length){
    const file=queue.pop();if(found.has(file))continue;
    check(!file.startsWith('/')&&!file.split('/').includes('..'),'historical inventory path escapes repository');
    const bytes=historicalBlob(revision,file);found.add(file);
    if(!/\.(?:mjs|js)$/.test(file))continue;
    const module=bytes.toString('utf8');
    for(const pattern of patterns){pattern.lastIndex=0;let m;while((m=pattern.exec(module)))queue.push(path.posix.normalize(path.posix.join(path.posix.dirname(file),m[1])));}
  }
  const paths=[...found].sort();inventoryCache.set(revision,paths);return paths;
}
function artifactProof(report){
  const seen=new Set();
  const file=(entry)=>{
    equal(Object.keys(entry).sort(),['path','sha256'],'artifact shape');
    check(typeof entry.path==='string'&&/^[a-zA-Z0-9._-]+$/.test(entry.path),'unsafe artifact path');
    check(!seen.has(entry.path),'duplicate artifact path');seen.add(entry.path);
    check(/^[0-9a-f]{64}$/.test(entry.sha256),'artifact digest');
  };
  const groups=['bochsrc',...Object.keys(repBudgets),...Object.keys(repGuards).map(n=>'guard-'+n),...Object.keys(repTransports).map(n=>'transport-'+n)];
  equal(Object.keys(report.artifacts).sort(),groups.sort(),'complete actual artifact groups');
  file(report.artifacts.bochsrc);equal(report.artifacts.bochsrc.sha256,report.source.bochsrcSha256,'bochsrc source artifact mirror');
  for(const name of Object.keys(repBudgets)){
    equal(report.arms[name].artifacts,report.artifacts[name],'arm artifact mirror');
    equal(Object.keys(report.artifacts[name].files).sort(),['bochsLog','rpcFromNative','rpcToNative','stderr','stdout'],'arm raw artifact set');
    for(const entry of Object.values(report.artifacts[name].files))file(entry);
    equal(Object.keys(report.arms[name].raw).sort(),['rpcFromNative','rpcToNative','stderr','stdout'],'arm complete raw strings');
    for(const [kind,text] of Object.entries(report.arms[name].raw)){equal(repSha(text),report.artifacts[name].files[kind].sha256,'arm actual raw artifact digest');}
    equal(parseRepNativeLog(report.arms[name].raw.stderr),report.arms[name].native,'raw stderr native parser binding');
    equal(report.arms[name].raw.rpcToNative,report.arms[name].rpc.toNative.join('\n')+'\n','raw outgoing RPC binding');
    equal(report.arms[name].raw.rpcFromNative,report.arms[name].rpc.fromNative.join('\n')+'\n','raw incoming RPC binding');
  }
  for(const [group,expected,prefix] of [[report.probes,repGuards,'guard'],[report.transportProbes,repTransports,'transport']]){
    equal(Object.keys(group).sort(),Object.keys(expected).sort(),'actual rejection probe set');
    for(const [name,reason] of Object.entries(expected)){
      const probe=group[name];equal([probe.name,probe.expected,probe.observedFailure],[name,reason,reason],'named native FAIL witness');
      equal(probe.exit,{code:null,signal:'SIGABRT'},'native rejection exit');
      equal(probe.files,report.artifacts[prefix+'-'+name],'rejection artifact mirror');
      equal(Object.keys(probe.files).sort(),['bochsLog','rpcFromNative','rpcToNative','stderr','stdout'],'rejection raw artifact set');
      for(const entry of Object.values(probe.files))file(entry);
      equal(Object.keys(probe.raw).sort(),['rpcFromNative','rpcToNative','stderr','stdout'],'probe complete raw strings');
      for(const [kind,text] of Object.entries(probe.raw))equal(repSha(text),probe.files[kind].sha256,'rejection actual raw artifact digest');
      equal([...probe.raw.stderr.matchAll(/^BWS11\tFAIL\t([^\n]+)$/gm)].map(m=>m[1]),[reason],'raw named FAIL witness');
      if(prefix==='transport')equal(probe.injected,true,'actual transport injection reached');
    }
  }
}
export const repQualifiedPatchedHashes=Object.freeze({
  "bochs/bochs.h": "7c18c551557eb269b52d6a5f804d38ead45c4f268528fc7ea46429b32508c501",
  "bochs/cpu/cpu.cc": "16a7b2a3640f2fb3d8df92f8916f8d5bc628e6ed8a7658c07b8db1c101ec80d9",
  "bochs/cpu/paging.cc": "b919658b9f7b726efe3796cab3a5c05bbd4a64e047a771be36394ff9d01bd4b2",
  "bochs/cpu/exception.cc": "5701d81b89fda61a6c357e63fff653718f6eb6115e3a23d7b23ade15e5d9eb08",
  "bochs/cpu/event.cc": "3f1603ed7e9b668cda9264821af0e03439577a617ba63cea69e95122b6cd2b12",
  "bochs/main.cc": "2c6dcb4cf0091ba980c66c3b9c173c3db95e9a1845ef52d4ad1758e280ad0833",
  "bochs/memory/memory.cc": "d6ff0d3353336995aa2fdd8326dc25d197a975ea8139827f4c8ab06f7b083e78",
  "bochs/memory/misc_mem.cc": "8647410bd71e6345426052b02d04a0effa9e39a85fb7e50320f9d3f22d4c8ee0",
  "bochs/pc_system.h": "e528b869dc57d85bce7d5e421ca2a4cd26ca2277cd39b27dc6039c311d46d67f",
  "bochs/pc_system.cc": "9831c51c0fc177766ebe1b43862eb4aaf112155aa754b2681648d57959853c73",
  "bochs/iodev/devices.cc": "2a9fb204a658691e4410908ebdd5b9f58d8f982948ede2cd15c3f4d957ea5a44",
  "bochs/cpu/init.cc": "4bdf4a39a2a3ceecafdd070836a055b5dec8696acf59652e2150a12fdfa7a9f3"
});
function sourceProof(s){
 check(/^[0-9a-f]{40}$/.test(s.boardRevision),'source revision');
 for(const [k,v] of Object.entries(repBuildPins)){check(/^[0-9a-f]{64}$/.test(v)||k==='bochsRevision','native build not yet qualified');equal(s[k],v,'qualified native build '+k);}
 equal(Object.keys(s.sourceHashes).sort(),historicalInventory(s.boardRevision),'complete historical inventory');
 for(const [file,digest] of Object.entries(s.sourceHashes))equal(repSha(historicalBlob(s.boardRevision,file)),digest,'historical measured source '+file);
 equal(s.runtimeSha256,s.sourceHashes['scripts/bochs-cpu3-native-rep-pf-pit/runtime.inc'],'compiled runtime mirror');
 check(Object.keys(repQualifiedPatchedHashes).length===12,'qualified native patch pins unavailable');equal(s.patchedHashes,repQualifiedPatchedHashes,'all native transformed byte pins');
 equal(s.boardConfigurationSha256,repSha(JSON.stringify(repBoardConfig)),'actual board configuration');
 equal(s.romSha256,qualifiedRepJsOracle().rom.sha256,'free ROM bytes');equal(s.fixtureSha256,qualifiedRepJsOracle().rom.sourceSha256,'free source fixture');
 equal(s.fixtureSha256,s.sourceHashes['test/fixtures/i80386-free-rep-pf-pit.S'],'fixture committed mirror');
}
const repResumeSites=Object.freeze([{Q:73,N:73,CX:2,DI:0x5000},{Q:86,N:87,CX:1,DI:0x5004}]);
function logicalEvents(native,mode){
 const remove=new Set();let lastSlice=null,sliceAt=0,lastPost=null;
 const byOrdinal=new Map(native.events.map(e=>[e.ordinal,e]));
 for(const r of native.records){
  if(r.tag==='SLICE')lastSlice=native.slices[sliceAt++];
  if(r.tag==='POST_STATE')lastPost=byOrdinal.get(Number(r.fields[22]));
  if(r.tag==='ATTEMPT'&&mode==='budget1'){
   const e=byOrdinal.get(Number(r.fields[4])),site=repResumeSites.find(s=>s.Q===e.successfulQuanta&&e.eip===0x22c);if(!site)continue;
   equal([e.cs,e.eip,e.physicalPC,e.ilen,e.hex,e.nativeTicks,e.successfulQuanta],[8,0x22c,0xf022c,3,'66f3ab',site.N,site.Q],'exact two budget1 REP resume decode entries');
   check(lastSlice&&lastPost,'REP resume prior owned slice/progress');equal([lastSlice.reason,lastSlice.requestedQuanta,lastSlice.chargedQuanta,lastSlice.chargedNativeTicks,lastSlice.afterQuanta,lastSlice.afterNativeTicks,lastSlice.exitCs,lastSlice.exitEip],[1,1,1,1,site.Q,site.N,8,0x22c],'resume caused by prior exact one-quantum budget slice');
   equal([lastPost.state.ecx,lastPost.state.edi,lastPost.state.eip],[site.CX,site.DI,0x22f],'committed REP progress before resume');remove.add(e.ordinal);
  }
 }
 equal(remove.size,mode==='budget1'?2:0,'only two scoped budget-induced resume entries');
 const result=[];
 for(const e of native.events){if(e.tag==='CMD'||remove.has(e.ordinal))continue;const copy={...e};delete copy.ordinal;
  if(e.tag==='HALT_IDLE'&&JSON.stringify(result.at(-1))===JSON.stringify(copy))continue;result.push(copy);}
 return result;
}
export function assertNativeRepPfPitBudgetProof(arms){
 equal(Object.keys(arms).sort(),Object.keys(repBudgets).sort(),'four budget evidence sets');let baseline;
 for(const [mode,arm] of Object.entries(arms)){const now=logicalEvents(arm.native,mode);if(baseline)equal(now,baseline,'native budgets exact work/byte/commit chronology with two scoped REP resume decodes');else baseline=now;}
 return {logicalEvents:baseline.length,rawPreserved:true,onlyScopedResumeDecodes:true};
}
export function assertNativeRepPfPitProof(report,rom){
 equal(Object.keys(report).sort(),['arms','artifacts','busDifferences','claim','javascriptOracle','probes','resetDifferences','schema','source','transportProbes'],'report exact shape');
 equal(report.schema,'bw.bochs-cpu3-native-rep-pf-pit.v1','schema');equal(report.claim,'native-actual-board-compact-rep-two-pf-pit-only','scope');
 equal(Object.keys(report.arms??{}).sort(),Object.keys(repBudgets).sort(),'four actual arms');equal(report.resetDifferences,repResetDifferences,'named CPU differences');equal(report.busDifferences,repBusDifferences,'exact delivery order declaration');
 sourceProof(report.source);artifactProof(report);
 equal(report.javascriptOracle,{path:'docs/receipts/2026-10-01-i80386-js-rep-pf-pit-oracle-capture.json.gz',sha256:'f2c3187c40173f64b0acb51cd86d0ca9ce8a250b5d634fc4e9a2c3d95c56fe1e',boardRevision:'7891a5c1f9ca242a86a6fcd39a61b5bc29e8d247',cpuProfile:'compatibility',strict386:false},'historical actual JS baseline');
 check(Object.keys(repGuards).length>0&&Object.keys(repTransports).length>0,'native rejection census unqualified');
 const results={};
 for(const [mode,arm] of Object.entries(report.arms)){
  equal(arm.mode,mode,'arm name');results[mode]=assertNativeRepPfPitArmProof(arm,rom);

 }
 const budgetProof=assertNativeRepPfPitBudgetProof(report.arms);return {claim:report.claim,budgetProof,arms:results,fullResetParity:false,fullByteBusOrderParity:false,nativeBudgetByteBusOrderParity:true};
}
