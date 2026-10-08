import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {ExperimentalI80386ATMachine,PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA} from '../../src/experimental/i80386-at-machine.js';
import {GEOMETRY,CWSDPMI,FIRST,buildMedia} from '../i80386-cwsdpmi-qemu-owned/media.mjs';
import {encode,readyForScan} from '../i80386-dos32a-owned/keyboard.mjs';
import {admitBoundImage} from '../i80386-cwsdpmi-at-owned/binding.mjs';
import {candidateAtMain,bindAtMainCut} from '../i80386-cwsdpmi-at-loaded-actual/cut.mjs';

const BIOS = {bytes:65536,sha256:'6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac'};
const VGA = {bytes:38400,sha256:'76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1'};
const FLOPPY = {bytes:1228800,sha256:'03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77'};
const DISK_BYTES = GEOMETRY.cylinders*GEOMETRY.heads*GEOMETRY.sectors*512;
const MAX_STEPS=120_000_000,MAX_WALL_MS=640_000;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const boundedText=error=>String(error?.message??error)
  .replace(/(?:\/[A-Za-z0-9._-]+)+/g,'[path]').slice(0,400);

function exact(path,limit,expected=null) {
  const fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try {
    const before=fs.fstatSync(fd);
    if(!before.isFile()||before.size>limit||before.size<1)
      throw new Error('private input shape');
    const bounded=Buffer.alloc(before.size+1);
    let count=0;
    while(count<bounded.length){
      const got=fs.readSync(fd,bounded,count,bounded.length-count,null);
      if(got===0)break;
      count+=got;
    }
    const bytes=bounded.subarray(0,count),after=fs.fstatSync(fd),pathStat=fs.lstatSync(path);
    if(!pathStat.isFile()||pathStat.isSymbolicLink()||
       before.dev!==after.dev||before.ino!==after.ino||
       before.size!==after.size||before.mtimeMs!==after.mtimeMs||
       pathStat.dev!==after.dev||pathStat.ino!==after.ino||
       count!==before.size)
      throw new Error('private input changed during read');
    const digest=sha(bytes);
    if(expected&&(bytes.length!==expected.bytes||digest!==expected.sha256))
      throw new Error('private input hash/size');
    return bytes;
  } finally {fs.closeSync(fd);}
}
function json(path,maximum) {
  const raw=exact(path,maximum);
  return JSON.parse(raw.toString('utf8'));
}
function hddCmos(g) {
  return [[0x19,47],[0x1b,g.cylinders&255],[0x1c,g.cylinders>>8],[0x1d,g.heads],
    [0x1e,0xff],[0x1f,0xff],[0x20,g.heads>8?0xc8:0xc0],[0x21,g.cylinders&255],
    [0x22,g.cylinders>>8],[0x23,g.sectors],[0x39,0]];
}
function machineFor({bios,vga,floppy,disk}) {
  const base=PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA;
  const cmos=hddCmos(GEOMETRY),replaced=new Set(cmos.map(([index])=>index));
  const config={...base,functionalInstructionCycles:6,
    regions:[...base.regions.filter(region=>!(region.kind==='rom'&&region.start===0xc0000)),
      {kind:'rom',start:0xc0000,end:0xc9fff}],
    chips:base.chips.map(chip=>chip.kind==='rtc'?{...chip,
      initialCmos:[...chip.initialCmos.filter(([index])=>
        index!==0x3d&&index!==0x12&&!replaced.has(index)),[0x3d,0x21],[0x12,0xf0],...cmos]}:chip)};
  const m=new ExperimentalI80386ATMachine(config,
    {ataImage:new Uint8Array(disk),ataGeometry:GEOMETRY});
  m.loadRom(bios,0xf0000);m.loadRom(bios,0xff0000);m.loadRom(vga,0xc0000);
  m.chips.fdc1.insert(0,new Uint8Array(floppy),
    {cylinders:80,heads:2,sectors:15,bytesPerSector:512});
  m.reset();
  return m;
}
// Source-backed VGA text-plane view: no VGA read, latch load or chip method.
export function passiveRows(machine) {
  const video=machine.vgaMemory,card=machine.chips?.vga1;
  if(!video||video.registerSource!==card||
     !(card.misc&2)||(card.gc[6]&1)||((card.gc[6]>>>2)&3)!==3||
     ![2,6].includes(card.seq[4])||(card.gc[5]&8)||card.crtc[1]!==79||
     !Number.isInteger(card.crtc[0x0c])||!Number.isInteger(card.crtc[0x0d]))
    return null;
  const plane=video.planes?.[0];
  if(!(plane instanceof Uint8Array)||plane.length!==65536)
    throw new Error('VGA text-plane shape');
  const lines=[];
  // Text character cells are words at CRTC start; the source VGA renderer's
  // odd/even path fetches each character from plane 0 at the even byte index.
  const start=(card.crtc[0x0c]<<8)|card.crtc[0x0d];
  for(let y=0;y<25;y++){
    let line='';
    for(let x=0;x<80;x++){
      const n=plane[((start+y*80+x)*2)&0xffff];
      line+=n>=32&&n<=126?String.fromCharCode(n):' ';
    }
    lines.push(line.replace(/\s+$/,''));
  }
  return lines;
}
const prompt=lines=>/^[A-Z]:\\>$/.test([...lines].reverse().find(line=>line.trim())?.trim()??'');
export const ringEmpty=machine=>(machine.mem[0x41a]|(machine.mem[0x41b]<<8))===
  (machine.mem[0x41c]|(machine.mem[0x41d]<<8));
