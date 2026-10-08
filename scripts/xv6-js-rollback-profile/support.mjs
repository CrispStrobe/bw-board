/** Hosted-only short-lived allocation check for Node's collected-object flags. */
import assert from 'node:assert/strict';
import inspector from 'node:inspector';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const requested=Object.freeze({samplingInterval:131072,
 includeObjectsCollectedByMinorGC:true,includeObjectsCollectedByMajorGC:true});
export function sampleIncludesCollected(profile,deadCount){
 assert.ok(Number.isSafeInteger(deadCount)&&deadCount>0,'collected test objects');
 const ids=new Set();
 const stack=[profile?.head];
 while(stack.length){
  const node=stack.pop();
  if(!node||typeof node!=='object')continue;
  if(node.callFrame?.functionName==='allocateShortLived')ids.add(node.id);
  if(Array.isArray(node.children))stack.push(...node.children);
 }
 return Array.isArray(profile?.samples)&&profile.samples.some(sample=>
  ids.has(sample.nodeId)&&Number.isSafeInteger(sample.size)&&sample.size>0);
}
async function main(){
 assert.equal(process.argv.length,3,'one absolute receipt path');
 const output=process.argv[2];
 assert.equal(resolve(output),output,'absolute receipt path');
 assert.equal(typeof global.gc,'function','--expose-gc required');
 const session=new inspector.Session();session.connect();
 const command=(method,params={})=>new Promise((accept,reject)=>
  session.post(method,params,(error,result)=>error?reject(error):accept(result)));
 let started=false,profile=null,firstError=null;
 const weak=[];
 try{
  await command('HeapProfiler.enable');
  await command('HeapProfiler.startSampling',requested);started=true;
  function allocateShortLived(){
   for(let index=0;index<1024;index++)weak.push(new WeakRef(new Array(8192).fill(index)));
  }
  allocateShortLived();
  for(let round=0;round<8;round++){
   await new Promise(accept=>setImmediate(accept));
   global.gc();
  }
  const dead=weak.filter(ref=>ref.deref()===undefined).length;
  assert.ok(dead===weak.length&&dead>0,'short-lived objects collected');
  ({profile}=await command('HeapProfiler.stopSampling'));started=false;
  assert.ok(sampleIncludesCollected(profile,dead),'collected-object samples absent');
  const receipt={schema:'bw.xv6-js-rollback-gc-support.v1',requested,
   node:process.version,v8:process.versions.v8,
   allocatedObjects:weak.length,collectedObjects:dead,
   collectedCallsiteSamplePresent:true};
  writeFileSync(output,JSON.stringify(receipt)+'\n',{flag:'wx'});
 }catch(error){
  firstError=error;
  try{writeFileSync(output+'.failure.json',JSON.stringify({
   type:error?.name??'Error',message:String(error).slice(0,4096)})+'\n',{flag:'wx'});}catch{}
  throw error;
 }
 finally{
  if(started)try{await command('HeapProfiler.stopSampling');}catch(error){if(!firstError)throw error;}
  try{session.disconnect();}catch(error){if(!firstError)throw error;}
 }
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url)))
 await main();
