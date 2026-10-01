import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import test from 'node:test';
import {assertNativeRamCoherenceProof,parseRamNativeLog} from '../scripts/bochs-cpu3-native-ram-coherence-compare.mjs';
import {assembleRamCoherenceRom} from '../scripts/i80386-ram-coherence-oracle.mjs';

// Exact actual, qualified initial four-arm capture. This historical mutation
// fixture precedes these tests; final qualification requires a fresh source
// freeze/capture. Earlier failed captures are not used as passing evidence.
const actualSha256='9df97fdd36d087bc576d3ee03e7a0bea0765fbae12028295dcba1017124d3793';
const actualRevision='ef2a73594948dffde48df000f5c6a6bf70662755';
const sha=value=>createHash('sha256').update(value).digest('hex');
const bytes=gunzipSync(readFileSync(new URL('./fixtures/i80386-native-ram-coherence-capture.json.gz',import.meta.url)));
assert.equal(sha(bytes),actualSha256);
const capture=JSON.parse(bytes),{rom}=assembleRamCoherenceRom();
const names=['continuous','budget1','budget2','budget257'];
const zeroDigest='0'.repeat(64);
const each=(r,change)=>names.forEach(name=>change(r.arms[name],name));
const ordinalFields={CMD:5,ATTEMPT:4,PREFETCH:3,RPC_REQ:8,RPC_REP:4,RPC_MEM:9,RPC_PAGE:8,RPC_PIO:6,
  COMMIT:8,ALIAS_UPDATE:7,COHERENCE:6,QUANTUM:9,NATIVE_TICK:4,MEM:7,EXEC:4,PORT:5,HALT_IDLE:6,
  POST_STATE:22,POST_EXTRA:22,POST_SEG:17,POST_SYS:17,POST_DR:8};
function rewriteNative(r,name,change,{renumber=false}={}){
  const arm=r.arms[name],records=structuredClone(arm.native.records);change(records);
  if(renumber){let ordinal=1;for(const row of records)if(Object.hasOwn(ordinalFields,row.tag))row.fields[ordinalFields[row.tag]]=String(ordinal++);}
  // Preserve non-native diagnostics. Replace the actual native row stream and
  // rebuild every derived mirror; both artifact objects are separate after
  // JSON parsing, so BOTH digests must change before semantic validation.
  let next=0;const lines=arm.raw.stderr.split('\n').flatMap(line=>{
    if(!line.startsWith('BWS10\t'))return [line];
    if(next>=records.length)return [];
    const row=records[next++];return [['BWS10',row.tag,...row.fields].join('\t')];
  });
  assert.equal(next,records.length,'mutation only deletes/reorders/changes existing native rows');
  arm.raw.stderr=lines.join('\n');arm.native=parseRamNativeLog(arm.raw.stderr);
  const digest=sha(arm.raw.stderr);
  arm.artifacts.files.stderr.sha256=digest;r.artifacts[name].files.stderr.sha256=digest;
  assert.deepEqual(arm.artifacts,r.artifacts[name],'mutation keeps complete artifact mirrors coherent');
}
function row(records,tag,predicate=()=>true){
  const selected=records.find(r=>r.tag===tag&&predicate(r.fields));assert(selected,`actual ${tag} mutation witness absent`);return selected;
}
const native=(r,tag,change,predicate)=>names.forEach(name=>rewriteNative(r,name,records=>change(row(records,tag,predicate).fields)));
function deleteNative(r,tag,predicate){
  names.forEach(name=>rewriteNative(r,name,records=>{
    const selected=row(records,tag,predicate);records.splice(records.indexOf(selected),1);
  },{renumber:true}));
}
function delayedCoherence(r){
  names.forEach(name=>rewriteNative(r,name,records=>{
    const selected=row(records,'COHERENCE',p=>p[0]==='write'&&p[3]==='0');
    const post=records.find(x=>x.tag==='POST_STATE'&&x.fields[21]===selected.fields[5]);assert(post);
    records.splice(records.indexOf(selected),1);records.splice(records.indexOf(post)+1,0,selected);
  },{renumber:true}));
}
function deleteDuplicateIdle(r){
  // Preserve plausible raw/final/cumulative counters after removing a real
  // duplicate. The fixed per-budget census must still reject this mutation.
  rewriteNative(r,'continuous',records=>{
    const selected=records.filter(x=>x.tag==='HALT_IDLE').at(-1);assert(selected);records.splice(records.indexOf(selected),1);
    let count=0;for(const item of records){if(item.tag==='HALT_IDLE')count++;if(item.tag==='SLICE')item.fields[22]=String(count);if(item.tag==='FINAL')item.fields[9]=String(count);}
  },{renumber:true});
}
function swappedCallWords(r){
  names.forEach(name=>rewriteNative(r,name,records=>{
    const words=records.filter(x=>x.tag==='MEM'&&x.fields[6]==='16');assert.equal(words.length,4);
    const values=words.map(x=>[...x.fields]);for(let i=0;i<4;i++){
      const ordinal=words[i].fields[7];words[i].fields=values[(i+2)%4];words[i].fields[7]=ordinal;
    }
  }));
}


