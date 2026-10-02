/** Diagnostic CLI for a bounded fresh child; SOURCE ONLY until runtime grant. */
import assert from 'node:assert/strict';
import {Session} from 'node:inspector';
import {validateResetWitness,validateCpuProfile} from "/home/runner/work/bw-board/bw-board/baseline/scripts/bochs-cpu3-native-owned-in8/reset-witness.mjs";
import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire}from 'node:module';
import {realpathSync,openSync,closeSync}from 'node:fs';
import {createHash}from 'node:crypto';
import {createOwnedIn8Provider}from "/home/runner/work/bw-board/bw-board/baseline/scripts/bochs-cpu3-native-owned-in8/provider.mjs";
import {writeJournalRecord}from "/home/runner/work/bw-board/bw-board/baseline/scripts/bochs-cpu3-native-hot-direct/journal.mjs";
import {validateInput,validateBaseline,boundedBytes,authenticateConfiguration}from "/home/runner/work/_temp/owned-baseline-profile/profile/profile-admission.mjs";
import {checkBootstrap}from "/home/runner/work/bw-board/bw-board/baseline/scripts/bochs-cpu3-native-owned-in8/bootstrap.mjs";
import {sha256} from "/home/runner/work/bw-board/bw-board/baseline/scripts/bochs-cpu3-native-owned-clock/derive.mjs";
import {ownedChildConfiguration} from "/home/runner/work/bw-board/bw-board/baseline/scripts/audit-i80386-native-direct-board-adapter.mjs";
import {sourceIdentity as identity,authenticateBuild} from "/home/runner/work/bw-board/bw-board/baseline/scripts/bochs-cpu3-native-owned-in8/identity.mjs";
checkBootstrap(import.meta.url);
const path=process.argv[2];assert.equal(process.argv.length,3);assert.ok(statSync(path).isFile()&&statSync(path).size<=16384);const input=validateInput(JSON.parse(readFileSync(path)));
for(const k of ['addon','sha256','configuration','baseline','output'])assert.equal(typeof input[k],'string');assert.ok(input.output.startsWith('/'));assert.ok(!input.profile,'no profiler protocol');
const baselineBytes=boundedBytes(input.baseline,16*1024*1024);assert.equal(sha256(baselineBytes),input.baselineSha256);const baseline=JSON.parse(baselineBytes),targets=validateBaseline(baseline);
const admittedConfiguration=authenticateConfiguration(input.configuration);
const source=identity(),provenance=authenticateBuild(input,source);mkdirSync(input.output,{recursive:false});const config=ownedChildConfiguration(admittedConfiguration,input.output+'/guest');writeFileSync(config.path,config.text,{flag:'wx'});
// No exported native/provider capability. All artifact admission precedes require.
const serialize=v=>JSON.stringify(v,(_,v)=>typeof v==='bigint'?v.toString():v instanceof Uint8Array?[...v]:v);

