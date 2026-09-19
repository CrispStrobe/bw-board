import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

function fixture(bytes) {
  const memory = new Map(bytes.map((value, index) => [index, value]));
  const writes = [];
  const cpu = new I80386({
    read: (address) => memory.get(address) ?? 0,
    fetch: (address) => memory.get(address) ?? 0,
    write(address, value) {
      writes.push([address, value & 0xff]);
      memory.set(address, value & 0xff);
    },
  });
  return { cpu, memory, writes };
}

function descriptor(base, access, flags = 0x40) {
  return [
    0xff,
    0xff,
    base,
    base >>> 8,
    base >>> 16,
    access,
    flags,
    base >>> 24,
  ].map((value) => value & 0xff);
}

test("MOV from segment register zero-extends 32-bit registers but writes 16-bit memory", () => {
  const { cpu, writes } = fixture([
    0x66, 0x8c, 0xd8,
    0x8c, 0x26, 0x00, 0x01,
    0x8c, 0xe1,
    0x8c, 0xe9,
  ]);
  cpu.eax = 0xaaaa5555;
  cpu.ds = 0x1234;
  cpu.fs = 0x5678;
  cpu.gs = 0x9abc;
  cpu.step();
  assert.equal(cpu.eax, 0x1234);
  cpu.step();
  assert.deepEqual(writes.slice(-2), [[0x100, 0x78], [0x101, 0x56]]);
  cpu.step();
  assert.equal(cpu.cx, 0x5678);
  cpu.step();
  assert.equal(cpu.cx, 0x9abc);
});

test("LDT selectors 4..7 are not mistaken for null data selectors", () => {
  const { cpu } = fixture([0x8e, 0xd8]);
  cpu.cr0 = 1;
  cpu.ax = 4;
  assert.throws(
    () => cpu.step(),
    (error) =>
      error instanceof Error &&
      error.constructor.name === "UnsupportedI80386" &&
      /LDT/.test(error.message),
  );
  assert.equal(cpu.ds, 0);
});

test("readable conforming code loads as data without RPL/DPL admission", () => {
  const { cpu, memory } = fixture([0x8e, 0xd8]);
  cpu.cr0 = 1;
  cpu.cs = 3;
  cpu.gdtr = { base: 0x200, limit: 0x17 };
  descriptor(0x4000, 0x9e).forEach((value, index) =>
    memory.set(0x208 + index, value),
  );
  cpu.ax = 0x0b;
  cpu.step();
  assert.equal(cpu.ds, 0x0b);
  assert.equal(cpu.segmentCaches[3].base, 0x4000);
});

test("MOV to segment rejects invalid encodings and null SS architecturally", () => {
  for (const bytes of [[0x8e, 0xc8], [0x8e, 0xf0]]) {
    const { cpu } = fixture(bytes);
    assert.throws(() => cpu.step(), (error) => error?.vector === 6);
    assert.equal(cpu.eip, 0);
  }
  const { cpu } = fixture([0x8e, 0xd0]);
  cpu.cr0 = 1;
  cpu.ax = 0;
  assert.throws(
    () => cpu.step(),
    (error) => error?.vector === 13 && error.errorCode === 0,
  );
});

test("protected data loads validate presence and null selectors before commit", () => {
  const { cpu, memory } = fixture([0x8e, 0xd8]);
  cpu.cr0 = 1;
  cpu.gdtr = { base: 0x200, limit: 0x17 };
  descriptor(0x4000, 0x12).forEach((value, index) =>
    memory.set(0x208 + index, value),
  );
  cpu.ax = 8;
  assert.throws(
    () => cpu.step(),
    (error) => error?.vector === 11 && error.errorCode === 8,
  );
  assert.equal(cpu.ds, 0);

  cpu.eip = 0;
  cpu.ax = 0;
  cpu.step();
  assert.equal(cpu.ds, 0);
  assert.throws(
    () => cpu._read(3, 0, 8),
    (error) => error?.vector === 13 && error.errorCode === 0,
  );
});

test("single string operations honor sizes, overrides, and DF index direction", () => {
  const { cpu, memory } = fixture([
    0x67, 0xa4,
    0x66, 0xab,
    0xfd,
    0xac,
    0xae,
  ]);
  cpu.esi = 0x10000;
  cpu.edi = 0x10010;
  cpu.segmentCaches[0].limit = 0x1ffff;
  cpu.segmentCaches[3].limit = 0x1ffff;
  cpu.eax = 0x44332211;
  memory.set(0x10000, 0x5a);
  cpu.step();
  assert.equal(memory.get(0x10010), 0x5a);
  assert.deepEqual([cpu.esi, cpu.edi], [0x10001, 0x10011]);
  cpu.step();
  assert.deepEqual(
    [0, 1, 2, 3].map((index) => memory.get(0x0011 + index)),
    [0x11, 0x22, 0x33, 0x44],
  );
  cpu.step();
  cpu.si = 0x200;
  cpu.di = 0x300;
  memory.set(0x200, 0x80);
  memory.set(0x300, 0x80);
  cpu.step();
  assert.deepEqual([cpu.al, cpu.si], [0x80, 0x1ff]);
  cpu.step();
  assert.equal(cpu.di, 0x2ff);
  assert.equal(cpu.eflags & 0x40, 0x40);
});
