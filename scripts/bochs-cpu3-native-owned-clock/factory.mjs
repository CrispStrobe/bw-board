/** Private worker, whole-resume IPC only. No caller objects or callback tables. */
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const maxMessageBytes=16384;
const workerURL=new URL('./worker.mjs',import.meta.url),sha=b=>createHash('sha256').update(b).digest('hex');
const apply=Reflect.apply,descriptors=Object.getOwnPropertyDescriptors,define=Object.defineProperty,proto=Object.getPrototypeOf;
const original=Object.fromEntries(['on','once','emit','addListener','removeListener','off','removeAllListeners','postMessage','terminate'].map(k=>[k,Worker.prototype[k]]));
const prototypes=[];for(let p=Worker.prototype;p!==Object.prototype;p=proto(p))prototypes.push([p,descriptors(p)]);
function infrastructure(){for(const [p,d] of prototypes)assert.deepEqual(descriptors(p),d,'parent Worker infrastructure mutated before factory');}
export async function createOwnedNativeClock(serialized,...extra){
 assert.equal(extra.length,0);assert.equal(typeof serialized,'string','primitive serialized artifact admission');assert.ok(Buffer.byteLength(serialized)<=maxMessageBytes);const input=JSON.parse(serialized);assert.ok(input&&Object.getPrototypeOf(input)===Object.prototype);assert.deepEqual(Object.keys(input).sort(),['addon','configuration','configurationSha256','hostJournal','journal','nativeTrace','sha256'].sort());for(const k of ['addon','configuration','configurationSha256','journal','sha256'])assert.equal(typeof input[k],'string');for(const k of ['hostJournal','nativeTrace'])assert.equal(typeof input[k],'boolean');infrastructure();
 const worker=new Worker(workerURL,{execArgv:[],env:{...process.env,NODE_OPTIONS:''},resourceLimits:{maxOldGenerationSizeMb:128},workerData:{workerSha256:sha(readFileSync(workerURL)),serialized}});
 for(const [name,fn] of Object.entries(original))define(worker,name,{value:function(...a){return apply(fn,worker,a);},configurable:false,writable:false});
 const invoke=(name,args=[])=>apply(original[name],worker,args);
 let id=0,pending=null,busy=false,closed=false,started=false,failed=null,readyResolve,readyReject;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 const startupTimer=setTimeout(()=>fail(Error('owned worker startup timeout')),10000);
 function fail(error){if(closed)return;failed=error;closed=true;clearTimeout(startupTimer);if(!started)readyReject(error);const p=pending;pending=null;if(p){clearTimeout(p.timer);p.reject(error);}void invoke('terminate');}
 invoke('on',['error',fail]);invoke('on',['exit',code=>{if(!closed)fail(Error('owned worker exit before completed request '+code));}]);
 invoke('on',['message',m=>{
  if(!started){if(m.ready&&typeof m.snapshot==='string'){started=true;clearTimeout(startupTimer);readyResolve(m.snapshot);}else fail(Error(m.error??'owned worker startup response'));return;}
  if(!pending||m.id!==pending.id){fail(Error('owned reply sequence'));return;}const p=pending;pending=null;clearTimeout(p.timer);if(m.error){fail(Error(m.error));p.reject(failed);}else if(typeof m.payload!=='string'){fail(Error('owned primitive response'));p.reject(failed);}else p.resolve(m.payload);
 }]);
 const reset=await ready;
 async function request(command,payload=''){
  assert.ok(!closed&&!failed,'owned handle closed');assert.ok(!busy,'closed resume lease denies concurrent observer');assert.equal(typeof payload,'string','primitive serialized protocol required');assert.ok(Buffer.byteLength(payload)<=maxMessageBytes,'message byte bound');busy=true;
  try{return await new Promise((resolve,reject)=>{const requestId=++id;const timer=setTimeout(()=>fail(Error('owned request timeout')),10000);pending={id:requestId,resolve,reject,timer};try{invoke('postMessage',[{id:requestId,command,payload}]);}catch(error){fail(error);}});}finally{busy=false;}
 }
 return Object.freeze({reset,async resume(serialized){return request('resume',serialized);},async inspect(){return request('inspect');},async checkpoint(){return request('checkpoint');},async close(){const result=await request('close');closed=true;invoke('removeAllListeners');await invoke('terminate');return result;},async abort(){if(!closed)fail(Error('explicit replay abort, no qualification'));await invoke('terminate');}});
}
