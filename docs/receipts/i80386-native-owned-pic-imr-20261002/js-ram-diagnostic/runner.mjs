/** Actual bounded compatibility-board baseline; no native or speed claim. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,openSync,writeSync,closeSync} from 'node:fs';
import {sourceIdentity as identity}from '/tmp/bw-board-386-owned-pic-imr-source-20261002/scripts/bochs-cpu3-native-owned-pic-imr/identity.mjs';
import {writeJournalRecord} from '/tmp/bw-board-386-owned-pic-imr-source-20261002/scripts/bochs-cpu3-native-hot-direct/journal.mjs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {ExperimentalI80386ATMachine} from '/tmp/bw-board-386-owned-pic-imr-source-20261002/src/experimental/i80386-at-machine.js';
import {combinedBoardConfig,combinedBoardState} from '/tmp/bw-board-386-owned-pic-imr-source-20261002/scripts/bochs-cpu3-native-combined-paging-ram/host.mjs';
import {assembleOwnedPicImrRom,hotWorkload} from '/tmp/bw-board-386-owned-pic-imr-source-20261002/scripts/i80386-free-owned-pic-imr.mjs';
const root='/tmp/bw-board-386-owned-pic-imr-source-20261002',git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim(),sha=b=>createHash('sha256').update(b).digest('hex');
import {ramResetEvidence}from '/tmp/bw-board-386-owned-pic-imr-source-20261002/scripts/bochs-cpu3-native-owned-in8/reset-witness.mjs';
const output=process.argv[2];assert.ok(output?.startsWith('/'),'new absolute output directory');assert.equal(git(['status','--porcelain']),'','clean source required');const source=identity();mkdirSync(output,{recursive:false});
const {rom,symbols,sha256,sourceSha256}=assembleOwnedPicImrRom();let q=0,attempts=0,rows=0,bytes=0;const fd=openSync(output+'/events.jsonl','wx'),digest=createHash('sha256'),boundaries={},ports=[],deliveries=[];
const m=new ExperimentalI80386ATMachine(combinedBoardConfig,{onPortAccess:e=>{ports.push({q,attempts,cycles:m.cycles,...e});record(['PIO',q,attempts,m.cycles,e.dir,e.port,e.value]);}});
function record(row){const s=JSON.stringify(row)+'\n';bytes+=Buffer.byteLength(s);assert.ok(bytes<=32*1024*1024,'compact evidence byte bound');writeJournalRecord(fd,s);digest.update(s);rows++;}
function cpu(){const c=m.cpu;return {eax:c.eax,ebx:c.ebx,ecx:c.ecx,edx:c.edx,esp:c.esp,eip:c.eip,cs:c.cs,cr0:c.cr0,cr2:c.cr2,cr3:c.cr3,cycles:c.cycles,cpuProfile:c.cpuProfile,strict386:c._strict386};}
m.loadRom(rom,0xf0000);m.loadRom(rom);const seedSha256=sha(m.mem);m.reset();const reset={cpu:cpu(),board:combinedBoardState(m)};
for(const method of ['interrupt','_deliverFault']){const original=m.cpu[method];m.cpu[method]=(...args)=>{const kind=method==='interrupt'?'irq':'fault',vector=kind==='irq'?args[0]:args[0].vector,result=original.apply(m.cpu,args);deliveries.push({kind,vector,q,attempts,cpu:cpu(),frame:[...m.mem.subarray(m.cpu.esp&65535,(m.cpu.esp&65535)+(kind==='irq'?12:16))]});record(['DELIVERY',kind,vector,q,attempts,m.cpu.eip,m.cpu.esp]);return result;};}
const write=m.cpu._rawWrite;m.cpu._rawWrite=(a,v)=>{write(a,v);record(['WRITE',q,attempts,a>>>0,m._decode386(a),v&255,!!m.cpu._pagingBitWrite]);};if(m.cpu.write===write)m.cpu.write=m.cpu._rawWrite;
const picReads=[];
for(const [port,pic]of [[0x21,m._pic],[0xa1,m.chips.pic2]]){const original=pic.read;pic.read=function(reg){const before=pic.getState(),value=Reflect.apply(original,pic,[reg]),after=pic.getState();picReads.push({port,reg,value,q,attempts,before,after});return value;};}
const names=['hot_profile_start','hot_register_loop','hot_register_end','hot_memory_loop','hot_memory_end','terminal_hlt'];
try{
 while(!m.cpu.halted&&attempts<hotWorkload.proposedTotalNativeTickCap&&q<hotWorkload.proposedTotalQuantaCap){
  for(const name of names)if(!boundaries[name]&&m.cpu.eip===symbols[name]&&m.cpu.cs===8)boundaries[name]={attempts,q,cpu:cpu(),board:combinedBoardState(m)};
  const before=m.cpu.cycles;attempts++;m.step();const charged=m.cpu.cycles-before;assert.ok(charged===0||charged===1,'one successful step or failed attempt');q+=charged;
  record(['STEP',attempts,q,m.cpu.cs,m.cpu.eip,m.cpu.eax,m.cpu.ebx,m.cpu.ecx,m.cpu.cycles,m.cycles,m._chipDebt]);
 }
 const beforeSettle=combinedBoardState(m);m._catchUpChips();const final={cpu:cpu(),board:combinedBoardState(m),memorySha256:sha(m.mem),witnesses:[...m.mem.subarray(0x560,0x570)],in8Witness:[...m.mem.subarray(0x590,0x592)],picImrWitness:[...m.mem.subarray(0x592,0x594)],checksums:[0x580,0x584,0x588].map(a=>Buffer.from(m.mem.subarray(a,a+4)).readUInt32LE())};
 closeSync(fd);const report={schema:'bw.js-owned-pic-imr.baseline.v1',scope:'actual JS board compatibility-profile baseline only; no native/throughput claim',source,rom:{sha256,sourceSha256,symbols},configuration:combinedBoardConfig,seedSha256,reset,q,attempts,halted:m.cpu.halted,boundaries,ports,deliveries,picReads,beforeSettle,final,journal:{path:'events.jsonl',sha256:digest.digest('hex'),rows,bytes}};
 const ramEvidence=ramResetEvidence(m.mem);assert.deepEqual(ramEvidence.resetWitness,[0,3,0,0,0,0,0,0]);assert.equal(Buffer.from(ramEvidence.resetWitness).readUInt32LE(0),reset.cpu.edx);assert.equal(Buffer.from(ramEvidence.resetWitness).readUInt32LE(4),reset.cpu.cr0);assert.equal(reset.cpu.edx,0x300);assert.equal(reset.cpu.cr0,0);
 writeFileSync(output+'/ram.bin',m.mem,{flag:'wx'});writeFileSync(output+'/ram-evidence.json',JSON.stringify({...ramEvidence,rawRamSha256:sha(m.mem),ownReset:{edx:reset.cpu.edx,cr0:reset.cpu.cr0},scope:'Distinct diagnostic observer; canonical comparison changes only510..517 in hash stream'},null,2),{flag:'wx'});
 assert.deepEqual(identity(),source,'before/after measured source');writeFileSync(output+'/capture.json',JSON.stringify(report,null,2),{flag:'wx'});
 assert.equal(report.halted,true);assert.deepEqual(final.checksums,[hotWorkload.registerChecksum,hotWorkload.registerNext,hotWorkload.memoryChecksum]);assert.deepEqual(final.witnesses,[0x11,0x11,0x22,0x22,0x22,0x22,0x22,0x22,0x55,0x55,0x55,0x55,0x33,0x33,0x44,0x44]);assert.equal(deliveries.filter(e=>e.kind==='fault'&&e.vector===14).length,2);assert.equal(deliveries.filter(e=>e.kind==='irq'&&e.vector===32).length,1);assert.equal(deliveries.length,3);assert.equal(final.board.cycles,4+6*q);assert.equal(final.board.debt,0);assert.ok(ports.some(e=>e.dir==='out'&&e.port===0x21&&e.value===255));assert.equal(Buffer.from(ports.filter(e=>e.dir==='out'&&e.port===0xe9).map(e=>e.value)).toString(),'RPGH001');assert.equal(Object.keys(boundaries).length,names.length);
 const reads=ports.filter(e=>e.dir==='in');assert.deepEqual(reads.map(e=>e.port),[0x40,0x40,0x21,0xa1]);assert.deepEqual(final.in8Witness,reads.slice(0,2).map(e=>e.value));assert.deepEqual(final.picImrWitness,[255,255]);assert.deepEqual(picReads.map(r=>[r.port,r.reg,r.value]),[[0x21,1,255],[0xa1,1,255]]);for(const r of picReads){assert.equal(r.before.pollPending,false);assert.equal(r.before.imr,255);assert.deepEqual(r.after,r.before,'IMR read preserves complete actual PIC state');}
 writeFileSync(output+'/result.json',JSON.stringify({status:'ACTUAL_JS_PIC_IMR_BASELINE_PASS',q,attempts,journal:report.journal,sourceInputs:Object.keys(source.hashes).length}),{flag:'wx'});
}catch(error){try{closeSync(fd);}catch{}throw error;}
