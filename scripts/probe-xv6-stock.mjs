#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import Machine, {PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP,
  PCAT80386_EXPERIMENTAL_15M_HDD_XV6_SMP} from '../src/experimental/i80386-at-machine.js';
import {IBM_TYPE1_GEOMETRY} from './lib/i80386-at-hdd-image.mjs';

const firmware = process.env.XV6_FIRMWARE ?? 'ibm';
if (!['ibm', 'bochs'].includes(firmware)) throw new Error('XV6_FIRMWARE must be ibm or bochs');
const romPath = process.env.XV6_ROM ?? (firmware === 'bochs' ?
  'roms/free-at-bios/BIOS-bochs-legacy' : '/tmp/ATBIOS-REV1.rom');
const profile = process.env.XV6_PROFILE ?? '4m';
if (!['4m', '14m'].includes(profile)) throw new Error('XV6_PROFILE must be 4m or 14m');
const xv6Config = profile === '4m' ? PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP :
  PCAT80386_EXPERIMENTAL_15M_HDD_XV6_SMP;
const geometry = IBM_TYPE1_GEOMETRY;
const hdCmos = [
  [0x19, 47], [0x1b, geometry.cylinders & 0xff], [0x1c, geometry.cylinders >> 8],
  [0x1d, geometry.heads], [0x1e, 0xff], [0x1f, 0xff], [0x20, 0xc0],
  [0x21, geometry.cylinders & 0xff], [0x22, geometry.cylinders >> 8],
  [0x23, geometry.sectors], [0x39, 0],
];
const bochsCmos = initial => {
  const registers = new Map(initial);
  registers.set(0x14, 0x01); // VGA, rather than the IBM profile's color display.
  registers.set(0x3d, 0x21); // Try floppy, then hard disk.
  registers.set(0x12, 0xf0); // CMOS drive C uses type 47 geometry.
  for (const [index, value] of hdCmos) registers.set(index, value);
  let checksum = 0;
  for (let index = 0x10; index <= 0x2d; index++)
    checksum = (checksum + (registers.get(index) ?? 0)) & 0xffff;
  registers.set(0x2e, checksum >> 8);
  registers.set(0x2f, checksum & 0xff);
  return [...registers];
};
const machineConfig = firmware === 'bochs' ? {
  ...xv6Config,
  experimentalVgaMemory: 'vga1',
  regions: [
    ...xv6Config.regions.filter(region =>
      !(region.kind === 'ram' && region.start === 0xb8000)),
    {kind: 'rom', start: 0xc0000, end: 0xc9fff},
  ],
  chips: [
    ...xv6Config.chips.filter(chip => chip.kind !== 'cga').map(chip =>
      chip.kind === 'rtc' ? {...chip, initialCmos: bochsCmos(chip.initialCmos)} : chip),
    {kind: 'vga', name: 'vga1', at: 0x3c0},
  ],
} : xv6Config;
const imagePath = process.env.XV6_IMG ?? `/tmp/xv6-stock-${profile}/xv6.img`;
const slavePath = process.env.XV6_FS_IMG ?? path.join(path.dirname(imagePath), 'fs.img');
const kernelPath = process.env.XV6_KERNEL ?? path.join(path.dirname(imagePath), 'kernel');
const stepsLimit = Number(process.env.XV6_STEPS ?? 76_000_000);
const command = process.env.XV6_COMMAND ?? '';
const expectedSerial = process.env.XV6_EXPECT_SERIAL ?? '';
const stopOnExpected = process.env.XV6_STOP_ON_EXPECT === '1';
const progressEvery = Number(process.env.XV6_PROGRESS_EVERY ?? 0);
// Skip per-instruction diagnostic records when measuring the machine hot path.
// Serial, command injection, stopping condition and final state stay intact.
const lean = process.env.XV6_LEAN === '1';
const nativeByte = process.env.XV6_NATIVE_BYTE === '1';
if (nativeByte && !lean)
  throw new Error('XV6_NATIVE_BYTE=1 requires XV6_LEAN=1 for comparable guest-step receipts');
