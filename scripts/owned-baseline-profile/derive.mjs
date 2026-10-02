/** Exact diagnostic derivative; no addon is loaded by this module. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const sha256=s=>createHash('sha256').update(s).digest('hex');
export function deriveProfile(original,imports,identity){
 let source=original;const seams=[];
 function replace(before,after){assert.equal(source.split(before).length-1,1);source=source.replace(before,after);seams.push({before,after});}
 for(const [before,after]of imports)replace(before,after);
 replace("import assert from 'node:assert/strict';","import assert from 'node:assert/strict';\nimport {Session} from 'node:inspector';");
 replace('const checkpoints=[];let target=0,final,resumes=0,terminal=false;',`const profileSession=new Session();profileSession.connect();
const profilerPost=(method,params={})=>new Promise((ok,fail)=>profileSession.post(method,params,(e,r)=>e?fail(e):ok(r)));
const profilePhases={unit:'monotonic microseconds',setupBeginUs:Number(process.hrtime.bigint()/1000n)};
await profilerPost('Profiler.enable');await profilerPost('Profiler.setSamplingInterval',{interval:1000});
profilePhases.startCallBeginUs=Number(process.hrtime.bigint()/1000n);await profilerPost('Profiler.start');profilePhases.startCallEndUs=Number(process.hrtime.bigint()/1000n);
const checkpoints=[];let target=0,final,resumes=0,terminal=false;`);
 replace('const executionCPUStart=process.cpuUsage();const executionStart=process.hrtime.bigint();','const executionCPUStart=process.cpuUsage();const executionStart=process.hrtime.bigint();profilePhases.executionBeginUs=Number(executionStart/1000n);');
 replace('assert.ok(terminal&&target===6);',`profilePhases.executionEndUs=Number((executionStart+BigInt(executionNs))/1000n);
 profilePhases.stopCallBeginUs=Number(process.hrtime.bigint()/1000n);const {profile}=await profilerPost('Profiler.stop');profilePhases.stopCallEndUs=Number(process.hrtime.bigint()/1000n);profileSession.disconnect();
 writeFileSync(input.output+'/profile.cpuprofile',JSON.stringify(profile),{flag:'wx'});writeFileSync(input.output+'/profile-phases.json',JSON.stringify(profilePhases,null,2),{flag:'wx'});
 assert.ok(terminal&&target===6);`);
 replace("const report={status:","const report={profiling:{kind:'INSPECTOR_EXECUTION_SCOPED_DIAGNOSTIC',samplingIntervalUs:1000,derivative:"+JSON.stringify(identity)+",phases:profilePhases,limitations:'Isolate samples and overlapping native.resume inclusive stacks; not all-thread CPU or a C-core/NAPI split'},status:");
 replace('}catch(e){await handle.abort();throw e;}','}catch(e){try{const failed=await profilerPost(\'Profiler.stop\');writeFileSync(input.output+\'/failed-profile.cpuprofile\',JSON.stringify(failed.profile),{flag:\'wx\'});}catch{}finally{profileSession.disconnect();}await handle.abort();throw e;}');
 let inverse=source;for(const s of [...seams].reverse()){assert.equal(inverse.split(s.after).length-1,1);inverse=inverse.replace(s.after,s.before);}assert.equal(inverse,original);
 return {source,seams,originalSha256:sha256(original),derivedSha256:sha256(source),inverseExact:true};
}

// Hosted generator: fixed baseline paths supplied by the source-owned parent only.
import {readFileSync,writeFileSync}from 'node:fs';import {resolve}from 'node:path';import {fileURLToPath}from 'node:url';
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.equal(process.argv.length,6);const [root,directory,configurationSha,manifestPath]=process.argv.slice(2);assert.match(configurationSha,/^[a-f0-9]{64}$/);
 const original=readFileSync(root+'/scripts/run-i80386-native-owned-in8.mjs','utf8');const replacements=[];
 for(const match of original.matchAll(/from (['"])(\.\/[^'"]+)\1/g)){const path=resolve(root+'/scripts',match[2]);replacements.push([match[0],'from '+JSON.stringify(path.endsWith('/admission.mjs')?directory+'/profile-admission.mjs':path)]);}
 const oldAdmission=readFileSync(root+'/scripts/bochs-cpu3-native-owned-in8/admission.mjs','utf8');let admission=oldAdmission;const admissions=[['\'../bochs-cpu3-native-owned-clock/derive.mjs\'',JSON.stringify(root+'/scripts/bochs-cpu3-native-owned-clock/derive.mjs')],['\'../bochs-cpu3-native-combined-paging-ram/host.mjs\'',JSON.stringify(root+'/scripts/bochs-cpu3-native-combined-paging-ram/host.mjs')],["fileURLToPath(new URL('../../',import.meta.url))",JSON.stringify(root+'/')],['5683c4731d60804502b17ee0653085ef761137199878880b3b5ed64fd0a49d3d',configurationSha]];
 for(const [before,after]of admissions){assert.equal(admission.split(before).length-1,1);admission=admission.replace(before,after);}let inverse=admission;for(const [before,after]of [...admissions].reverse())inverse=inverse.replace(after,before);assert.equal(inverse,oldAdmission);
 const manifestBytes=readFileSync(manifestPath);const diagnosticManifest=JSON.parse(manifestBytes);assert.equal(diagnosticManifest.kind,'SOURCE_OWNED_BASELINE_INSPECTOR_DIAGNOSTIC');
 const identity={diagnosticManifest,diagnosticManifestSha256:sha256(manifestBytes),sourceRevision:'fe1eff2039520536350922a2164c8bbe29404c68',originalRunnerSha256:sha256(original),generatorSha256:sha256(readFileSync(fileURLToPath(import.meta.url))),admissionSha256:sha256(admission),kind:'EXACT_INVERSE_INSPECTOR_DERIVATIVE_NOT_FROZEN_RUNTIME'};
 const derived=deriveProfile(original,replacements,identity);writeFileSync(directory+'/profile-runner.mjs',derived.source,{flag:'wx'});writeFileSync(directory+'/profile-admission.mjs',admission,{flag:'wx'});writeFileSync(directory+'/derivation.json',JSON.stringify({...derived,source:undefined,admission:{originalSha256:sha256(oldAdmission),derivedSha256:sha256(admission),seams:admissions,inverseExact:true},identity},null,2),{flag:'wx'});
}
