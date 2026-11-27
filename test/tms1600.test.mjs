// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import {Tms1600, nextTms1600Word} from '../src/tms1600.js';
import {assembleTms1600} from '../src/tms1600-assembler.js';

const page = (code, number = 15, chapter = 0) => ({chapter, page: number, code});
const cpuFor = (code, io) => new Tms1600(assembleTms1600([page(code)]).rom, io);
const advance = (cpu, count) => { for (let i = 0; i < count; i++) cpu.step(); };

test('physical ROM layout uses a complete 64-position sequence and fixed reset location', () => {
  let word = 0;
  const actual = [];
  for (let i = 0; i < 64; i++) {
    actual.push(word);
    word = nextTms1600Word(word);
  }
  assert.deepEqual(actual.slice(0, 16), [0, 1, 3, 7, 15, 31, 63, 62, 61, 59, 55, 47, 30, 60, 57, 51]);
  assert.equal(new Set(actual).size, 64);
  assert.equal(word, 0);
  assert.equal(cpuFor(['CLA']).address, 0x3c0);
});

test('TI immediate fields are reversed and resolve to the intended memory address', () => {
  const {rom, symbols} = assembleTms1600([page(['start:', ['LDX', 5], ['TCY', 3], ['TCMIY', 9], 'DYN', 'TMA'])]);
  assert.deepEqual([rom[0x3c0], rom[0x3c1], rom[0x3c3]], [0x2d, 0x4c, 0x69]);
  assert.equal(symbols.start, 0x3c0);
  const cpu = new Tms1600(rom);
  advance(cpu, 5);
  assert.equal(cpu.ram[0x53], 9);
  assert.equal(cpu.a, 9);
  assert.equal(cpu.y, 3);
});

test('conditionally taken branch consumes status and TDO uses the independent status latch', () => {
  const pins = [];
  const cpu = cpuFor([
    'CLA', ['TCY', 0], 'YNEA', ['BR', 'finish'], ['AC1AC', 1],
    'YNEA', 'TDO', 'finish:', ['BR', 'finish']
  ], {writePins: (o, r) => pins.push([o, r])});
  advance(cpu, 7);
  assert.equal(cpu.a, 2);
  assert.deepEqual(pins, [[0, 0], [18, 0]]);
});

test('nested calls cross chapter and page and return to the next LFSR word', () => {
  const rom = assembleTms1600([
    page([['CHAPTER', 'middle'], 'TPC', ['PAGE', 'middle'], ['CALL', 'middle'], 'done:', ['BR', 'done']]),
    page(['middle:', ['CHAPTER', 'inner'], 'TPC', ['PAGE', 'inner'], ['CALL', 'inner'], 'RETN'], 4, 1),
    page(['inner:', ['AC1AC', 10], 'RETN'], 9, 2)
  ]);
  const cpu = new Tms1600(rom.rom);
  advance(cpu, 12);
  assert.equal(cpu.address, rom.symbols.done);
  assert.equal(cpu.a, 11);
  assert.equal(cpu.stack.length, 0);
});

test('I/O uses R latch selectors, a host-sampled K nibble, and the supplied O PLA', () => {
  const outputPla = new Uint8Array(32);
  outputPla[6] = 0xa5;
  const observed = [];
  const cpu = cpuFor([['TCY', 15], 'SETR', 'TKA', 'TDO', 'RSTR'], {
    readK: (_, r) => r === 0x8000 ? 6 : 0,
    writePins: (o, r) => observed.push([o, r]),
    outputPla
  });
  advance(cpu, 5);
  assert.deepEqual(observed, [[0, 0], [0, 0x8000], [0xa5, 0x8000], [0xa5, 0]]);
});

test('assembler rejects overfull pages and undefined branch targets', () => {
  assert.throws(() => assembleTms1600([page(Array(65).fill('CLA'))]), /Overlapping/);
  assert.throws(() => assembleTms1600([page([['BR', 'absent']])]), /Unknown TMS1600 label/);
});
