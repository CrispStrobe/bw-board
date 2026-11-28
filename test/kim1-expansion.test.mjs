// SPDX-License-Identifier: MIT
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createKim1Machine, controlKim1Machine, peekKim1Byte, readKim1Byte, writeKim1Byte, stepKim1Machine} from '../src/kim1-machine.js';
import {exportKim1MemoryCard} from '../src/kim1-expansion.js';

test('KIM-4 slots decode distinct RAM and ROM and keep the KIM-1 vectors', () => {
  const machine = createKim1Machine();
  const rom = new Uint8Array(6144).fill(0xea);
  const slots = [{kind: 'kim-2', address: 0x2000}, {kind: 'kim-3', address: 0x4000},
    {kind: 'kim-3b', address: 0x6000}, {kind: 'kim-5', address: 0xe000, image: rom}];
  controlKim1Machine(machine, 'setBackplane', slots);
  controlKim1Machine(machine, 'useBrickwrightRom');
  assert.equal(peekKim1Byte(machine, 0xfffc), peekKim1Byte(machine, 0x1ffc));
  assert.equal(peekKim1Byte(machine, 0x3800), null);
  const source = '; KIM-1 expanded RAM\n2000: A9 42 8D 00 40 8D 00 60 4C 08 20';
  controlKim1Machine(machine, 'loadProgram', source);
  // Place the CPU at the imported entry after its pending reset.
  stepKim1Machine(machine);
  machine.cpu.pc = 0x2000;
  for (let i = 0; i < 3; i++) stepKim1Machine(machine);
  for (const address of [0x4000, 0x6000]) assert.equal(peekKim1Byte(machine, address), 0x42);
  assert.equal(peekKim1Byte(machine, 0xe000), 0xea);
  assert.throws(() => controlKim1Machine(machine, 'setBackplane', [...slots, {kind: 'kim-3', address: 0x2000}]), /overlap/);
  assert.throws(() => controlKim1Machine(machine, 'loadProgram', '; KIM-1 expanded RAM\n2000: FF\nE000: FF'), /expansion ROM/);
  assert.equal(peekKim1Byte(machine, 0x2000), 0xa9);
  controlKim1Machine(machine, 'reset');
  assert.equal(peekKim1Byte(machine, 0x4000), 0x42);
});

test('memcfg maps enable individual RAM and ROM bytes including native vectors', () => {
  const machine = createKim1Machine();
  const bytes = new Uint8Array(131072);
  for (let i = 1; i < bytes.length; i += 2) bytes[i] = 1;
  bytes.set([0x5a, 2, 0x77, 0], 0x0400 * 2);
  bytes.set([0x44, 0], 0xfffc * 2);
  controlKim1Machine(machine, 'setMemoryCard', bytes);
  assert.deepEqual(exportKim1MemoryCard(machine.memoryCard), bytes);
  assert.equal(peekKim1Byte(machine, 0xfffc), 0x44);
  assert.equal(peekKim1Byte(machine, 0x0400), 0x5a);
  writeKim1Byte(machine, 0x0400, 1);
  assert.throws(() => writeKim1Byte(machine, 0x0401, 1), /expansion ROM/);
  assert.equal(peekKim1Byte(machine, 0x0401), 0x77);
  assert.equal(peekKim1Byte(machine, 0x0402), null);
  controlKim1Machine(machine, 'reset');
  assert.equal(peekKim1Byte(machine, 0x0400), 1);
  controlKim1Machine(machine, 'setMemoryCard', null);
  assert.equal(peekKim1Byte(machine, 0x0400), null);
});

