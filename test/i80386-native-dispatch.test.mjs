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
  const cpu = machine.cpu;
  return {architecture: structuredClone(cpu._snapshotInstruction()),
    cr0: cpu.cr0, cr2: cpu.cr2, cr3: cpu.cr3, cr4: cpu.cr4,
    gdtr: {...cpu.gdtr}, idtr: {...cpu.idtr}, shutdown: cpu.shutdown,
    cpuCycles: cpu.cycles,
    cycles: machine.cycles, chipDebt: machine._chipDebt};
}

test('a timer horizon ends the batch before real LAPIC delivery and handler execution', async () => {
  const fast = fixture(), legacy = fixture(), slow = fixture();
  const events = new Map();
  const handler = CODE + 0x100;
  for (const machine of [fast, legacy, slow]) {
    const cpu = machine.cpu;
    const put = (offset, bytes) => bytes.forEach((byte, index) =>
      machine._write386(PHYSICAL + offset + index, byte));
    // Flat ring-zero GDT; vector 40h enters a real 32-bit interrupt gate.
    put(0x208, [0xff, 0xff, 0, 0, 0, 0x9a, 0xcf, 0]);
    put(0x210, [0xff, 0xff, 0, 0, 0, 0x92, 0xcf, 0]);
    put(0x500, [handler & 255, (handler >>> 8) & 255, 8, 0,
      0, 0x8e, (handler >>> 16) & 255, handler >>> 24]);
    put(0x100, [0xbb, 0x78, 0x56, 0x34, 0x12]); // MOV EBX,12345678h
    cpu.gdtr = {base: CODE + 0x200, limit: 0x17};
    cpu.idtr = {base: CODE + 0x300, limit: 0x207};
    cpu.cs = 8;
    cpu.ss = 0x10;
    cpu.segmentCaches[2] = {...cpu.segmentCaches[3]};
    cpu.esp = CODE + 0xf00;
    cpu.eflags |= 0x200;
    machine._mpReady = true;
    machine._lapic[0x320 >>> 2] = 0x40;
    machine._lapic[0xf0 >>> 2] = 0x100;
    machine._lapicTimerInterval = 1000;
    machine._lapicTimerNext = 29 * machine.functionalInstructionCycles;
    const seen = [];
    machine.hooks.onInterrupt = event => seen.push(event);
    events.set(machine, seen);
  }
  const dispatcher = await createI80386NativeDispatcher(fast);
  const legacyDispatcher = await createI80386NativeDispatcher(legacy, {blockInstructions: 16});
  assert.equal(dispatcher.run(64), 29);
  let legacyRetired = legacyDispatcher.run(64);
  assert.equal(legacyRetired, 16);
  while (legacyRetired < 29) legacyRetired += legacyDispatcher.run(64);
  assert.equal(legacyRetired, 29);
  for (let i = 0; i < 29; i++) slow.step();
  assert.deepEqual(state(fast), state(slow));
  assert.deepEqual(state(fast), state(legacy));
  assert.deepEqual(events.get(fast), []);
  assert.equal(fast.cpu.ebx, 0);
  // The next dispatch must use ordinary interrupt delivery, execute the
  // handler's first instruction and leave no native retirement past expiry.
  assert.equal(dispatcher.run(64), 1);
  assert.equal(legacyDispatcher.run(64), 1);
  slow.step();
  assert.deepEqual(events.get(fast), [{vector: 0x40, source: 'lapic-timer'}]);
  assert.deepEqual(events.get(fast), events.get(slow));
  assert.deepEqual(events.get(fast), events.get(legacy));
  assert.equal(fast.cpu.ebx, 0x12345678);
  assert.equal(fast.cpu.eip, handler + 5);
  assert.ok(!fast.cpu.lastFault);
  assert.equal(fast.cpu.shutdown, false);
  assert.deepEqual(state(fast), state(slow));
  assert.deepEqual(state(fast), state(legacy));
  assert.equal(dispatcher.stats.instructions, 29);
  assert.equal(fast._lapicTimerNext, slow._lapicTimerNext);
  assert.deepEqual(fast.mem.slice(PHYSICAL + 0xeec, PHYSICAL + 0xf00),
    slow.mem.slice(PHYSICAL + 0xeec, PHYSICAL + 0xf00));
});

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

test('a CPU without translation-cache storage keeps ordinary fallback', async () => {
  const fast = fixture(), slow = fixture();
  for (const machine of [fast, slow]) {
    machine.cpu._translationCacheEnabled = false;
    delete machine.cpu._translations;
  }
  const dispatcher = await createI80386NativeDispatcher(fast);
  for (let i = 0; i < 12; i++) {
    assert.equal(dispatcher.run(63), 1);
    slow.step();
    assert.deepEqual(state(fast), state(slow));
  }
  assert.equal(dispatcher.stats.instructions, 0);
  assert.equal(dispatcher.stats.decoded, 0);
});

