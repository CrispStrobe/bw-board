import assert from 'node:assert/strict';
import test from 'node:test';

import ExperimentalATA16 from '../src/experimental/ata16.js';
import ExperimentalI80386ATMachine from '../src/experimental/i80386-at-machine.js';

const geometry = {cylinders: 1, heads: 1, sectors: 2};
const image = () => Uint8Array.from({length: 1024}, (_, index) => index & 0xff);

test('experimental ATA admits only geometry representable by its task file', () => {
  assert.throws(() => new ExperimentalATA16(new Uint8Array(512),
    {cylinders: 0x10001, heads: 1, sectors: 1}), /CHS task-file/);
  assert.throws(() => new ExperimentalATA16(new Uint8Array(512),
    {cylinders: 1, heads: 17, sectors: 1}), /CHS task-file/);
  assert.throws(() => new ExperimentalATA16(new Uint8Array(512),
    {cylinders: 1, heads: 1, sectors: 256}), /CHS task-file/);
});

test('experimental ATA performs CHS sector reads and writes with a native word FIFO', () => {
  const irq = [];
  const ata = new ExperimentalATA16(image(), geometry, {onIRQ: level => irq.push(level)});
  ata.writeRegister(2, 1);
  ata.writeRegister(3, 2);
  ata.writeRegister(4, 0);
  ata.writeRegister(5, 0);
  ata.writeRegister(6, 0xa0);
  ata.writeRegister(7, 0x20);
  assert.equal(ata.readRegister(7) & 0x49, 0x48);
  assert.equal(ata.readData16(), 0x0100);
  for (let word = 1; word < 256; word++) ata.readData16();
  assert.equal(ata.readRegister(7), 0x50);

  ata.writeRegister(3, 1);
  ata.writeRegister(2, 1);
  ata.writeRegister(7, 0x30);
  for (let word = 0; word < 256; word++) ata.writeData16(0xa000 | word);
  const media = ata.mediaBytes();
  assert.deepEqual(Array.from(media.slice(0, 6)), [0x00, 0xa0, 0x01, 0xa0, 0x02, 0xa0]);
  assert.ok(irq.includes(true));
});

test('experimental ATA raises and acknowledges each multi-sector PIO block', () => {
  const irq = [];
  const ata = new ExperimentalATA16(image(), geometry, {onIRQ: level => irq.push(level)});
  const select = count => {
    ata.writeRegister(2, count);
    ata.writeRegister(3, 1);
    ata.writeRegister(6, 0xa0);
  };
  select(2);
  ata.writeRegister(7, 0x20);
  assert.deepEqual(irq, [true]);
  ata.readRegister(7);
  assert.deepEqual(irq, [true, false]);
  for (let word = 0; word < 256; word++) ata.readData16();
  assert.equal(ata.readRegister(7, {alternate: true}), 0x80,
    'alternate status observes the inter-sector busy phase without advancing it');
  assert.deepEqual(irq, [true, false], 'the next block is not exposed synchronously');
  ata.writeRegister(3, 7);
  assert.equal(ata.sectorNumber, 2, 'task-file writes are ignored while BSY is asserted');
  ata.advance(255);
  assert.equal(ata.readRegister(7, {alternate: true}), 0x80);
  ata.advance(1);
  assert.deepEqual(irq, [true, false, true], 'second read block then becomes ready');
  assert.equal(ata.readRegister(7), 0x58);
  for (let word = 0; word < 256; word++) ata.readData16();
  assert.equal(ata.readRegister(7), 0x50);

  irq.length = 0;
  select(2);
  ata.writeRegister(7, 0x30);
  assert.deepEqual(irq, [], 'first write block is polled without an interrupt');
  for (let word = 0; word < 256; word++) ata.writeData16(0x1100 | word);
  assert.deepEqual(irq, [], 'write also enters a visible inter-sector busy phase');
  assert.equal(ata.readRegister(7, {alternate: true}), 0x80);
  ata.advance(256);
  assert.deepEqual(irq, [true], 'second write block becomes ready after status observes busy');
  ata.readRegister(7);
  for (let word = 0; word < 256; word++) ata.writeData16(0x2200 | word);
  assert.deepEqual(irq, [true, false, true], 'write command completion interrupts');
  ata.readRegister(7);
  assert.deepEqual(irq, [true, false, true, false]);
});

