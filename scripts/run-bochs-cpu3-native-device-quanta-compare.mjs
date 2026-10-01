/** Source-bound free CPU3 timer/PIC host proof over dedicated pipe RPC. */
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createInterface} from 'node:readline';
import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,
  writeFileSync} from 'node:fs';
import {endianness,tmpdir} from 'node:os';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {NativeDeviceQuantumHost,boardHz,clocksPerQuantum,pitHz} from
  './bochs-cpu3-native-device-quanta-host.mjs';
import {assertNativeDeviceQuantaProof} from './bochs-cpu3-native-device-quanta-compare.mjs';
import {patchPinnedSource,revision,upstreamHashes} from
  './bochs-cpu3-native-device-quanta/patch.mjs';
import {expandI80386SourceInventory} from './lib/i80386-source-inventory.mjs';

const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const fixture='test/fixtures/i80386-bochs-cpu3-native-device-quanta.S';
const receipt='docs/receipts/2026-09-30-i80386-bochs-cpu3-native-memory-map-capture.json';
const mapId='ram00000-9ffff,mmio-a0000,rom-f0000-fffff,ram-100000-17ffff,openbus-rest';
const staticSourcePaths=[
  'scripts/bochs-cpu3-native-slice/patch.mjs',
  'scripts/bochs-cpu3-native-events/patch.mjs',
  'scripts/bochs-cpu3-native-memory-map/patch.mjs',
  'scripts/bochs-cpu3-native-device-quanta/abi.h',
  'scripts/bochs-cpu3-native-device-quanta/runtime.h',
  'scripts/bochs-cpu3-native-device-quanta/runtime.inc',
  'scripts/bochs-cpu3-native-device-quanta/patch.mjs',
  'scripts/prepare-bochs-cpu3-native-device-quanta.mjs',
  'scripts/bochs-cpu3-native-device-quanta-host.mjs',
  'scripts/bochs-cpu3-native-device-quanta-compare.mjs',
  'scripts/run-bochs-cpu3-native-device-quanta-compare.mjs',
  'test/i80386-native-device-quanta.test.mjs',
  'test/i80386-native-device-quanta-report.test.mjs',
  'test/fixtures/i80386-bochs-cpu3-native-device-quanta-initial-capture.json.gz',
  fixture,
  'src/i8254.js','src/i8259.js','src/i8086-machine.js',
  'src/experimental/i80386-at-machine.js',
  'roms/free-at-bios/BIOS-bochs-legacy',
  'roms/free-at-bios/vgabios-lgpl.bin',receipt];
const sourcePaths=[...new Set([...staticSourcePaths,
  ...expandI80386SourceInventory([
    './run-bochs-cpu3-native-device-quanta-compare.mjs',
    './bochs-cpu3-native-device-quanta-host.mjs',
    './bochs-cpu3-native-device-quanta-compare.mjs',
    './lib/i80386-source-inventory.mjs'],import.meta.url)
    .map(path=>relative(repo,resolve(dirname(fileURLToPath(import.meta.url)),path)))]
  )].sort();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fileSha=path=>sha(readFileSync(path));
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
const assert=(condition,message)=>{if(!condition)throw Error(`device quantum proof runner: ${message}`);};
const pinnedReceiptSha='7f5edc6639491b49b015784dda968e4786a271f71551e50a24b3350b30f5591a';
const fixedImageSha='57f0247a8c198cd3aa0aa33b35e80d303eb3ae9ca50483cd22917e1d6d6b1d3c';
const fixedBiosSha='6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac';
const fixedVgaSha='76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1';
const budgets={continuous:1000000,budget1:1,budget2:2,budget257:257};
const nativeSafetyCap=1000000;
const guardReasons={
  'out-of-range-physical':'host-physical-read',
  'unsupported-span-width':'host-physical-read',
  'unexpected-pio':'host-port-out',
  'unsafe-execute-rom':'unsafe-execute-page',
  'unsafe-execute-mmio':'unsafe-execute-page',
  'unsafe-execute-unmapped':'unsafe-execute-page',
  'bochs-ram-read':'Bochs-RAM-read-fallback',
  'bochs-ram-write':'Bochs-RAM-write-fallback',
  'bochs-direct-pointer':'Bochs-direct-pointer-fallback',
  'bochs-pio':'Bochs-PIO-fallback',
  'bochs-timer':'Bochs-timer-fallback',
};
const transportCases={
  'command-bad-sequence':{stage:'command',failure:'rpc-command-sequence',
    payload:`BWR8\tCMD\t2\tRUN\t1\t1\t18446744073709551615\n`},
  'command-negative-budget':{stage:'command',failure:'rpc-decimal',
    payload:`BWR8\tCMD\t1\tRUN\t-1\t1\t18446744073709551615\n`},
  'command-overflow-budget':{stage:'command',failure:'rpc-overflow',
    payload:`BWR8\tCMD\t1\tRUN\t18446744073709551616\t1\t18446744073709551615\n`},
  'command-overlong-line':{stage:'command',failure:'rpc-line-bound',
    payload:`BWR8\tCMD\t1\tRUN\t1\t1\t${'9'.repeat(256)}\n`},
  'reply-wrong-sequence':{stage:'reply',failure:'rpc-reply',
    payload:'BWR8\tREP\t2\tOK\t0\n'},
  'reply-negative-value':{stage:'reply',failure:'rpc-decimal',
    payload:'BWR8\tREP\t1\tOK\t-1\n'},
  'reply-out-of-range':{stage:'reply',failure:'rpc-reply-range',
    payload:'BWR8\tREP\t1\tOK\t4294967296\n'},
};
const u64max='18446744073709551615';
const canonicalU64=(value,at)=>{
  assert(typeof value==='string'&&/^(0|[1-9][0-9]*)$/.test(value)&&
    BigInt(value)<=BigInt(u64max),`${at}: canonical uint64 required`);
  return value;
};

function ownedRomInclude(){
  const rom=readFileSync(resolve(repo,'roms/free-at-bios/BIOS-bochs-legacy'));
  assert(rom.length===65536&&sha(rom)===fixedBiosSha,'free BIOS ROM changed');
  const lines=[];
  for(let at=0;at<rom.length;at+=16)
    lines.push('  '+[...rom.subarray(at,at+16)].map(byte=>
      `0x${byte.toString(16).padStart(2,'0')}`).join(',')+',');
  return Buffer.from('// Generated from source-pinned roms/free-at-bios/BIOS-bochs-legacy.\n'
    +`static const unsigned char bw_owned_rom[65536] = {\n${lines.join('\n')}\n};\n`
    +`static const char *const bw_owned_rom_sha256 = "${sha(rom)}";\n`);
}

