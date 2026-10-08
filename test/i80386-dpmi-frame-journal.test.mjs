import assert from 'node:assert/strict';
import test from 'node:test';
import I80386 from '../src/experimental/i80386.js';

const START = 0x20;
const CODE = 0x140000;
const HANDLER = 0x100000;

function fixture({ onRead = null } = {}) {
  const memory = new Map();
  const cpu = new I80386({
    read: address => {
      onRead?.(cpu);
      return memory.get(address >>> 0) ?? 0;
    },
    fetch: address => memory.get(address >>> 0) ?? 0,
    write: (address, value) => memory.set(address >>> 0, value & 255),
  });
  const put = (address, bytes) => bytes.forEach((value, index) =>
    memory.set((address + index) >>> 0, value & 255));
  const descriptor = (base, access) =>
    [255, 255, base, base >>> 8, base >>> 16, access, 0xcf, base >>> 24]
      .map(value => value & 255);
  const gate = (offset, selector, type = 14) =>
    [offset, offset >>> 8, selector, selector >>> 8, 0,
      0xe0 | type, offset >>> 16, offset >>> 24]
      .map(value => value & 255);
  cpu.cr0 = 1;
  cpu.gdtr = { base: 0x200, limit: 0x2f };
  cpu.idtr = { base: 0x300, limit: 0x1ff };
  cpu.tr = { selector: 0x30, base: 0x600, limit: 0x67, present: true, type: 11 };
  put(0x208, descriptor(HANDLER, 0x9a));
  put(0x210, descriptor(0x120000, 0x92));
  put(0x218, descriptor(CODE, 0xfa));
  put(0x220, descriptor(0x160000, 0xf2));
  put(0x604, [0, 4, 0, 0, 0x10, 0]);
  put(0x300 + 0x31 * 8, gate(0x100, 8));
  cpu.cs = 0x1b;
  cpu.ss = 0x23;
  cpu.esp = 0x800;
  cpu.eip = START;
  cpu.eflags = 0x202;
  cpu.segmentCaches[1] = cpu._ringCodeDescriptor(0x1b);
  cpu.segmentCaches[2] = cpu._ringStackDescriptor(0x23, 3, { returnPath: true });
  cpu.ax = 0x0501;
  cpu.bx = 0;
  cpu.cx = 4096;
  put(CODE + START, [0xcd, 0x31, 0xf4]);
  put(HANDLER + 0x100, [0xcf]);
  const arm = (extra = {}) => cpu.armOwned0501FrameJournal({
    cs: 0x1b, startEip: START, endEip: START + 3,
    maxActiveSteps: 10, ...extra,
  });
  return { cpu, memory, put, arm };
}

test('decoded owned 0501 delivery and matching IRETD publish one copied pair', () => {
  const f = fixture();
  const token = f.arm();
  assert.equal(f.cpu.owned0501FrameStatus(token).phase, 'armed');
  assert.equal(f.cpu.step(), 1);
  assert.equal(f.cpu.owned0501FrameStatus(token).phase, 'open');
  assert.equal(f.cpu.takeOwned0501FrameObservation(token), null);
  assert.equal(f.cpu.eip, 0x100);
  assert.equal(f.cpu.esp, 0x3ec);
  f.cpu.bx = 0x49;
  f.cpu.cx = 0x1234;
  assert.equal(f.cpu.step(), 1);
  assert.equal(f.cpu.owned0501FrameStatus(token).phase, 'complete');
  const result = f.cpu.takeOwned0501FrameObservation(token);
  assert.deepEqual([result.phase, result.entry.instructionStart,
    result.entry.returnEip, result.entry.returnCs, result.entry.returnSs,
    result.entry.returnEsp, result.entry.oldCpl, result.entry.newCpl],
    ['complete', START, START + 2, 0x1b, 0x23, 0x800, 3, 0]);
  assert.deepEqual([result.entry.handlerCs, result.entry.handlerEip,
    result.entry.handlerSs, result.entry.handlerEsp, result.entry.frameBytes],
    [8, 0x100, 0x10, 0x3ec, 20]);
  assert.deepEqual([result.returned.consumedEip, result.returned.returnedCs,
    result.returned.returnedSs, result.returned.returnedEsp,
    result.returned.returnedBx, result.returned.returnedCx],
    [START + 2, 0x1b, 0x23, 0x800, 0x49, 0x1234]);
  assert.throws(() => f.cpu.owned0501FrameStatus(token), /stale/);
});

