#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import ExperimentalI80386ATMachine, {
  PCAT80386_EXPERIMENTAL_4M_HDD,
} from '../src/experimental/i80386-at-machine.js';
import {I80386Fault, UnsupportedI80386} from '../src/experimental/i80386.js';
import {
  createI80386AtFat16Image,
  HDD_ROUNDTRIP_TEXT,
  IBM_TYPE1_GEOMETRY,
} from './lib/i80386-at-hdd-image.mjs';

const EXPECTED_ROM_SHA256 = '74e7b36b4ec0adc5ac3277a887579996c1d2aa755b9892ef3afe7485c10ce04f';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
const sourcePaths = [
  ...git('ls-files', 'src').split('\n').filter(file => file.endsWith('.js')),
  'scripts/lib/i80386-at-hdd-image.mjs',
  'scripts/run-i80386-at-hdd-roundtrip.mjs',
];
const executionRevision = git('rev-parse', 'HEAD');
execFileSync('git', ['diff', '--quiet', 'HEAD', '--', ...sourcePaths], {cwd: root});
const sourceSha256 = Object.fromEntries(sourcePaths.map(file =>
  [file, sha256(fs.readFileSync(path.join(root, file)))]));

const romPath = process.env.AT_BIOS_ROM;
if (!romPath) throw new Error('AT_BIOS_ROM must name the external IBM 5170 Rev1 ROM');
const rom = fs.readFileSync(romPath);
if (rom.length !== 0x10000 || sha256(rom) !== EXPECTED_ROM_SHA256)
  throw new Error('IBM 5170 Rev1 ROM identity mismatch');
const stepLimit = process.env.I80386_HDD_STEPS === undefined
  ? 80_000_000 : Number(process.env.I80386_HDD_STEPS);
if (!Number.isInteger(stepLimit) || stepLimit < 1 || stepLimit > 100_000_000)
  throw new Error('I80386_HDD_STEPS must be an integer from 1 through 100000000');

const inputImage = createI80386AtFat16Image();
const inputImageSha256 = sha256(inputImage);
const inputBootSectorSha256 = sha256(inputImage.subarray(0, 512));
let steps = 0;
const ataPorts = [];
let ataPortsTruncated = false;
const commandEvents = [];
let commandTraceOverflow = false;
const dataTransfers = {reads16: 0, writes16: 0, otherWidth: 0};
const interrupts = [];
const post = [];
let bootSector = null;
let marker = null;
let machine;
machine = new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M_HDD, {
  ataImage: inputImage,
  ataGeometry: IBM_TYPE1_GEOMETRY,
  onPortAccess(event) {
    if ((event.port >= 0x1f0 && event.port <= 0x1f7) || event.port === 0x3f6) {
      if (ataPorts.length < 4096) ataPorts.push({step: steps, cs: machine.cpu.cs,
        eip: machine.cpu.eip, ...event});
      else ataPortsTruncated = true;
      if (event.dir === 'out' && event.port === 0x1f7) {
        if (commandEvents.length < 256) commandEvents.push({step: steps,
          cs: machine.cpu.cs, eip: machine.cpu.eip, value: event.value});
        else commandTraceOverflow = true;
      }
      if (event.port === 0x1f0) {
        if (event.width !== 16) dataTransfers.otherWidth++;
        else if (event.dir === 'in') dataTransfers.reads16++;
        else dataTransfers.writes16++;
      }
    }
    if (event.dir === 'out' && event.port === 0x80) {
      if (post.length < 1024) post.push({step: steps, cs: machine.cpu.cs,
        eip: machine.cpu.eip, value: event.value});
      if (bootSector && (event.value === 0xa5 || event.value === 0xee))
        marker = {step: steps, cs: machine.cpu.cs, eip: machine.cpu.eip, value: event.value};
    }
  },
  onInterrupt(event) {
    if (interrupts.length < 1024) interrupts.push({step: steps, ...event});
  },
});
machine.loadRom(rom, 0xf0000);
machine.loadRom(rom);
machine.reset();
const reset = {cs: machine.cpu.cs, eip: machine.cpu.eip, pc: machine.cpu.pc,
  firstByte: machine.cpu.read(machine.cpu.pc)};