function rewriteRpc(r,name,direction,change){
  const arm=r.arms[name],lines=[...arm.rpc[direction]];change(lines);arm.rpc[direction]=lines;
  const kind=direction==='fromNative'?'rpcFromNative':'rpcToNative';arm.raw[kind]=lines.join('\n')+'\n';
  arm.artifacts.files[kind].sha256=sha(arm.raw[kind]);r.artifacts[name].files[kind].sha256=sha(arm.raw[kind]);
}
function requestClockAttack(r){
  for(const name of names){
    rewriteRpc(r,name,'fromNative',lines=>{const at=lines.findIndex(x=>x.startsWith('BWR10\tREQ\t'));assert(at>0);const p=lines[at].split('\t');p[8]='1';lines[at]=p.join('\t');});
    rewriteNative(r,name,records=>{row(records,'RPC_REQ',p=>p[0]==='1').fields[6]='1';row(records,'RPC_PAGE',p=>p[0]==='1').fields[6]='1';});
  }
}
function completionBeforeRequest(r){
  for(const name of names)rewriteRpc(r,name,'fromNative',lines=>{
    const req=lines.findIndex(x=>x.startsWith('BWR10\tREQ\t')),done=lines.findIndex(x=>x.startsWith('BWR10\tDONE\t'));assert(req>0&&done>req);
    const completed=lines.splice(done,1)[0];lines.splice(req,0,completed);
  });
}

test('actual historical native capture proves bounded RAM SMC and actual board A20 coherence',()=>{
  assert.equal(capture.source.boardRevision,actualRevision);
  const proof=assertNativeRamCoherenceProof(capture,rom);
  assert.equal(proof.status,'native-ram-smc-a20-proof-pass');
  assert.deepEqual([proof.nativeTicks,proof.successfulQuanta,proof.boardCycles,proof.instructionBytes,proof.dataReadBytes,proof.dataWriteBytes,proof.pioBytes],[75,75,454,235,32,70,11]);
  assert.equal(proof.architecturalResetParity,false);assert.equal(proof.fullByteBusOrderParity,false);
  assert.equal(proof.nativeBudgetByteBusOrderParity,true);assert.equal(proof.farCallWordOrderDifferences,8);
  assert.equal(proof.actualBoardA20Transitions,2);assert.equal(proof.ramCacheCoherence,true);
  for(const name of names){
    const records=capture.arms[name].native.records;
    assert.deepEqual(['COMMIT','ALIAS_UPDATE','COHERENCE','RPC_PAGE','EXEC'].map(t=>records.filter(x=>x.tag===t).length),[31,4,25,8,70]);
  }
});

