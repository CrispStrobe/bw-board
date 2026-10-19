/** Bounded actual JavaScript board oracle. No native comparison is claimed. */
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
const fixture='test/fixtures/i80386-free-cold-reset.S';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=x=>JSON.parse(JSON.stringify(x));
export const knownNativeResetDifferences=Object.freeze({
  status:'documented-source-differences-not-native-execution-evidence',
  javascript:{cr0:0,edx:0x300,gdtrLimit:0,idtrLimit:0x3ff,dr6:0,dr7:0,csType:'code-read-only'},
  bochsCpu3:{cr0:0x7ffffff0,edx:0,gdtrLimit:0xffff,idtrLimit:0xffff,dr6:0xffff1ff0,dr7:0x400,csType:'data-read-write-accessed'},
  comparisonMasks:null,
  undefined386Cr0Bits:0x7fffffe0,
  note:'Raw differences are retained. ET, EDX, descriptor limits and debug registers are not erased to assert parity.',
});
export function assembleColdResetRom(){
  const dir=mkdtempSync(path.join(tmpdir(),'bw-cold-reset-rom-'));
  try{
    execFileSync('as',['--32','-o',path.join(dir,'rom.o'),path.join(root,fixture)]);
    execFileSync('objcopy',['-O','binary','-j','.text',path.join(dir,'rom.o'),path.join(dir,'rom.bin')]);
    const rom=readFileSync(path.join(dir,'rom.bin'));
    const symbols={};
    for(const line of execFileSync('nm',['--defined-only',path.join(dir,'rom.o')],{encoding:'utf8'}).trim().split('\n')){
      const [value,,name]=line.trim().split(/\s+/);symbols[name]=parseInt(value,16);
    }
    assert.equal(rom.length,65536);assert.equal(symbols.cold_start,0x100);
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
    a20Enabled:m._a20Enabled,a20:m._a20Controller.getState(),
    pit:{...m.chips.pit1.getState(),fraction:m.chips.pit1._frac,clockHz:m.chips.pit1.clockHz},
    pic1:m.chips.pic1.getState(),pic2:m.chips.pic2.getState(),rtc:m.chips.rtc1.getState(),
    dma1:m.chips.dma1.getState(),dma2:m.chips.dma2.getState(),systemControl:m.chips.sysctl.getState()});
}
function sourceIdentity(){
  const files=expandI80386SourceInventory(['./i80386-cold-reset-oracle.mjs',
    './run-i80386-cold-reset-oracle.mjs','../'+fixture,
    '../test/i80386-cold-reset-oracle.test.mjs'],import.meta.url);
  const hashes=Object.fromEntries(files.map(f=>{
    const absolute=path.resolve(root,'scripts',f);return [path.relative(root,absolute),sha(readFileSync(absolute))];
  }));
  return {boardRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHashes:hashes};
}
export function runColdResetOracle({requireClean=true}={}){
  if(requireClean)assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}),'','qualification requires a clean source tree');
  const source=sourceIdentity(),{rom,symbols}=assembleColdResetRom();
  const events=[],steps=[];let quantum=0,m,pioWidth=null;
  const record=e=>events.push({ordinal:events.length+1,quantum,boardCycles:m.cycles,...e});
  m=new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL,{onPortAccess:e=>record({kind:'pio',...e,width:pioWidth})});
  const initialBoard=boardState(m);
  m.loadRom(rom,0xf0000);m.loadRom(rom);
  const loadedSeedSha256=sha(m.mem);
  m.reset();
  const reset={cpu:cpuState(m.cpu),board:boardState(m)};
  for(const [method,kind] of [['fetch','fetch'],['read','read']]){
    const original=m.cpu[method];
    m.cpu[method]=address=>{
      const value=original(address);record({kind,address:address>>>0,decoded:m._decode386(address),value});return value;
    };
  }
  // The board hook supplies dir/port/value; capture width from the actual
  // CPU I/O callback while that hook executes, rather than assuming its units.
  const outPort=m.cpu.outPort;
  m.cpu.outPort=(port,value,width)=>{
    pioWidth=width;
    try{return outPort(port,value,width);}finally{pioWidth=null;}
  };
  const write=m.cpu.write;
  m.cpu.write=(address,value)=>{
    const decoded=m._decode386(address),before=m._read386(address);
    write(address,value);const after=m._read386(address);
    record({kind:'write',address:address>>>0,decoded,value:value&255,before,after,
      effect:m._page[decoded>>>12]===1?'ram-commit':m._page[decoded>>>12]===2?'rom-ignored':'openbus-ignored'});
  };
  for(let i=0;i<64&&!m.cpu.halted;i++){
    const before=cpuState(m.cpu),boardBefore=boardState(m),firstOrdinal=events.length+1;
    const charged=m.step();quantum++;
    steps.push({quantum,before,after:cpuState(m.cpu),charged,boardBefore,boardAfter:boardState(m),
      firstOrdinal,lastOrdinal:events.length});
  }
  assert(m.cpu.halted&&!m.cpu.shutdown,'bounded ROM did not reach HLT');
  const beforeSettle={cpu:cpuState(m.cpu),board:boardState(m)};
  m._catchUpChips();
  const report={schema:'bw.i80386-js-cold-reset-oracle.v1',claim:'actual-javascript-board-cold-reset-only',
    source,configuration:clone(PCAT80386_EXPERIMENTAL),configurationSha256:sha(JSON.stringify(PCAT80386_EXPERIMENTAL)),
    rom:{bytes:rom.length,sha256:sha(rom),sourceSha256:sha(readFileSync(path.join(root,fixture))),symbols},
    seed:{domain:'entire-configured-physical-backing-after-two-ROM-loads',sha256:loadedSeedSha256},
    reset,initialBoard,events,steps,beforeSettle,final:{cpu:cpuState(m.cpu),board:boardState(m),
      ram:[...m.mem.subarray(0x500,0x505)],resetWitness:[...m.mem.subarray(0x510,0x518)],romByte:m._read386(0xf0200),aliasRomByte:m._read386(0xffff0200),
      openbusByte:m._read386(0xc0000),memorySha256:sha(m.mem)},knownNativeResetDifferences};
  assert.deepEqual(sourceIdentity(),source,'source changed during execution');
  return report;
}

