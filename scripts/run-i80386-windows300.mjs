#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import ExperimentalI80386ATMachine,
  {PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA} from '../src/experimental/i80386-at-machine.js';
import {I80386Fault, UnsupportedI80386} from '../src/experimental/i80386.js';

const EXPECTED_BIOS_SHA256 = '74e7b36b4ec0adc5ac3277a887579996c1d2aa755b9892ef3afe7485c10ce04f';
const EXPECTED_VGA_SHA256 = '90f59d96821517d6bfac2b24eab96eb875e13ae164e8e0008ac93ae558bc6a9a';
const EXPECTED_HDD_SHA256 = '127d214b6c4ff2520c95063e00028547cf287a22e56c0c7a8d550af08486f1aa';
const HDD_GEOMETRY = Object.freeze({cylinders: 615, heads: 4, sectors: 17});
const DEFAULT_STEPS = 150_000_000;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceHash = file => sha(fs.readFileSync(path.join(root, file)));
const sourcePaths = [
  'src/i8086-machine.js', 'src/i8086.js', 'src/i8086-ram-words.js',
  'src/experimental/i80286-protected.js', 'src/experimental/i80386.js',
  'src/experimental/i80386-at-machine.js', 'src/experimental/ata16.js',
  'src/experimental/vga-memory.js', 'src/vga-card.js', 'src/at-8042-a20.js',
  'src/at-system-control.js', 'src/i8254.js', 'src/i8259.js', 'src/i8237.js',
  'src/mc146818.js', 'src/upd765.js', 'scripts/run-i80386-windows300.mjs',
];

const executionRevision = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
execFileSync('git', ['diff', '--quiet', 'HEAD', '--', ...sourcePaths], {cwd: root});
const sourceSha256 = Object.fromEntries(sourcePaths.map(file => [file, sourceHash(file)]));

const readPinned = (envName, expectedHash, description) => {
  const file = process.env[envName];
  if (!file) throw new Error(`${envName} must name the external ${description}`);
  const bytes = fs.readFileSync(file);
  const actual = sha(bytes);
  if (actual !== expectedHash)
    throw new Error(`${description} SHA-256 mismatch: expected ${expectedHash}, got ${actual}`);
  return {file, bytes, sha256: actual};
};

const bios = readPinned('AT_BIOS_ROM', EXPECTED_BIOS_SHA256, 'IBM 5170 Rev1 BIOS');
const vga = readPinned('VGA_BIOS_ROM', EXPECTED_VGA_SHA256, 'SeaVGABIOS ROM');
const expectedHdd = process.env.AT_HDD_EXPECTED_SHA256 ?? EXPECTED_HDD_SHA256;
if (!/^[0-9a-f]{64}$/.test(expectedHdd)) throw new Error('AT_HDD_EXPECTED_SHA256 must be lowercase SHA-256');
const hdd = readPinned('AT_HDD_IMAGE', expectedHdd, 'Windows 3.0 / PC DOS 3.2 HDD image');
const parentReportPath = process.env.AT_HDD_PARENT_REPORT ?? null;
if(expectedHdd!==EXPECTED_HDD_SHA256&&!parentReportPath)
  throw new Error('derived HDD input requires AT_HDD_PARENT_REPORT');
const parentReportBytes = parentReportPath && fs.readFileSync(parentReportPath);
const parentReportSha256 = parentReportBytes && sha(parentReportBytes);
const parentReport = parentReportBytes && JSON.parse(parentReportBytes);
if(parentReport&&(parentReport.schema!=='astra.i80386-windows300-diagnostic.v1'||
    parentReport.hddOutputSha256!==hdd.sha256))
  throw new Error('derived HDD parent report does not produce the supplied image');
const hddOutputPath = process.env.AT_HDD_OUTPUT ?? null;
if (bios.bytes.length !== 0x10000 || vga.bytes.length !== 0x7e00 || hdd.bytes.length !== 21_411_840)
  throw new Error('external input byte length mismatch');
const stepLimit = process.env.AT_POST_STEPS === undefined ? DEFAULT_STEPS : Number(process.env.AT_POST_STEPS);
if (!Number.isInteger(stepLimit) || stepLimit < 1 || stepLimit > 500_000_000)
  throw new Error('AT_POST_STEPS must be an integer from 1 through 500000000');
