/** Pure callback controls and generated-source inverses; no machine/addon/guest. */
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';
import test from 'node:test';import assert from 'node:assert/strict';
import {memoryFusionCallbacks,validateMemoryReply} from '../scripts/bochs-cpu3-native-cold-memory-fusion/provider.mjs';
import {deriveMemoryFusionRuntime,HELD_RUNTIME_SHA} from '../scripts/bochs-cpu3-native-cold-memory-fusion/runtime.mjs';
import {deriveMemoryFusionNapi,HELD_NAPI_SHA} from '../scripts/bochs-cpu3-native-cold-memory-fusion/napi.mjs';
import {sha256,replacement} from '../scripts/bochs-cpu3-native-owned-clock/derive.mjs';
const expected=()=>Uint32Array.from([1,1,10,6,6000,0,1]);
function mock(reply=expected(),clockHook=()=>{}){
 const events=[];let writes=[];
 const held={callbacks:{clockTransfer(words,reason){events.push(['clock',[...words],reason]);clockHook();return reply;},readPhysical(raw,length){events.push(['read',raw,length]);return {bytes:Uint8Array.from([7,8])};},writePhysical(raw,bytes){events.push(['write',raw,[...bytes]]);writes.push([...bytes]);reply[0]=99;return {bytes:Uint8Array.from(bytes)};}}};
 return {...memoryFusionCallbacks(held),events,writes};
}
test('every wrong genuine-domain ledger word or malformed/domain reply refuses before memory',()=>{
 for(let i=0;i<7;i++){const r=expected();r[i]=(r[i]^1)>>>0;const m=mock(r);assert.throws(()=>m.callbacks.fusedMemory(Uint32Array.of(1,2),3,0x400,2,Uint8Array.of(1,2),expected()));assert.equal(m.writes.length,0);assert.equal(m.events.length,1);}
 for(const reply of [Array.from(expected()),new Uint16Array(7),new Uint32Array(6),new Uint32Array(8),new Uint32Array(new ArrayBuffer(32),4,7)]){const m=mock(reply);assert.throws(()=>m.callbacks.fusedMemory(Uint32Array.of(1),3,0x400,2,null,expected()));assert.equal(m.events.length,1);}
 for(const r of [Uint32Array.from([1,1,10,0,0,0,1]),Uint32Array.from([1,1,10,0,6001,0,1]),Uint32Array.from([1,1,10,6006,6000,0,1]),Uint32Array.from([1,1,11,6,6000,0,1]),Uint32Array.from([1,1,10,6,6000,0,2])])assert.throws(()=>validateMemoryReply(r,r));
});
test('real composite preserves clock-before-effect and independently captured operand/expected/reply',()=>{
 const want=expected(),operand=Uint8Array.of(1,2),reply=expected();const m=mock(reply,()=>{want[0]=123;operand[0]=99;});
 const out=m.callbacks.fusedMemory(Uint32Array.of(1,2),3,0x400,2,operand,want);
 assert.deepEqual(m.events,[['clock',[1,2],3],['write',0x400,[1,2]]]);assert.deepEqual([...out.clock],[1,1,10,6,6000,0,1]);assert.equal(reply[0],99);assert.notEqual(out.clock.buffer,reply.buffer);assert.deepEqual([...out.memory.bytes],[1,2]);
 const r=mock();r.callbacks.fusedMemory(Uint32Array.of(1,2),3,0x400,2,null,expected());assert.deepEqual(r.events,[['clock',[1,2],3],['read',0x400,2]]);
});
test('empty tape/non-MEMORY/reentry/clock exceptions do not reach memory',()=>{
 const m=mock();for(const words of [new Uint32Array(),new Uint32Array(901)])assert.throws(()=>m.callbacks.fusedMemory(words,3,0x400,2,null,expected()));
 for(const reason of [1,2,4,5,6,7,8,9,10,11])assert.throws(()=>m.callbacks.fusedMemory(Uint32Array.of(1),reason,0x400,2,null,expected()));assert.deepEqual(m.events,[]);
 let reentrant;reentrant=mock(expected(),()=>reentrant.callbacks.fusedMemory(Uint32Array.of(1),3,0x400,2,null,expected()));assert.throws(()=>reentrant.callbacks.fusedMemory(Uint32Array.of(1),3,0x400,2,null,expected()));assert.equal(reentrant.events.length,1);
 const throws=mock(expected(),()=>{throw Error('clock failure');});assert.throws(()=>throws.callbacks.fusedMemory(Uint32Array.of(1),3,0x400,2,null,expected()));assert.equal(throws.events.length,1);
});
test('complete exact inverses bind unchanged runtime barriers and five typed export slots',()=>{
 for(const [d,h] of [[deriveMemoryFusionRuntime(),HELD_RUNTIME_SHA],[deriveMemoryFusionNapi(),HELD_NAPI_SHA]]){let s=d.bytes.toString();for(const e of [...d.edits].reverse())s=replacement(s,e.next,e.old,'control inverse '+e.label);assert.equal(sha256(s),h);}
});

