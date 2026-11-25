// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync} from 'node:fs';
import {parseArgs} from 'node:util';
import {Cp1Machine} from '../src/cp1-machine.js';
import {decodeCp2Memory, encodeCp2Memory, recordCp2Signal} from '../src/cp2-tape.js';
import {decodeCp2Wave, encodeCp2Wave} from '../src/cp2-wave.js';

const {values: options} = parseArgs({options: {
  oracle: {type: 'string'}, candidate: {type: 'string'}, expansion: {type: 'boolean'},
  faults: {type: 'boolean'}, report: {type: 'string'},
}});
if (!options.oracle || !options.candidate) {
  throw new Error('Usage: node scripts/check-cp2-roms.mjs --oracle ROM.bin --candidate ROM.bin [--expansion|--faults] [--report report.json]');
}
const readRom = path => new Uint8Array(readFileSync(path));
const oracle = readRom(options.oracle);
const candidate = readRom(options.candidate);
const sha1 = rom => createHash('sha1').update(rom).digest('hex');
assert.equal(sha1(oracle), 'ff4befcf82a664950186d3af1843fdef70d2209f');
assert.notEqual(sha1(oracle), sha1(candidate));
const expansion = Boolean(options.expansion);
const size = expansion ? 512 : 256;
const seed = Uint8Array.from({length: size}, (_, index) => ((index * 113) ^ (index >>> 3) ^ (index >>> 8) ^ 0xfa) & 255);
const masks = prefix => [prefix, 0, 0x80, 0, 0, 0];
const error = [0x71, 0, 0x80, 0x3f, 0x3f, 0x27];

function setup(rom) {
  const machine = new Cp1Machine({rom, expansion});
  const advance = ms => {
    for (let remaining = ms; remaining > 0; remaining -= 500) {
      const result = machine.advanceCycles(Math.round(Math.min(500, remaining) * 400));
      assert.ok(result.reached);
    }
  };
  const key = name => {
    machine.setKey(name, true);
    advance(60);
    machine.setKey(name, false);
    advance(90);
  };
  const ram = () => Uint8Array.from({length: size}, (_, i) => {
    const {opcode, operand} = machine.readCell(i >>> 1);
    return i & 1 ? operand : opcode;
  });
  const load = bytes => {
    for (let i = 0; i < size; i += 2) machine.writeCell(i >>> 1, bytes[i], bytes[i + 1]);
  };
  advance(150);
  machine.loadProgram([{opcode: 4, operand: 0x2c}, {opcode: 17, operand: 0}, {opcode: 1, operand: 0}]);
  key('RUN');
  assert.equal(machine.getPortState(1).latch, 0x2c);
  machine.loadProgram([], {clear: true});
  for (const name of ['0', '0', '0', 'PC']) key(name);
  return {machine, advance, key, ram, load, display: () => machine.getDisplay().digits};
}

function save(rom) {
  const {machine, advance, key, ram, load, display} = setup(rom);
  load(seed);
  const recording = recordCp2Signal(machine);
  key('CAS');
  assert.deepEqual(display(), masks(0x23));
  const limit = machine.tMs + (expansion ? 470_000 : 250_000);
  while (!recording.finished && machine.tMs < limit) advance(1000);
  assert.ok(recording.finished, 'CAS reached the final falling edge');
  const tape = recording.stop();
  assert.deepEqual(decodeCp2Memory(tape), seed);
  assert.deepEqual(ram(), seed);
  advance(100);
  assert.deepEqual(display(), masks(0x63));
  assert.equal(machine.getPortState(1).latch, 0x6c);
  const timings = {leaderMs: tape[0] / 1000, durationMs: tape.at(-1) / 1000, edges: tape.length};
  assert.ok(timings.leaderMs >= 16_000 && timings.leaderMs <= 17_000);
  console.log(sha1(rom), size, 'CAS bytes match', timings);
  return {tape, timings};
}

function load(rom, tape, expected) {
  const {machine, advance, key, ram, display} = setup(rom);
  machine.playCassette(tape);
  key('CAL');
  assert.deepEqual(display(), masks(0x1c));
  advance(tape.at(-1) / 1000 + 1200);
  assert.deepEqual(display(), masks(0x5c));
  assert.equal(machine.getPortState(1).latch, 0xac);
  assert.deepEqual(ram(), expected);
  console.log(sha1(rom), size, 'CAL bytes match');
}

function faults(rom) {
  const ready = () => setup(rom);
  {
    const {machine, advance, key, display} = ready();
    const recording = recordCp2Signal(machine);
    key('CAS');
    advance(400);
    key('STP');
    assert.deepEqual(display(), masks(0x63));
    advance(1_000);
    assert.ok(recording.stop().length <= 1, 'abort does not transmit a body');
  }
  {
    const {advance, key, display} = ready();
    key('CAL');
    advance(1400);
    assert.deepEqual(display(), masks(0x1c));
    key('STP');
    assert.deepEqual(display(), masks(0x5c));
  }
  {
    const {machine, advance, key, ram, display} = ready();
    const tape = encodeCp2Memory(seed);
    const body = tape.slice(0, 1 + 3 * 16 + 7);
    // Use a short valid leader so this case isolates a missing edge.
    const shortTape = Uint32Array.from(body, time => time - 15_400_000);
    machine.playCassette(shortTape);
    key('CAL');
    advance(shortTape.at(-1) / 1000 + 1_500);
    assert.deepEqual(display(), error);
    const expected = new Uint8Array(size);
    for (const address of [0, 255, 254]) expected[address] = seed[address];
    assert.deepEqual(ram(), expected, 'complete bytes survive and the interrupted byte is untouched');
    key('PC');
    assert.deepEqual(display(), [0x73, 0, 0x80, 0x3f, 0x3f, 0x3f]);
  }
  console.log(sha1(rom), 'abort and truncated-input recovery passed');
}

const result = {expansion, size, oracleSha1: sha1(oracle), candidateSha1: sha1(candidate)};
if (options.faults) {
  faults(oracle);
  faults(candidate);
  result.abortAndTruncation = true;
} else {
  const reference = save(oracle);
  const replacement = save(candidate);
  const wave = encodeCp2Wave(replacement.tape);
  const waveTape = decodeCp2Wave(wave);
  assert.deepEqual(decodeCp2Memory(waveTape), seed);
  load(candidate, reference.tape, seed);
  load(oracle, waveTape, seed);
  result.oracleSave = reference.timings;
  result.candidateSave = replacement.timings;
  result.crossLoad = true;
  result.wavBytes = wave.length;
}
if (options.report) writeFileSync(options.report, JSON.stringify(result, null, 2) + '\n');