// Each expected diagnostic identifies the attacked semantic check. A generic
// artifact mirror rejection does not satisfy a coherence/CPU/bus mutation test.
const mutations=[
  ['missing bounded arm',r=>{delete r.arms.budget257;},/four actual native arms/],
  ['missing transitive PIT source',r=>{delete r.source.sourceHashes['src/i8254.js'];},/complete captured transitive source inventory/],
  ['measured native host bytes substituted',r=>{r.source.sourceHashes['scripts/bochs-cpu3-native-ram-coherence-host.mjs']=zeroDigest;},/actual committed measured source/],
  ['qualified native binary digest substituted',r=>{r.source.binarySha256=zeroDigest;},/audited native binarySha256/],
  ['compiled runtime digest substituted',r=>{r.source.runtimeSha256=zeroDigest;},/audited native runtimeSha256/],
  ['CPU config digest substituted',r=>{r.source.configSha256=zeroDigest;},/audited native configSha256/],
  ['patched native CPU byte pin omitted',r=>{delete r.source.patchedHashes['bochs/cpu/cpu.cc'];},/complete native source pins/],
  ['unchanged native reset source substituted',r=>{r.source.patchedHashes['bochs/cpu/init.cc']=zeroDigest;},/independently derived qualified native source pins/],
  ['guest ROM binary substituted',r=>{r.source.romSha256=zeroDigest;},/free ROM binary/],
  ['free guest assembly substituted',r=>{r.source.fixtureSha256=zeroDigest;},/free fixture source/],
  ['missing native guard',r=>{delete r.probes['execute-pending-write'];},/actual rejection probe set/],
  ['missing transport epoch rejection',r=>{delete r.transportProbes['page-epoch'];},/actual rejection probe set/],
  ['wrong guard signal',r=>{r.probes['unsafe-execute-mmio'].exit.signal='SIGTERM';},/native rejection exit/],
  ['wrong named guard failure',r=>{r.probes['unknown-trap'].observedFailure='host-port-out';},/named native FAIL witness/],
  ['transport was never injected',r=>{r.transportProbes['pio-epoch'].injected=false;},/actual transport injection reached/],
  ['raw stdout artifact digest disconnected',r=>{r.arms.continuous.raw.stdout+='counterfactual';},/arm actual raw artifact digest/],
  ['missing farCALL bus declaration',r=>{delete r.busDifferences;},/report shape/],
  ['full byte bus-order parity claimed',r=>{r.busDifferences.fullByteBusOrderParity=true;},/predeclared exact eight-site bus order differences/],
  ['broad permutation replaces narrow CALL scope',r=>{r.busDifferences.rule='all-instruction-memory-permutation';},/predeclared exact eight-site bus order differences/],
  ['unknown nonCALL site added to bus exception',r=>{r.busDifferences.instructionQuanta.push(13);},/predeclared exact eight-site bus order differences/],
  ['native CALL source pin removed',r=>{delete r.busDifferences.nativeSource.callSha256;},/predeclared exact eight-site bus order differences/],
  ['raw reset CR0 difference masked',r=>native(r,'RESET',p=>{p[10]='00000000';}),/predeclared raw reset differences/],
  ['raw reset debug register masked',r=>native(r,'RESET_DR',p=>{p[4]='00000000';}),/raw reset debug registers/],
  ['raw fallback private RAM use',r=>native(r,'FALLBACK',p=>{p[0]='1';}),/exact zero fallback evidence/],
  ['empty structured fallback',r=>each(r,a=>{a.native.fallback={};}),/raw stderr native parser binding/],
  ['raw physical callback census changed',r=>native(r,'CALLBACKS',p=>{p[0]=String(Number(p[0])+1);}),/raw physical callback summary/],
  ['first physical reset fetch alias lost',r=>native(r,'PREFETCH',p=>{p[0]='000ffff0';}),/prefetch witnesses CURRENT instruction physical address/],
  ['nonfirst prefetch clock shifted',r=>native(r,'PREFETCH',p=>{p[1]=String(Number(p[1])+1);},p=>p[1]!=='0'),/every raw native event owns current native clock/],
  ['nonfirst prefetch uses another real guest PC',r=>native(r,'PREFETCH',p=>{p[0]='000f0103';},p=>p[1]!=='0'),/prefetch witnesses CURRENT instruction physical address/],
  ['cached execute callback clock shifted',r=>native(r,'EXEC',p=>{p[3]=String(Number(p[3])+1);}),/every raw native event owns current native clock/],
  ['actual port callback native clock shifted',r=>native(r,'PORT',p=>{p[4]=String(Number(p[4])+1);}),/every raw native event owns current native clock/],
  ['raw RPC request has unowned clock tuple',requestClockAttack,/request clock tuple changed/],
  ['raw RPC DONE precedes its callback requests',completionBeforeRequest,/DONE disjoint clock ledger/],
  ['native CALL callback width differs from actual word request',r=>native(r,'RPC_REQ',p=>{p[3]='1';},p=>p[1]==='WRITE'&&p[2]==='36862'&&p[6]==='16'),/native request raw RPC mirror/],
  ['RAM page generation stale',r=>native(r,'RPC_PAGE',p=>{p[2]='0';},p=>p[3]==='1'),/verified native page metadata/],
  ['RAM page mapping epoch stale',r=>native(r,'RPC_PAGE',p=>{p[5]='0';},p=>p[5]==='1'),/verified native page metadata/],
  ['RAM page classified ROM',r=>native(r,'RPC_PAGE',p=>{p[3]='2';},p=>p[3]==='1'),/verified native page metadata/],
  ['verified RAM page chunk altered',r=>native(r,'PAGE_CHUNK',p=>{p[2]=(p[2].startsWith('00')?'01':'00')+p[2].slice(2);}),/all native verified page chunks/],
  ['memory acknowledgement generation stale',r=>native(r,'RPC_MEM',p=>{p[5]='0';},p=>p[3]==='2'),/typed native memory reply mirror/],
  ['memory acknowledgement mapping epoch stale',r=>native(r,'RPC_MEM',p=>{p[6]='0';},p=>p[6]==='1'),/typed native memory reply mirror/],
  ['PIO authoritative effective gate altered',r=>native(r,'RPC_PIO',p=>{p[2]='1';},p=>p[2]==='0'),/authoritative board mapping reply/],
  ['PIO authoritative epoch altered',r=>native(r,'RPC_PIO',p=>{p[3]='0';},p=>p[3]==='1'),/authoritative board mapping reply/],
  ['commit disagrees with acknowledged bytes',r=>native(r,'COMMIT',p=>{p[3]='2222';},p=>p[0]==='00107001'&&p[5]==='1'),/cache mutation only after owning instruction successful commit/],
  ['alias write commit incorrectly reaches high backing',r=>native(r,'COMMIT',p=>{p[1]='00107001';},p=>p[0]==='00107001'&&p[5]==='1'),/cache mutation only after owning instruction successful commit/],
  ['commit generation remains stale',r=>native(r,'COMMIT',p=>{p[4]='2';},p=>p[0]==='00107001'&&p[5]==='1'),/cache mutation only after owning instruction successful commit/],
  ['commit moves to different instruction clock',r=>native(r,'COMMIT',p=>{p[6]=String(Number(p[6])+1);}),/every raw native event owns current native clock/],
  ['missing current low executable pointer update',r=>deleteNative(r,'ALIAS_UPDATE',p=>p[0]==='00007000'&&p[3]==='1'),/coherence completion requires all writes and aliases applied/],
  ['missing current high executable pointer update',r=>deleteNative(r,'ALIAS_UPDATE',p=>p[0]==='00107000'&&p[3]==='1'),/every decoded alias updated with exact committed bytes/],
  ['both pointer updates name same high alias',r=>native(r,'ALIAS_UPDATE',p=>{p[0]='00107000';},p=>p[0]==='00007000'&&p[3]==='1'),/every decoded alias updated with exact committed bytes/],
  ['alias pointer generation stale',r=>native(r,'ALIAS_UPDATE',p=>{p[2]='2';},p=>p[3]==='1'),/every decoded alias updated with exact committed bytes/],
  ['alias pointer mapping epoch stale',r=>native(r,'ALIAS_UPDATE',p=>{p[3]='0';},p=>p[3]==='1'),/every decoded alias updated with exact committed bytes/],
  ['alias pointer SHA retains old instruction bytes',r=>native(r,'ALIAS_UPDATE',p=>{p[4]=zeroDigest;},p=>p[3]==='1'),/every decoded alias updated with exact committed bytes/],
  ['alias update native clock shifted',r=>native(r,'ALIAS_UPDATE',p=>{p[5]=String(Number(p[5])+1);},p=>p[3]==='1'),/every raw native event owns current native clock/],
  ['coherence flush loses one pointer count',r=>native(r,'COHERENCE',p=>{p[3]='1';},p=>p[3]==='2'),/explicit committed flush completion/],
  ['coherence flush reports wrong effective mapping',r=>native(r,'COHERENCE',p=>{p[2]='1';},p=>p[0]==='mapping'&&p[2]==='0'),/explicit committed flush completion/],
  ['coherence flush native clock shifted',r=>native(r,'COHERENCE',p=>{p[4]=String(Number(p[4])+1);}),/every raw native event owns current native clock/],
  ['missing zero-alias RAM coherence flush',r=>deleteNative(r,'COHERENCE',p=>p[0]==='write'&&p[3]==='0'),/explicit flush must complete before any next CPU\/bus event/],
  ['coherence flush delayed beyond post state',delayedCoherence,/explicit flush must complete before any next CPU\/bus event/],
  ['cached RAM execution generation stale',r=>native(r,'EXEC',p=>{p[5]='1';},p=>p[2]==='ram'&&p[5]==='3'),/generation-bound execute admission/],
  ['cached RAM execution mapping epoch stale',r=>native(r,'EXEC',p=>{p[7]='0';},p=>p[7]==='1'),/generation-bound execute admission/],
  ['cached RAM execution SHA stale',r=>native(r,'EXEC',p=>{p[6]=zeroDigest;},p=>p[2]==='ram'),/generation-bound execute admission/],
  ['SMC instruction uses old low operand',r=>native(r,'ATTEMPT',p=>{p[7]='bb2222';},p=>p[3]==='39'),/native instruction entry snapshot matches JS actual fetch stream/],
  ['SMC instruction uses old high operand',r=>native(r,'ATTEMPT',p=>{p[7]='bb3333';},p=>p[3]==='56'),/native instruction entry snapshot matches JS actual fetch stream/],
  ['native CALL CS/IP write order reversed',swappedCallWords,/native typed per-byte effect mirror/],
  ['native CALL CS stack word byte changed',r=>native(r,'MEM',p=>{p[4]='01';},p=>p[1]==='00008ffe'&&p[6]==='16'),/native typed per-byte effect mirror/],
  ['native CALL stack word crosses another address',r=>native(r,'MEM',p=>{p[1]='00008ffc';p[2]='00008ffc';},p=>p[1]==='00008ffe'&&p[6]==='16'),/native typed per-byte effect mirror/],
  ['missing full configured UART checkpoint',r=>each(r,a=>{delete a.host.reset.chipStates.uart1;}),/single reset four-clock epoch/],
  ['configured CGA state changed coherently',r=>each(r,a=>{const q=a.host.journal.find(e=>e.kind==='request'&&e.request.operation==='QUANTUM');q.after.board.chipStates.cga1.color=1;}),/actual complete board callback journal/],
  ['PIT oscillator remainder changed',r=>each(r,a=>{const q=a.host.journal.find(e=>e.kind==='request'&&e.request.operation==='QUANTUM');q.after.board.pit.fraction+=0.001;}),/actual complete board callback journal/],
  ['functional device debt silently erased',r=>each(r,a=>{const q=a.host.journal.find(e=>e.kind==='request'&&e.request.operation==='QUANTUM');q.after.board.debt=0;}),/actual complete board callback journal/],
  ['alias guest witness loses progress',r=>each(r,a=>{a.host.final.coherenceWitness[8]=0x22;}),/actual terminal settlement\/RAM digest/],
  ['high backing overwritten by OFF alias write',r=>each(r,a=>{a.host.final.highCode=[0xbb,0x55,0x55,0xcb];}),/actual terminal settlement\/RAM digest/],
  ['post instruction ES cache base changed',r=>native(r,'POST_SEG',p=>{p[10]='00000000';},p=>p[0]==='0'&&p[16]==='15'),/native real-mode cache attributes/],
  ['post instruction GPR progress changed',r=>native(r,'POST_STATE',p=>{p[3]='00002222';},p=>p[21]==='40'),/named CPU state differences only/],
  ['successful quantum double charged',r=>native(r,'QUANTUM',p=>{p[7]=String(Number(p[7])+1);}),/global successful-work ledger/],
  ['cumulative slice HALT counter drift',r=>native(r,'SLICE',p=>{p[22]=String(Number(p[22])+1);},p=>p[22]!=='0'),/each cumulative slice counter matches preceding raw chronology/],
  ['real terminal duplicate removed with plausible counters',deleteDuplicateIdle,/fixed fixture physical terminal idle census/],
  ['terminal duplicate is no longer identical effectfree',r=>native(r,'HALT_IDLE',p=>{p[5]='00000001';}),/terminal native zero-work halt state/],
];
for(const [name,mutate,expected] of mutations)test(`rejects ${name}`,()=>{
  const changed=structuredClone(capture);mutate(changed);
  assert.throws(()=>assertNativeRamCoherenceProof(changed,rom),error=>{
    assert.match(error.message,/(?:native ram reset proof|ram board host):/);
    assert.match(error.message,expected);return true;
  });
});