test('a cold negative retries when ordinary execution fills its code translation', async () => {
  const fast = fixture(), slow = fixture();
  for (const machine of [fast, slow]) machine.cpu.invalidateTranslationCache();
  const generation = fast.cpu._translationGeneration;
  const dispatcher = await createI80386NativeDispatcher(fast);
  assert.equal(dispatcher.run(63), 1); // MOV primes the missing translation.
  slow.step();
  assert.equal(fast.cpu._translationGeneration, generation, 'TLB fill does not change generation');
  assert.equal(dispatcher.stats.decoded, 0);
  assert.deepEqual(state(fast), state(slow));
  assert.equal(dispatcher.run(63), 2); // CMP/JNZ returns to the cold-negative entry.
  slow.step(); slow.step();
  assert.equal(dispatcher.run(63), 63);
  for (let i = 0; i < 63; i++) slow.step();
  assert.deepEqual(state(fast), state(slow));
  assert.equal(dispatcher.stats.decoded, 2);
  assert.equal(dispatcher.stats.instructions, 65);
});

test('cold-negative retry rechecks execute-only CS admission and pending NMI', async () => {
  for (const pendingNmi of [false, true]) {
    const fast = fixture(), slow = fixture();
    for (const machine of [fast, slow]) machine.cpu.invalidateTranslationCache();
    const dispatcher = await createI80386NativeDispatcher(fast);
    assert.equal(dispatcher.run(63), 1); slow.step();
    const fastEvents = [], slowEvents = [];
    fast.hooks.onInterrupt = event => fastEvents.push(event);
    slow.hooks.onInterrupt = event => slowEvents.push(event);
    for (const machine of [fast, slow]) {
      machine.cpu.eip = CODE;
      if (pendingNmi) machine._nmiPending = true;
      else machine.cpu.segmentCaches[1] = {...machine.cpu.segmentCaches[1], readable: false};
    }
    assert.equal(dispatcher.run(63), 1);
    slow.step();
    assert.equal(dispatcher.stats.instructions, 0);
    assert.deepEqual(state(fast), state(slow));
    assert.deepEqual(fastEvents, slowEvents);
    if (pendingNmi) assert.deepEqual(fastEvents, [{vector: 2, source: 'nmi'}]);
  }
});

test('cold-negative retry decodes the current remapped page', async () => {
  const fast = fixture(), slow = fixture();
  for (const machine of [fast, slow]) machine.cpu.invalidateTranslationCache();
  const dispatcher = await createI80386NativeDispatcher(fast);
  assert.equal(dispatcher.run(63), 1); slow.step();
  for (const machine of [fast, slow]) {
    machine.mem.set([0xb8, 2, 0, 0, 0, 0x83, 0xf8, 3, 0x75, 0xf6], 0x130000);
    for (let i = 0; i < 4; i++) machine._write386(0x4480 + i, 0x130007 >>> (8 * i) & 255);
    machine.cpu.eip = CODE;
    machine.cpu._translate(CODE);
  }
  assert.equal(dispatcher.run(63), 63);
  for (let i = 0; i < 63; i++) slow.step();
  assert.deepEqual(state(fast), state(slow));
  assert.equal(fast.cpu.eax, 2);
});

test('a changed CS cache retries a refused code window without a TLB change', async () => {
  const fast = fixture(), slow = fixture();
  for (const machine of [fast, slow]) machine.cpu.segmentCaches[1].readable = false;
  const translation = fast.cpu._translations[(CODE >>> 12) & 511];
  const generation = fast.cpu._translationGeneration;
  const dispatcher = await createI80386NativeDispatcher(fast);
  assert.equal(dispatcher.run(63), 1); slow.step();
  for (const machine of [fast, slow]) {
    machine.cpu.eip = CODE;
    machine.cpu.segmentCaches[1] = {...machine.cpu.segmentCaches[1], readable: true};
  }
  assert.equal(fast.cpu._translations[(CODE >>> 12) & 511], translation);
  assert.equal(fast.cpu._translationGeneration, generation);
  assert.equal(dispatcher.run(63), 63);
  for (let i = 0; i < 63; i++) slow.step();
  assert.deepEqual(state(fast), state(slow));
  assert.equal(dispatcher.stats.instructions, 63);
});

