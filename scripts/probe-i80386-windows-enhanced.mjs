#!/usr/bin/env node
/* A media-neutral, read-only boot probe for an externally supplied Windows 3.1x disk. */
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import Machine, {PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA} from
  '../src/experimental/i80386-at-machine.js';
import {I80386Fault, UnsupportedI80386} from '../src/experimental/i80386.js';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceFiles = ['../src/experimental/i80386.js',
  '../src/experimental/i80386-at-machine.js', '../src/experimental/ata16.js',
  './probe-i80386-windows-enhanced.mjs'];
const sourceSha256 = Object.fromEntries(sourceFiles.map(file =>
  [file, hash(fs.readFileSync(new URL(file, import.meta.url)))]));
const executionRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: new URL('..', import.meta.url), encoding: 'utf8',
}).trim();
const required = name => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const readPinned = (pathName, hashName) => {
  const bytes = fs.readFileSync(required(pathName));
  const expected = required(hashName).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error(`${hashName} must be a SHA-256 digest`);
  const actual = hash(bytes);
  if (actual !== expected) throw new Error(`${pathName} SHA-256 mismatch: ${actual}`);
  return {bytes, sha256: actual};
};
const bios = readPinned('AT_BIOS_ROM', 'AT_BIOS_SHA256');
const vga = readPinned('VGA_BIOS_ROM', 'VGA_BIOS_SHA256');
const hdd = readPinned('AT_HDD_IMAGE', 'AT_HDD_SHA256');
const hddOutputPath = process.env.AT_HDD_OUTPUT ?? null;
if (bios.bytes.length !== 0x10000 || vga.bytes.length > 0x10000 || vga.bytes.length < 0x4000)
  throw new Error('expected a 64 KiB AT BIOS and a 16–64 KiB VGA option ROM');
const chs = required('AT_HDD_GEOMETRY').split(/[x,:]/).map(Number);
if (chs.length !== 3 || !chs.every(Number.isInteger) || chs[0] < 1 || chs[0] > 1024 ||
    chs[1] < 1 || chs[1] > 16 || chs[2] < 1 || chs[2] > 63 ||
    hdd.bytes.length !== chs[0] * chs[1] * chs[2] * 512)
  throw new Error('AT_HDD_GEOMETRY must be CHS (for example 615,4,17) matching image size');
const [cylinders, heads, sectors] = chs;
const cmosType = Number(process.env.AT_HDD_CMOS_TYPE ?? 47);
if (cmosType !== 2 && cmosType !== 47)
  throw new Error('AT_HDD_CMOS_TYPE must be 2 (IBM 615/4/17) or 47 (user geometry)');
if (cmosType === 2 && (cylinders !== 615 || heads !== 4 || sectors !== 17))
  throw new Error('IBM drive type 2 requires 615,4,17 geometry');
const limit = Number(process.env.AT_POST_STEPS ?? 1_000_000);
if (!Number.isInteger(limit) || limit < 1 || limit > 500_000_000)
  throw new Error('AT_POST_STEPS must be an integer from 1 to 500000000');
const progressEvery = Number(process.env.AT_PROGRESS_EVERY ?? 1_000_000);
if (!Number.isInteger(progressEvery) || progressEvery < 1)
  throw new Error('AT_PROGRESS_EVERY must be a positive integer');
const progressPath = process.env.AT_PROGRESS_OUTPUT ?? null;
const keyBytes = process.env.AT_KEY_SCRIPT ? fs.readFileSync(process.env.AT_KEY_SCRIPT) : null;
const keyScript = keyBytes ? JSON.parse(keyBytes) : [];
if (!Array.isArray(keyScript) || keyScript.some((event, index) =>
  !event || !Number.isInteger(event.step) || event.step < 0 || event.step >= limit ||
  !Number.isInteger(event.code) || event.code < 0 || event.code > 255 ||
  (index > 0 && event.step <= keyScript[index - 1].step)))
  throw new Error('AT_KEY_SCRIPT must be an ordered JSON array of {step, code} Set-1 events');
const hddOutputFd = hddOutputPath ? fs.openSync(hddOutputPath, 'wx') : null;

