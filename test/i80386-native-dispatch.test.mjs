import test from 'node:test';
import assert from 'node:assert/strict';
import {ExperimentalI80386ATMachine,
  PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP} from '../src/experimental/i80386-at-machine.js';
import {createI80386NativeDispatcher} from
  '../src/experimental/i80386-native-dispatch.js';

const CODE = 0x80120000, PHYSICAL = 0x120000;

function fixture() {
  const machine = new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP);
  const put32 = (address, value) => {
    for (let i = 0; i < 4; i++) machine._write386(address + i, value >>> (8 * i) & 255);
  };
  put32(0x1800, 0x4007);
  put32(0x4000 + 0x120 * 4, PHYSICAL | 7);
  // MOV EAX,1; CMP EAX,2; JNZ back to MOV.
  const code = [0xb8, 1, 0, 0, 0, 0x83, 0xf8, 2, 0x75, 0xf6];
  code.forEach((byte, i) => machine._write386(PHYSICAL + i, byte));
  const cpu = machine.cpu;
  cpu.segmentCaches[1] = {base: 0, limit: 0xffffffff, default32: true,
    present: true, code: true, readable: true, writable: false};
  cpu.segmentCaches[3] = {base: 0, limit: 0xffffffff, default32: true,
    present: true, code: false, readable: true, writable: true};
  cpu.cr0 = 0x80000001;
  cpu.cr3 = 0x1000;
  cpu.eip = CODE;
  cpu._translate(CODE);
  machine._chipDebt = 0;
  machine._chipDeadline = 1000;
  return machine;
}

function state(machine) {
  return {eax: machine.cpu.eax, eip: machine.cpu.eip,
    eflags: machine.cpu.eflags, cpuCycles: machine.cpu.cycles,
    cycles: machine.cycles, chipDebt: machine._chipDebt};
}

test('dispatcher attaches shared RAM and counts native guest steps', async () => {
  const fast = fixture(), slow = fixture();
  const dispatcher = await createI80386NativeDispatcher(fast);
  assert.equal(fast.mem.buffer, dispatcher.ramBridge.memory.buffer);
  assert.equal(dispatcher.run(6), 6);
  for (let i = 0; i < 6; i++) slow.step();
  assert.deepEqual(state(fast), state(slow));
  assert.equal(dispatcher.stats.blockCalls, 1);
  assert.equal(dispatcher.stats.instructions, 6);
  assert.throws(() => dispatcher.run(0), RangeError);
});

test('dispatcher interprets unsupported and stale bytes', async () => {
  const fast = fixture(), slow = fixture();
  const dispatcher = await createI80386NativeDispatcher(fast);
  dispatcher.run(3);
  for (let i = 0; i < 3; i++) slow.step();
  for (const machine of [fast, slow]) machine._write386(PHYSICAL, 0x40); // INC EAX
  assert.equal(dispatcher.run(8), 1);
  slow.step();
  assert.deepEqual(state(fast), state(slow));
  assert.equal(dispatcher.stats.instructions, 3);
});

test('advanceToMs stops at the rounded cycle target and counts guest steps', async () => {
  const fast = fixture(), slow = fixture();
  const dispatcher = await createI80386NativeDispatcher(fast);
  const targetCycles = 13 * fast.functionalInstructionCycles;
  const targetMs = targetCycles * 1000 / fast.clockHz;
  assert.equal(dispatcher.advanceToMs(targetMs), 13);
  assert.equal(slow.advanceToMs(targetMs), 13);
  assert.deepEqual(state(fast), state(slow));
  assert.equal(dispatcher.advanceToMs(targetMs), 0);
});
