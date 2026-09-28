#!/usr/bin/env node
// External-media CLI for reproducible 386 AT console, VGA and input runs.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {resolve} from 'node:path';
import Machine,{PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA} from
  '../src/experimental/i80386-at-machine.js';
import {I80386Fault,UnsupportedI80386} from '../src/experimental/i80386.js';
import {parseAtConsoleEvents} from './lib/i80386-at-console-events.mjs';
import {parseDosboxAtConfig} from './lib/i80386-at-dosbox-config.mjs';
import {ansiRgbFrame,ansiTextFrame,decodeTerminalInput,flushTerminalEscape,
  makeTerminalInputState} from
  './lib/i80386-at-terminal.mjs';
import {renderObservedWindowsEga} from './lib/i80386-windows-vga-frame.mjs';
import {renderObservedWindowsVga480} from './lib/i80386-windows-vga-480-frame.mjs';
import {renderObservedDoomVga} from './lib/i80386-doom-vga-frame.mjs';
import {createI80386Code16Coverage} from '../src/experimental/i80386-code16-coverage.js';
import {createI80386Native32Census} from '../src/experimental/i80386-native32-census.js';
import {createI80386BroadBlockCensus} from '../src/experimental/i80386-broad-block-census.js';
import {createI80386Code16EventRunObserver} from '../src/experimental/i80386-code16-event-run-observer.js';
import {createI80386HotLoopLocator} from '../src/experimental/i80386-hot-loop-locator.js';
import {enableI80386Code16LoadExecution} from '../src/experimental/i80386-code16-load-exec.js';

const options={conf:process.env.AT_DOSBOX_CONF??null,hdd:process.env.AT_HDD_IMAGE??null,
  geometry:process.env.AT_HDD_GEOMETRY??null,live:process.env.AT_CONSOLE_LIVE==='1',
  nativeBlocks:process.env.AT_NATIVE_BLOCKS==='1',
  code16Loads:process.env.AT_CODE16_LOADS==='1',
  code16Wasm:process.env.AT_CODE16_WASM==='1',
  steps:process.env.AT_POST_STEPS??1_000_000};
for(let index=0;index<process.argv.length-2;index++) {
  const option=process.argv[index+2];
  if(option==='--help') {
    process.stdout.write('usage: run-i80386-at-console.mjs [--dosbox-conf FILE] [--hdd-image FILE --geometry C,H,S] [--steps N] [--live] [--native-blocks] [--code16-wasm]\n');
    process.exit(0);
  }
  if(option==='--live'){options.live=true;continue;}
  if(option==='--native-blocks'){options.nativeBlocks=true;continue;}
  if(option==='--code16-wasm'){options.code16Wasm=true;continue;}
  const value=process.argv[++index+2];
  if(!value)throw new Error(`${option} needs a value`);
  if(option==='--dosbox-conf')options.conf=value;
  else if(option==='--hdd-image')options.hdd=value;
  else if(option==='--geometry')options.geometry=value;
  else if(option==='--steps')options.steps=value;
  else throw new Error(`unknown option ${option}`);
}
const dosbox=options.conf?parseDosboxAtConfig(fs.readFileSync(options.conf,'utf8'),resolve(options.conf)):null;
if(!options.hdd)options.hdd=dosbox?.imagePath??null;
if(!options.geometry)options.geometry=dosbox?.geometry.join(',')??null;
if(!options.hdd||!options.geometry)throw new Error('provide an HDD image and geometry directly or in --dosbox-conf');

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const required=name=>{if(!process.env[name])throw new Error(`${name} is required`);return process.env[name];};
const readPinned=(pathName,hashName,pathOverride=null)=>{
  const bytes=fs.readFileSync(pathOverride??required(pathName));
  const expected=required(hashName).toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(expected)||sha(bytes)!==expected)
    throw new Error(`${pathName} does not match ${hashName}`);
  return {bytes,sha256:expected};
};
const bios=readPinned('AT_BIOS_ROM','AT_BIOS_SHA256');
const vga=readPinned('VGA_BIOS_ROM','VGA_BIOS_SHA256');
const hdd=readPinned('AT_HDD_IMAGE','AT_HDD_SHA256',options.hdd);
if(bios.bytes.length!==0x10000||vga.bytes.length<0x4000||vga.bytes.length>0x10000)
  throw new Error('expected a 64 KiB AT BIOS and 16–64 KiB VGA ROM');
