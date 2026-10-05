// Owned test addon only; no production worker/backend import.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
const contract=JSON.parse(readFileSync(new URL('./contract.json',import.meta.url),'utf8'));
if(contract.status!=='ROOT_REVIEWED_REAL_NAPI_FIXTURE_READY'||!contract.addonSha256||!contract.generatedHelperSha256||!contract.buildReceiptSha256)throw Error('PENDING real-NAPI fixture authority; no addon load');
if(contract.addonPath!=='./owned-build/key_fixture.node')throw Error('fixed addon path required');
const path=new URL('./owned-build/key_fixture.node',import.meta.url);
assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),contract.addonSha256);
const api=createRequire(import.meta.url)(path.pathname);
const original=new Error('getter original'),setterError=new Error('setter original');
let reads=0,writes=[];
const errorRecord=e=>({name:e?.name??'Error',message:e?.message??String(e),stack:e?.stack??null});
let primary=null;const cleanupErrors=[];let prepared=false;
try{
 // Avoid inherited numeric-setter interception without exposing the container.
 const prior=Object.getOwnPropertyDescriptor(Array.prototype,'0');let indexedAssignments=0;
 try{Object.defineProperty(Array.prototype,'0',{configurable:true,set(){indexedAssignments++;}});api.prepare();prepared=true;}
 finally{if(prior)Object.defineProperty(Array.prototype,'0',prior);else delete Array.prototype[0];}
 assert.equal(indexedAssignments,0);

 const prototype={get bytes(){assert.equal(this,target);reads++;return reads;}};
 const target=Object.create(prototype);assert.equal(api.readBytes(target),1);assert.equal(api.readBytes(target),2);
 Object.defineProperty(target,'bytes',{get(){throw original;},configurable:true});assert.throws(()=>api.readBytes(target),e=>e===original);
 const object={set state(v){assert.equal(this,object);writes.push(v);}};api.writeState(object,7);api.writeState(object,8);assert.deepEqual(writes,[7,8]);
 const rejected={set state(v){throw setterError;}};assert.throws(()=>api.writeState(rejected,9),e=>e===setterError);
 const traps=[];const proxy=new Proxy({bytes:17},{get(t,k,r){assert.equal(r,proxy);traps.push(k);return Reflect.get(t,k,r);}});assert.equal(api.readBytes(proxy),17);assert.deepEqual(traps,['bytes']);
 const reentry={get bytes(){assert.throws(()=>api.readBytes(proxy),/reentry refused/);return 19;}};assert.equal(api.readBytes(reentry),19);
 if(typeof globalThis.gc!=='function')throw Error('fixed fixture command requires --expose-gc');
 for(let i=0;i<8;i++){globalThis.gc();assert.equal(api.readBytes(proxy),17);}
 // Allocation pressure and GC are behavior checks, not leak accounting.
 assert.equal(api.readBytes({bytes:23}),23);
}catch(e){primary=e;}finally{if(prepared)try{api.release();}catch(e){cleanupErrors.push({phase:'main-release',error:errorRecord(e)});}}

const active=new Set();
function launch(role){
 const worker=new Worker(new URL('./env-worker.mjs',import.meta.url),{workerData:role,execArgv:[],resourceLimits:{maxOldGenerationSizeMb:128,stackSizeMb:4}});active.add(worker);
 const messages=[];let wake=null,workerError=null,exited=false;
 worker.on('message',value=>{messages.push(value);if(wake){wake();wake=null;}});
 const exit=new Promise(resolve=>{worker.once('error',e=>{workerError=e;if(wake){wake();wake=null;}});worker.once('exit',code=>{exited=true;active.delete(worker);resolve({code,error:workerError?errorRecord(workerError):null});if(wake){wake();wake=null;}});});
 return {worker,exit,async expect(value){while(!messages.length){if(workerError)throw workerError;if(exited)throw Error('worker EOF before expected message');await new Promise(resolve=>{wake=resolve;});}assert.equal(messages.shift(),value);},async cleanExit(){const outcome=await exit;assert.equal(outcome.code,0);assert.equal(outcome.error,null);}};
}
const envRecords=[];
try{
 if(primary||cleanupErrors.length)throw primary??new Error('main release failed');
 assert.throws(()=>api.readBytes({bytes:1}),/keys unavailable/);
 for(const command of ['release','teardown']){
  const owner=launch('owner');await owner.expect('owner-prepared');
  const foreign=launch('foreign');await foreign.expect('foreign-denied');await foreign.cleanExit();
  owner.worker.postMessage(command);if(command==='release')await owner.expect('owner-released');await owner.cleanExit();
  const fresh=launch('fresh');await fresh.expect('fresh-released');await fresh.cleanExit();envRecords.push({command,foreignDenied:true,freshPreparedAndReleased:true});
 }
}catch(e){if(!primary)primary=e;else cleanupErrors.push({phase:'env-fixture',error:errorRecord(e)});}
finally{for(const worker of active)try{await worker.terminate();}catch(e){cleanupErrors.push({phase:'worker-cleanup',error:errorRecord(e)});}}
const report={status:primary||cleanupErrors.length?'FAIL':'REAL_NAPI_BEHAVIOR_PASS',primaryError:primary?errorRecord(primary):null,cleanupErrors,reads,writes,envRecords,scope:'Exact generated key helper plus fixture failure/busy/thread/env glue only; not held invoke/fail paths or full addon; no guest, leak accounting or speed'};
console.log(JSON.stringify(report));if(primary)throw primary;if(cleanupErrors.length)throw Error('fixture cleanup failed');
