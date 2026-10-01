/** Actual cold-reset JavaScript board REP/two-PF/PIT/PIC oracle only. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {ExperimentalI80386ATMachine,PCAT80386_EXPERIMENTAL} from '../src/experimental/i80386-at-machine.js';
import {expandI80386SourceInventory} from './lib/i80386-source-inventory.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const fixture='test/fixtures/i80386-free-rep-pf-pit.S';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=x=>JSON.parse(JSON.stringify(x));
export const nativeCr0SourceDifference=Object.freeze({
 status:'pinned-source-expectation-not-native-execution-evidence',
 source:{revision:'0e45b736ef9792eb9b752b0a35db49eaf2faea47',path:'bochs/cpu/crregs.cc',line:1083,sha256:'f39cb6b7b1f7b030690104dcd31e839651a6d343784d8a072e5b337d17fcd374'},
 reason:'CPU_LEVEL=3 SetCR0 ORs 0x7ffffff0 on every write; guest values align defined intent without raw CR0 parity',
 writes:[{operand:0x11,javascript:0x11,bochsCpu3Expected:0x7ffffff1},{operand:0x80000011,javascript:0x80000011,bochsCpu3Expected:0xfffffff1}],comparisonMasks:null,
});
export const knownNativeResetDifferences=Object.freeze({
  status:'documented-source-differences-not-native-execution-evidence',
  javascript:{cr0:0,edx:0x300,gdtrLimit:0,idtrLimit:0x3ff,dr6:0,dr7:0,csType:'code-read-only'},
  bochsCpu3:{cr0:0x7ffffff0,edx:0,gdtrLimit:0xffff,idtrLimit:0xffff,dr6:0xffff1ff0,dr7:0x400,csType:'data-read-write-accessed'},
  comparisonMasks:null,
  undefined386Cr0Bits:0x7fffffe0,
  note:'Raw differences are retained. ET, EDX, descriptor limits and debug registers are not erased to assert parity.',
});
export function assembleRepPfPitRom(){
  const dir=mkdtempSync(path.join(tmpdir(),'bw-rep-pf-pit-rom-'));
  try{
    execFileSync('as',['--32','-o',path.join(dir,'rom.o'),path.join(root,fixture)]);
    execFileSync('ld',['-m','elf_i386','-Ttext','0','-e','setup','-o',path.join(dir,'rom.elf'),path.join(dir,'rom.o')]);
    execFileSync('objcopy',['-O','binary','-j','.text',path.join(dir,'rom.elf'),path.join(dir,'rom.bin')]);
    const rom=readFileSync(path.join(dir,'rom.bin'));
    const symbols={};
    for(const line of execFileSync('nm',['--defined-only',path.join(dir,'rom.o')],{encoding:'utf8'}).trim().split('\n')){
      const [value,,name]=line.trim().split(/\s+/);symbols[name]=parseInt(value,16);
    }
    assert.equal(rom.length,65536);assert.equal(symbols.setup,0x100);
    return {rom,symbols};
  }finally{rmSync(dir,{recursive:true,force:true});}
}
const registers=['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3','cr4','cs','ds','es','ss','fs','gs'];
function cpuState(cpu){
  return clone({...Object.fromEntries(registers.map(k=>[k,cpu[k]>>>0])),pc:cpu.pc>>>0,
    gdtr:cpu.gdtr,idtr:cpu.idtr,ldtr:cpu.ldtr,tr:cpu.tr,segmentCaches:cpu.segmentCaches,
    debugRegisters:[...cpu._debugRegisters],cpuProfile:cpu.cpuProfile,strict386:cpu._strict386,cycles:cpu.cycles,halted:cpu.halted,shutdown:cpu.shutdown,
    interruptShadow:cpu._interruptShadow,nmiShadow:cpu._nmiShadow,debugShadow:cpu._debugShadow,
    coprocessorProfile:cpu._coprocessorProfile});
}
function boardState(m){
  return clone({cycles:m.cycles,debt:m._chipDebt,deadline:m._chipDeadline,
    a20Enabled:m._a20Enabled,a20:m._a20Controller.getState(),fastA20Latch:m._fastA20Latch,cpuResetPending:!!m._cpuResetPending,
    interruptSignals:{nmiPending:!!m._nmiPending,nmiMasked:!!m._nmiMasked,kbdStrobe:!!m._kbdStrobe,pinLevels:{...m._pinLevels}},
    chipStates:Object.fromEntries(Object.entries(m.chips).map(([name,chip])=>{
      assert.equal(typeof chip.getState,'function',`configured chip lacks state snapshot: ${name}`);return [name,chip.getState()];
    })),
    pit:{...m.chips.pit1.getState(),fraction:m.chips.pit1._frac,clockHz:m.chips.pit1.clockHz},
    pic1:m.chips.pic1.getState(),pic2:m.chips.pic2.getState(),rtc:m.chips.rtc1.getState(),
    dma1:m.chips.dma1.getState(),dma2:m.chips.dma2.getState(),systemControl:m.chips.sysctl.getState()});
}
function sourceIdentity(){
  const files=expandI80386SourceInventory(['./i80386-rep-pf-pit-oracle.mjs',
    './run-i80386-rep-pf-pit-oracle.mjs','../'+fixture,
    '../test/i80386-rep-pf-pit-oracle.test.mjs'],import.meta.url);
  const hashes=Object.fromEntries(files.map(f=>{
    const absolute=path.resolve(root,'scripts',f);return [path.relative(root,absolute),sha(readFileSync(absolute))];
  }));
  const boardRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  for(const [file,hash] of Object.entries(hashes))assert.equal(sha(execFileSync('git',['show',`${boardRevision}:${file}`],{cwd:root,maxBuffer:4<<20})),hash,`measured input differs from committed source: ${file}`);
  return {boardRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHashes:hashes};
}
export function runRepPfPitOracle({requireClean=true}={}){
 if(requireClean)assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}),'');
 const source=sourceIdentity(),{rom,symbols}=assembleRepPfPitRom();
 const events=[],steps=[],deliveries=[],chipAdvances=[];let quantum=0,attempt=0,m,pioWidth=null;
 const record=e=>events.push({ordinal:events.length+1,attempt,quantum,boardCycles:m.cycles,...e});
 m=new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL,{onPortAccess:e=>record({kind:'pio',...e,width:pioWidth})});
 const initialBoard=boardState(m);m.loadRom(rom,0xf0000);m.loadRom(rom);const loadedSeedSha256=sha(m.mem);m.reset();
 const reset={cpu:cpuState(m.cpu),board:boardState(m)};
 const advance=m._advanceChips;m._advanceChips=n=>{const before=boardState(m),firstOrdinal=events.length+1;const result=advance.call(m,n);chipAdvances.push({n,attempt,quantum,firstOrdinal,lastOrdinal:events.length,before,after:boardState(m)});return result;};
 const output=m.chips.pit1.hooks.onOutput;m.chips.pit1.hooks.onOutput=(channel,level)=>{record({kind:'pit-output',channel,level,cpu:cpuState(m.cpu),picBefore:clone(m.chips.pic1.getState())});return output(channel,level);};
 for(const [method,kind] of [['fetch','fetch'],['read','read']]){
  const original=m.cpu[method];m.cpu[method]=address=>{const value=original(address);record({kind,address:address>>>0,decoded:m._decode386(address),value,provider:'byte'});return value;};
 }
 for(const [method,kind] of [['fetchRam32','fetch'],['read32','read']]){
  const original=m.cpu[method];m.cpu[method]=address=>{const value=original(address);if(value!==undefined)for(let i=0;i<4;i++){const raw=(address+i)>>>0;record({kind,address:raw,decoded:m._decode386(raw),value:(value>>>(8*i))&255,provider:method});}return value;};
 }
 // write may alias _rawWrite. Replace both through one observer, preserving
 // the original notePhysicalWrite wrapper for ordinary data writes.
 const rawWrite=m.cpu._rawWrite,ordinaryWrite=m.cpu.write;
 const observed=(address,value)=>{const decoded=m._decode386(address),before=m._read386(address);rawWrite(address,value);record({kind:'write',address:address>>>0,decoded,value:value&255,before,after:m._read386(address),paging:!!m.cpu._pagingBitWrite});};
 m.cpu._rawWrite=observed;m.cpu.write=ordinaryWrite===rawWrite?observed:(a,v)=>ordinaryWrite(a,v);
 const out=m.cpu.outPort;m.cpu.outPort=(p,v,w)=>{pioWidth=w;try{return out(p,v,w);}finally{pioWidth=null;}};
 for(const method of ['interrupt','_deliverFault']){
  const original=m.cpu[method];m.cpu[method]=(...args)=>{const before={cpu:cpuState(m.cpu),board:boardState(m)},firstOrdinal=events.length+1;const result=original.apply(m.cpu,args);deliveries.push({kind:method==='interrupt'?'irq':'fault',vector:method==='interrupt'?args[0]:args[0].vector,errorCode:method==='interrupt'?null:args[0].errorCode,before,frame:[...m.mem.subarray(m.cpu.esp&65535,(m.cpu.esp&65535)+(method==='interrupt'?12:16))],after:{cpu:cpuState(m.cpu),board:boardState(m)},firstOrdinal,lastOrdinal:events.length,quantum,attempt});return result;};
 }
 const ack=m._pic.acknowledge.bind(m._pic);m._pic.acknowledge=()=>{const vector=ack();record({kind:'ack',vector});return vector;};
 for(attempt=1;attempt<=302&&!m.cpu.halted;attempt++){
  const before=cpuState(m.cpu),boardBefore=boardState(m),firstOrdinal=events.length+1;
  const charged=m.step();const completed=m.cpu.cycles-before.cycles;if(completed)quantum++;
  steps.push({attempt,quantum,completed,charged,before,after:cpuState(m.cpu),boardBefore,boardAfter:boardState(m),firstOrdinal,lastOrdinal:events.length});
 }
 const beforeSettle={cpu:cpuState(m.cpu),board:boardState(m)};m._catchUpChips();
 assert.deepEqual(sourceIdentity(),source,'measured source changed during actual execution');
 return {schema:'bw.i80386-js-rep-pf-pit-oracle.v1',claim:'actual-javascript-board-rep-two-pf-pit-pic-only',source,nativeCr0SourceDifference,knownNativeResetDifferences,rom:{sha256:sha(rom),sourceSha256:sha(readFileSync(path.join(root,fixture))),symbols},seed:{sha256:loadedSeedSha256},configuration:clone(PCAT80386_EXPERIMENTAL),initialBoard,reset,events,steps,deliveries,chipAdvances,beforeSettle,final:{cpu:cpuState(m.cpu),board:boardState(m),memorySha256:sha(m.mem),witnesses:[...m.mem.subarray(0x510,0x54c)],destination:[...m.mem.subarray(0x4ff8,0x5008)],page6:[...m.mem.subarray(0x6000,0x6008)],pte5:[...m.mem.subarray(0xa014,0xa018)],pte6:[...m.mem.subarray(0xa018,0xa01c)]}};
}
const checkpointCache=new Map();
export function assertRepPfPitOracle(r){
 const eq=(a,b,label)=>assert.deepEqual(a,b,`REP/PF/PIT oracle: ${label}`);
 const check=(v,label)=>assert(v,`REP/PF/PIT oracle: ${label}`);
 eq(Object.keys(r).sort(),['schema','claim','source','nativeCr0SourceDifference','knownNativeResetDifferences','rom','seed','configuration','initialBoard','reset','events','steps','deliveries','chipAdvances','beforeSettle','final'].sort(),'exact report shape');
 eq(r.nativeCr0SourceDifference,nativeCr0SourceDifference,'source-backed CR0 difference without parity masks');eq(r.knownNativeResetDifferences,knownNativeResetDifferences,'raw native reset differences');
 eq(r.schema,'bw.i80386-js-rep-pf-pit-oracle.v1','schema');
 eq(r.claim,'actual-javascript-board-rep-two-pf-pit-pic-only','claim');
 const identity=sourceIdentity();eq(r.source.sourceHashes,identity.sourceHashes,'complete source inventory');
 check(/^[a-f0-9]{40}$/.test(r.source.boardRevision),'source revision');
 // Every accepted report authenticates its committed historical source blobs.
 for(const [file,hash] of Object.entries(r.source.sourceHashes)){
  const bytes=execFileSync('git',['show',`${r.source.boardRevision}:${file}`],{cwd:root,maxBuffer:4<<20,stdio:['ignore','pipe','pipe']});
  eq(sha(bytes),hash,`historical source ${file}`);
 }
 const {rom,symbols}=assembleRepPfPitRom();eq(r.rom,{sha256:sha(rom),sourceSha256:sha(readFileSync(path.join(root,fixture))),symbols},'ROM identity');
 eq(r.configuration,clone(PCAT80386_EXPERIMENTAL),'actual board configuration');
 const memory=Buffer.alloc(PCAT80386_EXPERIMENTAL.memoryBytes);rom.copy(memory,0xf0000);rom.copy(memory,0xff0000);eq(r.seed.sha256,sha(memory),'ROM-only constructor backing');
 eq([r.reset.cpu.pc,r.reset.cpu.edx,r.reset.cpu.cr0,r.reset.board.cycles,r.reset.board.debt],[0xfffffff0,0x300,0,4,0],'raw cold reset');
 eq(r.events[0].address,0xfffffff0,'first physical fetch');eq(r.events[0].value,0xea,'reset far jump');
 let ordinal=0;
 for(const e of r.events){
  eq(e.ordinal,++ordinal,'raw ordinal');
  if(['fetch','read','write'].includes(e.kind)){
   check(Number.isInteger(e.address)&&e.address>=0&&e.address<=0xffffffff,'raw uint32 address');
   const decoded=e.address>=0xffff0000?0xff0000+(e.address-0xffff0000):e.address;eq(e.decoded,decoded,'actual fixed-ON AT decode');
   check(decoded<memory.length,'bounded mapped physical backing');
   check(Number.isInteger(e.value)&&e.value>=0&&e.value<=255,'canonical uint8 bus value');
   if(e.kind==='write'){eq(e.before,memory[decoded],'write before byte');eq(e.after,e.value,'ordinary RAM and paging write commit');check(PCAT80386_EXPERIMENTAL.regions.some(region=>region.kind==='ram'&&decoded>=region.start&&decoded<=region.end)&&!(decoded>=0xa0000&&decoded<=0xbffff),'ordinary configured RAM write excludes video/MMIO');memory[decoded]=e.value;}
   else eq(e.value,memory[decoded],'full ordered physical read byte');
  }
 }
 eq(sha(memory),r.final.memorySha256,'full backing replay');
 const dword=a=>memory.readUInt32LE(a);
 eq([dword(0x510),dword(0x514)],[0x300,0],'guest raw reset witnesses');
 eq([dword(0x520),memory[0x524],dword(0x528),memory[0x530],memory[0x534]],[0x5000,2,0x6000,1,1],'fault and IRQ witnesses');
 eq([...memory.subarray(0x4ff8,0x5008)],Array(4).fill([0x44,0x33,0x22,0x11]).flat(),'partial and retried REP data');
 eq([...memory.subarray(0x6000,0x6008)],[0x88,0x77,0x66,0x55,0xcc,0xbb,0xaa,0x99],'ordinary retry plus one REP');
 eq([dword(0xa014),dword(0xa018)],[0x5063,0x6063],'actual accessed/dirty PTE effects');
 eq([memory[0x60d],memory[0x615]],[0x9b,0x93],'guest-created descriptor accessed effects');
 let q=0,previous=r.reset.cpu,board=r.reset.board,nextOrdinal=1;
 const pitCheck=b=>{const remainder=Number((BigInt(b.cycles-b.debt)*1193182n)%6000000n)/6000000;check(Math.abs(b.pit.fraction-remainder)<1e-11,'independent rational PIT oscillator');eq(Object.keys(b.chipStates).sort(),Object.keys(r.reset.board.chipStates).sort(),'all configured chips');eq(Object.keys(b.chipStates).length,11,'configured chip census');};
 for(const s of r.steps){
  eq(s.before,previous,'CPU checkpoint continuity');eq(s.boardBefore,board,'board continuity');eq(s.firstOrdinal,nextOrdinal,'attempt journal start');nextOrdinal=s.lastOrdinal+1;
  eq(s.completed,s.after.cycles-s.before.cycles,'actual completion counter');check(s.completed===0||s.completed===1,'single element work');q+=s.completed;eq(s.quantum,q,'Q ledger');eq(s.charged,s.completed*6,'failed attempts charge zero');eq(s.boardAfter.cycles-s.boardBefore.cycles,s.charged,'board clocks');pitCheck(s.boardBefore);pitCheck(s.boardAfter);previous=s.after;board=s.boardAfter;
 }
 eq(r.steps.filter(s=>s.after.cr0!==s.before.cr0).map(s=>[s.before.cr0,s.after.cr0]),[[0,0x11],[0x11,0x80000011]],'actual guest CR0 transitions');
 eq([q,r.steps.length,r.final.board.cycles],[135,137,814],'compact fixed work census');eq(nextOrdinal,r.events.length+1,'attempt journal exhaustion');
 eq(r.beforeSettle,{cpu:previous,board},'pre-settle mirror');eq(r.final.cpu,previous,'no idle execution after HLT');eq(r.final.board.debt,0,'settled chip debt');pitCheck(r.final.board);
 eq(r.deliveries.map(d=>[d.kind,d.vector,d.errorCode,d.quantum]),[['fault',14,2,73],['fault',14,2,90],['irq',32,null,108]],'actual fault/IRQ chronology');
 for(const d of r.deliveries){eq(d.after.cpu.cycles,d.before.cpu.cycles,'delivery no successful Q');eq(d.after.board.cycles,d.before.board.cycles,'delivery zero clocks');eq(d.after.cpu.esp,d.kind==='fault'?0x8ff0:0x8ff4,'mapped precise frame');}
 const [pf1,pf2,irq]=r.deliveries;
 eq([pf1.before.cpu.eip,pf1.before.cpu.ecx,pf1.before.cpu.edi,pf1.after.cpu.cr2],[symbols.rep_fill,2,0x5000,0x5000],'REP fault partial progress');
 eq([pf2.before.cpu.eip,pf2.after.cpu.cr2],[symbols.ordinary_fault_store,0x6000],'ordinary fault restart');
 const words=bytes=>[0,4,8,12].filter(i=>i<bytes.length).map(i=>Buffer.from(bytes).readUInt32LE(i));
 eq(words(pf1.frame),[2,symbols.rep_fill,8,(pf1.before.cpu.eflags|0x10000)],'first precise fault frame');eq(words(pf2.frame),[2,symbols.ordinary_fault_store,8,(pf2.before.cpu.eflags|0x10000)],'second precise frame');
 check(r.events.filter(e=>e.kind==='write'&&e.paging).length>0,'paging physical writes retained');
 eq(words(irq.frame),[symbols.after_shadow,8,irq.before.cpu.eflags],'STI successor IRQ frame');eq(dword(0x540),symbols.after_shadow,'guest IRQ frame copy');
 const rep=r.steps.filter(s=>s.before.eip===symbols.rep_fill&&s.before.cs===8);eq(rep.map(s=>[s.before.ecx,s.before.edi,s.completed]),[[4,0x4ff8,1],[3,0x4ffc,1],[2,0x5000,0],[2,0x5000,1],[1,0x5004,1]],'REP element/fault/resume ledger');
 const zero=r.steps.find(s=>s.before.eip===symbols.zero_rep);eq([zero.before.ecx,zero.completed,zero.charged],[0,1,6],'zero REP ordinary charge');check(!r.events.slice(zero.firstOrdinal-1,zero.lastOrdinal).some(e=>e.address>=0x6000&&e.address<0x7000),'zero REP no destination touch');
 const one=r.steps.find(s=>s.before.eip===symbols.rep_one);eq([one.before.ecx,one.after.ecx,one.after.edi,one.charged],[1,0,0x6008,6],'final REP charge once');
 const edge=r.steps.filter(s=>s.boardBefore.pic1.irr===0&&s.boardAfter.pic1.irr===1);eq(edge.length,1,'single real PIT PIC edge');eq([edge[0].quantum,edge[0].before.eip,edge[0].before.ecx],[73,symbols.rep_fill,3],'edge inside REP');check(!(edge[0].before.eflags&0x200),'CLI pending edge');
 const rises=r.events.filter(e=>e.kind==='pit-output'&&e.channel===0&&e.level===1);eq(rises.length,1,'single actual PIT callback rise');eq([rises[0].quantum,rises[0].cpu.eip,rises[0].cpu.ecx,rises[0].cpu.edi],[72,symbols.rep_fill,3,0x4ffc],'actual edge precedes second REP fetch');
 let advanced=4;
 for(const a of r.chipAdvances){
  check(Number.isInteger(a.n)&&a.n>0,'positive actual chip advancement');
  const beforeTicks=BigInt(advanced)*1193182n/6000000n;
  const initial=Number((BigInt(advanced)*1193182n)%6000000n)/6000000;
  check(Math.abs(a.before.pit.fraction-initial)<1e-11,'advance prior rational phase');
  advanced+=a.n;
  const afterTicks=BigInt(advanced)*1193182n/6000000n;
  const final=Number((BigInt(advanced)*1193182n)%6000000n)/6000000;
  check(Math.abs(a.after.pit.fraction-final)<1e-11,'advance resulting rational phase');
  const counter=a.before.pit.counters[0],after=a.after.pit.counters[0];
  // This independent arithmetic admits only this fixture's binary mode-0
  // countdown. It does not claim an independent general 8254 model.
  if(counter.mode===0&&counter.gate===1&&!counter.nullCount&&counter.armed){
   eq(counter.bcd,0,'bounded binary mode-0 timer');
   const ce=Math.max(0,counter.ce-Number(afterTicks-beforeTicks));
   eq(after.ce,ce,'independent mode-0 counter transition');
   eq(after.out,counter.ce>0&&ce===0?1:counter.out,'independent mode-0 output transition');
  }
  eq(a.before.cycles,a.after.cycles,'chip advance does not charge CPU');
 }
 eq(advanced,814,'actual chip advance total');
 for(const s of r.steps.filter(s=>!s.completed)){
  const target=s.after.cr2;
  check(!r.events.slice(s.firstOrdinal-1,s.lastOrdinal).some(e=>e.kind==='write'&&!e.paging&&e.address>=target&&e.address<target+4),'failed attempt has no user destination write');
 }
 eq(r.events.filter(e=>e.kind==='ack').map(e=>[e.vector,e.quantum]),[[32,108]],'actual master ACK');
 eq(r.events.filter(e=>e.kind==='pio'&&e.port===0xe9).map(e=>String.fromCharCode(e.value)).join(''),'RPPT001','guest marker');
 eq(r.events.filter(e=>e.kind==='pio'&&e.port===0x20&&e.value===0x20).length,1,'actual EOI');
 check(r.final.cpu.halted&&!r.final.cpu.shutdown&&!(r.final.cpu.eflags&0x200),'masked terminal HLT');
 const key=JSON.stringify(identity.sourceHashes);if(!checkpointCache.has(key))checkpointCache.set(key,runRepPfPitOracle({requireClean:false}));
 const actual=checkpointCache.get(key);for(const field of ['initialBoard','reset','events','steps','deliveries','chipAdvances','beforeSettle','final'])eq(r[field],actual[field],`cached same-engine checkpoint reexecution ${field}`);
 return {successfulQuantums:q,failedAttempts:2,boardClocks:814,faults:2,irq:32,checkpointVerification:'same-engine-reexecution-not-independent-architectural-oracle'};
}

