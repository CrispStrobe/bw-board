import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

function fixture(bytes) {
  const memory = new Map(bytes.map((value, index) => [index, value]));
  return {
    memory,
    cpu: new I80386({
      read: (address) => memory.get(address) ?? 0,
      fetch: (address) => memory.get(address) ?? 0,
      write: (address, value) => memory.set(address, value & 0xff),
    }),
  };
}

test("IMUL immediate forms sign-extend operands and define only CF/OF", () => {
  const short = fixture([0x66, 0x6b, 0xc3, 0xfe]).cpu;
  short.ebx = 0x40000001;
  short.eflags = 0x46;
  short.step();
  assert.equal(short.eax, 0x7ffffffe);
  assert.equal(short.eflags & 0x8c7, 0x847);

  const fitting = fixture([0x69, 0xcb, 0xff, 0xff]).cpu;
  fitting.ebx = 2;
  fitting.ecx = 0xaaaa0000;
  fitting.eflags = 0x8c7;
  fitting.step();
  assert.equal(fitting.ecx, 0xaaaafffe);
  assert.equal(fitting.eflags & 0x801, 0);
  assert.equal(fitting.eflags & 0xc6, 0xc6);
});

test("IMUL source faults preserve the destination, flags, and restart EIP", () => {
  const { cpu, memory } = fixture([
    0x67, 0x66, 0x69, 0x0d, 0x00, 0x40, 0x00, 0x00, 1, 0, 0, 0,
  ]);
  const put32 = (address, value) => {
    for (let index = 0; index < 4; index++)
      memory.set(address + index, (value >>> (index * 8)) & 0xff);
  };
  put32(0x1000, 0x2003);
  put32(0x2000, 0x0003);
  cpu.cr0 = 0x80000001;
  cpu.cr3 = 0x1000;
  cpu.ecx = 0x12345678;
  cpu.eflags = 0x847;
  assert.throws(
    () => cpu.step(),
    (error) => error?.vector === 14 && error.errorCode === 0,
  );
  assert.deepEqual(
    [cpu.ecx, cpu.eflags, cpu.eip, cpu.cr2],
    [0x12345678, 0x847, 0, 0x4000],
  );
});
