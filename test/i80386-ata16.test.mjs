import assert from 'node:assert/strict';
import test from 'node:test';

import ExperimentalATA16 from '../src/experimental/ata16.js';
import ExperimentalI80386ATMachine from '../src/experimental/i80386-at-machine.js';

const geometry = {cylinders: 1, heads: 1, sectors: 2};
const image = () => Uint8Array.from({length: 1024}, (_, index) => index & 0xff);

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
  assert.equal(ata.readRegister(7), 0x40);

  ata.writeRegister(3, 1);
  ata.writeRegister(2, 1);
  ata.writeRegister(7, 0x30);
  for (let word = 0; word < 256; word++) ata.writeData16(0xa000 | word);
  const media = ata.mediaBytes();
  assert.deepEqual(Array.from(media.slice(0, 6)), [0x00, 0xa0, 0x01, 0xa0, 0x02, 0xa0]);
  assert.ok(irq.includes(true));
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

  out8(0x1f3, 2);
  out8(0x1f2, 1);
  out8(0x1f7, 0x30);
  for (let word = 0; word < 256; word++) machine.cpu.outPort(0x1f0, 0x5500 | word, 16);
  assert.deepEqual(Array.from(machine.ata.mediaBytes().slice(512, 518)),
    [0x00, 0x55, 0x01, 0x55, 0x02, 0x55]);
  machine.reset();
  assert.deepEqual(Array.from(machine.ata.mediaBytes().slice(512, 518)),
    [0x00, 0x55, 0x01, 0x55, 0x02, 0x55], 'board reset retains disk media');
  assert.equal(machine.cpu.inPort(0x1f7, 8), 0x40);
});