const profile = structuredClone(PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA);
profile.regions = profile.regions.map(region => region.kind === 'rom' && region.start === 0xc0000
  ? {...region, end: 0xc0000 + Math.ceil(vga.bytes.length / 0x1000) * 0x1000 - 1}
  : region);
const rtc = profile.chips.find(chip => chip.kind === 'rtc');
const cmos = new Uint8Array(0x40);
for (const [index, value] of rtc.initialCmos) cmos[index] = value;
cmos[0x10] = 0x20; // 1.2 MB drive A, as required by the IBM Rev1 POST.
cmos[0x12] = cmosType === 2 ? 0x20 : 0xf0;
cmos[0x14] = 0x01; // VGA.
// Bochs firmware reads this extended CMOS boot order: floppy, then HDD.
// IBM Rev1 ignores it, but omitting it leaves Bochs at "No bootable device".
cmos[0x3d] = 0x21;
if (cmosType === 47) {
  cmos[0x19] = 47;
  cmos[0x1b] = cylinders & 0xff;
  cmos[0x1c] = cylinders >> 8;
  cmos[0x1d] = heads;
  cmos[0x1e] = 0xff;
  cmos[0x1f] = 0xff;
  cmos[0x20] = 0xc0;
  cmos[0x21] = cylinders & 0xff;
  cmos[0x22] = cylinders >> 8;
  cmos[0x23] = sectors;
}
let checksum = 0;
for (let index = 0x10; index <= 0x2d; index++) checksum = (checksum + cmos[index]) & 0xffff;
cmos[0x2e] = checksum >> 8;
cmos[0x2f] = checksum & 0xff;
rtc.initialCmos = [...cmos.entries()].filter(([, value]) => value !== 0);

let steps = 0;
const milestones = {};
const post = [];
const ata = {count: 0, tail: []};
const kbc = {count: 0, tail: []};
const checkpoints = [];
const keyboard = [];
let nextKey = 0;
let machine;
machine = new Machine(profile, {
  ataImage: hdd.bytes,
  ataGeometry: {cylinders, heads, sectors},
  onPortAccess(event) {
    if (event.dir === 'out' && event.port === 0x80 && post.length < 128)
      post.push({step: steps, value: event.value});
    if (event.port >= 0x1f0 && event.port <= 0x1f7 || event.port === 0x3f6) {
      ata.count++;
      ata.tail.push({step: steps, dir: event.dir, port: event.port, value: event.value,
        status: machine.ata.status, error: machine.ata.error,
        count: machine.ata.sectorCount, sector: machine.ata.sectorNumber,
        cylinder: machine.ata.cylinderLow | machine.ata.cylinderHigh << 8,
        head: machine.ata.driveHead});
      if (ata.tail.length > 128) ata.tail.shift();
    }
    if (event.port === 0x60 || event.port === 0x64) {
      kbc.count++;
      kbc.tail.push({step: steps, dir: event.dir, port: event.port,
        value: event.value, cs: machine.cpu.cs, eip: machine.cpu.eip});
      if (kbc.tail.length > 128) kbc.tail.shift();
    }
  },
});
machine.loadRom(bios.bytes, 0xf0000);
machine.loadRom(bios.bytes);
machine.loadRom(vga.bytes, 0xc0000);
machine.reset();
const state = () => ({cs: machine.cpu.cs, eip: machine.cpu.eip, cr0: machine.cpu.cr0 >>> 0,
  cr3: machine.cpu.cr3 >>> 0, eflags: machine.cpu.eflags >>> 0});
