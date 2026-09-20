#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import ExperimentalI80386ATMachine, {
  PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA,
} from '../src/experimental/i80386-at-machine.js';
import {I80386Fault, UnsupportedI80386} from '../src/experimental/i80386.js';

const SYSTEM_ROM_SHA256 = '74e7b36b4ec0adc5ac3277a887579996c1d2aa755b9892ef3afe7485c10ce04f';
const VGA_ROM_SHA256 = '90f59d96821517d6bfac2b24eab96eb875e13ae164e8e0008ac93ae558bc6a9a';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
const sourcePaths = [
  ...git('ls-files', 'src').split('\n').filter(file => file.endsWith('.js')),
  'scripts/run-i80386-at-vga-bios.mjs',
];
const executionRevision = git('rev-parse', 'HEAD');
execFileSync('git', ['diff', '--quiet', 'HEAD', '--', ...sourcePaths], {cwd: root});
const sourceSha256 = Object.fromEntries(sourcePaths.map(file =>
  [file, sha256(fs.readFileSync(path.join(root, file)))]));

const readInput = (environment, expected, bytes) => {
  const file = process.env[environment];
  if (!file) throw new Error(`${environment} is required`);
  const value = fs.readFileSync(file);
  if (value.length !== bytes || sha256(value) !== expected)
    throw new Error(`${environment} identity mismatch`);
  return {file, value};
};
const systemRom = readInput('AT_BIOS_ROM', SYSTEM_ROM_SHA256, 0x10000);
const vgaRom = readInput('VGA_BIOS_ROM', VGA_ROM_SHA256, 0x7e00);
const stepLimit = Number(process.env.AT_VGA_STEPS ?? 5_000_000);
if (!Number.isInteger(stepLimit) || stepLimit < 1 || stepLimit > 20_000_000)
  throw new Error('AT_VGA_STEPS must be an integer from 1 through 20000000');

let steps = 0;
const vgaPorts = [];
let guestMarker = null;
const machine = new ExperimentalI80386ATMachine(
  PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA,
  {onPortAccess(event) {
    if (event.port >= 0x3c0 && event.port <= 0x3df && vgaPorts.length < 4096)
      vgaPorts.push({step: steps, cs: machine.cpu.cs, eip: machine.cpu.eip, ...event});
    if (guestStarted && event.dir === 'out' && event.port === 0x80 &&
        (event.value === 0xa5 || event.value === 0xee))
      guestMarker = {step: steps, cs: machine.cpu.cs, eip: machine.cpu.eip, value: event.value};
  }},
);
machine.loadRom(systemRom.value, 0xf0000);
machine.loadRom(systemRom.value);
machine.loadRom(vgaRom.value, 0xc0000);
machine.reset();

let optionEntry = null;
let optionInstructions = 0;
let firmwareReturn = null;
let int10Vector = null;
let guestStarted = false;
let blocker = null;
let outcome = 'budget';
try {
  for (; steps < stepLimit; steps++) {
    const before = {cs: machine.cpu.cs, eip: machine.cpu.eip, pc: machine.cpu.pc};
    if (!optionEntry && before.cs === 0xc000) optionEntry = {step: steps, ...before};
    if (before.cs === 0xc000) optionInstructions++;
    machine.step();
    if (!guestStarted && optionEntry && optionInstructions > 0 && before.cs === 0xc000 && machine.cpu.cs === 0xf000) {
      firmwareReturn = {step: steps, from: before, cs: machine.cpu.cs, eip: machine.cpu.eip};
      int10Vector = {ip: machine._read(0x40), cs: machine._read(0x42)};
      int10Vector.ip |= machine._read(0x41) << 8;
      int10Vector.cs |= machine._read(0x43) << 8;
      const guest = [
        0xb8, 0x13, 0x00, 0xcd, 0x10,
        0xb8, 0x00, 0xa0, 0x8e, 0xc0, 0x31, 0xff,
        0xb0, 0x5a, 0xaa, 0xb0, 0xa5, 0xaa,
        0x26, 0xa0, 0x00, 0x00, 0x3c, 0x5a, 0x75, 0x0f,
        0x26, 0xa0, 0x01, 0x00, 0x3c, 0xa5, 0x75, 0x05,
        0xb0, 0xa5, 0xe6, 0x80, 0xf4,
        0xb0, 0xee, 0xe6, 0x80, 0xf4,
      ];
      guest.forEach((value, index) => machine._write(0x500 + index, value));
      machine.cpu.cr0 = 0;
      machine.cpu.eflags = 2;
      machine.cpu._loadSeg(1, 0);
      machine.cpu._loadSeg(3, 0);
      machine.cpu._loadSeg(0, 0);
      machine.cpu._loadSeg(2, 0);
      machine.cpu.eip = 0x500;
      machine.cpu.esp = 0x7c00;
      guestStarted = true;
    }
    if (guestMarker) {
      outcome = guestMarker.value === 0xa5 ? 'int10-vram-roundtrip' : 'guest-failure';
      break;
    }
    if (machine.cpu.shutdown) { outcome = 'shutdown'; break; }
  }
} catch (error) {
  if (!(error instanceof UnsupportedI80386) && !(error instanceof I80386Fault) &&
      (!(error instanceof Error) || (!error.message.startsWith('AT 8042 ') &&
        !error.message.startsWith('MC146818 ')))) throw error;
  outcome = error instanceof UnsupportedI80386 ? 'cpu-unsupported' :
    error instanceof I80386Fault ? 'architectural-fault-surfaced' : 'host-device-refusal';
  blocker = {name: error.name, message: error.message, step: steps,
    cs: machine.cpu.cs, eip: machine.cpu.eip, pc: machine.cpu.pc};
}

for (const [file, before] of Object.entries(sourceSha256))
  if (sha256(fs.readFileSync(path.join(root, file))) !== before)
    throw new Error(`VGA BIOS run refused: source changed during execution: ${file}`);
if (git('rev-parse', 'HEAD') !== executionRevision)
  throw new Error('VGA BIOS run refused: HEAD changed during execution');

const optionVgaPorts = optionEntry ? vgaPorts.filter(event => event.step >= optionEntry.step &&
  (!firmwareReturn || event.step <= firmwareReturn.step)) : [];
const guestVgaPorts = firmwareReturn ? vgaPorts.filter(event => event.step > firmwareReturn.step) : [];
const accepted = outcome === 'int10-vram-roundtrip' && !!optionEntry && !!firmwareReturn &&
  optionInstructions > 0 && optionVgaPorts.length > 0 && guestVgaPorts.length > 0 &&
  guestMarker?.value === 0xa5;
const report = {
  schema: 'astra.i80386-at-vga-bios-diagnostic.v1',
  accepted,
  diagnosticOnly: true,
  fullBootAccepted: false,
  scope: 'external SeaVGABIOS option-ROM entry, VGA port activity, and return to IBM AT firmware',
  outcome,
  steps,
  stepLimit,
  blocker,
  optionEntry,
  optionInstructions,
  firmwareReturn,
  int10Vector,
  guestStarted,
  guestMarker,
  vgaPorts,
  optionVgaPorts,
  guestVgaPorts,
  videoState: machine.chips.vga1.getVideoState(),
  inputs: {
    systemRom: {bytes: systemRom.value.length, sha256: sha256(systemRom.value)},
    vgaRom: {bytes: vgaRom.value.length, sha256: sha256(vgaRom.value)},
  },
  executionRevision,
  sourceSha256,
  node: process.version,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!accepted) process.exitCode = 1;
