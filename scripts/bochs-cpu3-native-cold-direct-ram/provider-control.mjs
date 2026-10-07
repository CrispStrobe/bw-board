import assert from 'node:assert/strict';
import {createDirectRamColdBiosProvider} from './provider.mjs';

let provider,acked=false;
const owner={directRamProfile:'bw.cpu3.cold.direct-ram-rom-exec.v1',abiVersion:5,
 directDrain(){
  assert.equal(acked,false);
  const records=[
   {address:0x2000,sequence:1,effect:1,n:0,q:0,epoch:0,generation:1,before:Uint8Array.of(0),after:Uint8Array.of(0x31)},
   {address:0x1000,sequence:2,effect:2,n:0,q:0,epoch:0,generation:1,before:Uint8Array.of(0),after:Uint8Array.of(0x41)},
   {address:0x2000,sequence:3,effect:3,n:0,q:0,epoch:0,generation:2,before:Uint8Array.of(0x31),after:Uint8Array.of(0x32)}
  ];
  Object.assign(records,{acknowledged:0,through:3,epoch:0,sessionIdentity:1n,ticket:1n});
  return records;
 },
 directCommit(records){
  assert.equal(records.length,3);assert.equal(records[2].before[0],0x31);
  const {directRam,directGenerations}=provider.callbacks;
  assert.equal(directRam[0x2000],0);assert.equal(directRam[0x1000],0);
  assert.equal(directGenerations[2],0);assert.equal(directGenerations[1],0);
  for(const e of records){directRam[e.address]=e.after[0];directGenerations[e.address>>>12]=e.generation;}
  acked=true;return 3;
 },
 directFailStop(){throw Error('unexpected provider fail-stop');}
};
provider=createDirectRamColdBiosProvider(owner);
assert.deepEqual([...provider.callbacks.clockTransfer(new Uint32Array(),1)],[0,0,4,0,6000,0,1]);
assert.equal(acked,true);
assert.equal(provider.callbacks.directRam[0x2000],0x32);
assert.equal(provider.callbacks.directRam[0x1000],0x41);
assert.deepEqual(provider.generationEntries(),[[0x2000,2],[0x1000,1]]);
assert.equal(provider.ownerStatus().acknowledged,3);
assert.deepEqual(provider.journal().map(e=>e.sequence),[1,2,3]);
console.log('direct-RAM actual-provider staged overlap/order control PASS');
