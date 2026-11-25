// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {Cp1Machine} from '../src/cp1-machine.js';
import {decodeCp2Memory, encodeCp2Memory} from '../src/cp2-tape.js';
import {decodeCp2Wave, encodeCp2Wave} from '../src/cp2-wave.js';

test('CP2 emits LSB first in descending block address order and rejects incomplete bits', () => {
  const image = new Uint8Array(256);
  image[0] = 1;
  image[255] = 2;
  const tape = encodeCp2Memory(image);
  assert.deepEqual(Array.from(tape.slice(0, 5)), [16000000, 16035000, 16100000, 16165000, 16200000]);
  assert.deepEqual(Array.from(tape.slice(16, 21)), [16800000, 16865000, 16900000, 16935000, 17000000]);
  assert.throws(() => decodeCp2Memory(tape.slice(0, -1)), /Incomplete/);
  tape[1] = tape[0] + 1;
  assert.throws(() => decodeCp2Memory(tape), /timing/);
});

test('CP2 PC-side tape stays on the machine clock and restores across a snapshot', () => {
  const machine = new Cp1Machine({rom: new Uint8Array(2048)});
  machine.setPortInput(1, 0xf7, 0x08);
  machine.writeCpuPort(1, 0xbf);
  const transitions = new Uint32Array([100, 200, 300]);
  machine.playCassette(transitions);
  transitions[0] = 50; // playback owns a detached copy
  machine.advanceCycles(39);
  assert.equal(machine.readCpuPort(1), 0xb7);
  const beforeEdge = machine.saveState();
  machine.advanceCycles(1);
  assert.equal(machine.readCpuPort(1), 0x37);
  machine.advanceCycles(40);
  assert.equal(machine.readCpuPort(1), 0xb7);
  machine.loadState(beforeEdge);
  assert.equal(machine.readCpuPort(1), 0xb7);
  machine.advanceCycles(1);
  assert.equal(machine.readCpuPort(1), 0x37);
  machine.writeCpuPort(1, 0xff);
  assert.equal(machine.readCpuPort(1), 0xf7, 'save mode ignores the playback input');
  machine.writeCpuPort(1, 0xbf);
  machine.stopCassette();
  assert.equal(machine.readCpuPort(1), 0xb7);
});

test('a generated CP2 WAV recovers both RAM blocks and accepts a byte value of 255', () => {
  const image = Uint8Array.from({length: 512}, (_, i) => 255 ^ ((i * 113 + (i >>> 8)) & 255));
  const wave = encodeCp2Wave(encodeCp2Memory(image));
  assert.deepEqual(decodeCp2Memory(decodeCp2Wave(wave)), image);
  assert.throws(() => decodeCp2Wave(wave.slice(0, 48)), /Truncated/);
  assert.throws(() => encodeCp2Wave([2, 1]), /increase/);
});

function varyRecording(wave, speed) {
  const changed = wave.slice();
  const view = new DataView(changed.buffer);
  const rate = Math.round(view.getUint32(24, true) * speed);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  let noise = 7;
  for (let offset = 44; offset < view.byteLength; offset += 2) {
    noise = (Math.imul(noise, 1664525) + 1013904223) >>> 0;
    const gain = 0.2 + 0.1 * Math.sin(offset / (rate * 1.71));
    const sample = view.getInt16(offset, true);
    view.setInt16(offset, Math.round(sample * gain + (noise >>> 16) / 32 - 1024), true);
  }
  return changed;
}

test('CP2 WAV recovers both memory sizes with speed drift, varying level and noise', () => {
  for (const [length, speed] of [[256, 0.84], [512, 1.16]]) {
    const image = Uint8Array.from({length}, (_, i) => i * 113 + (i >>> 8));
    const wave = varyRecording(encodeCp2Wave(encodeCp2Memory(image)), speed);
    assert.deepEqual(decodeCp2Memory(decodeCp2Wave(wave)), image);
  }
});

test('CP2 audio ending in the payload leaves an incomplete image even in a well-formed WAV', () => {
  const wave = encodeCp2Wave(encodeCp2Memory(new Uint8Array(256)));
  const cut = wave.slice(0, wave.length - 32_000);
  const view = new DataView(cut.buffer);
  view.setUint32(4, cut.length - 8, true);
  view.setUint32(40, cut.length - 44, true);
  const edges = decodeCp2Wave(cut);
  assert.ok(edges.length > 16, 'partial audio still reaches the simulated monitor');
  assert.throws(() => decodeCp2Memory(edges), /Incomplete/);
});
