import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createDirectRamColdBiosProvider as heldProvider} from '../bochs-cpu3-native-cold-direct-ram/provider.mjs';
import {deriveEmptyBatchProvider,heldProviderSha256} from './provider-derivation.mjs';

const derivative=deriveEmptyBatchProvider();
const {createDirectRamColdBiosProvider:emptyProvider}=await import(derivative.moduleUrl);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const blank=({ack=0,session=1n,ticket=1n}={})=>Object.assign([],{
 acknowledged:ack,through:ack,epoch:0,sessionIdentity:session,ticket
});
function countedMapIterations(action){
 const original=Map.prototype[Symbol.iterator];let calls=0;
 Map.prototype[Symbol.iterator]=function(){calls++;return original.call(this);};
 try{return {value:action(),calls};}
 finally{Map.prototype[Symbol.iterator]=original;}
}

test('one authenticated expression changes and inverse restores exact held provider',()=>{
 assert.equal(derivative.heldSha256,heldProviderSha256);
 assert.equal(hash(derivative.normalized),derivative.normalizedSha256);
 assert.match(derivative.normalized,/entries\.length===0\?board\.generations:new Map\(board\.generations\)/);
});

test('qualified-root materialization rebinds imports without changing normalized provider',()=>{
 const directory=mkdtempSync(join(tmpdir(),'bw-direct-empty-parent-'));
 try{
  const copied=join(directory,'provider.mjs');
  copyFileSync(new URL('../bochs-cpu3-native-cold-direct-ram/provider.mjs',import.meta.url),copied);
  const qualified=deriveEmptyBatchProvider(pathToFileURL(copied));
  assert.equal(qualified.heldSha256,derivative.heldSha256);
  assert.equal(qualified.normalizedSha256,derivative.normalizedSha256);
  assert.notEqual(qualified.loadedSha256,derivative.loadedSha256);
  assert.match(Buffer.from(qualified.moduleUrl.split(',')[1],'base64').toString(),/file:\/\//);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

test('empty journal still drains and commits exact ACK, without Map clone',()=>{
 for(const [make,expectedIterations] of [[heldProvider,1],[emptyProvider,0]]){
  let drains=0,commits=0,lastDrained;const owner={directRamProfile:'bw.cpu3.cold.direct-ram-rom-exec.v1',abiVersion:5,
   directDrain(){drains++;lastDrained=blank({ticket:BigInt(drains)});return lastDrained;},
   directCommit(entries){assert.strictEqual(entries,lastDrained,'exact copied batch is committed');assert.equal(entries.length,0);assert.equal(entries.acknowledged,0);assert.equal(entries.through,0);commits++;return 0;},
   directFailStop(){throw Error('unexpected fail-stop');}
  };
  const provider=make(owner);
  const observed=countedMapIterations(()=>provider.callbacks.clockTransfer(new Uint32Array(),1));
  assert.deepEqual([...observed.value],[0,0,4,0,6000,0,1]);
  assert.equal(observed.calls,expectedIterations);
  assert.equal(drains,1);assert.equal(commits,1);
  assert.deepEqual(provider.generationEntries(),[]);
  assert.equal(provider.ownerStatus().acknowledged,0);
 }
});

function overlap(make,corruptLast=false){
 let provider,drains=0,commits=0;
 const owner={directRamProfile:'bw.cpu3.cold.direct-ram-rom-exec.v1',abiVersion:5,
  directDrain(){drains++;const entries=[
   {address:0x2000,sequence:1,effect:1,n:0,q:0,epoch:0,generation:1,before:Uint8Array.of(0),after:Uint8Array.of(0x31)},
   {address:0x1000,sequence:2,effect:2,n:0,q:0,epoch:0,generation:1,before:Uint8Array.of(0),after:Uint8Array.of(0x41)},
   {address:0x2000,sequence:3,effect:3,n:0,q:0,epoch:0,generation:corruptLast?3:2,before:Uint8Array.of(0x31),after:Uint8Array.of(0x32)}
  ];return Object.assign(entries,{acknowledged:0,through:3,epoch:0,sessionIdentity:1n,ticket:1n});},
  directCommit(entries){commits++;const {directRam,directGenerations}=provider.callbacks;
   assert.deepEqual([directRam[0x2000],directRam[0x1000],directGenerations[2],directGenerations[1]],[0,0,0,0]);
   for(const e of entries){directRam[e.address]=e.after[0];directGenerations[e.address>>>12]=e.generation;}
   return 3;
  },directFailStop(){throw Error('unexpected fail-stop');}
 };
 provider=make(owner);
 let iterations=0;
 if(corruptLast)assert.throws(()=>provider.callbacks.clockTransfer(new Uint32Array(),1),/contiguous board page generation/);
 else {const observed=countedMapIterations(()=>provider.callbacks.clockTransfer(new Uint32Array(),1));iterations=observed.calls;}
 return {provider,drains,commits,iterations};
}

test('nonempty overlapping entries preserve staged Map order and native commit path',()=>{
 for(const make of [heldProvider,emptyProvider]){
  const {provider,drains,commits,iterations}=overlap(make);
  assert.equal(drains,1);assert.equal(commits,1);assert.equal(iterations,1);
  assert.deepEqual(provider.generationEntries(),[[0x2000,2],[0x1000,1]]);
  assert.deepEqual([provider.callbacks.directRam[0x2000],provider.callbacks.directRam[0x1000]],[0x32,0x41]);
  assert.deepEqual(provider.journal().map(e=>e.sequence),[1,2,3]);
  assert.equal(provider.ownerStatus().acknowledged,3);
 }
});

test('tampered later journal entry denies before any board or ACK effect',()=>{
 const {provider,drains,commits}=overlap(emptyProvider,true);
 assert.equal(drains,1);assert.equal(commits,0);
 assert.deepEqual([provider.callbacks.directRam[0x2000],provider.callbacks.directRam[0x1000],
  provider.callbacks.directGenerations[2],provider.callbacks.directGenerations[1]],[0,0,0,0]);
 assert.equal(provider.ownerStatus().acknowledged,0);
 assert.deepEqual(provider.generationEntries(),[]);
});

test('empty copied metadata and cross-session mismatches deny before ACK',()=>{
 for(const change of [e=>e.acknowledged=1,e=>e.through=1,e=>e.epoch=1]){
  let commits=0;
  const owner={directRamProfile:'bw.cpu3.cold.direct-ram-rom-exec.v1',abiVersion:5,
   directDrain(){const entries=blank();change(entries);return entries;},
   directCommit(){commits++;return 0;},
   directFailStop(){throw Error('unexpected fail-stop');}
  };
  const provider=emptyProvider(owner);
  assert.throws(()=>provider.callbacks.clockTransfer(new Uint32Array(),1));
  assert.equal(commits,0);assert.equal(provider.ownerStatus().acknowledged,0);
  assert.equal(provider.callbacks.directRam[0x1000],0);
 }
 let session=1n,commits=0;
 const owner={directRamProfile:'bw.cpu3.cold.direct-ram-rom-exec.v1',abiVersion:5,
  directDrain(){return blank({session,ticket:BigInt(commits+1)});},
  directCommit(){commits++;return 0;},directPaused(){},
  directFailStop(){throw Error('unexpected fail-stop');}
 };
 const provider=emptyProvider(owner);
 provider.callbacks.clockTransfer(new Uint32Array(),1);
 provider.begin();session=2n;
 assert.throws(()=>provider.callbacks.clockTransfer(new Uint32Array(),2),/one bound owner session/);
 assert.equal(commits,1);assert.equal(provider.ownerStatus().acknowledged,0);
});

test('malformed pending observer phase denies before drain, ACK or board effect',()=>{
 let provider,drains=0,commits=0,pending=false;
 const owner={directRamProfile:'bw.cpu3.cold.direct-ram-rom-exec.v1',abiVersion:5,
  directDrain(){assert.equal(pending,false);drains++;return blank({ticket:BigInt(drains)});},
  directCommit(entries){assert.equal(entries.length,0);commits++;return 0;},
  directPaused(){},directFailStop(){throw Error('unexpected fail-stop');}
 };
 provider=emptyProvider(owner);
 provider.callbacks.clockTransfer(new Uint32Array(),1);
 provider.begin();provider.callbacks.clockTransfer(new Uint32Array(),2);
 pending=true;const before=[provider.callbacks.directRam[0x100],provider.callbacks.directGenerations[0]];
 assert.throws(()=>provider.callbacks.clockTransfer(Uint32Array.of(9),3));
 assert.throws(()=>provider.callbacks.admitExecutePage(0));
 assert.throws(()=>provider.callbacks.packedScalar(4,0,0,0));
 assert.deepEqual([drains,commits],[2,2]);
 assert.deepEqual([provider.callbacks.directRam[0x100],provider.callbacks.directGenerations[0]],before);
 assert.equal(provider.ownerStatus().acknowledged,0);
});

test('swallowed nested owner call is still rejected by fail-stop owner contract',()=>{
 let provider,active=false,poisoned=false,commits=0;
 const owner={directRamProfile:'bw.cpu3.cold.direct-ram-rom-exec.v1',abiVersion:5,
  directDrain(){
   if(active){poisoned=true;throw Error('owner method reentry');}
   active=true;
   try{assert.throws(()=>provider.callbacks.clockTransfer(new Uint32Array(),1),/owner method reentry/);}
   finally{active=false;}
   return blank();
  },
  directCommit(){if(poisoned)throw Error('owner fail-stop after swallowed reentry');commits++;return 0;},
  directFailStop(){poisoned=true;}
 };
 provider=emptyProvider(owner);
 assert.throws(()=>provider.callbacks.clockTransfer(new Uint32Array(),1),/owner fail-stop/);
 assert.equal(poisoned,true);assert.equal(commits,0);
 assert.equal(provider.ownerStatus().acknowledged,0);
 assert.deepEqual(provider.generationEntries(),[]);
});