test('experimental ATA masks pending IRQ, resets transfers, and leaves device 1 absent', () => {
  const irq = [];
  const ata = new ExperimentalATA16(image(), geometry, {onIRQ: level => irq.push(level)});
  ata.writeRegister(7, 0x20);
  assert.deepEqual(irq, [true]);
  ata.writeRegister(7, 2, {control: true});
  assert.deepEqual(irq, [true, false]);
  assert.equal(ata.readRegister(7, {alternate: true}) & 8, 8);
  ata.writeRegister(7, 0, {control: true});
  assert.deepEqual(irq, [true, false, true], 'unmask exposes the still-pending interrupt');

  ata.writeRegister(7, 4, {control: true});
  assert.deepEqual(irq, [true, false, true, false]);
  assert.equal(ata.readRegister(7, {alternate: true}), 0x80);
  assert.equal(ata.readData16(), 0xffff, 'SRST cancels the pending data phase');

  ata.writeRegister(7, 0, {control: true});
  ata.writeRegister(2, 2);
  ata.writeRegister(3, 1);
  ata.writeRegister(7, 0x20);
  ata.readRegister(7);
  for (let word = 0; word < 256; word++) ata.readData16();
  assert.equal(ata.readRegister(7, {alternate: true}), 0x80);
  ata.writeRegister(7, 4, {control: true});
  assert.equal(ata.readRegister(7, {alternate: true}), 0x80,
    'SRST replaces an inter-sector phase with reset busy');
  ata.writeRegister(7, 0, {control: true});
  assert.equal(ata.readRegister(7, {alternate: true}), 0x50,
    'reset release does not resurrect the next multi-sector block');

  const irqBeforeIgnoredCommands = irq.length;
  ata.writeRegister(7, 4, {control: true});
  ata.writeRegister(3, 2);
  ata.writeRegister(7, 0x30);
  for (let word = 0; word < 256; word++) ata.writeData16(word);
  assert.deepEqual(ata.mediaBytes(), image(), 'commands and data are ignored while SRST is asserted');
  ata.writeRegister(7, 2, {control: true});
  assert.equal(ata.readRegister(7, {alternate: true}), 0x50);
  ata.writeRegister(7, 0, {control: true});
  assert.equal(irq.length, irqBeforeIgnoredCommands, 'reset cleared pending IRQ');

  const before = ata.mediaBytes();
  ata.writeRegister(7, 0x20);
  assert.equal(ata.readRegister(7, {alternate: true}) & 8, 8);
  ata.writeRegister(6, 0xb0);
  assert.equal(ata.readRegister(7), 0, 'device 1 does not respond');
  assert.equal(irq.at(-1), false, 'absent selection tri-states the master interrupt');
  ata.writeRegister(3, 2);
  ata.writeRegister(7, 0x30);
  for (let word = 0; word < 256; word++) ata.writeData16(word);
  assert.deepEqual(ata.mediaBytes(), before);
  ata.writeRegister(6, 0xa0);
  assert.equal(irq.at(-1), true, 'reselecting device 0 exposes its pending interrupt');
  assert.equal(ata.readRegister(7), 0x58, 'reselecting device 0 restores its transfer');
  assert.equal(ata.readData16(), 0x0100);
});

test('experimental ATA rejects invalid CHS and unsupported commands without media mutation', () => {
  const initial = image();
  const ata = new ExperimentalATA16(initial, geometry);
  ata.writeRegister(3, 3);
  ata.writeRegister(7, 0x20);
  assert.equal(ata.readRegister(7) & 1, 1);
  assert.equal(ata.readRegister(1), 0x10);
  ata.writeRegister(7, 0x99);
  assert.equal(ata.readRegister(1), 0x04);
  assert.deepEqual(ata.mediaBytes(), initial);
});

