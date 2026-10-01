/** Source-bound actual-board compact REP/two-PF/PIT proof. No full reset parity. */
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertCombinedPagingRamOracle} from './i80386-combined-paging-ram-oracle.mjs';
import {NativeCombinedPagingRamHost,combinedSha,combinedBudgets,parseCombinedRpcLine,encodeCombinedReply,combinedBoardConfig} from './bochs-cpu3-native-combined-paging-ram/host.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const fail=m=>{throw Error(`native combined paging/RAM/REP proof: ${m}`);};
const check=(v,m)=>{if(!v)fail(m);};
const equal=(a,b,m)=>assert.deepEqual(a,b,`native combined paging/RAM/REP proof: ${m}`);
const boundaryKinds=['ordinary','rep-element','fault-delivery','irq-delivery','prefetch-pagewalk'];
const stateNames=['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3','cs','ds','ss','gdtrBase','gdtrLimit','idtrBase','idtrLimit'];
const extraNames=['dr6','dr7','es','fs','gs','csIndex','csTi','csRpl','csValid','csPresent','csDpl','csSegment','csType','csBase','csLimit','csGranular','csDefault32','csAvailable','pendingEvent','eventMask'];
const segmentNames=['index','selector','selectorIndex','ti','rpl','valid','present','dpl','segment','type','base','limit','granular','default32','available'];
const finalNames=['nativeTicks','successfulQuanta','attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts','rpcRequests','rpcReplies','nativeTickCallbacks','quantumCallbacks'];
export function parseCombinedNativeLog(stderr){
  const rows=stderr.split('\n').filter(line=>line.startsWith('BWS'));
  check(rows.length>0,'BWS12 evidence absent');
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
    const [prefix,tag,...p]=line.split('\t');check(prefix==='BWS12'&&!p.some(x=>x===''),'proof prefix or empty field');
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
      equal(p.length,14,'attempt fields');const ilen=d(p[6]);check(ilen>=1&&ilen<=15&&new RegExp(`^[0-9a-f]{${2*ilen}}$`).test(p[7]),'actual instruction length/bytes');
      event(tag,{cs:h(p[0],4),eip:h(p[1]),nativeTicks:d(p[2]),successfulQuanta:d(p[3]),ordinal:d(p[4]),physicalPC:h(p[5]),ilen,hex:p[7],decodedPC:h(p[8]),class:p[9],generation:d(p[10]),mappingEpoch:d(p[11]),boardA20:d(p[12]),nativeA20:d(p[13])});
    }else if(tag==='PREFETCH'){equal(p.length,6,'prefetch fields');event(tag,{physicalPC:h(p[0]),nativeTicks:d(p[1]),successfulQuanta:d(p[2]),ordinal:d(p[3]),mappingEpoch:d(p[4]),boardA20:d(p[5])});}
    else if(tag==='RPC_REQ'){
      equal(p.length,9,'request mirror fields');event(tag,{seq:d(p[0]),operation:p[1],arg0:d(p[2]),arg1:d(p[3]),arg2:d(p[4]),payload:p[5],nativeTicks:d(p[6]),successfulQuanta:d(p[7]),ordinal:d(p[8])});
    }else if(tag==='RPC_REP'){equal(p.length,5,'scalar reply mirror fields');event(tag,{seq:d(p[0]),value:d(p[1]),nativeTicks:d(p[2]),successfulQuanta:d(p[3]),ordinal:d(p[4])});}
    else if(tag==='RPC_MEM'){
      equal(p.length,11,'memory reply mirror fields');check(/^(?:[0-9a-f]{2}){1,16}$/.test(p[4]),'memory mirror bytes');
      event(tag,{seq:d(p[0]),decoded:h(p[1]),class:d(p[2]),effect:d(p[3]),hex:p[4],generation:d(p[5]),mappingEpoch:d(p[6]),nativeTicks:d(p[7]),successfulQuanta:d(p[8]),ordinal:d(p[9]),boardA20:d(p[10])});
    }else if(tag==='RPC_PAGE'){
      equal(p.length,10,'page reply mirror fields');check(/^[0-9a-f]{64}$/.test(p[4]),'page mirror hash');
      event(tag,{seq:d(p[0]),decoded:h(p[1]),generation:d(p[2]),class:d(p[3]),sha256:p[4],mappingEpoch:d(p[5]),nativeTicks:d(p[6]),successfulQuanta:d(p[7]),ordinal:d(p[8]),boardA20:d(p[9])});
    }else if(tag==='RPC_PIO'){equal(p.length,7,'PIO reply mirror');event(tag,{seq:d(p[0]),value:d(p[1]),boardA20:d(p[2]),mappingEpoch:d(p[3]),nativeTicks:d(p[4]),successfulQuanta:d(p[5]),ordinal:d(p[6])});}
    else if(tag==='COMMIT'){equal(p.length,12,'cache commit fields');check(d(p[2])>=1&&d(p[2])<=16&&new RegExp(`^[0-9a-f]{${2*d(p[2])}}$`).test(p[3]),'commit width/bytes');event(tag,{raw:h(p[0]),decoded:h(p[1]),length:d(p[2]),hex:p[3],generation:d(p[4]),mappingEpoch:d(p[5]),nativeTicks:d(p[6]),successfulQuanta:d(p[7]),ordinal:d(p[8]),boundaryKind:p[9],boardA20:d(p[10]),why:p[11]});}
    else if(tag==='ALIAS_UPDATE'){equal(p.length,11,'cache alias fields');check(/^[0-9a-f]{64}$/.test(p[6]),'alias SHA');event(tag,{rawPage:h(p[0]),decodedPage:h(p[1]),offset:d(p[2]),length:d(p[3]),generation:d(p[4]),mappingEpoch:d(p[5]),sha256:p[6],nativeTicks:d(p[7]),successfulQuanta:d(p[8]),ordinal:d(p[9]),boundaryKind:p[10]});}
    else if(tag==='STAMP'){equal(p.length,10,'write stamp fields');event(tag,{raw:h(p[0]),length:d(p[1]),decodedPage:h(p[2]),mappingEpoch:d(p[3]),nativeTicks:d(p[4]),successfulQuanta:d(p[5]),ordinal:d(p[6]),boundaryKind:p[7],stopBefore:d(p[8]),stopAfter:d(p[9])});}
    else if(tag==='PREFETCH_INVALIDATE'){equal(p.length,10,'prefetch invalidation fields');event(tag,{reason:p[0],oldWindow:d(p[1]),newWindow:d(p[2]),rawFetchPage:h(p[3]),mappingEpoch:d(p[4]),nativeTicks:d(p[5]),successfulQuanta:d(p[6]),ordinal:d(p[7]),boundaryKind:p[8],nativeA20:d(p[9])});}
    else if(tag==='TLB_INVALIDATE'){equal(p.length,6,'bridge TLB invalidation fields');event(tag,{reason:p[0],mappingEpoch:d(p[1]),nativeTicks:d(p[2]),successfulQuanta:d(p[3]),ordinal:d(p[4]),boundaryKind:p[5]});}
    else if(tag==='TLB_OBSERVED'){equal(p.length,9,'actual TLB completion fields');event(tag,{owner:p[0],reason:p[1],mappingEpoch:d(p[2]),boardA20:d(p[3]),nativeA20:d(p[4]),nativeTicks:d(p[5]),successfulQuanta:d(p[6]),ordinal:d(p[7]),boundaryKind:p[8]});}
    else if(tag==='MAP_COMMIT'){equal(p.length,8,'mapping commit fields');event(tag,{oldA20:d(p[0]),newA20:d(p[1]),oldEpoch:d(p[2]),newEpoch:d(p[3]),nativeTicks:d(p[4]),successfulQuanta:d(p[5]),ordinal:d(p[6]),boundaryKind:p[7]});}
    else if(tag==='COHERENCE'){equal(p.length,12,'coherence fields');check(['publish-only','pagewalk-publish','executable-alias-write','mapping-transition'].includes(p[0])&&['0','1'].includes(p[2]),'coherence kind/A20');event(tag,{reason:p[0],mappingEpoch:d(p[1]),boardA20:d(p[2]),aliases:d(p[3]),nativeTicks:d(p[4]),successfulQuanta:d(p[5]),ordinal:d(p[6]),boundaryKind:p[7],stampCalls:d(p[8]),prefetchCalls:d(p[9]),tlbCalls:d(p[10]),globalICacheFlushCalls:d(p[11])});}
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
    else if(tag==='MEM'){equal(p.length,11,'byte memory fields');event(tag,{rw:p[0],raw:h(p[1]),decoded:h(p[2]),class:p[3],value:h(p[4],2),effect:p[5],nativeTicks:d(p[6]),ordinal:d(p[7]),why:p[8],mappingEpoch:d(p[9]),boardA20:d(p[10])});}
    else if(tag==='EXEC'){equal(p.length,10,'execute fields');event(tag,{rawPage:h(p[0]),decodedPage:h(p[1]),class:p[2],nativeTicks:d(p[3]),ordinal:d(p[4]),generation:d(p[5]),sha256:p[6],mappingEpoch:d(p[7]),boardA20:d(p[8]),nativeA20:d(p[9])});}
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