test('front-cache collisions and single-entry eviction retain Map ownership', async () => {
  for (const [maxCachedBlocks, offset] of [[1, 0x100], [4, 0x100], [1, 0x101], [4, 0x101]]) {
    for (const observed of [false, true]) {
      const fast = fixture(), slow = fixture(), events = [];
      // 100h offsets collide; 101h offsets keep separate direct-cache slots.
      for (const machine of [fast, slow]) {
        machine.mem.copyWithin(PHYSICAL + offset, PHYSICAL, PHYSICAL + 10);
        machine._chipDeadline = 10000;
      }
      const dispatcher = await createI80386NativeDispatcher(fast, {
        maxCachedBlocks,
        successorObserver: observed ? {observe: record => events.push(record)} : null,
      });
      for (const eip of [CODE, CODE + offset, CODE]) {
        fast.cpu.eip = slow.cpu.eip = eip;
        assert.equal(dispatcher.run(63), 63);
        for (let i = 0; i < 63; i++) slow.step();
        assert.deepEqual(state(fast), state(slow));
      }
      assert.equal(dispatcher.stats.decoded, maxCachedBlocks === 1 ? 3 : 2);
      assert.equal(events.length, observed ? 3 : 0);
      if (observed) {
        assert.ok(events.every(record => record.retired === 63));
        assert.equal(events.at(-1).successorStatus, 'cached-valid-register-only');
      }
    }
  }
});

test('observer reentry can evict the outer block without leaving a front-cache entry', async () => {
  const fast = fixture(), slow = fixture(), events = [];
  for (const machine of [fast, slow]) {
    machine.mem.copyWithin(PHYSICAL + 0x101, PHYSICAL, PHYSICAL + 10);
    machine._chipDeadline = 10000;
  }
  let reentered = false;
  const dispatcher = await createI80386NativeDispatcher(fast, {
    maxCachedBlocks: 1,
    successorObserver: {observe: record => {
      events.push(record);
      if (reentered) return;
      reentered = true;
      // A different front slot lets the nested dispatch evict the outer
      // Map entry while its observer is still on the stack.
      fast.cpu.eip = slow.cpu.eip = CODE + 0x101;
      assert.equal(dispatcher.run(63), 63);
      for (let i = 0; i < 63; i++) slow.step();
      assert.deepEqual(state(fast), state(slow));
      fast.cpu.eip = slow.cpu.eip = CODE;
    }},
  });
  for (let i = 0; i < 63; i++) slow.step();
  assert.equal(dispatcher.run(63), 63);
  assert.equal(reentered, true);
  assert.deepEqual(state(fast), state(slow));
  assert.equal(dispatcher.stats.decoded, 2);
  assert.equal(dispatcher.run(63), 63);
  for (let i = 0; i < 63; i++) slow.step();
  assert.deepEqual(state(fast), state(slow));
  assert.equal(dispatcher.stats.decoded, 3);
  assert.equal(dispatcher.stats.instructions, 189);
  assert.deepEqual(events.map(record => record.beforeEip), [CODE, CODE + 0x101, CODE]);
});

test('front-cache hits recheck CS, CR3 and CR4 identity', async () => {
  for (const field of ['cs', 'cr3', 'cr4']) {
    const fast = fixture(), slow = fixture();
    const dispatcher = await createI80386NativeDispatcher(fast);
    assert.equal(dispatcher.run(63), 63);
    for (let i = 0; i < 63; i++) slow.step();
    for (const machine of [fast, slow]) {
      if (field === 'cr3') {
        const put32 = (at, value) => {
          for (let i = 0; i < 4; i++) machine._write386(at + i, value >>> (8 * i) & 255);
        };
        put32(0x5800, 0x6007);
        put32(0x6000 + 0x120 * 4, 0x130007);
        machine.mem.copyWithin(0x130000, PHYSICAL, PHYSICAL + 10);
        machine.mem[0x130001] = 2; // New address space executes MOV EAX,2.
        machine.mem[0x130007] = 3; // CMP EAX,3 keeps the backward branch taken.
      }
      machine.cpu[field] = {cs: 8, cr3: 0x5000, cr4: 0x10}[field];
      machine.cpu.invalidateTranslationCache();
      machine.cpu._translate(CODE);
    }
    assert.equal(dispatcher.run(63), 63);
    for (let i = 0; i < 63; i++) slow.step();
    assert.deepEqual(state(fast), state(slow));
    assert.equal(dispatcher.stats.decoded, 2);
    if (field === 'cr3') assert.equal(fast.cpu.eax, 2);
  }
});

test('fallback deletion removes a front entry before later decoding', async () => {
  const machine = fixture();
  const dispatcher = await createI80386NativeDispatcher(machine);
  assert.equal(dispatcher.run(63), 63);
  machine._write386(PHYSICAL, 0x40); // Invalidates cached native bytes.
  assert.equal(dispatcher.run(64), 1);
  machine._write386(PHYSICAL, 0xb8);
  machine.cpu.eip = CODE;
  assert.equal(dispatcher.run(63), 63);
  assert.equal(dispatcher.stats.decoded, 2, 'fallback must remove both cache entries');
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
