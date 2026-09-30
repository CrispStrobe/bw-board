/** Source-bound serial CPU3 paging/fault/host-event capture for the free fixture. */
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync,mkdirSync,
  copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {endianness,tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertNativePagedEventsSelfParity} from './bochs-cpu3-native-paged-events-compare.mjs';
import {patchPinnedSource,revision,upstreamHashes} from './bochs-cpu3-native-paged-events/patch.mjs';

const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const fixture='test/fixtures/i80386-bochs-cpu3-native-paged-events.S';
const receipt='docs/receipts/2026-09-30-i80386-bochs-cpu3-native-slice-capture.json';
const sourcePaths=[
  'scripts/bochs-cpu3-native-slice/patch.mjs',
  'scripts/bochs-cpu3-native-events/patch.mjs',
  'scripts/bochs-cpu3-native-paged-events/abi.h',
  'scripts/bochs-cpu3-native-paged-events/runtime.h',
  'scripts/bochs-cpu3-native-paged-events/runtime.inc',
  'scripts/bochs-cpu3-native-paged-events/patch.mjs',
  'scripts/prepare-bochs-cpu3-native-paged-events.mjs',
  'scripts/bochs-cpu3-native-paged-events-compare.mjs',
  'scripts/run-bochs-cpu3-native-paged-events-compare.mjs',
  'test/i80386-native-paged-events.test.mjs',
  'test/fixtures/i80386-native-paged-events-smoke-arm.json.gz',
  'test/fixtures/i80386-native-paged-events-qualified-99f1f660.json.gz',fixture,receipt];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fileSha=path=>sha(readFileSync(path));
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const pinnedReceiptSha='34f87620eb4f12aba403f11ee83ef6cbc360e511e91b2c3fc06c9c1db8d7d7c2';

function sourceInventory(){
  assert(endianness()==='LE','native CPU3 callback bytes require a little-endian host');
  assert(!git(repo,'status','--porcelain'),'board checkout must be clean for source freeze');
  const boardRevision=git(repo,'rev-parse','HEAD');
  const sourceHashes={};
  for(const path of sourcePaths){
    execFileSync('git',['ls-files','--error-unmatch','--',path],{cwd:repo,stdio:'ignore'});
    const committed=execFileSync('git',['show',`HEAD:${path}`],
      {cwd:repo,maxBuffer:16*1024*1024});
    const current=readFileSync(resolve(repo,path));
    assert(sha(committed)===sha(current),`source differs from HEAD: ${path}`);
    sourceHashes[path]=sha(current);
  }
  assert(sourceHashes[receipt]===pinnedReceiptSha,'historical native slice receipt changed');
  const reference=JSON.parse(readFileSync(resolve(repo,receipt),'utf8'));
  assert(reference.schema==='bw.bochs-cpu3-native-slice.v1' &&
    reference.source.bochsRevision===revision,
  'historical native slice identity changed');
  return {boardRevision,sourceHashes,reference};
}

