/** Guest-created RAM code/SMC/A20 actual JavaScript board oracle only. */
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
const fixture='test/fixtures/i80386-free-ram-coherence.S';
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
export function assembleRamCoherenceRom(){
  const dir=mkdtempSync(path.join(tmpdir(),'bw-ram-coherence-rom-'));
  try{
    execFileSync('as',['--32','-o',path.join(dir,'rom.o'),path.join(root,fixture)]);
    execFileSync('objcopy',['-O','binary','-j','.text',path.join(dir,'rom.o'),path.join(dir,'rom.bin')]);
    const rom=readFileSync(path.join(dir,'rom.bin'));
    const symbols={};
    for(const line of execFileSync('nm',['--defined-only',path.join(dir,'rom.o')],{encoding:'utf8'}).trim().split('\n')){
      const [value,,name]=line.trim().split(/\s+/);symbols[name]=parseInt(value,16);
    }
    assert.equal(rom.length,65536);assert.equal(symbols.ram_start,0x100);
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
    a20Enabled:m._a20Enabled,a20:m._a20Controller.getState(),fastA20Latch:m._fastA20Latch,cpuResetPending:m._cpuResetPending,
    pit:{...m.chips.pit1.getState(),fraction:m.chips.pit1._frac,clockHz:m.chips.pit1.clockHz},
    pic1:m.chips.pic1.getState(),pic2:m.chips.pic2.getState(),rtc:m.chips.rtc1.getState(),
    dma1:m.chips.dma1.getState(),dma2:m.chips.dma2.getState(),systemControl:m.chips.sysctl.getState()});
}
function sourceIdentity(){
  const files=expandI80386SourceInventory(['./i80386-ram-coherence-oracle.mjs',
    './run-i80386-ram-coherence-oracle.mjs','../'+fixture,
    '../test/i80386-ram-coherence-oracle.test.mjs'],import.meta.url);
  const hashes=Object.fromEntries(files.map(f=>{
    const absolute=path.resolve(root,'scripts',f);return [path.relative(root,absolute),sha(readFileSync(absolute))];
  }));
  const boardRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
  for(const [file,hash] of Object.entries(hashes))assert.equal(sha(execFileSync('git',['show',`${boardRevision}:${file}`],{cwd:root,maxBuffer:4<<20})),hash,`measured input differs from committed source: ${file}`);
  return {boardRevision:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHashes:hashes};
}
export function runRamCoherenceOracle({requireClean=true}={}){
  if(requireClean)assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}),'','qualification requires a clean source tree');
  const source=sourceIdentity(),{rom,symbols}=assembleRamCoherenceRom();
  const events=[],steps=[];let quantum=0,m,pioWidth=null,mappingEpoch=0,lastA20=true;
  const providers={fetchRam32Calls:0,fetchRam32Used:0,read32Calls:0};
  const record=e=>{
    if(m._a20Enabled!==lastA20){mappingEpoch++;lastA20=m._a20Enabled;}
    events.push({ordinal:events.length+1,quantum,boardCycles:m.cycles,mappingEpoch,a20Enabled:m._a20Enabled,...e});
  };
  m=new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL,{onPortAccess:e=>record({kind:'pio',...e,width:pioWidth})});
  const initialBoard=boardState(m);
  m.loadRom(rom,0xf0000);m.loadRom(rom);
  const loadedSeedSha256=sha(m.mem);
  m.reset();
  const reset={cpu:cpuState(m.cpu),board:boardState(m)};
  for(const [method,kind] of [['fetch','fetch'],['read','read']]){
    const original=m.cpu[method];
    m.cpu[method]=address=>{
      const value=original(address);record({kind,address:address>>>0,decoded:m._decode386(address),value,provider:'byte'});return value;
    };
  }
  for(const [method,kind] of [['fetchRam32','fetch'],['read32','read']]){
    const original=m.cpu[method];
    m.cpu[method]=address=>{
      providers[method==='fetchRam32'?'fetchRam32Calls':'read32Calls']++;
      const value=original(address);
      if(value!==undefined){
        if(method==='fetchRam32')providers.fetchRam32Used++;
        for(let i=0;i<4;i++){const raw=(address+i)>>>0;record({kind,address:raw,decoded:m._decode386(raw),value:(value>>>(8*i))&255,provider:method});}
      }
      return value;
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
      provider:'byte',effect:m._page[decoded>>>12]===1?'ram-commit':m._page[decoded>>>12]===2?'rom-ignored':'openbus-ignored'});
  };
  for(let i=0;i<128&&!m.cpu.halted;i++){
    const before=cpuState(m.cpu),boardBefore=boardState(m),firstOrdinal=events.length+1;
    const charged=m.step();quantum++;
    steps.push({quantum,before,after:cpuState(m.cpu),charged,boardBefore,boardAfter:boardState(m),
      firstOrdinal,lastOrdinal:events.length});
  }
  assert(m.cpu.halted&&!m.cpu.shutdown,'bounded RAM fixture did not reach HLT');
  const beforeSettle={cpu:cpuState(m.cpu),board:boardState(m)};
  m._catchUpChips();
  const report={schema:'bw.i80386-js-ram-coherence-oracle.v1',claim:'actual-javascript-board-guest-created-ram-smc-a20-only',
    source,configuration:clone(PCAT80386_EXPERIMENTAL),configurationSha256:sha(JSON.stringify(PCAT80386_EXPERIMENTAL)),
    rom:{bytes:rom.length,sha256:sha(rom),sourceSha256:sha(readFileSync(path.join(root,fixture))),symbols},
    seed:{domain:'entire-configured-physical-backing-after-two-ROM-loads',sha256:loadedSeedSha256},
    reset,initialBoard,events,steps,providers,beforeSettle,final:{cpu:cpuState(m.cpu),board:boardState(m),
      witnesses:[...m.mem.subarray(0x520,0x52e)],resetWitness:[...m.mem.subarray(0x510,0x518)],
      lowCode:[...m.mem.subarray(0x7000,0x7004)],highCode:[...m.mem.subarray(0x107000,0x107004)],
      mappingEpoch,memorySha256:sha(m.mem)},knownNativeResetDifferences};
  assert.deepEqual(sourceIdentity(),source,'source changed during execution');
  return report;
}


