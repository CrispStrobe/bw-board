/** Hosted-only, separate minor/major collected-object sampling admission. */
import assert from 'node:assert/strict';
import inspector from 'node:inspector';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {constants,PerformanceObserver,performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';

const interval=131072;
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
function allocateHeld(weak,strong){
 for(let index=0;index<8192;index++){
  const target=allocateShortLived();
  remember(target,weak);
  strong.push(target);
 }
}
function pumpMinor(){
 let last=null;
 for(let index=0;index<2048;index++)last=new Array(1024);
 if(last?.length!==1024)throw Error('minor allocation pump');
}
const tick=()=>new Promise(accept=>setImmediate(accept));
async function sampleCase(name,flags,kind){
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
  if(kind==='minor'){
   for(let index=0;index<8192;index++)remember(allocateShortLived(),weak);
   pumpMinor();
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
  assert.equal(dead,weak.length,'every sampled-callsite array became unreachable');
  const {profile}=await command('HeapProfiler.stopSampling');started=false;
  await tick();
  const observed=events.filter(event=>begin<=event.at&&event.at<=end);
  const minor=observed.filter(event=>
   event.kind===constants.NODE_PERFORMANCE_GC_MINOR).length;
  const major=observed.filter(event=>
   event.kind===constants.NODE_PERFORMANCE_GC_MAJOR).length;
  const firstMajor=observed.find(event=>
   event.kind===constants.NODE_PERFORMANCE_GC_MAJOR&&
   (releaseAt===null||event.at>=releaseAt));
  const minorAfterReleaseBeforeMajor=releaseAt===null?null:
   observed.filter(event=>event.kind===constants.NODE_PERFORMANCE_GC_MINOR&&
    event.at>=releaseAt&&(!firstMajor||event.at<firstMajor.at)).length;
  if(kind==='minor')assert.ok(minor>0&&major===0,'isolated minor collection');
  else assert.ok(firstMajor&&minorAfterReleaseBeforeMajor===0,
   'target release followed directly by major collection');
  return {name,requested:{samplingInterval:interval,...flags},
   allocatedObjects:weak.length,collectedObjects:dead,
   minorGcEvents:minor,majorGcEvents:major,
   minorAfterReleaseBeforeMajor,
   collectedCallsiteSamplePresent:sampleIncludesCollected(profile,dead)};
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
 assert.equal(typeof global.gc,'function','--expose-gc required');
 let firstError=null;
 try{
  const cases=[
   await sampleCase('minor-baseline',{},'minor'),
   await sampleCase('minor-enabled',{includeObjectsCollectedByMinorGC:true},'minor'),
   await sampleCase('major-baseline',{},'major'),
   await sampleCase('major-enabled',{includeObjectsCollectedByMajorGC:true},'major')];
  supportsBothCases(cases);
  writeFileSync(output,JSON.stringify({
   schema:'bw.xv6-js-rollback-gc-support.v2',
   requestedProduction:{samplingInterval:interval,
    includeObjectsCollectedByMinorGC:true,includeObjectsCollectedByMajorGC:true},
   node:process.version,v8:process.versions.v8,cases,
   bothFlagsIndependentlyObserved:true})+'\n',{flag:'wx'});
 }catch(error){
  firstError=error;
  try{writeFileSync(output+'.failure.json',JSON.stringify({
   type:error?.name??'Error',message:String(error).slice(0,4096)})+'\n',{flag:'wx'});}catch{}
  throw error;
 }
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url)))
 await main();
