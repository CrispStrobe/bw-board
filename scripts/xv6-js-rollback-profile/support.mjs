/** Hosted-only, separate minor/major collected-object sampling admission. */
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import inspector from 'node:inspector';
import {writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {constants,PerformanceObserver,performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';

const interval=131072;
const minorCohorts=2;
const minorTargetsPerCohort=64;
const minorPumpBlocks=8;
const minorPumpArraysPerBlock=128;
const antiInliningFlag='--no-turbo-inlining';
export function admittedRuntime(node,execArgv,v8Options){
 assert.equal(node,'v20.20.2','pinned hosted Node');
 assert.ok(Array.isArray(execArgv)&&execArgv.includes(antiInliningFlag),
  'support-only anti-inlining flag absent');
 assert.match(v8Options,/^\s+--turbo-inlining\s/m,
  'pinned V8 does not expose the anti-inlining flag');
 return {node,antiInliningFlag,execArgv:[...execArgv],
  v8FlagAvailable:true};
}
export function sampleIncludesCollected(profile,deadCount){
 assert.ok(Number.isSafeInteger(deadCount)&&deadCount>0,'collected test objects');
 const ids=new Set();
 const stack=[[profile?.head,false]];
 while(stack.length){
  const [node,parentFactory]=stack.pop();
  if(!node||typeof node!=='object')continue;
  const inFactory=parentFactory||node.callFrame?.functionName==='allocateShortLived';
  if(inFactory)ids.add(node.id);
  if(Array.isArray(node.children))
   for(const child of node.children)stack.push([child,inFactory]);
 }
 return Array.isArray(profile?.samples)&&profile.samples.some(sample=>
  ids.has(sample.nodeId)&&Number.isSafeInteger(sample.size)&&sample.size>0);
}
function remember(object,weak){weak.push(new WeakRef(object));}
function allocateShortLived(){return new Array(1024);}
function allocateMinorBatch(weak){
 for(let index=0;index<minorTargetsPerCohort;index++)
  remember(allocateShortLived(),weak);
}
function allocateHeld(weak,strong){
 for(let index=0;index<8192;index++){
  const target=allocateShortLived();
  remember(target,weak);
  strong.push(target);
 }
}
function pumpMinor(){
 let last=null;
 for(let index=0;index<minorPumpArraysPerBlock;index++)last=new Array(1024);
 if(last?.length!==1024)throw Error('minor allocation pump');
}
const tick=()=>new Promise(accept=>setImmediate(accept));
export function minorStageAdmitted(stages,events,begin,end){
 assert.ok(Array.isArray(stages)&&stages.length===minorCohorts,
  'exact bounded minor cohorts');
 assert.ok(Array.isArray(events)&&events.every(event=>
  Number.isFinite(event.at)&&begin<=event.at&&event.at<=end&&
  Number.isSafeInteger(event.kind)),'bounded GC timeline');
 assert.ok(!events.some(event=>event.kind===constants.NODE_PERFORMANCE_GC_MAJOR),
  'minor case included major GC');
 for(let index=0;index<minorCohorts;index++){
  const stage=stages[index];
  assert.equal(stage.cohort,index,'ordered minor cohort');
  assert.equal(stage.targets,minorTargetsPerCohort,'fixed target cohort');
  assert.ok(Number.isSafeInteger(stage.pumpBlocks)&&
   stage.pumpBlocks>=1&&stage.pumpBlocks<=minorPumpBlocks,
   'bounded minor pressure');
  assert.ok(Number.isFinite(stage.releaseAt)&&
   begin<=stage.releaseAt&&stage.releaseAt<=end,
   'cross-job target release');
  assert.ok(Number.isFinite(stage.firstMinorAt)&&
   stage.releaseAt<=stage.firstMinorAt&&stage.firstMinorAt<=end&&
   events.some(event=>event.kind===constants.NODE_PERFORMANCE_GC_MINOR&&
    event.at===stage.firstMinorAt),'minor after target release');
  assert.equal(stage.deadAfterMinor,minorTargetsPerCohort,
   'every cohort target died in a minor-only window');
 }
 return true;
}
async function sampleCase(name,flags,kind,outputRoot){
 global.gc(); // Clear preexisting nursery pressure before measuring this case.
 const session=new inspector.Session();session.connect();
 const command=(method,params={})=>new Promise((accept,reject)=>
  session.post(method,params,(error,result)=>error?reject(error):accept(result)));
 const events=[];
 const observer=new PerformanceObserver(list=>{
  for(const entry of list.getEntries())
   if(entry.entryType==='gc')events.push({at:entry.startTime,kind:entry.detail?.kind});
 });
 observer.observe({entryTypes:['gc']});
 let started=false,firstError=null;
 try{
  await command('HeapProfiler.enable');
  await command('HeapProfiler.startSampling',{samplingInterval:interval,...flags});
  started=true;
  const begin=performance.now();
  const weak=[];
  let releaseAt=null;
  const minorStages=[];
  if(kind==='minor'){
   for(let batch=0;batch<minorCohorts;batch++){
    const first=weak.length;
    allocateMinorBatch(weak);
    await tick(); // WeakRef creation keeps targets alive until this job ends.
    const released=performance.now();
    let firstMinorAt=null,deadAfterMinor=0,pumps=0;
    for(let block=0;block<minorPumpBlocks;block++){
     pumpMinor();pumps++;
     await tick();
     const seen=events.find(event=>event.kind===constants.NODE_PERFORMANCE_GC_MINOR&&
      event.at>=released);
     if(seen){
      firstMinorAt??=seen.at;
      deadAfterMinor=weak.slice(first).filter(ref=>ref.deref()===undefined).length;
      if(deadAfterMinor===minorTargetsPerCohort)break;
     }
     if(events.some(event=>event.kind===constants.NODE_PERFORMANCE_GC_MAJOR&&
      event.at>=released))break;
     await tick(); // End any WeakRef deref keepalive before the next pressure block.
    }
    minorStages.push({cohort:batch,targets:minorTargetsPerCohort,
     pumpBlocks:pumps,releaseAt:released,firstMinorAt,deadAfterMinor});
    if(deadAfterMinor!==minorTargetsPerCohort||
       events.some(event=>event.kind===constants.NODE_PERFORMANCE_GC_MAJOR&&
        event.at>=begin))break;
   }
  }else{
   const strong=[];
   allocateHeld(weak,strong);
   await tick();
   releaseAt=performance.now();
   strong.length=0;
   global.gc();
  }
  for(let i=0;i<4;i++)await tick();
  const end=performance.now();
  const dead=weak.filter(ref=>ref.deref()===undefined).length;
  const {profile}=await command('HeapProfiler.stopSampling');started=false;
  const raw=Buffer.from(JSON.stringify(profile));
  assert.ok(raw.length>0&&raw.length<=8*1024*1024,'bounded raw GC control profile');
  const rawName='gc-'+name+'.heap.json';
  writeFileSync(resolve(outputRoot,rawName),raw,{flag:'wx'});
  await tick();
  const observed=events.filter(event=>begin<=event.at&&event.at<=end);
  const minor=observed.filter(event=>
   event.kind===constants.NODE_PERFORMANCE_GC_MINOR).length;
  const major=observed.filter(event=>
   event.kind===constants.NODE_PERFORMANCE_GC_MAJOR).length;
  const firstMajor=observed.filter(event=>
   event.kind===constants.NODE_PERFORMANCE_GC_MAJOR&&
   (releaseAt===null||event.at>=releaseAt))
   .sort((a,b)=>a.at-b.at)[0];
  const minorAfterReleaseBeforeMajor=releaseAt===null?null:
   observed.filter(event=>event.kind===constants.NODE_PERFORMANCE_GC_MINOR&&
    event.at>=releaseAt&&(!firstMajor||event.at<firstMajor.at)).length;
  const facts={name,requested:{samplingInterval:interval,...flags},
   allocatedObjects:weak.length,collectedObjects:dead,
   minorGcEvents:minor,majorGcEvents:major,
   minorAfterReleaseBeforeMajor,
   minorStages,
   collectedCallsiteSamplePresent:dead>0&&sampleIncludesCollected(profile,dead),
   begin,end,releaseAt,events:observed.slice(0,128),
   observedGcEventCount:observed.length,eventsTruncated:observed.length>128,
   rawProfileName:rawName,rawProfileBytes:raw.length,
   rawProfileSha256:createHash('sha256').update(raw).digest('hex')};
  const factBytes=Buffer.from(JSON.stringify(facts)+'\n');
  assert.ok(factBytes.length<=32768,'bounded GC fact receipt');
  writeFileSync(resolve(outputRoot,'gc-'+name+'.facts.json'),factBytes,{flag:'wx'});
  assert.equal(dead,weak.length,'every sampled-callsite array became unreachable');
  assert.ok(!facts.eventsTruncated,'bounded GC event timeline');
  if(kind==='minor'){
   minorStageAdmitted(minorStages,observed,begin,end);
   assert.ok(minor>0&&major===0,'isolated minor collection');
  }
  else assert.ok(firstMajor&&minorAfterReleaseBeforeMajor===0,
   'target release followed directly by major collection');
  return facts;
 }catch(error){firstError=error;throw error;}
 finally{
  observer.disconnect();
  if(started)try{await command('HeapProfiler.stopSampling');}catch(error){if(!firstError)throw error;}
  try{session.disconnect();}catch(error){if(!firstError)throw error;}
 }
}
export function supportsBothCases(cases){
 assert.ok(Array.isArray(cases)&&cases.length===4,'four independent GC cases');
 const byName=Object.fromEntries(cases.map(item=>[item.name,item]));
 assert.equal(Object.keys(byName).length,4,'unique GC cases');
 for(const name of ['minor-baseline','minor-enabled','major-baseline','major-enabled'])
  assert.ok(byName[name]&&byName[name].allocatedObjects>0&&
   byName[name].allocatedObjects===byName[name].collectedObjects,
   'all case objects collected');
 for(const name of ['minor-baseline','minor-enabled','major-baseline','major-enabled']){
  const item=byName[name];
  assert.ok(Number.isFinite(item.begin)&&Number.isFinite(item.end)&&
   item.begin<item.end&&Array.isArray(item.events)&&item.events.length<=128&&
   item.eventsTruncated===false&&item.observedGcEventCount===item.events.length,
   'bounded GC event window');
  assert.ok(item.events.every(event=>Number.isFinite(event.at)&&
   item.begin<=event.at&&event.at<=item.end&&Number.isSafeInteger(event.kind)),
   'bounded GC event facts');
  const minor=item.events.filter(event=>
   event.kind===constants.NODE_PERFORMANCE_GC_MINOR).length;
  const major=item.events.filter(event=>
   event.kind===constants.NODE_PERFORMANCE_GC_MAJOR).length;
  assert.equal(item.minorGcEvents,minor);
  assert.equal(item.majorGcEvents,major);
  const expectedName='gc-'+name+'.heap.json';
  assert.equal(item.rawProfileName,expectedName);
  assert.ok(Number.isSafeInteger(item.rawProfileBytes)&&
   item.rawProfileBytes>0&&item.rawProfileBytes<=8*1024*1024&&
   /^[0-9a-f]{64}$/.test(item.rawProfileSha256),'bounded raw GC profile');
  if(name.startsWith('minor')){
   assert.equal(item.releaseAt,null);
   assert.equal(item.minorAfterReleaseBeforeMajor,null);
   minorStageAdmitted(item.minorStages,item.events,item.begin,item.end);
  }else{
   assert.ok(Number.isFinite(item.releaseAt)&&
    item.begin<=item.releaseAt&&item.releaseAt<=item.end,
    'bounded target release');
   const firstMajor=item.events.filter(event=>
    event.kind===constants.NODE_PERFORMANCE_GC_MAJOR&&event.at>=item.releaseAt)
    .sort((a,b)=>a.at-b.at)[0];
   assert.ok(firstMajor,'major after target release');
   const intervening=item.events.filter(event=>
    event.kind===constants.NODE_PERFORMANCE_GC_MINOR&&
    item.releaseAt<=event.at&&event.at<firstMajor.at).length;
   assert.equal(item.minorAfterReleaseBeforeMajor,intervening);
  }
 }
 assert.deepEqual(byName['minor-baseline'].requested,{samplingInterval:interval});
 assert.deepEqual(byName['minor-enabled'].requested,
  {samplingInterval:interval,includeObjectsCollectedByMinorGC:true});
 assert.deepEqual(byName['major-baseline'].requested,{samplingInterval:interval});
 assert.deepEqual(byName['major-enabled'].requested,
  {samplingInterval:interval,includeObjectsCollectedByMajorGC:true});
 assert.equal(byName['minor-baseline'].collectedCallsiteSamplePresent,false);
 assert.equal(byName['major-baseline'].collectedCallsiteSamplePresent,false);
 assert.equal(byName['minor-enabled'].collectedCallsiteSamplePresent,true);
 assert.equal(byName['major-enabled'].collectedCallsiteSamplePresent,true);
 assert.ok(byName['minor-enabled'].minorGcEvents>0&&
  byName['minor-enabled'].majorGcEvents===0,'minor-only GC evidence');
 assert.ok(byName['major-baseline'].majorGcEvents>0&&
  byName['major-baseline'].minorAfterReleaseBeforeMajor===0&&
  byName['major-enabled'].majorGcEvents>0&&
  byName['major-enabled'].minorAfterReleaseBeforeMajor===0,'major GC evidence');
 return true;
}
async function main(){
 assert.equal(process.argv.length,3,'one absolute receipt path');
 const output=process.argv[2];
 assert.equal(resolve(output),output,'absolute receipt path');
 let firstError=null;
 try{
  assert.equal(typeof global.gc,'function','--expose-gc required');
  const options=spawnSync(process.execPath,['--v8-options'],
   {encoding:'utf8',timeout:3000,maxBuffer:2*1024*1024});
  assert.equal(options.status,0,'bounded pinned V8 option probe');
  const runtime=admittedRuntime(process.version,process.execArgv,options.stdout);
  const cases=[
   await sampleCase('minor-baseline',{},'minor',dirname(output)),
   await sampleCase('minor-enabled',{includeObjectsCollectedByMinorGC:true},'minor',dirname(output)),
   await sampleCase('major-baseline',{},'major',dirname(output)),
   await sampleCase('major-enabled',{includeObjectsCollectedByMajorGC:true},'major',dirname(output))];
  supportsBothCases(cases);
  const receipt=Buffer.from(JSON.stringify({
   schema:'bw.xv6-js-rollback-gc-support.v2',
   requestedProduction:{samplingInterval:interval,
    includeObjectsCollectedByMinorGC:true,includeObjectsCollectedByMajorGC:true},
   node:process.version,v8:process.versions.v8,cases,
   runtime,
   bothFlagsIndependentlyObserved:true})+'\n');
  assert.ok(receipt.length<=65536,'bounded GC support receipt');
  writeFileSync(output,receipt,{flag:'wx'});
 }catch(error){
  firstError=error;
  try{writeFileSync(output+'.failure.json',JSON.stringify({
   type:error?.name??'Error',message:String(error).slice(0,4096)})+'\n',{flag:'wx'});}catch{}
  throw error;
 }
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url)))
 await main();