export const combinedBuildPins=Object.freeze({bochsRevision:'0e45b736ef9792eb9b752b0a35db49eaf2faea47',binarySha256:'1398f63e252f54c7efa9f8ff40549fcae286ce7088a8f9bf30fd15d751ed070e',configSha256:'d4945445c2412c0b4e8c5cac80cee28d443bb438c36c9ea6b1bb5196147f1e8c',runtimeSha256:'43e77cfea9f56b730657a044678b1416204c659161cf515693b8282734d1a941'});
// Native callback/attempt/idle/resume census must be measured by the first actual run.
export const combinedCensus=Object.freeze({status:'awaiting-actual-combined-native-execution'});
export const combinedResetDifferences=Object.freeze({fullResetParity:false,comparisonMasks:null,
 status:'pinned-source-expectations-not-combined-native-execution-evidence',
 rawReset:{edx:{javascript:0x300,native:0},cr0:{javascript:0,native:0x7ffffff0},gdtrLimit:{javascript:0,native:0xffff},idtrLimit:{javascript:0x3ff,native:0xffff},dr6:{javascript:0,native:0xffff1ff0},dr7:{javascript:0,native:0x400}},
 cr0Writes:{javascript:[0x11,0x80000011],native:[0x7ffffff1,0xfffffff1],source:'bochs/cpu/crregs.cc:1082'},
 budgetResumeDecodes:{status:'awaiting-actual-combined-budget-ledger',sites:[]},
 repCheckpoint:{scope:'successful nonfinal protected16/address16/data32 REP STOSL element hook',javascript:'restart EIP',native:'decoded end RIP'},
 rawGuestWitness:{javascript:[0,3,0,0,0,0,0,0],native:[0,0,0,0,0xf0,0xff,0xff,0x7f]}});