test('prefix-derived post-immediate return EIP is recorded, not guessed', () => {
  const f = fixture();
  f.put(CODE + START, [0x66, 0x66, 0xcd, 0x31]);
  const token = f.arm({ endEip: START + 4 });
  f.cpu.step();
  assert.equal(f.cpu.owned0501FrameStatus(token).phase, 'open');
  f.cpu.step();
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).entry.returnEip,
    START + 4);
});

test('a decoded immediate crossing the admitted wrapper end is refused', () => {
  const f = fixture();
  f.put(CODE + START, [0x66, 0x66, 0xcd, 0x31]);
  const token = f.arm({ endEip: START + 3 });
  f.cpu.step();
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).failure,
    'owned-0501-instruction-profile');
});

test('a 32-bit gate with a 16-bit handler stack is excluded after delivery', () => {
  const f = fixture();
  f.memory.set(0x210 + 6, 0x8f);
  f.put(0x604, [0, 4, 1, 0, 0x10, 0]);
  const token = f.arm();
  f.cpu.step();
  assert.deepEqual([f.cpu.cs, f.cpu.eip], [8, 0x100]);
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).failure,
    'unsupported-owned-delivery');
});

test('wrong request, rejected gate, and direct delivery cannot mint a pair', () => {
  const wrong = fixture();
  wrong.cpu.cx = 4095;
  const wrongToken = wrong.arm();
  wrong.cpu.step();
  assert.equal(wrong.cpu.takeOwned0501FrameObservation(wrongToken).phase,
    'invalid');

  const denied = fixture();
  denied.put(0x300 + 0x31 * 8,
    [0x00, 0x01, 0x08, 0x00, 0, 0x8e, 0, 0]);
  const deniedToken = denied.arm();
  assert.throws(() => denied.cpu.step());
  assert.equal(denied.cpu.takeOwned0501FrameObservation(deniedToken).phase,
    'invalid');

  const direct = fixture();
  const directToken = direct.arm();
  direct.cpu._deliver(0x31, START + 2, null, { software: true });
  assert.equal(direct.cpu.owned0501FrameStatus(directToken).phase, 'armed');
});

test('reset and first-arm callback reentry cannot pair across epochs', () => {
  const f = fixture();
  const token = f.arm();
  f.cpu.step();
  f.cpu.reset();
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).failure, 'cpu-reset');

  let attempted = false, duringStep = false;
  const reentrant = fixture({ onRead: cpu => {
    if (duringStep && !attempted) {
      attempted = true;
      assert.equal(cpu.owned0501FrameStatus(Object.freeze({})).phase, 'invalid');
      assert.equal(cpu.takeOwned0501FrameObservation(Object.freeze({})), null);
      assert.equal(cpu.armOwned0501FrameJournal({
        cs: 0x1b, startEip: START, endEip: START + 3,
        maxActiveSteps: 10,
      }), null);
    }
  } });
  duringStep = true;
  reentrant.cpu.step();
  assert.equal(attempted, true);
  const later = reentrant.arm();
  assert.equal(reentrant.cpu.owned0501FrameStatus(later).phase, 'armed');
});

test('admission getter reentry refuses outer arm before it creates a session', () => {
  const f = fixture();
  const options = { cs: 0x1b, startEip: START, endEip: START + 3,
    maxActiveSteps: 10 };
  const hostile = new Proxy(options, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'startEip')
        assert.equal(f.cpu.armOwned0501FrameJournal(options), null);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assert.throws(() => f.cpu.armOwned0501FrameJournal(hostile), /admission/);
});

