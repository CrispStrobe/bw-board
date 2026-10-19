/** Actual JavaScript board protected paging/REP/PF/IRQ/RAM-SMC/A20 oracle only. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {ExperimentalI80386ATMachine,PCAT80386_EXPERIMENTAL} from '../src/experimental/i80386-at-machine.js';
import {expandI80386SourceInventory} from './lib/i80386-source-inventory.mjs';
export const combinedBoardConfiguration=Object.freeze({...PCAT80386_EXPERIMENTAL,experimentalFastA20Port92:true});
const root=fileURLToPath(new URL('../',import.meta.url));
const fixture='test/fixtures/i80386-free-combined-paging-ram.S';
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
export function assembleCombinedPagingRamRom(){
  const dir=mkdtempSync(path.join(tmpdir(),'bw-combined-paging-ram-rom-'));
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
    debugRegisters:[...cpu._debugRegisters],translationCache:{enabled:cpu._translationCacheEnabled,generation:cpu._translationGeneration,tablePages:[...cpu._translationTablePages].sort((a,b)=>a-b)},cpuProfile:cpu.cpuProfile,strict386:cpu._strict386,cycles:cpu.cycles,halted:cpu.halted,shutdown:cpu.shutdown,
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
function sourceIdentity({diagnostic=false}={}){
  const files=expandI80386SourceInventory(['./i80386-combined-paging-ram-oracle.mjs',
    './run-i80386-combined-paging-ram-oracle.mjs','../'+fixture,
    '../test/i80386-combined-paging-ram-oracle.test.mjs'],import.meta.url);
  const hashes=Object.fromEntries(files.map(f=>{
    const absolute=path.resolve(root,'scripts',f);return [path.relative(root,absolute),sha(readFileSync(absolute))];
  }));
  const boardRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  if(!diagnostic)for(const [file,hash] of Object.entries(hashes))assert.equal(sha(execFileSync('git',['show',`${boardRevision}:${file}`],{cwd:root,maxBuffer:4<<20})),hash,`measured input differs from committed source: ${file}`);
  return {qualifiedSource:!diagnostic,boardRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHashes:hashes};
}
export function runCombinedPagingRamOracle({requireClean=true,diagnostic=false}={}){
 if(requireClean)assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}),'');
 const source=sourceIdentity({diagnostic}),{rom,symbols}=assembleCombinedPagingRamRom();
 const events=[],steps=[],deliveries=[],chipAdvances=[];let quantum=0,attempt=0,m,pioWidth=null,mappingEpoch=0;
 const record=e=>events.push({ordinal:events.length+1,attempt,quantum,boardCycles:m.cycles,mappingEpoch,a20Enabled:m._a20Enabled,...e});
 m=new ExperimentalI80386ATMachine(combinedBoardConfiguration,{onPortAccess:e=>record({kind:'pio',...e,width:pioWidth})});
 const initialBoard=boardState(m);m.loadRom(rom,0xf0000);m.loadRom(rom);const loadedSeedSha256=sha(m.mem);m.reset();
 const reset={cpu:cpuState(m.cpu),board:boardState(m)};
 let cacheOrigin='cpu-control',a20Request=null;
 const invalidate=m.cpu.invalidateTranslationCache;m.cpu.invalidateTranslationCache=()=>{const before=m.cpu._translationGeneration,result=invalidate.call(m.cpu);record({kind:'translation-invalidate',origin:cacheOrigin,a20Request,generationBefore:before,generationAfter:m.cpu._translationGeneration});return result;};
 const boardWrite=m._write;m._write=(address,value)=>{const prior=cacheOrigin;cacheOrigin=m.cpu._pagingBitWrite?'board-paging-ad-write':!m._a20Enabled?'board-a20-off-write':'board-table-tracked-write';try{return boardWrite.call(m,address,value);}finally{cacheOrigin=prior;}};
 const a20=m._a20Controller.onA20Change;m._a20Controller.onA20Change=enabled=>{const before=m._a20Enabled,prior=cacheOrigin;cacheOrigin='a20-controller';a20Request=enabled;let result;try{result=a20(enabled);}finally{cacheOrigin=prior;a20Request=null;}if(before!==m._a20Enabled){mappingEpoch++;record({kind:'a20-transition',before,after:m._a20Enabled});}return result;};
 const translate=m.cpu._translate;m.cpu._translate=(linear,options)=>{const firstOrdinal=events.length+1,context={linear:linear>>>0,write:!!options?.write,pagingEnabled:!!(m.cpu.cr0&0x80000000),cr3:m.cpu.cr3>>>0,generation:m.cpu._translationGeneration};try{const physical=translate.call(m.cpu,linear,options);record({kind:'translation',...context,physical:physical>>>0,fault:null,firstOrdinal,lastOrdinal:events.length});return physical;}catch(error){record({kind:'translation',...context,physical:null,fault:{vector:error.vector,errorCode:error.errorCode,cr2:m.cpu.cr2>>>0},firstOrdinal,lastOrdinal:events.length});throw error;}};
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
 for(attempt=1;attempt<=202&&!m.cpu.halted;attempt++){
  const before=cpuState(m.cpu),boardBefore=boardState(m),firstOrdinal=events.length+1;
  if(quantum>=200)break;const charged=m.step();const completed=m.cpu.cycles-before.cycles;if(completed)quantum++;
  steps.push({attempt,quantum,completed,charged,before,after:cpuState(m.cpu),boardBefore,boardAfter:boardState(m),firstOrdinal,lastOrdinal:events.length});
 }
 const beforeSettle={cpu:cpuState(m.cpu),board:boardState(m)};m._catchUpChips();
 assert.deepEqual(sourceIdentity({diagnostic}),source,'measured source changed during actual execution');
 return {schema:'bw.i80386-js-combined-paging-ram-oracle.v1',claim:'actual-javascript-board-protected-paging-rep-pf-irq-ram-smc-a20-only',source,nativeCr0SourceDifference,knownNativeResetDifferences,rom:{sha256:sha(rom),sourceSha256:sha(readFileSync(path.join(root,fixture))),symbols},seed:{sha256:loadedSeedSha256},configuration:clone(combinedBoardConfiguration),initialBoard,reset,events,steps,deliveries,chipAdvances,beforeSettle,final:{cpu:cpuState(m.cpu),board:boardState(m),memorySha256:sha(m.mem),mappingEpoch,smcWitnesses:[...m.mem.subarray(0x560,0x570)],lowCode:[...m.mem.subarray(0x7000,0x7004)],highCode:[...m.mem.subarray(0x107000,0x107004)],witnesses:[...m.mem.subarray(0x510,0x54c)],destination:[...m.mem.subarray(0x4ff8,0x5008)],page6:[...m.mem.subarray(0x6000,0x6008)],pte5:[...m.mem.subarray(0xa014,0xa018)],pte6:[...m.mem.subarray(0xa018,0xa01c)]}};
}
const checkpointCache=new Map();
export function assertCombinedPagingRamOracle(r){
 const eq=(a,b,label)=>assert.deepEqual(a,b,`combined paging/RAM oracle: ${label}`);
 const check=(v,label)=>assert(v,`combined paging/RAM oracle: ${label}`);
 eq(Object.keys(r).sort(),['schema','claim','source','nativeCr0SourceDifference','knownNativeResetDifferences','rom','seed','configuration','initialBoard','reset','events','steps','deliveries','chipAdvances','beforeSettle','final'].sort(),'exact report shape');
 eq(r.nativeCr0SourceDifference,nativeCr0SourceDifference,'source-backed CR0 difference without parity masks');eq(r.knownNativeResetDifferences,knownNativeResetDifferences,'raw native reset differences');
 eq(r.schema,'bw.i80386-js-combined-paging-ram-oracle.v1','schema');
 eq(r.claim,'actual-javascript-board-protected-paging-rep-pf-irq-ram-smc-a20-only','claim');
 check(r.source.qualifiedSource===true,'unqualified diagnostic source rejected');
 const identity=sourceIdentity();eq(r.source.sourceHashes,identity.sourceHashes,'complete source inventory');
 check(/^[a-f0-9]{40}$/.test(r.source.boardRevision),'source revision');
 // Every accepted report authenticates its committed historical source blobs.
 for(const [file,hash] of Object.entries(r.source.sourceHashes)){
  const bytes=execFileSync('git',['show',`${r.source.boardRevision}:${file}`],{cwd:root,maxBuffer:4<<20,stdio:['ignore','pipe','pipe']});
  eq(sha(bytes),hash,`historical source ${file}`);
 }
 const {rom,symbols}=assembleCombinedPagingRamRom();eq(r.rom,{sha256:sha(rom),sourceSha256:sha(readFileSync(path.join(root,fixture))),symbols},'ROM identity');
 eq(r.configuration,clone(combinedBoardConfiguration),'actual board configuration');
 const memory=Buffer.alloc(PCAT80386_EXPERIMENTAL.memoryBytes);rom.copy(memory,0xf0000);rom.copy(memory,0xff0000);eq(r.seed.sha256,sha(memory),'ROM-only constructor backing');
 eq([r.reset.cpu.pc,r.reset.cpu.edx,r.reset.cpu.cr0,r.reset.board.cycles,r.reset.board.debt],[0xfffffff0,0x300,0,4,0],'raw cold reset');
 const firstFetch=r.events.find(e=>e.kind==='fetch');eq(firstFetch.address,0xfffffff0,'first physical fetch');eq(firstFetch.value,0xea,'reset far jump');
 let ordinal=0,a20=true,epoch=0,generation=r.reset.cpu.translationCache.generation;
 for(const e of r.events){
  eq(e.ordinal,++ordinal,'raw ordinal');
  if(e.kind==='a20-transition'){eq(e.before,a20,'A20 transition prior gate');check(e.after!==a20,'real changed A20 gate');a20=e.after;epoch++;}
  eq([e.a20Enabled,e.mappingEpoch],[a20,epoch],'actual event gate and epoch');
  if(e.kind==='translation-invalidate'){eq([e.generationBefore,e.generationAfter],[generation,generation+1],'actual translation generation ledger');generation++;check(e.origin!=='board-paging-ad-write','AD updates exclude cache invalidation');} 
  if(e.kind==='translation'){
   const span=r.events.slice(e.firstOrdinal-1,e.lastOrdinal),reads=span.filter(x=>x.kind==='read');
   eq(e.lastOrdinal+1,e.ordinal,'translation exact interval');
   if(!e.pagingEnabled){eq(e.physical,e.linear,'unpaged raw linear translation');eq(e.fault,null,'unpaged no fault');eq(reads.length,0,'unpaged no table read');}
   else{const pdeAddress=(e.cr3&0xfffff000)+((e.linear>>>22)*4),pde=memory.readUInt32LE(pdeAddress),pteAddress=(pde&0xfffff000)+(((e.linear>>>12)&1023)*4),pte=memory.readUInt32LE(pteAddress);
    check((pde&0x81)===1,'fixture present non-PSE PDE');
    if(reads.length)eq(reads.map(x=>x.address),Array.from({length:4},(_,i)=>pdeAddress+i).concat(Array.from({length:4},(_,i)=>pteAddress+i)),'independent typed PDE/PTE address roles');
    if(pte&1){eq(e.fault,null,'mapped translation no fault');eq(e.physical,((pte&0xfffff000)+(e.linear&4095))>>>0,'bounded fixture translated physical page');}
    else eq([e.physical,e.fault],[null,{vector:14,errorCode:e.write?2:0,cr2:e.linear}],'unmapped translation precise PF cause');
   }
  }
  if(['fetch','read','write'].includes(e.kind)){
   check(Number.isInteger(e.address)&&e.address>=0&&e.address<=0xffffffff,'raw uint32 address');
   const gated=a20?e.address:(e.address&~0x100000)>>>0,decoded=gated>=0xffff0000?0xff0000+(gated-0xffff0000):gated;eq(e.decoded,decoded,'actual raw A20 then reset-alias decode');
   check(decoded<memory.length,'bounded mapped physical backing');
   check(Number.isInteger(e.value)&&e.value>=0&&e.value<=255,'canonical uint8 bus value');
   if(e.kind==='write'){if(e.paging&&(e.address&3)===0){const group=r.events.slice(e.ordinal-1,e.ordinal+3);check(group.length===4&&group.every((x,i)=>x.kind==='write'&&x.paging&&x.address===e.address+i),'whole typed AD update');const old=Buffer.from(group.map(x=>x.before)).readUInt32LE(),next=Buffer.from(group.map(x=>x.value)).readUInt32LE();check((old&1)!==0&&next!==old&&((next^old)&~0x60)===0&&((next|old)>>>0)===next,'AD preserves physical/permission bits and sets only accessed/dirty');}eq(e.before,memory[decoded],'write before byte');eq(e.after,e.value,'ordinary RAM and paging write commit');check(PCAT80386_EXPERIMENTAL.regions.some(region=>region.kind==='ram'&&decoded>=region.start&&decoded<=region.end)&&!(decoded>=0xa0000&&decoded<=0xbffff),'ordinary configured RAM write excludes video/MMIO');memory[decoded]=e.value;}
   else eq(e.value,memory[decoded],'full ordered physical read byte');
  }
 }
 eq(sha(memory),r.final.memorySha256,'full backing replay');
 const ad=r.events.filter(e=>e.kind==='write'&&e.paging);eq(ad.length,72,'all actual paging AD bytes');
 for(let i=0;i<ad.length;i+=4){const group=ad.slice(i,i+4),raw=group[0].address;eq(group.map(e=>e.address),[raw,raw+1,raw+2,raw+3],'whole typed AD update');check((raw&3)===0&&(raw===0x9000||(raw>=0xa000&&raw<0xb000)),'bounded AD table target');const before=Buffer.from(group.map(e=>e.before)).readUInt32LE(),after=Buffer.from(group.map(e=>e.value)).readUInt32LE();check((before&1)!==0&&after!==before&&((after^before)&~0x60)===0&&((after|before)>>>0)===after,'AD preserves physical/permission bits and sets only accessed/dirty');}
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
 eq([q,r.steps.length,r.final.board.cycles],[192,194,1156],'compact fixed work census');eq(nextOrdinal,r.events.length+1,'attempt journal exhaustion');
 eq(r.beforeSettle,{cpu:previous,board},'pre-settle mirror');eq(r.final.cpu,previous,'no idle execution after HLT');eq(r.final.board.debt,0,'settled chip debt');pitCheck(r.final.board);
 eq(r.deliveries.map(d=>[d.kind,d.vector,d.errorCode,d.quantum]),[['fault',14,2,94],['fault',14,2,111],['irq',32,null,129]],'actual fault/IRQ chronology');
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
 const edge=r.steps.filter(s=>s.boardBefore.pic1.irr===0&&s.boardAfter.pic1.irr===1);eq(edge.length,1,'single real PIT PIC edge');eq([edge[0].quantum,edge[0].before.eip,edge[0].before.ecx],[94,symbols.rep_fill,3],'edge inside REP');check(!(edge[0].before.eflags&0x200),'CLI pending edge');
 const rises=r.events.filter(e=>e.kind==='pit-output'&&e.channel===0&&e.level===1);eq(rises.length,1,'single actual PIT callback rise');eq([rises[0].quantum,rises[0].cpu.eip,rises[0].cpu.ecx,rises[0].cpu.edi],[93,symbols.rep_fill,3,0x4ffc],'actual edge precedes second REP fetch');
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
 eq(advanced,1156,'actual chip advance total');
 for(const s of r.steps.filter(s=>!s.completed)){
  const target=s.after.cr2;
  check(!r.events.slice(s.firstOrdinal-1,s.lastOrdinal).some(e=>e.kind==='write'&&!e.paging&&e.address>=target&&e.address<target+4),'failed attempt has no user destination write');
 }
 eq(r.events.filter(e=>e.kind==='ack').map(e=>[e.vector,e.quantum]),[[32,129]],'actual master ACK');
 eq(r.events.filter(e=>e.kind==='pio'&&e.port===0xe9).map(e=>String.fromCharCode(e.value)).join(''),'RPGC001','guest marker');
 eq(r.events.filter(e=>e.kind==='pio'&&e.port===0x20&&e.value===0x20).length,1,'actual EOI');
 check(r.final.cpu.halted&&!r.final.cpu.shutdown&&!(r.final.cpu.eflags&0x200),'masked terminal HLT');
 eq(r.configuration.experimentalFastA20Port92,true,'explicit fast-A20 callback configuration');eq(r.reset.board.fastA20Latch,0,'reset fast latch');eq(r.final.board.fastA20Latch,0,'unused fast latch');check(!r.events.some(e=>e.kind==='pio'&&e.port===0x92),'guest port92 remains unused');
 eq(r.final.mappingEpoch,2,'two actual mapping epochs');eq(r.final.cpu.translationCache.generation,generation,'final actual translation generation');
 const transitions=r.events.filter(e=>e.kind==='a20-transition');eq(transitions.map(e=>[e.before,e.after,e.quantum,e.boardCycles]),[[true,false,146,880],[false,true,167,1006]],'actual 8042 gate timeline');
 eq(r.events.filter(e=>e.kind==='pio'&&[0x60,0x64].includes(e.port)).map(e=>[e.port,e.value,e.quantum,e.boardCycles]),[[0x64,0xd1,144,868],[0x60,1,146,880],[0x64,0xd1,165,994],[0x60,3,167,1006]],'actual 8042 command/output sequence');
 const mappingInvalidations=r.events.filter(e=>e.kind==='translation-invalidate'&&e.origin==='a20-controller');eq(mappingInvalidations.map(e=>[e.a20Request,e.quantum,e.boardCycles]),[[false,146,880],[true,167,1006]],'two actual A20 controller invalidations');
 for(let i=0;i<2;i++){eq(mappingInvalidations[i].ordinal+1,transitions[i].ordinal,'source callback invalidates before changing gate');eq([mappingInvalidations[i].mappingEpoch,mappingInvalidations[i].a20Enabled],[i,i===0],'raw pre-transition invalidation state');}
 eq(r.events.filter(e=>e.kind==='translation-invalidate').reduce((o,e)=>(o[e.origin]=(o[e.origin]??0)+1,o),{}),{'cpu-control':5,'board-table-tracked-write':2,'a20-controller':2,'board-a20-off-write':27},'source-owned translation invalidation census, not architectural TLB parity');
 eq([...memory.subarray(0x560,0x570)],[0x11,0x11,0x22,0x22,0x22,0x22,0x22,0x22,0x55,0x55,0x55,0x55,0x33,0x33,0x44,0x44],'eight executed protected RAM witnesses');eq(r.final.smcWitnesses,[...memory.subarray(0x560,0x570)],'RAM witness mirror');
 eq([...memory.subarray(0x7000,0x7004)],[0xbb,0x55,0x55,0xcb],'low backing final code');eq([...memory.subarray(0x107000,0x107004)],[0xbb,0x44,0x44,0xcb],'high backing independent final code');eq(r.final.lowCode,[...memory.subarray(0x7000,0x7004)],'low code mirror');eq(r.final.highCode,[...memory.subarray(0x107000,0x107004)],'high code mirror');
 for(const [at,base,type] of [[0x618,0,0x9b],[0x620,0x100000,0x9b],[0x628,0x100000,0x93]]){eq(memory.readUInt16LE(at),0xffff,'RAM descriptor limit');eq((memory.readUInt16LE(at+2)|(memory[at+4]<<16)|(memory[at+7]<<24))>>>0,base,'RAM descriptor base');eq(memory[at+5],type,'RAM descriptor accessed type');eq(memory[at+6],0,'protected16 descriptor flags');}
 eq([dword(0xa01c),dword(0xa41c)],[0x7063,0x107063],'actual low/high code PTE A/D');
 const entries=r.steps.filter(s=>[0x18,0x20].includes(s.before.cs)&&s.before.eip===0x7000);eq(entries.map(s=>[s.quantum,s.before.cs,s.before.pc,s.after.ebx&65535]),[[58,0x18,0x7000,0x1111],[63,0x18,0x7000,0x2222],[149,0x20,0x107000,0x2222],[153,0x18,0x7000,0x2222],[158,0x18,0x7000,0x5555],[162,0x20,0x107000,0x5555],[170,0x20,0x107000,0x3333],[175,0x20,0x107000,0x4444]],'eight actual RAM instruction entries and effects');
 for(const s of entries){eq([s.before.segmentCaches[1].base,s.before.segmentCaches[1].limit,s.before.segmentCaches[1].default32],[s.before.cs===0x18?0:0x100000,0xffff,false],'protected RAM code cache');const call=r.steps[s.attempt-2],ret=r.steps[s.attempt];eq([call.before.cs,call.after.cs,call.after.esp],[8,s.before.cs,0x8ffc],'same-ring protected far CALL');eq([ret.before.eip,ret.after.cs,ret.after.esp],[0x7003,8,0x9000],'protected16 RETF');const writes=r.events.slice(call.firstOrdinal-1,call.lastOrdinal).filter(e=>e.kind==='write'&&!e.paging&&e.decoded>=0x8ffc&&e.decoded<0x9000);eq(writes.map(e=>e.decoded),[0x8ffc,0x8ffd,0x8ffe,0x8fff],'actual JS transactional CALL frame chronology');eq(writes.map(e=>e.value),[(call.before.eip+5)&255,(call.before.eip+5)>>>8,8,0],'protected CALL actual return frame');}
 const executablePages=new Set([0x7000,0x107000]);for(const s of rep)check(!r.events.slice(s.firstOrdinal-1,s.lastOrdinal).some(e=>e.kind==='write'&&executablePages.has(e.decoded&~4095)),'REP destinations disjoint from executable backing');
 const key=JSON.stringify(identity.sourceHashes);if(!checkpointCache.has(key))checkpointCache.set(key,runCombinedPagingRamOracle({requireClean:false}));
 const actual=checkpointCache.get(key);for(const field of ['initialBoard','reset','events','steps','deliveries','chipAdvances','beforeSettle','final'])eq(r[field],actual[field],`cached same-engine checkpoint reexecution ${field}`);
 return {successfulQuantums:q,failedAttempts:2,ramEntries:8,mappingEpochs:2,architecturalStalePteParity:false,boardClocks:1156,faults:2,irq:32,checkpointVerification:'same-engine-reexecution-not-independent-architectural-oracle'};
}

