import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {memoryFusionCallbacks} from '../scripts/bochs-cpu3-native-cold-memory-fusion-ledger-scalars/provider.mjs';
const ledger=()=>new Uint32Array([1,1,10,0,6000,0,1]);
function fixture(clock=()=>ledger(),read=()=>new Uint8Array([9]),write=()=>{}){return memoryFusionCallbacks({callbacks:{clockTransfer:clock,readPhysical:read,writePhysical:write}});}
function invoke(f,expected=ledger(),operand=null){return f.callbacks.fusedMemory(new Uint32Array([1]),3,0xf0000,1,operand,expected);}
test('each real reply word mismatch refuses before memory effects',()=>{
 for(let i=0;i<7;i++){let effects=0;const f=fixture(()=>{const r=ledger();r[i]++;return r;},()=>{effects++;},()=>{effects++;});assert.throws(()=>invoke(f));assert.equal(effects,0);}
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
 const tail=s=>s.slice(s.indexOf('counts.replyValidations++'));assert.equal(tail(candidate),tail(held));
 const heldFactory=read('scripts/bochs-cpu3-native-cold-memory-fusion/factory.mjs');
 assert.equal(createHash('sha256').update(heldFactory).digest('hex'),d.heldFactorySha256);
 assert.equal(read('scripts/bochs-cpu3-native-cold-memory-fusion-ledger-scalars/factory.mjs').replaceAll('createOwnedMemoryFusionLedgerScalarProvider','createOwnedMemoryFusionProvider'),heldFactory);
});
