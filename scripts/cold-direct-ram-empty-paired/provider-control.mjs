import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {resolve} from 'node:path';
import {derive,load,baselineNormalizedSha256} from './provider.mjs';

const root=process.argv[2];
assert.ok(root&&resolve(root)===root,'pass absolute qualified acdb source root');
const baseline=derive(root,'baseline'),candidate=derive(root,'candidate');
assert.equal(baseline.normalizedSha256,baselineNormalizedSha256);
assert.notEqual(candidate.normalizedSha256,baseline.normalizedSha256);
assert.equal(candidate.qualifiedSha256,baseline.qualifiedSha256);
const base=(await load(root,'baseline')).create;
const fast=(await load(root,'candidate')).create;
const blank=(ticket=1n)=>Object.assign([],{acknowledged:0,through:0,epoch:0,sessionIdentity:1n,ticket});
function iterations(fn){
 const original=Map.prototype[Symbol.iterator];let count=0;
 Map.prototype[Symbol.iterator]=function(){count++;return original.call(this);};
 try{fn();return count;}finally{Map.prototype[Symbol.iterator]=original;}
}
for(const [name,make,want] of [['baseline',base,1],['candidate',fast,0]]){
 let drains=0,commits=0,copy;
 const owner={abiVersion:5,directRamProfile:'bw.cpu3.cold.direct-ram-rom-exec.v1',
  directDrain(){copy=blank(BigInt(++drains));return copy;},
  directCommit(entries){assert.strictEqual(entries,copy);assert.equal(entries.length,0);commits++;return 0;},
  directFailStop(){throw Error('unexpected fail-stop');}};
 const provider=make(owner);
 assert.equal(iterations(()=>provider.callbacks.clockTransfer(new Uint32Array(),1)),want,name+' empty Map copy');
 assert.deepEqual([drains,commits,provider.ownerStatus().acknowledged,provider.ownerStatus().journalEntries],[1,1,0,0]);
 assert.throws(()=>provider.journal(),/disabled/);
}
function overlap(make,bad=false){
 let provider,copy,commits=0;
 const owner={abiVersion:5,directRamProfile:'bw.cpu3.cold.direct-ram-rom-exec.v1',
  directDrain(){copy=Object.assign([
   {address:0x2000,sequence:1,effect:1,n:0,q:0,epoch:0,generation:1,before:Uint8Array.of(0),after:Uint8Array.of(31)},
   {address:0x1000,sequence:2,effect:2,n:0,q:0,epoch:0,generation:1,before:Uint8Array.of(0),after:Uint8Array.of(41)},
   {address:0x2000,sequence:3,effect:3,n:0,q:0,epoch:0,generation:bad?3:2,before:Uint8Array.of(31),after:Uint8Array.of(32)}
  ],{acknowledged:0,through:3,epoch:0,sessionIdentity:1n,ticket:1n});return copy;},
  directCommit(entries){assert.strictEqual(entries,copy);commits++;
   const {directRam,directGenerations}=provider.callbacks;
   assert.deepEqual([directRam[0x2000],directRam[0x1000],directGenerations[2],directGenerations[1]],[0,0,0,0]);
   for(const e of entries){directRam[e.address]=e.after[0];directGenerations[e.address>>>12]=e.generation;}return 3;},
  directFailStop(){throw Error('unexpected fail-stop');}};
 provider=make(owner);
 if(bad)assert.throws(()=>provider.callbacks.clockTransfer(new Uint32Array(),1),/generation/);
 else provider.callbacks.clockTransfer(new Uint32Array(),1);
 return {provider,commits};
}
for(const make of [base,fast]){
 const valid=overlap(make);assert.equal(valid.commits,1);
 assert.deepEqual(valid.provider.generationEntries(),[[0x2000,2],[0x1000,1]]);
 assert.equal(valid.provider.ownerStatus().acknowledged,3);
 assert.equal(valid.provider.ownerStatus().journalEntries,3);
 assert.deepEqual([valid.provider.callbacks.directRam[0x2000],valid.provider.callbacks.directRam[0x1000]],[32,41]);
 const bad=overlap(make,true);assert.equal(bad.commits,0);
 assert.equal(bad.provider.ownerStatus().acknowledged,0);
 assert.deepEqual(bad.provider.generationEntries(),[]);
}
for(const change of [e=>e.acknowledged=1,e=>e.through=1,e=>e.epoch=1]){
 let commits=0;const owner={abiVersion:5,directRamProfile:'bw.cpu3.cold.direct-ram-rom-exec.v1',
  directDrain(){const e=blank();change(e);return e;},directCommit(){commits++;return 0;},
  directFailStop(){throw Error('unexpected fail-stop');}};
 const provider=fast(owner);assert.throws(()=>provider.callbacks.clockTransfer(new Uint32Array(),1));
 assert.equal(commits,0);assert.equal(provider.ownerStatus().acknowledged,0);
}
const scratch=mkdtempSync(resolve(process.cwd(),'.provider-control-'));
try{
 const dir=resolve(scratch,'scripts/bochs-cpu3-native-cold-direct-ram');mkdirSync(dir,{recursive:true});
 const source=readFileSync(resolve(root,'scripts/bochs-cpu3-native-cold-direct-ram/provider.mjs'));
 writeFileSync(resolve(dir,'provider.mjs'),Buffer.concat([source,Buffer.from('\n')]));
 assert.throws(()=>derive(scratch,'candidate'),/qualified provider bytes/);
}finally{rmSync(scratch,{recursive:true,force:true});}
console.log('provider controls PASS: identity/inverse, empty ACK, nonempty overlap, malformed ACK, wrong source');