const traceStart = process.env.AT_TRACE_START === undefined ? null : Number(process.env.AT_TRACE_START);
const traceEnd = process.env.AT_TRACE_END === undefined ? null : Number(process.env.AT_TRACE_END);
if ((traceStart === null) !== (traceEnd === null) ||
    (traceStart !== null && (!Number.isInteger(traceStart) || !Number.isInteger(traceEnd) ||
      traceStart < 0 || traceEnd <= traceStart || traceEnd - traceStart > 100_000)))
  throw new Error('AT_TRACE_START/END must define a positive window of at most 100000 instructions');
const enterStep = process.env.AT_WINDOWS_ENTER_STEP === undefined
  ? null : Number(process.env.AT_WINDOWS_ENTER_STEP);
if (enterStep !== null && (!Number.isInteger(enterStep) || enterStep < 1 ||
    enterStep + 10_000_000 >= stepLimit))
  throw new Error('AT_WINDOWS_ENTER_STEP must leave 10000000 instructions for observed response');
const keyScriptPath = process.env.AT_WINDOWS_KEY_SCRIPT ?? null;
if (enterStep !== null && keyScriptPath) throw new Error('choose AT_WINDOWS_ENTER_STEP or AT_WINDOWS_KEY_SCRIPT');
const keyScriptBytes = keyScriptPath ? fs.readFileSync(keyScriptPath) : null;
const keyScriptSha256 = keyScriptBytes && sha(keyScriptBytes);
const keyScript = keyScriptBytes && JSON.parse(keyScriptBytes);
if(keyScriptPath&&(!keyScript||typeof keyScript!=='object'))throw new Error('invalid Windows key script');
const scan = {alt:0x38,ctrl:0x1d,shift:0x2a,enter:0x1c,space:0x39,'.':0x34,'\\':0x2b,';':0x27,
  '0':0x0b,'1':0x02,'2':0x03,'3':0x04,'4':0x05,'5':0x06,'6':0x07,'7':0x08,'8':0x09,'9':0x0a,
  a:0x1e,b:0x30,c:0x2e,d:0x20,e:0x12,f:0x21,g:0x22,h:0x23,i:0x17,j:0x24,k:0x25,l:0x26,
  m:0x32,n:0x31,o:0x18,p:0x19,q:0x10,r:0x13,s:0x1f,t:0x14,u:0x16,v:0x2f,w:0x11,x:0x2d,y:0x15,z:0x2c};
const keyEvents = [];
const emitStroke = (step,key,shift=false) => {
  if(!Object.hasOwn(scan,key))throw new Error(`unsupported key '${key}'`);
  const code=scan[key];
  if(shift)keyEvents.push({step,code:scan.shift});
  keyEvents.push({step:step+100,code},{step:step+200,code:code|0x80});
  if(shift)keyEvents.push({step:step+300,code:scan.shift|0x80});
};
if (keyScript) {
  if(keyScript.schema!=='astra.windows-key-script.v1'||!Array.isArray(keyScript.actions)||
      keyScript.actions.length===0)
    throw new Error('invalid Windows key script');
  for(const action of keyScript.actions){
    if(!Number.isInteger(action.step)||action.step<1)throw new Error('key action step must be positive');
    if(action.kind==='key')emitStroke(action.step,action.key);
    else if(action.kind==='chord'){
      const keys=action.keys; if(!Array.isArray(keys)||keys.length<2)throw new Error('invalid chord');
      if(keys.some(key=>!Object.hasOwn(scan,key)))throw new Error('unsupported chord key');
      let at=action.step; for(const key of keys.slice(0,-1))keyEvents.push({step:at+=100,code:scan[key]});
      const code=scan[keys.at(-1)]; keyEvents.push({step:at+=100,code},{step:at+=100,code:code|0x80});
      for(const key of keys.slice(0,-1).reverse())keyEvents.push({step:at+=100,code:scan[key]|0x80});
    } else if(action.kind==='text'){
      if(typeof action.value!=='string'||action.value.length===0)throw new Error('key text must be nonempty');
      let at=action.step; const interval=action.interval??1000;
      if(!Number.isInteger(interval)||interval<400)throw new Error('key text interval must be an integer >=400');
      for(const char of action.value){const lower=char.toLowerCase(),shift=char!==lower||char===':';
        emitStroke(at,char===':'?';':char===' '?'space':lower,shift); at+=interval;}
    } else throw new Error(`unsupported key action '${action.kind}'`);
  }
  keyEvents.sort((a,b)=>a.step-b.step);
  if(keyEvents.some((event,index)=>event.step>=stepLimit||(index&&event.step<=keyEvents[index-1].step))||
      keyEvents.at(-1)?.step+10_000_000>=stepLimit)
    throw new Error('key events must be unique and precede the instruction limit');
}
const hddOutputFd = hddOutputPath ? fs.openSync(hddOutputPath,'wx') : null;

