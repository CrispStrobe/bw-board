// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';
import {registerAllDevices} from '../src/register-all.js';
import {KIM1_TERMINALS} from '../src/devices/kim1.js';
import {KIM1_DEMOS} from '../src/kim1-machine.js';
registerAllDevices();
const terminal = (part, name) => ({part, terminal: name});
function boardFor(program = KIM1_DEMOS.echo.program) {
  const board = new BoardImpl(5);
  board.setNetlist([
    {id: 'kim', kind: 'kim-1', params: {program, clockHz: 1000}, terminals: [...KIM1_TERMINALS]},
    {id: 'switch', kind: 'switch', params: {closed: false}, terminals: ['a', 'b']},
    {id: 'pull', kind: 'resistor', params: {ohms: 33000}, terminals: ['a', 'b']},
    {id: 'resistor', kind: 'resistor', params: {ohms: 1000}, terminals: ['a', 'b']},
    {id: 'lamp', kind: 'led', params: {vf: 2, color: 'red'}, terminals: ['anode', 'cathode']}
  ], [
    {id: 'power', terminals: [terminal('kim', '5v'), terminal('switch', 'a')]},
    {id: 'input', terminals: [terminal('kim', 'PB0'), terminal('switch', 'b'), terminal('pull', 'a')]},
    {id: 'output', terminals: [terminal('kim', 'PA0'), terminal('resistor', 'a')]},
    {id: 'led', terminals: [terminal('resistor', 'b'), terminal('lamp', 'anode')]},
    {id: 'ground', terminals: [terminal('kim', 'gnd'), terminal('pull', 'b'), terminal('lamp', 'cathode')]}
  ]);
  return board;
}
const state = b => b.getDeviceState('kim');
const control = (b, verb, value) => assert.equal(b.setDeviceControl('kim', verb, value), true);

test('KIM program couples real switch input to solved resistor/LED and holds outputs on ST', () => {
  const b = boardFor(); control(b, 'run'); b.advanceTo(100_000_000n);
  assert.equal(state(b).ddrA, 255); assert.equal(state(b).portA, 0); assert.ok(b.ledBrightnessNow('lamp') < 0.001);
  b.setControl('switch', 1); b.advanceTo(200_000_000n);
  assert.equal(state(b).portA & 1, 1); assert.ok(b.nodeVoltage('input') > 4.9);
  assert.ok(b.ledBrightnessNow('lamp') > 0.05); assert.ok(b.branchCurrent('resistor', 'a') < -0.002);
  control(b, 'halt'); const count = state(b).executed;
  b.setControl('switch', 0); b.advanceTo(300_000_000n);
  assert.equal(state(b).portB & 1, 0); assert.equal(state(b).portA & 1, 1); assert.equal(state(b).executed, count);
  control(b, 'run'); b.advanceTo(400_000_000n);
  assert.equal(state(b).portA & 1, 0); assert.ok(b.ledBrightnessNow('lamp') < 0.001);
  assert.deepEqual(b.getWarnings(), []);
});

test('Board scheduled instruction deadlines preserve CPU and visible LED across coarse advances', () => {
  const run = chunks => {
    const b = boardFor(KIM1_DEMOS.counter.program); control(b, 'run');
    for (const time of chunks) b.advanceTo(time);
    return {pc: state(b).pc, count: state(b).executed, port: state(b).portA, visible: b.ledBrightness('lamp')};
  };
  const once = run([1_000_000_000n]);
  assert.equal(once.port, 110);
  const fine = run(Array.from({length: 100}, (_, i) => BigInt(i + 1) * 10_000_000n));
  assert.equal(once.pc, fine.pc); assert.equal(once.count, fine.count); assert.equal(once.port, fine.port);
  assert.ok(Math.abs(once.visible - fine.visible) < 1e-9);
});

test('real Board rejects invalid program atomically and preserves canonical edits across reset', () => {
  const b = boardFor(); const before = state(b).programSource;
  assert.equal(b.setDeviceControl('kim', 'loadProgram', '0200: A9 XX'), false);
  assert.equal(state(b).programSource, before);
  for (const key of ['AD', '0', '3', '0', '0', 'DA', 'A', 'B']) control(b, 'key', key);
  const edited = state(b).programSource;
  b.setPartParam('kim', 'program', edited); assert.equal(state(b).address, 0x300);
  b.reset(); assert.equal(state(b).programSource, edited); assert.equal(state(b).ram[0x300], 0xab);
});
