import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildMedia, GEOMETRY, readRootFile, resultFiles, sha256, EXIT_OK} from './media.mjs';

if (process.argv.length !== 5)
  throw new Error('usage: media-control.mjs pinned-extender owned.le pinned-license');
const [extender, client, license] = process.argv.slice(2).map(path => fs.readFileSync(path));
const good = buildMedia({extender, client, license});
assert.equal(good.image.length, GEOMETRY.cylinders * GEOMETRY.heads * GEOMETRY.sectors * 512);
for (const [name, bytes] of [
  ['DOS32A  EXE', extender], ['OWNED   EXE', client],
]) assert.deepEqual(readRootFile(good.image, name), bytes);
assert.equal(resultFiles(good.image).ok, null);
assert.equal(resultFiles(good.image).fail, null);
assert.equal(resultFiles(good.image).returned, null);
assert.equal(sha256(buildMedia({extender, client, license}).image), sha256(good.image));

for (const role of ['extender', 'client', 'license']) {
  const inputs = {extender: Buffer.from(extender), client: Buffer.from(client), license: Buffer.from(license)};
  inputs[role][0] ^= 1;
  assert.throws(() => buildMedia(inputs), /mismatch/);
}
// Model one guest-created root file in a private copy to test output decoding.
const modeled = Buffer.from(good.image);
const part = GEOMETRY.sectors, vbr = part * 512;
const fatSectors = modeled.readUInt16LE(vbr + 22);
const root = (part + 1 + 2 * fatSectors) * 512;
const rootEntry = root + 4 * 32;
const cluster = 2 + good.info.used;
const spc = modeled[vbr + 13];
const data = (part + 1 + 2 * fatSectors + 32) * 512;
const marker = Buffer.from(EXIT_OK + '\r\n', 'ascii');
modeled.write('LEOK    TXT', rootEntry, 'ascii');
modeled[rootEntry + 11] = 0x20;
modeled.writeUInt16LE(cluster, rootEntry + 26);
modeled.writeUInt32LE(marker.length, rootEntry + 28);
modeled.writeUInt16LE(0xffff, (part + 1) * 512 + cluster * 2);
marker.copy(modeled, data + (cluster - 2) * spc * 512);
assert.deepEqual(readRootFile(modeled, 'LEOK    TXT'), marker);
assert.equal(resultFiles(modeled).ok.text, marker.toString('latin1'));
const corrupt = Buffer.from(modeled);
corrupt.writeUInt16LE(2, (part + 1) * 512 + cluster * 2);
assert.throws(() => readRootFile(corrupt, 'LEOK    TXT'), /chain excess/);
const duplicate = Buffer.from(modeled);
modeled.copy(duplicate, rootEntry + 32, rootEntry, rootEntry + 32);
duplicate[rootEntry + 32 + 11] = 0x20;
assert.throws(() => readRootFile(duplicate, 'LEOK    TXT'), /duplicate/);
console.log('PASS pinned media, deterministic FAT16, guest-output parser and adversaries');
