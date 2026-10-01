import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import test from 'node:test';
import {assertNativeColdResetProof,parseColdNativeLog} from '../scripts/bochs-cpu3-native-cold-reset-compare.mjs';
import {assembleColdResetRom} from '../scripts/i80386-cold-reset-oracle.mjs';

// Actual initial source-bound four-arm capture, retained as historical mutation
// input. Final qualification uses a fresh capture after these tests are committed.
const actualSha256='5577869f34e00ecac0742d930321b94f0c0e33e9db3bc3a353b416c65a416683';
const actualRevision='dbc638038482c47c0b1924b43e24ea49adddc447';
const bytes=gunzipSync(readFileSync(new URL('./fixtures/i80386-native-cold-reset-capture.json.gz',import.meta.url)));
assert.equal(createHash('sha256').update(bytes).digest('hex'),actualSha256);
const capture=JSON.parse(bytes);
const {rom}=assembleColdResetRom();
const names=['continuous','budget1','budget2','budget257'];
const each=(report,change)=>names.forEach(name=>change(report.arms[name]));
// Change the physical native record and rebuild ALL derived native mirrors.
// This tests semantic rejection rather than an accidental summary inconsistency.
function nativeRecord(arm,tag,change,predicate=()=>true){
  const records=structuredClone(arm.native.records);
  const row=records.find(r=>r.tag===tag&&predicate(r.fields));
  assert(row,`${tag} mutation witness missing`);
  change(row.fields);
  arm.raw.stderr=records.map(r=>['BWS9',r.tag,...r.fields].join('\t')).join('\n')+'\n';
  arm.native=parseColdNativeLog(arm.raw.stderr);
  arm.artifacts.files.stderr.sha256=createHash('sha256').update(arm.raw.stderr).digest('hex');
}
const zeroDigest='0'.repeat(64);

test('actual historical four-arm capture proves bounded cold entry and board ownership',()=>{
  assert.equal(capture.source.boardRevision,actualRevision);
  const proof=assertNativeColdResetProof(capture,rom);
  assert.equal(proof.status,'native-cold-entry-actual-board-proof-pass');
  assert.equal(proof.nativeTicks,49);assert.equal(proof.successfulQuanta,49);
  assert.equal(proof.boardCycles,298);assert.equal(proof.instructionBytes,143);
  assert.equal(proof.architecturalResetParity,false);
});