function sourceInventory(){
  assert(endianness()==='LE','callback bytes require little-endian host');
  assert(!git(repo,'status','--porcelain'),'source checkout must be clean');
  const sourceHashes={};
  for(const path of sourcePaths){
    execFileSync('git',['ls-files','--error-unmatch','--',path],{cwd:repo,stdio:'ignore'});
    const committed=execFileSync('git',['show',`HEAD:${path}`],
      {cwd:repo,maxBuffer:16*1024*1024});
    const current=readFileSync(resolve(repo,path));
    assert(sha(committed)===sha(current),`source differs from HEAD: ${path}`);
    sourceHashes[path]=sha(current);
  }
  assert(sourceHashes[receipt]===pinnedReceiptSha,'historical native map receipt changed');
  assert(boardHz===6_000_000&&clocksPerQuantum===6&&pitHz===1_193_182,
    'actual model/AT functional profile changed');
  return {boardRevision:git(repo,'rev-parse','HEAD'),sourceHashes};
}

function patchedTree(root){
  assert(git(root,'rev-parse','HEAD')===revision,'unexpected Bochs revision');
  const changed=git(root,'diff','--name-only','HEAD','--').split('\n').filter(Boolean).sort();
  const expected=Object.keys(upstreamHashes).sort();
  assert(JSON.stringify(changed)===JSON.stringify(expected),'native patch inventory differs');
  const patchHashes={};
  for(const path of expected){
    const upstream=execFileSync('git',['show',`HEAD:${path}`],{cwd:root});
    const actual=readFileSync(resolve(root,path));
    assert(sha(actual)===sha(patchPinnedSource(path,upstream)),
      `native patch bytes differ: ${path}`);
    patchHashes[path]=sha(actual);
  }
  for(const [source,target] of [
    ['scripts/bochs-cpu3-native-device-quanta/abi.h','bochs/cpu/bw_slice_abi.h'],
    ['scripts/bochs-cpu3-native-device-quanta/runtime.h','bochs/cpu/bw_slice_runtime.h'],
    ['scripts/bochs-cpu3-native-device-quanta/runtime.inc','bochs/cpu/bw_slice_runtime.inc']])
    assert(fileSha(resolve(repo,source))===fileSha(resolve(root,target)),
      `copied runtime bytes differ: ${target}`);
  assert(sha(ownedRomInclude())===fileSha(resolve(root,'bochs/cpu/bw_owned_rom.inc')),
    'compiled owned ROM differs');
  const config=resolve(root,'bochs/config.h'),text=readFileSync(config,'utf8');
  for(const option of ['#define BX_CPU_LEVEL 3','#define BX_DEBUGGER 0',
    '#define BX_SUPPORT_SMP 0','#define BX_SUPPORT_REPEAT_SPEEDUPS 0',
    '#define BX_SUPPORT_HANDLERS_CHAINING_SPEEDUPS 0','#define BX_USE_IDLE_HACK 0'])
    assert(text.split('\n').includes(option),`Bochs config missing ${option}`);
  const binary=resolve(root,'bochs/bochs');
  assert(existsSync(binary),'native binary absent');
  return {binary,patchHashes,configSha256:fileSha(config),binarySha256:fileSha(binary)};
}

function assembleFixture(directory){
  const object=join(directory,'guest.o'),image=join(directory,'guest.bin');
  execFileSync('as',['--32','-o',object,resolve(repo,fixture)]);
  execFileSync('ld',['-m','elf_i386','-Ttext','0x7c00','--oformat','binary',
    '-o',image,object]);
  const symbols=execFileSync('nm',['--defined-only',object],{encoding:'utf8'});
  for(const [name,address] of Object.entries({setup:0x7e00,protected_entry:0x7eb7,
    pic_init:0x7ed8,pit_init:0x7ee8,rep_fill:0x7f0c,zero_rep:0x7f64,
    ordinary_fault_store:0x7f84,rep_one:0x7fcf,shadow_successor:0x7ff4,
    after_shadow:0x7ff9,final_marker:0x8000,terminal_hlt:0x801d,
    terminal_loop:0x801e,pf_handler:0x8026,cr3_reload:0x8097,
    iret_retry:0x809d,irq_handler:0x809f,irq_eoi:0x80fd})){
    const match=symbols.match(new RegExp(`^([0-9a-f]+) [tT] ${name}$`,'m'));
    assert(match&&0x7c00+Number.parseInt(match[1],16)===address,
      `fixture symbol changed: ${name}`);
  }
  const bytes=readFileSync(image);
  assert(sha(bytes)===fixedImageSha&&bytes.length===2560,'free fixture bytes changed');
  const floppy=Buffer.alloc(1474560);bytes.copy(floppy);
  return {imageSha256:sha(bytes),floppy};
}

function bochsrc(directory,floppyPath){
  const bios=resolve(repo,'roms/free-at-bios/BIOS-bochs-legacy');
  const vga=resolve(repo,'roms/free-at-bios/vgabios-lgpl.bin');
  const rc=join(directory,'bochsrc'),log=join(directory,'bochs.log');
  writeFileSync(rc,[
    'display_library: nogui','memory: guest=16, host=16',
    `romimage: file=${bios}`,`vgaromimage: file=${vga}`,
    'cpu: count=1, ips=10000000','clock: sync=none, time0=946684800',
    `floppya: 1_44=${floppyPath}, status=inserted`,
    'boot: floppy','port_e9_hack: enabled=1',`log: ${log}`,
    'panic: action=fatal','error: action=report','info: action=report',
    'debug: action=ignore','mouse: enabled=0',
  ].join('\n')+'\n');
  return {rc,log,biosSha256:fileSha(bios),vgaBiosSha256:fileSha(vga)};
}

const decimal=(text,at)=>{
  assert(typeof text==='string'&&/^(0|[1-9][0-9]*)$/.test(text),`${at}: canonical decimal required`);
  const number=Number(text);
  assert(Number.isSafeInteger(number),`${at}: unsafe decimal`);
  return number;
};
const hex=(text,width,at)=>{
  assert(typeof text==='string'&&new RegExp(`^[0-9a-f]{${width}}$`).test(text),
    `${at}: fixed lowercase hex required`);
  return Number.parseInt(text,16);
};
const bit=(text,at)=>{const value=decimal(text,at);assert(value<=1,`${at}: bit required`);return !!value;};
const ifFlag=(text,at)=>{
  const value=decimal(text,at);assert(value===0||value===512,`${at}: IF must be 0/512`);
  return !!value;
};
const stateNames=['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags',
  'cr0','cr2','cr3','cs','ds','ss','gdtrBase','gdtrLimit','idtrBase','idtrLimit'];
function parseState(fields,at){
  assert(fields.length===20,`${at}: selected state width changed`);
  return Object.fromEntries(fields.map((value,i)=>[stateNames[i],
    hex(value,[13,14,15,17,19].includes(i)?4:8,`${at}.${stateNames[i]}`)]));
}
const seedPages=[...Array.from({length:160},(_,i)=>i),
  ...Array.from({length:128},(_,i)=>i+256)];

