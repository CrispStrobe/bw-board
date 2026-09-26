#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Machine, {PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP} from '../src/experimental/i80386-at-machine.js';
import {IBM_TYPE1_GEOMETRY} from './lib/i80386-at-hdd-image.mjs';

const romPath = process.env.XV6_ROM ?? '/tmp/ATBIOS-REV1.rom';
const imagePath = process.env.XV6_IMG ?? '/tmp/xv6-public/xv6.img';
const stepsLimit = Number(process.env.XV6_STEPS ?? 76_000_000);
const rom = fs.readFileSync(romPath);
const raw = fs.readFileSync(imagePath);
const image = new Uint8Array(IBM_TYPE1_GEOMETRY.cylinders * IBM_TYPE1_GEOMETRY.heads * IBM_TYPE1_GEOMETRY.sectors * 512);
image.set(raw);
let steps = 0;
let first32 = null;
const serial = [];
const interrupts = [];
const postBootInterrupts = [];
const machine = new Machine(PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP, {
  ataImage: image,
  ataGeometry: IBM_TYPE1_GEOMETRY,
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
for (; steps < stepsLimit; steps++) machine.step();
const screen = Array.from({length: 25}, (_, row) => Array.from({length: 80}, (_, column) =>
  String.fromCharCode(machine._read(0xb8000 + (row * 80 + column) * 2) || 32)).join('').replace(/\s+$/, ''));
const receipt = {
  rom: {path: path.resolve(romPath), sha256: crypto.createHash('sha256').update(rom).digest('hex')},
  image: {path: path.resolve(imagePath), sha256: crypto.createHash('sha256').update(raw).digest('hex')},
  steps, first32, serial: Buffer.from(serial).toString('latin1'), interrupts, postBootInterrupts, screen,
  lapic: {svr: machine._lapic[0xf0 / 4], timer: machine._lapic[0x320 / 4], initialCount: machine._lapic[0x380 / 4]},
  cpu: {cs: machine.cpu.cs, eip: machine.cpu.eip, cr0: machine.cpu.cr0, cr3: machine.cpu.cr3, cr4: machine.cpu.cr4},
};
console.log(JSON.stringify(receipt, null, 2));
