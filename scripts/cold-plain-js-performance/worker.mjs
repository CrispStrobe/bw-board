/** Closed JS arm only. No native load, paired gate or speed/adoption claim. */
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,realpathSync,lstatSync} from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isMainThread} from 'node:worker_threads';
import {ordinaryBytes,sha,plainSourceIdentity,authenticatePrerequisite,sourceRoot} from './admission.mjs';
import {createPlainJsBochsResetMachine,resetSource} from './factory.mjs';
const hooks=['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE'];
export function validateWorkerInput(input){
 assert.deepEqual(Object.keys(input).sort(),['capture','independentAudit','output','workerRevision','workerSourceSha256','nodeSha256'].sort());
 assert.match(input.workerRevision,/^[a-f0-9]{40}$/);for(const k of ['workerSourceSha256','nodeSha256'])assert.match(input[k],/^[a-f0-9]{64}$/);
 for(const k of ['capture','independentAudit','output']){assert.equal(typeof input[k],'string');assert.ok(isAbsolute(input[k])&&resolve(input[k])===input[k]&&input[k].length<=4096&&!/[\0\r\n]/.test(input[k]));}
 assert.equal(new Set([input.capture,input.independentAudit,input.output]).size,3,'disjoint file roles');assert.ok(input.output!==sourceRoot&&!input.output.startsWith(sourceRoot+'/'),'external output');for(const k of ['capture','independentAudit'])assert.ok(!input[k].startsWith(input.output+'/'),'input outside exclusive output');return input;
}
export function compareFinalEvidence(result,capture){
 const boundary=capture.cuts.at(-1);assert.equal(boundary.name,'before-F000-E16');assert.deepEqual(result.beforeSettle.cpu,boundary.javascript.cpu,'raw CPU before final chip catchup');
 assert.deepEqual(result.final,capture.javascriptFinal,'raw complete JS final CPU/board/RAM');assert.deepEqual(result.ports,capture.javascriptPorts,'complete ordered PIO/value/preQ clock ownership');
 return {status:'PLAIN_JS_FINAL_AND_COMPLETE_PIO_MATCH_PINNED_CAPTURE',q:result.final.q,ports:result.ports.length,coverage:'Final raw CPU/full board/whole raw RAM hash and complete PIO only; no per-instruction state parity'};
}
async function runWorker(input,inputPath){
 validateWorkerInput(input);assert.ok(isMainThread);assert.equal(realpathSync(process.argv[1]),realpathSync(fileURLToPath(import.meta.url)));assert.equal(process.version,'v22.23.3');assert.deepEqual(process.execArgv,['--max-old-space-size=128']);for(const k of hooks)assert.ok(!process.env[k],'blank '+k);
 assert.equal(realpathSync(resolve(input.output,'..')),resolve(input.output,'..'));assert.ok(lstatSync(resolve(input.output,'..')).isDirectory());mkdirSync(input.output,{recursive:false});
 const receipt={schema:'bw.cold-plain-js.worker.v1',status:'FAIL',input,resetSource,scope:'SOURCE_PREPARED_JS_ARM; requires separately approved capture binding and execution grant; no native/performance/adoption claim',clockModel:'Configured six board clocks per completed instruction/REP element; no physical 386 calibration',blankHooks:Object.fromEntries(hooks.map(k=>[k,process.env[k]??'']))};
 let machine=null,prerequisite=null;
 const write=name=>{const raw=JSON.stringify(receipt)+'\n';assert.ok(Buffer.byteLength(raw)<=8<<20,'structured receipt cap');writeFileSync(resolve(input.output,name),raw,{flag:'wx'});};
 try{
  receipt.inputSha256Before=sha(ordinaryBytes(inputPath,16384));receipt.node=realpathSync(process.execPath);receipt.nodeSha256Before=sha(ordinaryBytes(receipt.node,128<<20));assert.equal(receipt.nodeSha256Before,input.nodeSha256);
  receipt.sourceBefore=plainSourceIdentity();assert.equal(receipt.sourceBefore.revision,input.workerRevision);assert.equal(sha(Buffer.from(JSON.stringify(receipt.sourceBefore))),input.workerSourceSha256);
  // Pending/missing/failed capture fails here, before the private constructor.
  prerequisite=authenticatePrerequisite(input);receipt.prerequisite={binding:prerequisite.binding,bindingSha256:prerequisite.bindingSha256,captureSha256:prerequisite.captureSha256,independentAuditSha256:prerequisite.independentAuditSha256};
  machine=createPlainJsBochsResetMachine();receipt.reset=machine.reset();assert.deepEqual(receipt.reset.cpu,prerequisite.capture.cuts[0].javascript.cpu,'same raw initialized reset profile');assert.deepEqual(receipt.reset.board,prerequisite.capture.cuts[0].javascript.board);
  receipt.result=machine.execute(prerequisite.token);receipt.comparison=compareFinalEvidence(receipt.result,prerequisite.capture);machine.close();machine=null;
  receipt.sourceAfter=plainSourceIdentity();assert.deepEqual(receipt.sourceAfter,receipt.sourceBefore);receipt.nodeSha256After=sha(ordinaryBytes(receipt.node,128<<20));assert.equal(receipt.nodeSha256After,receipt.nodeSha256Before);receipt.inputSha256After=sha(ordinaryBytes(inputPath,16384));assert.equal(receipt.inputSha256After,receipt.inputSha256Before);
  const after=authenticatePrerequisite(input);assert.deepEqual({bindingSha256:after.bindingSha256,captureSha256:after.captureSha256,independentAuditSha256:after.independentAuditSha256},{bindingSha256:prerequisite.bindingSha256,captureSha256:prerequisite.captureSha256,independentAuditSha256:prerequisite.independentAuditSha256});
  receipt.processCpuMicrosecondsAtReceipt=process.cpuUsage();receipt.processUptimeSecondsAtReceipt=process.uptime();receipt.wholeChildEvidence='Parent must separately retain process-group bounds, wait4/rusage CPU and child wall/raw exit; these self-reports are not execution-phase timing';receipt.status='PLAIN_JS_ARM_EXECUTION_AND_FINAL_PARITY_PASS';write('receipt.json');
 }catch(error){
  receipt.error=String(error);if(machine){try{receipt.partial=machine.partial();}catch(e){receipt.partialUnavailable=String(e);}try{machine.close();}catch(e){receipt.closeError=String(e);}}
  for(const [key,read]of [['sourceAfter',plainSourceIdentity],['nodeSha256After',()=>sha(ordinaryBytes(receipt.node,128<<20))],['inputSha256After',()=>sha(ordinaryBytes(inputPath,16384))],['prerequisiteAfter',()=>{const p=authenticatePrerequisite(input);return {bindingSha256:p.bindingSha256,captureSha256:p.captureSha256,independentAuditSha256:p.independentAuditSha256};}]])try{receipt[key]=read();}catch(e){receipt[key+'Unavailable']=String(e);}
  write('failure.json');throw error;
 }
}
if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))){assert.equal(process.argv.length,3);const inputPath=process.argv[2];await runWorker(JSON.parse(ordinaryBytes(inputPath,16384)),inputPath);}