/** Rejects unknown/malformed BWS8 records; keeps native callback chronology. */
export function parseNativeLog(stderr){
  const lines=stderr.split('\n').filter(line=>line.startsWith('BWS'));
  assert(lines.length>100,'native BWS8 evidence absent');
  const records=[],events=[],slices=[],seed=[];
  let seedState,activation,romId,mapIdentity,handoff,a20Handoff,ready,
    ramFinal,finalState,finalCounters,callbacks,fallback,deactivated=false;
  const apiProbes={};
  let ordinal=-1,seedIndex=0;
  const event=(tag,value)=>{
    assert(value.ordinal>ordinal,`${tag}: nonmonotonic native ordinal`);
    ordinal=value.ordinal;
    events.push({tag,...value});
  };
  for(const [lineNo,line] of lines.entries()){
    const [prefix,tag,...p]=line.split('\t'),at=`BWS8 line ${lineNo+1} ${tag}`;
    assert(prefix==='BWS8',`${at}: unexpected proof prefix`);
    if(tag==='SEEDSTATE'){
      assert(!seedState,`${at}: duplicate`);seedState=parseState(p,at);
    }else if(tag==='SEEDPAGE'){
      assert(p.length===2&&seedIndex<seedPages.length&&
        decimal(p[0],at)===seedPages[seedIndex]&&/^[0-9a-f]{8192}$/.test(p[1]),
      `${at}: wrong decoded RAM page`);
      seed.push(Buffer.from(p[1],'hex'));seedIndex++;
    }else if(tag==='IRQ_HANDOFF'){
      assert(!handoff&&p.length===4,`${at}: handoff shape`);
      handoff={inheritedPending:hex(p[0],8,at),inheritedMask:hex(p[1],8,at),
        inheritedIF:decimal(p[2],at),ownedPending:hex(p[3],8,at)};
    }else if(tag==='A20_HANDOFF'){
      assert(!a20Handoff&&p.length===3&&p[2]==='8042-low',`${at}: handoff shape`);
      a20Handoff={enabled:bit(p[0],at),latch:hex(p[1],2,at),source:p[2]};
    }else if(tag==='ROM_ID'){
      assert(!romId&&p.length===2&&/^[0-9a-f]{64}$/.test(p[0])&&
        decimal(p[1],at)===65536,`${at}: ROM identity`);
      romId={sha256:p[0],bytes:65536};
    }else if(tag==='MAP_ID'){
      assert(!mapIdentity&&p.length===1&&p[0]===mapId,`${at}: map identity`);
      mapIdentity=p[0];
    }else if(tag==='ACTIVATE'){
      assert(!activation&&p.length===4&&seedIndex===seedPages.length&&
        seedState&&romId&&mapIdentity&&handoff&&a20Handoff,`${at}: seed incomplete`);
      activation={cs:hex(p[0],4,at),eip:hex(p[1],8,at),
        copiedBytes:decimal(p[2],at),inheritedA20:bit(p[3],at),
        decodedRamPages:seedPages.length,
        seedDomain:'decoded-ram-physical-pages:0-159,256-383;packed-in-page-order',
        decodedRamSeedSha256:sha(Buffer.concat(seed)),
        cpuSeedSha256:sha(Buffer.from(JSON.stringify(seedState))),
        seedState,romId,mapId:mapIdentity,handoff,a20Handoff};
    }else if(tag==='PROBE'){
      assert(p.length===2&&!Object.hasOwn(apiProbes,p[0]),`${at}: probe shape`);
      apiProbes[p[0]]=p[1];
    }else if(tag==='READY'){
      assert(!ready&&p.length===4,`${at}: READY shape`);
      ready={cs:hex(p[0],4,at),eip:hex(p[1],8,at),nativeTicks:decimal(p[2],at),
        successfulQuanta:decimal(p[3],at)};
    }else if(tag==='RPC_REQ'){
      assert(p.length===8,`${at}: request shape`);
      event(tag,{seq:decimal(p[0],at),kind:p[1],arg0:decimal(p[2],at),
        arg1:decimal(p[3],at),arg2:decimal(p[4],at),nativeTicks:decimal(p[5],at),
        successfulQuanta:decimal(p[6],at),ordinal:decimal(p[7],at)});
    }else if(tag==='RPC_REP'){
      assert(p.length===5,`${at}: reply shape`);
      event(tag,{seq:decimal(p[0],at),value:decimal(p[1],at),
        nativeTicks:decimal(p[2],at),successfulQuanta:decimal(p[3],at),
        ordinal:decimal(p[4],at)});
    }else if(tag==='CMD'){
      assert(p.length===6&&['RUN','LINE','STOP'].includes(p[1]),`${at}: command shape`);
      event(tag,{seq:decimal(p[0],at),verb:p[1],arg0:decimal(p[2],at),
        arg1:decimal(p[3],at),deadline:canonicalU64(p[4],at),
        ordinal:decimal(p[5],at)});
    }else if(tag==='ATTEMPT'){
      assert(p.length===5,`${at}: attempt shape`);
      event(tag,{cs:hex(p[0],4,at),eip:hex(p[1],8,at),
        nativeTicks:decimal(p[2],at),successfulQuanta:decimal(p[3],at),
        ordinal:decimal(p[4],at)});
    }else if(tag==='QUANTUM'){
      assert(p.length===10,`${at}: quantum shape`);
      event(tag,{kind:decimal(p[0],at),cs:hex(p[1],4,at),
        eip:hex(p[2],8,at),postECX:hex(p[3],8,at),postCX:hex(p[4],4,at),
        postEDI:hex(p[5],8,at),preQ:decimal(p[6],at),
        successfulQuanta:decimal(p[7],at),nativeTicks:decimal(p[8],at),
        ordinal:decimal(p[9],at)});
    }else if(tag==='NATIVE_TICK'){
      assert(p.length===5,`${at}: native tick shape`);
      event(tag,{count:decimal(p[0],at),preTick:decimal(p[1],at),
        nativeTicks:decimal(p[2],at),successfulQuanta:decimal(p[3],at),
        ordinal:decimal(p[4],at)});
    }else if(tag==='FAULT_BEGIN'){
      assert(p.length===8,`${at}: fault begin shape`);
      event(tag,{vector:decimal(p[0],at),error:decimal(p[1],at),
        cr2:hex(p[2],8,at),cs:hex(p[3],4,at),eip:hex(p[4],8,at),
        nativeTicks:decimal(p[5],at),successfulQuanta:decimal(p[6],at),
        ordinal:decimal(p[7],at)});
    }else if(tag==='FAULT_DELIVERED'){
      assert(p.length===12,`${at}: fault delivery shape`);
      event(tag,{causeOrdinal:decimal(p[0],at),preTick:decimal(p[1],at),
        nativeTicks:decimal(p[2],at),successfulQuanta:decimal(p[3],at),
        handlerCs:hex(p[4],4,at),handlerEip:hex(p[5],8,at),
        sp:hex(p[6],8,at),frameError:hex(p[7],8,at),
        frameEip:hex(p[8],8,at),frameCs:hex(p[9],8,at),
        frameFlags:hex(p[10],8,at),ordinal:decimal(p[11],at)});
    }else if(tag==='MEM'){
      assert(p.length===9&&['R','W'].includes(p[0]),`${at}: memory shape`);
      event(tag,{rw:p[0],raw:hex(p[1],8,at),effective:hex(p[2],8,at),
        class:p[3],value:hex(p[4],2,at),effect:p[5],
        tick:decimal(p[6],at),ordinal:decimal(p[7],at),why:p[8]});
    }else if(tag==='EXEC'){
      assert(p.length===5&&p[2]==='ram',`${at}: execute shape`);
      event(tag,{rawPage:hex(p[0],8,at),effectivePage:hex(p[1],8,at),
        class:p[2],tick:decimal(p[3],at),ordinal:decimal(p[4],at)});
    }else if(tag==='PORT'){
      assert(p.length===6&&['in','out'].includes(p[0]),`${at}: port shape`);
      event(tag,{direction:p[0],port:hex(p[1],4,at),width:decimal(p[2],at),
        value:hex(p[3],8,at),tick:decimal(p[4],at),ordinal:decimal(p[5],at)});
    }else if(tag==='IRQ_LINE'){
      assert(p.length===3,`${at}: line shape`);
      event(tag,{asserted:bit(p[0],at),tick:decimal(p[1],at),ordinal:decimal(p[2],at)});
    }else if(tag==='IRQ_ACK'){
      assert(p.length===5,`${at}: ACK shape`);
      event(tag,{vector:hex(p[0],2,at),cs:hex(p[1],4,at),
        eip:hex(p[2],8,at),tick:decimal(p[3],at),ordinal:decimal(p[4],at)});
    }else if(tag==='IRQ_DELIVERED'){
      assert(p.length===11,`${at}: delivery shape`);
      event(tag,{vector:hex(p[0],2,at),entryCs:hex(p[1],4,at),
        entryEip:hex(p[2],8,at),handlerCs:hex(p[3],4,at),
        handlerEip:hex(p[4],8,at),sp:hex(p[5],4,at),
        frameEip:hex(p[6],8,at),frameCs:hex(p[7],8,at),
        frameFlags:hex(p[8],8,at),tick:decimal(p[9],at),
        ordinal:decimal(p[10],at)});
    }else if(tag==='HALT_IDLE'){
      assert(p.length===7,`${at}: HLT idle shape`);
      event(tag,{tick:decimal(p[0],at),cs:hex(p[1],4,at),
        eip:hex(p[2],8,at),ifFlag:ifFlag(p[3],at),
        activity:decimal(p[4],at),pending:hex(p[5],8,at),
        ordinal:decimal(p[6],at)});
    }else if(tag==='SLICE'){
      assert(p.length===38,`${at}: slice shape`);
      slices.push({cmdSeq:decimal(p[0],at),requestedNativeTicks:decimal(p[1],at),
        effectiveNativeTicks:decimal(p[2],at),chargedNativeTicks:decimal(p[3],at),
        requestedQuanta:decimal(p[4],at),chargedQuanta:decimal(p[5],at),
        reason:decimal(p[6],at),entry:{cs:hex(p[7],4,at),eip:hex(p[8],8,at)},
        exit:{cs:hex(p[9],4,at),eip:hex(p[10],8,at)},
        beforeNativeTicks:decimal(p[11],at),afterNativeTicks:decimal(p[12],at),
        beforeQuanta:decimal(p[13],at),afterQuanta:decimal(p[14],at),
        attempts:decimal(p[15],at),completed:decimal(p[16],at),
        repIterations:decimal(p[17],at),repPartial:decimal(p[18],at),
        faults:decimal(p[19],at),portCommits:decimal(p[20],at),
        irqDeliveries:decimal(p[21],at),haltIdleCuts:decimal(p[22],at),
        entryIf:ifFlag(p[23],at),exitIf:ifFlag(p[24],at),
        entryActivity:decimal(p[25],at),exitActivity:decimal(p[26],at),
        entryPending:hex(p[27],8,at),exitPending:hex(p[28],8,at),
        eventDue:bit(p[29],at),pendingIrq:bit(p[30],at),
        irqDelivered:bit(p[31],at),irqVector:decimal(p[32],at),
        pendingFault:bit(p[33],at),faultVector:decimal(p[34],at),
        faultError:decimal(p[35],at),faultCr2:hex(p[36],8,at),
        portCommitted:bit(p[37],at)});
    }else if(tag==='RAM_FINAL'){
      assert(!ramFinal&&p.length===21,`${at}: RAM witness shape`);
      ramFinal=Object.fromEntries(['pde0','pte5','pte6','data4000','data4ffc',
        'data5000','data500c','data6000','data6004','cr2a','cr2b','pfCount',
        'shadow','irqCount','copiedEip','copiedCs','copiedFlags','stackEip',
        'stackCs','stackFlags'].map((name,i)=>[name,
        hex(p[i],['pfCount','shadow','irqCount'].includes(name)?2:8,at)]));
      ramFinal.markerCount=decimal(p[20],at);
    }else if(tag==='STATE'){
      assert(!finalState,`${at}: duplicate`);finalState=parseState(p,at);
    }else if(tag==='FINAL'){
      assert(!finalCounters&&p.length===14,`${at}: final counters shape`);
      finalCounters=Object.fromEntries(['nativeTicks','successfulQuanta','attempts',
        'completed','repIterations','repPartial','faults','portCommits',
        'irqDeliveries','haltIdleCuts','rpcRequests','rpcReplies',
        'nativeTickCallbacks','quantumCallbacks']
        .map((name,i)=>[name,decimal(p[i],at)]));
    }else if(tag==='CALLBACKS'){
      assert(!callbacks&&p.length===5,`${at}: callback shape`);
      callbacks=Object.fromEntries(['physicalReads','physicalWrites',
        'executePages','nativeTickCallbacks','quantumCallbacks']
        .map((name,i)=>[name,decimal(p[i],at)]));
    }else if(tag==='FALLBACK'){
      assert(!fallback&&p.length===5,`${at}: fallback shape`);
      fallback=Object.fromEntries(['bochsRamReads','bochsRamWrites',
        'bochsDirectPointers','bochsPio','bochsTimer']
        .map((name,i)=>[name,decimal(p[i],at)]));
    }else if(tag==='DEACTIVATE'){
      assert(!deactivated&&p.length===1&&p[0]==='proof-complete',`${at}: completion shape`);
      deactivated=true;
    }else throw Error(`${at}: unexpected native tag`);
    records.push({tag,fields:p});
  }
  assert(activation&&ready&&ramFinal&&finalState&&finalCounters&&callbacks&&fallback&&
    deactivated&&slices.length&&seedIndex===seedPages.length,
  'native evidence lacks validated completion');
  assert(activation.cs===0&&activation.eip===0x7e00&&activation.copiedBytes===1179648&&
    ready.cs===0&&ready.eip===0x7e00&&ready.nativeTicks===0&&
    ready.successfulQuanta===0,
  'native activation boundary changed');
  return {activation,records,events,slices,seed:{ramSha256:activation.decodedRamSeedSha256,
    cpuSha256:activation.cpuSeedSha256},ramFinal,finalState,finalCounters,
    callbacks,fallback,apiProbes,ready};
}

