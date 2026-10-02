/** Diagnostic CLI for a bounded fresh child; SOURCE ONLY until runtime grant. */
import assert from 'node:assert/strict';
import {validateResetWitness,validateCpuProfile} from '/tmp/bw-board-386-native-owned-in8-r3-20261002/scripts/bochs-cpu3-native-owned-in8/reset-witness.mjs';
import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire}from 'node:module';
import {realpathSync,openSync,closeSync}from 'node:fs';
import {createHash}from 'node:crypto';
import {createOwnedIn8Provider}from '/tmp/bw-board-386-native-owned-in8-r3-20261002/scripts/bochs-cpu3-native-owned-in8/provider.mjs';
import {writeJournalRecord}from '/tmp/bw-board-386-native-owned-in8-r3-20261002/scripts/bochs-cpu3-native-hot-direct/journal.mjs';
import {validateInput,validateBaseline,boundedBytes,authenticateConfiguration}from '/home/runner/work/_temp/owned-dispatch-gate/gate/profile-admission.mjs';
import {checkBootstrap}from '/tmp/bw-board-386-native-owned-in8-r3-20261002/scripts/bochs-cpu3-native-owned-in8/bootstrap.mjs';
import {sha256} from '/tmp/bw-board-386-native-owned-in8-r3-20261002/scripts/bochs-cpu3-native-owned-clock/derive.mjs';
import {ownedChildConfiguration} from '/tmp/bw-board-386-native-owned-in8-r3-20261002/scripts/audit-i80386-native-direct-board-adapter.mjs';
import {sourceIdentity as identity,authenticateBuild} from '/tmp/bw-board-386-native-owned-in8-r3-20261002/scripts/bochs-cpu3-native-owned-in8/identity.mjs';
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
const checkpoints=[];let target=0,final,resumes=0,terminal=false;
const executionCPUStart=process.cpuUsage();const executionStart=process.hrtime.bigint();
try{
 for(let i=0;i<160001;i++){
  const remaining=target<targets.length?targets[target].q-Number(final?.successfulQuanta??0):300;assert.ok(remaining>0);
  final=handle.resume(600,Math.min(300,remaining),'18446744073709551615');resumes++;
  if(target<targets.length&&Number(final.successfulQuanta)===targets[target].q){const t=targets[target++];validateCpuProfile(final.state,t.cpu);assert.equal(final.state[8],t.cpu.eip);assert.equal(final.state[13],t.cpu.cs);checkpoints.push({kind:'exact-Q-boundary',name:t.name,q:t.q,resume:resumes,native:final,board:handle.checkpoint()});}
  if(final.reason===4&&final.chargedNativeTicks===0&&final.chargedQuanta===0){terminal=true;break;}
  assert.ok(Number(final.nativeTicks)<=160000&&Number(final.successfulQuanta)<=150000);
 }
 const executionNs=Number(process.hrtime.bigint()-executionStart),cpu=process.cpuUsage(executionCPUStart),executionCPU={unit:'microseconds',user:cpu.user,system:cpu.system,total:cpu.user+cpu.system};assert.ok(terminal&&target===6);
 const settlementStart=process.hrtime.bigint(),settled=handle.close(),settlementNs=Number(process.hrtime.bigint()-settlementStart);
 assert.deepEqual(identity(),source);assert.deepEqual(authenticateBuild(input,source),provenance);assert.equal(settled.state.javascriptCpuCycles,0);assert.equal(settled.state.board.debt,0);assert.equal(baseline.final.memorySha256,'8bbabd33892728f64bae9b9a558ba106112aef5024196e10aa037e45d0ca7344');assert.deepEqual([baseline.reset.cpu.edx,baseline.reset.cpu.cr0],[0x300,0]);validateResetWitness(settled,{edx:reset.state[2],cr0:reset.state[10]},'native');assert.deepEqual(settled.in8Witness,baseline.final.in8Witness);validateCpuProfile(final.state,baseline.final.cpu);assert.equal(final.execution.faults,2n);assert.equal(final.execution.irqDeliveries,1n);assert.ok(Object.values(final.fallback).every(v=>v===0n));
 const report={status:'UNQUALIFIED_ABI4_IN8_NATIVE_CANDIDATE',source,provenance,priorH4:{runtime:'89acf83dda501a097550e0465b4db2351229a991e51cbf8439d43bad77d4a42a',napi:'b57a3cea1f5f5eea2092401f8dba3041eb0bc0d19551bf4273e66ad7372c60cb'},addon:{path:input.addon,sha256:sha256(readFileSync(input.addon))},configuration:config,reset,final,resumes,terminal,checkpoints,settled:settled.state,ramSha256:settled.ramSha256,resetWitness:settled.resetWitness,ramCanonicalSha256:settled.ramCanonicalSha256,in8Witness:settled.in8Witness,journal:settled.journal,timing:{startupNs,executionNs,executionCPU,settlementNs,scope:'local main-thread resume execution and six board checkpoints; includes native snapshots; CPU measurement must include all process threads'},closed:{native:true,board:true,freshChildMain:true}};
 writeFileSync(input.output+'/capture.json',JSON.stringify(JSON.parse(serialize(report)),null,2),{flag:'wx'});
}catch(e){await handle.abort();throw e;}