const mutations=[
  ['missing native execution rejection',r=>{delete r.probes['unsafe-execute-ram'];}],
  ['missing transport digest rejection',r=>{delete r.transportProbes['page-digest'];}],
  ['guard exit is not SIGABRT',r=>{r.probes['unsafe-execute-mmio'].exit.signal='SIGTERM';}],
  ['wrong named native failure',r=>{r.probes['unknown-trap'].observedFailure='host-port-out';}],
  ['qualified binary replaced by valid digest',r=>{r.source.binarySha256=zeroDigest;}],
  ['compiled runtime replaced by valid digest',r=>{r.source.runtimeSha256=zeroDigest;}],
  ['ROM binary identity changed',r=>{r.source.romSha256=zeroDigest;}],
  ['free fixture identity changed',r=>{r.source.fixtureSha256=zeroDigest;}],
  ['committed host source identity changed',r=>{r.source.sourceHashes['scripts/bochs-cpu3-native-cold-reset-host.mjs']=zeroDigest;}],
  ['missing transitive PIT source',r=>{delete r.source.sourceHashes['src/i8254.js'];}],
  ['hardware reset source altered',r=>{r.source.patchedHashes['bochs/cpu/init.cc']=zeroDigest;}],
  ['reset differences silently masked',r=>{r.resetDifferences.comparisonMasks={cr0:0};}],
  ['architectural parity claim substituted',r=>{r.claim='architectural-reset-parity';}],
  ['missing bounded arm',r=>{delete r.arms.budget257;}],
  ['quantum budget substituted',r=>{r.arms.budget1.requestedBudget=2;}],
  ['initial board reset debt altered',r=>each(r,a=>{a.host.reset={};})],
  ['terminal board settlement altered',r=>each(r,a=>{a.host.final={};})],
  ['native fallback witness empty',r=>each(r,a=>{a.native.fallback={};})],
  ['raw fallback detects private RAM use',r=>each(r,a=>nativeRecord(a,'FALLBACK',p=>{p[0]='1';}))],
  ['raw callback count altered',r=>each(r,a=>nativeRecord(a,'CALLBACKS',p=>{p[0]=String(Number(p[0])+1);}))],
  ['native hardware reset EDX masked',r=>each(r,a=>nativeRecord(a,'RESET',p=>{p[2]='00000300';}))],
  ['native hardware reset CR0 masked',r=>each(r,a=>nativeRecord(a,'RESET',p=>{p[10]='00000000';}))],
  ['native CS reset type masked',r=>each(r,a=>nativeRecord(a,'RESET_EXTRA',p=>{p[12]='10';}))],
  ['native LDTR present attribute masked',r=>each(r,a=>nativeRecord(a,'RESET_SYS',p=>{p[6]='0';},p=>p[0]==='6'))],
  ['native debug reset altered',r=>each(r,a=>nativeRecord(a,'RESET_DR',p=>{p[4]='00000000';}))],
  ['first physical prefetch loses reset alias',r=>each(r,a=>nativeRecord(a,'PREFETCH',p=>{p[0]='000ffff0';}))],
  ['instruction byte evidence altered',r=>each(r,a=>nativeRecord(a,'ATTEMPT',p=>{p[7]=(p[7].startsWith('00')?'01':'00')+p[7].slice(2);}))],
  ['page digest substituted',r=>each(r,a=>nativeRecord(a,'RPC_PAGE',p=>{p[4]=zeroDigest;}))],
  ['ROM page generation changed',r=>each(r,a=>nativeRecord(a,'RPC_PAGE',p=>{p[2]='1';}))],
  ['execute cache admits RAM class',r=>each(r,a=>nativeRecord(a,'RPC_PAGE',p=>{p[3]='1';}))],
  ['page decoded reset alias altered',r=>each(r,a=>nativeRecord(a,'RPC_PAGE',p=>{p[1]='fffff000';}))],
  ['verified page payload altered',r=>each(r,a=>nativeRecord(a,'PAGE_CHUNK',p=>{p[2]=(p[2].startsWith('00')?'01':'00')+p[2].slice(2);}))],
  ['post-instruction ES changed',r=>each(r,a=>nativeRecord(a,'POST_EXTRA',p=>{p[2]='0001';}))],
  ['post-instruction EAX changed',r=>each(r,a=>nativeRecord(a,'POST_STATE',p=>{p[0]='deadbeef';}))],
  ['successful work double charged',r=>each(r,a=>nativeRecord(a,'QUANTUM',p=>{p[7]=String(Number(p[7])+1);}))],
  ['native tick counter loses instruction',r=>each(r,a=>nativeRecord(a,'NATIVE_TICK',p=>{p[2]=String(Number(p[2])+1);}))],
  ['memory decode altered',r=>each(r,a=>nativeRecord(a,'MEM',p=>{p[2]='00000600';}))],
  ['data byte changed',r=>each(r,a=>nativeRecord(a,'MEM',p=>{p[4]=(p[4]==='00'?'01':'00');}))],
  ['terminal halt IF enabled',r=>each(r,a=>nativeRecord(a,'HALT_IDLE',p=>{p[3]='512';}))],
];
for(const [name,mutate] of mutations)test(`rejects ${name}`,()=>{
  const changed=structuredClone(capture);
  // Include parse-time errors when corrupting canonical native evidence.
  assert.throws(()=>{mutate(changed);assertNativeColdResetProof(changed,rom);},/native cold reset proof/);
});
