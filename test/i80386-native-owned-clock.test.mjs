import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {deriveOwnedRuntime,heldRuntimeSha256} from '../scripts/bochs-cpu3-native-owned-clock/runtime.mjs';
import {deriveOwnedNapi,heldNapiSha256} from '../scripts/bochs-cpu3-native-owned-clock/napi.mjs';
import {authenticated,replacement,sha256} from '../scripts/bochs-cpu3-native-owned-clock/derive.mjs';
import {createOwnedProvider} from '../scripts/bochs-cpu3-native-owned-clock/provider.mjs';
import {loadOwnedNative} from '../scripts/bochs-cpu3-native-owned-clock/loader.mjs';
const setup=()=>{const p=createOwnedProvider();assert.deepEqual([...p.callbacks.clockTransfer(new Uint32Array(),1)],[0,0,4,0,6000,0,1]);return p;};
const begin=p=>{p.stage();p.begin();p.callbacks.clockTransfer(new Uint32Array(),2);};
for(const [name,derive,base] of [['runtime',deriveOwnedRuntime,heldRuntimeSha256],['NAPI',deriveOwnedNapi,heldNapiSha256]])test(name+' exact inverse and modified anchor refusal',()=>{
 const d=derive();let inverse=d.bytes.toString();for(const e of [...d.edits].reverse())inverse=replacement(inverse,e.next,e.old,e.label);assert.equal(sha256(inverse),base);
 const e=d.edits[0];assert.throws(()=>replacement(inverse+e.old,e.old,e.next,e.label));assert.throws(()=>authenticated(d.bytes,base,'mutated base'));
});
test('fault N without Q and independent REP Q expansion',()=>{const seen=[],p=createOwnedProvider({compactSink:e=>seen.push([e.operation,e.args,e.nativeTicks,e.successfulQuanta,e.boardCycles,e.debt])});p.callbacks.clockTransfer(new Uint32Array(),1);begin(p);assert.deepEqual([...p.callbacks.clockTransfer(Uint32Array.of(1,3,3,1,2,1),11)],[3,3,22,18,6000,0,1]);assert.deepEqual(seen.map(e=>e[0]),['nativeTick','quantum','quantum','nativeTick','quantum','nativeTick']);assert.deepEqual(seen.map(e=>e.slice(2)),[[1,0,4,0],[1,1,10,6],[1,2,16,12],[2,2,16,12],[2,3,22,18],[3,3,22,18]]);p.end();p.close();});
for(const [label,word] of [['zero',0],['unknown',4],['large',0xffffffff]])test('whole tape malformed '+label+' denies before earlier effects',()=>{const p=setup();begin(p);assert.throws(()=>p.callbacks.clockTransfer(Uint32Array.of(1,2,word),11));assert.deepEqual([...p.callbacks.clockTransfer(Uint32Array.of(1),11)].slice(0,3),[1,0,4]);p.end();p.close();});
for(const reason of [2,6,11])test('reset wrong query phase '+reason,()=>{const p=createOwnedProvider();assert.throws(()=>p.callbacks.clockTransfer(new Uint32Array(),reason));});
for(const reason of [1,2,6,11])test('active wrong or repeated query '+reason,()=>{const p=setup();begin(p);assert.throws(()=>p.callbacks.clockTransfer(new Uint32Array(),reason));p.end();p.close();});
test('independent N cap without Q and failed tape leaves counters unchanged',()=>{const p=setup();begin(p);p.callbacks.clockTransfer(new Uint32Array(600).fill(1),11);assert.throws(()=>p.callbacks.clockTransfer(Uint32Array.of(1),11));p.end();p.close();});
test('independent Q cap without N and failed tape leaves counters unchanged',()=>{const p=setup();begin(p);p.callbacks.clockTransfer(new Uint32Array(300).fill(3),11);assert.throws(()=>p.callbacks.clockTransfer(Uint32Array.of(3),11));p.end();p.close();});
test('offset backing refuses before effects',()=>{const p=setup();begin(p);assert.throws(()=>p.callbacks.clockTransfer(new Uint32Array(new ArrayBuffer(8),4,1),11));p.end();p.close();});
test('shared backing refuses before effects',()=>{const p=setup();begin(p);assert.throws(()=>p.callbacks.clockTransfer(new Uint32Array(new SharedArrayBuffer(4)),11));p.end();p.close();});
test('capture off still ordered logical state/caps',()=>{const p=setup();begin(p);assert.deepEqual([...p.callbacks.clockTransfer(Uint32Array.of(1,2),11)],[1,1,10,6,6000,0,1]);p.end();assert.equal(p.checkpoint().nativeTicks,1);p.close();});
test('PIO actual catchup and one post-query with unchanged cumulative clocks',()=>{const p=setup();begin(p);p.callbacks.clockTransfer(Uint32Array.of(1,2),5);assert.deepEqual([...p.callbacks.packedScalar(3,0x43,1,0x34)],[0,0,1]);const s=[...p.callbacks.clockTransfer(new Uint32Array(),6)];assert.deepEqual(s.slice(0,4),[1,1,10,0]);assert.throws(()=>p.callbacks.clockTransfer(new Uint32Array(),6));p.callbacks.clockTransfer(Uint32Array.of(1,2),11);p.end();p.close();});
test('pending PIO query denies clocks and second PIO',()=>{const p=setup();begin(p);p.callbacks.packedScalar(3,0x43,1,0x34);assert.throws(()=>p.callbacks.clockTransfer(Uint32Array.of(1),11));assert.throws(()=>p.callbacks.packedScalar(3,0x43,1,0x34));p.callbacks.clockTransfer(new Uint32Array(),6);p.end();p.close();});
test('lease denies inspect/end-before-entry and callback after end',()=>{const p=setup();p.stage();p.begin();assert.throws(()=>p.end());assert.throws(()=>p.checkpoint());p.callbacks.clockTransfer(new Uint32Array(),2);p.end();assert.throws(()=>p.callbacks.readPhysical(0x500,1));p.close();});
test('compact sink cannot reenter private transfer',()=>{let p,rejected=false;p=createOwnedProvider({compactSink:()=>{assert.throws(()=>p.callbacks.clockTransfer(Uint32Array.of(1),11));rejected=true;}});p.callbacks.clockTransfer(new Uint32Array(),1);begin(p);p.callbacks.clockTransfer(Uint32Array.of(1),11);assert.ok(rejected);p.end();p.close();});
test('ABI3 loader refuses main-thread before any artifact read',()=>{assert.throws(()=>loadOwnedNative('/does-not-exist.node','0'.repeat(64)),/initializing worker/);});
test('ABI2 generic tracked implementations remain untouched by derived outputs',()=>{const header=readFileSync(new URL('../scripts/bochs-cpu3-native-direct-board/abi.h',import.meta.url),'utf8');assert.match(header,/#define BW_DIRECT_ABI_VERSION 2/);assert.match(readFileSync(new URL('../scripts/bochs-cpu3-native-direct-board-adapter/loader.mjs',import.meta.url),'utf8'),/if\(!isMainThread\)/);});
test('A20 pending mapping permits only ordinary Q before more work',()=>{const p=setup();begin(p);p.callbacks.packedScalar(3,0x64,1,0xd1);p.callbacks.clockTransfer(new Uint32Array(),6);p.callbacks.packedScalar(3,0x60,1,1);const s=[...p.callbacks.clockTransfer(new Uint32Array(),6)];assert.deepEqual(s.slice(5),[1,0]);assert.throws(()=>p.callbacks.clockTransfer(Uint32Array.of(1),11));assert.throws(()=>p.callbacks.clockTransfer(Uint32Array.of(3),11));assert.throws(()=>p.callbacks.readPhysical(0x500,1));assert.throws(()=>p.callbacks.admitExecutePage(0xf0000));assert.throws(()=>p.callbacks.packedScalar(4,0,0,0));p.callbacks.clockTransfer(Uint32Array.of(2,1),11);p.end();p.close();});
test('actual frozen identity resolves clean checkout assets and refuses dirty checkouts',async()=>{
 // CI dependency/firmware setup may dirty the caller checkout. Admission still
 // requires a clean tree, so exercise the real function in an isolated HEAD.
 const root=fileURLToPath(new URL('../',import.meta.url));
 const temporary=mkdtempSync(join(tmpdir(),'owned-clock-frozen-identity-'));
 const checkout=join(temporary,'checkout');let added=false;
 try{
  execFileSync('git',['worktree','add','--detach',checkout,'HEAD'],{cwd:root,stdio:'pipe'});added=true;
  const {sourceIdentity}=await import(pathToFileURL(join(checkout,'scripts/bochs-cpu3-native-owned-clock/identity.mjs')).href);
  const identity=sourceIdentity();
  assert.equal(identity.revision,execFileSync('git',['rev-parse','HEAD'],{cwd:checkout,encoding:'utf8'}).trim());
  for(const p of ['scripts/bochs-cpu3-native-owned-clock/abi.h','scripts/bochs-cpu3-native-direct-board/runtime.inc','scripts/bochs-cpu3-native-direct-board/runtime.h','scripts/bochs-cpu3-native-direct-board/addon.mk','scripts/bochs-cpu3-native-direct-board-adapter/napi.cc','test/fixtures/i80386-free-combined-paging-ram.S'])assert.match(identity.hashes[p],/^[a-f0-9]{64}$/);
  const packagePath=join(checkout,'package.json'),original=readFileSync(packagePath);
  writeFileSync(packagePath,Buffer.concat([original,Buffer.from('\n')]));
  assert.throws(()=>sourceIdentity(),/frozen clean source/);
  writeFileSync(packagePath,original);
  const untracked=join(checkout,'unexpected-identity-input');writeFileSync(untracked,'untracked fixture');
  assert.throws(()=>sourceIdentity(),/frozen clean source/);rmSync(untracked);
  assert.deepEqual(sourceIdentity(),identity);
 }finally{
  if(added)execFileSync('git',['worktree','remove','--force',checkout],{cwd:root,stdio:'pipe'});
  rmSync(temporary,{recursive:true,force:true});
 }
});