test('PAL-1 SPI initializes, writes and reads a sector through KIM-1 PA', () => {
  const machine = createKim1Machine();
  const image = new Uint8Array(1024);
  controlKim1Machine(machine, 'mountSD', image);
  const writePA = byte => writeKim1Byte(machine, 0x1700, byte);
  writePA(16);
  writeKim1Byte(machine, 0x1701, 28);
  const transfer = value => {
    let result = 0;
    for (let i = 7; i >= 0; i--) {
      const mosi = ((value >> i) & 1) << 2;
      writePA(mosi);
      writePA(mosi | 8);
      result = (result << 1) | ((peekKim1Byte(machine, 0x1700) >> 1) & 1);
      writePA(mosi);
    }
    return result;
  };
  const response = () => {
    for (let i = 0; i < 16; i++) {
      const byte = transfer(255);
      if (byte !== 255) return byte;
    }
    throw new Error('No SPI response');
  };
  const command = (op, arg) => {
    for (const value of [255, 64 + op, arg >>> 24, (arg >>> 16) & 255, (arg >>> 8) & 255, arg & 255, 0x95]) transfer(value);
    return response();
  };
  assert.equal(command(0, 0), 1);
  for (const expected of [1, 0]) {
    assert.equal(command(55, 0), 1);
    assert.equal(command(41, 0x40000000), expected);
  }
  assert.equal(command(24, 2), 0x20);
  assert.equal(command(24, 1), 0);
  const bytes = Uint8Array.from({length: 512}, (_, i) => (i * 37 + 83) & 255);
  for (const byte of [0xfe, ...bytes, 255, 255]) transfer(byte);
  assert.equal(response(), 5);
  assert.equal(transfer(255), 0);
  writePA(16);
  assert.equal(command(17, 1), 0);
  assert.equal(response(), 0xfe);
  assert.deepEqual(Uint8Array.from({length: 512}, () => transfer(255)), bytes);
  assert.deepEqual(machine.sdCard.image.subarray(512), bytes);
  assert.ok(image.every(value => value === 0));
});

test('Corsham handshakes transfer short and long sectors through KIM-1 RIOT registers', () => {
  const machine = createKim1Machine();
  const image = new Uint8Array(512);
  controlKim1Machine(machine, 'mountCorshamDisk', image);
  const port = (register, byte) => writeKim1Byte(machine, 0x1700 + register, byte);
  const ack = () => !!(peekKim1Byte(machine, 0x1702) & 4);
  port(3, 3);
  const exchange = (request, responseLength) => {
    port(1, 255);
    port(2, 1);
    for (const byte of request) {
      port(0, byte);
      port(2, 3);
      assert.equal(ack(), true);
      port(2, 1);
      assert.equal(ack(), false);
    }
    port(1, 0);
    port(2, 0);
    return Array.from({length: responseLength}, () => {
      assert.equal(ack(), true);
      const value = peekKim1Byte(machine, 0x1700);
      port(2, 2);
      assert.equal(ack(), false);
      port(2, 0);
      return value;
    });
  };
  assert.deepEqual(exchange([5], 1), [0x85]);
  const data = Array.from({length: 128}, (_, i) => 255 - i);
  assert.deepEqual(exchange([0x20, 0, 1, 0, 0, 0, 1, ...data], 1), [0x82]);
  assert.deepEqual(exchange([0x18, 0, 1, 0, 1, 0], 129), [0x94, ...data]);
  assert.deepEqual(exchange([0x1f, 0, 1, 0, 0, 0, 4], 2), [0x83, 16]);
  assert.deepEqual(machine.corshamDisk.image.slice(128, 256), Uint8Array.from(data));
});

test('K-1013 DMA transfers sector zero both ways without disrupting the KIM-1 boot vectors', () => {
  const machine = createKim1Machine('; KIM-1 expanded RAM\n0200: EA');
  controlKim1Machine(machine, 'useBrickwrightRom');
  const image = new Uint8Array(77 * 26 * 256);
  image.fill(0x5a, 0, 256);
  controlKim1Machine(machine, 'mountK1013', {drive: 0, image});
  const command = bytes => {
    for (const byte of bytes) writeKim1Byte(machine, 0xffef, byte);
  };
  const result = () => {
    const bytes = [];
    while (peekKim1Byte(machine, 0xffee) & 0x40) {
      bytes.push(readKim1Byte(machine, 0xffef));
    }
    return bytes;
  };
  command([3, 0x6f, 0x20]);
  writeKim1Byte(machine, 0xffea, 0);
  writeKim1Byte(machine, 0xffe8, 1);
  command([0x46, 0, 0, 0, 0, 1, 0, 0x0e, 0xff]);
  assert.equal(peekKim1Byte(machine, 0xffe8) & 128, 0);
  assert.equal(result()[1], 0x80);
  assert.equal(peekKim1Byte(machine, 0xc000), 0x5a);
  assert.equal(peekKim1Byte(machine, 0xc0ff), 0x5a);
  assert.equal(peekKim1Byte(machine, 0xfffc), peekKim1Byte(machine, 0x1ffc));
  writeKim1Byte(machine, 0xc000, 0x26);
  writeKim1Byte(machine, 0xffea, 0);
  writeKim1Byte(machine, 0xffe8, 0);
  command([0x45, 0, 0, 0, 0, 1, 0, 0x0e, 0xff]);
  assert.equal(result()[1], 0x80);
  assert.equal(machine.k1013.chip.drives[0].image[0], 0x26);
  assert.equal(image[0], 0x5a);
});

