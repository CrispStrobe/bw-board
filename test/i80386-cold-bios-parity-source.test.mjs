/** Pure diagnostic controls; no CPU instruction, native addon or cold capture. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBochsResetColdOracle,bochsResetProfile} from '../scripts/bochs-cpu3-native-cold-bios/bochs-reference.mjs';
import {compareCpu,wholeNativeWords,validateProgress,compareTiming,comparePorts,createBoundaryDigest,boundedCount} from '../scripts/bochs-cpu3-native-cold-bios/parity.mjs';
import {validateDriverInput} from '../scripts/bochs-cpu3-native-cold-bios/external-runner.mjs';
import {regularBytes,compiledRevision} from '../scripts/bochs-cpu3-native-cold-bios/driver-auth.mjs';
const clone=v=>JSON.parse(JSON.stringify(v));
const fallback=()=>Object.fromEntries(['bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer'].map(k=>[k,0]));
const execution=()=>Object.fromEntries(['attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts'].map(k=>[k,0]));
function cpuFixture(){
 return {eax:0,ecx:0,edx:0,ebx:0,esp:0,ebp:0,esi:0,edi:0,eip:0xfff0,eflags:2,cr0:0x7ffffff0,cr2:0,cr3:0,cs:0xf000,ds:0,ss:0,es:0,fs:0,gs:0,pc:0xfffffff0,gdtr:{base:0,limit:0xffff},idtr:{base:0,limit:0xffff},ldtr:{selector:0,base:0,limit:0xffff,present:true,type:2},tr:{selector:0,base:0,limit:0xffff,present:true,type:11},segmentCaches:Object.fromEntries(Array.from({length:6},(_,i)=>[i,{base:i===1?0xffff0000:0,limit:0xffff,default32:false,present:true}])),debugRegisters:[0,0,0,0,0,0,0xffff1ff0,0x400],halted:false,shutdown:false};
}
function nativeFixture(j=cpuFixture()){
 const fields=['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3','cs','ds','ss'];
 const row=(i,selector,c,type=3)=>[i,selector,selector>>>3,(selector>>>2)&1,selector&3,1,Number(c.present),0,1,type,c.base,c.limit,0,Number(!!c.default32),0];
 return {state:[...fields.map(k=>j[k]),j.gdtr.base,j.gdtr.limit,j.idtr.base,j.idtr.limit],extra:[j.debugRegisters[6],j.debugRegisters[7],j.es,j.fs,j.gs,...row(1,j.cs,j.segmentCaches[1]).slice(2),0,0],segments:['es','cs','ss','ds','fs','gs'].flatMap((k,i)=>row(i,j[k],j.segmentCaches[i])),system:['ldtr','tr'].flatMap((k,i)=>row(i+6,j[k].selector,j[k],j[k].type)),debug:[...j.debugRegisters.slice(0,4),j.debugRegisters[6],j.debugRegisters[7]],nativeTicks:0,successfulQuanta:0,mappingEpoch:0,boardA20:1,callbacks:{physicalReads:0},fallback:fallback(),execution:execution(),activityState:0,reason:7,chargedNativeTicks:0,chargedQuanta:0};
}
test('private Bochs reset profile installs once and paused stage does not execute instructions',()=>{
 for(const argument of [null,{},()=>{},bochsResetProfile])assert.throws(()=>createBochsResetColdOracle(argument),/no caller/);
 const oracle=createBochsResetColdOracle();try{const before=oracle.checkpoint(),cpu=before.cpu;assert.equal(cpu.cycles,0);assert.equal(cpu.edx,0);assert.equal(cpu.cr0,0x7ffffff0);assert.deepEqual(cpu.gdtr,{base:0,limit:0xffff});assert.deepEqual(cpu.idtr,{base:0,limit:0xffff});assert.equal(cpu.ldtr.limit,0xffff);assert.equal(cpu.ldtr.type,2);assert.equal(cpu.tr.type,11);assert.equal(cpu.debugRegisters[6],0xffff1ff0);assert.equal(cpu.debugRegisters[7],0x400);assert.equal(cpu.segmentCaches[1].base,0xffff0000);assert.equal(cpu.segmentCaches[1].code,true);assert.deepEqual(oracle.stage(),{asserted:false,changed:false,flushed:false});assert.deepEqual(oracle.checkpoint(),before);assert.deepEqual(oracle.records(),[]);assert.throws(()=>oracle.settleCheckpoint(),/E16/);assert.deepEqual(oracle.checkpoint(),before);}finally{oracle.close();}assert.throws(()=>oracle.stage());assert.throws(()=>oracle.close());
});
test('dynamic represented CPU values compare directly without persistent EDX allowance',()=>{
 const j=cpuFixture(),n=nativeFixture(j);compareCpu(n,j);
 for(const field of ['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr2','cr3','cs','ds','ss','es','fs','gs']){const bad=clone(j);bad[field]=(bad[field]^1)>>>0;assert.throws(()=>compareCpu(n,bad),field);}
 const restored=clone(j);restored.edx=0x64;compareCpu(nativeFixture(restored),restored);restored.edx=0;compareCpu(nativeFixture(restored),restored);const wrong=clone(n);wrong.state[2]=0x300;assert.throws(()=>compareCpu(wrong,j));
 const cr=clone(j);cr.cr0=0x10;assert.throws(()=>compareCpu(nativeFixture(cr),cr),/CR0 scope/);const hidden=clone(n);hidden.extra[18]=1;hidden.extra[19]=7;hidden.segments[9]=11;compareCpu(hidden,j);
 for(const mutate of [x=>x.gdtr.limit--,x=>x.idtr.base++,x=>x.ldtr.present=false,x=>x.tr.limit--,x=>x.debugRegisters[6]=(x.debugRegisters[6]^1)>>>0,x=>x.segmentCaches[3].base++,x=>x.segmentCaches[2].default32=true,x=>x.pc++,x=>x.halted=true]){const bad=clone(j);mutate(bad);assert.throws(()=>compareCpu(n,bad));}
});
test('native Q zero or one alignment keeps N independent and rejects malformed snapshots',()=>{
 const zero=nativeFixture();assert.deepEqual(validateProgress({n:0,q:0},zero),{n:0,q:0,dn:0,dq:0});const rep={...zero,successfulQuanta:1,chargedQuanta:1,reason:1};assert.deepEqual(validateProgress({n:0,q:0},rep),{n:0,q:1,dn:0,dq:1});const independentN={...zero,nativeTicks:1,chargedNativeTicks:1,reason:1};assert.equal(validateProgress({n:0,q:0},independentN).dq,0);
 for(const patch of [{successfulQuanta:2,chargedQuanta:2},{nativeTicks:2,chargedNativeTicks:2},{reason:2},{reason:4},{reason:6},{reason:1},{fallback:{}},{execution:{}},{successfulQuanta:'01'},{nativeTicks:400001},{nativeTicks:-1}])assert.throws(()=>validateProgress({n:0,q:0},{...zero,...patch}));
 for(const field of Object.keys(zero.fallback)){const bad=clone(zero);delete bad.fallback[field];assert.throws(()=>validateProgress({n:0,q:0},bad));}
 for(const field of Object.keys(zero.execution)){const bad=clone(zero);delete bad.execution[field];assert.throws(()=>validateProgress({n:0,q:0},bad));}
 for(const value of [NaN,Infinity,-1,1.5,'','1e2',true,null])assert.throws(()=>boundedCount(value));
});
test('every native word and returned metadata contributes to ordered boundary commitment',()=>{
 const n=nativeFixture(),digest=value=>{const d=createBoundaryDigest();d.append('reset',value);return d.finish();},original=digest(n);assert.equal(original.words,166);assert.equal(wholeNativeWords(n).length,166);
 for(const key of ['state','extra','segments','system','debug'])for(let i=0;i<n[key].length;i++){const changed=clone(n);changed[key][i]=(changed[key][i]^1)>>>0;assert.notEqual(digest(changed).sha256,original.sha256,key+' '+i);}
 for(const patch of [{mappingEpoch:1},{activityState:1},{nativeTicks:1},{callbacks:{physicalReads:1}},{execution:{...n.execution,repPartial:1}},{sliceBytes:Uint8Array.of(1)}])assert.notEqual(digest({...n,...patch}).sha256,original.sha256);
 const d=createBoundaryDigest();d.append('reset',n);d.append('resume',{...n,successfulQuanta:1});const e=createBoundaryDigest();e.append('reset',{...n,successfulQuanta:1});e.append('resume',n);assert.notEqual(d.finish().sha256,e.finish().sha256);
});
test('whole PIO compares actual pre-Q clocks while independent native N is retained',()=>{
 const js=[{ordinal:1,q:3,cycles:16,width:8,dir:'out',port:0x64,value:0xaa},{ordinal:2,q:9,cycles:52,width:8,dir:'in',port:0x60,value:0x55}],native=js.map(p=>({...p,successfulQuanta:p.q-1,nativeTicks:p.q+2}));assert.equal(comparePorts(native,js).ports,2);
 for(const field of ['ordinal','successfulQuanta','cycles','port','value','width']){const changed=clone(native);changed[0][field]++;assert.throws(()=>comparePorts(changed,js));}assert.throws(()=>comparePorts([...native].reverse(),js));assert.throws(()=>comparePorts(native.slice(1),js));
 const timing={q:2,cycles:16,debt:12,deadline:6000,a20Enabled:true},board={successfulQuanta:2,board:{cycles:16,debt:12,deadline:6000,a20Enabled:true}};compareTiming(board,timing);for(const key of ['q','cycles','debt','deadline','a20Enabled'])assert.throws(()=>compareTiming(board,{...timing,[key]:key==='a20Enabled'?false:timing[key]+1}));
});
test('closed driver refuses wrong compiled revision hashes paths and extra input knobs before native load',()=>{
 const input={compiledRoot:'/compiled',compiledRevision,driverRevision:'1'.repeat(40),driverSourceSha256:'2'.repeat(64),addon:'/compiled/addon.node',sha256:'3'.repeat(64),configuration:'/config',preparedManifest:'/manifest',preparedManifestSha256:'4'.repeat(64),buildReceipt:'/receipt',buildReceiptSha256:'5'.repeat(64),output:'/exclusive-output',nativeTrace:false};assert.equal(validateDriverInput(input),input);
 for(const patch of [{compiledRevision:'0'.repeat(40)},{driverRevision:'short'},{nativeTrace:1},{sha256:'wrong'},{compiledRoot:'relative'},{configuration:'/x/../config'},{output:'/out\nput'},{resetEdx:0}])assert.throws(()=>validateDriverInput({...input,...patch}));const missing=clone(input);delete missing.driverSourceSha256;assert.throws(()=>validateDriverInput(missing));
});
test('source admission rejects nonordinary symlink and oversized file inputs before reading',()=>{
 const directory=mkdtempSync(join(tmpdir(),'cold-driver-source-'));try{const file=join(directory,'ordinary'),link=join(directory,'symlink');writeFileSync(file,'abc');assert.equal(regularBytes(file).toString(),'abc');assert.throws(()=>regularBytes(file,2));symlinkSync(file,link);assert.throws(()=>regularBytes(link));assert.throws(()=>regularBytes(directory));assert.throws(()=>regularBytes('relative'));}finally{rmSync(directory,{recursive:true,force:true});}
});
