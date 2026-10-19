/** Fresh ABI5/companion child. Only the real stage/resume/end loop is timed. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {resolve,isAbsolute} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {loadDirectTimingProvider} from './direct-provider.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const json=x=>JSON.stringify(x,(_,v)=>typeof v==='bigint'?v.toString():ArrayBuffer.isView(v)?Array.from(v):v)+'\n';
const normalized=x=>JSON.parse(json(x));
const exactPath=p=>{assert.ok(typeof p==='string'&&isAbsolute(p)&&resolve(p)===p&&!/[\0\r\n]/.test(p));return p;};
const nativeKeys=['state','extra','segments','system','debug','nativeTicks','successfulQuanta',
 'mappingEpoch','boardA20','clockTransfers','callbacks','fallback','execution'];
function semanticNative(actual,want){
 for(const [key,length] of [['state',20],['extra',20],['segments',90],['system',30],['debug',6]])
  assert.equal(actual[key]?.length,length,'full native '+key);
 for(const key of nativeKeys)assert.deepEqual(normalized(actual[key]),want[key],'native '+key);
 assert.ok(Object.values(actual.fallback).every(v=>Number(v)===0),'no native fallback');
}
export async function runNative(input){
 assert.equal(input?.schema,'bw.cold-direct-ram.paired-native-input.v1');
 assert.ok(input.mode==='direct'||input.mode==='companion');
 for(const key of ['sourceRoot','addon','configuration','reference','output'])exactPath(input[key]);
 if(input.mode==='companion')exactPath(input.ownerAddon);
 else assert.equal(input.ownerAddon,null);
 if(input.mode==='direct'){exactPath(input.directBuildAuth);assert.equal(input.ownerBuildReceipt,null);}
 else{exactPath(input.ownerBuildReceipt);assert.equal(input.directBuildAuth,null);}
 assert.equal(input.qualifiedHead,'acdb5dcef438c0ac7bc3c7794d43af4371d6e0d1');
 assert.equal(execFileSync('git',['-C',input.sourceRoot,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),input.qualifiedHead);
 assert.equal(execFileSync('git',['-C',input.sourceRoot,'status','--porcelain'],{encoding:'utf8'}).trim(),'');
 assert.equal(sha(readFileSync(input.addon)),input.addonSha256,'exact addon binary');
 if(input.mode==='companion')assert.equal(sha(readFileSync(input.ownerAddon)),input.ownerAddonSha256,'exact companion owner');
 if(input.mode==='direct'){
  const bytes=readFileSync(input.directBuildAuth);assert.equal(sha(bytes),input.directBuildAuthSha256);
  const auth=JSON.parse(bytes);assert.equal(auth.schema,'bw.cold-native.direct-ram-static-build.v1');
  assert.equal(auth.sourceHead,input.qualifiedHead);assert.equal(auth.addonSha256,input.addonSha256);
  assert.equal(auth.addonLoaded,false);
 }else{
  const bytes=readFileSync(input.ownerBuildReceipt);assert.equal(sha(bytes),input.ownerBuildReceiptSha256);
  const auth=JSON.parse(bytes);assert.equal(auth.schema,'bw.cold-direct-ram.paired-owner-build.v1');
  assert.equal(auth.sourceHead,input.qualifiedHead);assert.equal(auth.addonSha256,input.ownerAddonSha256);
  assert.equal(auth.sourceSha256,sha(readFileSync(resolve(input.sourceRoot,
   'scripts/bochs-cpu3-native-cold-owned-ram/napi.cc'))));
  assert.equal(auth.ownerCoreSha256,sha(readFileSync(resolve(input.sourceRoot,
   'scripts/bochs-cpu3-native-cold-owned-ram/owned-ram.h'))));
 }
 assert.equal(sha(readFileSync(input.reference)),input.referenceSha256,'exact qualified reference');
 const reference=JSON.parse(readFileSync(input.reference,'utf8'));
 assert.equal(reference.schema,'bw.cold-direct-ram.paired-reference.v1');
 assert.equal(reference.sourceHead,input.qualifiedHead);
 const target=reference.target;assert.equal(target,316562);
 const configAuth=await import(pathToFileURL(resolve(input.sourceRoot,
  'scripts/bochs-cpu3-native-cold-memory-fusion/identity.mjs')).href);
 assert.equal(configAuth.authenticateConfiguration(input.configuration).sha256,input.configurationSha256,
  'exact cold config');
 mkdirSync(input.output);
 const require=createRequire(import.meta.url),addon=require(input.addon);
 assert.equal(addon.abiVersion,input.mode==='direct'?5:4);
 let provider,callbacks,owner=null,derivation=null;
 if(input.mode==='direct'){
  assert.equal(addon.directRamProfile,'bw.cpu3.cold.direct-ram-rom-exec.v1');
  const derived=await loadDirectTimingProvider(input.sourceRoot);derivation=derived.derivation;
  provider=derived.create(addon);callbacks=provider.callbacks;
 }else{
  assert.equal(addon.memoryFusionProfile,'bw.cold-native.memory-clock-fusion.v1');
  owner=require(input.ownerAddon);assert.equal(owner.profile,'bw.cold-native.owned-ram-rom-exec.v1');
  const [{createOwnedRamColdBiosProvider},{memoryFusionCallbacks}]=await Promise.all([
   import(pathToFileURL(resolve(input.sourceRoot,'scripts/bochs-cpu3-native-cold-owned-ram/provider.mjs')).href),
   import(pathToFileURL(resolve(input.sourceRoot,'scripts/bochs-cpu3-native-cold-memory-fusion-ledger-scalars/provider.mjs')).href)]);
  provider=createOwnedRamColdBiosProvider(owner);callbacks=memoryFusionCallbacks(provider).callbacks;
 }
 const receipt={schema:'bw.cold-direct-ram.paired-native-child.v1',mode:input.mode,
  qualifiedHead:input.qualifiedHead,addonSha256:input.addonSha256,
  ownerAddonSha256:input.ownerAddonSha256,configurationSha256:input.configurationSha256,
  directBuildAuthSha256:input.directBuildAuthSha256,
  ownerBuildReceiptSha256:input.ownerBuildReceiptSha256,
  referenceSha256:input.referenceSha256,providerDerivation:derivation,status:'FAIL'};
 let native=null,lastFull=null,resumes=0,zero=0,q=0,closed=false;
 try{
  native=addon.create(input.configuration,provider.rom,callbacks,false);
  receipt.reset={native,board:provider.checkpoint()};
  semanticNative(native,reference.reset.native);
  assert.deepEqual(receipt.reset.board,reference.reset.board,'reset full board');
  receipt.startupTiming={cpuMicroseconds:process.cpuUsage(),
    elapsedMilliseconds:Math.round(process.uptime()*1000),
    scope:'Child process start through addon/provider/configuration and reset verification'};
  const startCpu=process.cpuUsage(),startWall=process.hrtime.bigint();
  try{
   while(q<target){
    assert.ok(++resumes<=800000&&zero<=400000,'bounded native guest');
    const stage=provider.stage();if(stage.changed)native=addon.setIRQ(stage.asserted);
    provider.begin();let error=null;
    try{native=addon.resumeProgress(600,Math.min(300,target-q),0xffffffffffffffffn);}
    catch(caught){error=caught;throw caught;}
    finally{try{provider.end();}catch(caught){if(!error)throw caught;}}
    const next=Number(native.successfulQuanta);
    assert.ok(next>=q&&next<=target&&next<=q+300,'contiguous Q');
    if(next===q){zero++;lastFull=addon.inspect();}q=next;
   }
  }finally{receipt.executionTiming={cpuMicroseconds:process.cpuUsage(startCpu),
    wallNanoseconds:(process.hrtime.bigint()-startWall).toString(),
    scope:'Native stage/IRQ/begin/resumeProgress/end and real device work; full inspect only on actual zero-progress cuts; settlement, diagnostic journal and JSON excluded'};
   receipt.resumes=resumes;receipt.zero=zero;receipt.progressQ=q;}
  assert.equal(resumes,reference.resumes);assert.equal(zero,reference.zero);
  receipt.lastReturn=native;receipt.last=addon.inspect();receipt.final=addon.inspect();
  semanticNative(receipt.last,reference.last);semanticNative(receipt.final,reference.final);
  assert.deepEqual(normalized(receipt.lastReturn),reference.lastReturn,'compact last return');
  const settled=provider.settleCheckpoint();receipt.board=settled.state;
  receipt.ramSha256=settled.ramSha256;receipt.ports=provider.records();
  assert.deepEqual(receipt.board,reference.board,'full settled board');
  assert.equal(receipt.ramSha256,reference.ramSha256,'whole RAM');
  assert.deepEqual(receipt.ports,reference.ports,'complete ordered PIO');
  if(input.mode==='direct'){
   receipt.ownerBeforeClose=addon.directStatus();
   const s=receipt.ownerBeforeClose;
   assert.equal(s.ownerFailed,false);assert.equal(s.journalPending,0n);
   assert.equal(s.prepared,false);assert.equal(s.pageTicket,false);
   assert.equal(s.uncommittedRetry,false);assert.equal(s.committedCodeFence,false);
   assert.equal(s.committed,s.acknowledged);assert.equal(s.committed,91958n);
   assert.equal(s.directReads,91949n);assert.equal(s.directWrites,91958n);
   assert.deepEqual(normalized(receipt.final.bridgeMemoryEntryAttempts),
    {ordinaryRead:'0',ordinaryWrite:'0',fusedOuter:'0'});
   receipt.ownerProvider=provider.ownerStatus();
   assert.equal(receipt.ownerProvider.journalEntries,91958);
  }
  addon.close();
  if(input.mode==='direct')receipt.ownerAfterClose=addon.directStatus();
  provider.close();closed=true;
  if(input.mode==='direct'){
   assert.equal(receipt.ownerAfterClose.ownerClosed,true);
   assert.equal(receipt.ownerAfterClose.cpuClosed,true);
   assert.deepEqual(provider.closedStatus(),{providerClosed:true,boardClosed:true});
  }
  receipt.closed=true;receipt.status='SEMANTIC_PASS';
  writeFileSync(resolve(input.output,'receipt.json'),json(receipt),{flag:'wx'});
  return receipt;
 }catch(error){
  receipt.error=String(error);receipt.closed=closed;
  for(const [name,fn] of [['partialNative',()=>addon.inspect()],
   ['partialBoard',()=>provider.checkpoint()],['partialPorts',()=>provider.records()],
   ['partialOwner',()=>input.mode==='direct'?addon.directStatus():null]])
   try{receipt[name]=fn();}catch(caught){receipt[name+'Unavailable']=String(caught);}
  writeFileSync(resolve(input.output,'failure.json'),json(receipt),{flag:'wx'});throw error;
 }
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 assert.equal(process.argv.length,3);await runNative(JSON.parse(readFileSync(process.argv[2],'utf8')));
}
