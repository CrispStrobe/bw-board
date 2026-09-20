import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

const ZF = 0x40;

function execute(bytes, setup = () => {}) {
  const memory = new Map(bytes.map((value, index) => [index, value]));
  const cpu = new I80386({
    read: address => memory.get(address) ?? 0,
    fetch: address => memory.get(address) ?? 0,
    write: (address, value) => memory.set(address, value & 255),
  });
  setup(cpu, memory);
  cpu.step();
  return cpu;
}

test("BSF and BSR find the low and high set bits at 16/32-bit boundaries", () => {
  let cpu = execute([0x0f, 0xbc, 0xc1], cpu => { cpu.cx = 0x8008; });
  assert.deepEqual([cpu.ax, !!(cpu.eflags & ZF)], [3, false]);
  cpu = execute([0x66, 0x0f, 0xbd, 0xc1], cpu => { cpu.ecx = 0x80000008; });
  assert.deepEqual([cpu.eax, !!(cpu.eflags & ZF)], [31, false]);
});

test("a zero bit-scan source sets ZF and leaves the destination deterministic", () => {
  const cpu = execute([0x0f, 0xbc, 0xc1], cpu => {
    cpu.ax = 0x1234;
    cpu.cx = 0;
    cpu.eflags = 0x802;
  });
  assert.equal(cpu.ax, 0x1234);
  assert.equal(cpu.eflags & (ZF | 0x800), ZF | 0x800);
});

test("memory bit scans honor address size and segment override without writes", () => {
  const writes = [];
  const bytes = [0x64, 0x67, 0x66, 0x0f, 0xbc, 0x03];
  const memory = new Map(bytes.map((value, index) => [index, value]));
  const cpu = new I80386({
    read: address => memory.get(address) ?? 0,
    fetch: address => memory.get(address) ?? 0,
    write: (address, value) => { writes.push(address); memory.set(address, value); },
  });
  cpu.ebx = 0x10000;
  cpu.segmentCaches[4].base = 0x200;
  cpu.segmentCaches[4].limit = 0x1ffff;
  memory.set(0x10200, 0);
  memory.set(0x10201, 1);
  memory.set(0x10202, 0);
  memory.set(0x10203, 0);
  cpu.step();
  assert.deepEqual([cpu.eax, writes], [8, []]);
});
