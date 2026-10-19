import test from 'node:test';
import assert from 'node:assert/strict';
import {readDosPackageZip, dosPackageCrc32} from '../scripts/lib/dos-package-zip.mjs';
import {selectDosPackage} from '../src/dos-package-policy.js';

// Tiny MIT-authored ZIP writer, independent bitwise CRC (not the production table).
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function zip(entries) {
  const locals = [], centrals = []; let offset = 0;
  for (const [name, content] of entries) {
    const filename = Buffer.from(name), bytes = Buffer.from(content);
    const local = Buffer.alloc(30 + filename.length + bytes.length), central = Buffer.alloc(46 + filename.length);
    local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc(bytes), 14);
    local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(filename.length, 26);
    filename.copy(local, 30); bytes.copy(local, 30 + filename.length);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc(bytes), 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24);
    central.writeUInt16LE(filename.length, 28); central.writeUInt32LE(name.endsWith('/') ? 16 : 0, 38);
    central.writeUInt32LE(offset, 42); filename.copy(central, 46);
    locals.push(local); centrals.push(central); offset += local.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const central = bytes => bytes.readUInt32LE(bytes.length - 6);

test('STORED adapter preserves full names and immutable asset snapshots with independent CRC golden', () => {
  assert.equal(dosPackageCrc32(Buffer.from('123456789')), 0xcbf43926);
  const input = zip([['pkg/a.txt', '123456789']]);
  const archive = readDosPackageZip(input);
  assert.deepEqual(archive.names, ['pkg/a.txt']);
  const read = archive.read('pkg/a.txt'); read[0] = 0;
  input.fill(0);
  assert.equal(Buffer.from(archive.read('pkg/a.txt')).toString(), '123456789');
  assert.ok(Object.isFrozen(archive) && Object.isFrozen(archive.names));
  assert.throws(() => archive.read('a.txt'), /absent/);
});

test('original names reject traversal/aliases/ancestors and invalid raw bytes', () => {
  assert.throws(() => readDosPackageZip(zip([['pkg/', '']])), /directory/);
  for (const name of ['../a', '/a', 'a\\b', 'a//b', 'a/./b', 'C:/a', 'a b', 'a\0b', 'é'])
    assert.throws(() => readDosPackageZip(zip([[name, '']])));
  for (const names of [['a', 'a'], ['A', 'a'], ['a', 'a/b'], ['A/x', 'a/y']])
    assert.throws(() => readDosPackageZip(zip(names.map(name => [name, '']))));
});

test('UNIX permission-only and explicit regular mode are passive bytes; nonregular modes refuse', () => {
  for (const mode of [0o600, 0o100600]) {
    const bytes = zip([['disk.img', 'a']]), start = central(bytes);
    bytes.writeUInt16LE(0x0314, start + 4); bytes.writeUInt32LE(mode * 65536, start + 38);
    assert.deepEqual([...readDosPackageZip(bytes).read('disk.img')], [97]);
  }
  for (const mode of [0o120777, 0o040700, 0o010600, 0o020600, 0o060600, 0o140600]) {
    const bytes = zip([['disk.img', 'a']]), start = central(bytes);
    bytes.writeUInt16LE(0x0314, start + 4); bytes.writeUInt32LE(mode * 65536, start + 38);
    assert.throws(() => readDosPackageZip(bytes), /attributes/);
  }
});

test('CRC-valid authored ZIP syntax mutants refuse on declaration semantics, with quoted path positive', () => {
  const config = '[autoexec]\nimgmount c disks/boot.img -t hdd -size 512,1,1,1\nboot -l c\n';
  const select = text => selectDosPackage(readDosPackageZip(zip([
    ['pkg/dosbox.conf', text], ['pkg/disks/boot.img', new Uint8Array(512)],
  ])));
  assert.equal(select(config.replace('disks/boot.img', '"disks/boot.img"')).imagePath, 'pkg/disks/boot.img');
  assert.equal(select(config.replace('disks/boot.img', "'disks/boot.img'")).imagePath, 'pkg/disks/boot.img');
  assert.equal(select(config.replace('disks/boot.img', '"disks\\boot.img"')).imagePath, 'pkg/disks/boot.img');
  for (const [from, to] of [['-t hdd', '"-t" hdd'], ['-t hdd', '-t "hdd"'],
    ['-size 512', '"-size" 512'], ['512,1,1,1', '"512,1,1,1"'],
    ['disks/boot.img', '"disks/"boot.img'], ['disks/boot.img', 'disks\\..\\boot.img']])
    assert.throws(() => select(config.replace(from, to)), /package/);
});

test('ZIP refuses original local/central mismatches, CRC and unsupported features', () => {
  const original = zip([['disk.img', 'abc']]);
  const mutations = [
    b => { b[30] ^= 1; }, b => { b[38] ^= 1; },
    b => b.writeUInt16LE(8, 6), b => b.writeUInt16LE(8, central(b) + 8),
    b => b.writeUInt16LE(1, central(b) + 8), b => b.writeUInt16LE(8, central(b) + 10),
    b => b.writeUInt16LE(45, central(b) + 6),
    b => b.writeUInt16LE(1, central(b) + 30), b => b.writeUInt16LE(1, central(b) + 32),
    b => b.writeUInt16LE(1, central(b) + 34), b => b.writeUInt16LE(1, central(b) + 36),
    b => b.writeUInt32LE(0xa1ff0000, central(b) + 38),
    b => b.writeUInt32LE(1, central(b) + 42),
    b => b.writeUInt32LE(0xffffffff, central(b) + 24),
    b => b.writeUInt32LE(16777217, central(b) + 24),
    b => b.writeUInt32LE(4, central(b) + 20),
    b => b.writeUInt16LE(1, b.length - 18), b => b.writeUInt16LE(1, b.length - 2),
    b => b.writeUInt16LE(33, b.length - 12), b => b.writeUInt32LE(0xffffffff, b.length - 6),
    b => b.writeUInt32LE(0, b.length - 10),
  ];
  for (const mutate of mutations) { const bytes = Buffer.from(original); mutate(bytes); assert.throws(() => readDosPackageZip(bytes)); }
  for (let end = 0; end < original.length; end++) assert.throws(() => readDosPackageZip(original.subarray(0, end)));
  assert.throws(() => readDosPackageZip(Buffer.concat([original, Buffer.from([0])])));
});

test('topology rejects overlapping/reordered locals and hidden leading/trailing bytes', () => {
  const original = zip([['a', 'x'], ['b', 'y']]);
  const overlapping = Buffer.from(original); overlapping.writeUInt32LE(0, central(overlapping) + 47 + 42);
  assert.throws(() => readDosPackageZip(overlapping), /topology/);
  const hidden = Buffer.concat([Buffer.from([0]), original]);
  hidden.writeUInt32LE(central(original) + 1, hidden.length - 6);
  hidden.writeUInt32LE(1, central(original) + 1 + 42);
  assert.throws(() => readDosPackageZip(hidden), /topology/);
  assert.throws(() => readDosPackageZip(zip(Array.from({length: 33}, (_, i) => [`f${i}`, '']))), /count/);
  assert.throws(() => readDosPackageZip(new Uint8Array(16777217)), /bounds/);
});
