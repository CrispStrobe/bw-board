/** Fresh process harness; Worker timeout is not native cancellation. */
import assert from 'node:assert/strict';
import {readFileSync,openSync,closeSync} from 'node:fs';
import {Worker} from 'node:worker_threads';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {sha256} from '/tmp/bw-board-386-native-owned-clock-20261002/scripts/bochs-cpu3-native-owned-clock/derive.mjs';
import {sourceIdentity,authenticateBuild} from '/tmp/bw-board-386-native-owned-clock-20261002/scripts/bochs-cpu3-native-owned-clock/identity.mjs';
import {writeJournalRecord} from '/tmp/bw-board-386-native-owned-clock-20261002/scripts/bochs-cpu3-native-hot-direct/journal.mjs';
const input=JSON.parse(readFileSync(process.argv[2])),source=sourceIdentity();assert.equal(source.revision,'7df84bc2c367aff1cadec7cecdde69cf0e904ace');authenticateBuild(input,source);assert.equal(sha256(readFileSync(input.configuration)),input.configurationSha256,'actual child config');
const control=input.control,eventsPath=input.eventsPath,workerURL=new URL('./worker.mjs',import.meta.url);
const worker=new Worker(workerURL,{execArgv:[],env:{...process.env,NODE_OPTIONS:''},workerData:{input,control,eventsPath}});
const fd=openSync(eventsPath+'.parent','wx'),record=(name,extra={})=>writeJournalRecord(fd,JSON.stringify({...extra,name})+'\n');
let done=false;worker.on('error',e=>{throw e;});worker.on('exit',code=>{assert.ok(done&&code===0,'worker completion');closeSync(fd);});
worker.on('message',async m=>{
 if(m.ownerReady){
  if(control==='thread-owner'){const api=createRequire(import.meta.url)(input.addon);for(const [name,args] of [['inspect',[]],['setIRQ',[false]],['resume',[1,1,1n]],['close',[]]]){assert.throws(()=>api[name](...args));record('wrong-thread-denied',{operation:name});}}
  else{const second=new Worker(new URL('./second-worker.mjs',import.meta.url),{execArgv:[],env:{...process.env,NODE_OPTIONS:''},workerData:{input}});await new Promise((resolve,reject)=>{second.on('error',reject);second.on('message',v=>{assert.deepEqual(v,{secondDenied:true});record('second-worker-denied');});second.on('exit',code=>{code===0?resolve():reject(Error('second worker exit '+code));});});}
  worker.postMessage('finish');
 }else if(m.done){done=true;assert.deepEqual(sourceIdentity(),source);authenticateBuild(input,source);record('authenticated-done');}
 else assert.fail('unexpected harness message');
});
