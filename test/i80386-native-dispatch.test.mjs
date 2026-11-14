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

test('dispatcher amortizes a full batch without crossing caller or device budgets', async () => {
  for (const [caller, chip, lapic, expected] of [
    [64, 1000, null, 64],
    [23, 1000, null, 23],
    [64, 19, null, 19],
    [64, 1000, 29, 29],
    [64, 19, 29, 19],
  ]) {
    const fast = fixture(), slow = fixture();
    for (const machine of [fast, slow]) {
      machine._chipDeadline = chip * machine.functionalInstructionCycles;
      if (lapic !== null) {
        machine._lapicTimerInterval = 1000;
        machine._lapicTimerNext = lapic * machine.functionalInstructionCycles;
      }
    }
    const dispatcher = await createI80386NativeDispatcher(fast);
    assert.equal(dispatcher.run(caller), expected);
    for (let i = 0; i < expected; i++) slow.step();
    assert.deepEqual(state(fast), state(slow));
    assert.equal(dispatcher.stats.blockCalls, 1);
    assert.equal(dispatcher.stats.instructions, expected);
  }
});

test('an explicit smaller native batch remains supported', async () => {
  const fast = fixture(), slow = fixture();
  const dispatcher = await createI80386NativeDispatcher(fast, {blockInstructions: 16});
  assert.equal(dispatcher.run(64), 16);
  for (let i = 0; i < 16; i++) slow.step();
  assert.deepEqual(state(fast), state(slow));
});

test('larger batches preserve device progress across repeated chip horizons', async () => {
  const fast = fixture(), slow = fixture();
  const dispatcher = await createI80386NativeDispatcher(fast);
  const total = 4099;
  let retired = 0;
  while (retired < total)
    retired += dispatcher.run(Math.min(64, total - retired));
  for (let i = 0; i < total; i++) slow.step();
  assert.deepEqual(state(fast), state(slow));
  const devices = machine => ({
    deadline: machine._chipDeadline,
    pitFraction: machine.chips.pit1._frac,
    pitCounters: machine.chips.pit1.counters.map(counter => ({...counter, hooks: undefined})),
    rtcPhase: machine.chips.rtc1.cyclePhase,
    rtcPeriodicPhase: machine.chips.rtc1.periodicPhase,
    cgaCycles: machine.chips.cga1.cycles,
  });
  assert.deepEqual(devices(fast), devices(slow));
  assert.ok(dispatcher.stats.instructions > 64);
});

test('a cached full batch yields to pending interrupts, timer expiry and debug traps', async () => {
  const triggers = [
    machine => { machine._nmiPending = true; },
    machine => {
      machine._mpReady = true;
      machine.cpu.eflags |= 0x200;
      machine._lapicTimerPending = true;
      machine._lapic[0x320 >>> 2] = 0x40;
    },
    machine => {
      machine._lapicTimerInterval = 1000;
      machine._lapicTimerNext = machine.cycles;
    },
    machine => { machine.cpu.eflags |= 0x100; },
  ];
  for (const trigger of triggers) {
    const fast = fixture(), slow = fixture();
    const dispatcher = await createI80386NativeDispatcher(fast);
    assert.equal(dispatcher.run(63), 63); // Return to the cached block start.
    for (let i = 0; i < 63; i++) slow.step();
    for (const machine of [fast, slow]) trigger(machine);
    const nativeBefore = dispatcher.stats.instructions;
    assert.equal(dispatcher.run(64), 1);
    slow.step();
    assert.equal(dispatcher.stats.instructions, nativeBefore);
    assert.deepEqual(state(fast), state(slow));
    assert.equal(fast.cpu.shutdown, slow.cpu.shutdown);
    assert.equal(fast.cpu.lastFault?.vector, slow.cpu.lastFault?.vector);
    assert.equal(fast._nmiPending, slow._nmiPending);
    assert.equal(fast._lapicTimerPending, slow._lapicTimerPending);
  }
});

test('dispatcher interprets unsupported and stale bytes', async () => {
  const fast = fixture(), slow = fixture();
  const dispatcher = await createI80386NativeDispatcher(fast);
  dispatcher.run(63);
  for (let i = 0; i < 63; i++) slow.step();
  for (const machine of [fast, slow]) machine._write386(PHYSICAL, 0x40); // INC EAX
  assert.equal(dispatcher.run(64), 1);
  slow.step();
  assert.deepEqual(state(fast), state(slow));
  assert.equal(dispatcher.stats.instructions, 63);
});

test('a cached full batch yields to a newly faulting code mapping', async () => {
  const fast = fixture(), slow = fixture();
  const dispatcher = await createI80386NativeDispatcher(fast);
  assert.equal(dispatcher.run(63), 63);
  for (let i = 0; i < 63; i++) slow.step();
  for (const machine of [fast, slow])
    machine._write386(0x4000 + 0x120 * 4, 0); // Revoke code-page presence.
  assert.equal(dispatcher.run(64), 1);
  slow.step();
  assert.equal(dispatcher.stats.instructions, 63);
  assert.deepEqual(state(fast), state(slow));
  assert.equal(fast.cpu.lastFault?.vector, slow.cpu.lastFault?.vector);
  assert.equal(fast.cpu.shutdown, slow.cpu.shutdown);
});

test('dispatcher skips native admission for 16-bit code', async () => {
  const fast = fixture(), slow = fixture();
  const dispatcher = await createI80386NativeDispatcher(fast);
  for (const machine of [fast, slow])
    machine.cpu.segmentCaches[1].default32 = false;
  assert.equal(dispatcher.run(16), 1);
  slow.step();
  assert.deepEqual(state(fast), state(slow));
  assert.equal(dispatcher.stats.ineligibleModeSteps, 1);
  assert.equal(dispatcher.stats.attempts, 0);
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

test('dispatcher admits a primed REP STOSB and counts retired byte stores', async () => {
  const fast = fixture(), slow = fixture();
  const dispatcher = await createI80386NativeDispatcher(fast);
  for (const machine of [fast, slow]) {
    for (let i = 0; i < 4; i++)
      machine._write386(0x4000 + 0x130 * 4 + i, (0x130007 >>> (8 * i)) & 255);
    machine._write386(PHYSICAL, 0xf3);
    machine._write386(PHYSICAL + 1, 0xaa);
    machine.cpu.segmentCaches[0] = {base: 0, limit: 0xffffffff,
      default32: true, present: true, code: false, readable: true, writable: true};
    machine.cpu.eax = 0x123456a7;
    machine.cpu.ecx = 6;
    machine.cpu.edi = 0x80130010;
    machine.step();
  }
  assert.equal(dispatcher.run(5), 5);
  for (let i = 0; i < 5; i++) slow.step();
  assert.deepEqual(state(fast), state(slow));
  assert.equal(fast.cpu.ecx, slow.cpu.ecx);
  assert.equal(fast.cpu.edi, slow.cpu.edi);
  assert.deepEqual(Array.from(fast.mem.slice(0x130010, 0x130016)),
    Array.from(slow.mem.slice(0x130010, 0x130016)));
  assert.equal(dispatcher.stats.repStosbDecoded, 1);
  assert.equal(dispatcher.stats.repStosbBlockCalls, 1);
  assert.equal(dispatcher.stats.repStosbIterations, 5);
});
