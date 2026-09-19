import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

function fixture(bytes) {
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
  return { cpu, memory, writes };
}

test("ARPL raises a destination RPL and changes only ZF", () => {
  const changed = fixture([0x63, 0xd8]).cpu;
  changed.cr0 = 1;
  changed.ax = 0x1234;
  changed.bx = 3;
  changed.eflags = 0x895;
  changed.step();
  assert.equal(changed.ax, 0x1237);
  assert.equal(changed.eflags, 0x8d5);

  const unchanged = fixture([0x63, 0xd8]).cpu;
  unchanged.cr0 = 1;
  unchanged.ax = 0x1237;
  unchanged.bx = 1;
  unchanged.eflags = 0x8d5;
  unchanged.step();
  assert.equal(unchanged.ax, 0x1237);
  assert.equal(unchanged.eflags, 0x895);
});

test("ARPL memory form admits write intent before reading the selector", () => {
  const bytes = [0x2e, 0x63, 0x1e, 0x00, 0x01];
  const reads = [];
  const writes = [];
  const cpu = new I80386({
    fetch: address => bytes[address] ?? 0,
    read: address => { reads.push(address); return 0; },
    write: (address, value) => writes.push([address, value]),
  });
  cpu.cr0 = 1;
  cpu.segmentCaches[1] = {
    ...cpu.segmentCaches[1],
    code: true,
    readable: true,
    writable: false,
  };
  cpu.bx = 3;
  assert.throws(
    () => cpu.step(),
    error => error?.vector === 13 && error.errorCode === 0,
  );
  assert.deepEqual([reads, writes, cpu.eip], [[], [], 0]);
});

test("ARPL is invalid in real and virtual-8086 modes", () => {
  for (const mode of ["real", "vm86"]) {
    const cpu = fixture([0x63, 0xd8]).cpu;
    if (mode === "vm86") {
      cpu.cr0 = 1;
      cpu.eflags |= 0x20000;
    }
    assert.throws(
      () => cpu.step(),
      error => error?.vector === 6 && error.errorCode === null,
    );
    assert.equal(cpu.eip, 0);
  }
});
