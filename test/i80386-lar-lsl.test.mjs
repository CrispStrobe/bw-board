import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

function fixture(bytes) {
  const memory = new Map(bytes.map((value, index) => [index, value]));
  const cpu = new I80386({
    read: address => memory.get(address) ?? 0,
    fetch: address => memory.get(address) ?? 0,
    write: (address, value) => memory.set(address, value & 0xff),
  });
  const put = (address, values) =>
    values.forEach((value, index) => memory.set(address + index, value & 0xff));
  return { cpu, memory, put };
}

function descriptor(base, limit, access, flags = 0) {
  return [
    limit, limit >>> 8, base, base >>> 8, base >>> 16, access,
    ((limit >>> 16) & 15) | flags, base >>> 24,
  ];
}

test("LAR loads masked rights at 16/32-bit widths and ignores P", () => {
  for (const [prefix, expected] of [
    [[], 0xaaaa1200],
    [[0x66], 0x00c01200],
  ]) {
    const f = fixture([...prefix, 0x0f, 0x02, 0xc3]);
    f.cpu.cr0 = 1;
    f.cpu.gdtr = { base: 0x100, limit: 0x0f };
    f.put(0x108, descriptor(0, 0xffff, 0x12, 0xc0));
    f.cpu.eax = 0xaaaaaaaa;
    f.cpu.bx = 8;
    f.cpu.eflags = 0x817;
    f.cpu.step();
    assert.equal(f.cpu.eax, expected);
    assert.equal(f.cpu.eflags, 0x857);
  }
});

test("LSL expands granular limits and leaves the destination on rejection", () => {
  const accepted = fixture([0x66, 0x0f, 0x03, 0xc3]);
  accepted.cpu.cr0 = 1;
  accepted.cpu.gdtr = { base: 0x100, limit: 0x17 };
  accepted.put(0x108, descriptor(0, 0x12345, 0x92, 0x80));
  accepted.cpu.bx = 8;
  accepted.cpu.eax = 0xdeadbeef;
  accepted.cpu.step();
  assert.equal(accepted.cpu.eax, 0x12345fff);
  assert.equal(accepted.cpu.eflags & 0x40, 0x40);

  const rejected = fixture([0x66, 0x0f, 0x03, 0xc3]);
  rejected.cpu.cr0 = 1;
  rejected.cpu.gdtr = { base: 0x100, limit: 0x17 };
  rejected.put(0x110, descriptor(0, 0, 0x8c)); // valid LAR call gate, invalid LSL
  rejected.cpu.bx = 0x10;
  rejected.cpu.eax = 0xdeadbeef;
  rejected.cpu.eflags = 0x857;
  rejected.cpu.step();
  assert.deepEqual([rejected.cpu.eax, rejected.cpu.eflags], [0xdeadbeef, 0x817]);
});

test("LAR/LSL enforce privilege while admitting conforming code", () => {
  const denied = fixture([0x0f, 0x02, 0xc3]);
  denied.cpu.cr0 = 1;
  denied.cpu.cs = 3;
  denied.cpu.gdtr = { base: 0x100, limit: 0x0f };
  denied.put(0x108, descriptor(0, 0xffff, 0x92));
  denied.cpu.bx = 0x0b;
  denied.cpu.ax = 0x5555;
  denied.cpu.step();
  assert.deepEqual([denied.cpu.ax, denied.cpu.eflags & 0x40], [0x5555, 0]);

  const conforming = fixture([0x0f, 0x03, 0xc3]);
  conforming.cpu.cr0 = 1;
  conforming.cpu.cs = 3;
  conforming.cpu.gdtr = { base: 0x100, limit: 0x0f };
  conforming.put(0x108, descriptor(0, 0x3456, 0x9e));
  conforming.cpu.bx = 0x0b;
  conforming.cpu.step();
  assert.deepEqual([conforming.cpu.ax, conforming.cpu.eflags & 0x40], [0x3456, 0x40]);
});

test("LAR/LSL reject null and invalid types without selector faults", () => {
  for (const [op, selector, access] of [
    [0x02, 0, null],
    [0x03, 0x10, 0x8c],
    [0x02, 0x10, 0x80],
    [0x03, 0x18, null],
  ]) {
    const f = fixture([0x0f, op, 0xc3]);
    f.cpu.cr0 = 1;
    f.cpu.gdtr = { base: 0x100, limit: 0x17 };
    if (access !== null) f.put(0x100 + (selector & 0xfff8), descriptor(0, 0, access));
    f.cpu.bx = selector;
    f.cpu.ax = 0x7777;
    f.cpu.eflags = 0x857;
    f.cpu.step();
    assert.deepEqual([f.cpu.ax, f.cpu.eflags], [0x7777, 0x817]);
  }
});

test("LAR/LSL are #UD outside protected mode", () => {
  for (const mode of ["real", "vm86"]) {
    const cpu = fixture([0x0f, 0x02, 0xc3]).cpu;
    if (mode === "vm86") {
      cpu.cr0 = 1;
      cpu.eflags |= 0x20000;
    }
    assert.throws(() => cpu.step(), error => error?.vector === 6);
    assert.equal(cpu.eip, 0);
  }
});

test("LAR memory-operand page faults preserve destination, flags, and restart", () => {
  const f = fixture([
    0x67, 0x66, 0x0f, 0x02, 0x05, 0x00, 0x40, 0x00, 0x00,
  ]);
  const put32 = (address, value) =>
    f.put(address, [value, value >>> 8, value >>> 16, value >>> 24]);
  put32(0x1000, 0x2003);
  put32(0x2000, 0x0003);
  f.cpu.cr0 = 0x80000001;
  f.cpu.cr3 = 0x1000;
  f.cpu.eax = 0x12345678;
  f.cpu.eflags = 0x857;
  assert.throws(
    () => f.cpu.step(),
    error => error?.vector === 14 && error.errorCode === 0,
  );
  assert.deepEqual(
    [f.cpu.eax, f.cpu.eflags, f.cpu.eip, f.cpu.cr2],
    [0x12345678, 0x857, 0, 0x4000],
  );
});
