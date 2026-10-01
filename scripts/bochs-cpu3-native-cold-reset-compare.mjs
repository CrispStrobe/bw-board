/** Fail-closed bounded cold entry/actual board ownership proof; not reset parity. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertColdResetOracle} from './i80386-cold-reset-oracle.mjs';
import {NativeColdResetHost,coldSha,coldBudgets,parseColdRpcLine,encodeColdReply,assembleColdPageReply,coldBoardConfig} from './bochs-cpu3-native-cold-reset-host.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const fail=(message)=>{throw Error(`native cold reset proof: ${message}`);};
const check=(ok,message)=>{if(!ok)fail(message);};
const equal=(a,b,message)=>assert.deepEqual(a,b,`native cold reset proof: ${message}`);
const stateNames=['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3','cs','ds','ss','gdtrBase','gdtrLimit','idtrBase','idtrLimit'];
const extraNames=['dr6','dr7','es','fs','gs','csIndex','csTi','csRpl','csValid','csPresent','csDpl','csSegment','csType','csBase','csLimit','csGranular','csDefault32','csAvailable','pendingEvent','eventMask'];
const segmentNames=['index','selector','selectorIndex','ti','rpl','valid','present','dpl','segment','type','base','limit','granular','default32','available'];
const finalNames=['nativeTicks','successfulQuanta','attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts','rpcRequests','rpcReplies','nativeTickCallbacks','quantumCallbacks'];
export const coldResetDifferences=Object.freeze({
  claim:'cold entry and actual board bus ownership; architectural reset parity remains false',
  rawReset:{edx:{javascript:0x300,native:0},cr0:{javascript:0,native:0x7ffffff0},
    gdtrLimit:{javascript:0,native:0xffff},idtrLimit:{javascript:0x3ff,native:0xffff},
    dr6:{javascript:0,native:0xffff1ff0},dr7:{javascript:0,native:0x400},
    csType:{javascript:'code-read-only',native:'data-read-write-accessed'},
    eventMask:{javascript:'Bochs mode-event mask not represented',native:0x0f40},
    realModeSelectorIndex:{javascript:'parsed selector index not represented',native:'reset index retained when real-mode selector value changes'},
    dataSegmentAccessed:{javascript:'attribute not represented',native:true},
    ldtr:{javascript:{present:false,limit:0,valid:'not represented',type:'not represented'},native:{valid:1,present:1,segment:0,type:2,limit:0xffff}},
    tr:{javascript:{present:false,limit:0,valid:'not represented',type:'not represented'},native:{valid:1,present:1,segment:0,type:11,limit:0xffff}}},
  guestWitness:{addresses:[0x510,0x511,0x512,0x513,0x514,0x515,0x516,0x517],
    javascript:[0,3,0,0,0,0,0,0],native:[0,0,0,0,0xf0,0xff,0xff,0x7f]},
  instructionState:{edx:'native zero until guest MOV EDX at successful quantum 12',
    eax:'native raw CR0 only at quanta 9 and 10, cleared by guest at quantum 11',
    cr0:'native 0x7ffffff0 throughout; JavaScript zero',descriptorLimits:'native 0xffff throughout',
    segmentType:'native real-mode data/read-write/accessed caches retained as raw state'},
  undefinedCr0Bits:0x7fffffe0,comparisonMasks:null,
});
let oracle;
export function qualifiedColdJsOracle(){
  if(!oracle){
    const bytes=readFileSync(new URL('../docs/receipts/2026-10-01-i80386-js-cold-reset-oracle-capture.json',import.meta.url));
    equal(coldSha(bytes),'e35fdc788ed3d27020563b4c7dbb2c7ecbf6c91959e0abe2ebd043f0490d6703','published actual JS capture bytes');
    oracle=JSON.parse(bytes);assertColdResetOracle(oracle);
  }
  return oracle;
}
export function parseColdNativeLog(stderr){
  const rows=stderr.split('\n').filter(line=>line.startsWith('BWS'));
  check(rows.length>0,'BWS9 evidence absent');
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
    const [prefix,tag,...p]=line.split('\t');check(prefix==='BWS9'&&!p.some(x=>x===''),'proof prefix or empty field');
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
      equal(p.length,8,'memory reply mirror fields');check(/^(?:[0-9a-f]{2}){1,16}$/.test(p[4]),'memory mirror bytes');
      event(tag,{seq:d(p[0]),decoded:h(p[1]),class:d(p[2]),effect:d(p[3]),hex:p[4],nativeTicks:d(p[5]),successfulQuanta:d(p[6]),ordinal:d(p[7])});
    }else if(tag==='RPC_PAGE'){
      equal(p.length,8,'page reply mirror fields');check(/^[0-9a-f]{64}$/.test(p[4]),'page mirror hash');
      event(tag,{seq:d(p[0]),decoded:h(p[1]),generation:d(p[2]),class:d(p[3]),sha256:p[4],nativeTicks:d(p[5]),successfulQuanta:d(p[6]),ordinal:d(p[7])});
    }else if(tag==='PAGE_CHUNK'){equal(p.length,3,'raw page chunk fields');check(/^[0-9a-f]{128}$/.test(p[2]),'raw page chunk bytes');d(p[0]);d(p[1]);}
    else if(tag==='QUANTUM'){
      equal(p.length,10,'quantum fields');event(tag,{kind:d(p[0]),cs:h(p[1],4),eip:h(p[2]),postECX:h(p[3]),postCX:h(p[4],4),postEDI:h(p[5]),preQ:d(p[6]),successfulQuanta:d(p[7]),nativeTicks:d(p[8]),ordinal:d(p[9])});
    }else if(tag==='NATIVE_TICK'){equal(p.length,5,'tick fields');event(tag,{count:d(p[0]),preTick:d(p[1]),nativeTicks:d(p[2]),successfulQuanta:d(p[3]),ordinal:d(p[4])});}
    else if(tag==='MEM'){equal(p.length,9,'byte memory fields');event(tag,{rw:p[0],raw:h(p[1]),decoded:h(p[2]),class:p[3],value:h(p[4],2),effect:p[5],nativeTicks:d(p[6]),ordinal:d(p[7]),why:p[8]});}
    else if(tag==='EXEC'){equal(p.length,7,'execute fields');event(tag,{rawPage:h(p[0]),decodedPage:h(p[1]),class:p[2],nativeTicks:d(p[3]),ordinal:d(p[4]),generation:d(p[5]),sha256:p[6]});}
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

const kindNames={1:'ram',2:'rom',4:'unmapped'};
const effectNames={1:'ram-read',2:'ram-commit',3:'rom-read',4:'rom-ignored',7:'open-bus',8:'unmapped-ignored'};
function nativeExpectedState(js,quantum){
  const s=Object.fromEntries(stateNames.map(name=>[name,name==='gdtrBase'?js.gdtr.base:name==='idtrBase'?js.idtr.base:name==='gdtrLimit'?0xffff:name==='idtrLimit'?0xffff:js[name]]));
  s.cr0=0x7ffffff0;s.edx=quantum<12?0:js.edx;
  if(quantum===9||quantum===10)s.eax=0x7ffffff0;
  return s;
}
function assertRawReset(native,js){
  equal(native.resetState,nativeExpectedState(js.reset.cpu,0),'predeclared raw reset differences');
  equal(native.resetDebug,[0,0,0,0,0xffff1ff0,0x400],'raw reset debug registers');
  const expected=js.reset.cpu;
  equal(native.resetExtra,{dr6:0xffff1ff0,dr7:0x400,es:0,fs:0,gs:0,csIndex:0xf000>>>3,csTi:0,csRpl:0,
    csValid:7,csPresent:1,csDpl:0,csSegment:1,csType:3,csBase:0xffff0000,csLimit:0xffff,
    csGranular:0,csDefault32:0,csAvailable:0,pendingEvent:0,eventMask:0x0f40},'raw reset cache and pending state');
  for(const s of native.resetSegments){
    const selector=s.index===1?0xf000:0;
    equal(s,{index:s.index,selector,selectorIndex:selector>>>3,ti:0,rpl:0,valid:7,present:1,dpl:0,segment:1,
      type:3,base:expected.segmentCaches[s.index].base,limit:0xffff,granular:0,default32:0,available:0},'raw native reset segment cache');
  }
  for(const s of native.resetSystem)equal(s,{index:s.index,selector:0,selectorIndex:0,ti:0,rpl:0,valid:1,present:1,dpl:0,
    segment:0,type:s.index===6?2:11,base:0,limit:0xffff,granular:0,default32:0,available:0},'raw native reset LDTR/TR');
}
export function assertNativeColdResetArmProof(arm,rom,name=arm.mode){
  const js=qualifiedColdJsOracle(),native=arm.native;
  equal(native,parseColdNativeLog(native.records.map(r=>['BWS9',r.tag,...r.fields].join('\t')).join('\n')+'\n'),
    'raw native records authenticate all structured evidence');
  equal(arm.mode,name,'arm name');equal(arm.requestedBudget,coldBudgets[name],'successful-work budget');
  equal(arm.artifacts.exitCode,0,'native normal exit');equal(arm.artifacts.signal,null,'native normal signal');
  equal(native.activation,{cs:0xf000,eip:0xfff0,copiedBytes:0,a20:1},'cold activation without copied RAM');
  equal(native.ready,{cs:0xf000,eip:0xfff0,nativeTicks:0,successfulQuanta:0},'pre-fetch READY');
  assertRawReset(native,js);
  const api={};
  for(const name of ['resume-before-activation','irq-before-activation','zero-native-budget','zero-quantum-budget',
    'null-callbacks','incomplete-native-tick','incomplete-quantum','invalid-irq-line','callback-reentry','line-reentry'])api[name]='rejected';
  api['due-now']='zero-work';equal(native.apiProbes,api,'actual native API rejection probes');
  const host=new NativeColdResetHost(rom);
  equal(arm.host.seed,host.seed,'actual loaded seed');equal(arm.host.initial,host.initial,'fresh board');equal(arm.host.reset,host.reset,'single reset four-clock epoch');
  const to=arm.rpc.toNative,from=arm.rpc.fromNative;check(Array.isArray(to)&&Array.isArray(from),'raw RPC arrays');
  let sent=0,command=null,lastCommand=0,beforeN=0,beforeQ=0;const commands=[],requests=[],replies=[],dones=[];
  equal(parseColdRpcLine(from[0]),{kind:'READY',...native.ready},'dedicated READY/raw mirror');
  for(const line of from.slice(1)){
    if(!command){
      command=parseColdRpcLine(to[sent++]);check(command.kind==='CMD'&&command.seq===++lastCommand,'raw command sequence');
      const logged=native.events.filter(e=>e.tag==='CMD')[commands.length];
      equal(logged&&[logged.seq,logged.verb,logged.arg0,logged.arg1,logged.deadline],[command.seq,command.verb,command.arg0,command.arg1,command.deadline],'native command/raw request mirror');
      commands.push(command);beforeN=host.nativeTicks;beforeQ=host.successfulQuanta;
      if(command.verb==='RUN'){
        equal([command.arg0,command.arg1,command.deadline],[1000000,coldBudgets[name],'18446744073709551615'],'independent native/quantum limits');host.beginRun();
      }else equal([command.verb,command.arg0,command.arg1,command.deadline],['STOP',0,0,'0'],'terminal STOP');
    }
    const message=parseColdRpcLine(line);
    if(message.kind==='REQ'){
      equal(command.verb,'RUN','callback only during RUN');const reply=host.handleRequest(message),wire=encodeColdReply(reply);
      equal(to.slice(sent,sent+wire.length),wire,'actual board reply bytes/classification/clock replay');sent+=wire.length;
      if(reply.kind==='PAGE')assembleColdPageReply(wire);
      requests.push(message);replies.push(reply);
    }else{
      check(message.kind==='DONE'&&message.seq===command.seq&&message.verb===command.verb,'DONE closes its command');
      equal([message.totalNativeTicks,message.totalQuanta],[host.nativeTicks,host.successfulQuanta],'DONE disjoint clock ledger');
      if(command.verb==='RUN'){
        equal([message.chargedNativeTicks,message.chargedQuanta],[host.nativeTicks-beforeN,host.successfulQuanta-beforeQ],'bounded slice charged work');
        check(message.chargedNativeTicks<=1000000&&message.chargedQuanta<=coldBudgets[name],'slice limits');
        check(!message.ifFlag&&!message.irqDelivered&&message.repIterations===0&&message.faults===0,'unowned IRQ/REP/fault/IF');
        host.endRun();
      }else equal(message.value,0,'STOP result');
      dones.push(message);command=null;
    }
  }
  check(!command&&sent===to.length,'no unconsumed command/reply payload');
  equal(commands.at(-1).verb,'STOP','explicit terminal shutdown');
  const runDones=dones.filter(d=>d.verb==='RUN'),terminal=runDones.at(-1);
  equal([terminal.reason,terminal.cs,terminal.eip,terminal.chargedNativeTicks,terminal.chargedQuanta],
    [4,0xf000,0x18a,0,0],'zero-work native terminal halt');
  equal([host.nativeTicks,host.successfulQuanta],[49,49],'native/successful clocks');
  const final=host.finish();equal(arm.host.journal,host.journal,'actual complete board callback journal');
  equal(arm.host.bus,host.bus,'authoritative typed byte bus');equal(arm.host.final,final,'actual terminal settlement/RAM digest');
  equal(final.after.board,js.final.board,'selected actual board device/debt state matches JS checkpoint');
  equal(final.before.board,js.beforeSettle.board,'no invented idle horizon before settlement');
  equal(final.ram,js.final.ram,'RAM signature and ROM/openbus reads');
  equal(final.resetWitness,coldResetDifferences.guestWitness.native,'guest-produced native reset witness');
  equal([final.romByte,final.aliasRomByte,final.openbusByte],[0xa7,0xa7,0xff],'actual final decoding');
  equal(final.after.marker,'CRST001','actual E9 marker');
  const events=native.events,type=tag=>events.filter(e=>e.tag===tag);
  equal(type('ATTEMPT').length,49,'raw native instruction attempt count');
  equal(type('QUANTUM').length,49,'successful-work event count');equal(type('NATIVE_TICK').length,49,'native tick count');
  const pref=type('PREFETCH');check(pref.length>0,'actual native prefetch witness required');
  equal([pref[0].physicalPC,pref[0].nativeTicks,pref[0].successfulQuanta],[0xfffffff0,0,0],'first physical reset prefetch');
  check(pref[0].ordinal<type('ATTEMPT')[0].ordinal,'prefetch precedes first decoded instruction');
  const reqEvents=type('RPC_REQ'),replyEvents=events.filter(e=>['RPC_REP','RPC_MEM','RPC_PAGE'].includes(e.tag));
  equal(reqEvents.length,requests.length,'native request mirror count');equal(replyEvents.length,replies.length,'native reply mirror count');
  const pages=new Map();
  for(let i=0;i<requests.length;i++){
    const request=requests[i],reply=replies[i],req=reqEvents[i],rep=replyEvents[i];
    const {kind,...reqFields}=request;const {tag,ordinal,...nativeReq}=req;equal(nativeReq,reqFields,'native request raw RPC mirror');
    equal([rep.seq,rep.nativeTicks,rep.successfulQuanta],[request.seq,request.nativeTicks,request.successfulQuanta],'native reply pre-completion clock tuple');
    check(req.ordinal<rep.ordinal&&(i===requests.length-1||rep.ordinal<reqEvents[i+1].ordinal),'synchronous native RPC chronology');
    if(reply.kind==='REP')equal(rep.value,reply.value,'scalar native reply mirror');
    else if(reply.kind==='MEM')equal([rep.decoded,rep.class,rep.effect,rep.hex],[reply.decoded,reply.class,reply.effect,reply.hex],'typed native memory reply mirror');
    else{
      equal([rep.decoded,rep.generation,rep.class,rep.sha256],[reply.decoded,reply.generation,reply.class,reply.sha256],'verified native page metadata');
      const chunks=native.records.filter(r=>r.tag==='PAGE_CHUNK'&&Number(r.fields[0])===request.seq);
      equal(chunks.map(r=>({index:Number(r.fields[1]),hex:r.fields[2]})),reply.chunks,'all native verified page chunks');
      pages.set(request.arg0,{reply,ordinal:rep.ordinal,bytes:Buffer.concat(reply.chunks.map(c=>Buffer.from(c.hex,'hex')))});
    }
    const completion=request.operation==='QUANTUM'?type('QUANTUM').find(e=>e.successfulQuanta===request.successfulQuanta+1):
      request.operation==='NATIVE_TICK'?type('NATIVE_TICK').find(e=>e.nativeTicks===request.nativeTicks+1):
      ['READ','WRITE'].includes(request.operation)?type('MEM').find(e=>e.ordinal>rep.ordinal):
      request.operation==='PAGE'?type('EXEC').find(e=>e.ordinal>rep.ordinal):type('PORT').find(e=>e.ordinal>rep.ordinal);
    check(completion&&rep.ordinal<completion.ordinal&&(i===requests.length-1||completion.ordinal<reqEvents[i+1].ordinal),'reply precedes typed completion');
  }
  equal([...pages.keys()],[0xfffff000,0xf0000],'two actual immutable ROM page fills');
  for(const e of type('EXEC')){
    const page=pages.get(e.rawPage);check(page&&page.ordinal<e.ordinal,'execute pointer published after complete verified page');
    equal([e.decodedPage,e.class,e.generation,e.sha256],[page.reply.decoded,'rom',0,page.reply.sha256],'stable ROM execution admission');
  }
  const actualPCs=new Set(js.steps.map(s=>s.before.pc));
  for(const e of pref)check(actualPCs.has(e.physicalPC),'unowned native prefetch address');
  const posts=type('POST_STATE');equal(posts.length,49,'each successful instruction raw state');
  equal(type('POST_EXTRA').length,49,'each instruction extra state');equal(type('POST_DR').length,49,'each instruction debug state');
  equal(type('POST_SEG').length,294,'each instruction six caches');equal(type('POST_SYS').length,98,'each instruction LDTR/TR');
  const attempts=type('ATTEMPT');
  for(let i=0;i<49;i++){
    const step=js.steps[i],a=attempts[i],q=type('QUANTUM')[i],tick=type('NATIVE_TICK')[i],post=posts[i];
    equal([a.cs,a.eip,a.physicalPC,a.nativeTicks,a.successfulQuanta],[step.before.cs,step.before.eip,step.before.pc,i,i],'actual decoded instruction entry');
    const fetched=js.events.slice(step.firstOrdinal-1,step.lastOrdinal).filter(e=>e.kind==='fetch');
    equal(a.hex,Buffer.from(fetched.map(e=>e.value)).toString('hex'),'native decoded immutable bytes match JS actual fetch stream');
    equal(a.ilen,fetched.length,'Bochs decoded length matches actual JS instruction bytes');
    const page=pages.get((a.physicalPC&0xfffff000)>>>0);check(page,'instruction must use admitted page');
    const offset=a.physicalPC&4095;equal(a.hex,page.bytes.subarray(offset,offset+a.ilen).toString('hex'),'actual native cached instruction bytes bound to verified ROM');
    equal([q.kind,q.preQ,q.successfulQuanta,q.nativeTicks,q.cs,q.eip,q.postECX,q.postEDI],
      [0,i,i+1,i,step.before.cs,step.before.eip,step.after.ecx,step.after.edi],'successful ordinary work attribution');
    equal([tick.count,tick.preTick,tick.nativeTicks,tick.successfulQuanta],[1,i,i+1,i+1],'zero-board-charge native tick');
    equal([post.nativeTicks,post.successfulQuanta],[i,i+1],'post-instruction raw state before native tick');
    equal(post.state,nativeExpectedState(step.after,i+1),'named CPU state differences only');
    check(a.ordinal<q.ordinal&&q.ordinal<post.ordinal&&post.ordinal<tick.ordinal,'committed instruction accounting chronology');
    for(const e of events.filter(e=>['POST_STATE','POST_EXTRA','POST_SEG','POST_SYS','POST_DR'].includes(e.tag)&&e.successfulQuanta===i+1)){
      equal([e.nativeTicks,e.successfulQuanta],[i,i+1],'every post-state clock tuple');
      check(q.ordinal<e.ordinal&&e.ordinal<tick.ordinal,'every extra/cache/debug record is committed before native tick');
    }
    const extra=type('POST_EXTRA')[i];
    equal([extra.extra.dr6,extra.extra.dr7,extra.extra.csIndex,extra.extra.csTi,extra.extra.csRpl,extra.extra.csPresent,extra.extra.csDpl,extra.extra.csSegment,extra.extra.csType,extra.extra.csGranular,extra.extra.csAvailable],
      [0xffff1ff0,0x400,step.after.cs>>>3,0,0,1,0,1,3,0,0],'full extra native cache attributes');
    check([1,3,5,7].includes(extra.extra.csValid),'native CS cache validity flags');
    equal([extra.extra.es,extra.extra.fs,extra.extra.gs],[step.after.es,step.after.fs,step.after.gs],'actual extra selectors');
    equal([extra.extra.csBase,extra.extra.csLimit,extra.extra.csDefault32,extra.extra.pendingEvent,extra.extra.eventMask],
      [step.after.segmentCaches[1].base,0xffff,0,0,0x0f40],'post-instruction hidden CS and pending state');
    equal(type('POST_DR')[i].debug,native.resetDebug,'native debug reset profile retained');
    const segments=type('POST_SEG').filter(e=>e.successfulQuanta===i+1);equal(segments.map(e=>e.segment.index),[0,1,2,3,4,5],'per-instruction cache completeness');
    for(const e of segments){const s=e.segment,j=step.after.segmentCaches[s.index],selector=step.after[['es','cs','ss','ds','fs','gs'][s.index]];
      check([1,3,5,7].includes(s.valid),'native transient segment cache flags');
      equal([s.selectorIndex,s.ti,s.rpl,s.dpl,s.segment,s.granular,s.available],[native.resetSegments[s.index].selectorIndex,0,0,0,1,0,0],'full native segment cache metadata');
      equal([s.selector,s.base,s.limit,s.present,s.default32,s.type],[selector,j.base,j.limit,1,0,3],'native real-mode cache attributes');}
    const sys=type('POST_SYS').filter(e=>e.successfulQuanta===i+1);equal(sys.map(e=>e.segment),native.resetSystem,'native LDTR/TR reset state retained');
    const charge=host.journal.filter(e=>e.kind==='request'&&e.request.operation==='QUANTUM')[i];
    equal(charge.after.board,step.boardAfter,'each successful instruction actual board clock/debt/devices');
  }
  const data=host.bus,jsData=js.events.filter(e=>['read','write'].includes(e.kind));equal(data.length,20,'architectural data byte count excludes page fills');
  for(let i=0;i<data.length;i++){
    const e=data[i],j=jsData[i],nativeWitness=e.raw>=0x510&&e.raw<0x518;
    const value=nativeWitness?coldResetDifferences.guestWitness.native[e.raw-0x510]:j.value;
    equal([e.kind,e.raw,e.decoded,e.value,e.successfulQuanta,e.boardCycles],[j.kind,j.address,j.decoded,value,j.quantum,j.boardCycles],'actual JS/native byte bus with named reset witness differences');
  }
  const mem=type('MEM');equal(mem.length,20,'native architectural data callbacks');
  for(let i=0;i<mem.length;i++){
    const e=mem[i],b=data[i];equal([e.rw,e.raw,e.decoded,e.class,e.value,e.effect,e.nativeTicks,e.why],
      [b.kind==='write'?'W':'R',b.raw,b.decoded,kindNames[b.class],b.value,effectNames[b.effect],b.nativeTicks,'ordinary'],'native typed per-byte effect mirror');
  }
  equal(type('PORT').map(e=>[e.direction,e.port,e.width,e.value]),[...Buffer.from('CRST001')].map(v=>['out',0xe9,1,v]),'actual native PIO bytes');
  const idle=type('HALT_IDLE');equal(idle.length,{continuous:2,budget1:1,budget2:1,budget257:2}[name],'measured raw terminal native halt count');
  for(const e of idle)equal([e.cs,e.eip,e.nativeTicks,e.ifFlag,e.activity,e.pending],[0xf000,0x18a,49,false,1,0],'terminal native zero-work halt state');
  const c=native.finalCounters;
  equal(c,{nativeTicks:49,successfulQuanta:49,attempts:49,completed:49,repIterations:0,repPartial:0,faults:0,
    portCommits:7,irqDeliveries:0,haltIdleCuts:idle.length,rpcRequests:requests.length,rpcReplies:replies.length,nativeTickCallbacks:49,quantumCallbacks:49},'complete native counters');
  equal(native.callbacks,{physicalReads:requests.filter(r=>r.operation==='READ').length,
    physicalWrites:requests.filter(r=>r.operation==='WRITE').length,executePages:type('EXEC').length,nativeTickCallbacks:49,quantumCallbacks:49},'raw physical callback summary');
  equal(native.fallback,{bochsRamReads:0,bochsRamWrites:0,bochsDirectPointers:0,bochsPio:0,bochsTimer:0},'exact zero fallback evidence');
  equal(native.finalState,posts.at(-1).state,'native final state equals last successful commit');
  equal(native.slices.length,runDones.length,'raw native slice/DONE count');
  for(let i=0;i<runDones.length;i++){
    const s=native.slices[i],d=runDones[i];
    equal([s.cmdSeq,s.reason,s.chargedNativeTicks,s.chargedQuanta,s.exitCs,s.exitEip,s.afterNativeTicks,s.afterQuanta,s.attempts,s.completed,s.repIterations,s.faults,s.exitIf,s.exitActivity,s.irqDelivered],
      [d.seq,d.reason,d.chargedNativeTicks,d.chargedQuanta,d.cs,d.eip,d.totalNativeTicks,d.totalQuanta,d.attempts,d.completed,d.repIterations,d.faults,d.ifFlag?512:0,d.activity,Number(d.irqDelivered)],'complete native slice RPC mirror');
    equal([s.requestedNativeTicks,s.effectiveNativeTicks,s.requestedQuanta],[1000000,1000000,coldBudgets[name]],'native independent caps');
    equal([s.beforeNativeTicks,s.beforeQuanta],[i?runDones[i-1].totalNativeTicks:0,i?runDones[i-1].totalQuanta:0],'raw slice continuity');
    equal([s.eventDue,s.pendingIrq,s.pendingFault,s.irqDeliveries,s.repPartial],[0,0,0,0,0],'unowned cut/event evidence');
  }
  const logical=[];
  for(const {ordinal,...e} of events.filter(e=>e.tag!=='CMD')){
    if(e.tag==='HALT_IDLE'&&logical.at(-1)?.tag==='HALT_IDLE'){
      equal(e,logical.at(-1),'only adjacent identical effect-free terminal idle collapses');
      continue;
    }
    logical.push(e);
  }
  equal(logical.length,958,'complete bounded logical native event count');
  return {resetState:native.resetState,resetExtra:native.resetExtra,resetSegments:native.resetSegments,resetSystem:native.resetSystem,
    resetDebug:native.resetDebug,logical,host:arm.host,finalState:native.finalState,callbacks:native.callbacks};
}

// Independently built r2 candidate, authenticated by root before any formal
// source-bound proof. These pins do not themselves claim an execution result.
export const coldBuildPins=Object.freeze({
  bochsRevision:'0e45b736ef9792eb9b752b0a35db49eaf2faea47',
  binarySha256:'fd8decd0621f2c93755559940182bef6d41a1d4d5f1f8ed7b0d79a47875b11cc',
  configSha256:'d4945445c2412c0b4e8c5cac80cee28d443bb438c36c9ea6b1bb5196147f1e8c',
  runtimeSha256:'a7b44a0829fefe5adf3065cd909dd754928ac3c18aaf9519909d6553a3d1c233',
});
export const coldGuards=Object.freeze({
  'unsupported-span-width':'host-physical-read','physical-overflow':'host-physical-read',
  'unsafe-execute-ram':'unsafe-execute-page','unsafe-execute-mmio':'unsafe-execute-page','unsafe-execute-unmapped':'unsafe-execute-page',
  'unexpected-pio':'host-port-out','bochs-ram-read':'Bochs-RAM-read-fallback','bochs-ram-write':'Bochs-RAM-write-fallback',
  'bochs-direct-pointer':'Bochs-direct-pointer-fallback','bochs-pio':'Bochs-PIO-fallback','bochs-timer':'Bochs-timer-fallback','unknown-trap':'unexpected-fault',
});
export const coldTransports=Object.freeze({
  'command-sequence':'rpc-command-sequence','command-prefix':'rpc-command','command-zero-budget':'rpc-run-budget',
  'command-overlong-line':'rpc-line-bound','scalar-sequence':'rpc-reply','scalar-range':'rpc-reply-range',
  'page-generation':'rpc-page-metadata','page-classification':'rpc-page-metadata','page-decoded':'rpc-page-metadata',
  'page-chunk-order':'rpc-page-chunk','page-chunk-width':'rpc-byte-length','page-end-sequence':'rpc-page-end','page-digest':'rpc-page-sha256',
  'memory-classification':'host-memory-classification','memory-write-commit':'host-write-commit','memory-rom-observed':'host-rom-observed-value',
});
const historyCache=new Map(),inventoryCache=new Map();
function historicalBlob(revision,file){
  const key=revision+':'+file;
  try{
    const bytes=execFileSync('git',['show',key],{cwd:root,maxBuffer:4<<20,stdio:['ignore','pipe','pipe']});
    historyCache.set(key,coldSha(bytes));return bytes;
  }catch{fail(`historical source blob unavailable ${file}`);}
}
function historicalInventory(revision){
  if(inventoryCache.has(revision))return inventoryCache.get(revision);
  const runner='scripts/run-bochs-cpu3-native-cold-reset-compare.mjs';
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
const qualifiedPatchedHashes=Object.freeze({
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
function sourceProof(source){
  check(/^[0-9a-f]{40}$/.test(source.boardRevision),'source commit');
  for(const [key,value] of Object.entries(coldBuildPins))equal(source[key],value,`audited native ${key}`);
  check(source.sourceHashes&&typeof source.sourceHashes==='object','measured source inventory');
  equal(Object.keys(source.sourceHashes).sort(),historicalInventory(source.boardRevision),'complete captured transitive source inventory');
  for(const path of ['scripts/bochs-cpu3-native-cold-reset-host.mjs','scripts/bochs-cpu3-native-cold-reset-compare.mjs',
    'scripts/run-bochs-cpu3-native-cold-reset-compare.mjs','scripts/bochs-cpu3-native-cold-reset/runtime.inc',
    'scripts/bochs-cpu3-native-cold-reset/abi.h','scripts/bochs-cpu3-native-cold-reset/runtime.h',
    'scripts/bochs-cpu3-native-cold-reset/patch.mjs','scripts/prepare-bochs-cpu3-native-cold-reset.mjs',
    'scripts/bochs-cpu3-native-cold-reset/wire-contract.md','src/experimental/i80386-at-machine.js',
    'src/experimental/i80386.js','src/i8086-machine.js','test/fixtures/i80386-free-cold-reset.S'])
    check(Object.hasOwn(source.sourceHashes,path),`missing measured source ${path}`);
  for(const [file,digest] of Object.entries(source.sourceHashes)){
    check(/^[a-zA-Z0-9_./-]+$/.test(file)&&!file.startsWith('/')&&!file.split('/').includes('..'),'unsafe measured source path');
    check(/^[0-9a-f]{64}$/.test(digest),'source hash shape');
    const key=source.boardRevision+':'+file;
    if(!historyCache.has(key)){
      try{historyCache.set(key,coldSha(execFileSync('git',['show',key],{cwd:root,maxBuffer:4<<20,stdio:['ignore','pipe','pipe']})));}
      catch{fail(`historical source blob unavailable ${file}`);}
    }
    equal(digest,historyCache.get(key),'actual committed measured source');
  }
  equal(source.boardConfigurationSha256,coldSha(JSON.stringify(coldBoardConfig)),'actual board configuration hash');
  for(const key of ['manifestSha256','manifestCanonicalSha256','bochsrcSha256'])check(/^[0-9a-f]{64}$/.test(source[key]),`source metadata ${key}`);
  equal(source.runtimeSha256,source.sourceHashes['scripts/bochs-cpu3-native-cold-reset/runtime.inc'],'compiled runtime source mirror');
  equal(source.romSha256,'ea3d123a6fc9bfaee7258e98f44bc5b0d91b34aea9a01fcc5e5606339422e49b','free ROM binary');
  equal(source.fixtureSha256,'aedf3c0262046d6aa219c11db97ccdb9eab1868a6a56d79413c621ec3c4c740f','free fixture source');
  equal(source.fixtureSha256,source.sourceHashes['test/fixtures/i80386-free-cold-reset.S'],'fixture source mirror');
  const patchPaths=['bochs/bochs.h','bochs/cpu/cpu.cc','bochs/cpu/paging.cc','bochs/cpu/exception.cc','bochs/cpu/event.cc',
    'bochs/main.cc','bochs/memory/memory.cc','bochs/memory/misc_mem.cc','bochs/pc_system.h','bochs/pc_system.cc','bochs/iodev/devices.cc','bochs/cpu/init.cc'];
  equal(Object.keys(source.patchedHashes).sort(),patchPaths.sort(),'complete native source pins');
  equal(source.patchedHashes,qualifiedPatchedHashes,'independently derived qualified native source pins');
  for(const digest of Object.values(source.patchedHashes))check(/^[0-9a-f]{64}$/.test(digest),'patched digest');
  equal(source.patchedHashes['bochs/cpu/init.cc'],'4bdf4a39a2a3ceecafdd070836a055b5dec8696acf59652e2150a12fdfa7a9f3','unchanged CPU reset source');
}
function artifactProof(report){
  const seen=new Set();
  const file=(entry)=>{
    equal(Object.keys(entry).sort(),['path','sha256'],'artifact shape');
    check(typeof entry.path==='string'&&/^[a-zA-Z0-9._-]+$/.test(entry.path),'unsafe artifact path');
    check(!seen.has(entry.path),'duplicate artifact path');seen.add(entry.path);
    check(/^[0-9a-f]{64}$/.test(entry.sha256),'artifact digest');
  };
  const groups=['bochsrc',...Object.keys(coldBudgets),...Object.keys(coldGuards).map(n=>'guard-'+n),...Object.keys(coldTransports).map(n=>'transport-'+n)];
  equal(Object.keys(report.artifacts).sort(),groups.sort(),'complete actual artifact groups');
  file(report.artifacts.bochsrc);equal(report.artifacts.bochsrc.sha256,report.source.bochsrcSha256,'bochsrc source artifact mirror');
  for(const name of Object.keys(coldBudgets)){
    equal(report.arms[name].artifacts,report.artifacts[name],'arm artifact mirror');
    equal(Object.keys(report.artifacts[name].files).sort(),['bochsLog','rpcFromNative','rpcToNative','stderr','stdout'],'arm raw artifact set');
    for(const entry of Object.values(report.artifacts[name].files))file(entry);
    equal(Object.keys(report.arms[name].raw).sort(),['rpcFromNative','rpcToNative','stderr','stdout'],'arm complete raw strings');
    for(const [kind,text] of Object.entries(report.arms[name].raw)){equal(coldSha(text),report.artifacts[name].files[kind].sha256,'arm actual raw artifact digest');}
    equal(parseColdNativeLog(report.arms[name].raw.stderr),report.arms[name].native,'raw stderr native parser binding');
    equal(report.arms[name].raw.rpcToNative,report.arms[name].rpc.toNative.join('\n')+'\n','raw outgoing RPC binding');
    equal(report.arms[name].raw.rpcFromNative,report.arms[name].rpc.fromNative.join('\n')+'\n','raw incoming RPC binding');
  }
  for(const [group,expected,prefix] of [[report.probes,coldGuards,'guard'],[report.transportProbes,coldTransports,'transport']]){
    equal(Object.keys(group).sort(),Object.keys(expected).sort(),'actual rejection probe set');
    for(const [name,reason] of Object.entries(expected)){
      const probe=group[name];equal([probe.name,probe.expected,probe.observedFailure],[name,reason,reason],'named native FAIL witness');
      equal(probe.exit,{code:null,signal:'SIGABRT'},'native rejection exit');
      equal(probe.files,report.artifacts[prefix+'-'+name],'rejection artifact mirror');
      equal(Object.keys(probe.files).sort(),['bochsLog','rpcFromNative','rpcToNative','stderr','stdout'],'rejection raw artifact set');
      for(const entry of Object.values(probe.files))file(entry);
      equal(Object.keys(probe.raw).sort(),['rpcFromNative','rpcToNative','stderr','stdout'],'probe complete raw strings');
      for(const [kind,text] of Object.entries(probe.raw))equal(coldSha(text),probe.files[kind].sha256,'rejection actual raw artifact digest');
      equal([...probe.raw.stderr.matchAll(/^BWS9\tFAIL\t([^\n]+)$/gm)].map(m=>m[1]),[reason],'raw named FAIL witness');
      if(prefix==='transport')equal(probe.injected,true,'actual transport injection reached');
    }
  }
}
export function assertNativeColdResetProof(report,rom){
  equal(Object.keys(report).sort(),['arms','artifacts','claim','javascriptOracle','probes','resetDifferences','schema','source','transportProbes'],'report shape');
  equal(report.schema,'bw.bochs-cpu3-native-cold-reset.v1','schema');
  equal(report.claim,'native-cold-entry-actual-board-bus-ownership-only','bounded claim');
  equal(report.resetDifferences,coldResetDifferences,'predeclared named raw reset differences');
  equal(Object.keys(report.arms??{}).sort(),Object.keys(coldBudgets).sort(),'four actual native arms');
  sourceProof(report.source);artifactProof(report);
  equal(report.javascriptOracle,{path:'docs/receipts/2026-10-01-i80386-js-cold-reset-oracle-capture.json',
    sha256:'e35fdc788ed3d27020563b4c7dbb2c7ecbf6c91959e0abe2ebd043f0490d6703',
    boardRevision:'9896ba218102330a4990a2c6c8f0401880a0e920',cpuProfile:'compatibility',strict386:false},'actual published JS baseline');
  equal(Object.keys(report.arms).sort(),Object.keys(coldBudgets).sort(),'four actual native arms');
  equal(coldSha(rom),report.source.romSha256,'actual ROM bytes supplied');
  const proof={};for(const name of Object.keys(coldBudgets))proof[name]=assertNativeColdResetArmProof(report.arms[name],rom,name);
  for(const name of ['budget1','budget2','budget257'])equal(proof[name],proof.continuous,'complete native/board logical parity across budgets');
  return {status:'native-cold-entry-actual-board-proof-pass',nativeTicks:49,successfulQuanta:49,boardCycles:298,
    instructionBytes:143,dataReadBytes:5,dataWriteBytes:15,pioBytes:7,pageFills:2,architecturalResetParity:false,
    slices:Object.fromEntries(Object.entries(report.arms).map(([name,arm])=>[name,arm.native.slices.length]))};
}
