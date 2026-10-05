/** Fixed diagnostic authority around unchanged held scalar admission. */
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import * as held from '../cold-native-memory-fusion-ledger-scalars-performance/admission.mjs';
export * from '../cold-native-memory-fusion-ledger-scalars-performance/admission.mjs';
const own='scripts/cold-native-ledger-scalars-symbol-profile';
const read=name=>held.ordinaryBytes(resolve(held.sourceRoot,own,name),1<<20);
export function validateDiagnosticMetadata(b){
 assert.equal(b.schema,'bw.cold-ledger-scalars.native-symbol.source.v1');assert.equal(b.status,'ROOT_REVIEWED_NATIVE_SYMBOL_DIAGNOSTIC_READY','PENDING native-symbol diagnostic: no recorder or guest');assert.equal(b.defaultEnabled,false);
 assert.equal(b.baseWorkerRevision,'06581f3831aa765933b1d160a41ab37b1b652913');assert.equal(b.baseSourceSha256,'3e0bb128aa00ea763125d2cc6f0af2ab7ac752de05a3485acc9432f89a799e9d');
 assert.equal(b.compiledRevision,held.compiledRevision);assert.equal(b.addonSha256,'7de755f02b385149e17abfb086972bc73cbcb3fac5294f758eda5a4ab97d2351');assert.equal(b.nodeSha256,'fde6a4bf8d0562f7751d1a2d6cb9b417c4cfe107bbcb0aa3e9a24e125e348f48');assert.equal(b.targetN,316562);assert.equal(b.targetQ,316562);
 assert.equal(b.output,'/home/runner/work/_temp/cold-ledger-scalars-native-symbol/worker-output/receipt');assert.equal(b.perfElfSha256,'5fb08c90293471b24086be829f4da4707ecc83101945868101964be48267ab71');return b;
}
function ownedAuthority(){
 const b=validateDiagnosticMetadata(JSON.parse(read('profile-binding.json')));
 for(const [name,key]of [['held-source-context.json','heldContextSha256'],['qualifier-source-context.json','qualifierSourceContextSha256'],['qualification-audit.json','qualificationAuditSha256'],['paired-audit.json','pairedAuditSha256']])assert.equal(held.sha(read(name)),b[key]);
 const context=JSON.parse(read('held-source-context.json'));assert.equal(context.revision,b.baseWorkerRevision);assert.equal(held.sha(Buffer.from(JSON.stringify(context))),b.baseSourceSha256);
 const q=JSON.parse(read('qualification-audit.json'));assert.equal(q.schema,'bw.cold-ledger-scalars.qualification-audit.v1');assert.equal(q.status,'PASS');assert.deepEqual(q.worker,{revision:b.baseWorkerRevision,sourceSha256:b.baseSourceSha256});assert.equal(q.compiledRevision,b.compiledRevision);assert.equal(q.addonSha256,b.addonSha256);assert.equal(q.nodeSha256,b.nodeSha256);
 const a=JSON.parse(read('paired-audit.json'));assert.equal(a.gatePassed,false);assert.equal(a.children,18);assert.equal(a.sourceRolePaths,364);assert.equal(a.status,'PASS_INDEPENDENT_PLAIN_JS_V_BATCHED_NEGATIVE_PAIRED_AUDIT');
 for(const [name,h]of Object.entries(b.capabilityPins))assert.equal(held.sha(read(name)),h);return b;
}
export function authenticatePrerequisite(input){
 const b=ownedAuthority();assert.equal(input.output,b.output);assert.equal(input.mode,'batched');assert.equal(input.sha256,b.addonSha256);assert.equal(input.nodeSha256,b.nodeSha256);return held.authenticatePrerequisite(input);
}
export function nativeWorkerSourceIdentity(){
 const base=held.nativeWorkerSourceIdentity(),context=JSON.parse(read('held-source-context.json'));assert.deepEqual(base.hashes,context.hashes,'all original73 source inputs unchanged');
 const ownNames=['worker.mjs','admission.mjs','window-session.mjs','recorder.py','setup.py','worker-entry.py','qualifier-source-context.json','test_recorder.py','profile-binding.json','held-source-context.json','qualification-audit.json','paired-audit.json','capability-result.json','capability-audit.json','capability-artifacts.json','capability-version.stdout','worker-derivation.json','README.md'];
 const paths=[...ownNames.map(n=>own+'/'+n),'test/i80386-cold-ledger-scalars-symbol-profile-source.test.mjs'];const hashes={...base.hashes};
 for(const p of paths){const bytes=held.ordinaryBytes(resolve(held.sourceRoot,p));assert.equal(held.sha(bytes),held.sha(execFileSync('git',['show',base.revision+':'+p],{cwd:held.sourceRoot,timeout:10000,maxBuffer:8<<20})),'diagnostic current/Git '+p);hashes[p]=held.sha(bytes);}
 return {revision:base.revision,hashes:Object.fromEntries(Object.keys(hashes).sort().map(p=>[p,hashes[p]]))};
}