export const controllerStatus=machine=>{
  const controller=machine._a20Controller;
  if(!Array.isArray(controller?.outputQueue)||
     !Number.isFinite(controller.inputBusyCyclesRemaining))
    throw new Error('8042 status source shape');
  return (controller.outputQueue.length?1:0)|
    (controller.inputBusyCyclesRemaining>0?2:0);
};
const hasSequence=(haystack,needle)=>{
  for(let at=0;at<=haystack.length-needle.length;at++)
    if(needle.every((value,index)=>value===haystack[at+index]))return true;
  return false;
};
const cpuCutState=cpu=>({cs:cpu.cs,eip:cpu.eip,eflags:cpu.eflags,
  cr0:cpu.cr0,cr2:cpu.cr2,cr3:cpu.cr3,cr4:cpu.cr4,
  csDescriptor:{...cpu.segmentCaches[1]},
  cpuProfile:cpu.cpuProfile,cycles:cpu.cycles,
  interruptShadow:cpu._interruptShadow,retainedRealCs:cpu._retainedRealCs});
function writeProgress(path,report) {
  const temp=path+'.pending';
  fs.writeFileSync(temp,JSON.stringify(report,null,2)+'\n');
  fs.renameSync(temp,path);
}
function first(report,text) {
  if(report.firstFailure===null)report.firstFailure=text;
  else (report.secondaryFailures??=[]).push(text);
}

