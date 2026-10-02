import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deriveOwnedIn8Runtime} from '../scripts/bochs-cpu3-native-owned-in8/runtime.mjs';
import {deriveOwnedIn8Napi} from '../scripts/bochs-cpu3-native-owned-in8/napi.mjs';
import {createOwnedIn8Provider} from '../scripts/bochs-cpu3-native-owned-in8/provider.mjs';
import {assembleOwnedIn8Rom,in8Witness} from '../scripts/i80386-free-owned-in8.mjs';
import {assembleCombinedHotRom} from '../scripts/i80386-free-combined-hot.mjs';
import {validateBaseline,validateInput} from '../scripts/bochs-cpu3-native-owned-in8/admission.mjs';
import {combinedBoardConfig} from '../scripts/bochs-cpu3-native-combined-paging-ram/host.mjs';
const empty=()=>new Uint32Array();
function owner(sink=null){const p=createOwnedIn8Provider({compactSink:sink});p.callbacks.clockTransfer(empty(),1);p.begin();p.callbacks.clockTransfer(empty(),2);return p;}
function out(p,port,value){p.callbacks.packedScalar(3,port,1,value);p.callbacks.clockTransfer(empty(),6);}
function input(p,port=0x40){const r=p.callbacks.packedScalar(5,port,1,0);p.callbacks.clockTransfer(empty(),6);return r;}
test('distinct ABI4 and exact source inverse seams',()=>{
 const runtime=deriveOwnedIn8Runtime(),napi=deriveOwnedIn8Napi();assert.equal(runtime.edits.length,4);assert.equal(napi.edits.length,3);
 assert.match(readFileSync(new URL('../scripts/bochs-cpu3-native-owned-in8/abi.h',import.meta.url),'utf8'),/#define BW_DIRECT_ABI_VERSION 4/);
 assert.match(runtime.bytes.toString(),/BW_TRACE\("BWSD1\\tPORT\\tin\\t/);
 assert.ok(!runtime.bytes.toString().includes('BWSD1\\\\tPORT\\\\tin'));
 const s=runtime.bytes.toString(),a=s.indexOf('static int bw_host_in('),b=s.indexOf('static int bw_host_out(',a),body=s.slice(a,b);
 for(const [first,last] of [['width!=1','BW_OWNED_PRE_PIO'],['bw_mapping_pending','BW_OWNED_PRE_PIO'],['BW_OWNED_PRE_PIO','BW_DIRECT_PIO_IN8'],['BW_DIRECT_PIO_IN8','BW_OWNED_POST_PIO'],['BW_OWNED_POST_PIO','*value=byte']])assert.ok(body.indexOf(first)<body.indexOf(last));
 assert.ok(napi.bytes.toString().indexOf('b!=1')<napi.bytes.toString().indexOf('napi_value args[4]'));
});
test('new fixture is a separate exact bounded hot derivative',()=>{
 const r=assembleOwnedIn8Rom();assert.equal(r.sha256,'25c242668fb1e0cbf940a35045a5e1173d992232766a4cbdb6a369ef3929a939');
 assert.equal(assembleCombinedHotRom().sha256,'0c020faecb76160cfc748ca909d498a69ae47dd19a365891ccb20b3b5186b631');assert.deepEqual(in8Witness.addresses,[0x590,0x591]);
 assert.ok(r.disassembly.includes('in     $0x40,%al'));
});
test('actual PIT latch low/high reads consume phase and preserve clock/mapping ledgers',()=>{
 const events=[],p=owner(e=>events.push(e));out(p,0x43,0x34);out(p,0x40,0x34);out(p,0x40,0x12);
 p.callbacks.clockTransfer(Uint32Array.of(1,2),5);out(p,0x43,0);
 p.end();const before=p.checkpoint(),c=before.board.pit.counters[0];assert.equal(c.rwPhase,0);assert.notEqual(c.latched,null);
 p.begin();p.callbacks.clockTransfer(empty(),2);const lo=input(p);p.end();const middle=p.checkpoint();assert.equal(middle.board.pit.counters[0].rwPhase,1);assert.equal(middle.board.pit.counters[0].latched,c.latched);
 p.begin();p.callbacks.clockTransfer(empty(),2);const hi=input(p);p.end();const after=p.checkpoint();assert.equal(after.board.pit.counters[0].rwPhase,0);assert.equal(after.board.pit.counters[0].latched,null);assert.equal(lo[0]+256*hi[0],c.latched);
 for(const state of [middle,after]){assert.equal(state.nativeTicks,before.nativeTicks);assert.equal(state.successfulQuanta,before.successfulQuanta);assert.equal(state.mappingEpoch,before.mappingEpoch);}
 assert.deepEqual(events.filter(e=>e.operation==='inPort').map(e=>e.args),[[0x40,1],[0x40,1]]);p.close();
});
for(const [label,args] of [['wide',[5,0x40,2,0]],['port',[5,0x64,1,0]],['operand',[5,0x40,1,1]],['fraction',[5,64.5,1,0]]])test('IN rejects '+label+' before device event',()=>{const events=[],p=owner(e=>events.push(e));assert.throws(()=>p.callbacks.packedScalar(...args));assert.equal(events.length,0);p.end();p.close();});
for(const port of [0x21,0xa1])test('PIC data '+port+' denies armed poll without PIC read effect',()=>{const p=owner();out(p,port===0x21?0x20:0xa0,0x0c);p.end();const before=p.checkpoint();p.begin();p.callbacks.clockTransfer(empty(),2);assert.throws(()=>p.callbacks.packedScalar(5,port,1,0),/no poll/);p.end();assert.deepEqual(p.checkpoint(),before);p.close();});
test('IN requires post-PIO query and closed callback lease',()=>{const p=owner();input(p);p.callbacks.packedScalar(5,0x40,1,0);assert.throws(()=>p.callbacks.packedScalar(5,0x40,1,0));assert.throws(()=>p.end());p.callbacks.clockTransfer(empty(),6);p.end();assert.throws(()=>p.callbacks.packedScalar(5,0x40,1,0));p.close();});
test('sink exception keeps prior read effect and releases active guard',()=>{let armed=false;const p=owner(e=>{if(armed&&e.operation==='inPort')throw Error('sink');});out(p,0x43,0x34);out(p,0x40,0x34);out(p,0x40,0x12);out(p,0x43,0);armed=true;assert.throws(()=>p.callbacks.packedScalar(5,0x40,1,0),/sink/);p.end();assert.equal(p.checkpoint().board.pit.counters[0].rwPhase,1);p.close();});
for(const port of [0x21,0xa1])test('unarmed PIC data read '+port+' returns byte without clocks',()=>{const p=owner();p.end();const before=p.checkpoint();p.begin();p.callbacks.clockTransfer(empty(),2);const r=input(p,port);assert.ok(r instanceof Uint32Array&&r.length===3);assert.equal(r[0],before.board[port===0x21?'pic1':'pic2'].imr);p.end();const s=p.checkpoint();assert.equal(s.nativeTicks,0);assert.equal(s.successfulQuanta,0);p.close();});
test('IN event sink reentry is denied after exactly one device read',()=>{let p,seen=0;p=owner(e=>{if(e.operation==='inPort'){seen++;assert.throws(()=>p.callbacks.packedScalar(5,0x40,1,0),/lease/);}});out(p,0x43,0x34);out(p,0x40,0x34);out(p,0x40,0x12);out(p,0x43,0);input(p);p.end();assert.equal(seen,1);assert.equal(p.checkpoint().board.pit.counters[0].rwPhase,1);p.close();});
test('mapping publication must precede IN',()=>{const p=owner();out(p,0x64,0xd1);out(p,0x60,1);assert.throws(()=>p.callbacks.packedScalar(5,0x40,1,0),/lease/);p.callbacks.clockTransfer(Uint32Array.of(2),5);input(p);p.end();assert.equal(p.checkpoint().mappingEpoch,1);p.close();});
const baseline=()=>({schema:'bw.js-owned-in8.baseline.v1',configuration:structuredClone(combinedBoardConfig),rom:{sha256:'25c242668fb1e0cbf940a35045a5e1173d992232766a4cbdb6a369ef3929a939'},halted:true,attempts:10,q:9,final:{memorySha256:'a'.repeat(64),in8Witness:[1,2]},boundaries:Object.fromEntries(['hot_profile_start','hot_register_loop','hot_register_end','hot_memory_loop','hot_memory_end','terminal_hlt'].map((name,i)=>[name,{q:i+1,cpu:{eip:256+i,cs:8}}]))});
test('baseline admits only bounded IN8 profile before native loading',()=>assert.equal(validateBaseline(baseline()).length,6));
for(const [label,mutate] of [['ROM',b=>b.rom.sha256='0'.repeat(64)],['halt',b=>b.halted=false],['N',b=>b.attempts=160001],['Q',b=>b.q=NaN],['RAM',b=>b.final.memorySha256='x'],['witness',b=>b.final.in8Witness=[1,256]],['cut',b=>b.boundaries.terminal_hlt.q=1],['EIP',b=>b.boundaries.terminal_hlt.cpu.eip=-1],['CS',b=>b.boundaries.terminal_hlt.cpu.cs=65536],['name',b=>{b.boundaries.wrong=b.boundaries.terminal_hlt;delete b.boundaries.terminal_hlt;}]])test('baseline rejects '+label,()=>{const b=baseline();mutate(b);assert.throws(()=>validateBaseline(b));});

test('input pins actual historical JS reference SHA before addon read',()=>{const v=Object.fromEntries(['addon','configuration','baseline','output','preparedManifest','buildReceipt'].map(k=>[k,'/not-read']));Object.assign(v,{sha256:'a'.repeat(64),preparedManifestSha256:'b'.repeat(64),buildReceiptSha256:'c'.repeat(64),baselineSha256:'bf026d23f0c51d63a9744dc4facb4d58809c50f1d35747ffc6ea5873b518e45e',hostJournal:false,nativeTrace:false});assert.equal(validateInput(v),v);assert.throws(()=>validateInput({...v,baselineSha256:'0'.repeat(64)}));});

test('native initializer admits exactly the actual assembled IN8 ROM before lifetime/bootstrap/query',()=>{const text=deriveOwnedIn8Runtime().bytes.toString(),start=text.indexOf('extern "C" int bw_direct_initialize('),end=text.indexOf('extern "C" int bw_direct_resume(',start),body=text.slice(start,end),expected=assembleOwnedIn8Rom().sha256;assert.ok(start>=0&&end>start);const match=body.match(/if\(strcmp\(sha,"([a-f0-9]{64})"\)\)return 0;/);assert.equal(match?.[1],expected);assert.ok(!body.includes('0c020faecb76160cfc748ca909d498a69ae47dd19a365891ccb20b3b5186b631'));assert.ok(body.indexOf('if(strcmp(sha,')<body.indexOf('compare_exchange_strong'));assert.ok(body.indexOf('compare_exchange_strong')<body.indexOf('bw_direct_bootstrap'));assert.ok(body.indexOf('bw_direct_bootstrap')<body.indexOf('BW_OWNED_INIT'));});

import {ramResetEvidence,validateResetWitness,canonicalRamSha256} from '../scripts/bochs-cpu3-native-owned-in8/reset-witness.mjs';
test('reset witnesses require exact raw profile and own CPU reset',()=>{const e={resetWitness:[0,0,0,0,240,255,255,127],ramCanonicalSha256:canonicalRamSha256};validateResetWitness(e,{edx:0,cr0:0x7ffffff0},'native');assert.throws(()=>validateResetWitness({...e,resetWitness:[0,3,0,0,240,255,255,127]},{edx:0,cr0:0x7ffffff0},'native'));assert.throws(()=>validateResetWitness(e,{edx:0x300,cr0:0},'native'));validateResetWitness({resetWitness:[0,3,0,0,0,0,0,0],ramCanonicalSha256:canonicalRamSha256},{edx:0x300,cr0:0},'javascript');});
test('canonical RAM changes only inside exact eight-byte witness range',()=>{const mem=new Uint8Array(16*1024*1024),before=ramResetEvidence(mem).ramCanonicalSha256;mem.fill(255,0x510,0x518);assert.equal(ramResetEvidence(mem).ramCanonicalSha256,before);for(const address of [0x50f,0x518,0x590,mem.length-1]){mem[address]=1;assert.notEqual(ramResetEvidence(mem).ramCanonicalSha256,before);assert.throws(()=>validateResetWitness({resetWitness:[0,0,0,0,240,255,255,127],ramCanonicalSha256:ramResetEvidence(mem).ramCanonicalSha256},{edx:0,cr0:0x7ffffff0},'native'));mem[address]=0;}});

import {validateCpuProfile} from '../scripts/bochs-cpu3-native-owned-in8/reset-witness.mjs';
test('CPU profile comparison retains exact raw EDX and CR0 and denies semantic changes',()=>{const state=new Array(20).fill(0),js={eax:0,ecx:0,edx:0x300,ebx:0,esp:0,eip:0,cr0:0x80000011,cr2:0,cr3:0,cs:0};state[10]=0xfffffff1;validateCpuProfile(state,js);for(const bit of [0,1,2,3,4,31]){const bad=[...state];bad[10]=(bad[10]^(2**bit))>>>0;assert.throws(()=>validateCpuProfile(bad,js));}assert.throws(()=>validateCpuProfile(state,{...js,edx:0}));assert.throws(()=>validateCpuProfile(state,{...js,cr0:0xfffffff1}));state[10]=0x7ffffff0;validateCpuProfile(state,{...js,cr0:0},true);});