const geometry=options.geometry.split(/[x,:]/).map(Number);
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
const stepsLimit=Number(options.steps);
const code16Coverage=process.env.AT_CODE16_COVERAGE==='1'?
  createI80386Code16Coverage():null;
const code16WasmDiagnostics=process.env.AT_CODE16_WASM_DIAGNOSTICS==='1';
const native32Census=process.env.AT_NATIVE32_CENSUS==='1'?
  createI80386Native32Census():null;
const broadBlockCensus=process.env.AT_BROAD_BLOCK_CENSUS==='1'?
  createI80386BroadBlockCensus({linkJcc:process.env.AT_BROAD_BLOCK_JCC_LINKS==='1',
    refusalOpcodes:process.env.AT_BROAD_BLOCK_REFUSAL_OPCODES==='1',
    selectedFormsPotential:process.env.AT_BROAD_BLOCK_SELECTED_FORMS==='1'}):null;
const code16EventObserver=process.env.AT_CODE16_EVENT_OBSERVER==='1'?
  createI80386Code16EventRunObserver():null;
const hotLoopLocator=process.env.AT_HOT_LOOP_LOCATOR==='1'?
  createI80386HotLoopLocator():null;
if(process.env.AT_BROAD_BLOCK_JCC_LINKS==='1'&&!broadBlockCensus)
  throw new Error('Jcc link census requires AT_BROAD_BLOCK_CENSUS=1');
if(process.env.AT_BROAD_BLOCK_REFUSAL_OPCODES==='1'&&!broadBlockCensus)
  throw new Error('refusal opcode census requires AT_BROAD_BLOCK_CENSUS=1');
if(process.env.AT_BROAD_BLOCK_SELECTED_FORMS==='1'&&!broadBlockCensus)
  throw new Error('selected-form census requires AT_BROAD_BLOCK_CENSUS=1');
const code16WasmFormCensus=process.env.AT_CODE16_WASM_FORM_CENSUS==='1';
const code16WasmBranchLinks=process.env.AT_CODE16_WASM_BRANCH_LINKS==='1';
const modeCpuProfile=process.env.AT_MODE_CPU_PROFILE==='1'?{
  schema:'bw.i80386-mode-cpu-profile.v1',intervalSteps:1024,
  modes:['real','protected16','vm86','protected32'],
  steps:[0,0,0,0],pureWindows:[0,0,0,0],
  pureUserMicroseconds:[0,0,0,0],pureSystemMicroseconds:[0,0,0,0],
  mixedWindows:0,mixedSteps:[0,0,0,0],
  mixedUserMicroseconds:0,mixedSystemMicroseconds:0,
  samples:0,transitions:0,
}:null;
if(code16Coverage&&(options.nativeBlocks||options.code16Wasm))
  throw new Error('code16 coverage requires ordinary single-step execution');
if(modeCpuProfile&&(options.nativeBlocks||options.code16Wasm||code16Coverage||options.code16Loads))
  throw new Error('mode CPU profile requires ordinary single-step execution');
if(native32Census&&(options.nativeBlocks||options.code16Wasm||
    options.code16Loads||code16Coverage||modeCpuProfile||options.live))
  throw new Error('native32 census requires noninteractive ordinary single-step execution');
if(broadBlockCensus&&(options.nativeBlocks||options.code16Wasm||options.code16Loads||
    options.live||native32Census||code16Coverage||modeCpuProfile))
  throw new Error('broad-block census requires noninteractive ordinary single-step execution');
if(hotLoopLocator&&(options.nativeBlocks||options.code16Wasm||options.code16Loads||
    options.live||native32Census||code16Coverage||modeCpuProfile||broadBlockCensus))
  throw new Error('hot-loop locator requires noninteractive ordinary single-step execution');
if(code16EventObserver&&(options.nativeBlocks||options.code16Wasm||options.code16Loads||
    options.live||native32Census||code16Coverage||modeCpuProfile||broadBlockCensus||
    hotLoopLocator))
  throw new Error('code16 event observer requires noninteractive ordinary single-step execution');
