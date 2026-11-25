// SPDX-License-Identifier: MIT
// Independent expected instruction vectors were derived from the Busch manual
// before inspecting this implementation. No ROM or emulator source is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  createMicrotronicMachine, parseMicrotronicProgram, formatMicrotronicProgram,
  stepMicrotronicMachine, refreshMicrotronicDisplay, controlMicrotronicMachine,
  observeMicrotronicInputs, MICROTRONIC_DEMOS
} from '../src/microtronic-machine.js';

const vectors = JSON.parse(readFileSync(new URL('./fixtures/microtronic/documented-vectors.json', import.meta.url), 'utf8')).vectors;
for (const vector of vectors) test(`manual p.${vector.printed_page}: ${vector.name}`, () => {
  const machine = createMicrotronicMachine(vector.opcode);
  machine.running = true; machine.mode = 'run';
  const aliases = {inputs: 'input', outputs: 'output'};
  for (const [key, value] of Object.entries(vector.initial)) {
    if (key === 'registers' || key === 'storage') {
      for (const [register, digit] of Object.entries(value)) machine[key][parseInt(register, 16)] = digit;
    } else machine[aliases[key] || key] = value;
  }
  stepMicrotronicMachine(machine, {singleStep: false});
  refreshMicrotronicDisplay(machine);
  for (const [key, value] of Object.entries(vector.expected)) {
    if (key === 'registers' || key === 'storage') {
      for (const [register, digit] of Object.entries(value)) assert.equal(machine[key][parseInt(register, 16)], digit, `${key}[${register}]`);
    } else assert.equal(machine[aliases[key] || key], value, key);
  }
});

const key = (machine, ...keys) => keys.forEach(value => assert.equal(controlMicrotronicMachine(machine, 'key', value), true));
const execute = (machine, count) => { for (let i = 0; i < count; i++) stepMicrotronicMachine(machine, {singleStep: false}); };

test('program parser preserves 00–FF addresses and refuses corrupt input atomically', () => {
  const words = parseMicrotronicProgram('00: 1a0 FE0 ; output\nFF: F00');
  assert.equal(words[0], 0x1A0); assert.equal(words[1], 0xFE0); assert.equal(words[255], 0xF00);
  assert.deepEqual(parseMicrotronicProgram(formatMicrotronicProgram(words)), words);
  const machine = createMicrotronicMachine(MICROTRONIC_DEMOS.echo.program);
  for (const input of ['', '1234', 'G00', '100\n00: 200', 'FF: F00 F00', Array(257).fill(0), [-1], [4096], null]) {
    const before = structuredClone(machine);
    assert.throws(() => controlMicrotronicMachine(machine, 'loadProgram', input));
    assert.deepEqual(machine, before, 'failed imports cannot partially overwrite memory or reset registers');
  }
});

test('CALL and RET use one return slot, branches preserve flags, PC wraps at FF', () => {
  const machine = createMicrotronicMachine('00: B04 1A0 F00\n04: 120 F07');
  machine.carry = true; machine.zero = false;
  execute(machine, 3);
  assert.equal(machine.pc, 1); assert.equal(machine.registers[0], 2); assert.equal(machine.carry, true);
  execute(machine, 1); assert.equal(machine.registers[0], 10);
  machine.program[255] = 0xF01; machine.pc = 255;
  execute(machine, 1); assert.equal(machine.pc, 0);
  machine.pc = 0; machine.program[0] = 0xB04; machine.program[4] = 0xB08;
  execute(machine, 2); assert.equal(machine.returnAddress, 5, 'nested CALL overwrites the single return address');
  machine.program[8] = 0xF07; execute(machine, 1); assert.equal(machine.pc, 5);
});

test('HALT holds its address in RUN, STEP moves past it, and an unwritten program is safely halted', () => {
  const machine = createMicrotronicMachine('F00 1A0 F00');
  key(machine, 'RUN'); execute(machine, 1);
  assert.equal(machine.running, false); assert.equal(machine.pc, 0); assert.equal(machine.display, '00 F00');
  key(machine, 'STEP'); assert.equal(machine.pc, 1);
  key(machine, 'RUN'); execute(machine, 2);
  assert.equal(machine.registers[0], 10); assert.equal(machine.pc, 2); assert.equal(machine.running, false);
});