const rom = fs.readFileSync(romPath);
const vgaRom = firmware === 'bochs' ? fs.readFileSync('roms/free-at-bios/vgabios-lgpl.bin') : null;
if (firmware === 'bochs' && (crypto.createHash('sha256').update(rom).digest('hex') !==
      '6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac' ||
    crypto.createHash('sha256').update(vgaRom).digest('hex') !==
      '76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1'))
  throw new Error('vendored Bochs BIOS or LGPL VGA BIOS hash mismatch');
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
let expectedObserved = false;
const wanted = new Set(['main', 'userinit', 'scheduler', 'forkret', 'trapret', 'syscall', 'exec', 'iinit', 'initlog']);
const symbols = new Map();
for (const line of execFileSync('nm', ['-n', kernelPath], {encoding: 'utf8'}).split('\n')) {
  const match = line.match(/^([0-9a-f]+) [A-Za-z] (\S+)$/);
  if (match && wanted.has(match[2])) symbols.set(Number.parseInt(match[1], 16), match[2]);
}
const machine = new Machine(machineConfig, {
  ataImage: image,
  ataGeometry: IBM_TYPE1_GEOMETRY,
  ataSlaveImage: (() => { const media = new Uint8Array(image.length); media.set(slave); return media; })(),
  onPortAccess: event => {
    if (event.port === 0x1f0 && event.width === 32 && first32 === null) first32 = steps;
    if (event.dir === 'out' && event.port === 0x3f8) {
      serial.push(event.value & 0xff);
      if (expectedSerial && serial.length >= expectedSerial.length)
        expectedObserved = Buffer.from(serial).toString('latin1').includes(expectedSerial);
    }
  },
  onInterrupt: event => {
    const record = {step: steps, ...event};
    if (interrupts.length < 64) interrupts.push(record);
    if (first32 !== null && postBootInterrupts.length < 64) postBootInterrupts.push(record);
  },
});
if (process.env.XV6_SHARED_RAM === '1' || nativeByte) {
  const {createI80386RamBridge} = await import('../src/experimental/i80386-ram-bridge.js');
  machine._experimentalRamBridge = await createI80386RamBridge();
  machine._experimentalRamBridge.attach(machine);
}
machine.loadRom(rom, 0xf0000); machine.loadRom(rom);
if (vgaRom) machine.loadRom(vgaRom, 0xc0000);
machine.reset();
if (firmware === 'bochs') machine.ata.slaveEnabled = true;
const nativeRunner = nativeByte ? await (async () => {
  const {createI80386NativeByteRunner} = await import('../src/experimental/i80386-native-byte-block.js');
  return createI80386NativeByteRunner(machine, machine._experimentalRamBridge);
})() : null;
const nativeBlocks = new Map();
const nativeStats = {attempts:0, decoded:0, blockCalls:0, instructions:0};
const read386 = machine._read386.bind(machine);
machine._read386 = address => {
  if (address >= 0xfee00020 && address < 0xfee00024 && lapicIdReads.length < 32)
    lapicIdReads.push({step: steps, address, value: read386(address)});
  return read386(address);
};
for (; steps < stepsLimit; steps++) {
  if (progressEvery > 0 && steps % progressEvery === 0)
    console.error(`PROGRESS step=${steps} screen=${String.fromCharCode(...Array.from({length: 40}, (_, i) => machine._read386(0xb8000 + i * 2) || 32)).trim()}`);
  if (command && !commandStarted && serial.at(-2) === 36 && serial.at(-1) === 32)
    commandStarted = true;
  if (commandStarted && inputSent.length < command.length && machine.chips.uart1.rxFifo.length === 0) {
    const byte = command.charCodeAt(inputSent.length);
    machine.serialIn(byte);
    inputSent.push({step: steps, byte});
  }
  if (!lean) {
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
  }
  try {
    let advanced=0;
    if (nativeRunner) {
      nativeStats.attempts++;
      const cpu=machine.cpu;
      const key=`${cpu.cs}:${cpu.eip}:${cpu.cr3}:${cpu.cr4}`;
      let block=nativeBlocks.get(key);
      if (block === undefined) {
        block=nativeRunner.decode(8);
        if (block && block.instructions.length >= 2) {
          nativeStats.decoded++;
        } else block=null;
        if (nativeBlocks.size >= 4096) nativeBlocks.delete(nativeBlocks.keys().next().value);
        nativeBlocks.set(key,block);
      }
      if (block) {
        const result=nativeRunner.run(block,Math.min(16,stepsLimit-steps));
        if (result.instructions > 0) {
          advanced=result.instructions;
          nativeStats.blockCalls++;
          nativeStats.instructions+=advanced;
        } else if (result.reason === 'fallback') nativeBlocks.delete(key);
      }
    }
    if (advanced === 0) {machine.step();advanced=1;}
    steps+=advanced-1;
  } catch (error) {
    console.error(JSON.stringify({error: String(error), steps, milestones, userModeEntries,
      serial: Buffer.from(serial).toString('latin1'), inputSent,
      recentInstructions: [...recentInstructions].sort((a, b) => a.step - b.step),
      ata: {status: machine.ata?.status, command: machine.ata?.command,
        irqPending: machine.ata?._irqPending, irqOutput: machine.ata?._irqOutput}}, null, 2));
    throw error;
  }
  if (stopOnExpected && expectedObserved) { steps++; break; }
}
const screen = Array.from({length: 25}, (_, row) => Array.from({length: 80}, (_, column) =>
  String.fromCharCode(machine._read386(0xb8000 + (row * 80 + column) * 2) || 32)).join('').replace(/\s+$/, ''));
const receipt = {
  profile,
  ...(lean ? {lean: true} : {}),
  ...(process.env.XV6_SHARED_RAM === '1' || nativeByte ? {sharedRam: true} : {}),
  ...(nativeByte ? {nativeByte:true,nativeStats} : {}),
  firmware,
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