function patchedTree(root){
  assert(git(root,'rev-parse','HEAD')===revision,'unexpected Bochs revision');
  const changed=git(root,'diff','--name-only','HEAD','--').split('\n').filter(Boolean).sort();
  const expectedPaths=Object.keys(upstreamHashes).sort();
  assert(JSON.stringify(changed)===JSON.stringify(expectedPaths),
    'Bochs tracked patch inventory differs from exact CPU3 slice recipe');
  const patchHashes={};
  for(const path of expectedPaths){
    const upstream=execFileSync('git',['show',`HEAD:${path}`],{cwd:root});
    const expected=patchPinnedSource(path,upstream);
    const actual=readFileSync(resolve(root,path));
    assert(sha(actual)===sha(expected),`patched Bochs bytes differ: ${path}`);
    patchHashes[path]=sha(actual);
  }
  for(const [source,target] of [
    ['scripts/bochs-cpu3-native-paged-events/abi.h','bochs/cpu/bw_slice_abi.h'],
    ['scripts/bochs-cpu3-native-paged-events/runtime.h','bochs/cpu/bw_slice_runtime.h'],
    ['scripts/bochs-cpu3-native-paged-events/runtime.inc','bochs/cpu/bw_slice_runtime.inc']])
    assert(fileSha(resolve(repo,source))===fileSha(resolve(root,target)),
      `copied owned CPU3 bytes differ: ${target}`);
  const config=resolve(root,'bochs/config.h'),configText=readFileSync(config,'utf8');
  for(const option of ['#define BX_CPU_LEVEL 3','#define BX_DEBUGGER 0',
    '#define BX_SUPPORT_SMP 0','#define BX_SUPPORT_REPEAT_SPEEDUPS 0',
    '#define BX_SUPPORT_HANDLERS_CHAINING_SPEEDUPS 0',
    '#define BX_USE_IDLE_HACK 0'])
    assert(configText.split('\n').includes(option),`Bochs config missing ${option}`);
  const binary=resolve(root,'bochs/bochs');
  assert(existsSync(binary),'native CPU3 binary absent');
  return {binary,configSha256:fileSha(config),binarySha256:fileSha(binary),patchHashes};
}

function assembleFixture(build){
  const object=join(build,'guest.o'),image=join(build,'guest.bin');
  execFileSync('as',['--32','-o',object,resolve(repo,fixture)]);
  execFileSync('ld',['-m','elf_i386','-Ttext','0x7c00','--oformat','binary',
    '-o',image,object]);
  const symbols=execFileSync('nm',['--defined-only',object],{encoding:'utf8'});
  for(const [name,address] of Object.entries({setup:0x7e00,rep_fill:0x7e2d,
    faulting_store:0x7ee8,pf_handler:0x7f58,cr3_reload:0x7fa3,iret_retry:0x7fa9,
    shadow_successor:0x7f17,after_shadow:0x7f1c,after_hlt:0x7f2b,
    terminal_hlt:0x7f4f,after_terminal_hlt:0x7f50,irq_handler:0x7fab})){
    const match=symbols.match(new RegExp(`^([0-9a-f]+) [tT] ${name}$`,'m'));
    assert(match && 0x7c00+Number.parseInt(match[1],16)===address,
      `owned fixture symbol changed: ${name}`);
  }
  const bytes=readFileSync(image);
  assert(bytes.length>0 && bytes.length<=1474560,'owned fixture image length invalid');
  const floppy=Buffer.alloc(1474560);bytes.copy(floppy);
  return {imageSha256:sha(bytes),floppy};
}

function bochsrc(directory,floppyPath){
  const bios=resolve(repo,'roms/free-at-bios/BIOS-bochs-legacy');
  const vga=resolve(repo,'roms/free-at-bios/vgabios-lgpl.bin');
  const log=join(directory,'bochs.log');
  const rc=join(directory,'bochsrc');
  writeFileSync(rc,[
    'display_library: nogui','memory: guest=16, host=16',
    `romimage: file=${bios}`,`vgaromimage: file=${vga}`,
    'cpu: count=1, ips=10000000',
    'clock: sync=none, time0=946684800',
    `floppya: 1_44=${floppyPath}, status=inserted`,
    'boot: floppy','port_e9_hack: enabled=1',`log: ${log}`,
    'panic: action=fatal','error: action=report','info: action=report',
    'debug: action=ignore','mouse: enabled=0',
  ].join('\n')+'\n');
  return {rc,log,biosSha256:fileSha(bios),vgaBiosSha256:fileSha(vga)};
}

