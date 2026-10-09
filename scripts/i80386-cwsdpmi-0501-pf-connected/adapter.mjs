import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {ExperimentalI80386ATMachine,PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA} from '../../src/experimental/i80386-at-machine.js';
import {GEOMETRY,HOST,CLIENT_SHA,buildMedia} from '../i80386-cwsdpmi-highmem-timer/media.mjs';
import {readRootFile} from '../i80386-dos32a-owned/media.mjs';
import {readyForScan} from '../i80386-dos32a-owned/keyboard.mjs';
import {passiveRows,ringEmpty,controllerStatus} from '../i80386-cwsdpmi-at-loaded-main-gate/driver.mjs';
import {candidateAtMain} from '../i80386-cwsdpmi-highmem-at/strict-cut.mjs';
import {bindOwnedCodeAtMain} from '../i80386-cwsdpmi-highmem-at/owned-cut.mjs';
import {admitFreshWrapper} from '../i80386-cwsdpmi-0501-frame-at/admit.mjs';
import {runPfConnectedScenario} from './driver.mjs';

const BIOS={bytes:65536,sha256:'6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac'};
const VGA={bytes:38400,sha256:'76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1'};
const FLOPPY={bytes:1228800,sha256:'03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77'};
const EXPECTED={client:'69f3233feb79efb4b69314b1dee9bda8b1e89314eaf969181c9bd6c17b0722f5',
  map:'0ae36fe461f09b6cce7477a3ad3359659eef5db812997b4e43a3e8f7044b5b5b',
  media:'9353eaaee5db8912957f53ffa6dfc624c07d359914ef19cc9033eeaefa9234e4'};
const DISK_BYTES=GEOMETRY.cylinders*GEOMETRY.heads*GEOMETRY.sectors*512;
const FILE_NAMES=Object.freeze({output:'HTOUT   TXT',ok:'HTOK    TXT',
  fail:'HTFAIL  TXT',returned:'HTRET   TXT'});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bounded=error=>String(error?.message??error)
  .replace(/(?:\/[A-Za-z0-9._-]+)+/g,'[path]').slice(0,400);
function first(report,message){
  report.passed=false;
  if(report.firstFailure===null)report.firstFailure=message;
  else (report.secondaryFailures??=[]).push(message);
}
function exact(path,limit,pin=null){
  const namedBefore=fs.lstatSync(path);
  if(!namedBefore.isFile()||namedBefore.isSymbolicLink()||
     namedBefore.size<1||namedBefore.size>limit)
    throw new Error('private input shape');
  const fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NONBLOCK|
    fs.constants.O_NOFOLLOW);
  try{
    const before=fs.fstatSync(fd);
    if(!before.isFile()||before.size!==namedBefore.size||
       before.dev!==namedBefore.dev||before.ino!==namedBefore.ino||
       before.mtimeMs!==namedBefore.mtimeMs)
      throw new Error('private input shape');
    const raw=Buffer.alloc(before.size+1);
    let count=0;
    while(count<raw.length){
      const n=fs.readSync(fd,raw,count,raw.length-count,null);
      if(!n)break;
      count+=n;
    }
    const after=fs.fstatSync(fd),named=fs.lstatSync(path);
    if(!named.isFile()||named.isSymbolicLink()||count!==before.size||
       before.dev!==after.dev||before.ino!==after.ino||
       before.size!==after.size||before.mtimeMs!==after.mtimeMs||
       named.dev!==after.dev||named.ino!==after.ino||
       named.size!==after.size||named.mtimeMs!==after.mtimeMs)
      throw new Error('private input changed during read');
    const result=raw.subarray(0,count);
    if(pin&&(result.length!==pin.bytes||sha(result)!==pin.sha256))
      throw new Error('private input hash/size');
    return result;
  }finally{fs.closeSync(fd);}
}
const json=(path,cap)=>JSON.parse(exact(path,cap).toString('utf8'));
function hddCmos(g){
  return [[0x19,47],[0x1b,g.cylinders&255],[0x1c,g.cylinders>>8],[0x1d,g.heads],
    [0x1e,0xff],[0x1f,0xff],[0x20,g.heads>8?0xc8:0xc0],[0x21,g.cylinders&255],
    [0x22,g.cylinders>>8],[0x23,g.sectors],[0x39,0]];
}
function machineFor({bios,vga,floppy,disk}){
  const base=PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA;
  const cmos=hddCmos(GEOMETRY),replaced=new Set(cmos.map(([index])=>index));
  const config={...base,functionalInstructionCycles:6,
    regions:[...base.regions.filter(region=>!(region.kind==='rom'&&region.start===0xc0000)),
      {kind:'rom',start:0xc0000,end:0xc9fff}],
    chips:base.chips.map(chip=>chip.kind==='rtc'?{...chip,
      initialCmos:[...chip.initialCmos.filter(([index])=>
        index!==0x3d&&index!==0x12&&!replaced.has(index)),[0x3d,0x21],[0x12,0xf0],...cmos]}:chip)};
  const machine=new ExperimentalI80386ATMachine(config,
    {ataImage:new Uint8Array(disk),ataGeometry:GEOMETRY});
  machine.loadRom(bios,0xf0000);machine.loadRom(bios,0xff0000);
  machine.loadRom(vga,0xc0000);
  machine.chips.fdc1.insert(0,new Uint8Array(floppy),
    {cylinders:80,heads:2,sectors:15,bytesPerSector:512});
  machine.reset();
  return machine;
}
function sampleFiles(machine){
  const bytes=machine.ata.mediaBytes();
  if(!(bytes instanceof Uint8Array)||bytes.length!==DISK_BYTES||
     bytes.buffer instanceof SharedArrayBuffer)
    throw new Error('ATA snapshot geometry/ownership');
  const image=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  return {imageSha256:sha(image),files:Object.fromEntries(Object.entries(FILE_NAMES)
    .map(([role,name])=>[role,readRootFile(image,name)]))};
}
function state(machine){
  const cpu=machine.cpu;
  return {cs:cpu.cs,ds:cpu.ds,es:cpu.es,ss:cpu.ss,fs:cpu.fs,gs:cpu.gs,
    eip:cpu.eip,eflags:cpu.eflags,cr0:cpu.cr0,cr2:cpu.cr2,cr3:cpu.cr3,cr4:cpu.cr4,
    csDescriptor:{...cpu.segmentCaches[1]},cycles:cpu.cycles,
    machineCycles:machine.cycles,shutdown:cpu.shutdown};
}
function writeProgress(path,report){
  const temporary=path+'.pending.json';
  fs.writeFileSync(temporary,JSON.stringify(report,null,2)+'\n');
  fs.renameSync(temporary,path);
}

