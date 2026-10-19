/** Diagnostic CLI for a bounded fresh child; SOURCE ONLY until runtime grant. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire}from 'node:module';
import {realpathSync,openSync,closeSync}from 'node:fs';
import {createHash}from 'node:crypto';
import {createOwnedProvider}from './bochs-cpu3-native-owned-clock/provider.mjs';
import {writeJournalRecord}from './bochs-cpu3-native-hot-direct/journal.mjs';
import {validateInput,boundedBytes,authenticateConfiguration}from './bochs-cpu3-native-owned-main/admission.mjs';
import {checkBootstrap}from './bochs-cpu3-native-owned-main/bootstrap.mjs';
import {sha256} from './bochs-cpu3-native-owned-clock/derive.mjs';
import {ownedChildConfiguration} from './audit-i80386-native-direct-board-adapter.mjs';
import {sourceIdentity as identity,authenticateBuild} from './bochs-cpu3-native-owned-main/identity.mjs';
checkBootstrap(import.meta.url);
const path=process.argv[2];assert.equal(process.argv.length,3);assert.ok(statSync(path).isFile()&&statSync(path).size<=16384);const input=validateInput(JSON.parse(readFileSync(path)));
for(const k of ['addon','sha256','configuration','baseline','output'])assert.equal(typeof input[k],'string');assert.ok(input.output.startsWith('/'));assert.ok(!input.profile,'no profiler protocol');
const baselineBytes=boundedBytes(input.baseline,16*1024*1024);assert.equal(sha256(baselineBytes),'c079fc196461e7d062df7e6a8a9b13b28ab9014b36a1040698fc5bab91ecdc5f');const baseline=JSON.parse(baselineBytes),targets=Object.entries(baseline.boundaries).map(([name,v])=>({name,q:v.q,cpu:v.cpu})).sort((a,b)=>a.q-b.q);assert.deepEqual(targets.map(t=>t.q),[177,183,80183,80187,100667,100681]);
const admittedConfiguration=authenticateConfiguration(input.configuration);
const source=identity(),provenance=authenticateBuild(input,source);mkdirSync(input.output,{recursive:false});const config=ownedChildConfiguration(admittedConfiguration,input.output+'/guest');writeFileSync(config.path,config.text,{flag:'wx'});
// No exported native/provider capability. All artifact admission precedes require.
const serialize=v=>JSON.stringify(v,(_,v)=>typeof v==='bigint'?v.toString():v instanceof Uint8Array?[...v]:v);
assert.equal(input.sha256,'144f3af7b906e46bfb68c10b991fef15847d81c60e7bb44820ee73653e723818');
const startupStart=process.hrtime.bigint();let rows=0,bytes=0,closed=false,terminalLocal=false;const digest=createHash('sha256'),fd=openSync(input.output+'/callbacks.jsonl','wx');
const provider=createOwnedProvider({compactSink:input.hostJournal!==false?e=>{const line=serialize([e.ordinal,e.operation,e.args,e.result,e.nativeTicks,e.successfulQuanta,e.boardCycles,e.debt,e.mappingEpoch])+'\n';assert.ok(bytes+Buffer.byteLength(line)<=32*1024*1024);writeJournalRecord(fd,line);digest.update(line);bytes+=Buffer.byteLength(line);rows++;}:null});
assert.equal(sha256(provider.rom),'0c020faecb76160cfc748ca909d498a69ae47dd19a365891ccb20b3b5186b631');assert.equal(sha256(readFileSync(config.path)),config.sha256);const addonPath=realpathSync(input.addon);assert.ok(statSync(addonPath).isFile()&&statSync(addonPath).size<=256*1024*1024);assert.equal(sha256(readFileSync(addonPath)),input.sha256);
const api=createRequire(import.meta.url)(addonPath);assert.equal(api.abiVersion,3);for(const k of ['create','resume','setIRQ','inspect','close'])assert.equal(typeof api[k],'function');const {create,resume,setIRQ,inspect,close}=api;
const reset=create(config.path,provider.rom,provider.callbacks,input.nativeTrace===true),startupNs=Number(process.hrtime.bigint()-startupStart);
const handle={resume(n,q,deadline){assert.ok(!closed&&!terminalLocal);assert.ok(Number.isSafeInteger(n)&&n>0&&n<=600&&Number.isSafeInteger(q)&&q>0&&q<=300);assert.ok(typeof deadline==='string'&&/^[0-9]{1,20}$/.test(deadline));const d=BigInt(deadline);assert.ok(d<=0xffffffffffffffffn);const staged=provider.stage();if(staged.changed)setIRQ(staged.asserted);provider.begin();let result;try{result=resume(n,q,d);}finally{provider.end();}terminalLocal=result.reason===4&&result.chargedNativeTicks===0&&result.chargedQuanta===0;return result;},checkpoint(){assert.ok(!closed);return provider.checkpoint();},close(){assert.ok(!closed&&terminalLocal);const final=inspect();assert.equal(final.nativeTicks,100684n);assert.equal(final.successfulQuanta,100682n);const result=provider.terminal();assert.equal(result.state.marker,'RPGH001');close();provider.close();closeSync(fd);closed=true;result.journal={rows,bytes,sha256:digest.digest('hex')};return result;},abort(){if(!closed){closed=true;try{closeSync(fd);}catch{}}}};
const checkpoints=[];let target=0,final,resumes=0,terminal=false;
const executionCPUStart=process.cpuUsage();const executionStart=process.hrtime.bigint();
try{
 for(let i=0;i<160001;i++){
  const remaining=target<targets.length?targets[target].q-Number(final?.successfulQuanta??0):300;assert.ok(remaining>0);
  final=handle.resume(600,Math.min(300,remaining),'18446744073709551615');resumes++;
  if(target<targets.length&&Number(final.successfulQuanta)===targets[target].q){const t=targets[target++];assert.equal(final.state[8],t.cpu.eip);assert.equal(final.state[13],t.cpu.cs);checkpoints.push({kind:'exact-Q-boundary',name:t.name,q:t.q,resume:resumes,native:final,board:handle.checkpoint()});}
  if(final.reason===4&&final.chargedNativeTicks===0&&final.chargedQuanta===0){terminal=true;break;}
  assert.ok(Number(final.nativeTicks)<=160000&&Number(final.successfulQuanta)<=150000);
 }
 const executionNs=Number(process.hrtime.bigint()-executionStart),cpu=process.cpuUsage(executionCPUStart),executionCPU={unit:'microseconds',user:cpu.user,system:cpu.system,total:cpu.user+cpu.system};assert.ok(terminal&&target===6);
 const settlementStart=process.hrtime.bigint(),settled=handle.close(),settlementNs=Number(process.hrtime.bigint()-settlementStart);
 assert.deepEqual(identity(),source);assert.deepEqual(authenticateBuild(input,source),provenance);assert.equal(settled.state.javascriptCpuCycles,0);assert.equal(settled.state.board.debt,0);assert.equal(final.execution.faults,2n);assert.equal(final.execution.irqDeliveries,1n);assert.ok(Object.values(final.fallback).every(v=>v===0n));
 const report={status:'UNQUALIFIED_ABI3_NATIVE_CANDIDATE',source,provenance,priorH4:{runtime:'89acf83dda501a097550e0465b4db2351229a991e51cbf8439d43bad77d4a42a',napi:'b57a3cea1f5f5eea2092401f8dba3041eb0bc0d19551bf4273e66ad7372c60cb'},addon:{path:input.addon,sha256:sha256(readFileSync(input.addon))},configuration:config,reset,final,resumes,terminal,checkpoints,settled:settled.state,ramSha256:settled.ramSha256,journal:settled.journal,timing:{startupNs,executionNs,executionCPU,settlementNs,scope:'local main-thread resume execution and six board checkpoints; includes native snapshots; CPU measurement must include all process threads'},closed:{native:true,board:true,freshChildMain:true}};
 writeFileSync(input.output+'/capture.json',JSON.stringify(JSON.parse(serialize(report)),null,2),{flag:'wx'});
}catch(e){await handle.abort();throw e;}