export function parseRpcLine(line){
  assert(typeof line==='string'&&line.length>0&&line.length<256&&
    /^[\x20-\x7e\t]+$/.test(line)&&!line.includes('\r'),
  'BWR8 line is not bounded canonical ASCII');
  const p=line.split('\t');
  assert(p[0]==='BWR8'&&!p.some(field=>field===''),'BWR8 prefix/field changed');
  if(p[1]==='READY'){
    assert(p.length===6,'READY width changed');
    return {kind:'READY',cs:hex(p[2],4,'READY.cs'),
      eip:hex(p[3],8,'READY.eip'),nativeTicks:decimal(p[4],'READY.nativeTicks'),
      successfulQuanta:decimal(p[5],'READY.quanta')};
  }
  if(p[1]==='REQ'){
    assert(p.length===9&&['PIO_IN','PIO_OUT','NATIVE_TICK','QUANTUM','ACK'].includes(p[3]),
      'REQ shape changed');
    return {kind:'REQ',seq:decimal(p[2],'REQ.seq'),operation:p[3],
      arg0:decimal(p[4],'REQ.arg0'),arg1:decimal(p[5],'REQ.arg1'),
      arg2:decimal(p[6],'REQ.arg2'),nativeTicks:decimal(p[7],'REQ.nativeTicks'),
      successfulQuanta:decimal(p[8],'REQ.quanta')};
  }
  if(p[1]==='DONE'){
    const seq=decimal(p[2],'DONE.seq');
    if(p[3]==='RUN'){
      assert(p.length===18,'RUN DONE width changed');
      return {kind:'DONE',verb:'RUN',seq,reason:decimal(p[4],'RUN.reason'),
        chargedNativeTicks:decimal(p[5],'RUN.chargedNative'),
        chargedQuanta:decimal(p[6],'RUN.chargedQuanta'),
        cs:hex(p[7],4,'RUN.cs'),eip:hex(p[8],8,'RUN.eip'),
        totalNativeTicks:decimal(p[9],'RUN.nativeTicks'),
        totalQuanta:decimal(p[10],'RUN.quanta'),
        attempts:decimal(p[11],'RUN.attempts'),completed:decimal(p[12],'RUN.completed'),
        repIterations:decimal(p[13],'RUN.repIterations'),
        faults:decimal(p[14],'RUN.faults'),ifFlag:ifFlag(p[15],'RUN.IF'),
        activity:decimal(p[16],'RUN.activity'),
        irqDelivered:bit(p[17],'RUN.irqDelivered')};
    }
    assert(p.length===7&&['LINE','STOP'].includes(p[3]),'DONE shape changed');
    return {kind:'DONE',verb:p[3],seq,value:decimal(p[4],'DONE.value'),
      totalNativeTicks:decimal(p[5],'DONE.nativeTicks'),
      totalQuanta:decimal(p[6],'DONE.quanta')};
  }
  throw Error('device quantum proof runner: unexpected BWR8 message');
}