let outcome = 'budget';
let blocker = null;
try {
  for (; steps < stepLimit; steps++) {
    machine.step();
    if (!bootSector && ((machine.cpu.cs === 0 && machine.cpu.eip === 0x7c00) ||
        (machine.cpu.cs === 0x07c0 && machine.cpu.eip === 0))) {
      bootSector = {step: steps, cs: machine.cpu.cs, eip: machine.cpu.eip,
        sha256: sha256(machine.mem.slice(0x7c00, 0x7e00))};
    }
    if (marker) { outcome = marker.value === 0xa5 ? 'roundtrip-observed' : 'guest-failure'; break; }
    if (machine.cpu.shutdown) { outcome = 'shutdown'; break; }
  }
} catch (error) {
  if (error instanceof UnsupportedI80386) outcome = 'unsupported';
  else if (error instanceof I80386Fault) outcome = 'architectural-fault-surfaced';
  else throw error;
  blocker = {name: error.constructor.name, message: error.message,
    step: steps, cs: machine.cpu.cs, eip: machine.cpu.eip,
    vector: error.vector ?? null, errorCode: error.errorCode ?? null};
}

for (const [file, before] of Object.entries(sourceSha256))
  if (sha256(fs.readFileSync(path.join(root, file))) !== before)
    throw new Error(`386 HDD run refused: source changed during execution: ${file}`);
if (git('rev-parse', 'HEAD') !== executionRevision)
  throw new Error('386 HDD run refused: HEAD changed during execution');

const outputImage = machine.ata.mediaBytes();
const lastTwoSectors = outputImage.slice(-1024);
const commands = commandEvents.map(event => event.value);
const bootCommands = bootSector ? commandEvents.filter(event => event.step >= bootSector.step)
  .map(event => event.value) : [];
const expectedTail = new Uint8Array(1024);
expectedTail.set(Buffer.from(HDD_ROUNDTRIP_TEXT));
expectedTail.set([0xa5, 0x5a], 512);
const accepted = outcome === 'roundtrip-observed' && marker?.value === 0xa5 && !!bootSector &&
  bootSector.sha256 === inputBootSectorSha256 &&
  bootCommands.includes(0x30) && bootCommands.includes(0x20) &&
  lastTwoSectors.every((byte, index) => byte === expectedTail[index]) &&
  dataTransfers.reads16 >= 512 && dataTransfers.writes16 >= 512 &&
  dataTransfers.otherWidth === 0 && !commandTraceOverflow;

const report = {
  schema: 'astra.i80386-at-hdd-roundtrip.v1',
  accepted,
  diagnosticOnly: !accepted,
  fullBootAccepted: false,
  scope: 'IBM 5170 Rev1 BIOS fixed-disk setup and owned FAT16 boot-sector write/read round trip',
  outcome,
  steps,
  stepLimit,
  blocker,
  reset,
  bootSector,
  marker,
  commands,
  bootCommands,
  commandEvents,
  commandTraceOverflow,
  dataTransfers,
  ataPorts,
  ataPortsTruncated,
  interrupts,
  post,
  media: {
    geometry: IBM_TYPE1_GEOMETRY,
    bytes: inputImage.length,
    inputSha256: inputImageSha256,
    inputBootSectorSha256,
    outputSha256: sha256(outputImage),
    finalTwoSectorsSha256: sha256(lastTwoSectors),
    expectedText: HDD_ROUNDTRIP_TEXT,
  },
  final: {cs: machine.cpu.cs, eip: machine.cpu.eip, pc: machine.cpu.pc,
    halted: machine.cpu.halted, shutdown: machine.cpu.shutdown},
  input: {name: 'IBM 5170 Rev1 BIOS 1984-01-10', sha256: sha256(rom),
    distribution: 'external; ROM bytes are not stored by this repository'},
  executionRevision,
  sourceSha256,
  node: process.version,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!accepted) process.exitCode = 1;