test('experimental ATA covers the IBM AT BIOS diagnostic, parameter, seek, recalibrate, and verify commands', () => {
  const ata = new ExperimentalATA16(image(), geometry);
  const command = value => {
    ata.writeRegister(7, value);
    const status = ata.readRegister(7);
    assert.equal(status, 0x50);
  };
  command(0x90);
  assert.equal(ata.readRegister(1), 1);

  ata.writeRegister(2, geometry.sectors);
  ata.writeRegister(6, 0xa0 | geometry.heads - 1);
  command(0x91);

  ata.writeRegister(3, 2);
  command(0x70);
  ata.writeRegister(2, 1);
  command(0x40);
  assert.equal(ata.sectorCount, 0);

  ata.writeRegister(4, 0x34);
  ata.writeRegister(5, 0x12);
  command(0x10);
  assert.deepEqual([ata.cylinderHigh, ata.cylinderLow, ata.sectorNumber], [0, 0, 1]);

  ata.writeRegister(2, geometry.sectors - 1);
  ata.writeRegister(7, 0x91);
  assert.equal(ata.readRegister(7), 0x51);
  assert.equal(ata.readRegister(1), 0x04);
});

test('386 AT dispatches ATA data as one 16-bit port access and persists sector writes', () => {
  const accesses = [];
  const machine = new ExperimentalI80386ATMachine(undefined, {
    ataImage: image(),
    ataGeometry: geometry,
    onPortAccess: event => accesses.push(event),
  });
  const out8 = (port, value) => machine.cpu.outPort(port, value, 8);
  out8(0x1f2, 1);
  out8(0x1f3, 1);
  out8(0x1f4, 0);
  out8(0x1f5, 0);
  out8(0x1f6, 0xa0);
  out8(0x1f7, 0x20);
  assert.equal(machine.cpu.inPort(0x1f0, 16), 0x0100);
  assert.deepEqual(accesses.at(-1), {dir: 'in', port: 0x1f0, width: 16, value: 0x0100});
  assert.throws(() => machine.cpu.inPort(0x1f0, 8), /native 16-bit/);
  assert.equal(accesses.some(event => event.port === 0x1f1 && event.width === 8), false,
    'native data read never touches the adjacent error/features port');

  out8(0x1f3, 2);
  out8(0x1f2, 1);
  out8(0x1f7, 0x30);
  for (let word = 0; word < 256; word++) machine.cpu.outPort(0x1f0, 0x5500 | word, 16);
  assert.deepEqual(Array.from(machine.ata.mediaBytes().slice(512, 518)),
    [0x00, 0x55, 0x01, 0x55, 0x02, 0x55]);
  machine.reset();
  assert.deepEqual(Array.from(machine.ata.mediaBytes().slice(512, 518)),
    [0x00, 0x55, 0x01, 0x55, 0x02, 0x55], 'board reset retains disk media');
  assert.equal(machine.cpu.inPort(0x1f7, 8), 0x50);
});

test('386 AT scheduler wakes a halted CPU horizon for the next ATA PIO block', () => {
  const machine = new ExperimentalI80386ATMachine(undefined, {
    ataImage: image(),
    ataGeometry: geometry,
  });
  const out8 = (port, value) => machine.cpu.outPort(port, value, 8);
  out8(0x1f2, 2);
  out8(0x1f3, 1);
  out8(0x1f6, 0xa0);
  out8(0x1f7, 0x20);
  machine.cpu.inPort(0x1f7, 8);
  for (let word = 0; word < 256; word++) machine.cpu.inPort(0x1f0, 16);
  assert.equal(machine.cpu.inPort(0x3f6, 8), 0x80);
  machine.cpu.halted = true;
  const before = machine.cycles;
  machine.step();
  assert.equal(machine.cpu.inPort(0x3f6, 8), 0x58);
  assert.equal(machine.ata._irqPending, true);
  assert.ok(machine.cycles - before >= 256, 'halt advances to the ATA deadline without another poll');
});
