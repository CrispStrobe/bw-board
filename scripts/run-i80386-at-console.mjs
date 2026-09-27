#!/usr/bin/env node
// External-media CLI for reproducible 386 AT console, VGA and input runs.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import Machine,{PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA} from
  '../src/experimental/i80386-at-machine.js';
import {I80386Fault,UnsupportedI80386} from '../src/experimental/i80386.js';
import {parseAtConsoleEvents} from './lib/i80386-at-console-events.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const required=name=>{if(!process.env[name])throw new Error(`${name} is required`);return process.env[name];};
const readPinned=(pathName,hashName)=>{
  const bytes=fs.readFileSync(required(pathName));
  const expected=required(hashName).toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(expected)||sha(bytes)!==expected)
    throw new Error(`${pathName} does not match ${hashName}`);
  return {bytes,sha256:expected};
};
const bios=readPinned('AT_BIOS_ROM','AT_BIOS_SHA256');
const vga=readPinned('VGA_BIOS_ROM','VGA_BIOS_SHA256');
const hdd=readPinned('AT_HDD_IMAGE','AT_HDD_SHA256');
if(bios.bytes.length!==0x10000||vga.bytes.length<0x4000||vga.bytes.length>0x10000)
  throw new Error('expected a 64 KiB AT BIOS and 16–64 KiB VGA ROM');
const geometry=required('AT_HDD_GEOMETRY').split(/[x,:]/).map(Number);
if(geometry.length!==3||!geometry.every(Number.isInteger)||geometry[0]<1||
    geometry[0]>1024||geometry[1]<1||geometry[1]>16||geometry[2]<1||
    geometry[2]>63||hdd.bytes.length!==geometry[0]*geometry[1]*geometry[2]*512)
  throw new Error('AT_HDD_GEOMETRY must match HDD bytes as cylinders,heads,sectors');
const [cylinders,heads,sectors]=geometry;
const cmosType=Number(process.env.AT_HDD_CMOS_TYPE??
  (cylinders===615&&heads===4&&sectors===17?2:47));
if(![2,47].includes(cmosType)||
    (cmosType===2&&(cylinders!==615||heads!==4||sectors!==17)))
  throw new Error('AT_HDD_CMOS_TYPE must be 2 for 615,4,17 or 47 for user geometry');
const stepsLimit=Number(process.env.AT_POST_STEPS??1_000_000);
if(!Number.isInteger(stepsLimit)||stepsLimit<1||stepsLimit>500_000_000)
  throw new Error('AT_POST_STEPS must be 1..500000000');
const eventBytes=process.env.AT_CONSOLE_EVENTS?fs.readFileSync(process.env.AT_CONSOLE_EVENTS):Buffer.from('[]');
const events=parseAtConsoleEvents(eventBytes,stepsLimit);
const mouseEnabled=process.env.AT_ENABLE_MOUSE==='1'||events.some(event=>event.type==='mouse');
const profile=structuredClone(PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA);
profile.a20.mouse=mouseEnabled;
profile.regions=profile.regions.map(region=>region.kind==='rom'&&region.start===0xc0000?
  {...region,end:0xc0000+Math.ceil(vga.bytes.length/0x1000)*0x1000-1}:region);
const rtc=profile.chips.find(chip=>chip.kind==='rtc');
const cmos=new Uint8Array(0x40);
for(const[index,value]of rtc.initialCmos)cmos[index]=value;
cmos[0x10]=0x20; // one 1.2 MB floppy, required by the IBM Rev1 POST
cmos[0x12]=cmosType===2?0x20:0xf0;cmos[0x14]=1;cmos[0x3d]=0x21;
if(cmosType===47){
  cmos[0x19]=47;cmos[0x1b]=cylinders&255;cmos[0x1c]=cylinders>>>8;
  cmos[0x1d]=heads;cmos[0x1e]=0xff;cmos[0x1f]=0xff;cmos[0x20]=0xc0;
  cmos[0x21]=cylinders&255;cmos[0x22]=cylinders>>>8;cmos[0x23]=sectors;
}
let checksum=0;for(let index=0x10;index<=0x2d;index++)checksum=(checksum+cmos[index])&0xffff;
cmos[0x2e]=checksum>>>8;cmos[0x2f]=checksum&255;
rtc.initialCmos=[...cmos.entries()].filter(([,value])=>value!==0);