export const combinedBusDifferences=Object.freeze({fullByteBusOrderParity:false,architecturalStalePteParity:false,
 status:'pinned-source-rules-before-actual-combined-native-capture',
 protectedCalls:[{Q:57,pc:0x250,selector:0x18},{Q:62,pc:0x25f,selector:0x18},{Q:148,pc:0x2db,selector:0x20},{Q:152,pc:0x2e4,selector:0x18},{Q:157,pc:0x2f4,selector:0x18},{Q:161,pc:0x2fd,selector:0x20},{Q:169,pc:0x30e,selector:0x20},{Q:174,pc:0x31e,selector:0x20}],
 protectedReturns:[{Q:59,selector:0x18},{Q:64,selector:0x18},{Q:150,selector:0x20},{Q:154,selector:0x18},{Q:159,selector:0x18},{Q:163,selector:0x20},{Q:171,selector:0x20},{Q:176,selector:0x20}],
 callOrder:{javascript:'two descriptor reads, first accessed touch, IP then CS frame',native:'one descriptor read, CS then IP frame, first accessed touch'},
 firstAccessedTouches:[{Q:57,address:0x61d,value:0x9b},{Q:148,address:0x625,value:0x9b}],
 returnOrder:{javascript:'IP then CS word then ROM descriptor',native:'CS then IP word then ROM descriptor'},
 sources:{'bochs/cpu/call_far.cc':'9acca787f6aba9ffc7fb72a7d37904d69a66d9a07d3dd8cd33acfaa4c3888051','bochs/cpu/ret_far.cc':'71cd93f498316629d578f158d2f06f01efa4d4c2ec1b8846da66273eadcadaf3','bochs/cpu/ctrl_xfer_pro.cc':'a70b7ee89237e5058e44e07095ea7d52d621dcff6fd727e75bfd1be544577d62','bochs/cpu/segment_ctrl_pro.cc':'737fea13e5e6dc97d7b24d17b3cfe249dbbfba7aae37304abdf3e783b54af714'},
 pagewalkPolicy:{architecturalCallbackParity:false,javascript:'five control, two tracked-table, 27 ordinary OFF and two A20 invalidations',native:'guest inherent control flushes plus two bridge mapping transitions; no synthetic ordinary-write TLB flush'},
 deliveries:[{kind:'fault',Q:94,sp:0x8ff0,eip:0x2a4,error:2,flags:0x10046},{kind:'fault',Q:111,sp:0x8ff0,eip:0x2af,error:2,flags:0x10046},{kind:'irq',Q:129,sp:0x8ff4,eip:0x2cd,flags:0x246}]});
