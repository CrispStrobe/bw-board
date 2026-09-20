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
const hdd = readPinned('AT_HDD_IMAGE', EXPECTED_HDD_SHA256, 'Windows 3.0 / PC DOS 3.2 HDD image');
if (bios.bytes.length !== 0x10000 || vga.bytes.length !== 0x7e00 || hdd.bytes.length !== 21_411_840)
  throw new Error('external input byte length mismatch');
const stepLimit = process.env.AT_POST_STEPS === undefined ? DEFAULT_STEPS : Number(process.env.AT_POST_STEPS);
if (!Number.isInteger(stepLimit) || stepLimit < 1 || stepLimit > 500_000_000)
  throw new Error('AT_POST_STEPS must be an integer from 1 through 500000000');

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
const ataCommands = [];
const samples = [];
const instructionTrail = [];
const bootEntries = [];
let vgaOptionEntry = null;
const postContinue = {enabled: process.env.AT_POST_CONTINUE_F1 === '1', injected: null};
let refusal = null;
let stopReason = 'budget';
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
    if (event.dir === 'out' && event.port === 0x80 && postEvents.length < 256)
      postEvents.push({step: steps, cs: machine.cpu.cs, eip: machine.cpu.eip, value: event.value});
    if (event.dir === 'out' && event.port === 0x1f7 && ataCommands.length < 1024)
      ataCommands.push({step: steps, cs: machine.cpu.cs, eip: machine.cpu.eip,
        command: event.value, count: machine.ata.sectorCount, sector: machine.ata.sectorNumber,
        cylinder: machine.ata.cylinderLow | machine.ata.cylinderHigh << 8,
        head: machine.ata.driveHead});
  },
});
machine.loadRom(bios.bytes, 0xf0000);
machine.loadRom(bios.bytes);
machine.loadRom(vga.bytes, 0xc0000);
machine.reset();
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
for (; steps < stepLimit; steps++) {
  const before = {step: steps, cs: machine.cpu.cs, eip: machine.cpu.eip,
    ss: machine.cpu.ss, esp: machine.cpu.esp, cr0: machine.cpu.cr0 >>> 0};
  instructionTrail.push(before);
  if (instructionTrail.length > 256) instructionTrail.shift();
  if (vgaOptionEntry === null && machine.cpu.cs === 0xc000 && machine.cpu.eip === 3)
    vgaOptionEntry = {...before};
  if ((machine.cpu.cs === 0 && machine.cpu.eip === 0x7c00) ||
      (machine.cpu.cs === 0x07c0 && machine.cpu.eip === 0)) {
    bootEntries.push({...before, bytes: Array.from(machine.mem.slice(0x7c00, 0x7e00)),
      sha256: sha(machine.mem.slice(0x7c00, 0x7e00))});
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
    if (!(error instanceof UnsupportedI80386) && !(error instanceof I80386Fault)) throw error;
    const paging = !!(machine.cpu.cr0 & 0x80000000);
    refusal = {name: error.name, message: error.message, step: steps,
      cs: machine.cpu.cs, eip: machine.cpu.eip, pc: machine.cpu.pc,
      bytes: paging ? null : Array.from({length: 8}, (_, index) => {
        const physical = machine._decode386((machine.cpu.pc + index) >>> 0);
        return physical < machine.mem.length ? machine.mem[physical] : 0xff;
      })};
    stopReason = error instanceof UnsupportedI80386 ? 'cpu-unsupported' : 'architectural-fault-surfaced';
    break;
  }
  if (machine.cpu.shutdown) {
    stopReason = 'cpu-shutdown';
    break;
  }
  if (steps !== 0 && steps % 1_000_000 === 0) {
    const text = renderText().filter(line => line.trim() !== '');
    samples.push({step: steps, cs: machine.cpu.cs, eip: machine.cpu.eip,
      cr0: machine.cpu.cr0 >>> 0, lastLines: text.slice(-6)});
  }
}

const screenText = renderText();
const nonblankScreen = screenText.filter(line => line.trim() !== '');
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
    cmos: {driveTypes: cmos[0x12], floppyTypes: cmos[0x10], equipment: cmos[0x14], checksum},
  },
  reset, postEvents, postContinue, ataCommands, interrupts, interruptCounts,
  vgaOptionEntry, bootEntries, instructionTrail,
  final: {cs: machine.cpu.cs, eip: machine.cpu.eip, pc: machine.cpu.pc,
    cr0: machine.cpu.cr0 >>> 0, cr2: machine.cpu.cr2 >>> 0, cr3: machine.cpu.cr3 >>> 0,
    eflags: machine.cpu.eflags >>> 0, halted: machine.cpu.halted, shutdown: machine.cpu.shutdown},
  screenText, nonblankScreen, samples,
  vga: {state: machine.chips.vga1.getVideoState(),
    nonzeroByPlane: machine.vgaMemory.planes.map(plane => plane.reduce((sum, byte) => sum + (byte !== 0), 0))},
  hddOutputSha256: sha(machine.ata.mediaBytes()),
  executionRevision, sourceSha256,
};
for (const [file, before] of Object.entries(sourceSha256)) {
  if (sourceHash(file) !== before) throw new Error(`Windows run refused: executed source changed: ${file}`);
}
if (execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim() !== executionRevision)
  throw new Error('Windows run refused: HEAD changed during execution');
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (refusal || machine.cpu.shutdown) process.exitCode = 1;
