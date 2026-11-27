// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';
import {getDevice} from '../src/devices.js';
import {registerAllDevices} from '../src/register-all.js';
import {CARDIAC_TERMINALS, cardiacInputWord} from '../src/devices/cardiac.js';

registerAllDevices();
const image = (entries, entry = 1) => ({words: Object.entries(entries).map(([address, value]) => ({address: +address, value})), entry});
const echo = image({1: 80, 2: 580, 3: 801});
const part = (id = 'trainer', program = echo) => ({id, kind: 'cardiac', params: {program, instructionHz: 10}, terminals: [...CARDIAC_TERMINALS]});
const terminal = (part, name) => ({part, terminal: name});
const state = b => b.getDeviceState('trainer');
const command = (b, verb, value) => assert.equal(b.setDeviceControl('trainer', verb, value), true);
function bench(program = echo) {
  const board = new BoardImpl(5);
  board.setNetlist([
    part('trainer', program),
    {id: 'switch', kind: 'switch', params: {closed: false}, terminals: ['a', 'b']},
    {id: 'resistor', kind: 'resistor', params: {ohms: 1000}, terminals: ['a', 'b']},
    {id: 'lamp', kind: 'led', params: {vf: 2, color: 'red'}, terminals: ['anode', 'cathode']}
  ], [
    {id: 'power', terminals: [terminal('trainer', '5v'), terminal('switch', 'a')]},
    {id: 'input', terminals: [terminal('trainer', 'IN'), terminal('switch', 'b')]},
    {id: 'out', terminals: [terminal('trainer', 'OUT'), terminal('resistor', 'a')]},
    {id: 'led', terminals: [terminal('resistor', 'b'), terminal('lamp', 'anode')]},
    {id: 'ground', terminals: [terminal('trainer', 'gnd'), terminal('lamp', 'cathode')]}
  ]);
  return board;
}

test('CARDIAC has explicit modern terminals and starts paused on one authoritative machine', () => {
  assert.deepEqual(getDevice('cardiac').terminals, CARDIAC_TERMINALS);
  const b = bench();
  assert.equal(state(b).running, false); assert.equal(state(b).machine.pc, state(b).pc);
  assert.equal(state(b).memory, state(b).machine.memory);
  assert.ok(b.nodeVoltage('power') > 4.99); assert.ok(Math.abs(b.nodeVoltage('ground')) < 0.001);
  b.advanceTo(2_000_000_000n); assert.equal(state(b).steps, 0);
  assert.deepEqual(b.getWarnings(), []);
});

test('only explicit sampling creates one card; queuing or switching never executes an instruction', () => {
  const b = bench();
  b.setControl('switch', 1); b.advanceTo(1_000_000_000n);
  assert.ok(state(b).inputVoltage > 4.99); assert.deepEqual(state(b).inputQueue, []);
  command(b, 'sampleInput');
  assert.deepEqual(state(b).inputQueue, [999]); assert.deepEqual(state(b).inputSources, ['circuit']);
  assert.equal(state(b).sampledInput.value, 999); assert.equal(state(b).steps, 0);
  b.advanceTo(2_000_000_000n); assert.deepEqual(state(b).inputQueue, [999]);
  command(b, 'enqueueInput', [-42, 1]);
  assert.deepEqual(state(b).inputQueue, [999, -42, 1]);
  assert.deepEqual(state(b).inputSources, ['circuit', 'manual', 'manual']);
  assert.equal(state(b).steps, 0);
});

test('IN voltage uses clamped nearest decimal quantization and the solved circuit voltage', () => {
  for (const [voltage, word] of [[-2, 0], [0, 0], [2.5, 500], [5, 999], [12, 999]]) assert.equal(cardiacInputWord(voltage), word);
  assert.throws(() => cardiacInputWord(NaN));
  const b = bench(); command(b, 'sampleInput'); assert.deepEqual(state(b).inputQueue, [0]);
  b.setControl('switch', 1); command(b, 'sampleInput');
  assert.equal(state(b).inputQueue[1], cardiacInputWord(b.nodeVoltage('input') - b.nodeVoltage('ground')));
});

