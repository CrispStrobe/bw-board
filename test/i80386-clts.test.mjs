import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

function fixture() {
  const bytes = [0x0f, 0x06];
  return new I80386({
    read: address => bytes[address] ?? 0,
    fetch: address => bytes[address] ?? 0,
    write: () => {},
  });
}

test("CLTS clears only CR0.TS in real mode and protected ring 0", () => {
  for (const protectedMode of [false, true]) {
    const cpu = fixture();
    cpu.cr0 = protectedMode ? 0x80000019 : 0x18;
    cpu.eflags = 0xad7;
    cpu.step();
    assert.deepEqual(
      [cpu.cr0, cpu.eflags, cpu.eip],
      [protectedMode ? 0x80000011 : 0x10, 0xad7, 2],
    );
  }
});

test("CLTS faults atomically outside ring 0, including VM86", () => {
  for (const virtual of [false, true]) {
    const cpu = fixture();
    cpu.cr0 = 0x19;
    cpu.cs = virtual ? 0 : 3;
    cpu.eflags = virtual ? 0x20002 : 2;
    assert.throws(
      () => cpu.step(),
      error => error?.vector === 13 && error.errorCode === 0,
    );
    assert.deepEqual([cpu.cr0, cpu.eip], [0x19, 0]);
  }
});