if(options.code16Wasm&&(options.nativeBlocks||options.code16Loads))
  throw new Error('code16 WASM is a separate opt-in dispatcher');
if(code16WasmDiagnostics&&!options.code16Wasm)
  throw new Error('code16 WASM diagnostics require AT_CODE16_WASM=1');
if(code16WasmFormCensus&&!code16WasmDiagnostics)
  throw new Error('code16 WASM form census requires diagnostics');
if(code16WasmBranchLinks&&!code16WasmDiagnostics)
  throw new Error('code16 WASM branch-link census requires diagnostics');
if(!Number.isInteger(stepsLimit)||stepsLimit<1||stepsLimit>500_000_000)
  throw new Error('AT_POST_STEPS must be 1..500000000');
const eventBytes=process.env.AT_CONSOLE_EVENTS?fs.readFileSync(process.env.AT_CONSOLE_EVENTS):Buffer.from('[]');
const events=parseAtConsoleEvents(eventBytes,stepsLimit);
const mouseEnabled=options.live||process.env.AT_ENABLE_MOUSE==='1'||
  events.some(event=>event.type==='mouse');
const profile=structuredClone(PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA);
profile.a20.mouse=mouseEnabled;
profile.regions=profile.regions.map(region=>region.kind==='rom'&&region.start===0xc0000?
  {...region,end:0xc0000+Math.ceil(vga.bytes.length/0x1000)*0x1000-1}:region);
const rtc=profile.chips.find(chip=>chip.kind==='rtc');
const cmos=new Uint8Array(0x40);
for(const[index,value]of rtc.initialCmos)cmos[index]=value;
cmos[0x10]=0x20; // one 1.2 MB floppy, required by the IBM Rev1 POST
cmos[0x12]=cmosType===2?0x20:0xf0;
// PC-compatible firmware/Windows probe CMOS equipment bit 2 for PS/2 mouse.
// Without it Windows never invokes the BIOS mouse service, even with an aux device.
cmos[0x14]=1|(mouseEnabled?4:0);cmos[0x3d]=0x21;
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
  '../src/experimental/i80386-at-machine.js','../src/experimental/ata16.js',
  '../src/experimental/i80386-code16-load-exec.js',
  '../src/experimental/i80386-code16-wasm-block.js',
  '../src/experimental/i80386-code16-window.js',
  '../src/experimental/i80386-code16-ea.js',
  '../src/experimental/i80386-code16-data-window.js',
  '../src/experimental/i80386-code16-form-census.js',
  '../src/experimental/i80386-code16-wasm.c',
  '../wasm/i80386-code16-wasm.wasm',
  '../src/experimental/i80386-native-dispatch.js',
  '../src/experimental/i80386-native-byte-block.js',
  '../src/experimental/i80386-native32-census.js',
  '../src/experimental/i80386-broad-block-census.js',
  '../src/experimental/i80386-code16-event-run-observer.js',
  '../src/experimental/i80386-hot-loop-locator.js',
  '../src/experimental/i80386-ram-bridge.js',
  '../src/experimental/i80386-block-spike.js',
  '../src/experimental/i80386-read-window.js',
  '../src/experimental/i80386-write-window.js',
  '../wasm/i80386-block-spike.wasm','../wasm/i80386-ram-bridge.wasm',
  '../src/experimental/vga-memory.js','../src/vga-card.js',
  './lib/i80386-at-console-events.mjs',
  './lib/i80386-at-dosbox-config.mjs','./lib/i80386-at-terminal.mjs',
  './lib/i80386-windows-vga-frame.mjs','./lib/i80386-windows-vga-480-frame.mjs',
  './lib/i80386-doom-vga-frame.mjs',
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
if(options.code16Loads)enableI80386Code16LoadExecution(machine);
const nativeDispatcher=options.nativeBlocks?
  await (await import('../src/experimental/i80386-native-dispatch.js'))
    .createI80386NativeDispatcher(machine):null;
const code16WasmDispatcher=options.code16Wasm?
  await (await import('../src/experimental/i80386-code16-wasm-block.js'))
    .createI80386Code16WasmDispatcher(machine,
      {diagnosticReasons:code16WasmDiagnostics,
        diagnosticForms:code16WasmFormCensus,
        diagnosticBranchLinks:code16WasmBranchLinks}):null;
