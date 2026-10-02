/** Child-only capture-OFF hot diagnostic. Native fatal errors remain process-contained. */
import assert from 'node:assert/strict';
import {Session} from 'node:inspector';
import {installDirectProfile} from 'file:///tmp/bw-board-386-native-hot-property-keys-20261001/scripts/profile-i80386-native-direct-board-adapter.mjs';
import {writeJournalRecord} from 'file:///tmp/bw-board-386-native-hot-property-keys-20261001/scripts/bochs-cpu3-native-hot-direct/journal.mjs';
import {readFileSync,writeFileSync,mkdirSync,openSync,writeSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assembleCombinedHotRom,hotWorkload} from 'file:///tmp/bw-board-386-native-hot-property-keys-20261001/scripts/i80386-free-combined-hot.mjs';
import {HotDirectBoardFacade} from 'file:///tmp/bw-board-386-native-hot-property-keys-20261001/scripts/bochs-cpu3-native-hot-direct/board.mjs';
import {loadHotNative} from 'file:///tmp/bw-board-386-native-hot-property-keys-20261001/scripts/bochs-cpu3-native-hot-direct/loader.mjs';
import {hotNativeProfile} from 'file:///tmp/bw-board-386-native-hot-property-keys-20261001/scripts/bochs-cpu3-native-hot-direct/profile.mjs';
import {ownedChildConfiguration} from 'file:///tmp/bw-board-386-native-hot-property-keys-20261001/scripts/audit-i80386-native-direct-board-adapter.mjs';
const root='/tmp/bw-board-386-native-hot-property-keys-20261001',sha=b=>createHash('sha256').update(b).digest('hex'),git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
function identity(){const revision=git(['rev-parse','HEAD']),paths=new Set();function visit(p){if(paths.has(p))return;paths.add(p);const raw=readFileSync(resolve(root,p));assert.equal(sha(raw),sha(execFileSync('git',['show',revision+':'+p],{cwd:root,maxBuffer:32<<20})),p);if(/\.(?:mjs|js)$/.test(p))for(const m of raw.toString().matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g))visit(resolve(root,dirname(p),m[1]).slice(root.length+1));}for(const p of ['package.json','scripts/run-i80386-native-hot-direct.mjs','test/fixtures/i80386-free-combined-hot.S','test/i80386-native-hot-direct.test.mjs','test/i80386-native-hot-journal.test.mjs'])visit(p);return {revision,hashes:Object.fromEntries([...paths].sort().map(p=>[p,sha(readFileSync(resolve(root,p)))]))};}
const input=JSON.parse(readFileSync(process.argv[2]));assert.equal(typeof input.baseline,'string','actual JS reference required');const baselineBytes=readFileSync(input.baseline);assert.equal(sha(baselineBytes),'c079fc196461e7d062df7e6a8a9b13b28ab9014b36a1040698fc5bab91ecdc5f','actual final47 JS reference');const baseline=JSON.parse(baselineBytes),targets=Object.entries(baseline.boundaries).map(([name,value])=>({name,q:value.q,cpu:value.cpu})).sort((a,b)=>a.q-b.q);assert.deepEqual(targets.map(t=>t.q),[177,183,80183,80187,100667,100681]);let targetIndex=0;assert.equal(git(['status','--porcelain']),'','clean source');const source=identity();assert.ok(input.output.startsWith('/'));mkdirSync(input.output,{recursive:false});const config=ownedChildConfiguration(readFileSync(input.configuration,'utf8'),input.output+'/guest');writeFileSync(config.path,config.text,{flag:'wx'});const {rom,symbols,sha256}=assembleCombinedHotRom(),loadedNative=loadHotNative(input.addon,input.sha256,rom);let native=loadedNative;
const fd=openSync(input.output+'/callbacks.jsonl','wx'),digest=createHash('sha256');let bytes=0,records=0,resumes=0;const checkpoints=[],counts={};
const board=new HotDirectBoardFacade(rom,{compactSink:input.hostJournal===false?null:e=>{const line=JSON.stringify([e.ordinal,e.operation,e.args,e.result,e.nativeTicks,e.successfulQuanta,e.boardCycles,e.debt,e.mappingEpoch],(_,v)=>v instanceof Uint8Array?[...v]:typeof v==='bigint'?v.toString():v)+'\n';assert.ok(bytes+Buffer.byteLength(line)<=32*1024*1024,'compact journal before write byte bound');writeJournalRecord(fd,line);digest.update(line);bytes+=Buffer.byteLength(line);records++;}});
const originalCall=board._call;board._call=function(operation,...args){counts[operation]=(counts[operation]??0)+1;return originalCall.call(this,operation,...args);};

