/** Prepared saved-record audit only. No runner/factory/addon/CPU step is called. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const ROOT='/tmp/bw-native-paged-int-iret-evidence-persistence-20261004';
const CONTRACT='/tmp/bw-native-paged-int-iret-persistence-hosted-20261004/scripts/paged-int-iret-hosted/contract.json';
const sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(sha(readFileSync(CONTRACT)),'8f3bd4c425884c48e7e1bd9b56d445cb00c9e9e7670ae88457622d317d16ecc9');
const contract=JSON.parse(readFileSync(CONTRACT));assert.equal(contract.driverRevision,'98fb8216aa5bd0fa046cc6388f7ff6c1b22f5750');assert.equal(Object.keys(contract.driverFiles).length,81);
for(const [path,pin]of Object.entries(contract.driverFiles)){const b=readFileSync(ROOT+'/'+path);assert.equal(b.length,pin.bytes);assert.equal(sha(b),pin.sha256);}
const sourceUrl=pathToFileURL(ROOT+'/scripts/bochs-cpu3-native-paged-int-iret/');
const parity=await import(new URL('parity.mjs',sourceUrl));
const {layout,namedCuts}=await import(new URL('profile.mjs',sourceUrl));
const savedBytes=readFileSync('/tmp/native-paged-int-iret-source-controls-20261004/js-control.json');assert.equal(savedBytes.length,3996225);assert.equal(sha(savedBytes),'45efeb75ae7362074150d8d1089181a502fcdc5649f9a0ecd1bfc751b21fe9aa');
const reference=JSON.parse(savedBytes);const chunks=[];let length=0;
for await(const chunk of process.stdin){length+=chunk.length;assert.ok(length<=64<<20,'bounded logical stdin');chunks.push(chunk);}
assert.ok(length>0,'no missing bulk evidence can become architectural PASS');const c=JSON.parse(Buffer.concat(chunks).toString());
assert.equal(c.schema,'bw.paged-int-iret.native-js-correctness.v1');assert.ok(['PASS','FAIL'].includes(c.status));
const count=v=>{assert.ok(typeof v==='number'||typeof v==='string');assert.match(String(v),/^\d+$/);const n=Number(v);assert.ok(Number.isSafeInteger(n)&&n>=0&&n<=1024);return n;};
const bytes=v=>{assert.ok(Array.isArray(v)&&v.length===4096);for(const x of v)assert.ok(Number.isInteger(x)&&x>=0&&x<=255);return Uint8Array.from(v);};
const pages=p=>{assert.deepEqual(Object.keys(p).sort(),Object.keys(layout).sort());return Object.fromEntries(Object.entries(p).map(([key,v])=>[key,bytes(v)]));};
function javascript(j){return {...j,pages:pages(j.pages)};}
function native(n){parity.wholeNativeWords(n);assert.equal(count(n.execution.faults),0);assert.equal(count(n.execution.irqDeliveries),0);for(const x of Object.values(n.fallback))assert.equal(count(x),0);return n;}
function referenceFrame(j){const f=reference.frames.find(f=>f.q===j.q);assert.ok(f,'actual Q in saved JS reference');for(const key of ['cpu','board','stores','updates','deliveries'])assert.deepEqual(j[key],f[key],'saved JS '+key+' at Q'+j.q);for(const key of Object.keys(layout))assert.deepEqual(j.pages[key],f.pages[key]);}
let prior={n:0,q:0},resumes=0,zeroQ=0,comparable=0,unmatched=0,raw166=0;
assert.ok(Array.isArray(c.boundaries)&&c.boundaries.length<=1026);
for(const b of c.boundaries){native(b.native);raw166++;referenceFrame(b.javascript);const js=javascript(b.javascript);const pp=pages(b.nativeHostPages);let dq=0;
 if(b.kind==='resume'){const next=parity.intIretProgress(prior,b.native);dq=next.dq;prior=next;resumes++;if(dq===0)zeroQ++;}
 else{assert.ok(['reset','line','final-inspect'].includes(b.kind));assert.equal(count(b.native.nativeTicks),prior.n);assert.equal(count(b.native.successfulQuanta),prior.q);}
 const actual=parity.compareBoundary(b.native,b.board,js,pp,b.kind,dq);assert.deepEqual(actual,b.comparison);if(actual.status==='COMPARABLE_PARITY_PASS')comparable++;else unmatched++;
}
for(const s of c.stages??[]){assert.equal(s.comparison,'UNMATCHED_STAGE_RECORD');pages(s.native.ram.pages);pages(s.javascript.pages);assert.equal(count(s.q),s.javascript.q);}
if(c.status==='PASS')assert.deepEqual({n:count(c.progress.n),q:count(c.progress.q),resumes:count(c.progress.resumes),zeroQ:count(c.progress.zeroQ)},{n:prior.n,q:prior.q,resumes,zeroQ});
for(const key of ['input','driver','compiled','build','configuration','node']){const pair={input:['inputSha256Before','inputSha256After'],driver:['driverBefore','driverAfter'],compiled:['compiledBefore','compiledAfter'],build:['build','buildAfter'],configuration:['configuration','configurationAfter'],node:['nodeBefore','nodeAfter']}[key];if(c.status==='PASS'){assert.notEqual(c[pair[0]],undefined,'available initial '+key);assert.notEqual(c[pair[1]],undefined,'available final '+key);}if(c[pair[0]]!==undefined&&c[pair[1]]!==undefined)assert.deepEqual(c[pair[0]],c[pair[1]]);}
let finalCoverage=null;
if(c.status==='PASS'){
 assert.equal(prior.q,41);assert.equal(c.error,undefined);assert.equal(c.finalAuthenticationError,undefined);assert.deepEqual(c.finalReadErrors,{});assert.deepEqual(c.cleanup,{native:'closed',provider:'closed',javascript:'closed'});
 native(c.finalNative);native(c.lastReturnedNative);assert.equal(c.lastReturnedNative.activityState,0);assert.deepEqual(parity.wholeNativeWords(c.finalNative),parity.wholeNativeWords(c.lastReturnedNative));
 for(const n of [c.finalNative,c.lastReturnedNative]){assert.equal(count(n.nativeTicks),prior.n);assert.equal(count(n.successfulQuanta),prior.q);}
 const cuts=c.cuts.map(x=>({...x,javascript:javascript(x.javascript),pages:pages(x.pages)}));assert.equal(cuts.length,14);assert.deepEqual(c.cuts.map(x=>[x.name,x.q]),reference.cuts.map(x=>[x.name,x.q]));assert.deepEqual(parity.validateMilestones(cuts),c.milestones);
 const np=pages(c.nativeFinal.pages);const jf=c.javascriptFinal;pages(jf.pages);assert.deepEqual(jf,reference.settled);assert.deepEqual(c.nativeFinal.state.board,jf.board);parity.validateFinalPages(np);for(const key of Object.keys(layout))assert.deepEqual(np[key],bytes(jf.pages[key]));assert.equal(c.nativeFinal.ramSha256,jf.ramSha256);
 assert.deepEqual(parity.validateNativeEffects(c.nativeFinal.state,jf,true),c.nativeOwnedEffects);assert.deepEqual(parity.validateMemoryTape(c.nativeMemoryEvents,c.nativeFinal.state),c.nativeMemoryEvidence);
 assert.deepEqual(c.javascriptDeliveries,reference.settled.deliveries);assert.equal(c.javascriptDeliveries.length,1);assert.deepEqual(c.javascriptMemoryEffects,{stores:jf.stores,updates:jf.updates,accesses:jf.accesses});
 finalCoverage={cuts:14,comparableCuts:c.milestones.comparableCuts,unmatchedCuts:c.milestones.unmatchedCuts,nativeOwnedWrites:c.nativeOwnedEffects,callbacks:c.nativeMemoryEvents.length,ramSha256:jf.ramSha256,closure:c.cleanup};
}
const diagnostic=value=>{if(value===undefined||value===null)return null;const b=Buffer.from(String(value));return {excerpt:b.subarray(0,4096).toString(),utf8Bytes:b.length,sha256:sha(b),truncated:b.length>4096};};
const report={status:c.status==='PASS'?'SAVED_FULL_LOGICAL_PARITY_AUDIT_PASS':'SAVED_RETAINED_PREFIX_AUDIT_OF_FAIL',sourceDriver:contract.driverRevision,sourcePaths:81,progress:c.progress,raw166ReturnedBoundaries:raw166,comparable,unmatched,stagesRecordedUnmatched:c.stages?.length??0,finalCoverage,primaryError:diagnostic(c.error),finalAuthenticationError:diagnostic(c.finalAuthenticationError),scope:'Unchanged held parity functions applied to saved records only; no CPU/factory/runner/addon calls. Native callback order is independent. Unmatched raw records never receive full-page parity PASS; copied host RAM and source-attested native cache; whole RAM hash-only.'};
process.stdout.write(JSON.stringify(report,null,2)+'\n');
