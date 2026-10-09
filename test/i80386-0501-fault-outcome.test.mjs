import assert from 'node:assert/strict';
import test from 'node:test';
import I80386, { I80386Fault } from '../src/experimental/i80386.js';

function fixture({ deliverFaults = true } = {}) {
  const memory = new Map();
  const cpu = new I80386({
    read: address => memory.get(address >>> 0) ?? 0,
    fetch: address => memory.get(address >>> 0) ?? 0,
    write: (address, value) => memory.set(address >>> 0, value & 255),
  }, { deliverFaults });
  cpu.cs = 0x1000;
  cpu.ss = 0x2000;
  cpu.esp = 0x800;
  cpu.eip = 0x123;
  cpu.eflags = 0x202;
  const put = (address, bytes) => bytes.forEach((value, i) =>
    memory.set((address + i) >>> 0, value));
  // Ordinary real-mode vector 14. A returned delivery is only a call outcome.
  put(14 * 4, [0x56, 0x34, 0x78, 0x12]);
  return { cpu, put };
}

test('default-off PF delivery keeps the old real-mode effect and no session', () => {
  const { cpu } = fixture();
  cpu._stepInstruction = () => {
    cpu.cr2 = 0x4a0080;
    throw new I80386Fault(14, 2, 'source page fault');
  };
  assert.equal(cpu.step(), 0);
  assert.equal(cpu.cs, 0x1278);
  assert.equal(cpu.eip, 0x3456);
  assert.equal(cpu.esp, 0x7fa);
});

test('default-off method lookup precedes marker and EIP argument reads', () => {
  const { cpu } = fixture();
  const fault = new I80386Fault(14, 2);
  let calls = 0;
  cpu._stepInstruction = () => { throw fault; };
  Object.defineProperty(cpu, '_deliverFault', {
    get() {
      calls++;
      fault.taskCommitted = true;
      cpu.eip = 0x567;
      return (received, returnEip) => {
        assert.equal(received, fault);
        assert.equal(returnEip, 0x567);
      };
    },
  });
  assert.equal(cpu.step(), 0);
  assert.equal(calls, 1);
});

test('opt-in PF records source facts, actual rollback and returned delivery', () => {
  const { cpu } = fixture();
  const token = cpu.armOwned0501FaultOutcome({ maxActiveSteps: 2 });
  const fault = new I80386Fault(14, 2, 'source page fault');
  assert.equal(Object.hasOwn(fault, 'taskCommitted'), false);
  cpu._stepInstruction = () => {
    cpu.eip = 0x456;
    cpu.cr2 = 0x4a0080;
    throw fault;
  };
  assert.equal(cpu.step(), 0);
  const result = cpu.takeOwned0501FaultOutcome(token);
  assert.equal(result.schema, 'bw.i80386-owned-0501.pf-delivery-outcome.v1');
  assert.deepEqual([result.phase, result.firstFailure,
    result.fault.step, result.fault.instructionStart,
    result.fault.vector, result.fault.errorCode,
    result.fault.taskCommitted, result.fault.source.cr2],
    ['complete', null, 1, 0x123, 14, 2, false, 0x4a0080]);
  assert.deepEqual([result.delivery.attempted, result.delivery.outcome,
    result.delivery.restored, result.delivery.returnEip,
    result.delivery.post.cs, result.delivery.post.eip,
    result.frameReturnQualified],
    [true, 'returned', true, 0x123, 0x1278, 0x3456, false]);
  assert.throws(() => cpu.owned0501FaultOutcomeStatus(token), /stale/);
});

test('disabled fault delivery rethrows the original and retains partial facts', () => {
  const { cpu } = fixture({ deliverFaults: false });
  const fault = new I80386Fault(14, 0, 'unhandled');
  const token = cpu.armOwned0501FaultOutcome({ maxActiveSteps: 1 });
  cpu._stepInstruction = () => { cpu.cr2 = 0x12000; throw fault; };
  assert.throws(() => cpu.step(), error => error === fault);
  const result = cpu.takeOwned0501FaultOutcome(token);
  assert.deepEqual([result.phase, result.fault.source.cr2,
    result.delivery.attempted, result.delivery.outcome,
    result.delivery.restored],
    ['complete', 0x12000, false, 'disabled', true]);
});

test('taskCommitted fault preserves the guest state and chosen return EIP', () => {
  const { cpu } = fixture();
  const fault = new I80386Fault(14, 4, 'committed source fault');
  fault.taskCommitted = true;
  const token = cpu.armOwned0501FaultOutcome({ maxActiveSteps: 1 });
  cpu._stepInstruction = () => {
    cpu.eip = 0x456;
    cpu.cr2 = 0x89000;
    throw fault;
  };
  cpu._deliverFault = (_fault, returnEip) => {
    assert.equal(_fault, fault);
    assert.equal(returnEip, 0x456);
    cpu.eip = 0x789;
  };
  assert.equal(cpu.step(), 0);
  const result = cpu.takeOwned0501FaultOutcome(token);
  assert.deepEqual([result.fault.taskCommitted, result.delivery.restored,
    result.delivery.returnEip, result.delivery.post.eip],
    [true, false, 0x456, 0x789]);
});

