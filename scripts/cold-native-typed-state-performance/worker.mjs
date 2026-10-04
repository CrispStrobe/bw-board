/** Native-only performance arm source preparation. Closed CLI; no automatic run. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,realpathSync,lstatSync} from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {isMainThread} from 'node:worker_threads';
import {authenticateCompiledCheckout,compiledRevision,resetSource} from './admission.mjs';
import {stateExportProfile,validateAddonProfile,retainSnapshot,validateRetainedSnapshot,serializeEvidence} from './snapshot.mjs';
import {ordinaryBytes,sha,sourceRoot,nativeWorkerSourceIdentity,authenticatePrerequisite,authorizedTarget} from './admission.mjs';
import {modes,nextBudget,validateReturn,compareReset,compareFinalEvidence,noArtificialNativeDeadline} from './protocol.mjs';
const serialize=serializeEvidence;
export function validateWorkerInput(input){
 const keys=['compiledRoot','compiledRevision','addon','sha256','configuration','preparedManifest','preparedManifestSha256','buildReceipt','buildReceiptSha256','capture','independentAudit','output','workerRevision','workerSourceSha256','nodeSha256','mode'];assert.deepEqual(Object.keys(input).sort(),keys.sort());assert.equal(input.compiledRevision,compiledRevision);assert.ok(modes.includes(input.mode));assert.match(input.workerRevision,/^[a-f0-9]{40}$/);
 for(const k of keys.filter(k=>!['compiledRevision','workerRevision','mode'].includes(k))){if(k.endsWith('Sha256')||k==='sha256')assert.match(input[k],/^[a-f0-9]{64}$/);else assert.ok(typeof input[k]==='string'&&isAbsolute(input[k])&&resolve(input[k])===input[k]&&input[k].length<=4096&&!/[\0\r\n]/.test(input[k]));}
 const files=['addon','configuration','preparedManifest','buildReceipt','capture','independentAudit'];assert.equal(new Set(files.map(k=>input[k])).size,files.length,'separate input roles');for(const p of [input.compiledRoot,sourceRoot])assert.ok(input.output!==p&&!input.output.startsWith(p+'/'),'output outside source trees');for(const k of files)assert.ok(input[k]!==input.output&&!input[k].startsWith(input.output+'/'));return input;
}
async function run(input,inputPath){
 validateWorkerInput(input);assert.ok(isMainThread);assert.equal(realpathSync(process.argv[1]),realpathSync(fileURLToPath(import.meta.url)));assert.equal(process.version,'v22.23.3');assert.deepEqual(process.execArgv,['--max-old-space-size=128']);const hooks=['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE'];for(const k of hooks)assert.ok(!process.env[k]);assert.equal(realpathSync(resolve(input.output,'..')),resolve(input.output,'..'));assert.ok(lstatSync(resolve(input.output,'..')).isDirectory());mkdirSync(input.output,{recursive:false});
 const receipt={schema:'bw.cold-native-typed-state-performance.worker.v1',requiredStateExportProfile:stateExportProfile,status:'FAIL',input,scope:'SOURCE_ONLY_NATIVE_ARM_UNQUALIFIED; no speed/adoption/general AT/Windows/Doom claim',clockModel:'Configured functional six board clocks per Q; no physical RTx calibration',resetSource,coverage:'Mandatory full166 API materialization on every return remains timed; reset/final/first-failure166 retained, discarded intermediates not independently reconstructible',returns:{resumes:0,irqSnapshots:0,zeroQ:0,reasons:{1:0,3:0,7:0},maxChargedN:0,maxChargedQ:0}};
 const write=name=>{const bytes=serialize(receipt)+'\n';assert.ok(Buffer.byteLength(bytes)<=8<<20);writeFileSync(resolve(input.output,name),bytes,{flag:'wx'});};
 let identity=null,compiled=null,prerequisite=null,provider=null,api=null,native=null,closed=false,progress={n:0,q:0},lastZero=null,resetRetained=null;
 function afterChecks(){
  receipt.workerAfter=nativeWorkerSourceIdentity();assert.deepEqual(receipt.workerAfter,receipt.workerBefore);receipt.nodeSha256After=sha(ordinaryBytes(receipt.node,128<<20));assert.equal(receipt.nodeSha256After,receipt.nodeSha256Before);receipt.inputSha256After=sha(ordinaryBytes(inputPath,16384));assert.equal(receipt.inputSha256After,receipt.inputSha256Before);
  if(identity){receipt.compiledAfter=identity.sourceIdentity();assert.deepEqual(receipt.compiledAfter,compiled);receipt.buildAfter=identity.authenticateBuild(input,compiled);assert.deepEqual(receipt.buildAfter,receipt.buildBefore);assert.deepEqual(identity.authenticateConfiguration(input.configuration),receipt.configuration);}
  const p=authenticatePrerequisite(input);assert.deepEqual([p.bindingSha256,p.captureSha256,p.independentAuditSha256],[prerequisite.bindingSha256,prerequisite.captureSha256,prerequisite.independentAuditSha256]);
 }
 try{
  receipt.inputSha256Before=sha(ordinaryBytes(inputPath,16384));receipt.workerBefore=nativeWorkerSourceIdentity();assert.equal(receipt.workerBefore.revision,input.workerRevision);assert.equal(sha(Buffer.from(JSON.stringify(receipt.workerBefore))),input.workerSourceSha256);receipt.node=realpathSync(process.execPath);receipt.nodeSha256Before=sha(ordinaryBytes(receipt.node,128<<20));assert.equal(receipt.nodeSha256Before,input.nodeSha256);
  // The source-owned PENDING binding fails before compiled module imports,
  // factory construction and addon require. No caller-supplied binding exists.
  prerequisite=authenticatePrerequisite(input);const targetQ=authorizedTarget(prerequisite.token);receipt.prerequisite={binding:prerequisite.binding,bindingSha256:prerequisite.bindingSha256,captureSha256:prerequisite.captureSha256,independentAuditSha256:prerequisite.independentAuditSha256};
  const manifestBytes=ordinaryBytes(input.preparedManifest,1<<20);assert.equal(sha(manifestBytes),input.preparedManifestSha256);const manifest=JSON.parse(manifestBytes);assert.equal(Object.keys(manifest.sourceHashes).length,134,'complete fixed compiled source inventory');receipt.compiledBefore=authenticateCompiledCheckout(input.compiledRoot,manifest);
  const base=resolve(input.compiledRoot,'scripts/bochs-cpu3-native-cold-bios');identity=await import(pathToFileURL(resolve(input.compiledRoot,'scripts/bochs-cpu3-native-cold-bios-typed-state/identity.mjs')).href);compiled=identity.sourceIdentity();assert.deepEqual(compiled,receipt.compiledBefore);receipt.buildBefore=identity.authenticateBuild(input,compiled);receipt.configuration=identity.authenticateConfiguration(input.configuration);assert.equal(sha(ordinaryBytes(resolve(manifest.preparedTree,resetSource.path))),resetSource.sha256);assert.equal(sha(ordinaryBytes(input.addon)),input.sha256);
  const providers=await import(pathToFileURL(resolve(base,'board-provider.mjs')).href);provider=providers.createOwnedColdBiosProvider();api=createRequire(import.meta.url)(input.addon);validateAddonProfile(api);receipt.admittedStateExportProfile=api.stateExportProfile;native=api.create(input.configuration,provider.rom,provider.callbacks,false);resetRetained=retainSnapshot(native);receipt.reset={native,board:provider.checkpoint()};compareReset(native,receipt.reset.board,prerequisite.capture);
  const startCpu=process.cpuUsage(),startWall=process.hrtime.bigint();
  try{
   while(progress.q<targetQ){
    assert.ok(receipt.returns.resumes<800000&&receipt.returns.zeroQ<=400000,'closed lifecycle cap');const budget=nextBudget(input.mode,progress.q,targetQ);const stage=provider.stage();if(stage.changed){native=api.setIRQ(stage.asserted);receipt.returns.irqSnapshots++;}
    provider.begin();let error=null;try{native=api.resume(budget.maxN,budget.maxQ,noArtificialNativeDeadline);}catch(e){error=e;receipt.resumeError=String(e);throw e;}finally{try{provider.end();}catch(e){receipt.endError=String(e);if(!error)throw e;}}
    receipt.returns.resumes++;const next=validateReturn(progress,native,budget,targetQ);receipt.returns.reasons[native.reason]++;receipt.returns.maxChargedN=Math.max(receipt.returns.maxChargedN,next.dn);receipt.returns.maxChargedQ=Math.max(receipt.returns.maxChargedQ,next.dq);
    if(!next.dq)receipt.returns.zeroQ++;if(!next.dn&&!next.dq){const signature=[next.n,next.q,native.state[13],native.state[8],stage.asserted,stage.changed].join(':');assert.notEqual(signature,lastZero,'repeated zero-clock event with same architecture/line');lastZero=signature;}else lastZero=null;progress=next;
   }
  }finally{receipt.executionTiming={cpuMicroseconds:process.cpuUsage(startCpu),wallNanoseconds:(process.hrtime.bigint()-startWall).toString(),scope:'Native-only loop: actual stage/IRQ/begin/resume/end, owned PIO/device/deadline work, mandatory166 materialization, cheap budget/progress guards and counters; no JS oracle/hash/disk/snapshot copying'};receipt.progress=progress;receipt.lastReturnedNative=native;}
  // Evidence, settlement, comparisons, authentication and close are outside
  // execution timing. Whole provider tape is copied exactly once on success.
  const lastRetained=retainSnapshot(receipt.lastReturnedNative);native=api.inspect();validateRetainedSnapshot(resetRetained,native);validateRetainedSnapshot(lastRetained,native);receipt.typedSnapshotOwnership='RESET_STABLE_AND_FINAL_LAST_RETURN_DISTINCT';receipt.finalNative=native;receipt.finalBoard=provider.settleCheckpoint();receipt.ports=provider.records();receipt.comparison=compareFinalEvidence(native,receipt.finalBoard,receipt.ports,prerequisite.capture,receipt.lastReturnedNative);
  api.close();provider.close();closed=true;receipt.closed={native:true,provider:true};afterChecks();receipt.processCpuMicrosecondsAtReceipt=process.cpuUsage();receipt.processUptimeSecondsAtReceipt=process.uptime();receipt.wholeChildEvidence='Separate parent wait4/rusage CPU/wall, host context, lifecycle limits and raw exit required';receipt.status='NATIVE_ARM_EXECUTION_AND_FINAL_PARITY_PASS';write('receipt.json');
 }catch(error){
  receipt.error=String(error);if(native)receipt.lastSuccessfullyReturnedNative=native;
  if(provider&&!closed){for(const [name,read]of [['partialBoard',()=>provider.checkpoint()],['partialPorts',()=>provider.records()]])try{receipt[name]=read();}catch(e){receipt[name+'Unavailable']=String(e);}if(api)try{api.close();receipt.nativeClosedAfterFailure=true;}catch(e){receipt.nativeCloseError=String(e);}try{provider.close();receipt.providerClosedAfterFailure=true;}catch(e){receipt.providerCloseError=String(e);}}
  // No synthetic lease repair. Preserve each independently readable after map.
  for(const [name,read]of [['workerAfter',nativeWorkerSourceIdentity],['nodeSha256After',()=>sha(ordinaryBytes(receipt.node,128<<20))],['inputSha256After',()=>sha(ordinaryBytes(inputPath,16384))],['compiledAfter',()=>identity.sourceIdentity()],['buildAfter',()=>identity.authenticateBuild(input,compiled)],['prerequisiteAfter',()=>{const p=authenticatePrerequisite(input);return {bindingSha256:p.bindingSha256,captureSha256:p.captureSha256,independentAuditSha256:p.independentAuditSha256};}]])try{receipt[name]=read();}catch(e){receipt[name+'Unavailable']=String(e);}
  write('failure.json');throw error;
 }
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){assert.equal(process.argv.length,3);const path=process.argv[2];await run(JSON.parse(ordinaryBytes(path,16384)),path);}