async function capture(binary,rc,budget,probe=null,timeoutMs=30000){
  const env={...process.env,BW_CPU3_PAGED_EVENTS_BUDGET:budget};
  if(probe)env.BW_CPU3_PAGED_EVENTS_PROBE=probe;
  const child=spawn(binary,['-q','-f',rc],{env,cwd:dirname(rc),
    stdio:['ignore','pipe','pipe'],detached:true});
  let stdout='',stderr='',timeout=false,overflow=false,closed=false;
  const kill=signal=>{if(!closed)try{process.kill(-child.pid,signal);}catch{}};
  const timer=setTimeout(()=>{timeout=true;kill('SIGTERM');
    setTimeout(()=>kill('SIGKILL'),2000).unref();},timeoutMs);
  const result=await new Promise((done,reject)=>{
    child.stdout.on('data',chunk=>{stdout+=chunk.toString('latin1');
      if(stdout.length>20000000){overflow=true;kill('SIGTERM');}});
    child.stderr.on('data',chunk=>{stderr+=chunk.toString('latin1');
      if(stderr.length>40000000){overflow=true;kill('SIGTERM');}});
    child.once('error',reject);
    child.once('close',(code,signal)=>{closed=true;done({code,signal});});
  }).finally(()=>clearTimeout(timer));
  assert(!timeout,`native arm ${budget}/${probe??'normal'} timed out`);
  assert(!overflow,`native arm ${budget}/${probe??'normal'} exceeded raw output bound`);
  return {...result,stdout,stderr};
}

const decimal=(raw,where)=>{
  if(!/^(0|[1-9][0-9]*)$/.test(raw))throw new Error(`${where}: decimal expected`);
  const n=Number(raw);assert(Number.isSafeInteger(n),`${where}: unsafe integer`);return n;
};
const hexNumber=(raw,where,width)=>{
  if(!new RegExp(`^[0-9a-f]{${width}}$`).test(raw))
    throw new Error(`${where}: ${width}-digit lowercase hex expected`);
  return Number.parseInt(raw,16);
};
const le32Bytes=(raw,where)=>{
  const value=hexNumber(raw,where,8);
  return Buffer.from([value&255,(value>>>8)&255,(value>>>16)&255,
    (value>>>24)&255]).toString('hex');
};
const tags=stderr=>stderr.split(/\r?\n/).filter(line=>line.startsWith('BWS5\t'))
  .map(line=>line.split('\t').slice(1));
const stateFields=['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags',
  'cr0','cr2','cr3','cs','ds','ss','gdtrBase','gdtrLimit','idtrBase','idtrLimit'];
function parseState(p,where){
  assert(p.length===20,`${where}: 20 selected fields required`);
  return Object.fromEntries(p.map((raw,i)=>[stateFields[i],
    hexNumber(raw,where+'.'+stateFields[i],[13,14,15,17,19].includes(i)?4:8)]));
}
const names=['attempts','completed','repIterations','repPartial','faults',
  'portCommits','irqDeliveries','haltIdleCuts'];
const reasons={1:'budget',2:'fault',3:'port',4:'halt',5:'failure',
  6:'irq-delivered',7:'event-due'};
const ifValue=(raw,where)=>{
  const n=decimal(raw,where);assert(n===0||n===512,`${where}: raw IF is not 0/512`);
  return n===512;
};
const bit=(raw,where)=>{
  const n=decimal(raw,where);assert(n===0||n===1,`${where}: boolean bit expected`);
  return n===1;
};