class BoundedLines {
  constructor(stream){
    this.stream=stream;this.partial=Buffer.alloc(0);this.queue=[];this.waiter=null;
    this.ended=false;this.error=null;this.total=0;
    stream.on('data',chunk=>this._feed(chunk));
    stream.on('end',()=>this._end(Error('device quantum proof runner: RPC pipe closed')));
    stream.on('error',error=>this._end(error));
  }
  _end(error){this.ended=true;this.error=error;if(this.waiter){
    const {reject,timer}=this.waiter;clearTimeout(timer);this.waiter=null;reject(error);}}
  _feed(chunk){
    if(this.error)return;
    this.total+=chunk.length;
    if(this.total>2*1024*1024){this._end(Error('RPC output bound exceeded'));return;}
    let data=Buffer.concat([this.partial,chunk]);
    while(true){
      const newline=data.indexOf(10);
      if(newline<0)break;
      if(newline>=255){this._end(Error('RPC line bound exceeded'));return;}
      const bytes=data.subarray(0,newline),line=bytes.toString('ascii');
      if(!bytes.every(byte=>byte===9||(byte>=32&&byte<=126))){
        this._end(Error('RPC line contains non-ASCII or control bytes'));return;
      }
      try{parseRpcLine(line);}catch(error){this._end(error);return;}
      if(this.waiter){const {resolve,timer}=this.waiter;
        clearTimeout(timer);this.waiter=null;resolve(line);}
      else this.queue.push(line);
      data=data.subarray(newline+1);
    }
    if(data.length>=256){this._end(Error('RPC partial line bound exceeded'));return;}
    this.partial=Buffer.from(data);
  }
  next(timeoutMs=15000){
    if(this.queue.length)return Promise.resolve(this.queue.shift());
    if(this.ended)return Promise.reject(this.error);
    assert(!this.waiter,'two concurrent RPC reads');
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.waiter=null;
        reject(Error('device quantum proof runner: RPC response timed out'));},timeoutMs);
      this.waiter={resolve,reject,timer};
    });
  }
}

function boundedOutput(stream,maxBytes,label){
  const chunks=[];let bytes=0,error=null;
  stream.on('data',chunk=>{bytes+=chunk.length;
    if(bytes>maxBytes){error=Error(`${label} raw output bound exceeded`);stream.destroy(error);}
    else chunks.push(chunk);});
  stream.on('error',cause=>{error=cause;});
  return {get text(){return Buffer.concat(chunks).toString('utf8');},
    get error(){return error;}};
}

async function sendRpc(stream,line){
  assert(line.length<255&&/^[\x20-\x7e\t]+$/.test(line)&&!line.includes('\r'),
    'outbound RPC line noncanonical');
  await new Promise((resolve,reject)=>stream.write(line+'\n',error=>error?reject(error):resolve()));
}

function stopProcessGroup(child){
  if(!child.pid)return;
  try{process.kill(-child.pid,'SIGTERM');}catch{}
  const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},2000);
  timer.unref();
}

