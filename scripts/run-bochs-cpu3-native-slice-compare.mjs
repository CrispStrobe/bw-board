/** Source-bound serial native CPU3 slice capture for the free owned fixture. */
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync,mkdirSync,
  copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {endianness,tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertNativeSliceSelfParity} from './bochs-cpu3-native-slice-compare.mjs';
import {patchPinnedSource,revision,upstreamHashes} from './bochs-cpu3-native-slice/patch.mjs';

const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const fixture='test/fixtures/i80386-bochs-cpu3-pagefault-retry.S';
const receipt='docs/receipts/2026-09-30-i80386-bochs-cpu3-owned-pagefault-retry.json';
const sourcePaths=[
  'scripts/bochs-cpu3-native-slice/abi.h',
  'scripts/bochs-cpu3-native-slice/runtime.h',
  'scripts/bochs-cpu3-native-slice/runtime.inc',
  'scripts/bochs-cpu3-native-slice/patch.mjs',
  'scripts/prepare-bochs-cpu3-native-slice.mjs',
  'scripts/bochs-cpu3-native-slice-compare.mjs',
  'scripts/run-bochs-cpu3-native-slice-compare.mjs',
  'test/i80386-native-slice.test.mjs',fixture,receipt];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fileSha=path=>sha(readFileSync(path));
const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const pinnedReceiptSha='6c663a02b1c9b5058b862442dc6ee093c969022e6ec04233698af8a077ee77d8';

function sourceInventory(){
  assert(endianness()==='LE','native CPU3 callback bytes require a little-endian host');
  assert(!git(repo,'status','--porcelain'),'board checkout must be clean for source freeze');
  const boardRevision=git(repo,'rev-parse','HEAD');
  const sourceHashes={};
  for(const path of sourcePaths){
    execFileSync('git',['ls-files','--error-unmatch','--',path],{cwd:repo,stdio:'ignore'});
    const committed=execFileSync('git',['show',`HEAD:${path}`],{cwd:repo});
    const current=readFileSync(resolve(repo,path));
    assert(sha(committed)===sha(current),`source differs from HEAD: ${path}`);
    sourceHashes[path]=sha(current);
  }
  assert(sourceHashes[receipt]===pinnedReceiptSha,'historical native page-fault receipt changed');
  const reference=JSON.parse(readFileSync(resolve(repo,receipt),'utf8'));
  assert(reference.schema==='bw.bochs-cpu3-owned-pagefault-retry-capture.v1' &&
    reference.bochsRevision===revision &&
    reference.fixtureSourceSha256===sourceHashes[fixture],
  'historical native fixture/source identity changed');
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
    ['scripts/bochs-cpu3-native-slice/abi.h','bochs/cpu/bw_slice_abi.h'],
    ['scripts/bochs-cpu3-native-slice/runtime.h','bochs/cpu/bw_slice_runtime.h'],
    ['scripts/bochs-cpu3-native-slice/runtime.inc','bochs/cpu/bw_slice_runtime.inc']])
    assert(fileSha(resolve(repo,source))===fileSha(resolve(root,target)),
      `copied owned CPU3 bytes differ: ${target}`);
  const config=resolve(root,'bochs/config.h'),configText=readFileSync(config,'utf8');
  for(const option of ['#define BX_CPU_LEVEL 3','#define BX_DEBUGGER 0',
    '#define BX_SUPPORT_SMP 0','#define BX_SUPPORT_REPEAT_SPEEDUPS 0',
    '#define BX_SUPPORT_HANDLERS_CHAINING_SPEEDUPS 0'])
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
  for(const [name,address] of Object.entries({setup:0x7e00,faulting_store:0x7ebe,
    pf_handler:0x7ef3,cr3_reload:0x7f46,iret_retry:0x7f4c})){
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
  const env={...process.env,BW_CPU3_SLICE_BUDGET:budget};
  if(probe)env.BW_CPU3_SLICE_PROBE=probe;
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
  if(!/^(0|[1-9][0-9]*)$/.test(raw))throw new Error(`${where}: decimal integer expected`);
  const n=Number(raw);
  assert(Number.isSafeInteger(n),`${where}: unsafe integer`);
  return n;
};
const hexNumber=(raw,where,width)=>{
  if(!new RegExp(`^[0-9a-f]{${width}}$`).test(raw))
    throw new Error(`${where}: ${width}-digit lowercase hex expected`);
  return Number.parseInt(raw,16);
};
const tags=stderr=>stderr.split(/\r?\n/).filter(line=>line.startsWith('BWS3\t'))
  .map(line=>line.split('\t').slice(1));
