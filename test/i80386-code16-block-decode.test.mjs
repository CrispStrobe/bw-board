import test from 'node:test';
import assert from 'node:assert/strict';
import {ExperimentalI80386ATMachine, PCAT80386_EXPERIMENTAL_4M} from
  '../src/experimental/i80386-at-machine.js';
import {prevalidateI80386Code16Window} from '../src/experimental/i80386-code16-window.js';
import {decodeI80386Code16Block as decode} from
  '../src/experimental/i80386-code16-block-decode.js';
import {createI80386Code16Coverage} from
  '../src/experimental/i80386-code16-coverage.js';

function fixture(bytes, offset = 0x20, limit = 0xffff) {
  const machine = new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M);
  machine.cpu.cs = 0x2000;
  machine.cpu.segmentCaches[1] = {base: 0x20000, limit, default32: false,
    present: true, code: true, readable: true, writable: false};
  machine.mem.set(bytes, 0x20000 + offset);
  return {machine, window: prevalidateI80386Code16Window(machine, offset, bytes.length)};
}

test('register, immediate, stack and branch records have exact lengths and targets', () => {
  const {window} = fixture([0xb8, 0x34, 0x12, 0x89, 0xc3, 0x8b, 0xd8,
    0x50, 0x58, 0x74, 0xf5, 0x90]);
  const block = decode(window);
  assert.deepEqual(block.instructions.map(i => [i.kind, i.offset, i.length]),
    [['mov-imm16',0x20,3],['mov16',0x23,2],['mov16',0x25,2],
      ['push16',0x27,1],['pop16',0x28,1],['jz-rel8',0x29,2]]);
  assert.deepEqual([block.instructions[0].immediate,
    block.instructions[1].dst,block.instructions[1].src,
    block.instructions[2].dst,block.instructions[2].src], [0x1234,3,0,3,0]);
  assert.deepEqual([block.instructions.at(-1).target,
    block.instructions.at(-1).fallthrough,block.reason,block.nextOffset],
  [0x20,0x2b,'control-flow',0x2b]);
});

test('relative call and jump use 16-bit wrapped targets; return is dynamic', () => {
  const call = decode(fixture([0xe8,0x02,0x00], 0xfffc).window);
  assert.deepEqual([call.instructions[0].target,call.instructions[0].fallthrough],
    [1,0xffff]);
  const ret = decode(fixture([0xc3,0x90]).window);
  assert.equal(ret.instructions[0].kind,'ret16');
  assert.equal(ret.instructions[0].target,undefined);
  assert.equal(ret.instructions.length,1);
});

test('EIP above 64 KiB keeps linear fallthrough but truncates taken branch target', () => {
  const jnz = decode(fixture([0x75,0xfc], 0x10020, 0x1ffff).window);
  assert.deepEqual([jnz.instructions[0].offset, jnz.instructions[0].fallthrough,
    jnz.instructions[0].target, jnz.nextOffset],
  [0x10020,0x10022,0x001e,0x10022]);
  const call = decode(fixture([0xe8,0xfd,0xff], 0x10030, 0x1ffff).window);
  assert.deepEqual([call.instructions[0].fallthrough,call.instructions[0].target],
    [0x10033,0x0030]);
});

test('prefixes, memory operands, unsupported opcodes and incomplete bytes stop explicitly', () => {
  for (const [bytes, reason] of [
    [[0x66,0x89,0xc0],'prefix'], [[0x8b,0x46,0xfe],'memory-operand'],
    [[0xcd,0x10],'unsupported-opcode'], [[0x89],'incomplete'],
    [[0xe8,0x01],'incomplete']]) {
    const block = decode(fixture(bytes).window);
    assert.deepEqual([block.instructions.length,block.reason,block.nextOffset],
      [0,reason,0x20]);
  }
  assert.equal(decode(fixture([0x90,0x90]).window,1).reason,'budget');
});

test('byte changes invalidate the entire decoded window before use', () => {
  const {machine,window} = fixture([0x90,0x89,0xc0]);
  assert.equal(decode(window).instructions.length,2);
  machine.mem[0x20022] ^= 1;
  assert.equal(decode(window).reason,'invalid-window');
  assert.equal(decode(window).instructions.length,0);
});

test('coverage counts a contiguous observed block across ordinary guest steps', () => {
  const {machine} = fixture([0x90,0x90,0x75,0x00,0x90]);
  machine.cpu.eip = 0x20;
  const coverage = createI80386Code16Coverage();
  const serviceInterrupts = machine._serviceInterrupts;
  const restore = coverage.attach(machine);
  for (let i = 0; i < 3; i++) {
    coverage.observe(machine);
    machine.step();
    coverage.retired(machine);
  }
  const report = coverage.report();
  assert.equal(report.code16Steps,3);
  assert.equal(report.admittedSteps,3);
  assert.equal(report.decodedSteps,3);
  assert.equal(report.observedBlockLengthHistogram[3],1);
  assert.equal(report.retiredInMultiInstructionBlocks,3);
  restore();
  assert.equal(machine._serviceInterrupts,serviceInterrupts);
});

test('observed retirement does not claim a dynamic return target', () => {
  const {machine} = fixture([0xc3]);
  machine.cpu.eip = 0x20;
  const coverage = createI80386Code16Coverage();
  const restore = coverage.attach(machine);
  coverage.observe(machine);
  machine.step();
  coverage.retired(machine);
  restore();
  const report = coverage.report();
  assert.equal(report.decodedSteps,1);
  assert.equal(report.retiredInObservedBlocks,0);
  assert.equal(report.ambiguousRetirements['dynamic-return-target'],1);
});

test('a fetch fault completes no instruction and earns no observed credit', () => {
  const {machine} = fixture([0x90]);
  machine.cpu.eip = 0x20;
  const coverage = createI80386Code16Coverage();
  const restore = coverage.attach(machine);
  coverage.observe(machine);
  machine.cpu.segmentCaches[1].limit = 0x1f; // Fault after admission, before fetch.
  const cycles = machine.cpu.cycles;
  machine.step();
  coverage.retired(machine);
  restore();
  assert.equal(machine.cpu.cycles,cycles);
  assert.equal(coverage.report().ambiguousRetirements['no-completed-instruction'],1);
  assert.equal(coverage.report().retiredInObservedBlocks,0);
});

test('a delivered pre-step interrupt earns no observed credit', () => {
  const {machine} = fixture([0x90]);
  machine.cpu.eip = 0x20;
  machine._serviceInterrupts = () => true; // Controlled interrupt-delivery signal.
  const coverage = createI80386Code16Coverage();
  const restore = coverage.attach(machine);
  coverage.observe(machine);
  machine.step();
  coverage.retired(machine);
  restore();
  assert.equal(coverage.report().ambiguousRetirements['pre-step-interrupt'],1);
  assert.equal(coverage.report().retiredInObservedBlocks,0);
});