const control=input.control??'baseline';const controlFile=input.output+'/control.jsonl';writeFileSync(controlFile,'',{flag:'wx'});let controlEvents=0;
function event(name,data={}){assert.ok(++controlEvents<=32,'bounded controls');const f=openSync(controlFile,'a');try{writeJournalRecord(f,JSON.stringify({name,...data})+'\n');}finally{closeSync(f);}}
const mapOriginal=board.mappingState,quantumOriginal=board.quantum,tickOriginal=board.nativeTick;let attacked=false;
if(control==='method-swap'){
 board.quantum=function(...args){const r=quantumOriginal.apply(this,args);if(!attacked){attacked=true;event('quantum-original');board.mappingState=function(){assert.equal(this,board);event('mapping-replacement');board.mappingState=mapOriginal;return mapOriginal.call(this);};board.nativeTick=function(...a){assert.equal(this,board);event('tick-replacement');board.nativeTick=tickOriginal;return tickOriginal.apply(this,a);};}return r;};
}else if(control==='getter-order'){
 board.mappingState=function(){const r=mapOriginal.call(this);if(attacked)return r;attacked=true;event('mapping-original');const o={};Object.defineProperty(o,'mappingEpoch',{get(){assert.equal(this,o);event('epoch-getter');Object.defineProperty(o,'boardA20',{get(){assert.equal(this,o);event('later-a20-getter');return r.boardA20;}});return r.mappingEpoch;}});return o;};
}else if(control==='reentry'){
 board.mappingState=function(){const r=mapOriginal.call(this);if(!attacked){attacked=true;event('reentry-before');assert.throws(()=>native.resume(1,1,0xffffffffffffffffn),/reentry/);event('reentry-rejected');}return r;};
}else if(control==='throw-getter'||control.startsWith('invalid-')){
 board.mappingState=function(){const r=mapOriginal.call(this);if(attacked)return r;attacked=true;const o={};Object.defineProperty(o,'mappingEpoch',{get(){event('epoch-getter');if(control==='throw-getter')throw Error('H3-hostile-getter');return control==='invalid-nan'?NaN:control==='invalid-fraction'?0.5:control==='invalid-negative'?-1:4294967296;}});Object.defineProperty(o,'boardA20',{get(){event('forbidden-later-getter');return r.boardA20;}});return o;};
}else assert.equal(control,'baseline');