export function run(inputPath,outputPath,progressPath){
  const report={schema:'bw.cwsdpmi-0501-pf-outcome.at-source.v1',passed:false,
    scope:'bounded PF delivery-call outcome after the original strict AX=0501 frame refusal; no PF service, frame-return, client completion, or physical mapping proof',
    firstFailure:null,stage:'setup',frameReturnQualified:false};
  let machine=null,pristineDisk=null,pristineFloppy=null;
  let lastFiniteProgress=null,lastModeProgress=null;
  const progress=()=>writeProgress(progressPath,{schema:report.schema,
    passed:false,firstFailure:report.firstFailure,stage:report.stage,
    inputHashes:report.inputHashes,
    finiteClientProgress:lastFiniteProgress,
    taskModeProgress:lastModeProgress});
  try{
    const input=json(inputPath,16384);
    const bios=exact(input.bios,BIOS.bytes,BIOS),vga=exact(input.vga,VGA.bytes,VGA),
      floppy=exact(input.floppy,FLOPPY.bytes,FLOPPY),
      host=exact(input.host,HOST.bytes,HOST),
      client=exact(input.client,2<<20),map=exact(input.map,1<<20),
      source=exact(input.source,4027,{bytes:4027,sha256:CLIENT_SHA}),
      compileRaw=exact(input.compileReport,1<<20),compile=JSON.parse(compileRaw.toString('utf8')),
      outer=json(input.outerCompileReport,1<<20),media=json(input.mediaReport,1<<20),
      disk=exact(input.disk,DISK_BYTES,{bytes:DISK_BYTES,sha256:EXPECTED.media});
    pristineDisk=disk;pristineFloppy=floppy;
    if(sha(client)!==EXPECTED.client||sha(map)!==EXPECTED.map||
       media?.schema!=='bw.cwsdpmi-highmem-timer.qemu-media.v1'||
       media.sha256!==EXPECTED.media||media.bytes!==DISK_BYTES||
       outer?.schema!=='bw.cwsdpmi-highmem-timer.compile-adapter.v1'||
       outer.status!=='COMPILED_INTERNAL_ONLY'||
       outer.rawCompileReport?.path!=='compile-audit/compile-report.json'||
       outer.rawCompileReport.sha256!==sha(compileRaw)||
       outer.ownedSource?.path!=='scripts/i80386-cwsdpmi-highmem-timer/client.c'||
       outer.ownedSource.sha256!==CLIENT_SHA||
       outer.executable?.sha256!==EXPECTED.client||outer.map?.sha256!==EXPECTED.map||
       JSON.stringify(outer.executable)!==JSON.stringify(compile.executable)||
       JSON.stringify(outer.map)!==JSON.stringify(compile.map))
      throw new Error('fresh high-memory compile/media identity');
    const {layout,token}=admitFreshWrapper(client,map,compile);
    const built=buildMedia({host,client,source,compile:outer,rawCompile:compile});
    if(built.manifest.sha256!==media.sha256||!built.image.equals(disk))
      throw new Error('private AT media differs from fresh pair');
    report.inputHashes={bios:BIOS.sha256,vga:VGA.sha256,floppy:FLOPPY.sha256,
      host:HOST.sha256,client:sha(client),map:sha(map),pristineDisk:sha(disk)};
    report.mediaProfile={geometry:GEOMETRY,configuredGuestRamBytes:4<<20,
      backingBytes:16<<20,bios:'repository free AT BIOS',
      vga:'repository LGPL VGA BIOS',qemuFirmware:'different SeaBIOS control'};
    machine=machineFor({bios,vga,floppy,disk});
    report.mediaCopies={initial:{hddSha256:sha(machine.ata.mediaBytes()),
      floppySha256:sha(machine.chips.fdc1.drives[0].image)}};
    if(report.mediaCopies.initial.hddSha256!==report.inputHashes.pristineDisk||
       report.mediaCopies.initial.floppySha256!==FLOPPY.sha256)
      throw new Error('writable guest media differs from pristine input');
    const result=runPfConnectedScenario({machine,now:()=>Date.now(),
      cpuUsage:prior=>process.cpuUsage(prior),state:()=>state(machine),
      readFiles:()=>sampleFiles(machine),screen:()=>passiveRows(machine),
      candidate:()=>candidateAtMain(machine,layout),
      bind:()=>bindOwnedCodeAtMain(machine,layout),
      ready:(step,last)=>readyForScan({step,lastOfferedStep:last,
        ringEmpty:ringEmpty(machine),controllerStatus:controllerStatus(machine)}),
      offer:scan=>machine.keyIn(scan),step:()=>machine.step(),
      progress:value=>{lastFiniteProgress=value;report.stage=value.stage;progress();},
      taskProgress:value=>{lastModeProgress=value;report.stage=value.event;
        if(value.event==='strict-terminal')
          report.firstFailure??=value.strict?.failure??'strict frame terminal';
        progress();}},
      {machine,layout,token});
    report.finiteClient=result.finiteClient;
    report.strictFrame=result.strict;
    report.taskMode=result.taskMode;
    report.pfOutcome=result.pfOutcome;
    report.pfGrade=result.pfGrade;
    if(result.continuationFailure)
      (report.secondaryFailures??=[]).push(result.continuationFailure);
    if(result.pfOutcome?.firstFailure)
      (report.secondaryFailures??=[]).push(result.pfOutcome.firstFailure);
    report.firstFailure??=result.strict.firstFailure??
      result.finiteClient.firstFailure??null;
    report.stage='diagnostic-complete';
    if(report.firstFailure===null)
      first(report,'strict task-switch refusal or diagnostic absent');
  }catch(error){first(report,bounded(error));}
  if(!report.finiteClient && lastFiniteProgress)
    report.finiteClientPartialProgress=lastFiniteProgress;
  if(!report.taskMode && lastModeProgress)
    report.taskModePartialProgress=lastModeProgress;
  if(machine){
    try{report.final=state(machine);}catch(error){first(report,'final CPU: '+bounded(error));}
    try{report.memory={backingSha256:sha(machine.mem),pageClassSha256:sha(machine._page)};}
    catch(error){first(report,'final memory: '+bounded(error));}
    try{report.disk={initialSha256:report.inputHashes?.pristineDisk,
      finalSha256:sha(machine.ata.mediaBytes())};
      report.mediaCopies??={};
      report.mediaCopies.final={hddSha256:report.disk.finalSha256,
        floppySha256:sha(machine.chips.fdc1.drives[0].image),
        pristineHddSha256:pristineDisk?sha(pristineDisk):null,
        pristineFloppySha256:pristineFloppy?sha(pristineFloppy):null};}
    catch(error){first(report,'final disk: '+bounded(error));}
  }
  try{writeProgress(progressPath,report);}catch(error){first(report,'progress: '+bounded(error));}
  fs.writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  if(!report.passed)process.exitCode=1;
  return report;
}

if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
  if(process.argv.length!==5)
    throw new Error('usage: adapter.mjs input.json report.json progress.json');
  run(...process.argv.slice(2));
}