let outcome = 'budget';
let refusal = null;
try {
  for (; steps < limit; steps++) {
    if (steps === keyScript[nextKey]?.step) {
      const event = keyScript[nextKey++];
      keyboard.push({...event, accepted: machine.keyIn(event.code)});
    }
    machine.step();
    const cr0 = machine.cpu.cr0 >>> 0;
    if ((cr0 & 1) && !milestones.protected) milestones.protected = {step: steps, ...state()};
    if ((cr0 & 0x80000000) && !milestones.paging) milestones.paging = {step: steps, ...state()};
    if ((machine.cpu.eflags & 0x20000) && !milestones.vm86)
      milestones.vm86 = {step: steps, ...state()};
    if (steps && steps % progressEvery === 0) {
      const text = Array.from({length: 25}, (_, row) =>
        String.fromCharCode(...machine.vgaMemory.planes[0].subarray(row * 160,
          row * 160 + 160).filter((_, index) => !(index & 1)))
          .replace(/\0/g, ' ').trimEnd());
      checkpoints.push({step: steps, ...state(), text: text.filter(Boolean).slice(-5)});
      if (progressPath) {
        const progress = {schema: 'bw.i80386-windows-enhanced-progress.v1',
          step: steps, last: checkpoints.at(-1), milestones,
          postTail: post.slice(-8), ataTail: ata.tail.slice(-8)};
        fs.writeFileSync(`${progressPath}.tmp`, `${JSON.stringify(progress, null, 2)}\n`);
        fs.renameSync(`${progressPath}.tmp`, progressPath);
      }
    }
    if (machine.cpu.shutdown) { outcome = 'shutdown'; break; }
  }
} catch (error) {
  if (!(error instanceof UnsupportedI80386) && !(error instanceof I80386Fault)) throw error;
  outcome = error instanceof UnsupportedI80386 ? 'unsupported' : 'architectural-fault-surfaced';
  refusal = {name: error.name, message: error.message, step: steps, ...state()};
}
const video = machine.chips.vga1.getVideoState();
const cpu = machine.cpu;
const codeBase = cpu.segmentCaches[1].base >>> 0;
const finalContext = {
  registers: Object.fromEntries(['eax', 'ebx', 'ecx', 'edx', 'esi', 'edi', 'ebp', 'esp',
    'cs', 'ds', 'es', 'ss', 'fs', 'gs'].map(name => [name, cpu[name] >>> 0])),
  codeBase, instructionBytes: Array.from({length: 32}, (_, index) =>
    machine._read386((codeBase + cpu.eip + index) >>> 0)),
  halted: cpu.halted, shutdown: cpu.shutdown,
  kbc: machine._a20Controller && {
    status: machine._a20Controller.readStatus(),
    commandByte: machine._a20Controller.commandByte,
    outputPort: machine._a20Controller.outputPort,
    outputQueue: machine._a20Controller.outputQueue,
    pendingCommand: machine._a20Controller.pendingCommand,
  },
};
const snapshot = process.env.AT_VGA_CAPTURE === '1' ? {
  planeBytes: machine.vgaMemory.planes.map(plane => plane.length),
  planeBase64: machine.vgaMemory.planes.map(plane => Buffer.from(plane).toString('base64')),
  registers: {
    misc: video.misc, seq: [...video.seq], gc: [...video.gc],
    crtc: [...video.crtc], attr: [...video.attr], dac: [...video.dac],
    dacMask: video.dacMask, dacWriteIndex: video.dacWriteIndex,
    dacReadIndex: video.dacReadIndex, inVRetrace: video.inVRetrace,
    frame: video.frame,
  },
} : null;
const report = {
  schema: 'bw.i80386-windows-enhanced-probe.v1', diagnosticOnly: true,
  windowsEnhancedAccepted: false, outcome, steps, stepLimit: limit, refusal,
  input: {bios: {bytes: bios.bytes.length, sha256: bios.sha256},
    vga: {bytes: vga.bytes.length, sha256: vga.sha256},
    hdd: {bytes: hdd.bytes.length, sha256: hdd.sha256,
      geometry: {cylinders, heads, sectors}, cmosType}},
  milestones, post, ata, kbc, checkpoints, keyboard,
  keyScriptSha256: keyBytes && hash(keyBytes), final: state(), finalContext,
  hddOutput: hddOutputPath ? {path: hddOutputPath,
    bytes: machine.ata.mediaBytes().length, sha256: hash(machine.ata.mediaBytes())} : null,
  executionRevision, sourceSha256,
  sourceUnchanged: sourceFiles.every(file =>
    hash(fs.readFileSync(new URL(file, import.meta.url))) === sourceSha256[file]),
  vga: {planeSha256: machine.vgaMemory.planes.map(hash),
    frame: video.frame, mode: {misc: video.misc, seq: [...video.seq], gc: [...video.gc]},
    snapshot},
};
if (hddOutputFd !== null) {
  if (!report.sourceUnchanged) throw new Error('Windows run refused: executed source changed');
  fs.writeFileSync(hddOutputFd, machine.ata.mediaBytes());
  fs.closeSync(hddOutputFd);
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