export function parseArm(stderr,mode,budget){
  const records=tags(stderr);
  assert(records.length>0,`${mode}: no BWS5 records`);
  const pages=[],apiProbes={},journal=[],slices=[];
  let seedState=null,handoff=null,activation=null,finalRecord=null,state=null,
    callbacks=null,fallback=null,deactivated=false,lastOrdinal=-1;
  let prior={ticks:0,attempts:0,completed:0,repIterations:0,repPartial:0,
    faults:0,portCommits:0,irqDeliveries:0,haltIdleCuts:0};
  const add=(event,where)=>{
    assert(activation&&!finalRecord,`${where}: event outside owned active interval`);
    assert(event.ordinal>lastOrdinal,`${where}: global event ordinal regressed`);
    lastOrdinal=event.ordinal;journal.push(event);
  };
  for(const [index,record] of records.entries()){
    const [tag,...p]=record,where=`${mode}: BWS5 line ${index+1} ${tag}`;
    if(tag==='PROBE'){
      assert(p.length===2&&!Object.hasOwn(apiProbes,p[0]),`${where}: repeated/malformed API probe`);
      apiProbes[p[0]]=p[1];
    }else if(tag==='SEEDSTATE'){
      assert(!seedState&&!activation,`${where}: duplicate/late selected seed`);
      seedState=parseState(p,where);
    }else if(tag==='SEEDPAGE'){
      assert(seedState&&!activation&&p.length===2,`${where}: misplaced page`);
      const number=decimal(p[0],where);
      assert(number===pages.length&&number<256,`${where}: missing/duplicate seed page`);
      assert(/^[0-9a-f]{8192}$/.test(p[1]),`${where}: seed page not 4 KiB`);
      pages.push(Buffer.from(p[1],'hex'));
    }else if(tag==='IRQ_HANDOFF'){
      assert(!handoff&&seedState&&pages.length===256&&p.length===4,
        `${where}: handoff misplaced`);
      handoff={inheritedPending:hexNumber(p[0],where,8),
        inheritedMask:hexNumber(p[1],where,8),inheritedIF:decimal(p[2],where),
        ownedPending:hexNumber(p[3],where,8)};
      assert([0,512].includes(handoff.inheritedIF),`${where}: inherited IF invalid`);
    }else if(tag==='ACTIVATE'){
      assert(!activation&&handoff&&p.length===3,`${where}: activation missing seed/handoff`);
      activation={cs:hexNumber(p[0],where,4),eip:hexNumber(p[1],where,8),
        copiedBytes:decimal(p[2],where),tlbFlushed:true,prefetchInvalidated:true,
        icacheFlushed:true,ramSha256:sha(Buffer.concat(pages)),
        cpuSeedSha256:sha(Buffer.from(JSON.stringify(seedState))),handoff};
    }else if(tag==='TICK'){
      assert(p.length===4,`${where}: tick fields`);
      const count=decimal(p[0],where),preTick=decimal(p[1],where),
        tick=decimal(p[2],where),ordinal=decimal(p[3],where);
      add({kind:'tick',count,preTick,tick,ordinal},where);
    }else if(tag==='ATTEMPT'){
      assert(p.length===4,`${where}: bounded attempt fields`);
      add({kind:'attempt',cursor:{cs:hexNumber(p[0],where,4),
        eip:hexNumber(p[1],where,8)},tick:decimal(p[2],where),
        ordinal:decimal(p[3],where)},where);
    }else if(tag==='PTE5_READ'){
      assert(p.length===3&&/^[0-9a-f]{8}$/.test(p[0]),`${where}: PTE5 byte fields`);
      add({kind:'pte5-read',bytes:p[0],tick:decimal(p[1],where),
        ordinal:decimal(p[2],where)},where);
    }else if(tag==='FAULT_BEGIN'){
      assert(p.length===7,`${where}: fault hook fields`);
      add({kind:'fault-begin',vector:decimal(p[0],where),
        errorCode:decimal(p[1],where),cr2:hexNumber(p[2],where,8),
        faulting:{cs:hexNumber(p[3],where,4),eip:hexNumber(p[4],where,8)},
        tick:decimal(p[5],where),ordinal:decimal(p[6],where)},where);
    }else if(tag==='FAULT_DELIVERED'){
      assert(p.length===15,`${where}: delivered fault/frame fields`);
      add({kind:'fault-delivered',vector:decimal(p[0],where),
        errorCode:decimal(p[1],where),cr2:hexNumber(p[2],where,8),
        frame:{errorCode:hexNumber(p[3],where,8),eip:hexNumber(p[4],where,8),
          cs:hexNumber(p[5],where,8),eflags:hexNumber(p[6],where,8)},
        faulting:{cs:hexNumber(p[7],where,4),eip:hexNumber(p[8],where,8)},
        handler:{cs:hexNumber(p[9],where,4),eip:hexNumber(p[10],where,8)},
        preTick:decimal(p[11],where),postTick:decimal(p[12],where),
        causeOrdinal:decimal(p[13],where),tick:decimal(p[12],where),
        ordinal:decimal(p[14],where)},where);
    }else if(tag==='WRITE'){
      assert(p.length===4&&/^(?:[0-9a-f]{2})+$/.test(p[1]),`${where}: write bytes`);
      add({kind:'write',address:hexNumber(p[0],where,8),bytes:p[1],
        tick:decimal(p[2],where),ordinal:decimal(p[3],where),
        provenance:'host-physical'},where);
    }else if(tag==='PORT'){
      assert(p.length===5,`${where}: port fields`);
      add({kind:'port',port:hexNumber(p[0],where,4),width:decimal(p[1],where),
        value:hexNumber(p[2],where,8),tick:decimal(p[3],where),
        ordinal:decimal(p[4],where)},where);
    }else if(tag==='IRQ_LINE'){
      assert(p.length===4,`${where}: IRQ line fields`);
      add({kind:'irq-line',asserted:bit(p[0],where),vector:hexNumber(p[1],where,2),
        tick:decimal(p[2],where),ordinal:decimal(p[3],where)},where);
    }else if(tag==='IRQ_ACK'){
      assert(p.length===5,`${where}: IRQ ACK fields`);
      add({kind:'irq-ack',vector:hexNumber(p[0],where,2),
        entry:{cs:hexNumber(p[1],where,4),eip:hexNumber(p[2],where,8)},
        tick:decimal(p[3],where),ordinal:decimal(p[4],where)},where);
    }else if(tag==='IRQ_DELIVERED'){
      assert(p.length===11,`${where}: IRQ delivery fields`);
      add({kind:'irq-delivered',vector:hexNumber(p[0],where,2),
        entry:{cs:hexNumber(p[1],where,4),eip:hexNumber(p[2],where,8)},
        handler:{cs:hexNumber(p[3],where,4),eip:hexNumber(p[4],where,8)},
        sp:hexNumber(p[5],where,4),frame:{eip:hexNumber(p[6],where,8),
          cs:hexNumber(p[7],where,8),eflags:hexNumber(p[8],where,8)},
        tick:decimal(p[9],where),ordinal:decimal(p[10],where)},where);
    }else if(tag==='HALT_IDLE'){
      assert(p.length===7,`${where}: idle fields`);
      add({kind:'halt-idle',tick:decimal(p[0],where),
        cursor:{cs:hexNumber(p[1],where,4),eip:hexNumber(p[2],where,8)},
        ifFlag:ifValue(p[3],where),activity:decimal(p[4],where),
        pendingEvent:hexNumber(p[5],where,8),ordinal:decimal(p[6],where)},where);
    }else if(tag==='ACTION'){
      assert(p.length===3&&p[0]==='deadline-consumed',`${where}: unknown host action`);
      add({kind:'deadline-consumed',tick:decimal(p[1],where),
        ordinal:decimal(p[2],where)},where);
    }else if(tag==='SLICE'){
      assert(activation&&!finalRecord&&p.length===30,`${where}: malformed resume result`);
      const requested=decimal(p[0],where),effectiveTicks=decimal(p[1],where),
        chargedTicks=decimal(p[2],where),reason=reasons[decimal(p[3],where)];
      assert(requested===(budget??4294967295),`${where}: wrong requested C ABI budget`);
      const entry={cs:hexNumber(p[4],where,4),eip:hexNumber(p[5],where,8)};
      const exit={cs:hexNumber(p[6],where,4),eip:hexNumber(p[7],where,8)};
      const beforeTick=decimal(p[8],where),afterTick=decimal(p[9],where);
      assert(beforeTick===prior.ticks&&afterTick>=beforeTick,`${where}: raw tick discontinuity`);
      const after={ticks:afterTick};
      for(let i=0;i<names.length;i++)after[names[i]]=decimal(p[10+i],where);
      after.ifFlag=ifValue(p[19],where);
      after.activity=decimal(p[21],where);
      after.pendingEvent=hexNumber(p[23],where,8);
      after.eventDue=bit(p[24],where);after.pendingIrq=bit(p[25],where);
      after.irqDelivered=bit(p[26],where);after.irqVector=decimal(p[27],where);
      after.pendingFault=bit(p[28],where);after.portCommitted=bit(p[29],where);
      const slice={requestedTicks:budget,effectiveTicks,chargedTicks,reason,
        entry,exit,before:prior,after,journalEndOrdinal:lastOrdinal,
        entryIf:ifValue(p[18],where),entryActivity:decimal(p[20],where),
        entryPendingEvent:hexNumber(p[22],where,8)};
      slices.push(slice);
      prior=Object.fromEntries(['ticks',...names].map(name=>[name,after[name]]));
    }else if(tag==='FINAL'){
      assert(!finalRecord&&p.length===23,`${where}: duplicate/malformed final`);
      finalRecord={ticks:decimal(p[0],where),attempts:decimal(p[1],where),
        completed:decimal(p[2],where),repIterations:decimal(p[3],where),
        faults:decimal(p[4],where),portCommits:decimal(p[5],where),
        irqDeliveries:decimal(p[6],where),haltIdleCuts:decimal(p[7],where),
        ramWords:{pde0:le32Bytes(p[8],where),
          pte5:le32Bytes(p[9],where),
          data5:le32Bytes(p[10],where),
          cr2scratch:le32Bytes(p[11],where),
          pfCount:hexNumber(p[12],where,2),shadow:hexNumber(p[13],where,2),
          irqCount:hexNumber(p[14],where,2),
          repStart:le32Bytes(p[15],where),
          repEnd:le32Bytes(p[16],where),
          frame1:{eip:hexNumber(p[17],where,8),cs:hexNumber(p[18],where,8),
            eflags:hexNumber(p[19],where,8)},
          frame2:{eip:hexNumber(p[20],where,8),cs:hexNumber(p[21],where,8),
            eflags:hexNumber(p[22],where,8)}}};
    }else if(tag==='STATE'){
      assert(finalRecord&&!state,`${where}: final selected state misplaced`);
      state=parseState(p,where);
    }else if(tag==='CALLBACKS'){
      assert(state&&!callbacks&&p.length===4,`${where}: callbacks misplaced`);
      callbacks={physicalReads:decimal(p[0],where),physicalWrites:decimal(p[1],where),
        executePages:decimal(p[2],where),tickCallbacks:decimal(p[3],where)};
    }else if(tag==='FALLBACK'){
      assert(callbacks&&!fallback&&p.length===5,`${where}: fallback misplaced`);
      fallback=Object.fromEntries(['bochsRamReads','bochsRamWrites',
        'bochsDirectPointers','bochsPio','bochsTimer']
        .map((name,i)=>[name,decimal(p[i],where)]));
    }else if(tag==='DEACTIVATE'){
      assert(state&&callbacks&&fallback&&!deactivated&&p.length===1&&
        p[0]==='proof-complete',`${where}: deactivation lacks final proof`);
      deactivated=true;
    }else throw new Error(`${where}: unknown BWS5 record`);
  }
  assert(activation&&finalRecord&&state&&callbacks&&fallback&&deactivated&&
    slices.length,`${mode}: incomplete native event arm`);
  for(const name of ['ticks','attempts','completed','repIterations','faults',
    'portCommits','irqDeliveries','haltIdleCuts'])
    assert(finalRecord[name]===prior[name],`${mode}: FINAL ${name} differs from ABI`);
  return {arm:{mode,requestedBudget:budget,slices,journal,
    final:{selectedState:state,ramWords:finalRecord.ramWords},
    totals:prior,hostCallbacks:callbacks,fallback},activation,apiProbes};
}

