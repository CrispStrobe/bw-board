// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';
import {getDevice} from '../src/devices.js';
import {registerAllDevices} from '../src/register-all.js';
import {MICROTRONIC_TERMINALS} from '../src/devices/microtronic.js';
import {MICROTRONIC_DEMOS} from '../src/microtronic-machine.js';

registerAllDevices();
const terminal = (part, name) => ({part, terminal: name});
const part = (id = 'trainer', program = MICROTRONIC_DEMOS.echo.program) => ({
  id, kind: 'busch-microtronic', params: {program, instructionHz: 20}, terminals: [...MICROTRONIC_TERMINALS]
});

function echoBoard(clock = false) {
  const board = new BoardImpl(5);
  board.setNetlist([
    part(),
    {id: 'switch', kind: 'switch', params: {closed: false}, terminals: ['a', 'b']},
    {id: 'resistor', kind: 'resistor', params: {ohms: 1000}, terminals: ['a', 'b']},
    {id: 'lamp', kind: 'led', params: {vf: 2, color: 'red'}, terminals: ['anode', 'cathode']}
  ], [
    {id: 'power', terminals: [terminal('trainer', '5v'), terminal('switch', 'a')]},
    {id: 'input', terminals: [terminal('trainer', 'IN1'), terminal('switch', 'b')]},
    {id: 'out', terminals: [terminal('trainer', 'OUT1'), terminal('resistor', 'a')]},
    {id: 'led', terminals: [terminal('resistor', 'b'), terminal('lamp', 'anode')]},
    {id: 'ground', terminals: [terminal('trainer', 'gnd'), terminal('lamp', 'cathode')]},
    {id: 'clock', terminals: [terminal('trainer', 'CLOCK'), ...(clock ? [terminal('trainer', 'IN4')] : [])]}
  ]);
  return board;
}
const state = board => board.getDeviceState('trainer');
const command = (board, verb, value) => assert.equal(board.setDeviceControl('trainer', verb, value), true);

test('Microtronic registration supplies only real external terminals and starts halted', () => {
  assert.deepEqual(getDevice('busch-microtronic').terminals, MICROTRONIC_TERMINALS);
  const board = echoBoard();
  assert.equal(state(board).running, false); assert.equal(state(board).input, 0);
  assert.ok(board.nodeVoltage('power') > 4.99); assert.ok(board.nodeVoltage('ground') < 0.001);
  board.advanceTo(2_000_000_000n); assert.equal(state(board).executed, 0);
  assert.deepEqual(board.getWarnings(), []);
});

test('a real switch → DIN/DOT program → resistor/LED follows one Board timeline and holds when halted', () => {
  const board = echoBoard();
  command(board, 'run', 0); board.advanceTo(150_000_000n);
  assert.equal(state(board).output, 0); assert.ok(board.ledBrightnessNow('lamp') < 0.001);
  board.setControl('switch', 1);
  assert.equal(state(board).input & 1, 1); assert.equal(state(board).output, 0, 'switch does not execute a word');
  board.advanceTo(300_000_000n);
  assert.equal(state(board).output, 1); assert.ok(board.ledBrightnessNow('lamp') > 0.05);
  assert.ok(board.branchCurrent('resistor', 'a') < -0.002, 'solved current enters resistor terminal a and drives the lamp');
  command(board, 'halt'); const count = state(board).executed;
  board.setControl('switch', 0); board.advanceTo(600_000_000n);
  assert.equal(state(board).input & 1, 0); assert.equal(state(board).output, 1); assert.equal(state(board).executed, count);
  command(board, 'run'); board.advanceTo(750_000_000n);
  assert.equal(state(board).output, 0); assert.ok(board.ledBrightnessNow('lamp') < 0.001);
  assert.equal(board.timeNs, 750_000_000n);
});

test('output counter is instruction-clocked and independent of host advance chunk sizes', () => {
  const run = chunks => {
    const board = echoBoard(); command(board, 'loadProgram', MICROTRONIC_DEMOS.counter.program); command(board, 'run', 0);
    for (const time of chunks) board.advanceTo(time);
    return {output: state(board).output, registers: [...state(board).registers], pc: state(board).pc, executed: state(board).executed};
  };
  const once = run([1_000_000_000n]);
  assert.equal(once.executed, 20); assert.equal(once.output, 6);
  assert.deepEqual(run(Array.from({length: 100}, (_, i) => BigInt(i + 1) * 10_000_000n)), once);
});