test('opt-in method lookup still precedes the committed EIP argument', () => {
  const { cpu } = fixture();
  const token = cpu.armOwned0501FaultOutcome({ maxActiveSteps: 1 });
  const fault = new I80386Fault(14, 2);
  fault.taskCommitted = true;
  cpu._stepInstruction = () => { cpu.eip = 0x456; throw fault; };
  Object.defineProperty(cpu, '_deliverFault', {
    get() {
      cpu.eip = 0x567;
      return (_fault, returnEip) => assert.equal(returnEip, 0x567);
    },
  });
  assert.equal(cpu.step(), 0);
  const result = cpu.takeOwned0501FaultOutcome(token);
  assert.equal(result.phase, 'complete');
  assert.equal(result.delivery.returnEip, 0x567);
  assert.equal(result.delivery.pre.eip, 0x567);
});

test('method lookup throw retains partial fault without false call credit', () => {
  const { cpu } = fixture();
  const token = cpu.armOwned0501FaultOutcome({ maxActiveSteps: 1 });
  const fault = new I80386Fault(14, 2);
  const thrown = new Error('method lookup');
  cpu._stepInstruction = () => { throw fault; };
  Object.defineProperty(cpu, '_deliverFault', { get() { throw thrown; } });
  assert.throws(() => cpu.step(), error => error === thrown);
  const result = cpu.takeOwned0501FaultOutcome(token);
  assert.equal(result.phase, 'invalid');
  assert.equal(result.firstFailure, 'delivery-call-setup-threw');
  assert.equal(result.fault.vector, 14);
  assert.equal(result.delivery, null);
});

test('argument getter throw also retains partial fault without call credit', () => {
  const { cpu } = fixture();
  const token = cpu.armOwned0501FaultOutcome({ maxActiveSteps: 1 });
  const fault = new I80386Fault(14, 2);
  const thrown = new Error('second marker read');
  let called = false;
  cpu._stepInstruction = () => { throw fault; };
  Object.defineProperty(cpu, '_deliverFault', {
    get() {
      Object.defineProperty(fault, 'taskCommitted', {
        get() { throw thrown; },
      });
      return () => { called = true; };
    },
  });
  assert.throws(() => cpu.step(), error => error === thrown);
  assert.equal(called, false);
  const result = cpu.takeOwned0501FaultOutcome(token);
  assert.equal(result.firstFailure, 'delivery-call-setup-threw');
  assert.equal(result.fault.vector, 14);
  assert.equal(result.delivery, null);
});

test('delivery throw is retained without replacing its original object', () => {
  const { cpu } = fixture();
  const thrown = new Error('delivery callback failure');
  const token = cpu.armOwned0501FaultOutcome({ maxActiveSteps: 1 });
  cpu._stepInstruction = () => { throw new I80386Fault(14, 2); };
  cpu._deliverFault = () => { throw thrown; };
  assert.throws(() => cpu.step(), error => error === thrown);
  const result = cpu.takeOwned0501FaultOutcome(token);
  assert.deepEqual([result.phase, result.delivery.outcome,
    result.delivery.thrownKind, result.firstFailure],
    ['complete', 'threw', 'unclassified-throw', null]);
});

test('falsey delivery throw still records an unclassified thrown outcome', () => {
  const { cpu } = fixture();
  const token = cpu.armOwned0501FaultOutcome({ maxActiveSteps: 1 });
  cpu._stepInstruction = () => { throw new I80386Fault(14, 2); };
  cpu._deliverFault = () => { throw null; };
  let caught = false;
  try { cpu.step(); } catch (error) {
    caught = true;
    assert.equal(error, null);
  }
  assert.equal(caught, true);
  const result = cpu.takeOwned0501FaultOutcome(token);
  assert.deepEqual([result.phase, result.delivery.outcome,
    result.delivery.thrownKind, result.firstFailure],
    ['complete', 'threw', 'unclassified-throw', null]);
});

test('a returned delivery with shutdown is not credited as PF service', () => {
  const { cpu } = fixture();
  const token = cpu.armOwned0501FaultOutcome({ maxActiveSteps: 1 });
  cpu._stepInstruction = () => { throw new I80386Fault(14, 2); };
  cpu._deliverFault = () => { cpu.shutdown = true; };
  assert.equal(cpu.step(), 0);
  const result = cpu.takeOwned0501FaultOutcome(token);
  assert.equal(result.delivery.outcome, 'returned');
  assert.equal(result.delivery.post.shutdown, true);
  assert.equal(result.delivery.stepResult, 0);
  assert.equal(result.frameReturnQualified, false);
});

test('swallowed active status reentry poisons observation but not guest delivery', () => {
  const { cpu } = fixture();
  const token = cpu.armOwned0501FaultOutcome({ maxActiveSteps: 1 });
  cpu._stepInstruction = () => {
    assert.equal(cpu.owned0501FaultOutcomeStatus(token).phase, 'invalid');
    throw new I80386Fault(14, 2);
  };
  assert.equal(cpu.step(), 0);
  const result = cpu.takeOwned0501FaultOutcome(token);
  assert.equal(result.phase, 'invalid');
  assert.equal(result.firstFailure, 'observer-reentry');
  assert.equal(result.delivery, null);
  assert.equal(cpu.cs, 0x1278);
});