test('completed pair is invalidated by reset before consumption', () => {
  const f = fixture();
  const token = f.arm();
  f.cpu.step();
  f.cpu.step();
  assert.equal(f.cpu.owned0501FrameStatus(token).phase, 'complete');
  f.cpu.reset();
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).phase, 'invalid');
});

test('refused hardware interrupt leaves the pair open; accepted delivery invalidates it', () => {
  const f = fixture();
  const token = f.arm();
  f.cpu.step();
  assert.equal(f.cpu.interrupt(0x31), false);
  assert.equal(f.cpu.owned0501FrameStatus(token).phase, 'open');
  f.cpu.eflags |= 0x200;
  assert.equal(f.cpu.interrupt(0x31), true);
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).phase, 'invalid');
});

test('finite active-step cap refuses a late IRET without changing its guest effect', () => {
  const f = fixture();
  const token = f.arm({ maxActiveSteps: 1 });
  f.cpu.step();
  f.cpu.step();
  assert.deepEqual([f.cpu.cs, f.cpu.eip, f.cpu.ss, f.cpu.esp],
    [0x1b, START + 2, 0x23, 0x800]);
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).failure,
    'active-step-cap');
});

test('the same SS:ESP with a changed stack base cannot consume another frame', () => {
  const f = fixture();
  const token = f.arm();
  f.cpu.step();
  for (let byte = 0; byte < 20; byte++)
    f.memory.set(0x1303ec + byte, f.memory.get(0x1203ec + byte));
  f.cpu.segmentCaches[2] = { ...f.cpu.segmentCaches[2], base: 0x130000 };
  f.cpu.step();
  assert.deepEqual([f.cpu.cs, f.cpu.eip, f.cpu.ss, f.cpu.esp],
    [0x1b, START + 2, 0x23, 0x800]);
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).failure,
    'owned-iret-frame-mismatch');
});

test('a handler-edited saved CF is recorded separately from delivery flags', () => {
  const f = fixture();
  const token = f.arm();
  f.cpu.step();
  f.memory.set(0x1203ec + 8, 0x03);
  f.cpu.step();
  const result = f.cpu.takeOwned0501FrameObservation(token);
  assert.equal(result.phase, 'complete');
  assert.equal(result.entry.savedFlags & 1, 0);
  assert.equal(result.returned.consumedFlags & 1, 1);
  assert.equal(result.returned.returnedFlags & 1, 1);
});

test('a post-IRET trace delivery cannot mint a clean pair', () => {
  const f = fixture();
  f.put(0x300 + 8, [0, 1, 8, 0, 0, 0xee, 0, 0]);
  const token = f.arm();
  f.cpu.step();
  f.cpu.eflags |= 0x100;
  f.cpu.step();
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).phase, 'invalid');
});

test('disabled plain-object throw preserves identity and never reads taskCommitted', () => {
  let enabled = false, getterReads = 0;
  const thrown = { get taskCommitted() { getterReads++; throw new Error('getter'); } };
  const f = fixture({ onRead: () => { if (enabled) throw thrown; } });
  enabled = true;
  assert.throws(() => f.cpu.step(), error => error === thrown);
  assert.equal(getterReads, 0);
});

test('a bus callback cannot consume or arm the active session inside delivery', () => {
  let duringStep = false, token, calls = 0;
  const f = fixture({ onRead: cpu => {
    if (!duringStep || calls++) return;
    assert.equal(cpu.takeOwned0501FrameObservation(token), null);
    assert.equal(cpu.armOwned0501FrameJournal({
      cs: 0x1b, startEip: START, endEip: START + 3,
      maxActiveSteps: 10,
    }), null);
  } });
  token = f.arm();
  duringStep = true;
  f.cpu.step();
  assert.equal(f.cpu.takeOwned0501FrameObservation(token).failure,
    'observer-reentry');
});
