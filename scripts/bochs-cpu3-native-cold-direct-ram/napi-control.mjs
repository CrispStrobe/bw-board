// Each case is a fresh Node process: the production CPU3 N-API is one lifetime.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url);
const [addonPath,caseName]=process.argv.slice(2);
assert.ok(addonPath&&caseName);
const addon=require(resolve(addonPath));
const rom=new Uint8Array(65536);rom[0]=0xa5;rom[65535]=0x5a;
const directRam=new Uint8Array(0x1000000),directGenerations=new Uint32Array(384);
const state=()=>Uint32Array.of(0,0,4,0,6000,0,1);
const callback={directRam,directGenerations,
 admitExecutePage(){throw Error('unexpected page');},
 packedScalar(){throw Error('unexpected scalar');},
 reconcileFull(){throw Error('unexpected full retry');},
 reconcilePaused(){throw Error('unexpected paused observer');},
 clockTransfer(){const batch=addon.directDrain();addon.directCommit(batch);return state();}};
let configuration='';
if(caseName==='rom-detach'){
 const clock=callback.clockTransfer;
 Object.defineProperty(callback,'clockTransfer',{get(){structuredClone(rom.buffer,{transfer:[rom.buffer]});return clock;}});
}
if(caseName==='recursive-create'){
 const clock=callback.clockTransfer;
 Object.defineProperty(callback,'clockTransfer',{get(){try{addon.create('',new Uint8Array(65536),callback,false);}catch{}return clock;}});
}
if(caseName==='recursive-commit')callback.clockTransfer=()=>{
 const batch=addon.directDrain();
 assert.equal(batch.length,2);
 Object.defineProperty(batch,'acknowledged',{get(){try{addon.directCommit(batch);}catch{}return 0;}});
 try{addon.directCommit(batch);}catch{}
 return state();
};
if(caseName==='duplicate-commit')callback.clockTransfer=()=>{
 const batch=addon.directDrain();addon.directCommit(batch);
 try{addon.directCommit(batch);}catch{}
 return state();
};
if(caseName==='valid-overlap'||caseName==='late-tamper'||caseName==='ticket-mismatch'||caseName==='session-mismatch'||caseName==='recursive-commit')configuration='two-writes';
if(caseName==='late-tamper')callback.clockTransfer=()=>{
 const batch=addon.directDrain();assert.equal(batch.length,2);batch[1].after[0]^=1;
 try{addon.directCommit(batch);}catch{}
 return state();
};
if(caseName==='ticket-mismatch')callback.clockTransfer=()=>{
 const batch=addon.directDrain();batch.ticket+=1n;
 try{addon.directCommit(batch);}catch{}
 return state();
};
if(caseName==='session-mismatch')callback.clockTransfer=()=>{
 const batch=addon.directDrain();batch.sessionIdentity+=1n;
 try{addon.directCommit(batch);}catch{}
 return state();
};
const denied=new Set(['recursive-create','recursive-commit','duplicate-commit','late-tamper','ticket-mismatch','session-mismatch']);
if(denied.has(caseName)){
 assert.throws(()=>addon.create(configuration,rom,callback,false));
 assert.equal(directRam[0x100],0);assert.equal(directRam[0x101],0);
 assert.equal(directGenerations[0],0);
}else{
 const result=addon.create(configuration,rom,callback,false);
 assert.equal(result.boardA20,1);
 if(caseName==='rom-detach')assert.equal(rom.byteLength,0);
 if(caseName==='valid-overlap'){
  assert.equal(directRam[0x100],0x31);assert.equal(directRam[0x101],0x32);
  assert.equal(directGenerations[0],2);
 }
 addon.close();
}
console.log('direct-RAM N-API control PASS',caseName);