const armBudgets={continuous:null,budget1:1,budget2:2,budget257:257};
const failureProbes={
  outOfRangePhysical:['out-of-range-physical','host-physical-read'],
  unexpectedPio:['unexpected-pio','host-port-out'],
  bochsRamRead:['bochs-ram-read','Bochs-RAM-read-fallback'],
  bochsRamWrite:['bochs-ram-write','Bochs-RAM-write-fallback'],
  bochsDirectPointer:['bochs-direct-pointer','Bochs-direct-pointer-fallback'],
  bochsPio:['bochs-pio','Bochs-PIO-fallback'],
  bochsTimer:['bochs-timer','Bochs-timer-fallback'],
};

export function failureProbe(result,name){
  const [kind,observedFailure]=failureProbes[name];
  const records=tags(result.stderr);
  assert(result.code===null && result.signal==='SIGABRT',
    `${name}: fail-closed probe did not abort`);
  assert(records.length>0 && records.at(-1)?.[0]==='FAIL' &&
    records.at(-1)?.length===2 && records.at(-1)?.[1]===observedFailure &&
    records.filter(record=>record[0]==='FAIL').length===1 &&
    !records.some(record=>['FINAL','DEACTIVATE'].includes(record[0])),
  `${name}: exact active guard was not observed`);
  return {rejected:true,kind,observedFailure};
}