test('OUT001 lights a real resistor and LED; other numeric cards remain visible and drive low', () => {
  const b = bench(); command(b, 'enqueueInput', [1, 42, -7]); command(b, 'run');
  b.advanceTo(200_000_000n);
  assert.deepEqual(state(b).output, [1]); assert.equal(state(b).outputHigh, true);
  assert.ok(b.ledBrightnessNow('lamp') > 0.05); assert.ok(b.branchCurrent('resistor', 'a') < -0.002);
  b.advanceTo(500_000_000n);
  assert.deepEqual(state(b).output, [1, 42]); assert.equal(state(b).outputHigh, false);
  assert.ok(b.ledBrightnessNow('lamp') < 0.001);
  b.advanceTo(1_000_000_000n);
  assert.deepEqual(state(b).output, [1, 42, -7]); assert.equal(state(b).waiting, true);
  assert.equal(state(b).steps, 9); assert.equal(state(b).pc, 1);
  const count = state(b).steps;
  b.advanceTo(2_000_000_000n); assert.equal(state(b).steps, count);
  command(b, 'enqueueInput', 1); b.advanceTo(2_200_000_000n);
  assert.equal(state(b).output.at(-1), 1); assert.equal(state(b).outputHigh, true);
});

test('numeric tray clearing preserves the output latch; pause freezes CPU while input remains observable', () => {
  const b = bench(); command(b, 'enqueueInput', 1); command(b, 'run'); b.advanceTo(200_000_000n);
  command(b, 'pause'); command(b, 'clearOutput');
  assert.deepEqual(state(b).output, []); assert.equal(state(b).lastOutput, 1); assert.equal(state(b).outputHigh, true);
  b.setControl('switch', 1); b.advanceTo(1_000_000_000n);
  assert.ok(state(b).inputVoltage > 4.99); assert.equal(state(b).steps, 2); assert.equal(state(b).outputHigh, true);
});

test('coarse and fine Board advances have identical instruction, output and LED histories', () => {
  const program = image({1: 580, 2: 581, 3: 801, 80: 1, 81: 0});
  const execute = fine => {
    const b = bench(program); command(b, 'run');
    if (fine) for (let i = 1; i <= 100; i++) b.advanceTo(BigInt(i) * 10_000_000n);
    else b.advanceTo(1_000_000_000n);
    return {steps: state(b).steps, pc: state(b).pc, output: [...state(b).output],
      visible: b.ledBrightness('lamp'), current: b.branchCurrent('resistor', 'a')};
  };
  const coarse = execute(false), fine = execute(true);
  assert.equal(coarse.steps, 10); assert.deepEqual(coarse.output, [1, 0, 1, 0, 1, 0, 1]);
  assert.deepEqual(fine.output, coarse.output); assert.equal(fine.pc, coarse.pc);
  assert.equal(fine.steps, coarse.steps); assert.ok(Math.abs(fine.visible - coarse.visible) < 1e-9);
  assert.ok(Math.abs(fine.current - coarse.current) < 1e-9);
});

test('program persistence preserves live STO, while reset restores the authored image', () => {
  const program = image({1: 100, 2: 680, 3: 801, 80: 77});
  const b = bench(program); command(b, 'run'); b.advanceTo(200_000_000n);
  assert.equal(state(b).memory[80], 1);
  b.setPartParam('trainer', 'program', JSON.parse(JSON.stringify(program)));
  assert.equal(state(b).steps, 2); assert.equal(state(b).pc, 3); assert.equal(state(b).memory[80], 1);
  assert.equal(state(b).running, true);
  command(b, 'reset'); assert.equal(state(b).memory[80], 77); assert.equal(state(b).pc, 1); assert.equal(state(b).running, false);
  const before = JSON.stringify(state(b).program);
  assert.equal(b.setDeviceControl('trainer', 'loadProgram', image({0: 999})), false);
  assert.equal(JSON.stringify(state(b).program), before);
});

test('Board breakpoint and manual step operate on the same machine', () => {
  const b = bench(image({1: 200, 2: 801})); command(b, 'setBreakpoint', 1); command(b, 'run');
  b.advanceTo(100_000_000n); assert.equal(state(b).steps, 0); assert.equal(state(b).lastBreakpoint, 1);
  command(b, 'step'); assert.equal(state(b).acc, 1); assert.equal(state(b).steps, 1); assert.equal(state(b).pc, 2);
  assert.equal(state(b).running, false); assert.equal(state(b).machine.acc, state(b).acc);
});

test('multiple CARDIAC parts keep queues, memory, clocks and outputs independent', () => {
  const b = new BoardImpl(5);
  b.setNetlist([part('one'), part('two')], [{id: 'ground', terminals: [terminal('one', 'gnd'), terminal('two', 'gnd')]}]);
  assert.equal(b.setDeviceControl('one', 'enqueueInput', 1), true); assert.equal(b.setDeviceControl('one', 'run'), true);
  b.advanceTo(200_000_000n);
  assert.deepEqual(b.getDeviceState('one').output, [1]); assert.deepEqual(b.getDeviceState('two').output, []);
  assert.equal(b.getDeviceState('two').steps, 0); assert.equal(b.getDeviceState('two').memory[80], 0);
});
