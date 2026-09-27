import test from 'node:test';
import assert from 'node:assert/strict';
import {createDebugTarget} from '../src/debug-target-factory.js';
import {renderMode} from '../src/i8086-cga.js';
import {renderObservedWindowsVga480} from '../scripts/lib/i80386-windows-vga-480-frame.mjs';
import {PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA} from '../src/experimental/i80386-at-machine.js';

const vgaTarget = () => createDebugTarget('i80386', {
  config: PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA,
});

test('386 VGA text display reads the planes written by the guest', async () => {
  const {adapter, target} = await vgaTarget();
  const card = adapter.machine.chips.vga1;
  card.misc = 0x67;
  const memory = adapter.machine.vgaMemory;
  memory.planes[0][0] = 'G'.charCodeAt(0);
  memory.planes[1][0] = 0x1f;
  memory.planes[0][2] = 'U'.charCodeAt(0);
  memory.planes[1][2] = 0x1f;
  const frame = target.video();
  const expected = renderMode(3, address => {
    const offset = address - 0xb8000;
    return memory.planes[offset & 1][offset & ~1];
  });
  assert.equal(frame.width, 720);
  assert.equal(frame.height, 400);
  assert.equal(frame.why, '386 VGA text planes');
  assert.deepEqual(frame.rgba, expected.rgba);
  assert.strictEqual(target.video(), frame, 'unchanged display revision reuses the raster');
  memory.planes[0][0] = 'H'.charCodeAt(0);
  adapter.machine.displayRevision++;
  assert.notStrictEqual(target.video(), frame, 'a guest VGA write invalidates the raster');
});

test('386 mode 13h uses chain-4 plane and index routing', async () => {
  const {adapter, target} = await vgaTarget();
  const card = adapter.machine.chips.vga1;
  card.misc = 0x63;
  card.gc[6] = 5;
  card.seq[4] = 0x0e;
  card.attr[0x10] = 0x41;
  card.crtc[0x13] = 40;
  card.dacMask = 255;
  const planes = adapter.machine.vgaMemory.planes;
  for (let p = 0; p < 4; p++) {
    planes[p][0] = p + 1;
    card.dac[(p + 1) * 3] = p + 1;
  }
  planes[0][4] = 5;
  card.dac[15] = 5;
  planes[0][320] = 6;
  card.dac[18] = 6;
  const frame = target.video();
  assert.equal(frame.width, 320);
  assert.equal(frame.height, 200);
  assert.equal(frame.mode, 0x13);
  assert.deepEqual([0, 1, 2, 3, 4, 320].map(x => frame.rgba[x * 4]),
    [4, 8, 12, 16, 20, 24]);
});

test('observed Windows 3.11 VGA graphics matches the independent 480-line oracle', async () => {
  const {adapter, target} = await vgaTarget();
  const card = adapter.machine.chips.vga1;
  card.misc = 0xe3;
  Object.assign(card.seq, {0: 3, 1: 1, 2: 15, 4: 6});
  card.gc[6] = 5;
  Object.assign(card.crtc, {1: 79, 6: 11, 7: 62, 9: 64,
    18: 223, 19: 40, 23: 227, 24: 255});
  Object.assign(card.attr, {1: 1, 2: 2, 16: 1, 18: 15});
  card.dac[3] = 63;
  card.dac[7] = 42;
  card.dacMask = 255;
  const planes = adapter.machine.vgaMemory.planes;
  planes[0][0] = 0x80;
  planes[1][0] = 0x40;
  planes[0][80] = 0x80;
  const state = card.getVideoState();
  const snapshot = {registers: {...state,
    seq: Array.from(state.seq), gc: Array.from(state.gc),
    crtc: Array.from(state.crtc), attr: Array.from(state.attr),
    dac: Array.from(state.dac)},
    planeBase64: planes.map(plane => Buffer.from(plane).toString('base64'))};
  const oracle = renderObservedWindowsVga480(snapshot);
  const frame = target.video();
  assert.equal(frame.width, 640);
  assert.equal(frame.height, 480);
  assert.equal(frame.why, 'observed Windows 3.11 640x480 planar VGA');
  for (let i = 0; i < oracle.rgb.length / 3; i++)
    assert.deepEqual(Array.from(frame.rgba.slice(i * 4, i * 4 + 3)),
      Array.from(oracle.rgb.slice(i * 3, i * 3 + 3)));
});
