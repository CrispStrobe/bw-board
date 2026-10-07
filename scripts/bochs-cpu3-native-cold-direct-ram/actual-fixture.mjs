/** Bounded actual CPU3 ABI5 fixture. Requires a separately authenticated addon. */
import assert from 'node:assert/strict';
import {writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve,isAbsolute} from 'node:path';
import {createDirectRamColdBiosProvider} from './provider.mjs';
import {authenticateConfiguration} from '../bochs-cpu3-native-cold-memory-fusion/identity.mjs';

const [addonPath,authPath,configPath,targetText,outputPath]=process.argv.slice(2);
assert.equal(process.argv.length,7);
for(const p of [addonPath,authPath,configPath,outputPath])assert.ok(isAbsolute(p)&&resolve(p)===p);
const target=Number(targetText);assert.ok(Number.isInteger(target)&&target>=1&&target<=400000);
const buildAuth=JSON.parse(readFileSync(authPath,'utf8'));
assert.equal(buildAuth.schema,'bw.cold-native.direct-ram-static-build.v1');
assert.equal(buildAuth.sourceHead,execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim());
assert.equal(buildAuth.addonSha256,createHash('sha256').update(readFileSync(addonPath)).digest('hex'));
const configAuth=authenticateConfiguration(configPath);
const addon=createRequire(import.meta.url)(addonPath);
assert.equal(addon.abiVersion,5);
assert.equal(addon.directRamProfile,'bw.cpu3.cold.direct-ram-rom-exec.v1');
const provider=createDirectRamColdBiosProvider(addon);
const initialRam=Buffer.from(provider.callbacks.directRam);
const initialRamSha256=createHash('sha256').update(initialRam).digest('hex');
const initialRamBase64=initialRam.toString('base64');
let native=addon.create(configPath,provider.rom,provider.callbacks,false);
const reset={native,board:provider.checkpoint()};
let q=0,resumes=0,zero=0;
try{
 while(q<target){
  assert.ok(++resumes<=800000&&zero<=400000,'bounded direct cold guest');
  const stage=provider.stage();if(stage.changed)native=addon.setIRQ(stage.asserted);
  provider.begin();let error=null;
  const maxQ=Math.min(300,target-q);
  try{native=addon.resumeProgress(600,maxQ,0xffffffffffffffffn);}catch(e){error=e;throw e;}
  finally{try{provider.end();}catch(e){if(!error)throw e;}}
  const next=Number(native.successfulQuanta);
  assert.ok(next>=q&&next<=q+maxQ,'contiguous bounded guest Q');
  if(next===q)zero++;q=next;
  if(resumes%1000===0)process.stdout.write(`progress resumes=${resumes} N=${native.nativeTicks} Q=${native.successfulQuanta}\n`);
 }
}catch(error){
 const failure={schema:'bw.cold-native.direct-ram-actual-fixture-failure.v1',mode:'direct',target,resumes,q,zero,error:String(error),lastReturnedNative:native};
 for(const [name,fn]of [['partialNative',()=>addon.inspect()],['partialBoard',()=>provider.checkpoint()],
  ['partialPorts',()=>provider.records()],['partialJournal',()=>provider.journal()],
  ['partialOwner',()=>addon.directStatus()]])try{failure[name]=fn();}catch(e){failure[name+'Error']=String(e);}
 writeFileSync(outputPath+'.failure.json',JSON.stringify(failure,(_,v)=>typeof v==='bigint'?v.toString():ArrayBuffer.isView(v)?Array.from(v):v)+'\n',{flag:'wx'});
 throw error;
}
const lastReturn=native,last=addon.inspect(),final=addon.inspect();
const settled=provider.settleCheckpoint(),ports=provider.records(),journal=provider.journal(),generationEntries=provider.generationEntries();
const ownerBeforeClose=addon.directStatus(),providerStatus=provider.ownerStatus();
assert.equal(ownerBeforeClose.journalPending,0n);assert.equal(ownerBeforeClose.prepared,false);
assert.equal(ownerBeforeClose.pageTicket,false);assert.equal(ownerBeforeClose.acknowledged,ownerBeforeClose.committed);
assert.equal(ownerBeforeClose.ownerFailed,false);
assert.equal(ownerBeforeClose.uncommittedRetry,false);assert.equal(ownerBeforeClose.committedCodeFence,false);
addon.close();const ownerAfterClose=addon.directStatus();provider.close();const closedStatus=provider.closedStatus();
assert.equal(ownerAfterClose.ownerClosed,true);assert.equal(ownerAfterClose.cpuClosed,true);
assert.equal(ownerAfterClose.uncommittedRetry,false);assert.equal(ownerAfterClose.committedCodeFence,false);
assert.equal(closedStatus.providerClosed,true);assert.equal(closedStatus.boardClosed,true);
const report={schema:'bw.cold-native.direct-ram-actual-fixture.v1',mode:'direct',target,resumes,zero,
 reset,lastReturn,last,final,board:settled.state,initialRamSha256,initialRamBase64,
 ramSha256:settled.ramSha256,ports,journal,generationEntries,
 admission:{sourceHead:buildAuth.sourceHead,addonSha256:buildAuth.addonSha256,
  buildAuthSha256:createHash('sha256').update(readFileSync(authPath)).digest('hex'),
  configSha256:configAuth.sha256,biosSha256:configAuth.biosSha256},
 direct:{beforeClose:ownerBeforeClose,afterClose:ownerAfterClose,provider:providerStatus,
  closure:closedStatus}};
writeFileSync(outputPath,JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():ArrayBuffer.isView(v)?Array.from(v):v)+'\n',{flag:'wx'});