async function runArm(binary,rc,budget,failureDir){
  const child=spawn(binary,['-q','-f',rc],{cwd:dirname(rc),
    stdio:['ignore','pipe','pipe','pipe','pipe'],detached:true});
  const stdout=boundedOutput(child.stdout,1024*1024,'stdout');
  const stderr=boundedOutput(child.stderr,16*1024*1024,'stderr');
  // An intentional native SIGABRT can close the command pipe while a reply
  // is queued. A write callback alone does not consume its stream error.
  let commandPipeError=null;
  child.stdio[3].on('error',error=>{commandPipeError=error;});
  const inbound=new BoundedLines(child.stdio[4]);
  const host=new NativeDeviceQuantumHost(),hostSeed=host.state();
  const toNative=[],fromNative=[],commands=[],requests=[],replies=[],dones=[];
  let commandSeq=0,requestSeq=0,irqWitness=false,terminalWitness=false;
  const closed=new Promise((resolve,reject)=>{
    child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal}));
  });
  const wall=setTimeout(()=>stopProcessGroup(child),120000);
  const send=async line=>{toNative.push(line);await sendRpc(child.stdio[3],line);};
  const receive=async()=>{const line=await inbound.next();fromNative.push(line);return parseRpcLine(line);};
  const command=async(verb,arg0,arg1=0,deadline='0')=>{
    const seq=++commandSeq;
    const wireDeadline=canonicalU64(String(deadline),'CMD.deadline');
    await send(`BWR8\tCMD\t${seq}\t${verb}\t${arg0}\t${arg1}\t${wireDeadline}`);
    commands.push({seq,verb,arg0,arg1,deadline:wireDeadline});
    for(;;){
      const message=await receive();
      if(message.kind==='REQ'){
        assert(verb==='RUN'&&message.seq===requestSeq+1,
          'callback outside RUN or sequence gap');
        requestSeq=message.seq;
        const value=host.handleRequest(message.operation,message.arg0,
          message.arg1,message.arg2,message.nativeTicks,message.successfulQuanta);
        const reply=`BWR8\tREP\t${message.seq}\tOK\t${value}`;
        await send(reply);
        requests.push(message);replies.push({seq:message.seq,value});
      }else{
        assert(message.kind==='DONE'&&message.seq===seq&&message.verb===verb,
          'DONE did not close its command');
        dones.push(message);
        if(verb==='RUN'){
          assert(message.totalNativeTicks===host.nativeTicks&&
            message.totalQuanta===host.successfulQuanta,
          'native and host clock ledgers differ');
          assert(message.reason>=1&&message.reason<=7&&message.reason!==5,
            'unowned failure reason');
        }else assert(message.totalNativeTicks===host.nativeTicks&&
          message.totalQuanta===host.successfulQuanta,'command changed clocks');
        return message;
      }
    }
  };
  try{
    const ready=await receive();
    assert(ready.kind==='READY'&&ready.cs===0&&ready.eip===0x7e00&&
      ready.nativeTicks===0&&ready.successfulQuanta===0,
      'native READY not at owned setup');
    for(let runs=0;runs<10000;runs++){
      const done=await command('RUN',nativeSafetyCap,budget,u64max);
      if(done.reason===6){
        assert(!irqWitness&&done.irqDelivered&&done.cs===8&&done.eip===0x809f,
        'eligible PIC delivery did not cut before handler instruction');
        irqWitness=true;
        assert(host.stageLine()===false,'PIC did not lower INT at ACK');
        await command('LINE',0);
      }else if(done.reason===4&&done.cs===8&&done.eip===0x801e){
        assert(irqWitness&&host.marker.join(',')===
          [...Buffer.from('BQNT001')].join(','),
        'guest terminal HLT preceded marker');
        if(done.chargedNativeTicks===0&&done.chargedQuanta===0){
          assert(!terminalWitness,'duplicate terminal zero-tick HLT');
          terminalWitness=true;
          const stopped=await command('STOP',0);
          assert(stopped.value===0,'native STOP value changed');
          break;
        }
      }else assert([1,2,3,7].includes(done.reason),
        `unexpected native reason ${done.reason}`);
      const wanted=host.stageLine();
      if(wanted!==host.lineAsserted)throw Error('host line staging internal error');
      const lastLine=commands.filter(c=>c.verb==='LINE').at(-1)?.arg0??0;
      if(Number(wanted)!==lastLine)await command('LINE',Number(wanted));
      if(runs===9999)throw Error('native resume call bound exceeded');
    }
    assert(irqWitness&&terminalWitness,'IRQ and zero-tick HLT boundaries missing');
    let exitTimer;
    const exit=await Promise.race([closed,new Promise((_,reject)=>{
      exitTimer=setTimeout(()=>reject(Error('native child exit timed out')),10000);
    })]).finally(()=>clearTimeout(exitTimer));
    assert(exit.code===0&&exit.signal===null,'normal native child did not exit zero');
    assert(!commandPipeError,'native command pipe failed');
    assert(!stdout.error&&!stderr.error,'native raw output exceeded its bound');
    const raw={stdout:stdout.text,stderr:stderr.text,
      rpcToNative:toNative.join('\n')+'\n',rpcFromNative:fromNative.join('\n')+'\n'};
    const native=parseNativeLog(raw.stderr);
    assert(native.finalCounters.nativeTicks===host.nativeTicks&&
      native.finalCounters.successfulQuanta===host.successfulQuanta&&
      native.finalCounters.rpcRequests===requests.length&&
      native.finalCounters.rpcReplies===replies.length,
    'native final RPC/clock ledger differs');
    return {exit,host:{seed:hostSeed,journal:host.journal,final:host.state()},
      native,rpc:{commands,requests,replies,dones},raw};
  }catch(error){
    stopProcessGroup(child);
    let settleTimer;
    await Promise.race([closed.catch(()=>null),new Promise(resolve=>{
      settleTimer=setTimeout(resolve,2500);
    })]).finally(()=>clearTimeout(settleTimer));
    if(failureDir){
      for(const [name,get] of Object.entries({
        stdout:()=>stdout.text,stderr:()=>stderr.text,
        rpcToNative:()=>toNative.join('\n')+'\n',
        rpcFromNative:()=>fromNative.join('\n')+'\n',
        exception:()=>String(error.stack??error)+'\n'})){
        try{writeFileSync(join(failureDir,`failure.${name}.txt`),get());}catch{}
      }
    }
    throw error;
  }
  finally{clearTimeout(wall);child.stdio[3].end();}
}

function preparedInputs(tree,directory){
  const board=sourceInventory(),built=patchedTree(tree);
  const fixtureDir=join(directory,'fixture');mkdirSync(fixtureDir,{recursive:true});
  const image=assembleFixture(fixtureDir);
  const floppyPath=join(directory,'owned-floppy.img');
  writeFileSync(floppyPath,image.floppy);
  const hostConfig=bochsrc(directory,floppyPath);
  assert(hostConfig.biosSha256===fixedBiosSha&&
    hostConfig.vgaBiosSha256===fixedVgaSha,'free ROM media changed');
  const source={...board,bochsRevision:revision,patchHashes:built.patchHashes,
    configSha256:built.configSha256,binarySha256:built.binarySha256,
    imageSha256:image.imageSha256,floppySha256:fileSha(floppyPath),
    bochsrcSha256:fileSha(hostConfig.rc),biosSha256:hostConfig.biosSha256,
    vgaBiosSha256:hostConfig.vgaBiosSha256,
    romIncludeSha256:sha(ownedRomInclude()),mapId,
    timing:{boardHz,clocksPerQuantum,pitHz,biosIps:10_000_000,
      hostEpoch:'fresh-zero-at-owned-setup'}};
  return {source,binary:built.binary,hostConfig,floppyPath};
}