// Guards/transport census is finalized against the new native adapter before source freeze.
export const combinedGuards=Object.freeze({
  'admitted-unexecuted-code-write':'admitted-unexecuted-code-write','current-code-write':'current-code-write','executable-table-ad-write':'executable-table-ad-write','pio-port92':'host-port-out','mapping-boundary-kind':'mapping-boundary-kind',
  'unsupported-span-width':'host-physical-read','physical-overflow':'host-physical-read',
  'unsafe-execute-ram':'unsafe-execute-page','unsupported-rep':'unsupported-rep','prefetch-non-pagewalk-write':'prefetch-non-pagewalk-write','execute-pending-write':'coherence-pending-boundary','native-a20-off':'native-a20-mask','stale-cache-generation':'execute-cache-generation','write-stage-bound':'write-stage-precondition','write-generation-overflow':'write-stage-precondition','unsafe-execute-mmio':'unsafe-execute-page','unsafe-execute-unmapped':'unsafe-execute-page',
  'unexpected-pio':'host-port-out','bochs-ram-read':'Bochs-RAM-read-fallback','bochs-ram-write':'Bochs-RAM-write-fallback',
  'bochs-direct-pointer':'Bochs-direct-pointer-fallback','bochs-pio':'Bochs-PIO-fallback','bochs-timer':'Bochs-timer-fallback','unknown-trap':'unexpected-fault',
});
export const combinedTransports=Object.freeze({
  'pio-a20':'rpc-pio-mapping','pio-epoch':'rpc-pio-mapping','memory-a20':'rpc-memory-generation','page-a20':'rpc-page-metadata',
  'command-sequence':'rpc-command-sequence','command-prefix':'rpc-command','command-zero-budget':'rpc-run-budget',
  'command-overlong-line':'rpc-line-bound','scalar-sequence':'rpc-reply','scalar-range':'rpc-reply-range',
  'page-generation':'rpc-page-metadata','page-classification':'rpc-page-metadata','page-decoded':'rpc-page-metadata',
  'page-chunk-order':'rpc-page-chunk','page-chunk-width':'rpc-byte-length','page-end-sequence':'rpc-page-end','page-digest':'rpc-page-sha256',
  'memory-classification':'host-memory-classification','memory-write-commit':'host-write-commit','memory-generation':'rpc-memory-generation','memory-epoch':'rpc-memory-generation','page-epoch':'rpc-page-metadata',
});
let jsOracle;
export function qualifiedCombinedJsOracle(){
 if(!jsOracle){const bytes=gunzipSync(readFileSync(new URL('../docs/receipts/2026-10-01-i80386-js-combined-paging-ram-oracle-capture.json.gz',import.meta.url)));
  equal(combinedSha(bytes),'bcf52cc49849a2c7889077d2b6f80d980916766d175ab78cd656689d9a7f3ab2','qualified actual JS receipt');jsOracle=JSON.parse(bytes);assertCombinedPagingRamOracle(jsOracle);}
 return jsOracle;
}
const guestDifferenceSites=Object.freeze({readCr0:{pc:0x112,hex:'0f20c0'},storeCr0Witness:{pc:0x115,hex:'66a31405'},loadGdt:{pc:0x218,hex:'2e0f0116d803'},loadIdt:{pc:0x21e,hex:'2e0f011ede03'},initializeAxHigh:{pc:0x122,hex:'b8ffff'},initializeEax:{pc:0x224,hex:'66b811000000'}});
function guestProvenance(rom){
 const js=qualifiedCombinedJsOracle(),out={};
 for(const [name,site] of Object.entries(guestDifferenceSites)){
  equal(Buffer.from(rom.subarray(site.pc,site.pc+site.hex.length/2)).toString('hex'),site.hex,'declared raw-register provenance operand '+name);
  const step=js.steps.find(s=>s.before.eip===site.pc);check(step&&step.completed,'actual guest provenance site '+name);out[name]=step.quantum;
 }
 return out;
}
function expectedState(js,{reset=false,rep=false,q=Infinity,provenance}={}){
 const beforeGdt=reset||q<provenance.loadGdt,beforeIdt=reset||q<provenance.loadIdt;
 const s=Object.fromEntries(stateNames.map(n=>[n,n==='gdtrBase'?js.gdtr.base:n==='gdtrLimit'?(beforeGdt?0xffff:js.gdtr.limit):n==='idtrBase'?js.idtr.base:n==='idtrLimit'?(beforeIdt?0xffff:js.idtr.limit):js[n]]));
 s.edx=0;if(!reset&&q>=provenance.readCr0&&q<provenance.initializeEax)s.eax=q>=provenance.initializeAxHigh?0x7fffffff:0x7ffffff0;
 s.cr0=(js.cr0|0x7ffffff0)>>>0;if(rep&&js.ecx)s.eip=qualifiedCombinedJsOracle().rom.symbols.rep_fill+3;
 return s;
}
function hostReplay(arm,rom){
 const host=new NativeCombinedPagingRamHost(rom);let request=null,wire=[],at=0,running=false,seq=0,stopped=false;
 const outgoing=arm.rpc.toNative,incoming=arm.rpc.fromNative;equal(incoming[0],'BWR12\tREADY\tf000\t0000fff0\t0\t0','actual READY');
 const take=line=>equal(outgoing[at++],line,'RPC chronology/reply bytes');
 for(const line of incoming.slice(1)){
  const r=parseCombinedRpcLine(line);
  if(r.kind==='REQ'){
   if(!running){const c=parseCombinedRpcLine(outgoing[at++]);equal([c.kind,c.verb,c.seq],['CMD','RUN',++seq],'RUN command order');equal([c.arg0,c.arg1,c.deadline],[600,combinedBudgets[arm.mode],'18446744073709551615'],'independent native/Q caps');host.beginRun();running=true;}
   wire=encodeCombinedReply(host.handleRequest(r));for(const reply of wire)take(reply);
  }else{
   equal(r.kind,'DONE','incoming completion');
   if(r.verb==='RUN'){
    if(!running){const c=parseCombinedRpcLine(outgoing[at++]);equal([c.verb,c.seq],['RUN',++seq],'empty RUN command');equal([c.arg0,c.arg1,c.deadline],[600,combinedBudgets[arm.mode],'18446744073709551615'],'terminal independent caps');host.beginRun();}
    equal(r.seq,seq,'RUN DONE seq');
    const slice=arm.native.slices.find(s=>s.cmdSeq===seq);check(slice,'DONE lacks actual SLICE');
    equal([r.reason,r.chargedNativeTicks,r.chargedQuanta,r.cs,r.eip,r.totalNativeTicks,r.totalQuanta,r.attempts,r.completed,r.repIterations,r.faults,r.ifFlag,r.activity,r.irqDelivered],
     [slice.reason,slice.chargedNativeTicks,slice.chargedQuanta,slice.exitCs,slice.exitEip,slice.afterNativeTicks,slice.afterQuanta,slice.attempts,slice.completed,slice.repIterations,slice.faults,slice.exitIf===512,slice.exitActivity,!!slice.irqDelivered],'complete RUN DONE/raw SLICE mirror');
    host.endRun();running=false;
    equal([r.totalNativeTicks,r.totalQuanta],[host.nativeTicks,host.successfulQuanta],'DONE actual clock tuple');
    if(r.reason===4&&r.chargedNativeTicks===0&&r.chargedQuanta===0){host.finish();const stop=parseCombinedRpcLine(outgoing[at++]);equal([stop.verb,stop.seq],['STOP',++seq],'STOP command');stopped=true;}
    else {const staged=host.stageLine();if(staged.changed){const c=parseCombinedRpcLine(outgoing[at++]);equal([c.verb,c.seq,c.arg0,c.arg1,c.deadline],['LINE',++seq,Number(staged.asserted),0,'0'],'actual LINE command');}}
   }else if(r.verb==='LINE')equal([r.seq,r.value,r.totalNativeTicks,r.totalQuanta],[seq,Number(host.lineAsserted),host.nativeTicks,host.successfulQuanta],'LINE DONE');
   else equal([stopped,r.verb,r.seq,r.value,r.totalNativeTicks,r.totalQuanta],[true,'STOP',seq,0,host.nativeTicks,host.successfulQuanta],'STOP DONE');
  }
 }
 equal(incoming.map(parseCombinedRpcLine).filter(r=>r.kind==='DONE'&&r.verb==='RUN').length,arm.native.slices.length,'one DONE per raw slice');equal(at,outgoing.length,'all outgoing RPC consumed');check(stopped,'terminal STOP absent');
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
// Diagnostic evidence checks deliberately do not qualify combined native semantics.
export function assertNativeCombinedPagingRamArmProof(arm,rom){
 equal(arm.requestedBudget,combinedBudgets[arm.mode],'actual requested budget');
 equal([arm.artifacts.exitCode,arm.artifacts.signal],[0,null],'actual native exit');
 const native=parseCombinedNativeLog(arm.raw.stderr);equal(native,arm.native,'raw parser binding');
 equal(native.activation,{cs:0xf000,eip:0xfff0,copiedBytes:0,a20:1},'cold activation without RAM seed');
 equal(native.ready,{cs:0xf000,eip:0xfff0,nativeTicks:0,successfulQuanta:0},'actual native READY');
 const host=hostReplay(arm,rom);
 equal(arm.host.initial,host.initial,'initial actual board');equal(arm.host.reset,host.reset,'single reset epoch');equal(arm.host.seed,host.seed,'initial backing');
 equal(host.machine.cpu.cycles,0,'JS CPU execution forbidden');
 return {qualificationStatus:'UNQUALIFIED',successfulQuanta:host.successfulQuanta,nativeTicks:host.nativeTicks,boardClocks:host.machine.cycles};
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
  const runner='scripts/run-i80386-native-combined-paging-ram-board-gate.mjs';
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
  const groups=['bochsrc',...Object.keys(combinedBudgets),...Object.keys(combinedGuards).map(n=>'guard-'+n),...Object.keys(combinedTransports).map(n=>'transport-'+n)];
  equal(Object.keys(report.artifacts).sort(),groups.sort(),'complete actual artifact groups');
  file(report.artifacts.bochsrc);equal(report.artifacts.bochsrc.sha256,report.source.bochsrcSha256,'bochsrc source artifact mirror');
  for(const name of Object.keys(combinedBudgets)){
    equal(report.arms[name].artifacts,report.artifacts[name],'arm artifact mirror');
    equal(Object.keys(report.artifacts[name].files).sort(),['bochsLog','rpcFromNative','rpcToNative','stderr','stdout'],'arm raw artifact set');
    for(const entry of Object.values(report.artifacts[name].files))file(entry);
    equal(Object.keys(report.arms[name].raw).sort(),['rpcFromNative','rpcToNative','stderr','stdout'],'arm complete raw strings');
    for(const [kind,text] of Object.entries(report.arms[name].raw)){equal(combinedSha(text),report.artifacts[name].files[kind].sha256,'arm actual raw artifact digest');}
    equal(parseCombinedNativeLog(report.arms[name].raw.stderr),report.arms[name].native,'raw stderr native parser binding');
    equal(report.arms[name].raw.rpcToNative,report.arms[name].rpc.toNative.join('\n')+'\n','raw outgoing RPC binding');
    equal(report.arms[name].raw.rpcFromNative,report.arms[name].rpc.fromNative.join('\n')+'\n','raw incoming RPC binding');
  }
  for(const [group,expected,prefix] of [[report.probes,combinedGuards,'guard'],[report.transportProbes,combinedTransports,'transport']]){
    equal(Object.keys(group).sort(),Object.keys(expected).sort(),'actual rejection probe set');
    for(const [name,reason] of Object.entries(expected)){
      const probe=group[name];equal([probe.name,probe.expected,probe.observedFailure],[name,reason,reason],'named native FAIL witness');
      equal(probe.exit,{code:null,signal:'SIGABRT'},'native rejection exit');
      equal(probe.files,report.artifacts[prefix+'-'+name],'rejection artifact mirror');
      equal(Object.keys(probe.files).sort(),['bochsLog','rpcFromNative','rpcToNative','stderr','stdout'],'rejection raw artifact set');
      for(const entry of Object.values(probe.files))file(entry);
      equal(Object.keys(probe.raw).sort(),['rpcFromNative','rpcToNative','stderr','stdout'],'probe complete raw strings');
      for(const [kind,text] of Object.entries(probe.raw))equal(combinedSha(text),probe.files[kind].sha256,'rejection actual raw artifact digest');
      equal([...probe.raw.stderr.matchAll(/^BWS12\tFAIL\t([^\n]+)$/gm)].map(m=>m[1]),[reason],'raw named FAIL witness');
      if(prefix==='transport')equal(probe.injected,true,'actual transport injection reached');
    }
  }
}
export const combinedQualifiedPatchedHashes=Object.freeze({"bochs/bochs.h":"7c18c551557eb269b52d6a5f804d38ead45c4f268528fc7ea46429b32508c501","bochs/cpu/cpu.cc":"16a7b2a3640f2fb3d8df92f8916f8d5bc628e6ed8a7658c07b8db1c101ec80d9","bochs/cpu/paging.cc":"e72fcf4f21a32b5618eeeb2e783f4faef8feea4f2d1f0dc8b3cb6515858e4f5d","bochs/cpu/exception.cc":"5701d81b89fda61a6c357e63fff653718f6eb6115e3a23d7b23ade15e5d9eb08","bochs/cpu/event.cc":"3f1603ed7e9b668cda9264821af0e03439577a617ba63cea69e95122b6cd2b12","bochs/main.cc":"2c6dcb4cf0091ba980c66c3b9c173c3db95e9a1845ef52d4ad1758e280ad0833","bochs/memory/memory.cc":"d6ff0d3353336995aa2fdd8326dc25d197a975ea8139827f4c8ab06f7b083e78","bochs/memory/misc_mem.cc":"8647410bd71e6345426052b02d04a0effa9e39a85fb7e50320f9d3f22d4c8ee0","bochs/pc_system.h":"e528b869dc57d85bce7d5e421ca2a4cd26ca2277cd39b27dc6039c311d46d67f","bochs/pc_system.cc":"9831c51c0fc177766ebe1b43862eb4aaf112155aa754b2681648d57959853c73","bochs/iodev/devices.cc":"2a9fb204a658691e4410908ebdd5b9f58d8f982948ede2cd15c3f4d957ea5a44","bochs/cpu/init.cc":"4bdf4a39a2a3ceecafdd070836a055b5dec8696acf59652e2150a12fdfa7a9f3"}); // Independently audited local r1 transformed bytes.
function sourceProof(s){
 check(/^[0-9a-f]{40}$/.test(s.boardRevision),'source revision');
 for(const [k,v] of Object.entries(combinedBuildPins)){check(/^[0-9a-f]{64}$/.test(v)||k==='bochsRevision','native build not yet qualified');equal(s[k],v,'qualified native build '+k);}
 equal(Object.keys(s.sourceHashes).sort(),historicalInventory(s.boardRevision),'complete historical inventory');
 for(const [file,digest] of Object.entries(s.sourceHashes))equal(combinedSha(historicalBlob(s.boardRevision,file)),digest,'historical measured source '+file);
 equal(s.runtimeSha256,s.sourceHashes['scripts/bochs-cpu3-native-combined-paging-ram/runtime.inc'],'compiled runtime mirror');
 check(Object.keys(combinedQualifiedPatchedHashes).length===12,'qualified native patch pins unavailable');equal(s.patchedHashes,combinedQualifiedPatchedHashes,'all native transformed byte pins');
 equal(s.boardConfigurationSha256,combinedSha(JSON.stringify(combinedBoardConfig)),'actual board configuration');
 equal(s.romSha256,qualifiedCombinedJsOracle().rom.sha256,'free ROM bytes');equal(s.fixtureSha256,qualifiedCombinedJsOracle().rom.sourceSha256,'free source fixture');
 equal(s.fixtureSha256,s.sourceHashes['test/fixtures/i80386-free-combined-paging-ram.S'],'fixture committed mirror');
}
export function assertNativeCombinedPagingRamBudgetProof(){
 check(false,'UNQUALIFIED: combined cache, CPU, byte-ledger and budget semantics await actual execution audit');
}
export function assertNativeCombinedPagingRamProof(report,rom){
 equal(Object.keys(report).sort(),['arms','artifacts','busDifferences','claim','javascriptOracle','probes','qualificationStatus','resetDifferences','schema','source','transportProbes'],'report exact shape');
 equal(report.schema,'bw.bochs-cpu3-native-combined-paging-ram.diagnostic.v1','schema');equal(report.claim,'UNQUALIFIED-native-combined-execution-diagnostic-only','scope');
 equal(report.qualificationStatus,'UNQUALIFIED','diagnostic status');
 equal(Object.keys(report.arms??{}).sort(),Object.keys(combinedBudgets).sort(),'four actual arms');equal(report.resetDifferences,combinedResetDifferences,'named CPU differences');equal(report.busDifferences,combinedBusDifferences,'exact delivery order declaration');
 sourceProof(report.source);artifactProof(report);
 equal(report.javascriptOracle,{path:'docs/receipts/2026-10-01-i80386-js-combined-paging-ram-oracle-capture.json.gz',sha256:'bcf52cc49849a2c7889077d2b6f80d980916766d175ab78cd656689d9a7f3ab2',boardRevision:'15f010c92b5227622b76da815bd47000e28a988c',cpuProfile:'compatibility',strict386:false},'historical actual JS baseline');
 check(Object.keys(combinedGuards).length>0&&Object.keys(combinedTransports).length>0,'native rejection census unqualified');
 const results={};
 for(const [mode,arm] of Object.entries(report.arms)){
  equal(arm.mode,mode,'arm name');results[mode]=assertNativeCombinedPagingRamArmProof(arm,rom);

 }
 const budgetProof=assertNativeCombinedPagingRamBudgetProof(report.arms);return {claim:report.claim,budgetProof,arms:results,fullResetParity:false,fullByteBusOrderParity:false,nativeBudgetByteBusOrderParity:true};
}
