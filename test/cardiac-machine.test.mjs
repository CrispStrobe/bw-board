// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCardiacMachine, parseCardiacProgram, formatCardiacProgram, formatCardiacWord,
  controlCardiacMachine as control, stepCardiacMachine as step, runCardiacMachine as run,
  snapshotCardiacMachine as snapshot, restoreCardiacMachine as restore, onCardiacEvent
} from '../src/cardiac-machine.js';

const image = (entries, entry = 1) => ({words: Object.entries(entries).map(([address, value]) => ({address: +address, value})), entry});
const cpu = (entries, entry = 1) => createCardiacMachine(image(entries, entry));

test('decimal images round-trip signed words and reject invalid images atomically', () => {
  const source = '@01\n01: 080 ; read\n02: 580\n03: 900\n80: -123';
  const program = parseCardiacProgram(source);
  assert.deepEqual(parseCardiacProgram(formatCardiacProgram(program)), program);
  assert.equal(formatCardiacWord(-2), '-002'); assert.equal(formatCardiacWord(42, 4), '0042');
  const m = createCardiacMachine(program), before = snapshot(m);
  for (const bad of [image({0: 0}), image({1: 1000}), image({100: 1}),
    {words: [{address: 1, value: 900}, {address: 1, value: 901}]}, image({1: 900}, 100),
    'CLA 80', {words: [{address: '1', value: 900}]}, {words: [{address: 1, value: NaN}]}]) {
    assert.throws(() => control(m, 'loadProgram', bad)); assert.deepEqual(snapshot(m), before);
  }
});

test('INP and OUT go directly to memory and a read waits without retiring or fetching', () => {
  const m = cpu({1: 80, 2: 580, 3: 900});
  m.acc = 17;
  const events = []; const off = onCardiacEvent(m, e => events.push(e));
  assert.equal(run(m).reason, 'input');
  assert.equal(m.pc, 1); assert.equal(m.steps, 0); assert.equal(m.ir, null); assert.equal(m.acc, 17);
  assert.equal(step(m), null); assert.equal(events.filter(e => e.type === 'input-wait').length, 1);
  control(m, 'enqueueInput', -42);
  assert.equal(run(m).reason, 'halted');
  assert.deepEqual(m.output, [-42]); assert.equal(m.memory[80], -42); assert.equal(m.acc, 17);
  assert.equal(m.steps, 3); assert.equal(m.pc, 0); assert.equal(m.lastOutput, -42);
  off();
});

test('all arithmetic instructions preserve the accumulator and memory roles', () => {
  const m = cpu({1: 80, 2: 81, 3: 180, 4: 281, 5: 782, 6: 683, 7: 583, 8: 900, 82: 9});
  control(m, 'enqueueInput', [17, 25]);
  assert.equal(run(m).reason, 'halted');
  assert.equal(m.acc, 33); assert.equal(m.memory[83], 33); assert.deepEqual(m.output, [33]);
  assert.equal(m.memory[80], 17); assert.equal(m.memory[81], 25);
});

test('TAC branches only when negative and does not overwrite the JMP return link', () => {
  for (const [acc, expected] of [[-1, 20], [0, 2], [1, 2]]) {
    const m = cpu({1: 320, 99: 877}); m.acc = acc;
    const e = step(m);
    assert.equal(m.pc, expected); assert.equal(m.memory[99], 877);
    assert.equal(e.branchTaken, acc < 0); assert.deepEqual(e.writes, []);
  }
});

test('JMP records the next address, and a fetched return survives overwriting cell 99', () => {
  const m = cpu({1: 899, 2: 900});
  step(m); assert.equal(m.pc, 99); assert.equal(m.memory[99], 802);
  const e = step(m);
  assert.equal(e.word, 802); assert.equal(m.pc, 2); assert.equal(m.memory[99], 800);
  assert.deepEqual(e.writes, [{address: 99, before: 802, after: 800}]);
  step(m); assert.equal(m.halted, true);
  const direct = cpu({99: 807}, 99); step(direct);
  assert.equal(direct.pc, 7); assert.equal(direct.memory[99], 800);
});

test('four-digit signed accumulator overflow and three-digit STO are explicit', () => {
  for (const [acc, word, expected] of [[9999, 200, 0], [-9999, 700, 0], [9500, 280, 499], [-9500, 780, -499]]) {
    const m = cpu({1: word, 80: 999}); m.acc = acc; step(m); assert.equal(m.acc, expected);
  }
  for (const acc of [1234, -1234, 9999, -9999]) {
    const m = cpu({1: 680}); m.acc = acc; step(m);
    assert.equal(m.memory[80], acc % 1000); assert.equal(m.acc, acc);
  }
});

test('SFT shifts decimal digits left then truncates before shifting right, including negatives', () => {
  for (const [acc, instruction, expected] of [[1234, 411, 234], [-1234, 411, -234],
    [123, 410, 1230], [-123, 401, -12], [9999, 499, 0], [-1, 409, 0], [4567, 400, 4567]]) {
    const m = cpu({1: instruction}); m.acc = acc; step(m);
    assert.equal(m.acc, expected); assert.equal(Object.is(m.acc, -0), false);
  }
});