test('exact production C preflight refuses missing callback before effect; bridge helper syntax compiles',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cold-memory-fusion-control-'));
 try{
  const preflight=readFileSync(new URL('../scripts/bochs-cpu3-native-cold-memory-fusion/preflight.inc',import.meta.url),'utf8');
  const program='#include <cstdint>\n#include <cassert>\n'+preflight+String.raw`
int main(){
 unsigned effects=0;
 auto attempt=[&](bool clock,bool run,bool init,bool pending,uint64_t n,uint64_t ticks,uint64_t q,uint64_t quanta){if(!bw_fusion_preflight(clock,run,init,pending,n,ticks,q,quanta))return false;++effects;return true;};
 assert(!attempt(false,true,true,false,1,1,1,1));assert(effects==0);
 assert(!attempt(true,false,true,false,1,1,1,1));assert(!attempt(true,true,false,false,1,1,1,1));assert(!attempt(true,true,true,true,1,1,1,1));assert(!attempt(true,true,true,false,2,1,1,1));assert(!attempt(true,true,true,false,1,1,2,1));assert(effects==0);
 assert(attempt(true,true,true,false,1,1,1,1));assert(effects==1);
}
`;
  writeFileSync(join(dir,'preflight.cc'),program);
  const compile=spawnSync('g++',['-std=c++17','-O2',join(dir,'preflight.cc'),'-o',join(dir,'preflight')],{encoding:'utf8',timeout:10000});assert.equal(compile.status,0,compile.stderr);const run=spawnSync(join(dir,'preflight'),[],{encoding:'utf8',timeout:1000});assert.equal(run.status,0,run.stderr);
  const generated=deriveMemoryFusionNapi().bytes.toString();
  const start=generated.indexOf('/* Only the authenticated private fusedMemory provider'),end=generated.indexOf('int page(void*',start);assert.ok(start>=0&&end>start);const bridge=generated.slice(start,end);
  const mock=String.raw`#include <cstdint>
#include <cstddef>
#include <cstring>
#include <thread>
using napi_value=void*;using napi_handle_scope=void*;using napi_typedarray_type=int;using napi_status=int;
constexpr int napi_uint32_array=1,BW_OWNED_MEMORY=3;
struct bw_owned_clock_state{uint32_t n,q,cycles,debt,deadline,epoch,a20;};struct bw_direct_metadata{};
void *env;bool busy;std::thread::id owner;uint64_t fusion_memory_entries[3]={};
bool ok(napi_status);napi_value number(uint32_t);napi_value copied(const uint8_t*,size_t);bool get(napi_value,const char*,napi_value*);bool bytes(napi_value,uint8_t**,size_t*);bool metadata(napi_value,bw_direct_metadata*);bool call(const char*,size_t,napi_value*,napi_value*);
napi_status napi_create_arraybuffer(...);napi_status napi_create_typedarray(...);napi_status napi_open_handle_scope(...);napi_status napi_close_handle_scope(...);napi_status napi_get_null(...);napi_status napi_get_typedarray_info(...);napi_status napi_is_arraybuffer(...);napi_status napi_is_detached_arraybuffer(...);napi_status napi_get_arraybuffer_info(...);
`;
  writeFileSync(join(dir,'bridge.cc'),mock+bridge);
  const syntax=spawnSync('g++',['-std=c++17','-fsyntax-only',join(dir,'bridge.cc')],{encoding:'utf8',timeout:10000});assert.equal(syntax.status,0,syntax.stderr);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
