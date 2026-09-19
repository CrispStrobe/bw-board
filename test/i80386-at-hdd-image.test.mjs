import assert from 'node:assert/strict';
import test from 'node:test';

import ExperimentalATA16 from '../src/experimental/ata16.js';
import {
  createI80386AtFat16Image,
  HDD_ROUNDTRIP_TEXT,
  IBM_TYPE1_GEOMETRY,
  sha256,
} from '../scripts/lib/i80386-at-hdd-image.mjs';

const word = (bytes, offset) => bytes[offset] | bytes[offset + 1] << 8;
const dword = (bytes, offset) => (word(bytes, offset) | word(bytes, offset + 2) << 16) >>> 0;

test('owned 386 AT disk is a deterministic type-1 FAT16 volume with a reserved round-trip sector', () => {
  const first = createI80386AtFat16Image();
  const second = createI80386AtFat16Image();
  assert.equal(first.length, 306 * 4 * 17 * 512);
  assert.equal(sha256(first), sha256(second));
  assert.equal(word(first, 11), 512);
  assert.equal(word(first, 19), 20807);
  assert.equal(first.length / 512, 20808);
  assert.deepEqual(Array.from(first.slice(510, 512)), [0x55, 0xaa]);
  assert.deepEqual(Array.from(first.slice(512, 518)), [0xf8, 0xff, 0xff, 0xff, 0xff, 0xff]);
  const root = 165 * 512;
  assert.equal(Buffer.from(first.slice(root, root + 11)).toString(), 'ROUNDTRPTXT');
  assert.equal(word(first, root + 26), 2);
  assert.equal(dword(first, root + 28), HDD_ROUNDTRIP_TEXT.length);
  const data = 197 * 512;
  assert.equal(Buffer.from(first.slice(data, data + HDD_ROUNDTRIP_TEXT.length)).toString(),
    HDD_ROUNDTRIP_TEXT);
  assert.ok(first.slice(-512).every(byte => byte === 0), 'round-trip target is outside the FAT volume');
});

test('IBM BIOS task-file commands write and read the owned final physical sector', () => {
  const image = createI80386AtFat16Image();
  const ata = new ExperimentalATA16(image, IBM_TYPE1_GEOMETRY);
  const selectLast = command => {
    ata.writeRegister(2, 1);
    ata.writeRegister(3, 17);
    ata.writeRegister(4, 305 & 0xff);
    ata.writeRegister(5, 305 >>> 8);
    ata.writeRegister(6, 0xa0 | 3);
    ata.writeRegister(7, command);
  };
  selectLast(0x30);
  for (let wordIndex = 0; wordIndex < 256; wordIndex++)
    ata.writeData16(wordIndex < 8 ? 0xa500 | wordIndex : 0);
  assert.equal(ata.readRegister(7), 0x50);
  selectLast(0x20);
  assert.equal(ata.readRegister(7), 0x58);
  for (let wordIndex = 0; wordIndex < 8; wordIndex++)
    assert.equal(ata.readData16(), 0xa500 | wordIndex);
});