const start=process.hrtime.bigint(),reset=native.create(config.path,rom,board,input.nativeTrace===true),startupNs=Number(process.hrtime.bigint()-start);
const profiler=input.profile?installDirectProfile(board,native):null;if(profiler)native=profiler.native;
const session=input.profile?new Session():null;const inspectorPost=(method)=>new Promise((resolve,reject)=>session.post(method,(error,result)=>error?reject(error):resolve(result)));
if(session){session.connect();await inspectorPost('Profiler.enable');await inspectorPost('Profiler.start');}
const executionStart=process.hrtime.bigint();let final,terminal=false,executionProfile,inclusiveProfile;
try{for(let i=0;i<160001;i++){
 const line=board.stageLine();if(line.changed)native.setIRQ(line.asserted);board.beginRun();try{const remaining=targetIndex<targets.length?targets[targetIndex].q-board.successfulQuanta:300;assert.ok(remaining>0);final=native.resume(600,Math.min(300,remaining),0xffffffffffffffffn);}finally{board.endRun();}resumes++;
 if(targetIndex<targets.length&&Number(final.successfulQuanta)===targets[targetIndex].q){const target=targets[targetIndex++];assert.equal(final.state[8],target.cpu.eip,'exact selected Q PC');assert.equal(final.state[13],target.cpu.cs,'exact selected Q CS');checkpoints.push({kind:'exact-Q-boundary',name:target.name,q:target.q,resume:resumes,native:final,board:board.inspect()});}

 if(final.reason===4&&final.chargedNativeTicks===0&&final.chargedQuanta===0){terminal=true;break;}
 assert.ok(Number(final.nativeTicks)<=hotNativeProfile.totalNativeTicks&&Number(final.successfulQuanta)<=hotNativeProfile.totalQuanta,'actual total bounds');
 }
 const executionNs=Number(process.hrtime.bigint()-executionStart);
 if(session){executionProfile=(await inspectorPost('Profiler.stop')).profile;session.disconnect();inclusiveProfile=profiler.summary();profiler.restore();native=loadedNative;}
 const settlementStart=process.hrtime.bigint();
 const settled=board.settleTerminal(),ramSha256=sha(board.machine.mem),checksums=[0x580,0x584,0x588].map(a=>Buffer.from(board.machine.mem.subarray(a,a+4)).readUInt32LE()),witnesses=[...board.machine.mem.subarray(0x560,0x570)],rawResetWitness=[...board.machine.mem.subarray(0x510,0x518)];
 native.close();board.close();closeSync(fd);const settlementNs=Number(process.hrtime.bigint()-settlementStart);const report={status:'UNQUALIFIED_NATIVE_HOT_DIAGNOSTIC',captureModes:{nativeRawTrace:input.nativeTrace===true,hostCompactSink:input.hostJournal!==false},baseline:{path:input.baseline,sha256:sha(baselineBytes)},timing:{unit:'nanoseconds',startupNs,executionNs,settlementNs,scope:input.hostJournal===false?'journal-disabled execution includes scheduler, synchronous callbacks, counters and native resume snapshots; not pure engine compute':'diagnostic execution includes compact callback journal, scheduler, resume snapshots; not benchmark'},source,profile:hotNativeProfile,addon:{path:input.addon,sha256:sha(readFileSync(input.addon))},rom:{sha256,symbols},configuration:config,reset,final,terminal,resumes,checkpoints,settled,ramSha256,checksums,witnesses,rawResetWitness,callbackCounts:counts,journal:{rows:records,bytes,sha256:digest.digest('hex')},closed:{native:true,board:true}};
 assert.deepEqual(identity(),source,'before after source');const serializationStart=process.hrtime.bigint();writeFileSync(input.output+'/capture.json',JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,null,2),{flag:'wx'});
 writeFileSync(input.output+'/timing.json',JSON.stringify({...report.timing,serializationAndWriteNs:Number(process.hrtime.bigint()-serializationStart)}),{flag:'wx'});
 assert.ok(terminal,'actual terminal within bounds');assert.equal(targetIndex,targets.length,'all exact Q targets observed');assert.deepEqual(checksums,[hotWorkload.registerChecksum,hotWorkload.registerNext,hotWorkload.memoryChecksum]);assert.deepEqual(witnesses,[17,17,34,34,34,34,34,34,85,85,85,85,51,51,68,68]);assert.equal(settled.marker,'RPGH001');assert.equal(settled.javascriptCpuCycles,0);assert.equal(settled.board.debt,0);assert.equal(final.execution.faults,2n);assert.equal(final.execution.irqDeliveries,1n);assert.ok(Object.values(final.fallback).every(v=>v===0n));
 if(profiler){writeFileSync(input.output+'/profile.json',JSON.stringify({...inclusiveProfile,window:'execution only: after create, before terminal settlement; nested inclusive buckets overlap'},null,2),{flag:'wx'});writeFileSync(input.output+'/execution.cpuprofile',JSON.stringify(executionProfile),{flag:'wx'});}
 if(control!=='baseline')assert.ok(attacked,'control actually executed');
 writeFileSync(input.output+'/result.json',JSON.stringify({status:'NATIVE_HOT_SMOKE_PASS_NOT_QUALIFICATION',nativeTicks:final.nativeTicks,quanta:final.successfulQuanta,resumes,journal:report.journal},(_,v)=>typeof v==='bigint'?v.toString():v),{flag:'wx'});
}catch(error){try{closeSync(fd);}catch{}throw error;}