test('cell 00 stays 001 even when INP consumes a card or STO targets it; 99 is writable', () => {
  const m = cpu({1: 0, 2: 600, 3: 699}); m.acc = -27;
  control(m, 'enqueueInput', 42);
  step(m); assert.equal(m.inputQueue.length, 0); assert.equal(m.memory[0], 1);
  assert.equal(m.lastInstruction.events.some(e => e.type === 'write-ignored'), true);
  step(m); assert.equal(m.memory[0], 1);
  step(m); assert.equal(m.memory[99], -27);
});

test('negative instructions are skipped and PC wraps from 99 to 00', () => {
  const m = cpu({99: -900}, 99); m.acc = -33;
  const e = step(m);
  assert.equal(e.mnemonic, 'SKIP'); assert.equal(m.pc, 0); assert.equal(m.acc, -33);
  assert.equal(m.steps, 1); assert.equal(m.memory[99], -900);
});

test('HRS chooses the restart PC; host reset restores the original image and empty trays', () => {
  const m = cpu({1: 680, 2: 580, 3: 907, 80: 11}); m.acc = 42;
  run(m); assert.equal(m.pc, 7); assert.equal(m.halted, true); assert.equal(m.memory[80], 42);
  assert.equal(m.acc, 42); assert.deepEqual(m.output, [42]);
  control(m, 'reset'); assert.equal(m.pc, 1); assert.equal(m.halted, false); assert.equal(m.running, false);
  assert.equal(m.acc, 0); assert.equal(m.memory[80], 11); assert.deepEqual(m.output, []);
});

test('self-modified instructions execute from the same memory as data', () => {
  const m = cpu({1: 180, 2: 610, 3: 810, 10: 900, 11: 900, 80: 581, 81: 42});
  run(m); assert.deepEqual(m.output, [42]); assert.equal(m.memory[10], 581);
  assert.equal(m.program.words.find(w => w.address === 10).value, 900, 'authored image stays distinct from runtime memory');
});

test('a cold bootstrap constructs and runs an addition program through INP itself', () => {
  const m = createCardiacMachine();
  control(m, 'enqueueInput', [2, 800, 20, 80, 21, 180, 22, 281, 23, 680, 24, 580, 25, 900, 81, 7, 820, 35]);
  const result = run(m, {maxSteps: 100});
  assert.equal(result.reason, 'halted'); assert.equal(m.steps, 32); assert.deepEqual(m.output, [42]);
});

test('bounded execution stops before breakpoints and continue skips one hit only', () => {
  const m = cpu({1: 200, 2: 801}); control(m, 'setBreakpoint', 1);
  assert.equal(run(m, {maxSteps: 5}).reason, 'breakpoint'); assert.equal(m.steps, 0);
  control(m, 'run'); assert.equal(run(m, {maxSteps: 5}).reason, 'breakpoint');
  assert.equal(m.acc, 1); assert.equal(m.steps, 2);
  control(m, 'clearBreakpoint', 1);
  assert.equal(run(m, {maxSteps: 5}).reason, 'budget'); assert.equal(m.steps, 7);
  assert.throws(() => run(m, {maxSteps: Infinity}));
});

test('checkpoint restore includes changed code, card provenance, output latch and breakpoint state', () => {
  const m = cpu({1: 580, 2: 680, 3: 80, 80: 1}); m.acc = -999;
  step(m); step(m); control(m, 'enqueueInput', [12, -34]); control(m, 'setBreakpoint', 3);
  control(m, 'clearOutput');
  const saved = snapshot(m), other = createCardiacMachine(); restore(other, saved);
  assert.deepEqual(snapshot(other), saved); assert.equal(other.lastOutput, 1);
  other.memory[80] = 12; other.inputQueue[0] = 99;
  assert.equal(m.memory[80], -999); assert.deepEqual(m.inputQueue, [12, -34]);
  const before = snapshot(m);
  for (const mutate of [s => s.memory[0] = 2, s => s.acc = 10000, s => s.inputSources = [],
    s => s.pc = 100, s => s.memory.push(0), s => s.waiting = true]) {
    const invalid = snapshot(m); mutate(invalid); assert.throws(() => restore(m, invalid)); assert.deepEqual(snapshot(m), before);
  }
});

test('events expose fetch, read/write, accumulator and I/O effects without sharing mutable views', () => {
  const m = cpu({1: 180, 2: 680, 80: 42}); const seen = [];
  onCardiacEvent(m, event => { seen.push(event); event.reads?.push({address: 99, value: 999}); });
  const e = step(m);
  assert.deepEqual(e.reads, [{address: 80, value: 42}]);
  assert.deepEqual(e.events[0], {type: 'fetch', address: 1, value: 180});
  assert.equal(e.accBefore, 0); assert.equal(e.accAfter, 42); assert.equal(e.pcBefore, 1); assert.equal(e.pcAfter, 2);
  step(m); assert.deepEqual(m.lastInstruction.writes, [{address: 80, before: 42, after: 42}]);
  assert.equal(seen.length, 2);
});
