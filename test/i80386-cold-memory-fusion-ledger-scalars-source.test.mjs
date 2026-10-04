import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {memoryFusionCallbacks} from '../scripts/bochs-cpu3-native-cold-memory-fusion-ledger-scalars/provider.mjs';
import {memoryFusionCallbacks as heldCallbacks} from '../scripts/bochs-cpu3-native-cold-memory-fusion/provider.mjs';
const ledger=()=>new Uint32Array([1,1,10,0,6000,0,1]);
function fixture(clock=()=>ledger(),read=()=>new Uint8Array([9]),write=()=>{}){return memoryFusionCallbacks({callbacks:{clockTransfer:clock,readPhysical:read,writePhysical:write}});}
function invoke(f,expected=ledger(),operand=null){return f.callbacks.fusedMemory(new Uint32Array([1]),3,0xf0000,1,operand,expected);}
test('each exact word mismatch reaches its intended guard before effects',()=>{
 // Word2 equality uses an inconsistent expected cycle tuple; actual reply stays domain-valid.
 for(let i=0;i<7;i++){let effects=0;const expected=ledger(),reply=ledger();
  if(i===1){expected[1]=2;expected[2]=16;}else if(i===2){expected[2]=16;}else if(i===4){expected[4]=5999;}else if(i===6){expected[6]=0;}else expected[i]++;
  const f=fixture(()=>reply,()=>{effects++;},()=>{effects++;});
  assert.throws(()=>invoke(f,expected),e=>e.message.includes('MEMORY ledger word '+i));assert.equal(effects,0);
 }
});
test('shape and domain refusals precede effects',()=>{
 const bad=[Array.from(ledger()),new Uint32Array(8),new Uint32Array(new ArrayBuffer(32),4,7),new Uint32Array(new SharedArrayBuffer(28)),new Uint32Array(new ArrayBuffer(28,{maxByteLength:56}))];
 for(const r of bad){let effects=0;const f=fixture(()=>r,()=>{effects++;});assert.throws(()=>invoke(f));assert.equal(effects,0);}
 for(const [i,v] of [[4,0],[4,6001],[3,6006],[6,2],[2,11]]){const r=ledger();r[i]=v;let effects=0;const f=fixture(()=>r,()=>{effects++;});assert.throws(()=>invoke(f));assert.equal(effects,0);}
});
test('scalar expectation, operands and accepted reply retain independent ownership',()=>{
 const expected=ledger(),reply=ledger(),operand=new Uint8Array([7]);let seen;
 const f=fixture(()=>{expected.fill(0);operand[0]=99;return reply;},()=>{reply.fill(0);return new Uint8Array([9]);},(_,bytes)=>{seen=bytes[0];reply.fill(0);});
 const result=invoke(f,expected,operand);assert.equal(seen,7);assert.deepEqual(result.clock,ledger());assert.notEqual(result.clock.buffer,reply.buffer);
});
test('clock exceptions and reentry preserve order before effects',()=>{
 let effects=0;const error=Error('clock primary');const f=fixture(()=>{throw error;},()=>{effects++;});assert.throws(()=>invoke(f),e=>e===error);assert.equal(effects,0);
 let nested;const g=fixture(()=>{assert.throws(()=>invoke(nested),/fusion reentry/);return ledger();},()=>{effects++;return new Uint8Array([9]);});nested=g;invoke(g);assert.equal(effects,1);
});
test('held source pins and unchanged effect/error seam are exact',()=>{
 const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');
 const d=JSON.parse(read('scripts/bochs-cpu3-native-cold-memory-fusion-ledger-scalars/derivation.json'));
 const held=read('scripts/bochs-cpu3-native-cold-memory-fusion/provider.mjs');
 assert.equal(createHash('sha256').update(held).digest('hex'),d.heldProviderSha256);
 const candidate=read('scripts/bochs-cpu3-native-cold-memory-fusion-ledger-scalars/provider.mjs');
 let replay=held;for(const e of d.providerEdits){assert.equal(replay.split(e.before).length-1,e.count);replay=replay.replace(e.before,e.after);}assert.equal(replay,candidate);
 const tail=s=>s.slice(s.indexOf('counts.replyValidations++'));assert.equal(tail(candidate),tail(held));
 const heldFactory=read('scripts/bochs-cpu3-native-cold-memory-fusion/factory.mjs');
 assert.equal(createHash('sha256').update(heldFactory).digest('hex'),d.heldFactorySha256);
 assert.equal(read('scripts/bochs-cpu3-native-cold-memory-fusion-ledger-scalars/factory.mjs').replaceAll('createOwnedMemoryFusionLedgerScalarProvider','createOwnedMemoryFusionProvider'),heldFactory);
});
test('malformed expected snapshots refuse before clock or effects',()=>{
 class Sub extends Uint32Array{};
 const detached=ledger();structuredClone(detached.buffer,{transfer:[detached.buffer]});
 const changed=ledger();Object.setPrototypeOf(changed,{});
 const bad=[Array.from(ledger()),new Sub(7),changed,detached,new Uint32Array(new SharedArrayBuffer(28)),new Uint32Array(new ArrayBuffer(28,{maxByteLength:56})),new Uint32Array(new ArrayBuffer(32),4,7)];
 for(const expected of bad){let clocks=0,effects=0;const f=fixture(()=>{clocks++;return ledger();},()=>{effects++;},()=>{effects++;});assert.throws(()=>invoke(f,expected));assert.equal(clocks,0);assert.equal(effects,0);}
});
test('valid reads and writes match held outputs and counters; read reply stays owned',()=>{
 for(const write of [false,true]){const make=cb=>cb({callbacks:{clockTransfer:()=>ledger(),readPhysical:()=>new Uint8Array([9]),writePhysical:(_,bytes)=>Uint8Array.from(bytes)}});
 const candidate=make(memoryFusionCallbacks),held=make(heldCallbacks);const operand=write?new Uint8Array([7]):null;
 assert.deepEqual(invoke(candidate,ledger(),operand),invoke(held,ledger(),operand));assert.deepEqual(candidate.entryCounts(),held.entryCounts());}
 const reply=ledger();const f=fixture(()=>reply,()=>{reply.fill(0);return new Uint8Array([9]);});assert.deepEqual(invoke(f).clock,ledger());
});
test('memory reentry refuses and clock/memory throws release the owner',()=>{
 let f,throwClock=true,throwMemory=true;const clockError=Error('clock'),memoryError=Error('memory');
 f=fixture(()=>{if(throwClock){throwClock=false;throw clockError;}return ledger();},()=>{assert.throws(()=>invoke(f),/fusion reentry/);if(throwMemory){throwMemory=false;throw memoryError;}return new Uint8Array([9]);});
 assert.throws(()=>invoke(f),e=>e===clockError);assert.throws(()=>invoke(f),e=>e===memoryError);assert.deepEqual(invoke(f).memory,new Uint8Array([9]));
});