const historicalHashes=new Map();
function historicalSourceHashes(revision,files){
  const key=revision+JSON.stringify(files);
  if(!historicalHashes.has(key)){
    let hashes;
    try{hashes=Object.fromEntries(files.map(file=>[file,sha(execFileSync('git',
      ['show',`${revision}:${file}`],{cwd:root,maxBuffer:4<<20,stdio:['ignore','pipe','pipe']}))]));}
    catch{throw new Error('cold reset oracle: historical measured source unavailable');}
    historicalHashes.set(key,hashes);
  }
  return historicalHashes.get(key);
}

export function assertColdResetOracle(r){
  const check=(condition,message)=>assert(condition,`cold reset oracle: ${message}`);
  const equal=(actual,expected,message)=>assert.deepEqual(actual,expected,`cold reset oracle: ${message}`);
  equal(r.schema,'bw.i80386-js-cold-reset-oracle.v1','schema');
  equal(r.claim,'actual-javascript-board-cold-reset-only','claim scope');
  check(/^[0-9a-f]{40}$/.test(r.source.boardRevision),'historical source commit syntax');
  // A docs-only successor may replay this report. Authenticate every measured
  // blob at its captured commit, and require the current checker/runtime bytes
  // to match those captured executable inputs; HEAD equality is unnecessary.
  equal(r.source.sourceHashes,sourceIdentity().sourceHashes,'measured executable source hashes');
  equal(r.source.sourceHashes,historicalSourceHashes(r.source.boardRevision,Object.keys(r.source.sourceHashes)),
    'historical committed source blobs');
  equal(r.configuration,clone(PCAT80386_EXPERIMENTAL),'actual board config');
  equal(r.configurationSha256,sha(JSON.stringify(PCAT80386_EXPERIMENTAL)),'config digest');
  equal(r.knownNativeResetDifferences,knownNativeResetDifferences,'raw native differences declaration');
  const {rom,symbols}=assembleColdResetRom();
  equal(r.rom,{bytes:65536,sha256:sha(rom),sourceSha256:sha(readFileSync(path.join(root,fixture))),symbols},'ROM identity');
  const ram=Buffer.alloc(PCAT80386_EXPERIMENTAL.memoryBytes);
  rom.copy(ram,0xf0000);rom.copy(ram,0xff0000);
  equal(r.seed,{domain:'entire-configured-physical-backing-after-two-ROM-loads',sha256:sha(ram)},'seed identity');
  const reset=r.reset.cpu;
  equal([reset.cpuProfile,reset.strict386],['compatibility',false],'actual board CPU semantics');
  equal(registers.map(k=>reset[k]),[0,0,0x300,0,0,0,0,0,0xfff0,2,0,0,0,0,0xf000,0,0,0,0,0],'raw reset registers');
  equal([reset.pc,reset.cycles,reset.halted,reset.shutdown,reset.coprocessorProfile],
    [0xfffffff0,0,false,false,'none'],'reset hidden cache entry');
  equal(reset.gdtr,{base:0,limit:0},'reset GDTR');equal(reset.idtr,{base:0,limit:0x3ff},'reset IDTR');
  equal(reset.debugRegisters,Array(8).fill(0),'reset debug registers');
  equal(reset.ldtr,{selector:0,base:0,limit:0,present:false},'reset LDTR');
  equal(reset.tr,{selector:0,base:0,limit:0,present:false},'reset TR');
  equal([reset.interruptShadow,reset.nmiShadow,reset.debugShadow],[0,0,0],'reset shadows');
  equal(reset.segmentCaches[1],{base:0xffff0000,limit:0xffff,default32:false,present:true,code:true,readable:true,writable:false},'reset CS cache');
  for(const id of [0,2,3,4,5])equal(reset.segmentCaches[id],
    {base:0,limit:0xffff,default32:false,present:true,code:false,writable:true},'reset data cache');
  equal([r.initialBoard.cycles,r.initialBoard.debt],[0,0],'fresh board epoch');
  equal([r.reset.board.cycles,r.reset.board.debt,r.reset.board.a20Enabled],[4,0,true],'one reset clock and A20');
  check(r.reset.board.a20.outputPort&2,'8042 A20 source');
  equal(r.events[0],{ordinal:1,quantum:0,boardCycles:4,kind:'fetch',address:0xfffffff0,decoded:0xfffff0,value:0xea},'first actual executable fetch');
  equal(r.steps.length,49,'bounded successful instruction count');
  equal(r.steps[0].after.cs,0xf000,'far jump selector');
  equal([r.steps[0].after.eip,r.steps[0].after.pc,r.steps[0].after.segmentCaches[1].base],
    [0x100,0xf0100,0xf0000],'far jump CS reload');
  let ordinal=1,previousCpu=reset,previousBoard=r.reset.board;
  for(let i=0;i<r.steps.length;i++){
    const s=r.steps[i];equal(s.quantum,i+1,'quantum sequence');
    equal(s.before,previousCpu,'CPU step continuity');equal(s.boardBefore,previousBoard,'board step continuity');
    equal(s.charged,6,'one successful-work charge');
    equal([s.after.cpuProfile,s.after.strict386],['compatibility',false],'CPU semantics remain actual board profile');
    equal([s.before.cycles,s.after.cycles,s.boardBefore.cycles,s.boardAfter.cycles],
      [i,i+1,4+6*i,4+6*(i+1)],'instruction and functional clocks');
    equal(s.firstOrdinal,ordinal,'step event start');
    const slice=r.events.slice(s.firstOrdinal-1,s.lastOrdinal);
    check(slice.length>0&&slice[0].kind==='fetch','every instruction has executable witness');
    equal(slice[0].address,s.before.pc,'instruction entry fetch address');
    for(const e of slice){
      equal([e.ordinal,e.quantum,e.boardCycles],[ordinal++,i,4+6*i],'raw bus chronology');
      if(e.kind==='pio'){
        equal([e.dir,e.port,e.width],['out',0xe9,8],'bounded PIO decode');continue;
      }
      check(['fetch','read','write'].includes(e.kind),'bus event kind');
      check(Number.isInteger(e.address)&&e.address>=0&&e.address<=0xffffffff,'physical address');
      const decoded=e.address>=0xffff0000?0xff0000+(e.address-0xffff0000):e.address;
      equal(e.decoded,decoded,'physical reset alias decode');
      const region=PCAT80386_EXPERIMENTAL.regions.find(x=>decoded>=x.start&&decoded<=x.end);
      const old=region?ram[decoded]:255;
      if(e.kind==='write'){
        equal(e.before,old,'write prior byte');
        const effect=region?.kind==='ram'?'ram-commit':region?.kind==='rom'?'rom-ignored':'openbus-ignored';
        equal(e.effect,effect,'physical write effect');
        check(Number.isInteger(e.value)&&e.value>=0&&e.value<=255,'write byte');
        if(effect==='ram-commit')ram[decoded]=e.value;
        equal(e.after,region?ram[decoded]:255,'write observed byte');
      }else{
        equal(e.value,old,'read/fetch byte replay');
        if(e.kind==='fetch')check(region?.kind==='rom','fixture executes only ROM');
      }
    }
    equal(s.lastOrdinal,ordinal-1,'step event end');
    previousCpu=s.after;previousBoard=s.boardAfter;
  }
  equal(ordinal-1,r.events.length,'no events outside steps');
  const writes=r.events.filter(e=>e.kind==='write');
  equal(writes.map(e=>[e.address,e.value,e.effect]),[
    [0x510,0,'ram-commit'],[0x511,3,'ram-commit'],[0x512,0,'ram-commit'],[0x513,0,'ram-commit'],
    [0x514,0,'ram-commit'],[0x515,0,'ram-commit'],[0x516,0,'ram-commit'],[0x517,0,'ram-commit'],
    [0x500,0xa5,'ram-commit'],[0x501,0x5a,'ram-commit'],[0xf0200,0,'rom-ignored'],
    [0x502,0xa7,'ram-commit'],[0x503,0xff,'ram-commit'],[0xc0000,0x12,'openbus-ignored'],
    [0x504,0xff,'ram-commit']],'owned RAM/ROM/openbus witnesses');
  const reads=r.events.filter(e=>e.kind==='read');
  equal(reads.map(e=>[e.address,e.value]),[[0x500,0xa5],[0x501,0x5a],[0xf0200,0xa7],[0xc0000,0xff],[0xc0000,0xff]],'ROM/openbus data reads');
  equal(r.events.filter(e=>e.kind==='pio').map(e=>e.value),[...Buffer.from('CRST001')],'E9 marker');
  equal(r.beforeSettle,{cpu:previousCpu,board:previousBoard},'terminal pre-settle boundary');
  equal(r.final.cpu,previousCpu,'settling executes no additional instruction');
  const c=r.final.cpu;
  equal(registers.map(k=>c[k]),[0x31,0x2468,0x12345678,0x1357,0x9000,0x5678,0x369c,0x4567,
    symbols.cold_halt_end,0x46,0,0,0,0,0xf000,0,0,0,0,0],'final selected CPU');
  check(c.halted&&!c.shutdown,'CLI HLT terminal state');
  equal([c.cycles,r.final.board.cycles,r.final.board.debt],[49,298,0],'settled successful-work clocks');
  equal(r.final.resetWitness,[0,3,0,0,0,0,0,0],'guest-produced raw EDX/CR0 reset witness');
  equal(r.final.ram,[0xa5,0x5a,0xa7,0xff,0xff],'final signature and readback');
  equal([r.final.romByte,r.final.aliasRomByte,r.final.openbusByte],[0xa7,0xa7,0xff],'final decode effects');
  equal(r.final.memorySha256,sha(ram),'full backing RAM effect digest');
  for(const board of [r.initialBoard,r.reset.board,...r.steps.flatMap(s=>[s.boardBefore,s.boardAfter]),r.final.board]){
    check(board.a20Enabled,'reset alias requires enabled A20');
    const settled=board.cycles-board.debt;
    const fraction=(settled*1_193_182%6_000_000)/6_000_000;
    check(Math.abs(board.pit.fraction-fraction)<1e-12,'actual PIT oscillator fraction');
    equal(board.pit.clockHz,1_193_182,'PIT oscillator');
    equal([board.pic1.irr,board.pic1.isr,board.pic2.irr,board.pic2.isr],[0,0,0,0],'no synthetic IRQ');
  }
  return {status:'javascript-board-cold-reset-oracle-pass',successfulQuanta:49,boardCycles:298,
    marker:'CRST001',nativeParity:false};
}
