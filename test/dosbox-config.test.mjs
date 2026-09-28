import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDosboxConfig, resolveDosboxMedia } from '../src/dosbox-config.js';

test('DOSBox config keeps declarative mounts and boot inputs', () => {
  const cfg = parseDosboxConfig('[cpu]\ncore=386\n[autoexec]\nmount c "GAME"\nimgmount d doom.img -t hdd\nboot doom.img');
  assert.equal(cfg.sections.cpu.core, '386');
  assert.deepEqual(cfg.mounts, [
    { drive: 'c', source: 'GAME', type: 'dir' },
    { drive: 'd', source: 'doom.img', type: 'hdd' },
  ]);
  assert.deepEqual(cfg.boots, ['doom.img']);
});

test('DOSBox media resolution refuses host directories and resolves image bytes', () => {
  const cfg = parseDosboxConfig('[autoexec]\nmount c GAME\nimgmount d doom.img -t hdd');
  const image = new Uint8Array([1, 2]);
  const result = resolveDosboxMedia(cfg, { 'doom.img': image });
  assert.deepEqual(result.images.map(x => x.name), ['doom.img']);
  assert.equal(result.refused[0].reason, 'host directory mounts are not browser media');
  assert.deepEqual(result.missing, []);
});

test('DOSBox imgmount resolves a quoted image path with spaces', () => {
  const cfg = parseDosboxConfig('[autoexec]\nimgmount c "disks/Windows 3.1.img" -t hdd\nboot "disks/Windows 3.1.img"');
  assert.deepEqual(cfg.mounts, [
    { drive: 'c', source: 'disks/Windows 3.1.img', type: 'hdd' },
  ]);
  const image = new Uint8Array([1, 2]);
  const result = resolveDosboxMedia(cfg, { 'Windows 3.1.img': image });
  assert.deepEqual(result.missing, []);
  assert.equal(result.images[0].bytes, image);
});

test('DOSBox quoted image paths keep comment characters', () => {
  const cfg = parseDosboxConfig('[autoexec]\nimgmount c "disks/Win; #3.1.img" -t hdd ; attached media\nboot "disks/Win; #3.1.img"');
  assert.equal(cfg.mounts[0].source, 'disks/Win; #3.1.img');
  assert.equal(cfg.mounts[0].type, 'hdd');
  assert.deepEqual(resolveDosboxMedia(cfg, { 'Win; #3.1.img': new Uint8Array([1]) }).missing, []);
});

test('DOSBox primary disk 2 and boot -l c resolve supplied image bytes', () => {
  const cfg = parseDosboxConfig('[autoexec]\nimgmount 2 "disk/owned.img" -t hdd -size 512,17,4,1\nboot -l c');
  assert.deepEqual(cfg.mounts, [{ drive: 'c', source: 'disk/owned.img', type: 'hdd' }]);
  const image = new Uint8Array([1, 2]);
  const result = resolveDosboxMedia(cfg, { 'owned.img': image });
  assert.deepEqual(result.missing, []);
  assert.deepEqual(result.refused, []);
  assert.equal(result.images[0].bytes, image);
});

test('DOSBox numeric 2 and explicit C mounts cannot silently conflict', () => {
  const cfg = parseDosboxConfig('[autoexec]\nimgmount 2 first.img -t hdd\nimgmount c second.img -t hdd\nboot -l c');
  const result = resolveDosboxMedia(cfg, {
    'first.img': new Uint8Array([1]), 'second.img': new Uint8Array([2]),
  });
  assert.deepEqual(result.images, []);
  assert.equal(result.refused.length, 2);
  assert.ok(result.refused.every(x => x.reason === 'multiple DOSBox mounts for drive c'));
});