function retainRaw(directory,label,result,bochsLog){
  const paths={};
  for(const [kind,content] of [['stdout',result.stdout],['stderr',result.stderr]]){
    const basename=`${label}.${kind}`;
    const path=join(directory,basename);
    writeFileSync(path,Buffer.from(content,'latin1'));
    paths[kind]={path:basename,sha256:fileSha(path)};
  }
  assert(existsSync(bochsLog),`${label}: Bochs host log missing`);
  const basename=`${label}.bochs.log`;
  copyFileSync(bochsLog,join(directory,basename));
  paths.bochsLog={path:basename,sha256:fileSha(join(directory,basename))};
  return {exitCode:result.code,signal:result.signal,files:paths};
}

function preparedInputs(tree,directory){
  const board=sourceInventory();
  const built=patchedTree(tree);
  const fixtureBuild=join(directory,'fixture');mkdirSync(fixtureBuild,{recursive:true});
  const fixtureImage=assembleFixture(fixtureBuild);
  assert(fixtureImage.imageSha256===
    '1b4ea51b9e272f4c55930dac86aa3b813235c455ccef597fa9b51caaf5715aaa',
  'assembled owned paged-event fixture differs from frozen input');
  const floppyPath=join(directory,'owned-floppy.img');
  writeFileSync(floppyPath,fixtureImage.floppy);
  const hostConfig=bochsrc(directory,floppyPath);
  assert(hostConfig.biosSha256===board.reference.source.biosSha256 &&
    hostConfig.vgaBiosSha256===board.reference.source.vgaBiosSha256,
  'free BIOS differs from frozen native slice receipt');
  const source={boardRevision:board.boardRevision,sourceHashes:board.sourceHashes,
    bochsRevision:revision,patchHashes:built.patchHashes,
    configSha256:built.configSha256,binarySha256:built.binarySha256,
    imageSha256:fixtureImage.imageSha256,
    floppySha256:fileSha(floppyPath),bochsrcSha256:fileSha(hostConfig.rc),
    biosSha256:hostConfig.biosSha256,vgaBiosSha256:hostConfig.vgaBiosSha256};
  return {source,binary:built.binary,hostConfig,floppyPath};
}