test('visible LED brightness records scheduled DOT transitions inside a coarse advance', () => {
  const run = fine => {
    const board = echoBoard(); command(board, 'run', 0); board.advanceTo(200_000_000n);
    board.setControl('switch', 1);
    if (fine) for (let t = 210_000_000n; t <= 450_000_000n; t += 10_000_000n) board.advanceTo(t);
    else board.advanceTo(450_000_000n);
    return {visible: board.ledBrightness('lamp'), current: board.branchCurrent('resistor', 'a'), output: state(board).output};
  };
  const coarse = run(false), fine = run(true);
  assert.equal(coarse.output, 1); assert.ok(coarse.current < -0.002);
  assert.ok(coarse.visible > 0.1, 'a DOT completed before the perception window must light the visible LED');
  assert.ok(Math.abs(coarse.visible - fine.visible) < 1e-9, 'visible brightness cannot depend on rendering advance chunks');
});

test('CLOCK is a separate 1 Hz terminal; only a physical wire to IN4 clocks the time register', () => {
  for (const connected of [false, true]) {
    const board = echoBoard(connected);
    for (const key of ['HALT', 'PGM', '3', '0', '0', '0', '0']) command(board, 'key', key);
    board.advanceTo(499_999_999n); assert.equal(state(board).clockHigh, false); assert.equal(state(board).timeSeconds, 0);
    board.advanceTo(500_000_000n);
    assert.equal(state(board).clockHigh, true); assert.ok(board.nodeVoltage('clock') > 4.8);
    assert.equal(state(board).input & 8, connected ? 8 : 0);
    assert.equal(state(board).timeSeconds, connected ? 1 : 0);
    board.advanceTo(1_000_000_000n); assert.equal(state(board).clockHigh, false); assert.ok(board.nodeVoltage('clock') < 0.01);
    board.advanceTo(1_500_000_000n); assert.equal(state(board).timeSeconds, connected ? 2 : 0);
  }
});

test('all four terminals retain their binary weights through external output/input loopback', () => {
  for (const value of [1, 2, 4, 8, 15]) {
    const board = new BoardImpl(5);
    board.setNetlist([part('trainer', `1${value.toString(16)}0 FE0 FD1 F00`)], [
      {id: 'ground', terminals: [terminal('trainer', 'gnd')]},
      ...Array.from({length: 4}, (_, i) => ({id: `loop${i}`, terminals: [terminal('trainer', `OUT${i + 1}`), terminal('trainer', `IN${i + 1}`)]}))
    ]);
    command(board, 'run', 0); board.advanceTo(200_000_000n);
    assert.equal(state(board).registers[1], value); assert.equal(state(board).output, value);
    assert.equal(state(board).running, false);
  }
});

test('program persistence and control reset do not erase program or restart on an equal params write', () => {
  const board = echoBoard(); command(board, 'run', 0); board.advanceTo(100_000_000n);
  const source = state(board).programSource, count = state(board).executed, pc = state(board).pc;
  board.setPartParam('trainer', 'program', source);
  assert.equal(state(board).executed, count); assert.equal(state(board).pc, pc); assert.equal(state(board).running, true);
  command(board, 'reset'); assert.equal(state(board).programSource, source); assert.equal(state(board).pc, 0);
  assert.equal(state(board).running, false); assert.equal(state(board).output, 0);
  const before = [...state(board).program];
  assert.equal(board.setDeviceControl('trainer', 'loadProgram', 'NOPE'), false);
  assert.deepEqual(state(board).program, before);
  assert.match(board.getWarnings().map(w => JSON.stringify(w)).join(' '), /three-digit/);
  command(board, 'key', 'HALT'); command(board, 'key', '1'); command(board, 'key', 'A'); command(board, 'key', '0'); command(board, 'key', 'NEXT');
  const edited = state(board).programSource;
  board.setPartParam('trainer', 'program', edited);
  assert.equal(state(board).pc, 1, 'persisting a keyed word cannot reset the front panel');
  board.reset(); assert.equal(state(board).programSource, edited); assert.equal(board.timeNs, 0n);
});

test('two Microtronics own separate programs and cannot control one another', () => {
  const board = new BoardImpl(5);
  board.setNetlist([part('one', '1A0 FE0 F00'), part('two', '150 FE0 F00')], [
    {id: 'ground', terminals: [terminal('one', 'gnd'), terminal('two', 'gnd')]}
  ]);
  assert.equal(board.setDeviceControl('one', 'run', 0), true); board.advanceTo(150_000_000n);
  assert.equal(board.getDeviceState('one').output, 10); assert.equal(board.getDeviceState('two').output, 0);
  assert.equal(board.setDeviceControl('two', 'run', 0), true); board.advanceTo(300_000_000n);
  assert.equal(board.getDeviceState('one').output, 10); assert.equal(board.getDeviceState('two').output, 5);
});
