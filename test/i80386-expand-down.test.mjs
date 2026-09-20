import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

function fixture(bytes = []) {
  const memory = new Map(bytes.map((value, index) => [index, value]));
  const writes = [];
  const cpu = new I80386({
    read: address => memory.get(address) ?? 0,
    fetch: address => memory.get(address) ?? 0,
    write: (address, value) => {
      writes.push([address, value & 0xff]);
      memory.set(address, value & 0xff);
    },
  });
  const put = (address, values) =>
    values.forEach((value, index) => memory.set(address + index, value & 0xff));
  return { cpu, memory, writes, put };
}

function descriptor(base, limit, access, flags = 0) {
  return [
    limit, limit >>> 8, base, base >>> 8, base >>> 16, access,
    ((limit >>> 16) & 15) | flags, base >>> 24,
  ];
}
function gate(offset, selector, dpl = 3) {
  return [offset, offset >>> 8, selector, selector >>> 8, 0, 0x8e | (dpl << 5), offset >>> 16, offset >>> 24];
}

test("MOV loads a writable expand-down data cache with an exclusive lower bound", () => {
  const f = fixture([0x8e, 0xd8]);
  f.cpu.cr0 = 1;
  f.cpu.gdtr = { base: 0x100, limit: 0x0f };
  f.put(0x108, descriptor(0x200, 0x0fff, 0x96));
  f.cpu.ax = 8;
  f.cpu.step();
  assert.equal(f.cpu.segmentCaches[3].expandDown, true);
  f.memory.set(0x1200, 0x5a);
  assert.equal(f.cpu._read(3, 0x1000, 8), 0x5a);
  assert.throws(
    () => f.cpu._read(3, 0x0fff, 8),
    error => error?.vector === 13 && error.errorCode === 0,
  );
  assert.throws(
    () => f.cpu._read(3, 0x10000, 8),
    error => error?.vector === 13,
  );
});

test("32-bit expand-down data spans through FFFFFFFF without wrapping", () => {
  const f = fixture([0x8e, 0xd8]);
  f.cpu.cr0 = 1;
  f.cpu.gdtr = { base: 0x100, limit: 0x0f };
  f.put(0x108, descriptor(0, 0xffffe, 0x96, 0xc0));
  f.cpu.ax = 8;
  f.cpu.step();
  assert.equal(f.cpu.segmentCaches[3].limit, 0xffffefff);
  assert.equal(f.cpu._linear(3, 0xfffff000, 0x1000), 0xfffff000);
  assert.throws(
    () => f.cpu._linear(3, 0xffffffff, 2),
    error => error?.vector === 13,
  );
});

test("16-bit expand-down stack pushes preflight lower and upper boundaries", () => {
  for (const [sp, accepted] of [[0x1004, true], [0x1001, false], [1, false]]) {
    const f = fixture();
    f.cpu.cr0 = 1;
    f.cpu.segmentCaches[2] = {
      base: 0,
      limit: 0x0fff,
      default32: false,
      present: true,
      code: false,
      expandDown: true,
      readable: true,
      writable: true,
    };
    f.cpu.sp = sp;
    if (accepted) {
      f.cpu._push(0x1234, 16);
      assert.deepEqual([f.cpu.sp, f.memory.get(0x1002), f.memory.get(0x1003)], [0x1002, 0x34, 0x12]);
    } else {
      assert.throws(() => f.cpu._push(0x1234, 16), error => error?.vector === 12);
      assert.deepEqual([f.cpu.sp, f.writes], [sp, []]);
    }
  }
});

test("MOV SS installs expand-down bounds used by the following PUSH", () => {
  const f = fixture([0x8e, 0xd0, 0x53]);
  f.cpu.cr0 = 1;
  f.cpu.gdtr = { base: 0x100, limit: 0x0f };
  f.put(0x108, descriptor(0, 0x0fff, 0x96));
  f.cpu.ax = 8;
  f.cpu.bx = 0x5678;
  f.cpu.sp = 0x1004;
  f.cpu.step();
  assert.equal(f.cpu.segmentCaches[2].expandDown, true);
  f.cpu.step();
  assert.deepEqual([f.cpu.sp, f.memory.get(0x1002), f.memory.get(0x1003)], [0x1002, 0x78, 0x56]);
});

