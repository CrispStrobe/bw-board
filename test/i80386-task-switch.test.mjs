import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

function put(memory, address, bytes) {
  bytes.forEach((value, index) => memory.set(address + index, value & 255));
}

function descriptor(base, limit, access, flags = 0x40) {
  return [
    limit, limit >>> 8, base, base >>> 8, base >>> 16, access,
    ((limit >>> 16) & 15) | flags, base >>> 24,
  ];
}

function dword(memory, address, value) {
  put(memory, address, [value, value >>> 8, value >>> 16, value >>> 24]);
}

function word(memory, address, value) {
  put(memory, address, [value, value >>> 8]);
}

test("386 TSS CALL and nested IRET preserve backlink, busy state, and registers", () => {
  const memory = new Map();
  put(memory, 0, [0x9a, 0, 0, 0x20, 0, 0xf4]);
  put(memory, 0x100, [0xcf]);
  put(memory, 0x208, descriptor(0, 0xfffff, 0x9b));
  put(memory, 0x210, descriptor(0, 0xfffff, 0x93));
  put(memory, 0x218, descriptor(0x400, 0x67, 0x8b, 0));
  put(memory, 0x220, descriptor(0x500, 0x67, 0x89, 0));
  dword(memory, 0x500 + 0x20, 0x100);
  dword(memory, 0x500 + 0x24, 2);
  dword(memory, 0x500 + 0x28, 0x12345678);
  dword(memory, 0x500 + 0x38, 0x900);
  for (const [offset, selector] of [[0x48,0x10],[0x4c,8],[0x50,0x10],
    [0x54,0x10],[0x58,0],[0x5c,0],[0x60,0]]) word(memory, 0x500 + offset, selector);
  const cpu = new I80386({
    read: address => memory.get(address) ?? 0,
    fetch: address => memory.get(address) ?? 0,
    write: (address, value) => memory.set(address, value & 255),
  });
  cpu.cr0 = 1;
  cpu.gdtr = { base: 0x200, limit: 0x27 };
  cpu.cs = 8;
  cpu.ss = cpu.ds = cpu.es = 0x10;
  cpu.segmentCaches[1] = { base: 0, limit: 0xfffff, default32: false,
    present: true, code: true, readable: true, writable: false };
  for (const id of [0, 2, 3]) cpu.segmentCaches[id] = { base: 0, limit: 0xfffff,
    default32: true, present: true, code: false, readable: true, writable: true };
  cpu.tr = { selector: 0x18, base: 0x400, limit: 0x67, present: true, type: 11 };
  cpu.eax = 0xabcdef01;
  cpu.esp = 0x800;

  cpu.step();
  assert.deepEqual([cpu.tr.selector, cpu.eip, cpu.eax, cpu.eflags & 0x4000],
    [0x20, 0x100, 0x12345678, 0x4000]);
  assert.equal((memory.get(0x205 + 0x20) ?? 0) & 15, 11);
  assert.equal((memory.get(0x205 + 0x18) ?? 0) & 15, 11);
  assert.equal((memory.get(0x500) ?? 0) | ((memory.get(0x501) ?? 0) << 8), 0x18);

  cpu.step();
  assert.deepEqual([cpu.tr.selector, cpu.eip, cpu.eax, cpu.esp],
    [0x18, 5, 0xabcdef01, 0x800]);
  assert.equal(cpu.eflags & 0x4000, 0);
  assert.equal((memory.get(0x205 + 0x20) ?? 0) & 15, 9);
  cpu.step();
  assert.equal(cpu.halted, true);
});
