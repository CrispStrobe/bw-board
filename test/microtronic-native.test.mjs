// SPDX-License-Identifier: MIT
import assert from 'node:assert/strict';
import test from 'node:test';
import {BoardImpl} from '../src/board.js';
import {registerAllDevices} from '../src/register-all.js';
import {MICROTRONIC_TERMINALS} from '../src/devices/microtronic.js';
import {MicrotronicNative} from '../src/microtronic-native.js';
import {microtronicNativeMonitorRom} from '../src/microtronic-native-monitor.js';

registerAllDevices();
const echo = 'FD0\nFE0\nC00';
const terminal = (part, name) => ({part, terminal: name});

function makeBoard() {
  const board = new BoardImpl(5);
  board.setNetlist([
    {id: 'trainer', kind: 'busch-microtronic', params: {program: echo, executionMode: 'tms1600'},
      terminals: [...MICROTRONIC_TERMINALS]},
    {id: 'switch', kind: 'switch', params: {closed: false}, terminals: ['a', 'b']},
    {id: 'limit', kind: 'resistor', params: {ohms: 1000}, terminals: ['a', 'b']},
    {id: 'lamp', kind: 'led', params: {vf: 2, color: 'red'}, terminals: ['anode', 'cathode']}
  ], [
    {id: 'supply', terminals: [terminal('trainer', '5v'), terminal('switch', 'a')]},
    {id: 'input', terminals: [terminal('switch', 'b'), terminal('trainer', 'IN1')]},
    {id: 'output', terminals: [terminal('trainer', 'OUT1'), terminal('limit', 'a')]},
    {id: 'lamp', terminals: [terminal('limit', 'b'), terminal('lamp', 'anode')]},
    {id: 'ground', terminals: [terminal('trainer', 'gnd'), terminal('lamp', 'cathode')]}
  ]);
  return board;
}

test('the ROM boots on the native core and Run reads a real solver switch and lights a wired LED', () => {
  assert.equal(microtronicNativeMonitorRom.length, 4096);
  const board = makeBoard();
  const state = board.getDeviceState('trainer');
  assert.equal(state.model, 'tms1600');
  assert.equal(state.pc, 0);
  assert.ok(state.nativeInstructions > 0);
  assert.equal(state.running, false);

  board.setControl('switch', 1);
  assert.equal(state.input, 1);
  assert.equal(board.setDeviceControl('trainer', 'run'), true);
  assert.equal(state.executed, 0);
  board.advanceTo(50_000_000n);
  assert.equal(state.executed, 1);
  assert.equal(state.pc, 1);
  assert.equal(state.registers[0], 1);
  assert.equal(state.output, 0);
  board.advanceTo(125_000_000n);
  assert.equal(state.executed, 2);
  assert.equal(state.output, 1);
  assert.ok(board.ledBrightnessNow('lamp') > 0.05);
  assert.equal(board.setDeviceControl('trainer', 'halt'), true);
  board.advanceTo(1_000_000_000n);
  assert.equal(state.executed, 2);
  assert.equal(state.output, 1);
});

test('one physical-style STEP executes one word and ROM keypad editing persists to external program RAM', () => {
  const machine = new MicrotronicNative('@ 20\n1A0\nFE0\nF00');
  machine.control('setPc', 0x20);
  assert.equal(machine.pc, 0x20);
  assert.equal(machine.control('step'), true);
  assert.equal(machine.pc, 0x21);
  assert.equal(machine.registers[0], 10);
  assert.equal(machine.executed, 1);
  assert.equal(machine.running, false);
  machine.control('setPc', 0x23);
  for (const key of ['1', 'B', '0', 'NEXT']) assert.equal(machine.press(key), true);
  assert.equal(machine.program[0x23], 0x1b0);
  assert.match(machine.programSource, /23: 1B0/);
  machine.reset();
  assert.equal(machine.pc, 0);
  assert.equal(machine.program[0x23], 0x1b0);
  assert.equal(machine.registers[0], 0);
});

test('mode selection keeps accepted source and switches back to the existing learner engine', () => {
  const board = makeBoard();
  const state = board.getDeviceState('trainer');
  const accepted = state.programSource;
  board.setPartParam('trainer', 'executionMode', 'documented-behavior');
  assert.equal(state.model, 'documented-behavior');
  assert.equal(state.programSource, accepted);
  assert.equal(state.nativeAddress, undefined);
  board.setPartParam('trainer', 'executionMode', 'tms1600');
  assert.equal(state.model, 'tms1600');
  assert.equal(state.programSource, accepted);
  assert.ok(state.nativeInstructions > 0);
});

test('guest decimal conversion retires in the ROM and KIN waits for one hex key', () => {
  const machine = new MicrotronicNative('1FD\n1AE\n12F\nF03\nFF6\nF00');
  for (let i = 0; i < 4; i++) machine.press('STEP');
  assert.equal(machine.pc, 4);
  assert.equal(machine.executed, 4);
  assert.deepEqual(machine.registers.slice(13), [7, 8, 6]);
  machine.press('STEP');
  assert.equal(machine.pc, 4);
  assert.equal(machine.waitingForKey, true);
  assert.equal(machine.executed, 4);
  machine.press('3');
  assert.equal(machine.pc, 5);
  assert.equal(machine.waitingForKey, null);
  assert.equal(machine.registers[6], 3);
  assert.equal(machine.executed, 5);
});

test('firmware clock counts IN4 edges and reports unavailable cassette commands', () => {
  const machine = new MicrotronicNative('F06\nF00');
  for (const key of ['PGM', '3', '2', '3', '5', '9']) machine.press(key);
  assert.equal(machine.display, '235900');
  for (let i = 0; i < 59; i++) {
    machine.sampleInputs(8);
    machine.sampleInputs(0);
  }
  assert.equal(machine.display, '235959');
  machine.sampleInputs(8);
  machine.sampleInputs(8);
  assert.equal(machine.display, '000000');
  machine.press('STEP');
  assert.deepEqual(machine.registers.slice(10), [0, 0, 0, 0, 0, 0]);
  machine.press('PGM');
  machine.press('1');
  assert.match(machine.error, /unavailable/);
  machine.press('HALT');
  assert.equal(machine.error, null);
});
