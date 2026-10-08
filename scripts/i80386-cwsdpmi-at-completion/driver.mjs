import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {ExperimentalI80386ATMachine,PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA} from '../../src/experimental/i80386-at-machine.js';
import {GEOMETRY,CWSDPMI,SUCCESS,EXIT_OK,RETURN,FIRST,SECOND,buildMedia} from '../i80386-cwsdpmi-qemu-owned/media.mjs';
import {readRootFile} from '../i80386-dos32a-owned/media.mjs';
import {encode,readyForScan} from '../i80386-dos32a-owned/keyboard.mjs';
import {admitBoundImage} from '../i80386-cwsdpmi-at-owned/binding.mjs';
import {candidateAtMain,bindAtMainCut} from '../i80386-cwsdpmi-at-loaded-actual/cut.mjs';
import {passiveRows,ringEmpty,controllerStatus} from '../i80386-cwsdpmi-at-loaded-main-gate/driver.mjs';
import {FIRST_SCANS,SECOND_SCANS,gradeBatch,gradeReturn,currentPrompt} from './grade.mjs';

const BIOS={bytes:65536,sha256:'6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac'};
const VGA={bytes:38400,sha256:'76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1'};
const FLOPPY={bytes:1228800,sha256:'03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77'};
const DISK_BYTES=GEOMETRY.cylinders*GEOMETRY.heads*GEOMETRY.sectors*512;
const LIMITS=Object.freeze({steps:120_000_000,wallMs:640_000,screenEvery:50_000,
  diskEvery:1_000_000,progressEvery:200_000,stableSteps:100_000,
  partialFatAttempts:20,partialFatSteps:10_000_000,keyAttempts:1000});
const FILE_NAMES=Object.freeze({output:'DPOUT   TXT',ok:'DPOK    TXT',
  fail:'DPFAIL  TXT',returned:'RETURN  TXT'});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const bounded=error=>String(error?.message??error)
  .replace(/(?:\/[A-Za-z0-9._-]+)+/g,'[path]').slice(0,400);
const first=(report,text)=>{
  report.passed=false;
  if(report.firstFailure===null)report.firstFailure=text;
  else (report.secondaryFailures??=[]).push(text);
};
const hasSequence=(haystack,needle)=>{
  for(let at=0;at<=haystack.length-needle.length;at++)
    if(needle.every((value,index)=>value===haystack[at+index]))return true;
  return false;
};
const marked=rows=>Array.isArray(rows)&&rows.some(row=>
  typeof row==='string'&&row.trim()==='BW-DPMI-BATCH-DONE');
const expected=(value,text)=>Buffer.isBuffer(value)&&
  value.equals(Buffer.from(text+'\r\n','ascii'));
const absent=files=>Object.keys(FILE_NAMES).every(name=>files?.[name]===null);
const cutUnwritten=files=>(files?.output===null||
  Buffer.isBuffer(files?.output)&&files.output.length===0)&&
  files?.ok===null&&files?.fail===null&&files?.returned===null;
const batchExact=files=>expected(files?.output,SUCCESS)&&
  expected(files?.ok,EXIT_OK)&&files?.fail===null&&files?.returned===null;
const returnExact=files=>expected(files?.output,SUCCESS)&&
  expected(files?.ok,EXIT_OK)&&files?.fail===null&&expected(files?.returned,RETURN);
const fileSummary=files=>Object.fromEntries(Object.entries(FILE_NAMES).map(([name])=>{
  const bytes=files?.[name];
  if(bytes===null)return [name,null];
  if(!Buffer.isBuffer(bytes)||bytes.length>65536)throw new Error('guest file sample shape');
  const out={bytes:bytes.length,sha256:sha(bytes)};
  if((name==='output'&&expected(bytes,SUCCESS))||
     (name==='ok'&&expected(bytes,EXIT_OK))||
     (name==='returned'&&expected(bytes,RETURN)))out.text=bytes.toString('latin1');
  return [name,out];
}));
const fileKey=files=>sha(Buffer.from(JSON.stringify(fileSummary(files))));

