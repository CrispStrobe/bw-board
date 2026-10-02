/** Diagnostic CLI for a bounded fresh child; SOURCE ONLY until runtime grant. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createOwnedNativeClock} from './bochs-cpu3-native-owned-clock/factory.mjs';
import {sha256} from './bochs-cpu3-native-owned-clock/derive.mjs';
import {ownedChildConfiguration} from './audit-i80386-native-direct-board-adapter.mjs';
import {sourceIdentity as identity,authenticateBuild} from './bochs-cpu3-native-owned-clock/identity.mjs';
const path=process.argv[2];assert.equal(process.argv.length,3);assert.ok(statSync(path).isFile()&&statSync(path).size<=16384);const input=JSON.parse(readFileSync(path));
for(const k of ['addon','sha256','configuration','baseline','output'])assert.equal(typeof input[k],'string');assert.ok(input.output.startsWith('/'));assert.ok(!input.profile,'no profiler protocol');
const baselineBytes=readFileSync(input.baseline);assert.equal(sha256(baselineBytes),'c079fc196461e7d062df7e6a8a9b13b28ab9014b36a1040698fc5bab91ecdc5f');const baseline=JSON.parse(baselineBytes),targets=Object.entries(baseline.boundaries).map(([name,v])=>({name,q:v.q,cpu:v.cpu})).sort((a,b)=>a.q-b.q);assert.deepEqual(targets.map(t=>t.q),[177,183,80183,80187,100667,100681]);
const source=identity(),provenance=authenticateBuild(input,source);mkdirSync(input.output,{recursive:false});const config=ownedChildConfiguration(readFileSync(input.configuration,'utf8'),input.output+'/guest');writeFileSync(config.path,config.text,{flag:'wx'});
const startupStart=process.hrtime.bigint(),handle=await createOwnedNativeClock(JSON.stringify({addon:input.addon,sha256:input.sha256,configuration:config.path,configurationSha256:config.sha256,hostJournal:input.hostJournal!==false,nativeTrace:input.nativeTrace===true,journal:input.output+'/callbacks.jsonl'})),startupNs=Number(process.hrtime.bigint()-startupStart);
const reset=JSON.parse(handle.reset),checkpoints=[];let target=0,final,resumes=0,terminal=false;
const executionCPUStart=process.cpuUsage();const executionStart=process.hrtime.bigint();
try{
 for(let i=0;i<160001;i++){
  const remaining=target<targets.length?targets[target].q-Number(final?.successfulQuanta??0):300;assert.ok(remaining>0);
  final=JSON.parse(await handle.resume(JSON.stringify({n:600,q:Math.min(300,remaining),deadline:'18446744073709551615'})));resumes++;
  if(target<targets.length&&Number(final.successfulQuanta)===targets[target].q){const t=targets[target++];assert.equal(final.state[8],t.cpu.eip);assert.equal(final.state[13],t.cpu.cs);checkpoints.push({kind:'exact-Q-boundary',name:t.name,q:t.q,resume:resumes,native:final,board:JSON.parse(await handle.checkpoint())});}
  if(final.reason===4&&final.chargedNativeTicks===0&&final.chargedQuanta===0){terminal=true;break;}
  assert.ok(Number(final.nativeTicks)<=160000&&Number(final.successfulQuanta)<=150000);
 }
 const executionNs=Number(process.hrtime.bigint()-executionStart),cpu=process.cpuUsage(executionCPUStart),executionCPU={unit:'microseconds',user:cpu.user,system:cpu.system,total:cpu.user+cpu.system};assert.ok(terminal&&target===6);
 const settlementStart=process.hrtime.bigint(),settled=JSON.parse(await handle.close()),settlementNs=Number(process.hrtime.bigint()-settlementStart);
 assert.deepEqual(identity(),source);assert.deepEqual(authenticateBuild(input,source),provenance);assert.equal(settled.state.javascriptCpuCycles,0);assert.equal(settled.state.board.debt,0);assert.equal(final.execution.faults,'2');assert.equal(final.execution.irqDeliveries,'1');assert.ok(Object.values(final.fallback).every(v=>v==='0'));
 const report={status:'UNQUALIFIED_ABI3_NATIVE_CANDIDATE',source,provenance,priorH4:{runtime:'89acf83dda501a097550e0465b4db2351229a991e51cbf8439d43bad77d4a42a',napi:'b57a3cea1f5f5eea2092401f8dba3041eb0bc0d19551bf4273e66ad7372c60cb'},addon:{path:input.addon,sha256:sha256(readFileSync(input.addon))},configuration:config,reset,final,resumes,terminal,checkpoints,settled:settled.state,ramSha256:settled.ramSha256,journal:settled.journal,timing:{startupNs,executionNs,executionCPU,settlementNs,scope:'whole resume IPC, parent/worker execution and six board checkpoints; includes native snapshots; CPU measurement must include all process threads'},closed:{native:true,board:true,worker:true}};
 writeFileSync(input.output+'/capture.json',JSON.stringify(report,null,2),{flag:'wx'});
}catch(e){await handle.abort();throw e;}