function recheckInputs(tree,source,hostConfig,floppyPath){
  const board=sourceInventory(),built=patchedTree(tree);
  assert(board.boardRevision===source.boardRevision&&
    JSON.stringify(board.sourceHashes)===JSON.stringify(source.sourceHashes)&&
    JSON.stringify(built.patchHashes)===JSON.stringify(source.patchHashes)&&
    built.configSha256===source.configSha256&&
    built.binarySha256===source.binarySha256&&
    fileSha(floppyPath)===source.floppySha256&&
    fileSha(hostConfig.rc)===source.bochsrcSha256&&
    fileSha(resolve(repo,'roms/free-at-bios/BIOS-bochs-legacy'))===source.biosSha256&&
    fileSha(resolve(repo,'roms/free-at-bios/vgabios-lgpl.bin'))===source.vgaBiosSha256,
  'source, native binary, config, ROM or fixture medium changed during capture');
}

function verifyRetainedArtifacts(directory,artifacts){
  const seen=new Set();
  const check=entry=>{
    assert(entry&&typeof entry.path==='string'&&
      /^[a-zA-Z0-9.-]+$/.test(entry.path)&&
      typeof entry.sha256==='string'&&/^[0-9a-f]{64}$/.test(entry.sha256),
    'unsafe retained artifact entry');
    assert(!seen.has(entry.path),`duplicate retained artifact ${entry.path}`);
    seen.add(entry.path);
    assert(fileSha(join(directory,entry.path))===entry.sha256,
      `retained artifact changed: ${entry.path}`);
  };
  check(artifacts.bochsrc);check(artifacts.floppy);
  for(const [name,group] of Object.entries(artifacts)){
    if(name==='bochsrc'||name==='floppy')continue;
    for(const entry of Object.values(group.files??group))check(entry);
  }
}

function retainArm(directory,label,arm,bochsLog){
  const files={};
  for(const [name,contents] of Object.entries(arm.raw)){
    const path=`${label}.${name}.txt`;
    writeFileSync(join(directory,path),contents);
    files[name]={path,sha256:fileSha(join(directory,path))};
  }
  assert(existsSync(bochsLog),`${label}: Bochs host log missing`);
  const logPath=`${label}.bochs.log`;
  copyFileSync(bochsLog,join(directory,logPath));
  files.bochsLog={path:logPath,sha256:fileSha(join(directory,logPath))};
  return {exitCode:arm.exit.code,signal:arm.exit.signal,files};
}

async function runGuard(binary,rc,name,expected,directory,bochsLog){
  const child=spawn(binary,['-q','-f',rc],{cwd:dirname(rc),detached:true,
    env:{...process.env,BW_CPU3_DEVICE_QUANTA_PROBE:name},
    stdio:['ignore','pipe','pipe','pipe','pipe']});
  const stdout=boundedOutput(child.stdout,1024*1024,'guard stdout');
  const stderr=boundedOutput(child.stderr,16*1024*1024,'guard stderr');
  let commandPipeError=null;
  child.stdio[3].on('error',error=>{commandPipeError=error;});
  child.stdio[3].end();
  const closed=new Promise((resolve,reject)=>{
    child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal}));
  });
  const wall=setTimeout(()=>stopProcessGroup(child),15000);
  let exit;
  try{exit=await closed;}finally{clearTimeout(wall);}
  const label=`guard-${name}`;
  const files={};
  for(const [key,value] of Object.entries({stdout:stdout.text,stderr:stderr.text})){
    const path=`${label}.${key}.txt`;
    writeFileSync(join(directory,path),value);
    files[key]={path,sha256:fileSha(join(directory,path))};
  }
  assert(existsSync(bochsLog),`${label}: host log absent`);
  const logPath=`${label}.bochs.log`;
  copyFileSync(bochsLog,join(directory,logPath));
  files.bochsLog={path:logPath,sha256:fileSha(join(directory,logPath))};
  const failure=stderr.text.split('\n').filter(line=>line.startsWith('BWS8\tFAIL\t'));
  assert(exit.signal==='SIGABRT'&&exit.code===null&&
    failure.length===1&&failure[0]===`BWS8\tFAIL\t${expected}`&&
    !stdout.error&&!stderr.error&&!commandPipeError,
  `${label}: wrong native fail-closed guard or exit`);
  return {name,expected,exit,observedFailure:expected,files};
}

async function runTransportGuard(binary,rc,name,spec,directory,bochsLog){
  const child=spawn(binary,['-q','-f',rc],{cwd:dirname(rc),detached:true,
    stdio:['ignore','pipe','pipe','pipe','pipe']});
  const stdout=boundedOutput(child.stdout,1024*1024,'transport stdout');
  const stderr=boundedOutput(child.stderr,16*1024*1024,'transport stderr');
  const fromNative=boundedOutput(child.stdio[4],1024*1024,'transport fd4');
  const inbound=new BoundedLines(child.stdio[4]);
  // Intentional SIGABRT can close fd3 after the malformed request is accepted.
  // Consume that stream error; the named native failure and signal prove the
  // negative case, not whether fd3 accepted a later close notification.
  let toNative='';
  child.stdio[3].on('error',()=>{});
  const closed=new Promise((resolve,reject)=>{
    child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal}));
  });
  const wall=setTimeout(()=>stopProcessGroup(child),15000);
  let exit,request=null,error=null;
  try{
    const ready=parseRpcLine(await inbound.next());
    assert(ready.kind==='READY'&&ready.cs===0&&ready.eip===0x7e00&&
      ready.nativeTicks===0&&ready.successfulQuanta===0,
      `${name}: native READY boundary changed`);
    if(spec.stage==='reply'){
      const command=`BWR8\tCMD\t1\tRUN\t1\t1\t${u64max}\n`;
      toNative+=command;
      await new Promise((resolve,reject)=>child.stdio[3].write(command,
        cause=>cause?reject(cause):resolve()));
      request=parseRpcLine(await inbound.next());
      assert(request.kind==='REQ'&&request.seq===1&&
        request.nativeTicks===0&&request.successfulQuanta===0,
      `${name}: first native callback changed`);
    }
    toNative+=spec.payload;
    await new Promise((resolve,reject)=>child.stdio[3].write(spec.payload,
      cause=>cause?reject(cause):resolve()));
    exit=await closed;
  }catch(cause){error=cause;stopProcessGroup(child);
    try{exit=await closed;}catch{}
  }finally{clearTimeout(wall);child.stdio[3].end();}
  const label=`transport-${name}`,files={};
  for(const [key,contents] of Object.entries({stdout:stdout.text,stderr:stderr.text,
    rpcToNative:toNative,rpcFromNative:fromNative.text})){
    const path=`${label}.${key}.txt`;
    writeFileSync(join(directory,path),contents);
    files[key]={path,sha256:fileSha(join(directory,path))};
  }
  if(existsSync(bochsLog)){
    const path=`${label}.bochs.log`;
    copyFileSync(bochsLog,join(directory,path));
    files.bochsLog={path,sha256:fileSha(join(directory,path))};
  }
  const failures=stderr.text.split('\n').filter(line=>line.startsWith('BWS8\tFAIL\t'));
  assert(!error&&exit?.signal==='SIGABRT'&&exit.code===null&&
    failures.length===1&&failures[0]===`BWS8\tFAIL\t${spec.failure}`&&
    !stdout.error&&!stderr.error&&!fromNative.error&&
    Object.hasOwn(files,'bochsLog'),
  `${name}: native transport guard did not fail with exact SIGABRT/reason`);
  return {name,stage:spec.stage,expected:spec.failure,exit,
    observedFailure:spec.failure,request,files};
}

