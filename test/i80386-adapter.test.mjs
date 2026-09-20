import test from 'node:test';
import assert from 'node:assert/strict';
import { createDebugTarget, getTargetKinds } from '../src/debug-target-factory.js';
import { applyMedia } from '../src/machine-media.js';

test('experimental 80386 is a first-class browser target with VGA/key surfaces', async () => {
  assert.ok(getTargetKinds().some(k => k.kind === 'i80386'));
  const { adapter, target } = await createDebugTarget('i80386', {});
  assert.equal(adapter.machine.cpuBackend, 'i80386-experimental');
  assert.equal(target.capabilities().keys.includes('scancode'), true);
  assert.equal(target.video().width, 720);
  assert.equal(typeof adapter.sendScancode, 'function');
});

test('DOSBox disk media can attach lazily to the experimental target', async () => {
  const { adapter, target } = await createDebugTarget('i80386', {});
  const image = new Uint8Array(4 * 17 * 512);
  const result = applyMedia({ adapter, machine: adapter.machine, kind: 'i80386' }, { hdd: image });
  assert.equal(result.errors.some(e => e.slot === 'bios'), true);
  assert.deepEqual(result.applied, ['hdd']);
  assert.equal(adapter.machine.ata.mediaBytes().length, image.length);
  assert.equal(target.capabilities().keys.includes('scancode'), true);
});