// Clone the VGA board profile with an AT type-2 HDD and a configured but empty
// 1.2MB drive A. The IBM Rev1 POST minimum-configuration test requires at
// least one diskette drive in CMOS even when the machine boots from drive C.
const windowsProfile = structuredClone(PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA);
const rtc = windowsProfile.chips.find(chip => chip.kind === 'rtc');
const cmos = new Uint8Array(0x40);
for (const [index, value] of rtc.initialCmos) cmos[index] = value;
cmos[0x10] = 0x20;
cmos[0x12] = 0x20;
cmos[0x14] = 0x01;
let checksum = 0;
for (let index = 0x10; index <= 0x2d; index++) checksum = (checksum + cmos[index]) & 0xffff;
cmos[0x2e] = checksum >>> 8;
cmos[0x2f] = checksum & 0xff;
rtc.initialCmos = [...cmos.entries()].filter(([index, value]) =>
  value !== 0);

let steps = 0;
const postEvents = [];
const interrupts = [];
const interruptCounts = {};
const ataCommands = {count: 0, tail: []};
const ataStatus = {count: 0, tail: []};
const ataTaskFileWrites = {count: 0, tail: []};
const dosInterrupts = {scope: 'heuristic real-mode IVT entry and matching SS:SP/CS:IP return; nested same-vector calls omitted',
  int13: {count: 0, tail: []}, int24: {count: 0, tail: []}};
const controllerPorts = [];
const samples = [];
const instructionTrail = [];
const instructionWindow = [];
let instructionTrailNext = 0;
const bootEntries = [];
let vgaOptionEntry = null;
let bootFailureBoundary = null;
const modeTransitions = {count: 0, first: [], tail: []};
let modeTransitionTailNext = 0;
const postContinue = {enabled: process.env.AT_POST_CONTINUE_F1 === '1', injected: null};
let refusal = null;
let stopReason = 'budget';
const keyboardAction = {kind: keyScript ? 'source-bound-script' : 'set1-enter', requestedStep: enterStep,
  script: keyScript&&{sha256:keyScriptSha256,actions:keyScript.actions},
  events: [], beforeVga: null, afterVga: null};
