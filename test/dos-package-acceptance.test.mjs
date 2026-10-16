import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {authoredFixture, BOOT_HEX, CONFIG, BIOS, VGA, sha256, crc32} from '../scripts/dos-package-acceptance/probe.mjs';
import {readDosPackageZip} from '../scripts/lib/dos-package-zip.mjs';
import {selectDosPackage} from '../src/dos-package-policy.js';

test('independently reviewed authored bootstrap and ZIP goldens, no guest execution', () => {
  const fixture = authoredFixture(fs.readFileSync(new URL('../LICENSE', import.meta.url)));
  const image = fixture.entries[1].data;
  assert.equal(Buffer.from(BOOT_HEX, 'hex').length, 197); assert.equal(image.length, 512);
  assert.equal(sha256(image), '03564a6088a3ecc64833713ca1d406da354a3f6a16d60fdffa59ffbf5cfc5e50');
  assert.equal(crc32(image), 0xbca9a8e3);
  assert.deepEqual([...image.subarray(0x5a, 0x5e)], [0xfa, 0xeb, 0xfe, 0x90]);
  assert.deepEqual([...image.subarray(510)], [0x55, 0xaa]);
  assert.ok(image.subarray(197, 510).every(byte => byte === 0));
  assert.equal(fixture.good.length, 2014); assert.equal(fixture.bad.length, 2020);
  assert.equal(sha256(fixture.good), 'a3511f8daae0e5803ae050974e4a62ff75bf852ccff2681855f5bf1bfd7bdcc4');
  assert.equal(sha256(fixture.bad), 'e783114b8d4874041e28db5603d309b53c2066a6961a1c0b1af86aa5869d7182');
  assert.equal(CONFIG.length, 88); assert.equal(crc32(Buffer.from(CONFIG)), 0xa102216f);
  assert.equal(BIOS.bytes, 65536); assert.equal(VGA.bytes, 38400);
  assert.equal('a'.charCodeAt(0) ^ 0x5a, 0x3b); assert.equal('b'.charCodeAt(0) ^ 0x5a, 0x38);
});

test('fixture reaches exact admitted config-relative HDD and CRC-valid traversal refuses semantically', () => {
  const fixture = authoredFixture(fs.readFileSync(new URL('../LICENSE', import.meta.url)));
  const archive = readDosPackageZip(fixture.good), selected = selectDosPackage(archive, 'pkg/dosbox.conf');
  assert.deepEqual(archive.names, ['pkg/dosbox.conf', 'pkg/disks/boot.img', 'pkg/LICENSE.txt']);
  assert.deepEqual(selected.geometry, {cylinders: 1, heads: 1, sectors: 1});
  assert.equal(selected.imagePath, 'pkg/disks/boot.img'); assert.equal(sha256(selected.readImage()), sha256(fixture.entries[1].data));
  assert.throws(() => readDosPackageZip(fixture.bad), /package path is not canonical/);
  const bytes = Buffer.from(fixture.good); bytes[181] ^= 1;
  assert.throws(() => readDosPackageZip(bytes), /CRC/);
});

test('exact producer orchestration executes inert success/fault controls, never a PTY or child guest', () => {
  const run = spawnSync('/usr/bin/python3', ['-B', 'scripts/dos-package-acceptance/producer.py', '--controls'],
    {cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10000, maxBuffer: 65536});
  assert.equal(run.status, 0, run.stdout + run.stderr); assert.equal(run.signal, null);
  assert.match(run.stderr, /Ran \d+ tests/); assert.match(run.stderr, /\nOK\n/);
});

test('independent original-only reader accepts full authored packet and rejects rehashed semantic negatives', () => {
  const run = spawnSync('/usr/bin/python3', ['-B', 'scripts/dos-package-acceptance/reader.py', '--controls'],
    {cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10000, maxBuffer: 65536});
  assert.equal(run.status, 0, run.stdout + run.stderr); assert.equal(run.signal, null); assert.equal(run.stderr, '');
  const result = JSON.parse(run.stdout);
  assert.equal(result.fullPacketPositive, true);
  assert.equal(result.fullyRehashedSemanticRefusals.length, 33);
  assert.ok(result.fullyRehashedSemanticRefusals.every(row => row.result === 'REFUSED'));
  assert.equal(new Set(result.fullyRehashedSemanticRefusals.map(row => row.name)).size, 33);
  assert.equal(result.testOnly, true); assert.equal(result.guestOrPtyExecuted, false);
});