export function run(inputPath,outputPath,progressPath) {
  const report={schema:'bw.cwsdpmi-owned.at-loaded-main-actual.v1',passed:false,
    scope:'AT 4 MiB FreeDOS compatibility-profile loaded-main byte identity only',
    firstFailure:null,stage:'setup',steps:0};
  let machine=null,previousStep=null,pristineDisk=null,pristineFloppy=null;
  try {
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
    report.mediaCopies={initial:{
      hddSha256:sha(Buffer.from(machine.ata.mediaBytes())),
      floppySha256:sha(machine.chips.fdc1.drives[0].image)}};
    if(report.mediaCopies.initial.hddSha256!==report.inputHashes.pristineDisk||
       report.mediaCopies.initial.floppySha256!==FLOPPY.sha256)
      throw new Error('writable guest media differs from pristine input');
    report.reset=cpuCutState(machine.cpu);
    report.stage='boot';
    const start=Date.now(),queue=[],injected=[],acceptedScans=[];
    const commandScans=encode(FIRST+'\r').map(event=>event.scan);
    let commandAccepted=false;
    let declined=false,menuKicks=0,lastOfferedStep=-5000,
      lastChange=0,previousScreen='',lastScreen=[],unsupportedScreens=0;
    writeProgress(progressPath,report);
    for(let step=0;step<MAX_STEPS;step++){
      report.steps=step;
      // This precedes screen reads, keyboard offers, chip-event polling and
      // the next ordinary step. It is a synchronous source-owned cut.
      if(commandAccepted&&candidateAtMain(machine,layout)){
        report.stage='protected-main-candidate';
        report.keyboard={declined,requested:[FIRST],injected,
          pending:queue.length,lastOfferedStep};
        report.candidate={step,previousReturnedStep:previousStep,
          cpu:cpuCutState(machine.cpu),a20Enabled:machine._a20Enabled,
          machineCycles:machine.cycles};
        writeProgress(progressPath,report);
        const observed=bindAtMainCut(machine,layout);
        report.loaded={binding:observed.binding,bytes:observed.loadedBytes,
          sha256:observed.loadedSha256,before:observed.before,after:observed.after};
        report.stage='loaded-main-bound';report.passed=true;
        break;
      }
      if(step%50000===0){
        if(Date.now()-start>MAX_WALL_MS){first(report,'AT wall bound before main');break;}
        const screen=passiveRows(machine);
        if(screen===null)unsupportedScreens++;
        else {
          lastScreen=screen;
          const visible=lastScreen.join('\n').replace(/\s/g,'');
          if(visible!==previousScreen){previousScreen=visible;lastChange=step;}
          if(!declined&&lastScreen.some(line=>/Do you want to proceed/i.test(line))){
            queue.push(...encode('n\r'));declined=true;
          }else if(!declined&&queue.length===0&&step-menuKicks>800000&&
            lastScreen.some(line=>/press \[ENTER\]|Select from Menu/i.test(line))){
            queue.push(...encode('\r'));menuKicks=step;
          }else if(declined&&report.stage==='boot'&&queue.length===0&&prompt(lastScreen)){
            queue.push(...encode(FIRST+'\r'));report.stage='command-queued';
          }
        }
        if(step%200000===0){
          report.progress={step,stage:report.stage,declined,queuedKeys:queue.length,
            acceptedKeys:injected.filter(event=>event.accepted).length,
            screen:lastScreen,lastChange,unsupportedScreens,cpu:cpuCutState(machine.cpu),
            machineCycles:machine.cycles};
          writeProgress(progressPath,report);
        }
      }
      if(queue.length&&readyForScan({step,lastOfferedStep,ringEmpty:ringEmpty(machine),
        controllerStatus:controllerStatus(machine)})){
        if(injected.length>=1000){first(report,'keyboard attempt cap');break;}
        const event=queue[0],accepted=machine.keyIn(event.scan);
        lastOfferedStep=step;
        injected.push({step,scan:event.scan,key:event.key,phase:event.phase,accepted});
        if(accepted){
          queue.shift();acceptedScans.push(event.scan);
          if(!commandAccepted)commandAccepted=hasSequence(acceptedScans,commandScans);
        }
      }
      const before={step,eip:machine.cpu.eip,cpuCycles:machine.cpu.cycles,
        machineCycles:machine.cycles};
      try {machine.step();}catch(error){first(report,'guest step: '+boundedText(error));break;}
      previousStep={...before,returnedEip:machine.cpu.eip,
        returnedCpuCycles:machine.cpu.cycles,
        returnedMachineCycles:machine.cycles};
      if(machine.cpu.shutdown){first(report,'CPU shutdown before main');break;}
    }
    report.keyboard={declined,requested:[FIRST],injected,
      pending:queue.length,lastOfferedStep,unsupportedScreens};
    if(!report.passed&&report.firstFailure===null)first(report,'main not reached within step bound');
    report.final=cpuCutState(machine.cpu);
    report.disk={initialSha256:report.inputHashes.pristineDisk,
      finalSha256:sha(Buffer.from(machine.ata.mediaBytes()))};
    report.mediaCopies.final={hddSha256:report.disk.finalSha256,
      floppySha256:sha(machine.chips.fdc1.drives[0].image),
      pristineHddSha256:sha(pristineDisk),
      pristineFloppySha256:sha(pristineFloppy)};
    report.memory={backingSha256:sha(machine.mem),
      pageClassSha256:sha(machine._page)};
  }catch(error){
    first(report,boundedText(error));
    if(error?.observation)report.failedObservation=error.observation;
    report.passed=false;
    if(machine){
      try {report.final=cpuCutState(machine.cpu);} catch(secondary){first(report,'final CPU: '+boundedText(secondary));}
      try {report.memory={backingSha256:sha(machine.mem),pageClassSha256:sha(machine._page)};}
      catch(secondary){first(report,'final memory: '+boundedText(secondary));}
      try {report.disk={finalSha256:sha(Buffer.from(machine.ata.mediaBytes()))};
        report.mediaCopies??={};
        report.mediaCopies.final={hddSha256:report.disk.finalSha256,
          floppySha256:sha(machine.chips.fdc1.drives[0].image),
          pristineHddSha256:pristineDisk?sha(pristineDisk):null,
          pristineFloppySha256:pristineFloppy?sha(pristineFloppy):null};}
      catch(secondary){first(report,'final disk: '+boundedText(secondary));}
    }
  }
  try {writeProgress(progressPath,report);} catch(error){first(report,'progress write: '+boundedText(error));report.passed=false;}
  fs.writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  if(!report.passed)process.exitCode=1;
  return report;
}

if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
  if(process.argv.length!==5)throw new Error('usage: driver.mjs input.json report.json progress.json');
  run(...process.argv.slice(2));
}