test('fault accessors and malformed numeric facts fail only the observer', () => {
  for (const malformed of ['accessor', 'fractional']) {
    const { cpu } = fixture({ deliverFaults: false });
    const token = cpu.armOwned0501FaultOutcome({ maxActiveSteps: 1 });
    const fault = new I80386Fault(14, 2);
    let reads = 0;
    if (malformed === 'accessor')
      Object.defineProperty(fault, 'vector', { get() { reads++; return 14; } });
    else fault.errorCode = 1.5;
    cpu._stepInstruction = () => { throw fault; };
    assert.throws(() => cpu.step(), error => error === fault);
    const result = cpu.takeOwned0501FaultOutcome(token);
    assert.equal(result.phase, 'invalid');
    assert.equal(result.firstFailure, 'fault-source-unavailable');
    assert.equal(reads, 0);
  }
});

test('observer never adds a taskCommitted getter read to the original branch', () => {
  const { cpu } = fixture({ deliverFaults: false });
  const token = cpu.armOwned0501FaultOutcome({ maxActiveSteps: 1 });
  const fault = new I80386Fault(14, 2);
  let reads = 0;
  Object.defineProperty(fault, 'taskCommitted', {
    get() { reads++; return false; },
  });
  cpu._stepInstruction = () => { throw fault; };
  assert.throws(() => cpu.step(), error => error === fault);
  assert.equal(reads, 1); // the existing guest rollback branch, not the observer
  const result = cpu.takeOwned0501FaultOutcome(token);
  assert.equal(result.firstFailure, 'fault-source-unavailable');
});

test('swallowed own-descriptor reentry cannot revive a refused PF record', () => {
  const { cpu } = fixture({ deliverFaults: false });
  const token = cpu.armOwned0501FaultOutcome({ maxActiveSteps: 1 });
  const fault = new I80386Fault(14, 2);
  const trapped = new Proxy(fault, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'vector')
        assert.equal(cpu.owned0501FaultOutcomeStatus(token).phase, 'invalid');
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  cpu._stepInstruction = () => { throw trapped; };
  assert.throws(() => cpu.step(), error => error === trapped);
  const result = cpu.takeOwned0501FaultOutcome(token);
  assert.equal(result.firstFailure, 'observer-reentry');
  assert.equal(result.fault, null);
  assert.equal(result.delivery, null);
});

test('post-delivery observer failure retains copied fault and guest result', () => {
  const { cpu } = fixture();
  const token = cpu.armOwned0501FaultOutcome({ maxActiveSteps: 1 });
  cpu._stepInstruction = () => { throw new I80386Fault(14, 2); };
  cpu._deliverFault = () => {
    Object.defineProperty(cpu, 'cr2', {
      configurable: true,
      get() { throw new Error('observer-only CR2 getter'); },
    });
  };
  assert.equal(cpu.step(), 0);
  const result = cpu.takeOwned0501FaultOutcome(token);
  assert.equal(result.phase, 'invalid');
  assert.equal(result.firstFailure, 'delivery-outcome-unavailable');
  assert.equal(result.fault.vector, 14);
  assert.equal(result.delivery, null);
});

test('step cap and reset refuse without suppressing ordinary CPU effects', () => {
  const { cpu } = fixture();
  const token = cpu.armOwned0501FaultOutcome({ maxActiveSteps: 1 });
  cpu._stepInstruction = () => 1;
  assert.equal(cpu.step(), 1);
  cpu._stepInstruction = () => { throw new I80386Fault(14, 2); };
  assert.equal(cpu.step(), 0);
  const result = cpu.takeOwned0501FaultOutcome(token);
  assert.equal(result.firstFailure, 'fault-observer-step-cap');
  assert.equal(result.fault, null);
  const next = cpu.armOwned0501FaultOutcome({ maxActiveSteps: 1 });
  cpu.reset();
  const reset = cpu.takeOwned0501FaultOutcome(next);
  assert.equal(reset.firstFailure, 'cpu-reset');
});

test('arm requires own bounded options and denies admission reentry', () => {
  const { cpu } = fixture();
  let invoked = 0;
  const options = {};
  Object.defineProperty(options, 'maxActiveSteps', { get() { invoked++; return 1; } });
  assert.throws(() => cpu.armOwned0501FaultOutcome(options), /own data/);
  assert.equal(invoked, 0);
  assert.throws(() => cpu.armOwned0501FaultOutcome({ maxActiveSteps: 100001 }),
    /step cap/);
  const reentrant = new Proxy({ maxActiveSteps: 1 }, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'maxActiveSteps') {
        try { cpu.owned0501FaultOutcomeStatus({}); } catch { /* swallowed */ }
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.throws(() => cpu.armOwned0501FaultOutcome(reentrant), /admission/);
  const token = cpu.armOwned0501FaultOutcome({ maxActiveSteps: 1 });
  assert.equal(cpu.owned0501FaultOutcomeStatus(token).phase, 'armed');
});
