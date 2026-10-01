/** Explicit direct/FIFO callback projection; raw input records remain retained. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export function ownedChildConfiguration(configuration,stem){
 assert.equal(typeof configuration,'string','canonical configuration text required');
 const directives=[...configuration.matchAll(/^([ \t]*log:[ \t]*)([^\r\n]*)(\r?)$/gm)];
 assert.equal(directives.length,1,'exactly one Bochs log directive required');
 assert.ok(typeof stem==='string'&&stem.startsWith('/')&&!/[\r\n\0]/.test(stem),'absolute child artifact stem');
 const logPath=stem+'.bochs.log',path=stem+'.bochsrc',match=directives[0];
 const text=configuration.slice(0,match.index)+match[1]+JSON.stringify(logPath)+match[3]+configuration.slice(match.index+match[0].length);
 const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
 return {text,path,logPath,sha256:sha(text),sourceSha256:sha(configuration)};
}
const plain=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v));
const hex=bytes=>Buffer.from(bytes).toString('hex');
export function fifoCallback(record){
 const {request:r,reply:p,before,after}=record;
 const operation={READ:'read',WRITE:'write',PAGE:'page',QUANTUM:'quantum',NATIVE_TICK:'nativeTick',PIO_OUT:'outPort',ACK:'ack'}[r.operation];
 assert.ok(operation,'unsupported FIFO callback operation');
 const args=r.operation==='READ'?[r.arg0,r.arg1,null]:r.operation==='WRITE'?[r.arg0,r.arg1,[...Buffer.from(r.payload,'hex')]]:r.operation==='PAGE'?[r.arg0]:r.operation==='QUANTUM'?[r.arg0]:r.operation==='PIO_OUT'?[r.arg0,r.arg1,r.arg2]:[];
 let result=p.value;
 if(['READ','WRITE'].includes(r.operation))result={hex:p.hex,decoded:p.decoded,kind:p.class,effect:p.effect,generation:p.generation,mappingEpoch:p.mappingEpoch,boardA20:p.boardA20};
 if(r.operation==='PAGE')result={hex:p.chunks.map(c=>c.hex).join(''),raw:r.arg0,decoded:p.decoded,kind:p.class,generation:p.generation,mappingEpoch:p.mappingEpoch,boardA20:p.boardA20,sha256:p.sha256};
 if(r.operation==='PIO_OUT')result={value:p.value,boardA20:p.boardA20,mappingEpoch:p.mappingEpoch};
 return {operation,args,result,before,after};
}
export function directCallback(event){
 const value=plain(event),r=event.result;
 if(event.operation==='write')value.args=[event.args[0],event.args[1],[...event.args[2]]];
 if(['read','write','page'].includes(event.operation)){value.result={...r,hex:hex(r.bytes)};delete value.result.bytes;}
 return value;
}
export function assertDirectCallbackParity(direct,fifo){
 assert.equal(direct.status,'UNQUALIFIED_DIRECT_DIAGNOSTIC');
 assert.ok(direct.capture,'ordered callback parity requires actual capture');
 const requests=fifo.host.journal.filter(event=>event.kind==='request').map(fifoCallback);
 assert.deepEqual(direct.callbacks.map(directCallback),plain(requests),'full ordered callback arguments/results and CPU-independent whole board checkpoints');
 assert.deepEqual(direct.settled,plain(fifo.host.final.after),'settled whole board, mapping, generations and ledger');
 return {callbacks:requests.length,fullOrderedCallbackParity:true,nativeCpuParity:false,scope:'callback and board comparison only; CPU snapshots require separately authenticated native trace comparison'};
}
export function assertCaptureModeParity(captured,uncaptured){
 assert.equal(captured.capture,true);assert.equal(uncaptured.capture,false);
 for(const field of ['reset','final','checkpoints','settled','ramSha256','backingSlices','callbackCounts','resumes','closed','quanta'])assert.deepEqual(captured[field],uncaptured[field],`capture mode parity: ${field}`);
 assert.equal(uncaptured.callbacks.length,0,'capture disabled callback census');
}

/** Each mode gets a fresh process because native initialization is terminal. */
export async function collectDirectMatrix({addon,sha256,configuration,directory,fifoCapture=null}){
 const {mkdirSync,writeFileSync,readFileSync,openSync,closeSync}=await import('node:fs');
 const {resolve,join}=await import('node:path');
 const {spawnSync}=await import('node:child_process');
 const {fileURLToPath}=await import('node:url');
 mkdirSync(directory,{recursive:false});writeFileSync(join(directory,'source.bochsrc'),configuration,{flag:'wx'});
 const entry=fileURLToPath(new URL('./probe-i80386-native-direct-board-adapter.mjs',import.meta.url));
 const audit=fileURLToPath(new URL('./audit-i80386-native-direct-board-mode.mjs',import.meta.url)),receipts={};
 for(const [mode,quanta] of Object.entries({continuous:300,budget1:1,budget2:2,budget257:257})){
  const paths={};
  for(const capture of [true,false]){
   const stem=join(resolve(directory),`${mode}-capture-${capture}`),input=stem+'.input.json',output=stem+'.json';
   const config=ownedChildConfiguration(configuration,stem);writeFileSync(config.path,config.text,{flag:'wx'});
   writeFileSync(input,JSON.stringify({addon,sha256,configuration:config.path,configurationArtifact:config,capture,quanta,control:'run',output}));
   // Send logs directly to immutable files; do not buffer them in the parent.
   const stdout=openSync(stem+'.stdout','wx'),stderr=openSync(stem+'.stderr','wx');let child;
   try{child=spawnSync(process.execPath,['--max-old-space-size=1024',entry,input],{timeout:120000,stdio:['ignore',stdout,stderr]});}finally{closeSync(stdout);closeSync(stderr);}
   writeFileSync(stem+'.exit.json',JSON.stringify({status:child.status,signal:child.signal,error:child.error?.message??null}));
   assert.equal(child.error,undefined,'child timeout/spawn failure');assert.equal(child.signal,null,'direct child signal');assert.equal(child.status,0,'direct child exit');
   paths[String(capture)]={report:output,stderr:stem+'.stderr'};
  }
  const input=join(resolve(directory),mode+'.audit-input.json'),receipt=join(resolve(directory),mode+'.audit.json');
  writeFileSync(input,JSON.stringify({mode,paths,fifoCapture,receipt}));
  // Each audit child parses exactly one mode pair and (optionally) one FIFO
  // receipt. Its exit releases all report memory before the next mode starts.
  const child=spawnSync(process.execPath,['--max-old-space-size=1024',audit,input],{encoding:'utf8',timeout:120000,maxBuffer:1024*1024});
  writeFileSync(join(directory,mode+'.audit.stdout'),child.stdout??'');writeFileSync(join(directory,mode+'.audit.stderr'),child.stderr??'');
  assert.equal(child.error,undefined,'mode audit timeout/spawn failure');assert.equal(child.signal,null,'mode audit signal');assert.equal(child.status,0,'mode audit exit');
  receipts[mode]=JSON.parse(readFileSync(receipt,'utf8'));
 }
 return receipts; // Small digest/census receipts only, never captured reports.
}
export function assertFatalControlWitness(control,witness){
 const causes={'bad-page-sha':'direct-page-sha256','callback-throw':'direct-page-callback','callback-reentry':'direct-page-callback','shared-page-buffer':'direct-page-callback','detached-page-buffer':'direct-page-callback'};
 assert.ok(Object.hasOwn(causes,control),'unknown fatal control');
 assert.equal(witness.error,null,'fatal control timeout/spawn is not native rejection');
 assert.equal(witness.signal,'SIGABRT','native fatal control must abort its child');
 assert.match(witness.stderr,new RegExp(`(?:^|\\n)BWSD1\\tFAIL\\t${causes[control]}(?:\\n|$)`),'exact source-owned native fatal cause');
}
export async function collectDirectControls({addon,sha256,configuration,directory,reference=null}){
 const {mkdirSync,writeFileSync,readFileSync}=await import('node:fs');const {join,resolve}=await import('node:path');const {fileURLToPath}=await import('node:url');const {spawnSync}=await import('node:child_process');
 mkdirSync(directory,{recursive:false});writeFileSync(join(directory,'source.bochsrc'),configuration,{flag:'wx'});const entry=fileURLToPath(new URL('./probe-i80386-native-direct-board-adapter.mjs',import.meta.url)),results={};
 for(const control of ['bad-page-sha','callback-throw','callback-reentry','shared-page-buffer','detached-page-buffer','second-create','detaching-page-metadata','detaching-memory-metadata']){
  const stem=join(resolve(directory),control),input=stem+'.input.json',config=ownedChildConfiguration(configuration,stem);writeFileSync(config.path,config.text,{flag:'wx'});writeFileSync(input,JSON.stringify({addon,sha256,configuration:config.path,configurationArtifact:config,control,capture:false,quanta:300,output:stem+'.json'}));
  const child=spawnSync(process.execPath,[entry,input],{encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});const witness={status:child.status,signal:child.signal,error:child.error?.message??null,stderr:child.stderr??'',stdout:child.stdout??''};writeFileSync(stem+'.witness.json',JSON.stringify(witness));
  if(['second-create','detaching-page-metadata','detaching-memory-metadata'].includes(control)){assert.equal(witness.error,null);assert.equal(witness.signal,null);assert.equal(witness.status,0);if(control!=='second-create'){assert.ok(reference,'adversarial successful controls require actual baseline reference');const expected=JSON.parse(readFileSync(reference,'utf8')),actual=JSON.parse(readFileSync(stem+'.json','utf8'));for(const field of ['reset','final','settled','ramSha256','backingSlices','callbackCounts','resumes','closed'])assert.deepEqual(actual[field],expected[field],`detachment control actual ${field}`);}}else assertFatalControlWitness(control,witness);
  results[control]=witness;
 }
 return results;
}
// Field offsets copied from the frozen qualified gate's combinedOrdinalIndex.
// They remove journal bookkeeping only; all remaining semantic fields stay exact.
const ordinalIndex=Object.freeze({CMD:5,ATTEMPT:4,PREFETCH:3,RPC_REQ:8,RPC_REP:4,RPC_MEM:9,RPC_PAGE:8,RPC_PIO:6,COMMIT:8,ALIAS_UPDATE:9,STAMP:6,PREFETCH_INVALIDATE:7,TLB_INVALIDATE:4,TLB_OBSERVED:7,MAP_COMMIT:6,COHERENCE:6,BOUNDARY:5,FAULT_BEGIN:7,FAULT_DELIVERED:8,IRQ_ACK:5,IRQ_DELIVERED:6,IRQ_LINE:3,QUANTUM:9,NATIVE_TICK:4,MEM:7,EXEC:4,PORT:5,HALT_IDLE:6,POST_STATE:22,POST_EXTRA:22,POST_SEG:17,POST_SYS:17,POST_DR:8});
export function nativeSemanticRows(raw,prefix){
 assert.ok(['BWSD1','BWS12'].includes(prefix));
 const result=[];
 for(const line of raw.split('\n')){
  if(!line.startsWith(prefix+'\t'))continue;
  const [,tag,...fields]=line.split('\t');
  if(['CMD','SLICE','FINAL','PROBE'].includes(tag)||tag.startsWith('RPC_'))continue;
  const index=ordinalIndex[tag];if(index!==undefined){assert.ok(fields.length>index,`missing ${tag} ordinal`);fields.splice(index,1);}
  result.push({tag,fields});
 }
 assert.ok(result.length,'native semantic trace missing');return result;
}
const stateNames=['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3','cs','ds','ss','gdtrBase','gdtrLimit','idtrBase','idtrLimit'];
const extraNames=['dr6','dr7','es','fs','gs','csIndex','csTi','csRpl','csValid','csPresent','csDpl','csSegment','csType','csBase','csLimit','csGranular','csDefault32','csAvailable','pendingEvent','eventMask'];
const segmentNames=['index','selector','selectorIndex','ti','rpl','valid','present','dpl','segment','type','base','limit','granular','default32','available'];
const values=(object,names)=>names.map(name=>object[name]);
const counterNames={callbacks:['physicalReads','physicalWrites','executePages','nativeTickCallbacks','quantumCallbacks'],fallback:['bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer'],execution:['attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts']};
export function assertDirectNativeBindings(direct,fifo){
 const native=fifo.native,reset=direct.reset,final=direct.final;
 assert.deepEqual(reset.state,values(native.resetState,stateNames),'full native create reset state');
 assert.deepEqual(reset.extra,values(native.resetExtra,extraNames),'full native create reset attributes');
 assert.deepEqual(reset.segments,native.resetSegments.flatMap(segment=>values(segment,segmentNames)),'all native reset segment caches');
 assert.deepEqual(reset.system,native.resetSystem.flatMap(segment=>values(segment,segmentNames)),'native reset LDTR/TR caches');
 assert.deepEqual(reset.debug,native.resetDebug,'all raw native reset debug registers');
 assert.equal(reset.nativeTicks,'0');assert.equal(reset.successfulQuanta,'0');
 for(const [group,names] of Object.entries(counterNames)){assert.deepEqual(reset[group],Object.fromEntries(names.map(name=>[name,'0'])),`exact native create zero ${group}`);assert.deepEqual(Object.keys(final[group]).sort(),[...names].sort(),`exact terminal ${group} fields`);}
 assert.deepEqual(native.ready,{cs:reset.state[13],eip:reset.state[8],nativeTicks:0,successfulQuanta:0},'FIFO READY bound to complete direct create reset');
 assert.deepEqual(final.state,values(native.finalState,stateNames),'full native final state');
 const posts=tag=>native.events.filter(event=>event.tag===tag);
 assert.deepEqual(final.extra,values(posts('POST_EXTRA').at(-1).extra,extraNames),'all terminal raw CPU attributes');
 assert.deepEqual(final.segments,posts('POST_SEG').slice(-6).flatMap(event=>values(event.segment,segmentNames)),'all terminal raw segment caches');
 assert.deepEqual(final.system,posts('POST_SYS').slice(-2).flatMap(event=>values(event.segment,segmentNames)),'terminal raw LDTR/TR caches');
 assert.deepEqual(final.debug,posts('POST_DR').at(-1).debug,'all terminal raw debug registers');
 const asStrings=object=>Object.fromEntries(Object.entries(object).map(([key,value])=>[key,String(value)]));
 assert.deepEqual(final.callbacks,asStrings(native.callbacks),'actual native callback summary including cached execute pointers');
 assert.deepEqual(final.fallback,asStrings(native.fallback),'every actual native fallback counter');
 const execution=Object.fromEntries(counterNames.execution.map(key=>[key,String(native.finalCounters[key])]));
 assert.deepEqual(final.execution,execution,'actual native terminal execution counters');
 assert.equal(final.nativeTicks,String(native.finalCounters.nativeTicks));assert.equal(final.successfulQuanta,String(native.finalCounters.successfulQuanta));
 assert.deepEqual(direct.closed,{native:true,board:true},'successful native and facade close witness');
}
export function assertNativeTraceParity(directRaw,fifoRaw,{direct,fifo}){
 assertDirectCallbackParity(direct,fifo);assertDirectNativeBindings(direct,fifo);
 const old=nativeSemanticRows(fifoRaw,'BWS12'),current=nativeSemanticRows(directRaw,'BWSD1');
 assert.deepEqual(old.filter(row=>row.tag==='READY'),[{tag:'READY',fields:[direct.reset.state[13].toString(16).padStart(4,'0'),direct.reset.state[8].toString(16).padStart(8,'0'),'0','0']}],'exact FIFO READY transport record');
 assert.deepEqual(old.filter(row=>row.tag==='DEACTIVATE'),[{tag:'DEACTIVATE',fields:['proof-complete']}],'qualified FIFO close witness');
 assert.deepEqual(current.filter(row=>row.tag==='DEACTIVATE'),[{tag:'DEACTIVATE',fields:['direct-close']}],'actual direct native close witness');
 const cleanOld=old.filter(row=>!['PAGE_CHUNK','READY','DEACTIVATE'].includes(row.tag));
 const cleanCurrent=current.filter(row=>row.tag!=='DEACTIVATE');
 // CALLBACKS/FALLBACK and full terminal STATE remain exact raw semantic rows.
 assert.deepEqual(cleanCurrent,cleanOld,'all raw native CPU/cache/bus/fault/IRQ fields and ordering by identical mode');
}
export function summarizeFreshProcessSamples(samples){
 assert.ok(samples.length>=3,'at least three measured samples');
 const sorted=samples.map(sample=>sample.executionNs).sort((a,b)=>a-b);
 assert.ok(sorted.every(n=>Number.isSafeInteger(n)&&n>0),'positive canonical execution durations');
 const middle=Math.floor(sorted.length/2),median=sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2;
 return {unit:'nanoseconds',samples:sorted.length,min:sorted[0],median,max:sorted.at(-1),sorted};
}
/** Source-stage measurement harness; requires an actual paired capture-off reference. */
export async function collectDirectMeasurements({addon,sha256,configuration,directory,reference,warmups=2,samples=7}){
 const {mkdirSync,writeFileSync,readFileSync,openSync,closeSync}=await import('node:fs');const {join,resolve}=await import('node:path');const {fileURLToPath}=await import('node:url');const {spawnSync}=await import('node:child_process');
 assert.ok(Number.isInteger(warmups)&&warmups>=0&&warmups<=5);assert.ok(Number.isInteger(samples)&&samples>=3&&samples<=21);
 const expected=JSON.parse(readFileSync(reference,'utf8'));assert.equal(expected.capture,false);assert.equal(expected.measurement,false);
 mkdirSync(directory,{recursive:false});writeFileSync(join(directory,'source.bochsrc'),configuration,{flag:'wx'});const entry=fileURLToPath(new URL('./probe-i80386-native-direct-board-adapter.mjs',import.meta.url)),results=[];
 for(let i=0;i<warmups+samples;i++){
  const stem=join(resolve(directory),`sample-${i}`),input=stem+'.input.json',output=stem+'.json',config=ownedChildConfiguration(configuration,stem);writeFileSync(config.path,config.text,{flag:'wx'});writeFileSync(input,JSON.stringify({addon,sha256,configuration:config.path,configurationArtifact:config,control:'run',capture:false,measurement:true,quanta:expected.quanta,output}));
  const stdout=openSync(stem+'.stdout','wx'),stderr=openSync(stem+'.stderr','wx'),start=process.hrtime.bigint();let child;
  try{child=spawnSync(process.execPath,['--max-old-space-size=1024',entry,input],{timeout:120000,stdio:['ignore',stdout,stderr]});}finally{closeSync(stdout);closeSync(stderr);}
  const wallNs=Number(process.hrtime.bigint()-start);writeFileSync(stem+'.exit.json',JSON.stringify({status:child.status,signal:child.signal,error:child.error?.message??null,wallNs}));assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,0);
  const actual=JSON.parse(readFileSync(output,'utf8'));for(const field of ['reset','final','settled','ramSha256','backingSlices','callbackCounts','resumes','closed','quanta'])assert.deepEqual(actual[field],expected[field],`measured sample retains paired actual ${field}`);
  const timing=JSON.parse(readFileSync(output+'.timing.json','utf8'));results.push({index:i,discardedWarmup:i<warmups,wallNs,...timing.stages,output});
 }
 const summary={status:'SHORT_GUEST_TIMING_ONLY',reference,warmups,samples:results,execution:summarizeFreshProcessSamples(results.filter(r=>!r.discardedWarmup)),scope:'fresh-process 194-native-tick free guest; execution includes resume snapshots and actual board callbacks; discarded warmups may warm OS caches only; no physical-386, representative-long-workload or speedup claim'};
 writeFileSync(join(directory,'summary.json'),JSON.stringify(summary,null,2));return summary;
}
/** Adversarial callback fixture: metadata lookup detaches the borrowed byte array. */
export function detachBytesOnDecodedLookup(result){
 const decoded=result.decoded,bytes=result.bytes;
 Object.defineProperty(result,'decoded',{enumerable:true,get(){
  if(bytes.buffer.byteLength)structuredClone(bytes.buffer,{transfer:[bytes.buffer]});
  return decoded;
 }});
 return result;
}