function exact(path,limit,pin=null){
  const fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const before=fs.fstatSync(fd);
    if(!before.isFile()||before.size<1||before.size>limit)
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
       named.dev!==after.dev||named.ino!==after.ino)
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
  // mediaBytes() clones once; Buffer views that private clone without another
  // 10.65 MiB copy. All four FAT reads use this one between-step snapshot.
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
  const temporary=path+'.pending';
  fs.writeFileSync(temporary,JSON.stringify(report,null,2)+'\n');
  fs.renameSync(temporary,path);
}

// Purely injected orchestration for focused ordering controls. Only run()
// below binds each port to source-authenticated machine/media operations.
export function runScenario(ports,options={}){
  const limits={...LIMITS,...options};
  const report={schema:'bw.cwsdpmi-owned.at-completion-source.v1',passed:false,
    scope:'same-machine AT owned-client completion after strict loaded-main cut; no INT31 attribution or RTx',
    stage:'setup',firstFailure:null,steps:0};
  const session=Object.freeze({}),queue=[],offered=[],acceptedScans=[],requested=[];
  const start=ports.now(),startCpu=ports.cpuUsage(),startState=ports.state();
  const hotCpu=ports.machine.cpu;
  let stage='boot',declined=false,menuKicks=0,lastOfferedStep=-5000,
    lastScreen=[],firstCommandAccepted=false,
    secondCommandAccepted=false,boundStep=null,cutFiles=null,batch=null,
    secondQueuedStep=null,batchPrompt=null,verifyPrompt=null,
    sawNonPromptSinceSecondQueue=false,
    lastDiskStep=-limits.diskEvery,partialFatAttempts=0,firstPartialStep=null,
    firstPartialError=null,
    batchCandidate=null,returnCandidate=null,lastFiles=null,
    lastDiskSha=null,loaded=null,firstRows=null,
    firstRowsStep=null,secondRows=null,secondRowsStep=null;
  let incompleteSince=null,incompleteCount=0;
  let previousStepNumber=null,previousEip=null,previousCpuCycles=null,
    previousMachineCycles=null,returnedEip=null,returnedCpuCycles=null,
    returnedMachineCycles=null;
  const predecessor=()=>previousStepNumber===null?null:{step:previousStepNumber,
    eip:previousEip,cpuCycles:previousCpuCycles,machineCycles:previousMachineCycles,
    returnedEip,returnedCpuCycles,returnedMachineCycles};
  const record=()=>ports.progress(report);
  const snapshot=(step,phase)=>{
    try{
      const observed=ports.readFiles();
      lastDiskStep=step;lastFiles=observed.files;lastDiskSha=observed.imageSha256;
      report.guestFiles=fileSummary(lastFiles);
      report.diskObservation={step,phase,sha256:lastDiskSha};
      return observed;
    }catch(error){
      const detail=bounded(error);
      if((detail==='FAT chain truncated'||detail==='FAT chain excess')&&
         (phase==='waiting-batch'&&!batchPrompt||
          phase==='waiting-return'&&!secondRows)){
        if(phase==='waiting-batch')batchCandidate=null;
        if(phase==='waiting-return')returnCandidate=null;
        partialFatAttempts++;firstPartialStep??=step;
        firstPartialError??=detail;
        report.partialFat={attempts:partialFatAttempts,firstStep:firstPartialStep,
          lastStep:step,firstError:firstPartialError,lastError:detail};
        if(partialFatAttempts<=limits.partialFatAttempts&&
           step-firstPartialStep<=limits.partialFatSteps){lastDiskStep=step;return null;}
      }
      throw new Error('FAT observation: '+detail);
    }
  };
  try{
    const initial=snapshot(0,'initial');
    if(!absent(initial.files))throw new Error('initial result files present');
    report.initialDisk={sha256:initial.imageSha256,files:fileSummary(initial.files)};
    report.reset=startState;stage='boot';report.stage=stage;record();
    for(let step=0;step<limits.steps;step++){
      report.steps=step;
      if(stage==='batch-approved'&&step>batch.step){
        queue.push(...encode(SECOND+'\r'));secondQueuedStep=step;
        requested.push({command:SECOND,step});
        stage='verify-queued';report.stage=stage;
        report.secondQueuedStep=step;record();
      }
      if(firstCommandAccepted&&boundStep===null&&ports.candidate()){
        stage='protected-main-candidate';report.stage=stage;
        report.candidate={step,previousReturnedStep:predecessor(),cpu:ports.state()};
        record();
        const atCut=snapshot(step,'cut');
        if(!cutUnwritten(atCut.files))throw new Error('result files already written at main cut');
        cutFiles=atCut.files;
        report.cutFiles=fileSummary(cutFiles);
        loaded=ports.bind(); // strict existing exact whole-text binding only
        boundStep=step;report.loaded=loaded;stage='waiting-batch';
        report.stage=stage;report.boundStep=step;record();
      }
      if(step%limits.screenEvery===0){
        if(ports.now()-start>limits.wallMs)throw new Error('AT completion wall bound');
        const rows=ports.screen();
        if(rows===null){
          if(stage==='waiting-batch')batchPrompt=null;
          if(stage==='verify-queued'||stage==='waiting-return'){
            firstRows=null;firstRowsStep=null;secondRows=null;secondRowsStep=null;
          }
        }
        if(rows!==null){
          if(!Array.isArray(rows)||rows.length!==25)throw new Error('VGA rows shape');
          lastScreen=rows;
          if(stage==='boot'){
            if(!declined&&rows.some(line=>/Do you want to proceed/i.test(line))){
              queue.push(...encode('n\r'));declined=true;
            }else if(!declined&&queue.length===0&&step-menuKicks>800000&&
              rows.some(line=>/press \[ENTER\]|Select from Menu/i.test(line))){
              queue.push(...encode('\r'));menuKicks=step;
            }else if(declined&&queue.length===0&&currentPrompt(rows)){
              if(marked(rows))throw new Error('stale batch marker before first command');
              queue.push(...encode(FIRST+'\r'));requested.push({command:FIRST,step});
              stage='first-queued';
              report.stage=stage;report.firstQueuedStep=step;record();
            }
          }else if(stage==='waiting-batch'&&firstCommandAccepted){
            batchPrompt=marked(rows)&&currentPrompt(rows)&&step>boundStep?
              {rows:[...rows],step}:null;
          }else if((stage==='verify-queued'||stage==='waiting-return')&&
                   secondQueuedStep!==null&&step>=secondQueuedStep){
            if(!currentPrompt(rows)){
              sawNonPromptSinceSecondQueue=true;
              firstRows=null;firstRowsStep=null;secondRows=null;secondRowsStep=null;
            }else if(secondCommandAccepted&&sawNonPromptSinceSecondQueue){
              if(firstRows===null){firstRows=[...rows];firstRowsStep=step;}
              else if(step-firstRowsStep>=limits.stableSteps){
                secondRows=[...rows];secondRowsStep=step;
              }
            }
          }
        }
      }
      if((stage==='waiting-batch'||stage==='waiting-return')&&
         step-lastDiskStep>=limits.diskEvery){
        const observed=snapshot(step,stage);
        if(observed){
          const files=observed.files,key=fileKey(files);
          if(files.fail!==null)throw new Error('guest failure marker present');
          if(stage==='waiting-batch'){
            if(files.returned!==null)throw new Error('return marker before verify');
            if(batchExact(files)){
              incompleteSince=null;incompleteCount=0;
              if(batchCandidate?.key!==key)batchCandidate={key,step};
              else if(step-batchCandidate.step>=limits.diskEvery&&batchPrompt){
                batch=gradeBatch({session,initial:initial.files,cutFiles,files,
                  rows:batchPrompt.rows,accepted:offered,boundStep,step,
                  pendingKeys:queue.length});
                report.batchGrade=batch;
                if(!batch.passed)throw new Error('batch grade refused');
                stage='batch-approved';report.stage=stage;record();
              }
            }else{
              batchCandidate=null;
              if(batchPrompt)throw new Error('settled batch has wrong result files');
              if(files.output?.length||files.ok!==null){
                incompleteSince??=step;incompleteCount++;
                report.incomplete={phase:stage,firstStep:incompleteSince,lastStep:step,
                  observations:incompleteCount,files:fileSummary(files)};
                if(incompleteCount>limits.partialFatAttempts||
                   step-incompleteSince>limits.partialFatSteps)
                  throw new Error('incomplete batch files exceeded bound');
              }
            }
          }else if(stage==='waiting-return'){
            if(returnExact(files)){
              incompleteSince=null;incompleteCount=0;
              if(returnCandidate?.key!==key)returnCandidate={key,step};
              else if(step-returnCandidate.step>=limits.diskEvery&&secondRows){
                verifyPrompt=gradeReturn({session,batch,files,accepted:offered,
                  secondQueuedStep,firstRows,firstStep:firstRowsStep,
                  secondRows,secondStep:secondRowsStep,pendingKeys:queue.length});
                report.returnGrade=verifyPrompt;
                report.promptEpoch={firstStep:firstRowsStep,secondStep:secondRowsStep,
                  nonPromptSinceSecondQueue:sawNonPromptSinceSecondQueue};
                if(!verifyPrompt.passed)throw new Error('return grade refused');
                stage='done';report.stage=stage;report.passed=true;record();break;
              }
            }else{
              returnCandidate=null;
              if(secondRows)throw new Error('settled verify has wrong result files');
              if(files.returned!==null){
                incompleteSince??=step;incompleteCount++;
                report.incomplete={phase:stage,firstStep:incompleteSince,lastStep:step,
                  observations:incompleteCount,files:fileSummary(files)};
                if(incompleteCount>limits.partialFatAttempts||
                   step-incompleteSince>limits.partialFatSteps)
                  throw new Error('incomplete verify files exceeded bound');
              }
            }
          }
        }
      }
      if(queue.length&&ports.ready(step,lastOfferedStep)){
        if(offered.length>=limits.keyAttempts)throw new Error('keyboard attempt cap');
        const event=queue[0],accepted=ports.offer(event.scan);
        if(typeof accepted!=='boolean')throw new Error('keyboard admission shape');
        lastOfferedStep=step;
        offered.push({step,scan:event.scan,key:event.key,phase:event.phase,accepted});
        if(accepted){
          queue.shift();acceptedScans.push(event.scan);
          if(stage==='first-queued'&&!firstCommandAccepted&&
             hasSequence(acceptedScans,FIRST_SCANS))firstCommandAccepted=true;
          if(stage==='verify-queued'&&!secondCommandAccepted&&
             hasSequence(acceptedScans,SECOND_SCANS)){
            secondCommandAccepted=true;stage='waiting-return';report.stage=stage;
            record();
          }
        }
      }
      const beforeEip=hotCpu.eip,beforeCpuCycles=hotCpu.cycles,
        beforeMachineCycles=ports.machine.cycles;
      ports.step();
      previousStepNumber=step;previousEip=beforeEip;
      previousCpuCycles=beforeCpuCycles;previousMachineCycles=beforeMachineCycles;
      returnedEip=hotCpu.eip;returnedCpuCycles=hotCpu.cycles;
      returnedMachineCycles=ports.machine.cycles;
      if(hotCpu.shutdown)throw new Error('CPU shutdown before completion');
      if(step%limits.progressEvery===0){
        report.progress={step,stage,queuedKeys:queue.length,acceptedKeys:acceptedScans.length,
          screen:lastScreen,partialFatAttempts,previousStep:predecessor()};
        record();
      }
    }
    if(!report.passed&&report.firstFailure===null)first(report,'completion not reached within step bound');
  }catch(error){
    first(report,bounded(error));
    if(error?.observation)report.failedObservation=error.observation;
    if(error?.textMismatch)report.textMismatch=error.textMismatch;
  }
  report.stage=stage;report.loaded??=loaded;
  report.keyboard={declined,requested,offered,pending:queue.length,
    lastOfferedStep,firstCommandAccepted,secondCommandAccepted};
  report.lastScreen=lastScreen;report.previousReturnedStep=predecessor();
  report.partialFat??={attempts:partialFatAttempts};
  try{
    const elapsedWallMs=ports.now()-start,processCpu=ports.cpuUsage(startCpu),
      endState=ports.state();
    report.execution={wallMs:elapsedWallMs,processCpuMicros:processCpu.user+processCpu.system,
      processUserMicros:processCpu.user,processSystemMicros:processCpu.system,
      machineCycleDelta:endState.machineCycles-startState.machineCycles,
      cpuCycleDelta:endState.cycles-startState.cycles,
      scope:'synchronous post-reset scenario including observations and grading; excludes input acquisition, media build, and machine construction; not adoption timing'};
    report.final=endState;
  }catch(error){first(report,'final accounting: '+bounded(error));}
  try{record();}catch(error){first(report,'progress: '+bounded(error));report.passed=false;}
  return report;
}

