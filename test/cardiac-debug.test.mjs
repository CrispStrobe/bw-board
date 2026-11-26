// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCardiacDebugTarget} from '../src/cardiac-debug.js';
import {createDebugSession} from '../src/debug-session.js';
import {BoardImpl} from '../src/board.js';
import {registerCardiacDevice, CARDIAC_TERMINALS} from '../src/devices/cardiac.js';

const image = (entries, entry = 1) => ({words: Object.entries(entries).map(([address, value]) => ({address: +address, value})), entry});
const loop = image({1: 200, 2: 801});
const fixture = (program = loop) => createCardiacDebugTarget({program, instructionHz: 1000});
function boardFixture(program = loop) {
  registerCardiacDevice();
  const board = new BoardImpl(5);
  board.setNetlist([{id: 'c', kind: 'cardiac', params: {program, instructionHz: 1000}, terminals: [...CARDIAC_TERMINALS]}],
    [{id: 'ground', terminals: [{part: 'c', terminal: 'gnd'}]}]);
  return {board, target: createCardiacDebugTarget({board, partId: 'c'})};
}

test('CARDIAC capabilities and memory are decimal words with no fabricated physical CPU fidelity', () => {
  const target = fixture(image({1: 580, 80: -999}));
  const caps = target.capabilities();
  assert.deepEqual(caps.steps, ['insn']); assert.equal(caps.extensions.radix, 10);
  assert.equal(caps.extensions.addressUnit, 'decimal word'); assert.equal(caps.runTo[0].addressMax, 99);
  assert.deepEqual(caps.recording, []); assert.equal(caps.fidelity.cycle, 'unsupported');
  assert.equal(target.readMem('code', 80, 1)[0], -999);
  assert.ok(target.readMem('code', 80, 1) instanceof Int16Array);
  assert.equal(target.disasm(1).text, 'OUT 80'); assert.equal(target.disasm(1).length, 1);
  assert.equal(target.nextCodeAddress(99), 0);
  for (const a of [-1, 100, 0.5, NaN, '1']) assert.ok(target.disasm(a).unsupported);
  assert.ok(target.step('cycle').unsupported);
});

test('DebugSession arms an instruction step and completion arrives only during the pump', () => {
  const target = fixture(), session = createDebugSession(target, {sliceNs: 10000000});
  session.step('insn', 1);
  assert.equal(target.machine.steps, 0); assert.equal(session.state().stepping, true);
  assert.equal(session.pump(), 'halted');
  assert.equal(target.machine.steps, 1); assert.equal(target.machine.acc, 1); assert.equal(target.machine.pc, 2);
  assert.equal(session.state().why.cause, 'step'); assert.equal(session.state().why.tNs, 1000000n);
  assert.equal(session.state().intent, 'paused');
  session.step('insn', 3); session.pump();
  assert.equal(target.machine.steps, 4); assert.equal(target.machine.acc, 2); assert.equal(target.machine.pc, 1);
  session.destroy(); target.destroy();
});

test('standalone and attached DebugSessions execute the same core and pause without another clock', () => {
  for (const attached of [false, true]) {
    const setup = attached ? boardFixture() : {target: fixture()};
    const {target, board} = setup, session = createDebugSession(target, {sliceNs: 2000000});
    if (board) assert.equal(target.machine, board.getDeviceState('c').machine);
    session.start(); assert.equal(session.pump(), 'ran');
    assert.equal(target.machine.acc, 1); assert.equal(target.machine.pc, 1); assert.equal(target.timeNs(), 2000000n);
    session.pause();
    const paused = target.snapshot(), at = target.timeNs();
    assert.equal(session.pump(), 'idle'); assert.equal(target.runFor(100000000), 'idle');
    assert.deepEqual(target.snapshot(), paused); assert.equal(target.timeNs(), at);
    session.resume(); session.pump(); assert.equal(target.machine.acc, 2);
    if (board) assert.equal(board.timeNs, target.timeNs());
    session.stop(); assert.equal(target.machine.steps, 0); assert.equal(target.timeNs(), 4000000n);
    session.destroy(); target.destroy();
  }
});

test('attached step stops Board at one instruction deadline, even with a large host budget', () => {
  const {target, board} = boardFixture();
  target.step('insn', 1); assert.equal(target.runFor(100000000), 'halted');
  assert.equal(board.timeNs, 1000000n); assert.equal(target.machine.steps, 1);
  assert.equal(board.getDeviceState('c').acc, 1); assert.equal(board.getDeviceState('c').running, false);
});

