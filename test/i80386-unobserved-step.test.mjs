import test from 'node:test';
import assert from 'node:assert/strict';
import I80386 from '../src/experimental/i80386.js';

function fixture(bytes, options = {}) {
  const memory = new Uint8Array(0x10000), writes = [];
  memory.set(bytes);
  const bus = {
    read: address => memory[address] ?? 0,
    fetch: address => memory[address] ?? 0,
    write: (address, value) => {
      writes.push([address, value]);
      memory[address] = value;
    },
  };
  const cpu = new I80386(bus, options);
  cpu.cs = 0; cpu.eip = 0; cpu.ss = 0; cpu.esp = 0x800;
  return {cpu, memory, writes};
}

function state(cpu) {
  return structuredClone({instruction: cpu._snapshotInstruction(),
    cr0: cpu.cr0, cr2: cpu.cr2, cr3: cpu.cr3, cr4: cpu.cr4,
    gdtr: cpu.gdtr, idtr: cpu.idtr, cycles: cpu.cycles,
    shutdown: cpu.shutdown});
}

function attempt(cpu) {
  try { return {cycles: cpu.step()}; }
  catch (error) {
    return {error: error.constructor.name, vector: error.vector,
      errorCode: error.errorCode, message: error.message};
  }
}

test('ordinary transactions match the active-observer path for faults, traces and shadows', () => {
  const cases = [
    {bytes: [0x90]},
    {bytes: [0xfb]}, // STI leaves an interrupt shadow.
    {bytes: [0x8e, 0xd0]}, // MOV SS,AX leaves interrupt/debug shadows.
    {bytes: [0x90], flags: 0x10102}, // TF and RF.
    {bytes: [0x90], debugShadow: 1, flags: 0x102},
    {bytes: [0x90], interruptShadow: 2, nmiShadow: 2},
    {bytes: [0xf6, 0xf0]}, // DIV AL with zero divisor.
    {bytes: [0xf6, 0xf0], deliverFaults: true},
    {bytes: [0x0f, 0xff]}, // Unsupported instruction rolls back.
    {bytes: [0xf4]},
    {bytes: [0x90], halted: true},
    {bytes: [0x90], shutdown: true},
  ];
  for (const spec of cases) {
    const fast = fixture(spec.bytes, {deliverFaults: !!spec.deliverFaults});
    const observed = fixture(spec.bytes, {deliverFaults: !!spec.deliverFaults});
    for (const {cpu} of [fast, observed]) {
      if (spec.flags !== undefined) cpu.eflags = spec.flags;
      cpu._debugShadow = spec.debugShadow ?? 0;
      cpu._interruptShadow = spec.interruptShadow ?? 0;
      cpu._nmiShadow = spec.nmiShadow ?? 0;
      cpu.halted = spec.halted ?? false;
      cpu.shutdown = spec.shutdown ?? false;
    }
    // A real diagnostic selects the original orchestration path. It observes
    // failures without replacing any guest instruction or fault delivery.
    observed.cpu.armOwned0501FaultOutcome({maxActiveSteps: 4});
    assert.deepEqual(attempt(fast.cpu), attempt(observed.cpu), JSON.stringify(spec));
    assert.deepEqual(state(fast.cpu), state(observed.cpu));
    assert.deepEqual(fast.memory, observed.memory);
    assert.deepEqual(fast.writes, observed.writes);
  }
});

test('ordinary bus, snapshot, restore and delivery accessors refuse mid-step admission', () => {
  for (const seam of ['fetch', '_snapshotInstruction', '_restoreInstruction', '_deliverFault']) {
    const faulting = seam === '_restoreInstruction' || seam === '_deliverFault';
    const {cpu} = fixture(faulting ? [0xf6, 0xf0] : [0x90], {deliverFaults: true});
    let attempted = false;
    const original = cpu[seam];
    Object.defineProperty(cpu, seam, {get() {
      attempted = true;
      assert.equal(cpu.armOwned0501FaultOutcome({maxActiveSteps: 2}), null);
      assert.equal(cpu.armOwned0501FrameJournal({}), null);
      return original;
    }});
    assert.equal(cpu.step(), faulting ? 0 : 1);
    assert.equal(attempted, true);
    assert.doesNotThrow(() => cpu.armOwned0501FaultOutcome({maxActiveSteps: 2}));
  }
});

test('a thrown delivery accessor keeps its exception and releases admission depth', () => {
  const {cpu} = fixture([0xf6, 0xf0], {deliverFaults: true});
  const failure = new Error('delivery accessor failure');
  Object.defineProperty(cpu, '_deliverFault', {get() {
    assert.equal(cpu.armOwned0501FaultOutcome({maxActiveSteps: 2}), null);
    throw failure;
  }});
  assert.throws(() => cpu.step(), error => error === failure);
  assert.equal(cpu.eip, 0);
  assert.doesNotThrow(() => cpu.armOwned0501FaultOutcome({maxActiveSteps: 2}));
});

test('ordinary execution releases admission depth after a bus exception', () => {
  const {cpu} = fixture([0x90]);
  const original = cpu.fetch;
  const failure = new Error('bus failure');
  cpu.fetch = () => { throw failure; };
  assert.throws(() => cpu.step(), error => error === failure);
  cpu.fetch = original;
  assert.equal(cpu.step(), 1);
  assert.doesNotThrow(() => cpu.armOwned0501FaultOutcome({maxActiveSteps: 2}));
});