function recheckInputs(tree,source,hostConfig,floppyPath){
  const board=sourceInventory(),built=patchedTree(tree);
  assert(board.boardRevision===source.boardRevision &&
    JSON.stringify(board.sourceHashes)===JSON.stringify(source.sourceHashes) &&
    JSON.stringify(built.patchHashes)===JSON.stringify(source.patchHashes) &&
    built.configSha256===source.configSha256 &&
    built.binarySha256===source.binarySha256 &&
    fileSha(hostConfig.rc)===source.bochsrcSha256 &&
    fileSha(floppyPath)===source.floppySha256 &&
    fileSha(resolve(repo,'roms/free-at-bios/BIOS-bochs-legacy'))===source.biosSha256 &&
    fileSha(resolve(repo,'roms/free-at-bios/vgabios-lgpl.bin'))===source.vgaBiosSha256,
  'source, binary, config, ROM, medium or host configuration changed during capture');
}

async function runCapture(tree,outdir){
  assert(!existsSync(outdir),'output directory must be new');
  mkdirSync(outdir,{recursive:true});
  const {source,binary,hostConfig,floppyPath}=preparedInputs(tree,outdir);
  const artifacts={bochsrc:{path:'bochsrc',sha256:fileSha(hostConfig.rc)},
    floppy:{path:'owned-floppy.img',sha256:fileSha(floppyPath)}},
    arms={},armSeeds={};
  let activation=null,apiProbes=null;
  for(const [name,budget] of Object.entries(armBudgets)){
    const result=await capture(binary,hostConfig.rc,budget===null?'continuous':String(budget));
    artifacts[name]=retainRaw(outdir,name,result,hostConfig.log);
    assert(result.code===0 && result.signal===null,`${name}: native Bochs did not exit cleanly`);
    const parsed=parseArm(result.stderr,name,budget);
    if(activation===null){activation=parsed.activation;
      apiProbes=parsed.apiProbes;}
    else assert(JSON.stringify(parsed.apiProbes)===JSON.stringify(apiProbes),
      `${name}: C ABI argument probe inventory changed`);
    armSeeds[name]={ramSha256:parsed.activation.ramSha256,
      cpuSeedSha256:parsed.activation.cpuSeedSha256,
      handoff:parsed.activation.handoff};
    arms[name]=parsed.arm;
    assert(fileSha(floppyPath)===source.floppySha256,
      `${name}: owned fixture medium was modified`);
  }
  const probes={};
  for(const [name,[kind]] of Object.entries(failureProbes)){
    const result=await capture(binary,hostConfig.rc,'continuous',kind);
    artifacts[name]=retainRaw(outdir,name,result,hostConfig.log);
    probes[name]=failureProbe(result,name);
    assert(fileSha(floppyPath)===source.floppySha256,
      `${name}: owned fixture medium was modified`);
  }
  recheckInputs(tree,source,hostConfig,floppyPath);
  const report={schema:'bw.bochs-cpu3-native-paged-events.v1',source,activation,
    armSeeds,apiProbes,arms,probes,artifacts};
  const result=assertNativePagedEventsSelfParity(report);
  writeFileSync(join(outdir,'capture.json'),JSON.stringify(report,null,2)+'\n');
  writeFileSync(join(outdir,'result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({capture:join(outdir,'capture.json'),
    captureSha256:fileSha(join(outdir,'capture.json')),
    result:join(outdir,'result.json'),resultSha256:fileSha(join(outdir,'result.json')),
    status:result.status,boardRevision:source.boardRevision},null,2));
}

async function main(){
  const [mode,treeArg,outdirArg,...extra]=process.argv.slice(2);
  assert(!extra.length && ['--preflight','--capture'].includes(mode) && treeArg &&
    (mode==='--capture' ? !!outdirArg : !outdirArg),
  'usage: node scripts/run-bochs-cpu3-native-paged-events-compare.mjs --preflight BOCHS_TREE | --capture BOCHS_TREE NEW_OUTPUT_DIRECTORY');
  const tree=resolve(treeArg);
  if(mode==='--capture')return runCapture(tree,resolve(outdirArg));
  const scratch=mkdtempSync(join(tmpdir(),'bw-native-paged-events-preflight-'));
  try{
    const {source}=preparedInputs(tree,scratch);
    console.log(JSON.stringify({status:'preflight-only',source},null,2));
  }finally{rmSync(scratch,{recursive:true,force:true});}
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{console.error(error.stack??String(error));process.exitCode=1;});