async function runFull(tree,outdir){
  assert(!existsSync(outdir),'output directory must be new');
  mkdirSync(outdir,{recursive:true});
  const {source,binary,hostConfig,floppyPath}=preparedInputs(tree,outdir);
  const artifacts={bochsrc:{path:'bochsrc',sha256:fileSha(hostConfig.rc)},
    floppy:{path:'owned-floppy.img',sha256:fileSha(floppyPath)}};
  const arms={};
  for(const [name,budget] of Object.entries(budgets)){
    const arm=await runArm(binary,hostConfig.rc,budget,outdir);
    const files=retainArm(outdir,name,arm,hostConfig.log);
    arms[name]={mode:name,requestedBudget:budget,host:arm.host,native:arm.native,
      rpc:arm.rpc,artifacts:files};
    artifacts[name]=files;
    recheckInputs(tree,source,hostConfig,floppyPath);
  }
  const probes={};
  for(const [name,reason] of Object.entries(guardReasons)){
    const guard=await runGuard(binary,hostConfig.rc,name,reason,outdir,hostConfig.log);
    probes[name]=guard;artifacts[`guard-${name}`]=guard.files;
    recheckInputs(tree,source,hostConfig,floppyPath);
  }
  const transportProbes={};
  for(const [name,spec] of Object.entries(transportCases)){
    const probe=await runTransportGuard(binary,hostConfig.rc,name,spec,outdir,hostConfig.log);
    transportProbes[name]=probe;artifacts[`transport-${name}`]=probe.files;
    recheckInputs(tree,source,hostConfig,floppyPath);
  }
  const report={schema:'bw.bochs-cpu3-native-device-quanta.v1',source,arms,probes,
    transportProbes,artifacts};
  const reportPath=join(outdir,'capture.json'),resultPath=join(outdir,'result.json');
  writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
  const result=assertNativeDeviceQuantaProof(report);
  verifyRetainedArtifacts(outdir,artifacts);
  recheckInputs(tree,source,hostConfig,floppyPath);
  writeFileSync(resultPath,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({status:'native-device-quanta-proof-pass',sourceRevision:source.boardRevision,
    report:reportPath,reportSha256:fileSha(reportPath),result:resultPath,
    resultSha256:fileSha(resultPath),nativeTicks:result.nativeTicks,
    successfulQuanta:result.successfulQuanta,boardCycles:result.boardCycles,
    slices:result.slices},null,2));
}

async function runSingle(tree,outdir){
  assert(!existsSync(outdir),'output directory must be new');
  mkdirSync(outdir,{recursive:true});
  const {source,binary,hostConfig,floppyPath}=preparedInputs(tree,outdir);
  const arm=await runArm(binary,hostConfig.rc,budgets.continuous,outdir);
  const artifacts={bochsrc:{path:'bochsrc',sha256:fileSha(hostConfig.rc)},
    floppy:{path:'owned-floppy.img',sha256:fileSha(floppyPath)},
    continuous:retainArm(outdir,'continuous',arm,hostConfig.log)};
  recheckInputs(tree,source,hostConfig,floppyPath);
  const report={schema:'bw.bochs-cpu3-native-device-quanta-single-diagnostic.v1',
    source,activation:arm.native.activation,
    arm:{mode:'continuous',requestedBudget:budgets.continuous,
      host:arm.host,native:arm.native,rpc:arm.rpc,artifacts:artifacts.continuous},
    artifacts};
  assert(arm.host.final.marker==='BQNT001'&&arm.host.final.pic.isr===0&&
    arm.host.final.pic.irr===0&&arm.host.final.nativeTicks===4043&&
    arm.host.final.successfulQuanta===4041&&
    arm.host.final.nativeTicks===arm.native.finalCounters.nativeTicks&&
    arm.host.final.successfulQuanta===arm.native.finalCounters.successfulQuanta&&
    arm.native.ramFinal.pfCount===2&&arm.native.ramFinal.shadow===1&&
    arm.native.ramFinal.irqCount===1,
  'single diagnostic model/guest completion differs');
  const path=join(outdir,'single-diagnostic.json');
  writeFileSync(path,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({status:'single-diagnostic-pass',sourceRevision:source.boardRevision,
    report:path,sha256:fileSha(path),nativeTicks:arm.host.final.nativeTicks,
    successfulQuanta:arm.host.final.successfulQuanta,
    boardCycles:arm.host.final.boardCycles,
    slices:arm.native.slices.length},null,2));
}

async function main(){
  const [mode,treeArg,outdirArg,...extra]=process.argv.slice(2);
  assert(!extra.length&&['--preflight','--single','--capture'].includes(mode)&&treeArg&&
    (mode==='--preflight'?!outdirArg:!!outdirArg),
  'usage: node scripts/run-bochs-cpu3-native-device-quanta-compare.mjs --preflight BOCHS_TREE | --single|--capture BOCHS_TREE NEW_OUTPUT_DIRECTORY');
  const tree=resolve(treeArg);
  if(mode==='--single')return runSingle(tree,resolve(outdirArg));
  if(mode==='--capture')return runFull(tree,resolve(outdirArg));
  const scratch=mkdtempSync(join(tmpdir(),'bw-native-device-quanta-preflight-'));
  try{const {source}=preparedInputs(tree,scratch);
    console.log(JSON.stringify({status:'preflight-only',source},null,2));}
  finally{rmSync(scratch,{recursive:true,force:true});}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{console.error(error.stack??String(error));process.exitCode=1;});
