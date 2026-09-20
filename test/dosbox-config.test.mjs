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