const stateFields=['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags',
  'cr0','cr2','cr3','cs','ds','ss','gdtrBase','gdtrLimit','idtrBase','idtrLimit'];
function parseState(parts,where){
  assert(parts.length===20,`${where}: expected 20 selected CPU fields`);
  return Object.fromEntries(parts.map((raw,i)=>[stateFields[i],
    hexNumber(raw,`${where}.${stateFields[i]}`,i>=13 && [13,14,15,17,19].includes(i)?4:8)]));
}
const reasonName={1:'budget',2:'fault-delivered',3:'port',4:'halt',5:'failure'};
const countFields=['attempts','completed','repIterations','repPartial','faults','portCommits'];
export function parseArm(stderr,mode,budget){
  const lines=tags(stderr);
  assert(lines.length>0,`${mode}: no BWS3 records`);
  const seedPages=[],apiProbes=[],writes=[],ports=[],slices=[];
  let seedState=null,activation=null,finalRecord=null,state=null,callbacks=null,
    fallback=null,deactivated=false,lastFault=null;
  let pendingPorts=[],nextOrdinal=-1,prior={ticks:0,attempts:0,completed:0,
    repIterations:0,repPartial:0,faults:0,portCommits:0};
  const expectedApi=['resume-before-activation','zero-budget','null-callbacks',
    'incomplete-callbacks'];
  for(const [index,record] of lines.entries()){
    const [tag,...p]=record,where=`${mode}: BWS3 line ${index+1} ${tag}`;
    if(tag==='PROBE'){
      assert(p.length===2 && expectedApi.includes(p[0]) && p[1]==='rejected',
        `${where}: unrelated or false API rejection`);
      assert(!apiProbes.includes(p[0]),`${where}: duplicate API probe`);
      apiProbes.push(p[0]);
    }else if(tag==='SEEDSTATE'){
      assert(!seedState && !activation,`${where}: duplicate or late seed state`);
      seedState=parseState(p,where);
    }else if(tag==='SEEDPAGE'){
      assert(seedState && !activation && p.length===2,`${where}: misplaced seed page`);
      const page=decimal(p[0],where);
      assert(page===seedPages.length && page<256,`${where}: missing/duplicate seed page`);
      assert(/^[0-9a-f]{8192}$/.test(p[1]),`${where}: seed page is not exact 4 KiB`);
      seedPages.push(Buffer.from(p[1],'hex'));
    }else if(tag==='ACTIVATE'){
      assert(!activation && seedState && seedPages.length===256 && p.length===3,
        `${where}: activation is missing source-bound seed`);
      activation={cs:hexNumber(p[0],where,4),eip:hexNumber(p[1],where,8),
        copiedBytes:decimal(p[2],where),tlbFlushed:true,
        prefetchInvalidated:true,icacheFlushed:true,
        ramSha256:sha(Buffer.concat(seedPages)),
        cpuSeedSha256:sha(Buffer.from(JSON.stringify(seedState)))};
      assert(activation.cs===0 && activation.eip===0x7e00 &&
        activation.copiedBytes===1048576,`${where}: wrong post-load entry`);
    }else if(tag==='WRITE'){
      assert(activation && !finalRecord && p.length===4,`${where}: misplaced RAM write`);
      const address=hexNumber(p[0],where,8);
      assert(/^(?:[0-9a-f]{2})+$/.test(p[1]),`${where}: malformed write bytes`);
      const tick=decimal(p[2],where),ordinal=decimal(p[3],where);
      assert(ordinal>nextOrdinal,`${where}: host bus ordinal regressed`);
      nextOrdinal=ordinal;
      writes.push({address,bytes:p[1],kind:'host-physical',tick,ordinal});
    }else if(tag==='PORT'){
      assert(activation && !finalRecord && p.length===5,`${where}: misplaced port commit`);
      const port=hexNumber(p[0],where,4),width=decimal(p[1],where),
        value=hexNumber(p[2],where,8),tick=decimal(p[3],where),
        ordinal=decimal(p[4],where);
      assert(ordinal>nextOrdinal,`${where}: host bus ordinal regressed`);
      nextOrdinal=ordinal;
      const event={kind:'port',port,width,value,tick,ordinal};
      ports.push({port,width,value,tick,ordinal});pendingPorts.push(event);
    }else if(tag==='SLICE'){
      assert(activation && !finalRecord && p.length===15,`${where}: malformed resume result`);
      const requested=decimal(p[0],where),chargedTicks=decimal(p[1],where),
        rawReason=decimal(p[2],where),entry={cs:decimal(p[3],where),
          eip:hexNumber(p[4],where,8)},exit={cs:decimal(p[5],where),
          eip:hexNumber(p[6],where,8)};
      assert(requested===(budget??4294967295),`${where}: unexpected raw C ABI budget`);
      const after={ticks:prior.ticks+chargedTicks};
      for(let i=0;i<countFields.length;i++)
        after[countFields[i]]=decimal(p[i+7],`${where}.${countFields[i]}`);
      const pendingFault=decimal(p[13],where),portCommitted=decimal(p[14],where);
      assert([0,1].includes(pendingFault) && [0,1].includes(portCommitted),
        `${where}: invalid boolean`);
      const slice={requestedTicks:budget,chargedTicks,reason:reasonName[rawReason],
        entry,exit,before:prior,after,pendingFault:!!pendingFault,
        portCommitted:!!portCommitted,events:pendingPorts};
      slices.push(slice);pendingPorts=[];prior=after;
    }else if(tag==='FAULT'){
      assert(activation && !finalRecord && p.length===14 && slices.length,
        `${where}: malformed fault record`);
      const slice=slices.at(-1);
      assert(slice.reason==='fault-delivered' && !slice.events.some(e=>e.kind==='fault'),
        `${where}: fault record not attached to fault cut`);
      const event={kind:'fault',vector:decimal(p[0],where),errorCode:decimal(p[1],where),
        cr2:hexNumber(p[2],where,8),frame:{errorCode:hexNumber(p[3],where,8),
          eip:hexNumber(p[4],where,8),cs:hexNumber(p[5],where,8),
          eflags:hexNumber(p[6],where,8)},
        faulting:{cs:hexNumber(p[7],where,4),eip:hexNumber(p[8],where,8)},
        handler:{cs:hexNumber(p[9],where,4),eip:hexNumber(p[10],where,8)},
        preTick:decimal(p[11],where),tick:decimal(p[12],where),
        ordinal:decimal(p[13],where)};
      assert(event.handler.cs===slice.exit.cs && event.handler.eip===slice.exit.eip,
        `${where}: handler record differs from ABI exit`);
      slice.events.push(event);slice.events.sort((a,b)=>a.ordinal-b.ordinal);
      lastFault=event;
    }else if(tag==='FINAL'){
      assert(!finalRecord && p.length===10,`${where}: duplicate/malformed final`);
      finalRecord={ticks:decimal(p[0],where),attempts:decimal(p[1],where),
        completed:decimal(p[2],where),repIterations:decimal(p[3],where),
        faults:decimal(p[4],where),portCommits:decimal(p[5],where),
        ramWords:{pde0:Buffer.from(Uint32Array.of(hexNumber(p[6],where,8)).buffer).toString('hex'),
          pte5:Buffer.from(Uint32Array.of(hexNumber(p[7],where,8)).buffer).toString('hex'),
          data5:Buffer.from(Uint32Array.of(hexNumber(p[8],where,8)).buffer).toString('hex'),
          scratchCr2:Buffer.from(Uint32Array.of(hexNumber(p[9],where,8)).buffer).toString('hex')}};
    }else if(tag==='STATE'){
      assert(finalRecord && !state,`${where}: duplicate or premature final CPU state`);
      state=parseState(p,where);
    }else if(tag==='CALLBACKS'){
      assert(finalRecord && state && !callbacks && p.length===4,
        `${where}: missing/malformed host callback totals`);
      callbacks={physicalReads:decimal(p[0],where),physicalWrites:decimal(p[1],where),
        executePages:decimal(p[2],where),tickCallbacks:decimal(p[3],where)};
    }else if(tag==='FALLBACK'){
      assert(callbacks && !fallback && p.length===5,`${where}: fallback counts missing`);
      fallback=Object.fromEntries(['bochsRamReads','bochsRamWrites','bochsDirectPointers',
        'bochsPio','bochsTimer'].map((name,i)=>[name,decimal(p[i],where)]));
    }else if(tag==='DEACTIVATE'){
      assert(finalRecord && state && callbacks && fallback && !deactivated &&
        p.length===1 && p[0]==='proof-complete',
        `${where}: deactivation without validated final records`);
      deactivated=true;
    }else throw new Error(`${where}: unknown BWS3 record`);
  }
  assert(activation && finalRecord && state && callbacks && fallback && deactivated &&
    lastFault && !pendingPorts.length && slices.length &&
    JSON.stringify(apiProbes)===JSON.stringify(expectedApi),
  `${mode}: incomplete activated/deactivated native arm`);
  for(const name of ['ticks','attempts','completed','repIterations','faults','portCommits'])
    assert(finalRecord[name]===prior[name],`${mode}: FINAL ${name} differs from last ABI result`);
  const totals={...prior};
  return {arm:{mode,requestedBudget:budget,slices,
    final:{selectedState:state,ramWords:finalRecord.ramWords,frame:lastFault.frame},
    writes,ports,totals,hostCallbacks:callbacks,fallback},
    activation,apiProbes};
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
  assert(result.code!==0 && result.signal!==null,
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
  assert(fixtureImage.imageSha256===board.reference.imageSha256,
    'assembled owned fixture differs from immutable native page-fault receipt');
  const floppyPath=join(directory,'owned-floppy.img');
  writeFileSync(floppyPath,fixtureImage.floppy);
  const hostConfig=bochsrc(directory,floppyPath);
  assert(fileSha(floppyPath)===board.reference.floppySha256 &&
    hostConfig.biosSha256===board.reference.biosSha256 &&
    hostConfig.vgaBiosSha256===board.reference.vgaBiosSha256,
  'owned medium or free BIOS differs from immutable native page-fault receipt');
  const source={boardRevision:board.boardRevision,sourceHashes:board.sourceHashes,
    bochsRevision:revision,patchHashes:built.patchHashes,
    configSha256:built.configSha256,binarySha256:built.binarySha256,
    imageSha256:fixtureImage.imageSha256,
    floppySha256:fileSha(floppyPath),bochsrcSha256:fileSha(hostConfig.rc),
    biosSha256:hostConfig.biosSha256,vgaBiosSha256:hostConfig.vgaBiosSha256};
  return {source,binary:built.binary,hostConfig,floppyPath};
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
      apiProbes=Object.fromEntries(parsed.apiProbes.map(probe=>[probe,'rejected']));}
    else assert(JSON.stringify(parsed.apiProbes)===JSON.stringify(Object.keys(apiProbes)),
      `${name}: C ABI argument probe inventory changed`);
    armSeeds[name]={ramSha256:parsed.activation.ramSha256,
      cpuSeedSha256:parsed.activation.cpuSeedSha256};
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
  const report={schema:'bw.bochs-cpu3-native-slice.v1',source,activation,
    armSeeds,apiProbes,arms,probes,artifacts};
  const result=assertNativeSliceSelfParity(report);
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
  'usage: node scripts/run-bochs-cpu3-native-slice-compare.mjs --preflight BOCHS_TREE | --capture BOCHS_TREE NEW_OUTPUT_DIRECTORY');
  const tree=resolve(treeArg);
  if(mode==='--capture')return runCapture(tree,resolve(outdirArg));
  const scratch=mkdtempSync(join(tmpdir(),'bw-native-slice-preflight-'));
  try{
    const {source}=preparedInputs(tree,scratch);
    console.log(JSON.stringify({status:'preflight-only',source},null,2));
  }finally{rmSync(scratch,{recursive:true,force:true});}
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{console.error(error.stack??String(error));process.exitCode=1;});
