import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import {createDebugTarget} from '../src/debug-target-factory.js';
import {renderMode} from '../src/i8086-cga.js';
import {renderObservedWindowsVga480} from '../scripts/lib/i80386-windows-vga-480-frame.mjs';
import {renderObservedDoomVga} from '../scripts/lib/i80386-doom-vga-frame.mjs';
import {PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA} from '../src/experimental/i80386-at-machine.js';

const vgaTarget = () => createDebugTarget('i80386', {
  config: PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA,
});

const doomSnapshot = () => {
  const planes = Array.from({length: 4}, () => Buffer.alloc(0x10000));
  const dac = Buffer.alloc(768);
  for (let i = 0; i < 256; i++) {
    dac[i * 3] = i & 63;
    dac[i * 3 + 1] = (i >>> 2) & 63;
    dac[i * 3 + 2] = (i >>> 4) & 63;
  }
  for (const start of [0, 0x4000, 0x8000])
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 320; x++)
        planes[x & 3][(start + y * 80 + (x >>> 2)) & 0xffff] =
          (x + 3 * y + (start >>> 8)) & 255;
  return {misc: 0x63, seq: [3, 1, 15, 0, 6], gc: [0, 0, 0, 0, 0, 0x40, 5],
    crtc: Object.assign(Array(32).fill(0), {1: 79, 6: 0xbf, 7: 0x1f,
      9: 0x41, 0x12: 0x8f, 0x13: 40, 0x17: 0xe3, 0x18: 0xff}),
    attr: Object.assign(Array(32).fill(0), {0x10: 0x41, 0x12: 15}),
    dacMask: 255, dacBase64: dac.toString('base64'),
    planesBase64: planes.map(plane => plane.toString('base64'))};
};

function installDoomSnapshot(machine, snapshot) {
  const card = machine.chips.vga1;
  card.misc = snapshot.misc;
  for (const name of ['seq', 'gc', 'crtc', 'attr']) card[name].set(snapshot[name]);
  card.dac.set(Buffer.from(snapshot.dacBase64, 'base64'));
  card.dacMask = snapshot.dacMask;
  snapshot.planesBase64.forEach((value, i) =>
    machine.vgaMemory.planes[i].set(Buffer.from(value, 'base64')));
  machine.displayRevision++;
}

function assertDoomRaster(frame, oracle) {
  assert.equal(frame.width, 320);
  assert.equal(frame.height, 200);
  assert.equal(frame.mode, 0x13);
  assert.equal(frame.why, 'observed Doom unchained 320x200 VGA');
  const rgb = Buffer.alloc(320 * 200 * 3);
  for (let i = 0; i < 320 * 200; i++) {
    rgb[i * 3] = frame.rgba[i * 4];
    rgb[i * 3 + 1] = frame.rgba[i * 4 + 1];
    rgb[i * 3 + 2] = frame.rgba[i * 4 + 2];
    assert.equal(frame.rgba[i * 4 + 3], 255);
  }
  assert.equal(createHash('sha256').update(rgb).digest('hex'), oracle.rgbSha256);
}

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

test('browser Doom unchained raster matches the strict decoder at all observed page starts', async () => {
  const {adapter, target} = await vgaTarget();
  const snapshot = doomSnapshot();
  for (const start of [0, 0x4000, 0x8000]) {
    snapshot.crtc[0x0c] = start >>> 8;
    installDoomSnapshot(adapter.machine, snapshot);
    assertDoomRaster(target.video(), renderObservedDoomVga(snapshot));
  }
  snapshot.dacMask = 0x0f;
  installDoomSnapshot(adapter.machine, snapshot);
  assertDoomRaster(target.video(), renderObservedDoomVga(snapshot));
});

test('browser Doom decoder refuses unobserved register and page layouts', async () => {
  const {adapter, target} = await vgaTarget();
  for (const change of [
    snapshot => { snapshot.seq[0] = 1; },
    snapshot => { snapshot.seq[4] = 2; },
    snapshot => { snapshot.gc[5] = 0; },
    snapshot => { snapshot.crtc[8] = 1; },
    snapshot => { snapshot.crtc[0x13] = 80; },
    snapshot => { snapshot.crtc[0x17] = 0x8e; },
    snapshot => { snapshot.crtc[0x0c] = 0x20; },
    snapshot => { snapshot.attr[0x10] = 1; },
    snapshot => { snapshot.dacMask = 256; },
    snapshot => {
      const dac = Buffer.from(snapshot.dacBase64, 'base64');
      dac[0] = 64; snapshot.dacBase64 = dac.toString('base64');
    },
  ]) {
    const snapshot = doomSnapshot();
    change(snapshot);
    installDoomSnapshot(adapter.machine, snapshot);
    assert.ok(target.video().unsupported, 'unobserved state must not claim Doom pixels');
  }
});

test('optional pinned Doom report matches browser raster without storing media pixels',
  {skip: !process.env.I80386_DOOM_SNAPSHOT_REPORT}, async () => {
    const bytes = fs.readFileSync(process.env.I80386_DOOM_SNAPSHOT_REPORT);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),
      '4d109a1ffb5c132f48839341f4a3ab9c32d50f04e429b709a7d8b033f321d363');
    const report = JSON.parse(bytes);
    const {adapter, target} = await vgaTarget();
    const expected = {
      firstGraphicsSnapshot: 'ea0787f65f73b0013d03b359490e3125211b28ad5c1502ffb1544c0ded4192f5',
      latestGraphicsSnapshot: '941e7414ef1599ca01564e4c073544462fd708eeac44a4307194240e75079100',
    };
    for (const name of Object.keys(expected)) {
      const snapshot = report.vgaEvidence[name];
      installDoomSnapshot(adapter.machine, snapshot);
      const oracle = renderObservedDoomVga(snapshot);
      assert.equal(oracle.rgbSha256, expected[name]);
      assertDoomRaster(target.video(), oracle);
    }
  });