test('KIN waits without repeating a key and DOT holds its value until another DOT', () => {
  const machine = createMicrotronicMachine('FF2 FE2 FF3 FE3 F00');
  key(machine, 'RUN'); execute(machine, 4);
  assert.equal(machine.waitingForKey, 2); assert.equal(machine.executed, 1); assert.equal(machine.pc, 0);
  key(machine, 'A'); assert.equal(machine.pc, 1); assert.equal(machine.registers[2], 10);
  execute(machine, 2);
  assert.equal(machine.output, 10); assert.equal(machine.waitingForKey, 3);
  execute(machine, 8); assert.equal(machine.output, 10); assert.equal(machine.registers[3], 0);
  key(machine, '5'); execute(machine, 2);
  assert.equal(machine.output, 5); assert.equal(machine.running, false);
});

test('keypad edits commit only on NEXT; C/CE backs one digit then clears all', () => {
  const machine = createMicrotronicMachine('F00');
  key(machine, 'HALT', 'NEXT', '1', '0', '1', '2', '3');
  assert.equal(machine.pc, 0x10); assert.equal(machine.program[0x10], 0xF00);
  key(machine, 'C/CE'); assert.equal(machine.entry, '12');
  key(machine, 'C/CE'); assert.equal(machine.entry, '000');
  key(machine, '1', 'A', '0', 'NEXT');
  assert.equal(machine.program[0x10], 0x1A0); assert.equal(machine.pc, 0x11);
  assert.equal(parseMicrotronicProgram(machine.programSource)[0x10], 0x1A0);
  key(machine, 'NEXT'); assert.equal(machine.pc, 0x12, 'NEXT after address selection advances without another address prompt');
  key(machine, 'A', 'B', 'C', 'C/CE', 'C/CE', 'NEXT');
  assert.equal(machine.program[0x12], 0, 'a twice-cleared word can be committed as 000');
  key(machine, 'HALT', 'REG', 'E', '7'); assert.equal(machine.registers[14], 7);
});

test('breakpoint entry is enforced before execution, resumes once, and 00 disables it', () => {
  const machine = createMicrotronicMachine(MICROTRONIC_DEMOS.counter.program);
  key(machine, 'HALT', 'BKP', '0', '1', 'RUN'); execute(machine, 2);
  assert.equal(machine.pc, 1); assert.equal(machine.running, false); assert.equal(machine.executed, 1);
  key(machine, 'RUN'); execute(machine, 1); assert.equal(machine.executed, 2);
  key(machine, 'HALT', 'BKP', '0', '0', 'HALT'); assert.equal(machine.breakpoint, null);
});

test('RESET retains user words, clears both register banks and time; PGM5/6 are explicit fills', () => {
  const machine = createMicrotronicMachine(MICROTRONIC_DEMOS.counter.program);
  const source = machine.programSource;
  machine.registers[2] = 5; machine.storage[5] = 9; machine.output = 15; machine.timeSeconds = 1234;
  key(machine, 'RESET');
  assert.equal(machine.programSource, source); assert.deepEqual(machine.registers, Array(16).fill(0));
  assert.deepEqual(machine.storage, Array(16).fill(0)); assert.equal(machine.output, 0); assert.equal(machine.timeSeconds, 0);
  assert.equal(machine.running, false); assert.equal(machine.pc, 0);
  key(machine, 'PGM', '5'); assert.ok(machine.program.every(word => word === 0));
  key(machine, 'HALT', 'PGM', '6'); assert.ok(machine.program.every(word => word === 0xF01));
  key(machine, 'HALT', 'PGM', '0'); assert.match(machine.error, /not implemented/);
});

test('clock setting and TIME use explicit input4 rising transitions; held high is one tick', () => {
  const machine = createMicrotronicMachine('F06 F00');
  key(machine, 'HALT', 'PGM', '3', '2', '3', '5', '9');
  assert.equal(machine.display, '235900');
  for (let i = 0; i < 60; i++) {
    observeMicrotronicInputs(machine, 8); observeMicrotronicInputs(machine, 8); observeMicrotronicInputs(machine, 0);
  }
  assert.equal(machine.display, '000000');
  key(machine, 'HALT', 'STEP');
  assert.deepEqual(machine.registers.slice(10), [0, 0, 0, 0, 0, 0]);
});

test('RND preserves flags and produces deterministic bounded nibbles; undefined DZHX digits refuse visibly', () => {
  const machine = createMicrotronicMachine('F05 F04');
  machine.carry = true; machine.zero = false; execute(machine, 1);
  assert.equal(machine.carry, true); assert.equal(machine.zero, false);
  assert.ok(machine.registers.slice(13).every(n => n >= 0 && n <= 15));
  machine.registers[13] = 10; execute(machine, 1);
  assert.match(machine.error, /not modeled/); assert.equal(machine.running, false);
});
