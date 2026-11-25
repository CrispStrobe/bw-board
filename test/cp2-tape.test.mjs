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
