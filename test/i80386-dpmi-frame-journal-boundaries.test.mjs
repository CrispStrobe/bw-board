import assert from 'node:assert/strict';
import test from 'node:test';
import I80386, { I80386Fault } from '../src/experimental/i80386.js';

const START = 0x20;
const HANDLER_BASE = 0x100000;
const CALLER_BASE = 0x140000;
const STACK_BASE = 0x120000;

function put(memory, address, bytes) {
  bytes.forEach((byte, index) => memory.set((address + index) >>> 0, byte & 255));
}

function word(memory, address, value) {
  put(memory, address, [value, value >>> 8]);
}

function dword(memory, address, value) {
  put(memory, address, [value, value >>> 8, value >>> 16, value >>> 24]);
}

function descriptor(base, limit, access, flags = 0xc0) {
  return [limit, limit >>> 8, base, base >>> 8, base >>> 16,
    access, ((limit >>> 16) & 15) | flags, base >>> 24].map(byte => byte & 255);
}

function gate(offset, selector, access = 0xee) {
  return [offset, offset >>> 8, selector, selector >>> 8, 0,
    access, offset >>> 16, offset >>> 24].map(byte => byte & 255);
}

function fixture({ deliverFaults = false, sameCpl = false } = {}) {
  const memory = new Map();
  const cpu = new I80386({
    read: address => memory.get(address >>> 0) ?? 0,
    fetch: address => memory.get(address >>> 0) ?? 0,
    write: (address, byte) => memory.set(address >>> 0, byte & 255),
  }, { deliverFaults });
  cpu.cr0 = 1;
  cpu.gdtr = { base: 0x200, limit: 0x3f };
  cpu.idtr = { base: 0x300, limit: 0x1ff };
  cpu.tr = { selector: 0x30, base: 0x600, limit: 0x67, present: true, type: 11 };
  put(memory, 0x208, descriptor(HANDLER_BASE, 0xfffff, 0x9a));
  put(memory, 0x210, descriptor(STACK_BASE, 0xfffff, 0x92));
  put(memory, 0x218, descriptor(CALLER_BASE, 0xfffff, 0xfa));
  put(memory, 0x220, descriptor(0x160000, 0xfffff, 0xf2));
  put(memory, 0x230, descriptor(0x600, 0x67, 0x8b, 0));
  put(memory, 0x238, descriptor(0x700, 0x67, 0x89, 0));
  put(memory, 0x604, [0, 4, 0, 0, 0x10, 0]);
  put(memory, 0x300 + 0x31 * 8, gate(0x100, 8));
  cpu.cs = sameCpl ? 8 : 0x1b;
  cpu.ss = sameCpl ? 0x10 : 0x23;
  cpu.esp = 0x800;
  cpu.eip = START;
  cpu.eflags = 0x202;
  cpu.segmentCaches[1] = cpu._ringCodeDescriptor(cpu.cs);
  cpu.segmentCaches[2] = cpu._ringStackDescriptor(cpu.ss,
    sameCpl ? 0 : 3, { returnPath: true });
  cpu.ax = 0x0501;
  cpu.bx = 0;
  cpu.cx = 4096;
  put(memory, (sameCpl ? HANDLER_BASE : CALLER_BASE) + START, [0xcd, 0x31]);
  put(memory, HANDLER_BASE + 0x100, [0xcf]);
  const arm = () => cpu.armOwned0501FrameJournal({
    cs: cpu.cs, startEip: START, endEip: START + 2, maxActiveSteps: 8,
  });
  return { cpu, memory, arm };
}

test('delivered #GP fallback returns zero without publishing a 0501 entry', () => {
  const { cpu, memory, arm } = fixture({ deliverFaults: true });
  put(memory, 0x300 + 0x31 * 8, gate(0x100, 8, 0x8e));
  put(memory, 0x300 + 13 * 8, gate(0x200, 8, 0x8e));
  const token = arm();
  assert.equal(cpu.step(), 0);
  assert.deepEqual([cpu.cs, cpu.eip], [8, 0x200]);
  const observation = cpu.takeOwned0501FrameObservation(token);
  assert.equal(observation.phase, 'invalid');
  assert.equal(observation.entry, null);
});

