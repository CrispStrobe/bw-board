#!/usr/bin/env node
/** Source-bound serial actual-native captures. No fallback or synthetic arms. */
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import {spawn,execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,existsSync,renameSync,statfsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {patchPinnedSource,upstreamHashes} from './bochs-cpu3-native-combined-paging-ram/patch.mjs';
import {assembleCombinedPagingRamRom} from './i80386-combined-paging-ram-oracle.mjs';
import {expandI80386SourceInventory} from './lib/i80386-source-inventory.mjs';
import {NativeCombinedPagingRamHost,combinedBudgets,combinedSha,parseCombinedRpcLine,encodeCombinedCommand,encodeCombinedReply,combinedBoardConfig} from './bochs-cpu3-native-combined-paging-ram/host.mjs';
import {parseCombinedNativeLog,assertNativeCombinedPagingRamProof,combinedResetDifferences,combinedBusDifferences,combinedBuildPins,combinedManifestSha256,combinedGuards,combinedTransports} from './i80386-native-combined-paging-ram-board-gate.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const shaFile=file=>combinedSha(readFileSync(file));
const check=(ok,message)=>assert(ok,`combined paging/RAM/REP runner: ${message}`);
const sourceSeeds=['../package.json','../test/i80386-native-combined-bounded-assertion.test.mjs','../test/i80386-native-combined-paging-ram-board-gate.test.mjs','../test/fixtures/i80386-native-combined-paging-ram-board-gate-capture.json.gz','../test/i80386-native-combined-paging-ram-host.test.mjs','./run-i80386-native-combined-paging-ram-board-gate.mjs','./prepare-bochs-cpu3-native-combined-paging-ram.mjs',
 './bochs-cpu3-native-combined-paging-ram/abi.h','./bochs-cpu3-native-combined-paging-ram/runtime.h','./bochs-cpu3-native-combined-paging-ram/runtime.inc',
 './bochs-cpu3-native-combined-paging-ram/wire-contract.md','../test/fixtures/i80386-free-combined-paging-ram.S',
 '../docs/receipts/2026-10-01-i80386-js-combined-paging-ram-oracle-capture.json.gz',
 './run-i80386-combined-paging-ram-oracle.mjs','../test/i80386-combined-paging-ram-oracle.test.mjs',
 '../roms/free-at-bios/BIOS-bochs-legacy','../roms/free-at-bios/vgabios-lgpl.bin'];
function inventory(){
  return Object.fromEntries(expandI80386SourceInventory(sourceSeeds,import.meta.url).map(f=>{
    const file=path.resolve(root,'scripts',f);return [path.relative(root,file),shaFile(file)];
  }));
}
function preflight(build,manifest,manifestBytes){
  check(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'})==='','qualification requires completely clean committed source');
  const boardRevision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHashes=inventory();
  for(const [file,hash] of Object.entries(sourceHashes)){
    const committed=execFileSync('git',['show',`${boardRevision}:${file}`],{cwd:root,maxBuffer:4<<20});
    check(combinedSha(committed)===hash,`measured input not committed: ${file}`);
  }
  check(manifest.bochsRevision===combinedBuildPins.bochsRevision,'pinned Bochs revision');
  for(const [file,hash] of Object.entries(manifest.sourceHashes))check(sourceHashes[file]===hash,`compiled native source differs: ${file}`);
  check(execFileSync('git',['rev-parse','HEAD'],{cwd:build,encoding:'utf8'}).trim()===combinedBuildPins.bochsRevision,'build checkout revision');
  assert.deepEqual(manifest.upstreamHashes,upstreamHashes,'manifest upstream source pins');
  const patchedHashes=Object.fromEntries(Object.keys(upstreamHashes).map(file=>{
    const upstream=execFileSync('git',['show',`${combinedBuildPins.bochsRevision}:${file}`],{cwd:build,maxBuffer:4<<20});
    const expected=patchPinnedSource(file,upstream),hash=combinedSha(expected);
    check(shaFile(path.join(build,file))===hash,`independently derived patched source differs: ${file}`);
    return [file,hash];
  }));
  assert.deepEqual(manifest.patchedHashes,patchedHashes,'manifest derived source pins');
  check(combinedSha(manifestBytes)===combinedManifestSha256,'independently audited prepared manifest bytes');
  const comparisonSourceHashes=Object.fromEntries(Object.entries(combinedBusDifferences.sources).map(([file,expected])=>{
    const upstream=execFileSync('git',['show',`${combinedBuildPins.bochsRevision}:${file}`],{cwd:build,maxBuffer:4<<20});
    check(combinedSha(upstream)===expected&&shaFile(path.join(build,file))===expected,`actual untouched comparison source differs: ${file}`);return [file,expected];
  }));
  const changed=execFileSync('git',['diff','--name-only'],{cwd:build,encoding:'utf8'}).trim().split('\n').filter(Boolean).sort();
  assert.deepEqual(changed,Object.keys(upstreamHashes).filter(f=>f!=='bochs/cpu/init.cc').sort(),'exact changed native source inventory');
  const runtime=shaFile(path.join(build,'bochs/cpu/bw_slice_runtime.inc')),
    binary=shaFile(path.join(build,'bochs/bochs')),config=shaFile(path.join(build,'bochs/config.h'));
  check(runtime===combinedBuildPins.runtimeSha256&&binary===combinedBuildPins.binarySha256&&config===combinedBuildPins.configSha256,'audited candidate binary/config/runtime');
  for(const [file,owned] of [['bw_slice_abi.h','abi.h'],['bw_slice_runtime.h','runtime.h'],['bw_slice_runtime.inc','runtime.inc']])
    check(shaFile(path.join(build,'bochs/cpu',file))===sourceHashes['scripts/bochs-cpu3-native-combined-paging-ram/'+owned],`compiled callback source ${file}`);
  const header=readFileSync(path.join(build,'bochs/config.h'),'utf8');
  for(const [name,value] of Object.entries({BX_CPU_LEVEL:3,BX_SUPPORT_SMP:0,BX_DEBUGGER:0,BX_DEBUGGER_GUI:0,BX_SUPPORT_REPEAT_SPEEDUPS:0,BX_SUPPORT_HANDLERS_CHAINING_SPEEDUPS:0,BX_USE_IDLE_HACK:0}))
    check(new RegExp(`^#define\\s+${name}\\s+${value}\\s*$`,'m').test(header),`required compiled feature ${name}`);
  return {boardRevision,sourceHashes,...combinedBuildPins,patchedHashes,comparisonSourceHashes,
    manifestSha256:combinedSha(manifestBytes),manifestCanonicalSha256:combinedSha(JSON.stringify(manifest)),boardConfigurationSha256:combinedSha(JSON.stringify(combinedBoardConfig))};
}
class Lines{
  constructor(stream){
    this.buffer='';this.queue=[];this.waiters=[];this.error=null;
    stream.on('data',chunk=>{
      this.buffer+=chunk.toString('latin1');
      for(;;){const at=this.buffer.indexOf('\n');if(at<0)break;const line=this.buffer.slice(0,at);this.buffer=this.buffer.slice(at+1);
        try{parseCombinedRpcLine(line);}catch(error){this.fail(error);return;}
        const waiter=this.waiters.shift();if(waiter)waiter.resolve(line);else this.queue.push(line);
        if(this.queue.length>128){this.fail(Error('ram RPC backlog exceeded'));return;}
      }
      if(this.buffer.length>=255)this.fail(Error('ram RPC partial line exceeded bound'));
    });
    stream.on('error',e=>this.fail(e));stream.on('end',()=>this.fail(Error(this.buffer?'ram RPC truncated line':'ram RPC closed')));
  }
  fail(error){if(this.error)return;this.error=error;for(const w of this.waiters.splice(0))w.reject(error);}
  async next(timeoutMs=15000){
    if(this.queue.length)return this.queue.shift();if(this.error)throw this.error;
    let waiter,timer;
    return new Promise((resolve,reject)=>{
      waiter={resolve,reject};this.waiters.push(waiter);
      timer=setTimeout(()=>{this.waiters=this.waiters.filter(w=>w!==waiter);reject(Error(`RAM RPC response timeout after ${timeoutMs}ms`));},timeoutMs);
    }).finally(()=>clearTimeout(timer));
  }
}
function childSession(binary,rc,dir,env={}){
  const child=spawn('prlimit',['--core=0','--',binary,'-q','-f',rc],{cwd:dir,detached:true,
    stdio:['ignore','pipe','pipe','pipe','pipe'],env:{...process.env,...env}});
  const raw={stdout:'',stderr:'',rpcToNative:'',rpcFromNative:''};let outputError=null;
  const stop=()=>{try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}};
  for(const kind of ['stdout','stderr'])child[kind].on('data',bytes=>{
    raw[kind]+=bytes.toString('utf8');if(Buffer.byteLength(raw[kind])>8<<20){outputError=Error('ram raw output bound exceeded');stop();}
  });
  child.stdio[3].on('error',e=>{outputError??=e;});
  const closed=new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal}));});
  const wall=setTimeout(()=>{outputError=Error(`RAM native session timeout after 120000ms; READY=${raw.rpcFromNative.startsWith('BWR12\tREADY\t')}; lastBWS=${raw.stderr.split('\n').filter(x=>x.startsWith('BWS12\t')).at(-1)?.slice(0,180)??'none'}`);stop();},120000);
  closed.finally(()=>clearTimeout(wall)).catch(()=>{});
  child.stdio[4].on('data',bytes=>{raw.rpcFromNative+=bytes.toString('latin1');if(Buffer.byteLength(raw.rpcFromNative)>8<<20){outputError=Error('ram RPC output bound exceeded');stop();}});
  const input=new Lines(child.stdio[4]);
  const send=lines=>{
    for(const line of typeof lines==='string'?[lines]:lines){raw.rpcToNative+=line+'\n';child.stdio[3].write(line+'\n');}
  };
  const receive=async(timeoutMs)=>{const line=await input.next(timeoutMs);return parseCombinedRpcLine(line);};
  return {child,raw,closed,send,receive,stop,error:()=>outputError};
}
function retain(dir,label,raw,exit){
  const files={};
  for(const [kind,text] of Object.entries(raw)){
    const file=label+'.'+kind+'.txt';writeFileSync(path.join(dir,file),text,{flag:'wx'});files[kind]={path:file,sha256:combinedSha(text)};
  }
  const log=label+'.bochs.log';check(existsSync(path.join(dir,'bochs.log')),'actual native Bochs log missing');
  renameSync(path.join(dir,'bochs.log'),path.join(dir,log));files.bochsLog={path:log,sha256:shaFile(path.join(dir,log))};
  return {exitCode:exit.code,signal:exit.signal,files};
}
function transportReply(name,request,wire){
  const lines=[...wire];
  const scalar=lines[0].split('\t');let injected=false;
  if(name.startsWith('page-')&&request.operation==='PAGE'){
    injected=true;
    if(name==='page-generation'){scalar[4]='1';lines[0]=scalar.join('\t');}
    if(name==='page-classification'){scalar[5]='4';lines[0]=scalar.join('\t');}
    if(name==='page-decoded'){scalar[3]='000f0000';lines[0]=scalar.join('\t');}
    if(name==='page-chunk-order')[lines[1],lines[2]]=[lines[2],lines[1]];
    if(name==='page-chunk-width')lines[1]=lines[1].slice(0,-2);
    if(name==='page-end-sequence')lines[65]='BWR12\tEND\t999';
    if(name==='page-a20'){scalar[8]=scalar[8]==='1'?'0':'1';lines[0]=scalar.join('\t');}
    if(name==='page-epoch'){scalar[7]=String(Number(scalar[7])+1);lines[0]=scalar.join('\t');}
    if(name==='page-digest'){scalar[6]='0'.repeat(64);lines[0]=scalar.join('\t');}
  }else if(name.startsWith('scalar-')&&wire.length===1&&scalar[1]==='REP'){
    injected=true;scalar[name==='scalar-sequence'?2:4]=name==='scalar-sequence'?'999':'4294967296';lines[0]=scalar.join('\t');
  }else if(name==='pio-epoch'&&request.operation==='PIO_OUT'){injected=true;scalar[6]=String(Number(scalar[6])+1);lines[0]=scalar.join('\t');
  }else if(name==='pio-a20'&&request.operation==='PIO_OUT'&&request.arg0!==0x60){injected=true;scalar[5]=scalar[5]==='1'?'0':'1';lines[0]=scalar.join('\t');
  }else if(name==='memory-a20'&&['READ','WRITE'].includes(request.operation)){injected=true;scalar[10]=scalar[10]==='1'?'0':'1';lines[0]=scalar.join('\t');
  }else if(['memory-generation','memory-epoch'].includes(name)&&['READ','WRITE'].includes(request.operation)){injected=true;const at=name==='memory-generation'?8:9;scalar[at]=String(Number(scalar[at])+1);lines[0]=scalar.join('\t');
  }else if(name==='memory-classification'&&['READ','WRITE'].includes(request.operation)){
    injected=true;scalar[5]=scalar[5]==='1'?'2':'1';lines[0]=scalar.join('\t');
  }else if(name==='memory-write-commit'&&request.operation==='WRITE'&&scalar[5]==='1'){
    injected=true;scalar[7]=(parseInt(scalar[7].slice(0,2),16)^1).toString(16).padStart(2,'0')+scalar[7].slice(2);lines[0]=scalar.join('\t');
  }else if(name==='memory-rom-observed'&&['READ','WRITE'].includes(request.operation)&&scalar[5]==='2'){
    injected=true;scalar[7]='00'.repeat(scalar[7].length/2);lines[0]=scalar.join('\t');
  }
  return {lines,injected};
}
async function runArm(binary,rc,dir,rom,mode,transport=null){
  const session=childSession(binary,rc,dir),host=new NativeCombinedPagingRamHost(rom);let seq=0,terminal=false,injected=false,error=null,final=null;
  try{
    const ready=await session.receive(120000);check(ready.kind==='READY'&&ready.cs===0xf000&&ready.eip===0xfff0&&ready.nativeTicks===0&&ready.successfulQuanta===0,'actual ram READY');
    for(let runs=0;runs<602;runs++){
      host.beginRun();let command=encodeCombinedCommand(++seq,'RUN',600,combinedBudgets[mode],'18446744073709551615');
      if(transport?.startsWith('command-')&&!injected){
        const p=command.split('\t');injected=true;
        if(transport==='command-sequence')p[2]='999';if(transport==='command-prefix')p[0]='BWR8';if(transport==='command-zero-budget')p[5]='0';
        command=transport==='command-overlong-line'?'BWR12\tCMD\t'+'0'.repeat(300):p.join('\t');
      }
      session.send(command);
      for(;;){
        const message=await session.receive();
        if(message.kind==='REQ'){
          const wire=encodeCombinedReply(host.handleRequest(message));
          const changed=transport&&!injected?transportReply(transport,message,wire):{lines:wire,injected:false};
          injected||=changed.injected;session.send(changed.lines);
        }else{
          check(message.kind==='DONE'&&message.verb==='RUN'&&message.seq===seq,'RUN completion sequence');
          host.endRun();
          if(message.reason===4&&message.chargedNativeTicks===0&&message.chargedQuanta===0){
            terminal=true;final=host.finish();session.send(encodeCombinedCommand(++seq,'STOP'));
            const stopped=await session.receive();check(stopped.kind==='DONE'&&stopped.verb==='STOP'&&stopped.seq===seq,'STOP completion');
          }else{
            const line=host.stageLine();if(line.changed){session.send(encodeCombinedCommand(++seq,'LINE',Number(line.asserted)));const updated=await session.receive();check(updated.kind==='DONE'&&updated.verb==='LINE'&&updated.seq===seq&&updated.value===Number(line.asserted),'LINE completion');}
          }
          break;
        }
      }
      if(terminal)break;
    }
    check(terminal,'native terminal halt bound');
  }catch(e){error=e;if(!transport)session.stop();}
  const exit=await session.closed;
  const label=transport?'transport-'+transport:mode;
  const artifacts=retain(dir,label,session.raw,exit);
  if(transport){
    const failures=[...session.raw.stderr.matchAll(/^BWS12\tFAIL\t([^\t\n]+)$/gm)].map(m=>m[1]);
    return {name:transport,expected:combinedTransports[transport],observedFailure:failures.length===1?failures[0]:null,
      exit,injected,files:artifacts.files,raw:session.raw,diagnostic:error?.message??session.error()?.message??null};
  }
  let native=null,parseError=null;try{native=parseCombinedNativeLog(session.raw.stderr);}catch(e){parseError=e.message;}
  const arm={mode,requestedBudget:combinedBudgets[mode],host:{initial:host.initial,reset:host.reset,seed:host.seed,journal:host.journal,bus:host.bus,chipAdvances:host.chipAdvances,final},
    native,rpc:{toNative:session.raw.rpcToNative.trimEnd().split('\n'),fromNative:session.raw.rpcFromNative.trimEnd().split('\n')},raw:session.raw,artifacts};
  if(error||parseError||session.error())arm.diagnostic=error?.message??parseError??session.error().message;
  const actualArmBytes=Buffer.from(JSON.stringify(arm,null,2)+'\n');
  writeFileSync(path.join(dir,mode+'.unvalidated.json.gz'),gzipSync(actualArmBytes,{mtime:0}),{flag:'wx'});return arm;
}
async function runGuard(binary,rc,dir,name){
  const session=childSession(binary,rc,dir,{BW_CPU3_COMBINED_PAGING_RAM_PROBE:name});
  const exit=await session.closed,artifacts=retain(dir,'guard-'+name,session.raw,exit);
  const failures=[...session.raw.stderr.matchAll(/^BWS12\tFAIL\t([^\t\n]+)$/gm)].map(m=>m[1]);
  return {name,expected:combinedGuards[name],observedFailure:failures.length===1?failures[0]:null,exit,files:artifacts.files,raw:session.raw,diagnostic:session.error()?.message??null};
}
function verifyActualArtifacts(report,directory){
  for(const group of Object.values(report.artifacts)){
    const files=group.files??(Object.hasOwn(group,'path')?{single:group}:group);
    for(const entry of Object.values(files)){
      check(entry&&typeof entry.path==='string'&&/^[a-zA-Z0-9._-]+$/.test(entry.path),'unsafe actual artifact path');
      check(shaFile(path.join(directory,entry.path))===entry.sha256,`actual artifact bytes differ: ${entry.path}`);
    }
  }
}
export async function runNativeCombinedPagingRamCompare({build,manifestFile,directory}){
  build=path.resolve(build);directory=path.resolve(directory);check(!existsSync(directory),'capture directory must be new');
  const manifestBytes=readFileSync(manifestFile),manifest=JSON.parse(manifestBytes.toString('utf8')),before=preflight(build,manifest,manifestBytes),{rom}=assembleCombinedPagingRamRom();
  const disk=statfsSync(path.dirname(directory));check(disk.bavail*disk.bsize>=512*1024*1024,'512 MiB volume reserve required');
  mkdirSync(directory,{recursive:false});
  const bochsLog=path.join(directory,'bochs.log'),rc=path.join(directory,'bochsrc');
  const config=['display_library: nogui','memory: guest=16, host=16',
    `romimage: file=${path.join(root,'roms/free-at-bios/BIOS-bochs-legacy')}`,
    `vgaromimage: file=${path.join(root,'roms/free-at-bios/vgabios-lgpl.bin')}`,
    'cpu: count=1, ips=10000000','clock: sync=none, time0=946684800','boot: disk','port_e9_hack: enabled=1',
    `log: ${bochsLog}`,'panic: action=fatal','error: action=report','info: action=report','debug: action=ignore','mouse: enabled=0'].join('\n')+'\n';
  writeFileSync(rc,config,{flag:'wx'});writeFileSync(path.join(directory,'free-rom.bin'),rom,{flag:'wx'});
  const source={...before,bochsrcSha256:combinedSha(config),bochsrcText:config,romSha256:combinedSha(rom),fixtureSha256:shaFile(path.join(root,'test/fixtures/i80386-free-combined-paging-ram.S'))};
  const report={schema:'bw.bochs-cpu3-native-combined-paging-ram.v1',qualificationStatus:'CANDIDATE',claim:'native-actual-board-bounded-combined-paging-ram-rep-pf-pit-only',source,
    javascriptOracle:{path:'docs/receipts/2026-10-01-i80386-js-combined-paging-ram-oracle-capture.json.gz',
      sha256:'bcf52cc49849a2c7889077d2b6f80d980916766d175ab78cd656689d9a7f3ab2',
      boardRevision:'15f010c92b5227622b76da815bd47000e28a988c',cpuProfile:'compatibility',strict386:false},
    resetDifferences:combinedResetDifferences,busDifferences:combinedBusDifferences,arms:{},probes:{},transportProbes:{},artifacts:{bochsrc:{path:'bochsrc',sha256:combinedSha(config)}}};
  const binary=path.join(build,'bochs/bochs');
  check(Object.keys(combinedGuards).length&&Object.keys(combinedTransports).length,'guard and transport census must be frozen');
  const reserve=()=>{const disk=statfsSync(directory);check(disk.bavail*disk.bsize>=512*1024*1024,'512 MiB volume reserve exhausted');};
  for(const name of Object.keys(combinedBudgets)){reserve();report.arms[name]=await runArm(binary,rc,directory,rom,name);report.artifacts[name]=report.arms[name].artifacts;}
  for(const name of Object.keys(combinedGuards)){reserve();report.probes[name]=await runGuard(binary,rc,directory,name);report.artifacts['guard-'+name]=report.probes[name].files;}
  for(const name of Object.keys(combinedTransports)){reserve();report.transportProbes[name]=await runArm(binary,rc,directory,rom,'continuous',name);report.artifacts['transport-'+name]=report.transportProbes[name].files;}
  writeFileSync(path.join(directory,'capture.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  assert.deepEqual(preflight(build,manifest,manifestBytes),before,'source/build changed during actual capture');
  verifyActualArtifacts(report,directory);
  check(shaFile(path.join(directory,'free-rom.bin'))===source.romSha256,'actual ROM artifact bytes');
  const result=assertNativeCombinedPagingRamProof(report,rom);
  writeFileSync(path.join(directory,'result.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  return {capture:path.join(directory,'capture.json'),captureSha256:shaFile(path.join(directory,'capture.json')),...result};
}
export function preflightNativeCombinedPagingRam({build,manifestFile}){
  const bytes=readFileSync(manifestFile);return preflight(path.resolve(build),JSON.parse(bytes),bytes);
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.length===5&&args[0]==='--preflight'&&args[1]==='--build'&&args[3]==='--manifest'){
    console.log(JSON.stringify(preflightNativeCombinedPagingRam({build:args[2],manifestFile:args[4]}),null,2));
  }else{
    check(args.length===6&&args[0]==='--build'&&args[2]==='--manifest'&&args[4]==='--out',
      'usage: [--preflight] --build /prepared/tree --manifest /prepare.json [--out /new/capture/directory]');
    console.log(JSON.stringify(await runNativeCombinedPagingRamCompare({build:args[1],manifestFile:args[3],directory:args[5]}),null,2));
  }
}