const startupStart=process.hrtime.bigint();let rows=0,bytes=0,closed=false,terminalLocal=false;const digest=createHash('sha256'),fd=openSync(input.output+'/callbacks.jsonl','wx');
const provider=createOwnedIn8Provider({compactSink:input.hostJournal!==false?e=>{const line=serialize([e.ordinal,e.operation,e.args,e.result,e.nativeTicks,e.successfulQuanta,e.boardCycles,e.debt,e.mappingEpoch])+'\n';assert.ok(bytes+Buffer.byteLength(line)<=32*1024*1024);writeJournalRecord(fd,line);digest.update(line);bytes+=Buffer.byteLength(line);rows++;}:null});
assert.equal(sha256(provider.rom),'25c242668fb1e0cbf940a35045a5e1173d992232766a4cbdb6a369ef3929a939');assert.equal(sha256(readFileSync(config.path)),config.sha256);const addonPath=realpathSync(input.addon);assert.ok(statSync(addonPath).isFile()&&statSync(addonPath).size<=256*1024*1024);assert.equal(sha256(readFileSync(addonPath)),input.sha256);
const api=createRequire(import.meta.url)(addonPath);assert.equal(api.abiVersion,4);for(const k of ['create','resume','setIRQ','inspect','close'])assert.equal(typeof api[k],'function');const {create,resume,setIRQ,inspect,close}=api;
const reset=create(config.path,provider.rom,provider.callbacks,input.nativeTrace===true),startupNs=Number(process.hrtime.bigint()-startupStart);validateCpuProfile(reset.state,baseline.reset.cpu,true);
const handle={resume(n,q,deadline){assert.ok(!closed&&!terminalLocal);assert.ok(Number.isSafeInteger(n)&&n>0&&n<=600&&Number.isSafeInteger(q)&&q>0&&q<=300);assert.ok(typeof deadline==='string'&&/^[0-9]{1,20}$/.test(deadline));const d=BigInt(deadline);assert.ok(d<=0xffffffffffffffffn);const staged=provider.stage();if(staged.changed)setIRQ(staged.asserted);provider.begin();let result;try{result=resume(n,q,d);}finally{provider.end();}terminalLocal=result.reason===4&&result.chargedNativeTicks===0&&result.chargedQuanta===0;return result;},checkpoint(){assert.ok(!closed);return provider.checkpoint();},close(){assert.ok(!closed&&terminalLocal);const final=inspect();assert.equal(final.nativeTicks,BigInt(baseline.attempts));assert.equal(final.successfulQuanta,BigInt(baseline.q));const result=provider.terminal();assert.equal(result.state.marker,'RPGH001');close();provider.close();closeSync(fd);closed=true;result.journal={rows,bytes,sha256:digest.digest('hex')};return result;},abort(){if(!closed){closed=true;try{closeSync(fd);}catch{}}}};
const profileSession=new Session();profileSession.connect();
const profilerPost=(method,params={})=>new Promise((ok,fail)=>profileSession.post(method,params,(e,r)=>e?fail(e):ok(r)));
const profilePhases={unit:'monotonic microseconds',setupBeginUs:Number(process.hrtime.bigint()/1000n)};
await profilerPost('Profiler.enable');await profilerPost('Profiler.setSamplingInterval',{interval:1000});
profilePhases.startCallBeginUs=Number(process.hrtime.bigint()/1000n);await profilerPost('Profiler.start');profilePhases.startCallEndUs=Number(process.hrtime.bigint()/1000n);
const checkpoints=[];let target=0,final,resumes=0,terminal=false;
const executionCPUStart=process.cpuUsage();const executionStart=process.hrtime.bigint();profilePhases.executionBeginUs=Number(executionStart/1000n);
try{
 for(let i=0;i<160001;i++){
  const remaining=target<targets.length?targets[target].q-Number(final?.successfulQuanta??0):300;assert.ok(remaining>0);
  final=handle.resume(600,Math.min(300,remaining),'18446744073709551615');resumes++;
  if(target<targets.length&&Number(final.successfulQuanta)===targets[target].q){const t=targets[target++];validateCpuProfile(final.state,t.cpu);assert.equal(final.state[8],t.cpu.eip);assert.equal(final.state[13],t.cpu.cs);checkpoints.push({kind:'exact-Q-boundary',name:t.name,q:t.q,resume:resumes,native:final,board:handle.checkpoint()});}
  if(final.reason===4&&final.chargedNativeTicks===0&&final.chargedQuanta===0){terminal=true;break;}
  assert.ok(Number(final.nativeTicks)<=160000&&Number(final.successfulQuanta)<=150000);
 }
 const executionNs=Number(process.hrtime.bigint()-executionStart),cpu=process.cpuUsage(executionCPUStart),executionCPU={unit:'microseconds',user:cpu.user,system:cpu.system,total:cpu.user+cpu.system};profilePhases.executionEndUs=Number((executionStart+BigInt(executionNs))/1000n);
 profilePhases.stopCallBeginUs=Number(process.hrtime.bigint()/1000n);const {profile}=await profilerPost('Profiler.stop');profilePhases.stopCallEndUs=Number(process.hrtime.bigint()/1000n);profileSession.disconnect();
 writeFileSync(input.output+'/profile.cpuprofile',JSON.stringify(profile),{flag:'wx'});writeFileSync(input.output+'/profile-phases.json',JSON.stringify(profilePhases,null,2),{flag:'wx'});
 assert.ok(terminal&&target===6);
 const settlementStart=process.hrtime.bigint(),settled=handle.close(),settlementNs=Number(process.hrtime.bigint()-settlementStart);
 assert.deepEqual(identity(),source);assert.deepEqual(authenticateBuild(input,source),provenance);assert.equal(settled.state.javascriptCpuCycles,0);assert.equal(settled.state.board.debt,0);assert.equal(baseline.final.memorySha256,'8bbabd33892728f64bae9b9a558ba106112aef5024196e10aa037e45d0ca7344');assert.deepEqual([baseline.reset.cpu.edx,baseline.reset.cpu.cr0],[0x300,0]);validateResetWitness(settled,{edx:reset.state[2],cr0:reset.state[10]},'native');assert.deepEqual(settled.in8Witness,baseline.final.in8Witness);validateCpuProfile(final.state,baseline.final.cpu);assert.equal(final.execution.faults,2n);assert.equal(final.execution.irqDeliveries,1n);assert.ok(Object.values(final.fallback).every(v=>v===0n));
 const report={profiling:{kind:'INSPECTOR_EXECUTION_SCOPED_DIAGNOSTIC',samplingIntervalUs:1000,derivative:{"diagnosticManifest":{"kind":"SOURCE_OWNED_BASELINE_INSPECTOR_DIAGNOSTIC","publicationRevision":"6ccb89042c601bdd9c6598adf642a8b06a1cfcd1","files":{"/home/runner/work/bw-board/bw-board/publication/scripts/ci-profile-i80386-owned-baseline.py":"3a390779e73c80669bded8b3e6ac6ea88b12e2a54e13e0f2b2e1a4fcc9280d57","/home/runner/work/bw-board/bw-board/publication/scripts/owned-baseline-profile/derive.mjs":"f8fc837d24b3633ff0e471a28694dc0997b230fb49fe1e67e00df01f4cb26fa7","/home/runner/work/bw-board/bw-board/publication/scripts/owned-baseline-profile/alignment.mjs":"8a27b87b475caebb0b520a45b761b2fa5952ad878a1bc2c0d89ea6a83a58b4d7","/home/runner/work/bw-board/bw-board/publication/scripts/owned-baseline-profile/plan.json":"40fffc8104466ec3ac3c403ce6b1a60618862ffac14178d4e5e561ec03e5d6dd","/home/runner/work/bw-board/bw-board/publication/.github/workflows/i80386-owned-baseline-profile.yml":"d0e8000751105a34191491536aebf2756bfc4264edfb064a87bd36a4360d6ffc","/home/runner/work/bw-board/bw-board/publication/test/i80386-owned-baseline-profile.test.mjs":"5b4a3aabbd4dac7b0c5a72099a775206055af2d081d1fcc78b525e9fb49f8b9b"},"alignmentSha256":"7feb6ac4e4443d92d2065c199c6c12b6ef5880b44b04ff654b58abd300d77afc"},"diagnosticManifestSha256":"064b17c7619ada94e82ee0dac08bc3960330b7efd63d20239aeff4deea446cee","sourceRevision":"fe1eff2039520536350922a2164c8bbe29404c68","originalRunnerSha256":"68f85005a471c2ccade1d4dcfbbf2794fb0161fc7536e9c4b9bcb1dc05c9578b","generatorSha256":"f8fc837d24b3633ff0e471a28694dc0997b230fb49fe1e67e00df01f4cb26fa7","admissionSha256":"7349530ffe58726025499698bb6cd8ee9d0d939738a0283901a1855fce249968","kind":"EXACT_INVERSE_INSPECTOR_DERIVATIVE_NOT_FROZEN_RUNTIME"},phases:profilePhases,limitations:'Isolate samples and overlapping native.resume inclusive stacks; not all-thread CPU or a C-core/NAPI split'},status:'UNQUALIFIED_ABI4_IN8_NATIVE_CANDIDATE',source,provenance,priorH4:{runtime:'89acf83dda501a097550e0465b4db2351229a991e51cbf8439d43bad77d4a42a',napi:'b57a3cea1f5f5eea2092401f8dba3041eb0bc0d19551bf4273e66ad7372c60cb'},addon:{path:input.addon,sha256:sha256(readFileSync(input.addon))},configuration:config,reset,final,resumes,terminal,checkpoints,settled:settled.state,ramSha256:settled.ramSha256,resetWitness:settled.resetWitness,ramCanonicalSha256:settled.ramCanonicalSha256,in8Witness:settled.in8Witness,journal:settled.journal,timing:{startupNs,executionNs,executionCPU,settlementNs,scope:'local main-thread resume execution and six board checkpoints; includes native snapshots; CPU measurement must include all process threads'},closed:{native:true,board:true,freshChildMain:true}};
 writeFileSync(input.output+'/capture.json',JSON.stringify(JSON.parse(serialize(report)),null,2),{flag:'wx'});
}catch(e){try{const failed=await profilerPost('Profiler.stop');writeFileSync(input.output+'/failed-profile.cpuprofile',JSON.stringify(failed.profile),{flag:'wx'});}catch{}finally{profileSession.disconnect();}await handle.abort();throw e;}