function taskGateFixture() {
  const f = fixture();
  const { memory, cpu } = f;
  put(memory, 0x300 + 0x31 * 8, [0, 0, 0x38, 0, 0, 0xe5, 0, 0]);
  dword(memory, 0x700 + 0x1c, 0);
  dword(memory, 0x700 + 0x20, 0x100);
  dword(memory, 0x700 + 0x24, 2);
  dword(memory, 0x700 + 0x38, 0x500);
  for (const [offset, selector] of [[0x48, 0x10], [0x4c, 8],
    [0x50, 0x10], [0x54, 0x10], [0x58, 0], [0x5c, 0], [0x60, 0]])
    word(memory, 0x700 + offset, selector);
  return f;
}

test('a real IDT task gate changes task but cannot become a stack-frame pair', () => {
  const { cpu, memory, arm } = taskGateFixture();
  const token = arm();
  assert.equal(cpu.step(), 1);
  assert.deepEqual([cpu.tr.selector, cpu.cs, cpu.eip], [0x38, 8, 0x100]);
  assert.equal(memory.get(0x23d) & 15, 11, 'incoming TSS became busy');
  const observation = cpu.takeOwned0501FrameObservation(token);
  assert.deepEqual([observation.phase, observation.failure],
    ['invalid', 'task-switch-during-owned-frame']);
  assert.equal(observation.entry, null);
});

test('a post-commit task-gate fault retains task effects and refuses journal success', () => {
  const { cpu, memory, arm } = taskGateFixture();
  word(memory, 0x700 + 0x50, 0x40); // Invalid incoming SS after task commit.
  const token = arm();
  assert.throws(() => cpu.step(), error => error instanceof I80386Fault &&
    error.taskCommitted === true);
  assert.equal(cpu.tr.selector, 0x38);
  assert.equal(memory.get(0x23d) & 15, 11);
  assert.equal(cpu.takeOwned0501FrameObservation(token).phase, 'invalid');
});

test('a successful 16-bit IRET effect cannot complete the protected32 pair', () => {
  const { cpu, memory, arm } = fixture();
  put(memory, HANDLER_BASE + 0x100, [0x66, 0xcf]);
  const token = arm();
  assert.equal(cpu.step(), 1);
  assert.equal(cpu.esp, 0x3ec);
  // Make the 16-bit return architecturally valid, but different from the
  // original 32-bit outer return frame.
  word(memory, STACK_BASE + 0x3ec, 0x220);
  word(memory, STACK_BASE + 0x3ee, 8);
  word(memory, STACK_BASE + 0x3f0, 2);
  assert.equal(cpu.step(), 1);
  assert.deepEqual([cpu.cs, cpu.eip, cpu.esp], [8, 0x220, 0x3f2]);
  assert.equal(cpu.takeOwned0501FrameObservation(token).phase, 'invalid');
});

test('same-CPL 32-bit delivery and IRET retain a twelve-byte linear frame', () => {
  const { cpu, arm } = fixture({ sameCpl: true });
  const token = arm();
  assert.equal(cpu.step(), 1);
  assert.deepEqual([cpu.cs, cpu.eip, cpu.ss, cpu.esp], [8, 0x100, 0x10, 0x7f4]);
  assert.equal(cpu.step(), 1);
  const observation = cpu.takeOwned0501FrameObservation(token);
  assert.equal(observation.phase, 'complete');
  assert.deepEqual([observation.entry.oldCpl, observation.entry.newCpl,
    observation.entry.frameLinear, observation.entry.frameBytes],
    [0, 0, STACK_BASE + 0x7f4, 12]);
  assert.deepEqual([observation.returned.consumedFrameLinear,
    observation.returned.returnedCs, observation.returned.returnedEip,
    observation.returned.returnedSs, observation.returned.returnedEsp],
    [STACK_BASE + 0x7f4, 8, START + 2, 0x10, 0x800]);
});