let keyEventIndex=0;
let machine;
machine = new ExperimentalI80386ATMachine(windowsProfile, {
  ataImage: hdd.bytes,
  ataGeometry: HDD_GEOMETRY,
  onInterrupt: event => {
    const key = `${event.source}:${event.vector}`;
    interruptCounts[key] = (interruptCounts[key] ?? 0) + 1;
    interrupts.push({step: steps, cs: machine.cpu.cs, eip: machine.cpu.eip, ...event});
    if (interrupts.length > 256) interrupts.shift();
  },
  onPortAccess: event => {
    if (event.port === 0x60 || event.port === 0x64) {
      controllerPorts.push({step: steps, cs: machine.cpu.cs, eip: machine.cpu.eip, ...event});
      if (controllerPorts.length > 256) controllerPorts.shift();
    }
    if (event.dir === 'out' && event.port === 0x80) {
      postEvents.push({step: steps, cs: machine.cpu.cs, eip: machine.cpu.eip, value: event.value});
      if (postEvents.length > 256) postEvents.shift();
    }
    if (event.dir === 'out' && event.port === 0x1f7) {
      ataCommands.count++;
      ataCommands.tail.push({step: steps, cs: machine.cpu.cs, eip: machine.cpu.eip,
        command: event.value, phase: 'after-command-dispatch', taskFileAfterDispatch: {
          count: machine.ata.sectorCount, sector: machine.ata.sectorNumber,
          cylinder: machine.ata.cylinderLow | machine.ata.cylinderHigh << 8,
          head: machine.ata.driveHead,
        }});
      if (ataCommands.tail.length > 256) ataCommands.tail.shift();
    }
    if (event.dir === 'out' && event.port >= 0x1f1 && event.port <= 0x1f6) {
      ataTaskFileWrites.count++;
      ataTaskFileWrites.tail.push({step: steps, cs: machine.cpu.cs, eip: machine.cpu.eip,
        port: event.port, value: event.value});
      if (ataTaskFileWrites.tail.length > 256) ataTaskFileWrites.tail.shift();
    }
    if (event.dir === 'in' && (event.port === 0x1f7 || event.port === 0x3f6)) {
      ataStatus.count++;
      ataStatus.tail.push({step: steps, cs: machine.cpu.cs, eip: machine.cpu.eip,
        port: event.port, value: event.value, error: machine.ata.error,
        taskFile: {count: machine.ata.sectorCount, sector: machine.ata.sectorNumber,
          cylinder: machine.ata.cylinderLow | machine.ata.cylinderHigh << 8,
          head: machine.ata.driveHead},
        pic1: machine.chips.pic1.getState(), pic2: machine.chips.pic2.getState()});
      if (ataStatus.tail.length > 256) ataStatus.tail.shift();
    }
  },
});
machine.loadRom(bios.bytes, 0xf0000);
machine.loadRom(bios.bytes);
machine.loadRom(vga.bytes, 0xc0000);
machine.reset();
let previousCr0 = machine.cpu.cr0 >>> 0;
const reset = {cs: machine.cpu.cs, eip: machine.cpu.eip, pc: machine.cpu.pc,
  firstByte: machine.cpu.read(machine.cpu.pc)};
if (reset.cs !== 0xf000 || reset.eip !== 0xfff0 || reset.pc !== 0xfffffff0)
  throw new Error(`80386 reset entry mismatch: ${JSON.stringify(reset)}`);

