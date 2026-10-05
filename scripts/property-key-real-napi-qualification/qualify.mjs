// Owned test addon only; no production worker/backend import.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const contract=JSON.parse(readFileSync(new URL('./contract.json',import.meta.url),'utf8'));
if(contract.status!=='ROOT_REVIEWED_REAL_NAPI_FIXTURE_READY'||!contract.addonSha256||!contract.generatedHelperSha256||!contract.buildReceiptSha256)throw Error('PENDING real-NAPI fixture authority; no addon load');
const path=new URL(contract.addonPath,import.meta.url);
assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'),contract.addonSha256);
const api=createRequire(import.meta.url)(path.pathname);
const original=new Error('getter original'),setterError=new Error('setter original');
let reads=0,writes=[];
api.prepare();
try{
 const prototype={get bytes(){reads++;return reads;}};
 const target=Object.create(prototype);assert.equal(api.readBytes(target),1);assert.equal(api.readBytes(target),2);
 Object.defineProperty(target,'bytes',{get(){throw original;},configurable:true});assert.throws(()=>api.readBytes(target),e=>e===original);
 const object={set state(v){writes.push(v);}};api.writeState(object,7);api.writeState(object,8);assert.deepEqual(writes,[7,8]);
 const rejected={set state(v){throw setterError;}};assert.throws(()=>api.writeState(rejected,9),e=>e===setterError);
 const traps=[];const proxy=new Proxy({bytes:17},{get(t,k,r){traps.push(k);return Reflect.get(t,k,r);}});assert.equal(api.readBytes(proxy),17);assert.deepEqual(traps,['bytes']);
 const reentry={get bytes(){assert.throws(()=>api.readBytes(proxy),/reentry refused/);return 19;}};assert.equal(api.readBytes(reentry),19);
 if(typeof globalThis.gc!=='function')throw Error('fixed fixture command requires --expose-gc');
 for(let i=0;i<8;i++){globalThis.gc();assert.equal(api.readBytes(proxy),17);}
 // Allocation pressure and GC are behavior checks, not leak accounting.
 assert.equal(api.readBytes({bytes:23}),23);
}finally{api.release();}
assert.throws(()=>api.readBytes({bytes:1}),/keys unavailable/);
console.log(JSON.stringify({status:'REAL_NAPI_MAIN_ENV_BEHAVIOR_PASS',reads,writes,scope:'getter/setter/proxy/exception/reentry+forcedGC only; teardown/env tests separate; no guest/performance'}));