test('breakpoints stop before execution, continue once, and re-hit on a loop', () => {
  for (const target of [fixture(), boardFixture().target]) {
    const reasons = []; target.onHalt(reason => reasons.push(reason));
    const id = target.setBreakpoint({kind: 'code', space: 'code', addr: 1});
    target.run(); assert.equal(target.runFor(10000000), 'halted');
    assert.equal(target.machine.steps, 0); assert.equal(reasons.at(-1).bp, id);
    target.run(); target.runFor(10000000);
    assert.equal(target.machine.steps, 2); assert.equal(target.machine.acc, 1); assert.equal(reasons.at(-1).bp, id);
    target.step('insn'); target.runFor(10000000);
    assert.equal(target.machine.steps, 3); assert.equal(target.machine.acc, 2); assert.equal(reasons.at(-1).cause, 'step');
    target.clearBreakpoint(id); target.run(); target.runFor(2000000);
    assert.equal(target.machine.steps, 5);
    target.destroy();
  }
});

test('empty input and HRS have distinct stop reasons and input is consumed only after resume', () => {
  const target = fixture(image({1: 80, 2: 580, 3: 907})), reasons = [];
  target.onHalt(reason => reasons.push(reason));
  target.run(); assert.equal(target.runFor(10000000), 'halted');
  assert.equal(reasons.at(-1).cause, 'input-wait'); assert.equal(target.machine.steps, 0);
  target.control('enqueueInput', -42);
  assert.equal(target.runFor(10000000), 'idle'); assert.deepEqual(target.machine.inputQueue, [-42]);
  target.run(); target.runFor(10000000);
  assert.equal(reasons.at(-1).cause, 'cardiac-halt'); assert.equal(target.machine.pc, 7);
  assert.deepEqual(target.machine.output, [-42]); assert.equal(target.machine.steps, 3);
});

test('observations and decimal reads are detached and never advance the Board or read a card', () => {
  const {target, board} = boardFixture(image({1: 80, 2: 580, 3: 900}));
  target.control('enqueueInput', [1, -999]);
  const before = target.snapshot(), at = board.timeNs;
  for (let i = 0; i < 5; i++) {
    target.snapshot().memory[0] = 999; target.snapshot().inputQueue.push(8);
    target.readMem('program', 0, 100).fill(0); target.disasm(1); target.regs(); target.position();
  }
  assert.deepEqual(target.snapshot(), before); assert.equal(board.timeNs, at);
});

test('word memory edits validate the entire range, preserve the authored image, and refuse running writes', () => {
  const target = fixture(), before = target.snapshot();
  for (const [space, address, data] of [['code', 99, [1, 2]], ['code', 0, [2]], ['code', 1, [42, 1000]],
    ['code', 1, new Uint8Array([1])], ['idata', 1, [2]], ['program', -1, [2]]]) {
    assert.ok(target.writeMem(space, address, data).refused); assert.deepEqual(target.snapshot(), before);
  }
  assert.equal(target.writeMem('program', 80, new Int16Array([-999, 999])), undefined);
  assert.deepEqual(Array.from(target.readMem('code', 80, 2)), [-999, 999]);
  assert.deepEqual(target.machine.program, before.program);
  target.run(); assert.ok(target.writeMem('code', 80, [1]).refused);
  target.halt(); target.reset(); assert.equal(target.machine.memory[80], 0);
});

test('run budgets are bounded and zero is passive; repeated small slices accumulate virtual time', () => {
  const target = fixture(); target.run();
  const before = target.snapshot(); assert.equal(target.runFor(0), 'budget'); assert.deepEqual(target.snapshot(), before);
  for (const value of [-1, Infinity, NaN, '100', 1n]) assert.throws(() => target.runFor(value), RangeError);
  target.runFor(500000); assert.equal(target.machine.steps, 0);
  target.runFor(500000); assert.equal(target.machine.steps, 1);
  target.runFor(1e12); assert.equal(target.timeNs(), 101000000n); assert.equal(target.machine.steps, 101);
  assert.equal(target.state(), 'running');
});

test('destroy stops the same attached device and releases event subscribers', () => {
  const {target, board} = boardFixture(); let events = 0;
  target.onEvent(() => events++); target.run(); target.runFor(1000000); assert.equal(events, 1);
  target.destroy(); target.destroy(); assert.equal(target.state(), 'detached');
  assert.equal(board.getDeviceState('c').running, false); assert.ok(target.run().refused);
  assert.ok(target.step('insn').unsupported); assert.equal(target.control('step'), false);
  board.setDeviceControl('c', 'step'); assert.equal(events, 1);
});

test('factory uses the existing CARDIAC part rather than constructing another executing CPU', async () => {
  const {createDebugTarget} = await import('../src/debug-target-factory.js');
  const {board, target: initial} = boardFixture(); initial.destroy();
  const {target, adapter} = await createDebugTarget('cardiac', {board, partId: 'c'});
  assert.equal(target.adapter, adapter); assert.equal(adapter.machine, board.getDeviceState('c').machine);
  target.control('step'); assert.equal(board.getDeviceState('c').steps, 1);
  assert.equal(target.snapshot().acc, 1);
  await assert.rejects(() => createDebugTarget('cardiac', {board, partId: 'missing'}), /not a CARDIAC/);
  target.destroy();
});