export function run(inputPath,outputPath,progressPath){
  const report={schema:'bw.cwsdpmi-owned.at-completion-source.v1',passed:false,
    firstFailure:null,stage:'setup'};
  let machine=null,pristineDisk=null,pristineFloppy=null;
  try{
    const input=json(inputPath,16384);
    const bios=exact(input.bios,BIOS.bytes,BIOS),vga=exact(input.vga,VGA.bytes,VGA),
      floppy=exact(input.floppy,FLOPPY.bytes,FLOPPY),
      host=exact(input.host,CWSDPMI.bytes,CWSDPMI),
      client=exact(input.client,2<<20),map=exact(input.map,1<<20),
      compile=json(input.compileReport,1<<20),media=json(input.mediaReport,1<<20),
      disk=exact(input.disk,DISK_BYTES,{bytes:DISK_BYTES,sha256:media.sha256});
    pristineDisk=disk;pristineFloppy=floppy;
    const layout=admitBoundImage(client,map,compile);
    const built=buildMedia({host,client,compileReport:compile});
    if(built.manifest.sha256!==media.sha256||!built.image.equals(disk))
      throw new Error('private AT media differs from fresh pair');
    Object.assign(report,{inputHashes:{bios:BIOS.sha256,vga:VGA.sha256,
      floppy:FLOPPY.sha256,host:CWSDPMI.sha256,client:sha(client),map:sha(map),
      pristineDisk:sha(disk)},linkedText:layout.text,main:layout.roles.main,
      mediaProfile:{geometry:GEOMETRY,configuredGuestRamBytes:4<<20,
        backingBytes:16<<20,bios:'repository free AT BIOS',
        vga:'repository LGPL VGA BIOS',qemuFirmware:'different SeaBIOS control'}});
    machine=machineFor({bios,vga,floppy,disk});
    report.mediaCopies={initial:{hddSha256:sha(machine.ata.mediaBytes()),
      floppySha256:sha(machine.chips.fdc1.drives[0].image)}};
    if(report.mediaCopies.initial.hddSha256!==report.inputHashes.pristineDisk||
       report.mediaCopies.initial.floppySha256!==FLOPPY.sha256)
      throw new Error('writable guest media differs from pristine input');
    const actual=runScenario({machine,now:()=>Date.now(),cpuUsage:prior=>process.cpuUsage(prior),
      state:()=>state(machine),readFiles:()=>sampleFiles(machine),
      screen:()=>passiveRows(machine),candidate:()=>candidateAtMain(machine,layout),
      bind:()=>bindAtMainCut(machine,layout),
      ready:(step,last)=>readyForScan({step,lastOfferedStep:last,
        ringEmpty:ringEmpty(machine),controllerStatus:controllerStatus(machine)}),
      offer:scan=>machine.keyIn(scan),step:()=>machine.step(),
      progress:progressReport=>writeProgress(progressPath,progressReport)});
    Object.assign(report,actual);
  }catch(error){
    first(report,bounded(error));
    if(error?.observation)report.failedObservation=error.observation;
  }
  if(machine){
    try{report.final??=state(machine);}catch(error){first(report,'final CPU: '+bounded(error));}
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
  if(process.argv.length!==5)throw new Error('usage: driver.mjs input.json report.json progress.json');
  run(...process.argv.slice(2));
}