const renderText = () => {
  const columns = (machine._read(0x44a) | machine._read(0x44b) << 8) || 80;
  return Array.from({length: 25}, (_, row) => Array.from({length: columns}, (_, column) =>
    String.fromCharCode(machine.vgaMemory.planes[0][(row * columns + column) * 2] || 0x20))
    .join('').replace(/\s+$/, ''));
};
const captureVga = () => {
  const state = machine.chips.vga1.getVideoState();
  const planes = machine.vgaMemory.planes.map(plane => Buffer.from(plane));
  return {
    phase: 'after-step',
    planeBytes: planes.map(plane => plane.length),
    planeSha256: planes.map(sha),
    planeBase64: planes.map(plane => plane.toString('base64')),
    registers: {
      misc: state.misc,
      seq: Array.from(state.seq),
      gc: Array.from(state.gc),
      crtc: Array.from(state.crtc),
      attr: Array.from(state.attr),
      dac: Array.from(state.dac),
      dacMask: state.dacMask,
      dacWriteIndex: state.dacWriteIndex,
      dacReadIndex: state.dacReadIndex,
      inVRetrace: state.inVRetrace,
      frame: state.frame,
    },
  };
};
const physicalBytes = (pc, cr0, length = 8) => {
  if (cr0 & 0x80000000) return null;
  return Array.from({length}, (_, index) => {
    const physical = machine._decode386((pc + index) >>> 0);
    return physical < machine.mem.length ? machine.mem[physical] : 0xff;
  });
};
const peekPhysical = address => machine.mem[machine._decode386(address >>> 0)] ?? 0xff;
const ivtTarget = vector => ({
  eip: peekPhysical(vector * 4) | peekPhysical(vector * 4 + 1) << 8,
  cs: peekPhysical(vector * 4 + 2) | peekPhysical(vector * 4 + 3) << 8,
});
const activeDosInterrupts = new Map();
const traceDosInterrupt = (name, vector, before) => {
  const trace = dosInterrupts[name];
  const active = activeDosInterrupts.get(name);
  if (active && !(machine.cpu.cr0 & 1) && before.ss === active.returnSs &&
      machine.cpu.sp === active.returnSp && before.cs === active.returnCs &&
      before.eip === active.returnIp) {
    trace.count++;
    trace.tail.push({...active, returnStep: steps, returnEax: before.eax,
      returnFlags: before.eflags, carry: !!(before.eflags & 1)});
    if (trace.tail.length > 64) trace.tail.shift();
    activeDosInterrupts.delete(name);
  }
  if ((machine.cpu.cr0 & 1) || activeDosInterrupts.has(name)) return;
  const target = ivtTarget(vector);
  if (before.cs !== target.cs || before.eip !== target.eip) return;
  const stack = (machine.cpu.segmentCaches[2].base + machine.cpu.sp) >>> 0;
  activeDosInterrupts.set(name, {entryStep: steps, vector, ...target,
    entryEax: before.eax, entryEdx: before.edx, entrySs: before.ss,
    entrySp: machine.cpu.sp, returnSs: before.ss, returnSp: (machine.cpu.sp + 6) & 0xffff,
    returnIp: peekPhysical(stack) | peekPhysical(stack + 1) << 8,
    returnCs: peekPhysical(stack + 2) | peekPhysical(stack + 3) << 8,
    savedFlags: peekPhysical(stack + 4) | peekPhysical(stack + 5) << 8});
};
for (; steps < stepLimit; steps++) {
  const before = {step: steps, cs: machine.cpu.cs, eip: machine.cpu.eip,
    ss: machine.cpu.ss, esp: machine.cpu.esp, eax: machine.cpu.eax, ebx: machine.cpu.ebx,
    ecx: machine.cpu.ecx, edx: machine.cpu.edx, esi: machine.cpu.esi, edi: machine.cpu.edi,
    ebp: machine.cpu.ebp, eflags: machine.cpu.eflags, cr0: machine.cpu.cr0 >>> 0,
    pc: machine.cpu.pc};
  if (enterStep !== null && steps === enterStep) {
    keyboardAction.beforeVga = captureVga();
    keyboardAction.events.push({step: steps, code: 0x1c, accepted: machine.keyIn(0x1c)});
  }
  if (enterStep !== null && steps === enterStep + 2_000)
    keyboardAction.events.push({step: steps, code: 0x9c, accepted: machine.keyIn(0x9c)});
  if (enterStep !== null && steps === enterStep + 10_000_000)
    keyboardAction.afterVga = captureVga();
  if(keyScript&&keyEventIndex===0&&steps===keyEvents[0]?.step)keyboardAction.beforeVga=captureVga();
  while(keyEventIndex<keyEvents.length&&steps===keyEvents[keyEventIndex].step){
    const event=keyEvents[keyEventIndex++];
    keyboardAction.events.push({...event,accepted:machine.keyIn(event.code)});
  }
  if(keyScript&&keyEventIndex===keyEvents.length&&keyboardAction.afterVga===null&&
      steps===keyEvents.at(-1).step+10_000_000)keyboardAction.afterVga=captureVga();
  if (traceStart !== null && steps >= traceStart && steps < traceEnd) {
    instructionWindow.push({...before,
      bytes: physicalBytes(machine.cpu.pc, machine.cpu.cr0 >>> 0),
      ata: {status: machine.ata.status, error: machine.ata.error,
        count: machine.ata.sectorCount, sector: machine.ata.sectorNumber,
        cylinder: machine.ata.cylinderLow | machine.ata.cylinderHigh << 8,
        head: machine.ata.driveHead, intersectorRemaining: machine.ata._intersectorRemaining,
        irqPending: machine.ata._irqPending, irqOutput: machine.ata._irqOutput},
      pic1: machine.chips.pic1.getState(), pic2: machine.chips.pic2.getState(),
      pit: machine.chips.pit1.getState()});
  }
  traceDosInterrupt('int13', 0x13, before);
  traceDosInterrupt('int24', 0x24, before);
  if (instructionTrail.length < 256) instructionTrail.push(before);
  else {
    instructionTrail[instructionTrailNext] = before;
    instructionTrailNext = (instructionTrailNext + 1) & 255;
  }
  if (vgaOptionEntry === null && machine.cpu.cs === 0xc000 && machine.cpu.eip === 3)
    vgaOptionEntry = {...before};
  if ((machine.cpu.cs === 0 && machine.cpu.eip === 0x7c00) ||
      (machine.cpu.cs === 0x07c0 && machine.cpu.eip === 0)) {
    if (bootEntries.length < 8) bootEntries.push({...before,
      firstBytes: Array.from(machine.mem.slice(0x7c00, 0x7c10)),
      sha256: sha(machine.mem.slice(0x7c00, 0x7e00))});
  }
  if (bootFailureBoundary === null && machine.cpu.cs === 0 && machine.cpu.eip === 0x7cd5) {
    const orderedTrail = instructionTrail.length < 256 ? [...instructionTrail] : [
      ...instructionTrail.slice(instructionTrailNext), ...instructionTrail.slice(0, instructionTrailNext),
    ];
    bootFailureBoundary = {...before, eax: machine.cpu.eax, ebx: machine.cpu.ebx,
      ecx: machine.cpu.ecx, edx: machine.cpu.edx, esi: machine.cpu.esi, edi: machine.cpu.edi,
      eflags: machine.cpu.eflags, trail: orderedTrail};
  }
  if (postContinue.enabled && postContinue.injected === null && machine.cpu.cs === 0xf000 &&
      machine.cpu.eip >= 0x2fdd && machine.cpu.eip <= 0x300d) {
    const stack = Array.from({length: 16}, (_, index) =>
      machine._read(((machine.cpu.ss << 4) + machine.cpu.sp + index) & 0xfffff));
    if (machine.keyIn(0x3b))
      postContinue.injected = {step: steps, cs: machine.cpu.cs, eip: machine.cpu.eip,
        ss: machine.cpu.ss, sp: machine.cpu.sp, stack,
        bda: Array.from({length: 0x90}, (_, index) => machine._read(0x400 + index))};
  }
  try {
    machine.step();
  } catch (error) {
    const deviceRefusal = error instanceof Error &&
      (error.message.startsWith('AT 8042 ') || error.message.startsWith('MC146818 '));
    if (!(error instanceof UnsupportedI80386) && !(error instanceof I80386Fault) && !deviceRefusal)
      throw error;
    const paging = !!(machine.cpu.cr0 & 0x80000000);
    refusal = {name: error.name, message: error.message, step: steps,
      cs: machine.cpu.cs, eip: machine.cpu.eip, pc: machine.cpu.pc,
      bytes: paging ? null : Array.from({length: 8}, (_, index) => {
        const physical = machine._decode386((machine.cpu.pc + index) >>> 0);
        return physical < machine.mem.length ? machine.mem[physical] : 0xff;
      })};
    stopReason = error instanceof UnsupportedI80386 ? 'cpu-unsupported' :
      error instanceof I80386Fault ? 'architectural-fault-surfaced' : 'host-device-refusal';
    break;
  }
  if ((machine.cpu.cr0 >>> 0) !== previousCr0) {
    const event = {step: steps, before: previousCr0, after: machine.cpu.cr0 >>> 0,
      cs: machine.cpu.cs, eip: machine.cpu.eip, pc: machine.cpu.pc,
      bytes: physicalBytes(machine.cpu.pc, machine.cpu.cr0 >>> 0)};
    modeTransitions.count++;
    if (modeTransitions.first.length < 64) modeTransitions.first.push(event);
    if (modeTransitions.tail.length < 256) modeTransitions.tail.push(event);
    else {
      modeTransitions.tail[modeTransitionTailNext] = event;
      modeTransitionTailNext = (modeTransitionTailNext + 1) & 255;
    }
    previousCr0 = machine.cpu.cr0 >>> 0;
  }
  if (machine.cpu.shutdown) {
    stopReason = 'cpu-shutdown';
    break;
  }
  if (steps !== 0 && steps % 1_000_000 === 0) {
    const text = renderText().filter(line => line.trim() !== '');
    samples.push({step: steps, cs: machine.cpu.cs, eip: machine.cpu.eip,
      cr0: machine.cpu.cr0 >>> 0, modeTransitionCount: modeTransitions.count,
      bytes: physicalBytes(machine.cpu.pc, machine.cpu.cr0 >>> 0), lastLines: text.slice(-6)});
    if (process.env.AT_PROGRESS_OUTPUT) {
      const progress = {schema: 'astra.i80386-windows300-progress.v1', executionRevision,
        step: steps, cpu: before, modeTransitionCount: modeTransitions.count,
        lastLines: text.slice(-6), vga: captureVga()};
      const temporary = `${process.env.AT_PROGRESS_OUTPUT}.tmp`;
      fs.writeFileSync(temporary, `${JSON.stringify(progress, null, 2)}\n`);
      fs.renameSync(temporary, process.env.AT_PROGRESS_OUTPUT);
    }
  }
}

