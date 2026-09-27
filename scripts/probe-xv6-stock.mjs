#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import Machine, {PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP} from '../src/experimental/i80386-at-machine.js';
import {IBM_TYPE1_GEOMETRY} from './lib/i80386-at-hdd-image.mjs';

const romPath = process.env.XV6_ROM ?? '/tmp/ATBIOS-REV1.rom';
const imagePath = process.env.XV6_IMG ?? '/tmp/xv6-stock-4m/xv6.img';
const slavePath = process.env.XV6_FS_IMG ?? path.join(path.dirname(imagePath), 'fs.img');
const kernelPath = process.env.XV6_KERNEL ?? path.join(path.dirname(imagePath), 'kernel');
const stepsLimit = Number(process.env.XV6_STEPS ?? 76_000_000);
const command = process.env.XV6_COMMAND ?? '';
const expectedSerial = process.env.XV6_EXPECT_SERIAL ?? '';
const rom = fs.readFileSync(romPath);
const raw = fs.readFileSync(imagePath);
const slave = fs.readFileSync(slavePath);
const image = new Uint8Array(IBM_TYPE1_GEOMETRY.cylinders * IBM_TYPE1_GEOMETRY.heads * IBM_TYPE1_GEOMETRY.sectors * 512);
image.set(raw);
let steps = 0;
let first32 = null;
const serial = [];
const interrupts = [];
const postBootInterrupts = [];
const lapicIdReads = [];
const milestones = {};
const userModeEntries = [];
const recentInstructions = [];
const inputSent = [];
let commandStarted = false;
const wanted = new Set(['main', 'userinit', 'scheduler', 'forkret', 'trapret', 'syscall', 'exec', 'iinit', 'initlog']);
const symbols = new Map();
for (const line of execFileSync('nm', ['-n', kernelPath], {encoding: 'utf8'}).split('\n')) {
  const match = line.match(/^([0-9a-f]+) [A-Za-z] (\S+)$/);
  if (match && wanted.has(match[2])) symbols.set(Number.parseInt(match[1], 16), match[2]);
}
const machine = new Machine(PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP, {
  ataImage: image,
  ataGeometry: IBM_TYPE1_GEOMETRY,
  ataSlaveImage: (() => { const media = new Uint8Array(image.length); media.set(slave); return media; })(),
  onPortAccess: event => {
    if (event.port === 0x1f0 && event.width === 32 && first32 === null) first32 = steps;
    if (event.dir === 'out' && event.port === 0x3f8) serial.push(event.value & 0xff);
  },
  onInterrupt: event => {
    const record = {step: steps, ...event};
    if (interrupts.length < 64) interrupts.push(record);
    if (first32 !== null && postBootInterrupts.length < 64) postBootInterrupts.push(record);
  },
});
machine.loadRom(rom, 0xf0000); machine.loadRom(rom); machine.reset();
const read386 = machine._read386.bind(machine);
machine._read386 = address => {
  if (address >= 0xfee00020 && address < 0xfee00024 && lapicIdReads.length < 32)
    lapicIdReads.push({step: steps, address, value: read386(address)});
  return read386(address);
};
for (; steps < stepsLimit; steps++) {
  if (command && !commandStarted && serial.at(-2) === 36 && serial.at(-1) === 32)
    commandStarted = true;
  if (commandStarted && inputSent.length < command.length && machine.chips.uart1.rxFifo.length === 0) {
    const byte = command.charCodeAt(inputSent.length);
    machine.serialIn(byte);
    inputSent.push({step: steps, byte});
  }
  const name = symbols.get(machine.cpu.eip);
  if (name && (machine.cpu.cs & 3) === 0) {
    const seen = milestones[name] ?? {count: 0, first: steps};
    seen.count++;
    seen.last = steps;
    milestones[name] = seen;
  }
  if ((machine.cpu.cs & 3) === 3 && userModeEntries.length < 16 &&
      (userModeEntries.length === 0 || userModeEntries.at(-1).cs !== machine.cpu.cs ||
       steps - userModeEntries.at(-1).step > 100_000))
    userModeEntries.push({step: steps, cs: machine.cpu.cs, eip: machine.cpu.eip});
  recentInstructions[steps % 32] = {step: steps, cs: machine.cpu.cs, eip: machine.cpu.eip};
  try {
    machine.step();
  } catch (error) {
    console.error(JSON.stringify({error: String(error), steps, milestones, userModeEntries,
      serial: Buffer.from(serial).toString('latin1'), inputSent,
      recentInstructions: [...recentInstructions].sort((a, b) => a.step - b.step),
      ata: {status: machine.ata?.status, command: machine.ata?.command,
        irqPending: machine.ata?._irqPending, irqOutput: machine.ata?._irqOutput}}, null, 2));
    throw error;
  }
}
const screen = Array.from({length: 25}, (_, row) => Array.from({length: 80}, (_, column) =>
  String.fromCharCode(machine._read(0xb8000 + (row * 80 + column) * 2) || 32)).join('').replace(/\s+$/, ''));
const receipt = {
  rom: {path: path.resolve(romPath), sha256: crypto.createHash('sha256').update(rom).digest('hex')},
  image: {path: path.resolve(imagePath), sha256: crypto.createHash('sha256').update(raw).digest('hex')},
  slaveImage: {path: path.resolve(slavePath), sha256: crypto.createHash('sha256').update(slave).digest('hex')},
  steps, first32, serial: Buffer.from(serial).toString('latin1'), inputSent,
  interrupts, postBootInterrupts,
  lapicIdReads, milestones, userModeEntries, screen,
  lapic: {svr: machine._lapic[0xf0 / 4], timer: machine._lapic[0x320 / 4], initialCount: machine._lapic[0x380 / 4]},
  ioapic: {id: machine._ioapic[0], version: machine._ioapic[1], ideLow: machine._ioapic[0x10 + 14 * 2], ideHigh: machine._ioapic[0x10 + 14 * 2 + 1], idePending: machine._apicIrq[14]},
  cpu: {cs: machine.cpu.cs, eip: machine.cpu.eip, eflags: machine.cpu.eflags, cr0: machine.cpu.cr0, cr3: machine.cpu.cr3, cr4: machine.cpu.cr4},
};
console.log(JSON.stringify(receipt, null, 2));
if (expectedSerial && !receipt.serial.includes(expectedSerial))
  throw new Error(`xv6 serial output did not contain expected text ${JSON.stringify(expectedSerial)}`);