test('Corsham file media handles directory, reads and atomic writes through the RIOT', () => {
  const machine = createKim1Machine();
  const bytes = Uint8Array.of(42, 43, 44);
  controlKim1Machine(machine, 'mountCorshamFiles', [
    {name: 'z.txt', bytes}, {name: 'a.hex', bytes: new Uint8Array()}
  ]);
  bytes[0] = 0;
  const port = (reg, value) => writeKim1Byte(machine, 0x1700 + reg, value);
  const ack = () => !!(peekKim1Byte(machine, 0x1702) & 4);
  port(3, 3);
  const exchange = (request, count) => {
    port(1, 255);
    port(2, 1);
    for (const byte of request) {
      assert.equal(ack(), false);
      port(0, byte);
      port(2, 3);
      assert.equal(ack(), true);
      port(2, 1);
    }
    port(1, 0);
    port(2, 0);
    return Array.from({length: count}, () => {
      assert.equal(ack(), true);
      const answer = peekKim1Byte(machine, 0x1700);
      port(2, 2);
      port(2, 0);
      return answer;
    });
  };
  const name = filename => [...new TextEncoder().encode(filename), 0];
  assert.deepEqual(exchange([0x10], 7), [0x90, ...name('A.HEX')]);
  assert.deepEqual(exchange([], 7), [0x90, ...name('Z.TXT')]);
  assert.deepEqual(exchange([], 1), [0x91]);
  assert.deepEqual(exchange([0x16, ...name('missing')], 2), [0x83, 12]);
  assert.deepEqual(exchange([0x16, ...name('z.txt')], 1), [0x82]);
  assert.deepEqual(exchange([0x17, 2], 4), [0x92, 2, 42, 43]);
  assert.deepEqual(exchange([0x17, 2], 3), [0x92, 1, 44]);
  assert.deepEqual(exchange([0x17, 2], 2), [0x92, 0]);
  assert.deepEqual(exchange([0x15, 0x1b, ...name('NEW.HEX')], 1), [0x82]);
  assert.deepEqual(exchange([0x1c, 2, 1, 2], 1), [0x82]);
  assert.deepEqual(exchange([0x1c, 1, 3], 1), [0x82]);
  assert.equal(machine.corshamDisk.files.has('NEW.HEX'), false);
  exchange([0x15], 0);
  const exported = machine.corshamDisk.exportFiles();
  assert.deepEqual(exported.map(entry => entry.name), ['A.HEX', 'NEW.HEX', 'Z.TXT']);
  assert.deepEqual(exported[1].bytes, Uint8Array.of(1, 2, 3));
  exported[1].bytes[0] = 9;
  assert.deepEqual(exchange([0x16, ...name('new.hex')], 1), [0x82]);
  assert.deepEqual(exchange([0x17, 4], 5), [0x92, 3, 1, 2, 3]);
  exchange([0x15], 0);
  assert.deepEqual(exchange([0x1b, ...name('Z.TXT')], 1), [0x82]);
  const fullChunk = [0x1c, 255, ...new Uint8Array(255).fill(5)];
  for (let i = 0; i < 257; i++) assert.deepEqual(exchange(fullChunk, 1), [0x82]);
  assert.deepEqual(exchange([0x1c, 2, 6, 7], 2), [0x83, 18]);
  exchange([0x15], 0);
  assert.deepEqual(machine.corshamDisk.files.get('Z.TXT'), Uint8Array.of(42, 43, 44));
  assert.deepEqual(exchange([0x1b, ...name('Z.TXT')], 1), [0x82]);
  assert.deepEqual(exchange([0x1c, 1, 7], 1), [0x82]);
  exchange([0x15], 0);
  assert.deepEqual(machine.corshamDisk.files.get('Z.TXT'), Uint8Array.of(7));
  assert.throws(() => controlKim1Machine(machine, 'mountCorshamFiles', [{name: '../A.TXT', bytes}]), /8.3/);
  assert.equal(machine.corshamDisk.files.size, 3);
});