const historicalHashes=new Map(),checkpointCache=new Map();
export function assertRamCoherenceOracle(r){
  const check=(ok,message)=>assert(ok,`RAM coherence oracle: ${message}`);
  const equal=(a,b,message)=>assert.deepEqual(a,b,`RAM coherence oracle: ${message}`);
  equal(Object.keys(r).sort(),['beforeSettle','claim','configuration','configurationSha256','events','final','initialBoard',
    'knownNativeResetDifferences','providers','reset','rom','schema','seed','source','steps'].sort(),'report shape');
  equal(r.schema,'bw.i80386-js-ram-coherence-oracle.v1','schema');
  equal(r.claim,'actual-javascript-board-guest-created-ram-smc-a20-only','claim scope');
  check(/^[0-9a-f]{40}$/.test(r.source.boardRevision),'historical revision syntax');
  const identity=sourceIdentity();equal(r.source.sourceHashes,identity.sourceHashes,'complete measured executable inventory');
  const historyKey=r.source.boardRevision+JSON.stringify(Object.keys(identity.sourceHashes));
  if(!historicalHashes.has(historyKey))historicalHashes.set(historyKey,Object.fromEntries(Object.keys(identity.sourceHashes).map(file=>{
    let bytes;try{bytes=execFileSync('git',['show',`${r.source.boardRevision}:${file}`],{cwd:root,maxBuffer:4<<20,stdio:['ignore','pipe','pipe']});}
    catch{throw Error(`RAM coherence oracle: historical source blob unavailable ${file}`);}
    return [file,sha(bytes)];
  })));
  equal(r.source.sourceHashes,historicalHashes.get(historyKey),'historical committed source authentication');
  equal(r.configuration,clone(PCAT80386_EXPERIMENTAL),'actual board configuration');
  equal(r.configurationSha256,sha(JSON.stringify(PCAT80386_EXPERIMENTAL)),'configuration digest');
  equal(r.knownNativeResetDifferences,knownNativeResetDifferences,'raw reset differences retained without masks');
  const {rom,symbols}=assembleRamCoherenceRom();
  equal(r.rom,{bytes:65536,sha256:sha(rom),sourceSha256:sha(readFileSync(path.join(root,fixture))),symbols},'free ROM identity');
  const ram=Buffer.alloc(PCAT80386_EXPERIMENTAL.memoryBytes);rom.copy(ram,0xf0000);rom.copy(ram,0xff0000);
  equal(r.seed,{domain:'entire-configured-physical-backing-after-two-ROM-loads',sha256:sha(ram)},'ROM-only seed, no RAM code preseed');
  equal([...ram.subarray(0x7000,0x7004),...ram.subarray(0x107000,0x107004)],Array(8).fill(0),'initial executable RAM is zero');
  equal([r.initialBoard.cycles,r.reset.board.cycles,r.reset.board.debt,r.reset.board.a20Enabled,r.reset.board.fastA20Latch],
    [0,4,0,true,0],'single reset epoch and initial A20 sources');
  equal([r.reset.cpu.pc,r.reset.cpu.edx,r.reset.cpu.cr0,r.reset.cpu.cpuProfile,r.reset.cpu.strict386],
    [0xfffffff0,0x300,0,'compatibility',false],'raw actual CPU reset profile');
  equal(r.steps.length,71,'bounded successful instructions');
  equal(r.events[0],{ordinal:1,quantum:0,boardCycles:4,mappingEpoch:0,a20Enabled:true,kind:'fetch',
    address:0xfffffff0,decoded:0xfffff0,value:0xea,provider:'byte'},'true reset physical fetch');
  equal([r.steps[0].after.cs,r.steps[0].after.eip,r.steps[0].after.pc],[0xf000,0x100,0xf0100],'first far transfer reload');
  let ordinal=1,previousCpu=r.reset.cpu,previousBoard=r.reset.board,a20=true,epoch=0,pending=false;
  const marker=[];
  for(let i=0;i<r.steps.length;i++){
    const s=r.steps[i];equal(s.quantum,i+1,'successful-work sequence');
    equal(s.before,previousCpu,'complete CPU checkpoint continuity');equal(s.boardBefore,previousBoard,'complete board checkpoint continuity');
    equal([s.charged,s.before.cycles,s.after.cycles,s.boardBefore.cycles,s.boardAfter.cycles],
      [6,i,i+1,4+6*i,4+6*(i+1)],'disjoint CPU/functional board clocks');
    check(!s.before.halted&&!s.before.shutdown,'no terminal CPU idle step');
    equal(s.firstOrdinal,ordinal,'step bus start');
    const bus=r.events.slice(s.firstOrdinal-1,s.lastOrdinal);check(bus.length&&bus[0].kind==='fetch','instruction entry fetch');
    equal(bus[0].address,s.before.pc,'actual instruction physical entry');
    for(const e of bus){
      equal([e.ordinal,e.quantum,e.boardCycles],[ordinal++,i,4+6*i],'ordered bus clock tuple');
      if(e.kind==='pio'){
        equal([e.dir,e.width],['out',8],'actual byte PIO');
        if(e.port===0x64){equal(e.value,0xd1,'8042 output command');check(!pending,'8042 command overlap');pending=true;}
        else if(e.port===0x60){check(pending,'8042 output data needs D1');check([1,3].includes(e.value),'8042 reset bit remains high');
          const next=!!(e.value&2);if(next!==a20)epoch++;a20=next;pending=false;}
        else{equal(e.port,0xe9,'bounded marker port');marker.push(e.value);}
        equal([e.mappingEpoch,e.a20Enabled],[epoch,a20],'PIO reports authoritative effective mapping');continue;
      }
      check(['fetch','read','write'].includes(e.kind),'physical byte event kind');
      check(Number.isInteger(e.address)&&e.address>=0&&e.address<=0xffffffff,'physical uint32 address');
      equal([e.mappingEpoch,e.a20Enabled],[epoch,a20],'byte mapping chronology');
      const gated=a20?e.address:(e.address&~0x100000)>>>0;
      const decoded=gated>=0xffff0000?0xff0000+gated-0xffff0000:gated;
      equal(e.decoded,decoded,'A20 gate precedes reset alias decode');
      const region=PCAT80386_EXPERIMENTAL.regions.find(x=>decoded>=x.start&&decoded<=x.end);
      const old=region?ram[decoded]:255;
      check(Number.isInteger(e.value)&&e.value>=0&&e.value<=255,'observed byte value');
      if(e.kind==='write'){
        equal(e.before,old,'write prior backing byte');equal(e.effect,'ram-commit','guest writes RAM only');
        equal(region?.kind,'ram','owned RAM write decode');ram[decoded]=e.value;equal(e.after,ram[decoded],'committed byte effect');
      }else{
        equal(e.value,old,'read/execute byte backing replay');
        check(['byte','fetchRam32','read32'].includes(e.provider),'actual provider provenance');
        if(e.kind==='fetch')check(['ram','rom'].includes(region?.kind),'executable ordinary memory only');
      }
    }
    equal(s.lastOrdinal,ordinal-1,'step bus end');
    equal([s.boardAfter.a20Enabled,s.boardAfter.fastA20Latch],[a20,0],'actual per-step A20/fast source');
    previousCpu=s.after;previousBoard=s.boardAfter;
  }
  equal(ordinal-1,r.events.length,'no detached byte events');check(!pending,'no pending8042command');equal(epoch,2,'two effective A20 transitions');
  const fetches=r.events.filter(e=>e.kind==='fetch'),reads=r.events.filter(e=>e.kind==='read'),writes=r.events.filter(e=>e.kind==='write');
  equal([fetches.length,reads.length,writes.length],[222,28,64],'actual byte bus totals');
  const entries=[18,23,31,36,40,48,53];
  const raw=[0x7000,0x7000,0x107000,0x7000,0x107000,0x107000,0x107000];
  const decoded=[0x7000,0x7000,0x7000,0x7000,0x7000,0x107000,0x107000];
  const values=[0x1111,0x2222,0x2222,0x5555,0x5555,0x3333,0x4444];
  equal(fetches.filter(e=>e.address===0x7000||e.address===0x107000).map(e=>e.quantum+1),entries,'seven real executable RAM entries');
  for(let j=0;j<entries.length;j++){
    const s=r.steps[entries[j]-1],bytes=r.events.slice(s.firstOrdinal-1,s.lastOrdinal).filter(e=>e.kind==='fetch');
    equal(bytes.map(e=>[e.address,e.decoded,e.value]),[0,1,2].map((k)=>[raw[j]+k,decoded[j]+k,[0xbb,values[j]&255,values[j]>>>8][k]]),'guest-created current RAM instruction bytes');
    equal(s.after.ebx,values[j],'executed operand result');
    equal(r.steps[entries[j]].after.cs,0xf000,'RETF serializes return to ROM');
  }
  const codeWrites=writes.filter(e=>e.decoded>=0x7000&&e.decoded<=0x7003||e.decoded>=0x107000&&e.decoded<=0x107003);
  equal(codeWrites.map(e=>[e.address,e.decoded,e.value]),[
    ...[0xbb,0x11,0x11,0xcb].map((v,i)=>[0x7000+i,0x7000+i,v]),
    ...[0xbb,0x33,0x33,0xcb].map((v,i)=>[0x107000+i,0x107000+i,v]),
    [0x7001,0x7001,0x22],[0x7002,0x7002,0x22],
    [0x107001,0x7001,0x55],[0x107002,0x7002,0x55],
    [0x107001,0x107001,0x44],[0x107002,0x107002,0x44]],'owned code creation and ordered SMC alias effects');
  equal(r.final.witnesses,values.flatMap(v=>[v&255,v>>>8]),'seven hard guest witnesses');
  equal(r.final.resetWitness,[0,3,0,0,0,0,0,0],'guest captures raw JS reset EDX/CR0');
  equal([r.final.lowCode,r.final.highCode],[[0xbb,0x55,0x55,0xcb],[0xbb,0x44,0x44,0xcb]],'high backing survived A20OFF alias write');
  equal(marker,[...Buffer.from('RAMA001')],'guest E9 marker');
  equal(r.events.filter(e=>e.kind==='pio').map(e=>[e.port,e.value]),[[0x64,0xd1],[0x60,1],[0x64,0xd1],[0x60,3],...[...Buffer.from('RAMA001')].map(v=>[0xe9,v])],'actual PIO protocol');
  equal(r.beforeSettle,{cpu:previousCpu,board:previousBoard},'terminal checkpoint before settlement');
  equal(r.final.cpu,previousCpu,'settlement executes no CPU instruction');
  equal([r.final.cpu.pc,r.final.cpu.eip,r.final.cpu.halted,r.final.cpu.shutdown,r.final.cpu.esp],
    [0xf0000+symbols.ram_halt_end,symbols.ram_halt_end,true,false,0x9000],'CLI HLT and balanced far-call stack');
  equal([r.final.board.cycles,r.final.board.debt,r.final.mappingEpoch],[430,0,2],'terminal clocks/debt/mapping epoch');
  equal(r.final.memorySha256,sha(ram),'complete physical backing write replay');
  for(const board of [r.initialBoard,r.reset.board,...r.steps.flatMap(s=>[s.boardBefore,s.boardAfter]),r.final.board]){
    const settled=board.cycles-board.debt,frac=(settled*1_193_182%6_000_000)/6_000_000;
    check(Math.abs(board.pit.fraction-frac)<1e-12,'PIT rational oscillator remainder');
    equal([board.pic1.irr,board.pic1.isr,board.pic2.irr,board.pic2.isr],[0,0,0,0],'no guest IRQ/fault delivery');
  }
  // This authenticates full checkpoint data by another actual execution of
  // the same committed JS board/core. It is not an independent architectural
  // oracle, native execution evidence, or a CPU state normalization.
  const checkpointKey=JSON.stringify(identity.sourceHashes);
  if(!checkpointCache.has(checkpointKey))checkpointCache.set(checkpointKey,runRamCoherenceOracle({requireClean:false}));
  const reference=checkpointCache.get(checkpointKey);
  for(const key of ['reset','initialBoard','events','steps','providers','beforeSettle','final'])equal(r[key],reference[key],`fresh same-engine actual-board ${key}`);
  return {status:'javascript-board-ram-coherence-oracle-pass',successfulQuanta:71,boardCycles:430,
    ramEntries:7,a20Transitions:2,marker:'RAMA001',nativeParity:false,checkpointValidation:'source-bound-fresh-same-engine-reexecution'};
}