test("inner-ring stack admission retains expand-down geometry", () => {
  const f = fixture();
  f.cpu.cr0 = 1;
  f.cpu.gdtr = { base: 0x100, limit: 0x0f };
  f.put(0x108, descriptor(0x4000, 0x1fff, 0xf6, 0x40));
  const stack = f.cpu._ringStackDescriptor(0x0b, 3);
  assert.deepEqual(
    [stack.base, stack.limit, stack.default32, stack.expandDown],
    [0x4000, 0x1fff, true, true],
  );
});

test("ring-3 INT and IRETD use an expand-down inner stack", () => {
  const f = fixture();
  const dword = address => [0, 1, 2, 3].reduce(
    (value, index) => value | ((f.memory.get(address + index) ?? 0) << (index * 8)), 0,
  ) >>> 0;
  f.cpu.deliverFaults = true;
  f.cpu.cr0 = 1;
  f.cpu.gdtr = { base: 0x200, limit: 0x2f };
  f.cpu.idtr = { base: 0x400, limit: 0x7ff };
  f.put(0x208, descriptor(0x100000, 0xfffff, 0x9a, 0xc0));
  f.put(0x210, descriptor(0x120000, 0x3df, 0x96, 0x40));
  f.put(0x218, descriptor(0x140000, 0xfffff, 0xfa, 0xc0));
  f.put(0x220, descriptor(0x160000, 0xfffff, 0xf2, 0xc0));
  f.put(0x400 + 0x20 * 8, gate(0x100, 8));
  f.cpu.tr = { selector: 0x28, base: 0x600, limit: 0x67, present: true, type: 11 };
  f.put(0x604, [0x00, 0x04, 0, 0, 0x10, 0]);
  f.cpu.cs = 0x1b;
  f.cpu.ss = 0x23;
  f.cpu.segmentCaches[1] = f.cpu._ringCodeDescriptor(0x1b);
  f.cpu.segmentCaches[2] = f.cpu._ringStackDescriptor(0x23, 3, { returnPath: true });
  f.cpu.esp = 0x800;
  f.cpu.eflags = 0x202;
  f.put(0x140000, [0xcd, 0x20]);
  f.put(0x100100, [0xcf]);
  f.cpu.step();
  assert.deepEqual([f.cpu.cs, f.cpu.ss, f.cpu.esp], [8, 0x10, 0x3ec]);
  assert.deepEqual(
    [0, 4, 8, 12, 16].map(offset => dword(0x1203ec + offset)),
    [2, 0x1b, 0x202, 0x800, 0x23],
  );
  f.cpu.step();
  assert.deepEqual([f.cpu.cs, f.cpu.eip, f.cpu.ss, f.cpu.esp], [0x1b, 2, 0x23, 0x800]);
});

test("32-bit expand-down stack pushes preflight limit and wrap faults", () => {
  for (const [esp, accepted] of [[0xfffff008, true], [0xfffff003, false], [2, false]]) {
    const f = fixture();
    f.cpu.cr0 = 1;
    f.cpu.segmentCaches[2] = {
      base: 0,
      limit: 0xffffefff,
      default32: true,
      present: true,
      code: false,
      expandDown: true,
      readable: true,
      writable: true,
    };
    f.cpu.esp = esp;
    if (accepted) {
      f.cpu._push(0x12345678, 32);
      assert.equal(f.cpu.esp, 0xfffff004);
    } else {
      assert.throws(() => f.cpu._push(0x12345678, 32), error => error?.vector === 12);
      assert.deepEqual([f.cpu.esp, f.writes], [esp, []]);
    }
  }
});