machine.loadRom(bios.bytes,0xf0000);
machine.loadRom(bios.bytes);
machine.loadRom(vga.bytes,0xc0000);
machine.reset();
let profileWindowSteps=0,profileWindowMask=0,profileLastMode=-1;
let profileWindowModeSteps=[0,0,0,0];
let profileLastCpu=modeCpuProfile?process.cpuUsage():null;
const flushModeCpuProfile=()=>{
  if(!modeCpuProfile||!profileWindowSteps)return;
  const now=process.cpuUsage(),user=now.user-profileLastCpu.user,
    system=now.system-profileLastCpu.system;
  if((profileWindowMask&(profileWindowMask-1))===0){
    const mode=31-Math.clz32(profileWindowMask);
    modeCpuProfile.pureWindows[mode]++;
    modeCpuProfile.pureUserMicroseconds[mode]+=user;
    modeCpuProfile.pureSystemMicroseconds[mode]+=system;
  }else{
    modeCpuProfile.mixedWindows++;
    modeCpuProfile.mixedUserMicroseconds+=user;
    modeCpuProfile.mixedSystemMicroseconds+=system;
    for(let mode=0;mode<4;mode++)modeCpuProfile.mixedSteps[mode]+=profileWindowModeSteps[mode];
  }
  modeCpuProfile.samples++;
  profileLastCpu=now;profileWindowSteps=0;profileWindowMask=0;
  profileWindowModeSteps=[0,0,0,0];
};
const recordModeStep=mode=>{
  modeCpuProfile.steps[mode]++;
  profileWindowModeSteps[mode]++;
  profileWindowMask|=1<<mode;
  if(++profileWindowSteps===modeCpuProfile.intervalSteps)flushModeCpuProfile();
};
const restoreCode16Interrupts=code16Coverage?.attach(machine);
const restoreNative32Fetch=native32Census?.attach(machine);
const restoreBroadBlockFetch=broadBlockCensus?.attach(machine);
const restoreCode16EventObserver=code16EventObserver?.attach(machine);
const restoreHotLoopFetch=hotLoopLocator?.attach(machine);
const textRam=()=>{
  const columns=(machine._read(0x44a)|(machine._read(0x44b)<<8))||80;
  return Array.from({length:25},(_,row)=>Array.from({length:Math.min(columns,160)},(_,col)=>
    String.fromCharCode(machine.vgaMemory.planes[0][(row*columns+col)*2]||32))
    .join('').trimEnd());
};
const liveState=makeTerminalInputState(),pendingScan=[],pendingMouse=[];
let quit=false,lastDraw=0,lastInputAt=0,forceDraw=true;
const onTerminalData=chunk=>{
  lastInputAt=Date.now();
  const input=decodeTerminalInput(liveState,chunk);
  if(input.focusChanged===false) {
    pendingScan.length=0;
    if(liveState.buttons)pendingMouse.push({dx:0,dy:0,buttons:0});
    liveState.buttons=0;
  }
  if(liveState.focused){pendingScan.push(...input.scan);pendingMouse.push(...input.mouse);}
  quit||=input.quit;forceDraw||=input.refresh;
};
const offerLiveInput=()=>{
  if((steps&1023)!==0)return;
  if(liveState.pending==='\x1b'&&Date.now()-lastInputAt>50)
    pendingScan.push(...flushTerminalEscape(liveState));
  if(pendingScan.length) {
    try {
      if(machine.keyIn(pendingScan[0])) {
        delivered.push({step:steps,type:'live-key',code:pendingScan.shift(),accepted:true});
      }
    } catch(error) {
      if(!error.message?.startsWith('AT 8042 output queue full'))throw error;
    }
  }
  if(pendingMouse.length) {
    const event=pendingMouse.shift(),accepted=machine.mouseIn(event);
    delivered.push({step:steps,type:'live-mouse',...event,accepted});
  }
};
const runChunk=end=>{while(steps<end) {
  while(events[eventIndex]?.step===steps) {
    const event=events[eventIndex++];
    broadBlockCensus?.externalEvent();
    code16EventObserver?.externalEvent();
    hotLoopLocator?.externalEvent();
    const accepted=event.type==='key'?machine.keyIn(event.code):
      event.type==='serial'?machine.serialIn(event.code):machine.mouseIn(event);
    delivered.push({...event,accepted});
  }
  if(options.live)offerLiveInput();
  const nextEvent=events[eventIndex]?.step??end;
  const nextInput=options.live?(steps+1024&~1023):end;
  const budget=Math.min(end-steps,nextEvent-steps,nextInput-steps);
  const modeBeforeStep=modeCpuProfile?(!(machine.cpu.cr0&1)?0:
    (machine.cpu.eflags&0x20000)?2:
    machine.cpu.segmentCaches[1].default32?3:1):-1;
  if(modeCpuProfile&&profileLastMode!==modeBeforeStep){
    if(profileLastMode!==-1){modeCpuProfile.transitions++;flushModeCpuProfile();}
    profileLastMode=modeBeforeStep;
  }
  try {
    code16Coverage?.observe(machine);
    native32Census?.observe(machine);
    broadBlockCensus?.observe(machine);
    code16EventObserver?.observe(machine);
    hotLoopLocator?.observe(machine);
    if(nativeDispatcher)steps+=nativeDispatcher.run(Math.min(64,budget));
    else if(code16WasmDispatcher)steps+=code16WasmDispatcher.run(Math.min(64,budget));
    else {machine.step();code16Coverage?.retired(machine);
      native32Census?.retired(machine);steps++;
      broadBlockCensus?.retired(machine);
      code16EventObserver?.retired(machine);
      hotLoopLocator?.retired(machine);
      if(modeCpuProfile)recordModeStep(modeBeforeStep);}
  }
  catch(error) {
    broadBlockCensus?.aborted(machine);
    code16EventObserver?.aborted(machine);
    hotLoopLocator?.aborted(machine);
    if(!(error instanceof I80386Fault)&&!(error instanceof UnsupportedI80386)&&
        !error.message?.startsWith('AT 8042 '))throw error;
    stop=error instanceof UnsupportedI80386?'unsupported':
      error instanceof I80386Fault?'architectural-fault':'device-refusal';
    refusal={name:error.name,message:error.message,step:steps};break;
  }
  if(machine.cpu.shutdown){stop='shutdown';break;}
}};
const drawTerminal=()=>{
  const now=Date.now();if(!forceDraw&&now-lastDraw<250)return;
  lastDraw=now;forceDraw=false;
  const columns=Math.max(1,Math.min(80,(process.stdout.columns??80)-1));
  const rows=Math.max(1,Math.min(25,(process.stdout.rows??28)-2));
  liveState.columns=columns;liveState.rows=rows;
  const video=machine.chips.vga1.getVideoState();
  const registers={misc:video.misc,seq:Array.from(video.seq),gc:Array.from(video.gc),
    crtc:Array.from(video.crtc),attr:Array.from(video.attr),dac:Array.from(video.dac),
    dacMask:video.dacMask};
  const planesBase64=machine.vgaMemory.planes.map(plane=>Buffer.from(plane).toString('base64'));
  let frame=null;
  try{frame=renderObservedWindowsVga480({registers,planeBase64:planesBase64});}catch{}
  if(!frame)try{frame=renderObservedWindowsEga({registers,planeBase64:planesBase64});}catch{}
  if(!frame)try{frame=renderObservedDoomVga({...registers,
    planesBase64,dacBase64:Buffer.from(video.dac).toString('base64')});}catch{}
  const body=frame?ansiRgbFrame(frame,columns,rows):ansiTextFrame(textRam(),columns,rows);
  liveState.width=frame?.width??640;liveState.height=frame?.height??350;
  const header=`386 AT  step ${steps}/${stepsLimit}  ${frame?'VGA':'text RAM'}  Ctrl-] quit  Ctrl-L redraw`;
  process.stdout.write(`\x1b[H\x1b[2J${header.slice(0,columns)}\n${body}\x1b[0m`);
};
if(options.live) {
  if(!process.stdin.isTTY||!process.stdout.isTTY)
    throw new Error('--live requires an interactive terminal for raw keyboard and display');
  process.stdin.setRawMode(true);process.stdin.resume();
  process.stdin.on('data',onTerminalData);
  const onSignal=()=>{quit=true;};
  process.on('SIGINT',onSignal);process.on('SIGTERM',onSignal);
  try {
    process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[?1003h\x1b[?1006h\x1b[?1004h');
    drawTerminal();
    while(steps<stepsLimit&&stop==='budget'&&!quit) {
      runChunk(Math.min(steps+50_000,stepsLimit));
      drawTerminal();
      await new Promise(resolve=>setImmediate(resolve));
    }
    if(quit&&stop==='budget')stop='user-quit';
  } finally {
    process.off('SIGINT',onSignal);process.off('SIGTERM',onSignal);
    process.stdin.removeListener('data',onTerminalData);
    process.stdin.setRawMode(false);process.stdin.pause();
    process.stdout.write('\x1b[?1003l\x1b[?1006l\x1b[?1004l\x1b[?25h\x1b[?1049l');
  }
} else runChunk(stepsLimit);
flushModeCpuProfile();
restoreCode16Interrupts?.();
restoreNative32Fetch?.();
restoreBroadBlockFetch?.();
restoreCode16EventObserver?.();
restoreHotLoopFetch?.();
const text=textRam();
const planes=machine.vgaMemory.planes.map(plane=>Buffer.from(plane));
const video=machine.chips.vga1.getVideoState();
const serializableVideo={...video,seq:Array.from(video.seq),gc:Array.from(video.gc),
  crtc:Array.from(video.crtc),attr:Array.from(video.attr),dac:Array.from(video.dac)};
const vgaOutput=process.env.AT_CONSOLE_VGA_OUTPUT??null;
if(vgaOutput)fs.writeFileSync(vgaOutput,JSON.stringify({schema:'bw.i80386-vga-snapshot.v1',
  step:steps,registers:serializableVideo,
  planeBase64:planes.map(plane=>plane.toString('base64'))})+'\n',{flag:'wx'});
const report={schema:'bw.i80386-at-console.v1',executionRevision,sourceSha256,
  ...(code16Coverage?{code16Coverage:code16Coverage.report()}:{}),
  ...(native32Census?{native32Census:native32Census.report()}:{}),
  ...(broadBlockCensus?{broadBlockCensus:broadBlockCensus.report()}:{}),
  ...(code16EventObserver?{code16EventObserver:code16EventObserver.report()}:{}),
  ...(hotLoopLocator?{hotLoopLocator:hotLoopLocator.report()}:{}),
  inputs:{bios:bios.sha256,vga:vga.sha256,hdd:hdd.sha256,geometry,cmosType,
    nativeBlocks:options.nativeBlocks,
    code16Loads:options.code16Loads,
    code16Wasm:options.code16Wasm,
    cmosEquipment:cmos[0x14],
    events:sha(eventBytes),mouseEnabled,dosboxConfig:options.conf&&{
      sha256:sha(fs.readFileSync(options.conf)),parsed:dosbox}},steps,stop,refusal,
  cpu:{cs:machine.cpu.cs,eip:machine.cpu.eip,cr0:machine.cpu.cr0>>>0,
    cr3:machine.cpu.cr3>>>0,eflags:machine.cpu.eflags>>>0},
  nativeStats:nativeDispatcher?.stats??null,
  code16WasmStats:code16WasmDispatcher?.stats??null,
  ...(code16WasmDiagnostics?
    {code16WasmDiagnostics:code16WasmDispatcher.diagnostics}:{}),
  code16LoadExecutions:machine.code16LoadExecutions??0,
  ...(modeCpuProfile?{modeCpuProfile}:{}),
  delivered,serial:{bytes:serial.length,text:Buffer.from(serial).toString('latin1')},
  textRam:text,vga:{registers:serializableVideo,planeSha256:planes.map(sha),
    snapshotPath:vgaOutput}};
const output=JSON.stringify(report,null,2)+'\n';
if(process.env.AT_CONSOLE_REPORT)fs.writeFileSync(process.env.AT_CONSOLE_REPORT,output,{flag:'wx'});
else process.stdout.write(output);