const sourcePaths=['../src/at-ps2-mouse.js','../src/at-8042-a20.js',
  '../src/i8086-machine.js','../src/experimental/i80386.js',
  '../src/experimental/i80386-at-machine.js','./lib/i80386-at-console-events.mjs',
  './run-i80386-at-console.mjs'];
const sourceSha256=Object.fromEntries(sourcePaths.map(path=>
  [path,sha(fs.readFileSync(new URL(path,import.meta.url)))]));
const executionRevision=execFileSync('git',['rev-parse','HEAD'],{
  cwd:new URL('..',import.meta.url),encoding:'utf8'}).trim();
let steps=0,eventIndex=0,stop='budget',refusal=null;
const delivered=[],serial=[];
const machine=new Machine(profile,{
  ataImage:hdd.bytes,ataGeometry:{cylinders,heads,sectors},
  onSerial:byte=>{if(serial.length<65536)serial.push(byte&255);},
});
machine.loadRom(bios.bytes,0xf0000);
machine.loadRom(bios.bytes);
machine.loadRom(vga.bytes,0xc0000);
machine.reset();
for(;steps<stepsLimit;steps++) {
  while(events[eventIndex]?.step===steps) {
    const event=events[eventIndex++];
    const accepted=event.type==='key'?machine.keyIn(event.code):
      event.type==='serial'?machine.serialIn(event.code):machine.mouseIn(event);
    delivered.push({...event,accepted});
  }
  try { machine.step(); }
  catch(error) {
    if(!(error instanceof I80386Fault)&&!(error instanceof UnsupportedI80386)&&
        !error.message?.startsWith('AT 8042 '))throw error;
    stop=error instanceof UnsupportedI80386?'unsupported':
      error instanceof I80386Fault?'architectural-fault':'device-refusal';
    refusal={name:error.name,message:error.message,step:steps};break;
  }
  if(machine.cpu.shutdown){stop='shutdown';break;}
}
const columns=(machine._read(0x44a)|(machine._read(0x44b)<<8))||80;
const text=Array.from({length:25},(_,row)=>Array.from({length:Math.min(columns,160)},(_,col)=>
  String.fromCharCode(machine.vgaMemory.planes[0][(row*columns+col)*2]||32))
  .join('').trimEnd());
const planes=machine.vgaMemory.planes.map(plane=>Buffer.from(plane));
const video=machine.chips.vga1.getVideoState();
const vgaOutput=process.env.AT_CONSOLE_VGA_OUTPUT??null;
if(vgaOutput)fs.writeFileSync(vgaOutput,JSON.stringify({schema:'bw.i80386-vga-snapshot.v1',
  step:steps,registers:video,planeBase64:planes.map(plane=>plane.toString('base64'))})+'\n',{flag:'wx'});
const report={schema:'bw.i80386-at-console.v1',executionRevision,sourceSha256,
  inputs:{bios:bios.sha256,vga:vga.sha256,hdd:hdd.sha256,geometry,cmosType,
    events:sha(eventBytes),mouseEnabled},steps,stop,refusal,
  cpu:{cs:machine.cpu.cs,eip:machine.cpu.eip,cr0:machine.cpu.cr0>>>0,
    cr3:machine.cpu.cr3>>>0,eflags:machine.cpu.eflags>>>0},
  delivered,serial:{bytes:serial.length,text:Buffer.from(serial).toString('latin1')},
  textRam:text,vga:{registers:video,planeSha256:planes.map(sha),snapshotPath:vgaOutput}};
const output=JSON.stringify(report,null,2)+'\n';
if(process.env.AT_CONSOLE_REPORT)fs.writeFileSync(process.env.AT_CONSOLE_REPORT,output,{flag:'wx'});
else process.stdout.write(output);
