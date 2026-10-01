/** Child-only capture-OFF hot diagnostic. Native fatal errors remain process-contained. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,openSync,writeSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assembleCombinedHotRom,hotWorkload} from './i80386-free-combined-hot.mjs';
import {HotDirectBoardFacade} from './bochs-cpu3-native-hot-direct/board.mjs';
import {loadHotNative} from './bochs-cpu3-native-hot-direct/loader.mjs';
import {hotNativeProfile} from './bochs-cpu3-native-hot-direct/profile.mjs';
import {ownedChildConfiguration} from './audit-i80386-native-direct-board-adapter.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),sha=b=>createHash('sha256').update(b).digest('hex'),git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
function identity(){const revision=git(['rev-parse','HEAD']),paths=new Set();function visit(p){if(paths.has(p))return;paths.add(p);const raw=readFileSync(resolve(root,p));assert.equal(sha(raw),sha(execFileSync('git',['show',revision+':'+p],{cwd:root,maxBuffer:32<<20})),p);if(/\.(?:mjs|js)$/.test(p))for(const m of raw.toString().matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g))visit(resolve(root,dirname(p),m[1]).slice(root.length+1));}for(const p of ['package.json','scripts/run-i80386-native-hot-direct.mjs','test/fixtures/i80386-free-combined-hot.S','test/i80386-native-hot-direct.test.mjs'])visit(p);return {revision,hashes:Object.fromEntries([...paths].sort().map(p=>[p,sha(readFileSync(resolve(root,p)))]))};}
const input=JSON.parse(readFileSync(process.argv[2]));assert.equal(git(['status','--porcelain']),'','clean source');const source=identity();assert.ok(input.output.startsWith('/'));mkdirSync(input.output,{recursive:false});const config=ownedChildConfiguration(readFileSync(input.configuration,'utf8'),input.output+'/guest');writeFileSync(config.path,config.text,{flag:'wx'});const {rom,symbols,sha256}=assembleCombinedHotRom(),native=loadHotNative(input.addon,input.sha256,rom);
const fd=openSync(input.output+'/callbacks.jsonl','wx'),digest=createHash('sha256');let bytes=0,records=0,resumes=0,lastPhase=null;const checkpoints=[],counts={};
const board=new HotDirectBoardFacade(rom,{compactSink:e=>{counts[e.operation]=(counts[e.operation]??0)+1;const line=JSON.stringify([e.ordinal,e.operation,e.args,e.result,e.nativeTicks,e.successfulQuanta,e.boardCycles,e.debt,e.mappingEpoch],(_,v)=>v instanceof Uint8Array?[...v]:typeof v==='bigint'?v.toString():v)+'\n';assert.ok(bytes+Buffer.byteLength(line)<=32*1024*1024,'compact journal before write byte bound');writeSync(fd,line);digest.update(line);bytes+=Buffer.byteLength(line);records++;}});
const reset=native.create(config.path,rom,board,false);let final,terminal=false;
try{for(let i=0;i<160001;i++){
 const line=board.stageLine();if(line.changed)native.setIRQ(line.asserted);board.beginRun();try{final=native.resume(600,300,0xffffffffffffffffn);}finally{board.endRun();}resumes++;
 const pc=final.state[8],phase=pc<symbols.hot_profile_start?'correctness-prefix':pc<symbols.hot_register_end?'register':pc<symbols.hot_memory_end?'memory':'completion';
 if(phase!==lastPhase||final.reason===4){assert.ok(checkpoints.length<64,'selected checkpoint bound');checkpoints.push({resume:resumes,phase,native:final,board:board.inspect()});lastPhase=phase;}
 if(final.reason===4&&final.chargedNativeTicks===0&&final.chargedQuanta===0){terminal=true;break;}
 assert.ok(Number(final.nativeTicks)<=hotNativeProfile.totalNativeTicks&&Number(final.successfulQuanta)<=hotNativeProfile.totalQuanta,'actual total bounds');
 }
 const settled=board.settleTerminal(),ramSha256=sha(board.machine.mem),checksums=[0x580,0x584,0x588].map(a=>Buffer.from(board.machine.mem.subarray(a,a+4)).readUInt32LE()),witnesses=[...board.machine.mem.subarray(0x560,0x570)],rawResetWitness=[...board.machine.mem.subarray(0x510,0x518)];
 native.close();board.close();closeSync(fd);const report={status:'UNQUALIFIED_NATIVE_HOT_DIAGNOSTIC',source,profile:hotNativeProfile,addon:{path:input.addon,sha256:sha(readFileSync(input.addon))},rom:{sha256,symbols},configuration:config,reset,final,terminal,resumes,checkpoints,settled,ramSha256,checksums,witnesses,rawResetWitness,callbackCounts:counts,journal:{rows:records,bytes,sha256:digest.digest('hex')},closed:{native:true,board:true}};
 assert.deepEqual(identity(),source,'before after source');writeFileSync(input.output+'/capture.json',JSON.stringify(report,(_,v)=>typeof v==='bigint'?v.toString():v,null,2),{flag:'wx'});
 assert.ok(terminal,'actual terminal within bounds');assert.deepEqual(checksums,[hotWorkload.registerChecksum,hotWorkload.registerNext,hotWorkload.memoryChecksum]);assert.deepEqual(witnesses,[17,17,34,34,34,34,34,34,85,85,85,85,51,51,68,68]);assert.equal(settled.marker,'RPGH001');assert.equal(settled.javascriptCpuCycles,0);assert.equal(settled.board.debt,0);assert.equal(final.execution.faults,2n);assert.equal(final.execution.irqDeliveries,1n);assert.ok(Object.values(final.fallback).every(v=>v===0n));
 writeFileSync(input.output+'/result.json',JSON.stringify({status:'NATIVE_HOT_SMOKE_PASS_NOT_QUALIFICATION',nativeTicks:final.nativeTicks,quanta:final.successfulQuanta,resumes,journal:report.journal},(_,v)=>typeof v==='bigint'?v.toString():v),{flag:'wx'});
}catch(error){try{closeSync(fd);}catch{}throw error;}