const screenText = renderText();
const nonblankScreen = screenText.filter(line => line.trim() !== '');
if (modeTransitions.tail.length === 256 && modeTransitionTailNext !== 0)
  modeTransitions.tail = [...modeTransitions.tail.slice(modeTransitionTailNext),
    ...modeTransitions.tail.slice(0, modeTransitionTailNext)];
const report = {
  schema: 'astra.i80386-windows300-diagnostic.v1',
  scope: 'bounded unchanged PC DOS 3.2 and Windows 3.0 HDD boot diagnostic',
  diagnosticOnly: true,
  windowsBootAccepted: false,
  stepLimit, steps, stopReason, refusal,
  input: {
    bios: {bytes: bios.bytes.length, sha256: bios.sha256},
    vgaRom: {bytes: vga.bytes.length, sha256: vga.sha256},
    hdd: {bytes: hdd.bytes.length, sha256: hdd.sha256, geometry: HDD_GEOMETRY},
    hddProvenance: expectedHdd===EXPECTED_HDD_SHA256 ? {kind:'pinned-original'} :
      {kind:'derived-clone',parentReportSha256},
    cmos: {driveTypes: cmos[0x12], floppyTypes: cmos[0x10], equipment: cmos[0x14], checksum},
  },
  reset, postEvents, postContinue, ataCommands, ataStatus, ataTaskFileWrites, dosInterrupts,
  controllerPorts, interrupts, interruptCounts, keyboardAction,
  vgaOptionEntry, bootEntries, bootFailureBoundary, modeTransitions,
  instructionTrail: instructionTrail.length < 256 ? instructionTrail : [
    ...instructionTrail.slice(instructionTrailNext), ...instructionTrail.slice(0, instructionTrailNext),
  ],
  instructionWindow: {start: traceStart, end: traceEnd, entries: instructionWindow},
  final: {cs: machine.cpu.cs, eip: machine.cpu.eip, pc: machine.cpu.pc,
    cr0: machine.cpu.cr0 >>> 0, cr2: machine.cpu.cr2 >>> 0, cr3: machine.cpu.cr3 >>> 0,
    eflags: machine.cpu.eflags >>> 0, halted: machine.cpu.halted, shutdown: machine.cpu.shutdown},
  screenText, nonblankScreen, samples,
  vga: {snapshot: captureVga(),
    nonzeroByPlane: machine.vgaMemory.planes.map(plane => plane.reduce((sum, byte) => sum + (byte !== 0), 0))},
  hddOutputSha256: sha(machine.ata.mediaBytes()),
  executionRevision, sourceSha256,
};
for (const [file, before] of Object.entries(sourceSha256)) {
  if (sourceHash(file) !== before) throw new Error(`Windows run refused: executed source changed: ${file}`);
}
if (execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim() !== executionRevision)
  throw new Error('Windows run refused: HEAD changed during execution');
if(keyScriptPath&&sha(fs.readFileSync(keyScriptPath))!==keyScriptSha256)
  throw new Error('Windows run refused: key script changed during execution');
if(parentReportPath&&sha(fs.readFileSync(parentReportPath))!==parentReportSha256)
  throw new Error('Windows run refused: parent report changed during execution');
if(hddOutputFd!==null){
  fs.writeFileSync(hddOutputFd,machine.ata.mediaBytes());
  fs.closeSync(hddOutputFd);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (refusal || machine.cpu.shutdown) process.exitCode = 1;
