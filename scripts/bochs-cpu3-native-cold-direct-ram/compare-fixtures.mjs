/** Exact allowlisted architectural comparison; transport counters are checked separately. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const [directPath,companionPath,callbackPath]=process.argv.slice(2);
assert.equal(process.argv.length,5);
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const direct=read(directPath),companion=read(companionPath),callback=read(callbackPath);
assert.equal(direct.schema,'bw.cold-native.direct-ram-actual-fixture.v1');
for(const [report,mode]of [[companion,'owned'],[callback,'callback']]){
 assert.equal(report.schema,'bw.cold-native.owned-ram-actual-fixture.v1');assert.equal(report.mode,mode);
}
assert.equal(direct.mode,'direct');
function native(snapshot){
 const names=['state','extra','segments','system','debug'];
 const arrays=Object.fromEntries(names.map(name=>[name,snapshot[name]]));
 assert.deepEqual(names.map(name=>arrays[name].length),[20,20,90,30,6],'full 166-word typed state');
 return {...arrays,nativeTicks:snapshot.nativeTicks,successfulQuanta:snapshot.successfulQuanta,
  mappingEpoch:snapshot.mappingEpoch,boardA20:snapshot.boardA20,clockTransfers:snapshot.clockTransfers,
  execution:snapshot.execution,fallback:snapshot.fallback,callbacks:snapshot.callbacks};
}
function progress(value){return Object.fromEntries(['nativeTicks','successfulQuanta','mappingEpoch','boardA20',
 'reason','activityState','chargedNativeTicks','chargedQuanta','sliceBytes'].map(k=>[k,value[k]]));}
function architecture(report){
 return {target:report.target,resumes:report.resumes,zero:report.zero,
  reset:{native:native(report.reset.native),board:report.reset.board},
  lastReturn:progress(report.lastReturn),last:native(report.last),final:native(report.final),
  board:report.board,ramSha256:report.ramSha256,ports:report.ports};
}
const expected=architecture(callback);
assert.deepEqual(architecture(companion),expected,'companion versus callback complete semantic projection');
assert.deepEqual(architecture(direct),expected,'same-DSO direct versus callback complete semantic projection');
const status=direct.direct.beforeClose,closed=direct.direct.afterClose;
assert.equal(status.ownerClosed,false);assert.equal(status.cpuClosed,false);assert.equal(status.ownerFailed,false);
assert.equal(status.prepared,false);assert.equal(status.pageTicket,false);assert.equal(status.journalPending,'0');
assert.equal(status.uncommittedRetry,false);assert.equal(status.committedCodeFence,false);
assert.equal(status.acknowledged,status.committed);assert.equal(closed.ownerClosed,true);assert.equal(closed.cpuClosed,true);
assert.equal(direct.direct.closure.providerClosed,true);assert.equal(direct.direct.closure.boardClosed,true);
assert.equal(closed.acknowledged,closed.committed);assert.equal(closed.uncommittedRetry,false);
assert.equal(closed.committedCodeFence,false);
assert.ok(BigInt(status.directReads)>0n&&BigInt(status.directWrites)>0n,'direct native memory path exercised');
assert.ok(BigInt(status.reconciliations)>0n,'retained observer reconciliation exercised');
assert.equal(status.directReads,direct.final.callbacks.physicalReads,'same source physical read count');
assert.equal(status.directWrites,direct.final.callbacks.physicalWrites,'same source physical write count');
assert.equal(Number(status.committed),direct.journal.length,'complete ordered journal');
assert.equal(Number(status.acknowledged),direct.direct.provider.acknowledged,'provider/owner contiguous ACK');
assert.equal(direct.direct.provider.journalEntries,direct.journal.length);
const replay=Buffer.from(direct.initialRamBase64,'base64');assert.equal(replay.length,0x1000000);
assert.equal(createHash('sha256').update(replay).digest('hex'),direct.initialRamSha256);
const generations=new Map();let priorEffect=0,priorN=0,priorQ=0;
for(let i=0;i<direct.journal.length;i++){
 const e=direct.journal[i];assert.equal(e.sequence,i+1);assert.ok(e.effect>priorEffect);priorEffect=e.effect;
 assert.equal(e.sessionIdentity,direct.direct.provider.sessionIdentity);assert.equal(e.epoch,0);
 assert.ok(e.n>=priorN&&e.q>=priorQ&&e.n>=e.q&&e.n<=Number(direct.final.nativeTicks)&&e.q<=Number(direct.final.successfulQuanta));
 priorN=e.n;priorQ=e.q;
 assert.equal(e.before.length,e.after.length);assert.ok(e.before.length>=1&&e.before.length<=16);
 assert.ok(Number.isInteger(e.address)&&e.address>=0&&e.address+e.after.length<=0x180000);
 const page=e.address&~4095;assert.ok((e.address&4095)+e.after.length<=4096);
 assert.equal(e.generation,(generations.get(page)??0)+1);assert.ok(generations.has(page)||generations.size<64);
 for(let j=0;j<e.before.length;j++)assert.equal(replay[e.address+j],e.before[j],'exact once before byte');
 for(let j=0;j<e.after.length;j++)replay[e.address+j]=e.after[j];
 generations.set(page,e.generation);
}
assert.deepEqual([...generations],direct.generationEntries,'first-touch generation insertion order');
assert.deepEqual([...generations].sort((a,b)=>a[0]-b[0]),direct.board.generations,'final board generations');
assert.equal(createHash('sha256').update(replay).digest('hex'),direct.ramSha256,'whole 16 MiB replay');
const crossings=direct.final.bridgeMemoryEntryAttempts;
for(const k of ['ordinaryRead','ordinaryWrite','fusedOuter'])assert.equal(crossings[k],'0','no JavaScript physical-memory crossing');
for(const report of [direct,companion,callback])for(const value of Object.values(report.final.fallback))assert.equal(value,'0','zero native fallback');
assert.ok(BigInt(direct.final.clockTransfers.transfers)>0n,'retained clock callback path');
assert.equal(direct.final.successfulQuanta,String(direct.target));
if(direct.target===316562){
 assert.equal(direct.resumes,16524);assert.equal(direct.ports.length,16475);
 assert.equal(direct.final.nativeTicks,'316562');
}
const journalSha256=createHash('sha256').update(JSON.stringify(direct.journal)).digest('hex');
console.log(JSON.stringify({schema:'bw.cold-native.direct-ram-three-arm-parity.v1',
 target:direct.target,resumes:direct.resumes,ports:direct.ports.length,ramSha256:direct.ramSha256,
 journalEntries:direct.journal.length,journalSha256,directReads:status.directReads,directWrites:status.directWrites,
 reconciliations:status.reconciliations,parity:'PASS'}));
