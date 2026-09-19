#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import ExperimentalI80386ATMachine, {
  PCAT80386_EXPERIMENTAL,
  PCAT80386_EXPERIMENTAL_4M,
} from '../src/experimental/i80386-at-machine.js';
import {I80386Fault, UnsupportedI80386} from '../src/experimental/i80386.js';

const EXPECTED_ROM_SHA256 = '74e7b36b4ec0adc5ac3277a887579996c1d2aa755b9892ef3afe7485c10ce04f';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8'}).trim();
const sourcePaths = [
  ...git('ls-files', 'src').split('\n').filter(file => file.endsWith('.js')),
  'scripts/run-i80386-at-bios-diagnostic.mjs',
];
const executionRevision = git('rev-parse', 'HEAD');
try {
  execFileSync('git', ['diff', '--quiet', 'HEAD', '--', ...sourcePaths], {cwd: root, stdio: 'ignore'});
} catch {
  throw new Error('386 AT diagnostic refused: an executed source path differs from HEAD');
}
const sourceSha256 = Object.fromEntries(sourcePaths.map(file => [file, sha256(fs.readFileSync(path.join(root, file)))]));

const romPath = process.env.AT_BIOS_ROM;
if (!romPath) throw new Error('AT_BIOS_ROM must name the external 64KiB IBM 5170 Rev1 ROM');
const rom = fs.readFileSync(romPath);
const romSha256 = sha256(rom);
if (rom.length !== 0x10000 || romSha256 !== EXPECTED_ROM_SHA256)
  throw new Error(`AT BIOS ROM identity mismatch: ${rom.length} bytes, SHA-256 ${romSha256}`);
const stepLimit = process.env.I80386_AT_STEPS === undefined ? 2_000_000 : Number(process.env.I80386_AT_STEPS);
if (!Number.isInteger(stepLimit) || stepLimit < 1 || stepLimit > 20_000_000)
  throw new Error('I80386_AT_STEPS must be an integer from 1 through 20000000');
const profileName = process.env.I80386_AT_PROFILE ?? 'bounded';
const profile = profileName === 'bounded' ? PCAT80386_EXPERIMENTAL
  : profileName === '4m' ? PCAT80386_EXPERIMENTAL_4M
    : null;
if (!profile) throw new Error("I80386_AT_PROFILE must be 'bounded' or '4m'");

let steps = 0;
const post = [];
const interrupts = [];
const machine = new ExperimentalI80386ATMachine(profile, {
  onPortAccess(event) {
    if (event.port === 0x80 && event.dir === 'out' && post.length < 512)
      post.push({step: steps, cs: machine.cpu.cs, eip: machine.cpu.eip, value: event.value});
  },
  onInterrupt(event) {
    if (interrupts.length < 128) interrupts.push({step: steps, ...event});
  },
});
machine.loadRom(rom, 0xf0000);
machine.loadRom(rom);
machine.reset();
const reset = {cs: machine.cpu.cs, eip: machine.cpu.eip, pc: machine.cpu.pc,
  a20Enabled: machine.a20Enabled, firstByte: machine.cpu.read(machine.cpu.pc)};

let outcome = 'budget';
let blocker = null;
try {
  for (; steps < stepLimit; steps++) {
    machine.step();
    if (machine.cpu.shutdown) { outcome = 'shutdown'; break; }
  }
} catch (error) {
  if (error instanceof UnsupportedI80386) outcome = 'unsupported';
  else if (error instanceof I80386Fault) outcome = 'architectural-fault-surfaced';
  else throw error;
  blocker = {name: error.constructor.name, message: error.message,
    vector: error.vector ?? null, errorCode: error.errorCode ?? null};
}

for (const [file, before] of Object.entries(sourceSha256)) {
  if (sha256(fs.readFileSync(path.join(root, file))) !== before)
    throw new Error(`386 AT diagnostic refused: executed source changed during execution: ${file}`);
}
if (git('rev-parse', 'HEAD') !== executionRevision)
  throw new Error('386 AT diagnostic refused: HEAD changed during execution');

const report = {
  schema: 'astra.i80386-at-bios-diagnostic.v1',
  accepted: false,
  fullBootAccepted: false,
  diagnosticOnly: true,
  scope: 'bounded genuine-reset IBM 5170 Rev1 BIOS progression on the experimental 386 AT adapter',
  profile: {name: profileName, installedRamBytes: profileName === '4m' ? 4 << 20 : 1152 << 10},
  outcome,
  stepLimit,
  steps,
  blocker,
  reset,
  final: {cs: machine.cpu.cs, eip: machine.cpu.eip, pc: machine.cpu.pc,
    halted: machine.cpu.halted, shutdown: machine.cpu.shutdown, a20Enabled: machine.a20Enabled},
  post,
  interrupts,
  input: {name: 'IBM 5170 Rev1 BIOS 1984-01-10', bytes: rom.length,
    sha256: romSha256, expectedSha256: EXPECTED_ROM_SHA256,
    distribution: 'external; ROM bytes are not stored by this repository'},
  executionRevision,
  sourceSha256,
  node: process.version,
};
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
