import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalDosPackagePath, validateDosPackageNames, parseDosPackageConfig,
  selectDosPackage, DOS_PACKAGE_LIMITS} from '../src/dos-package-policy.js';

const config = '[cpu]\ncputype=386\n[autoexec]\nimgmount c disks/boot.img -t hdd -size 512,1,1,1\nboot -l c\n';
const archive = (entries = [['pkg/dosbox.conf', config], ['pkg/disks/BOOT.IMG', new Uint8Array(512)]]) => {
  const assets = new Map(entries.map(([key, bytes]) => [key, typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes]));
  return {names: [...assets.keys()], read: name => assets.get(name).slice()};
};

test('policy resolves exact full config-relative media with case-insensitive lookup', () => {
  const selected = selectDosPackage(archive(), 'PKG/DOSBOX.CONF');
  assert.equal(selected.configPath, 'pkg/dosbox.conf');
  assert.equal(selected.imagePath, 'pkg/disks/BOOT.IMG');
  assert.deepEqual(selected.geometry, {cylinders: 1, heads: 1, sectors: 1});
  assert.equal(selected.readImage().length, 512);
  const image = selected.readImage(); image[0] = 99;
  assert.equal(selected.readImage()[0], 0);
  assert.ok(Object.isFrozen(selected) && Object.isFrozen(selected.geometry));
});

test('policy declares finite caps and canonical archive paths', () => {
  assert.equal(DOS_PACKAGE_LIMITS.archiveBytes, 16777216);
  assert.equal(DOS_PACKAGE_LIMITS.entries, 32);
  assert.equal(canonicalDosPackagePath('one/two.img'), 'one/two.img');
  for (const name of ['', '.', '..', '../x', 'a/../x', '/x', '//x', 'x\\y', 'C:/x',
    'https://x', 'a//b', 'a/./b', 'a b', 'a.', '.hidden', 'NUL.txt', 'a/COM1.img', 'é.img', 'x'.repeat(129)])
    assert.throws(() => canonicalDosPackagePath(name), undefined, name);
});

test('policy rejects duplicate/case/ancestor aliases before asset lookup', () => {
  for (const names of [['a', 'a'], ['A', 'a'], ['a', 'a/b'], ['A/x', 'a/y'], ['A/', 'a/x']])
    assert.throws(() => validateDosPackageNames(names.map(name => ({name, directory: name.endsWith('/')}))));
  validateDosPackageNames([{name: 'a/', directory: true}, {name: 'a/x', directory: false}]);
  assert.throws(() => selectDosPackage(archive([['dosbox.conf', config], ['DOSBOX.CONF', config]])), /alias/);
});

test('only declared closed command/section/option grammar is admitted', () => {
  assert.equal(parseDosPackageConfig(config.replace('cputype=386', 'cputype=auto'), 'dosbox.conf').route, 'i80386-at-hdd');
  assert.equal(parseDosPackageConfig(config.replace('[cpu]\ncputype=386\n', '').replace('imgmount c', 'imgmount 2'), 'dosbox.conf').route, 'i80386-at-hdd');
  assert.equal(parseDosPackageConfig(config.replace('disks/boot.img', '"disks/boot.img"'), 'dosbox.conf').imagePath, 'disks/boot.img');
  assert.equal(parseDosPackageConfig(config.replace('disks/boot.img', "'disks/boot.img'"), 'dosbox.conf').imagePath, 'disks/boot.img');
  assert.equal(parseDosPackageConfig(config.replace('disks/boot.img', 'disks\\boot.img'), 'dosbox.conf').imagePath, 'disks/boot.img');
  assert.equal(parseDosPackageConfig(config.replace('disks/boot.img', '"disks\\boot.img"'), 'dosbox.conf').imagePath, 'disks/boot.img');
  const mutations = [
    text => text.replace('imgmount c', 'imgmount c:'),
    text => text.replace('-t hdd', '-fs none -t hdd'),
    text => text.replace('-t hdd', '-t iso'),
    text => text.replace('boot -l c', 'boot disks/boot.img'),
    text => text.replace('boot -l c', 'boot -l d'),
    text => text.replace('-t hdd -size', '-size hdd -t'),
    text => text.replace('-t hdd', '"-t" hdd'),
    text => text.replace('-t hdd', "'-t' hdd"),
    text => text.replace('-t hdd', '-t "hdd"'),
    text => text.replace('-size 512', '"-size" 512'),
    text => text.replace('512,1,1,1', '"512,1,1,1"'),
    text => text.replace('disks/boot.img', '"disks/"boot.img'),
    text => text.replace('disks/boot.img', 'disks/"boot.img"'),
    text => text.replace('disks/boot.img', '"disks/boot.img'),
    text => text.replace('disks/boot.img', 'disks\\..\\boot.img'),
    text => text.replace('disks/boot.img', '\\\\host\\boot.img'),
    text => text.replace('disks/boot.img', 'C:\\boot.img'),
    text => text.replace('cputype=386', 'cputype=486'),
    text => text.replace('disks/boot.img', '../boot.img'),
    text => text.replace('disks/boot.img', 'http://site/boot.img'),
    text => text.replace('disks/boot.img', 'boot.iso'),
    text => text.replace('512,1,1,1', '512,64,1,1'),
    text => text.replace('512,1,1,1', '512,1,17,1'),
    text => text.replace('512,1,1,1', '512,1,1,1025'),
    text => text.replace('512,1,1,1', '512,63,16,1024'),
    text => text.replace('512,1,1,1', '512,01,1,1'),
    text => text.replace('boot -l c', 'boot -l c & exit'),
    text => text.replace('boot -l c', 'boot -l c\nexit'),
    text => text + '[autoexec]\n', text => text + 'boot -l c\n',
    text => text.replace('[cpu]', '[dosbox]'), text => text.replace('cputype=386', ''),
    text => text.replace('[autoexec]', '[autoexec]\nmount d /host'),
    text => text.replace('boot -l c', 'boot -l c\nimgmount c disk.img -t hdd -size 512,1,1,1'),
    text => text.replace('boot -l c', 'boot -l c\n[unknown]'),
  ];
  for (const mutate of mutations) assert.throws(() => parseDosPackageConfig(mutate(config), 'dosbox.conf'));
  assert.throws(() => parseDosPackageConfig(' '.repeat(16385), 'dosbox.conf'));
});

test('selection refuses ambiguity, basename substitution, extra media/config and CHS drift', () => {
  const entries = [['pkg/dosbox.conf', config], ['pkg/disks/boot.img', new Uint8Array(512)]];
  assert.equal(selectDosPackage(archive([...entries, ['pkg/LICENSE.txt', 'MIT']])).imageByteLength, 512);
  assert.throws(() => selectDosPackage(archive([...entries, ['other/dosbox.conf', config]])), /unambiguous/);
  assert.throws(() => selectDosPackage(archive([...entries, ['other/other.conf', config]]), 'pkg/dosbox.conf'), /undeclared/);
  assert.throws(() => selectDosPackage(archive([entries[0], ['boot.img', new Uint8Array(512)]])), /absent/);
  assert.throws(() => selectDosPackage(archive([entries[0], ['pkg/disks/boot.img', new Uint8Array(513)]])), /extent/);
  assert.throws(() => selectDosPackage(archive(), 'missing.conf'), /absent/);
  assert.throws(() => selectDosPackage(archive([['custom.conf', config], ['disks/boot.img', new Uint8Array(512)]])), /unambiguous/);
  assert.equal(selectDosPackage(archive([['custom.conf', config], ['disks/boot.img', new Uint8Array(512)]]), 'custom.conf').configPath, 'custom.conf');
});
