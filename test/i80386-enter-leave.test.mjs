import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

function fixture(program) {
  const memory = new Map(program.map((value, index) => [index, value]));
  const cpu = new I80386({
    read: address => memory.get(address) ?? 0,
    fetch: address => memory.get(address) ?? 0,
    write: (address, value) => memory.set(address, value & 255),
  });
  return { cpu, memory };
}

function put(memory, address, value, bytes) {
  for (let index = 0; index < bytes; index++)
    memory.set(address + index, (value >>> (index * 8)) & 255);
}

function get(memory, address, bytes) {
  let value = 0;
  for (let index = 0; index < bytes; index++)
    value += (memory.get(address + index) ?? 0) * 2 ** (index * 8);
  return value >>> 0;
}

test("ENTER and LEAVE use independent operand and stack address sizes", () => {
  const { cpu, memory } = fixture([
    0x66, 0xc8, 8, 0, 0,
    0x66, 0xc9,
  ]);
  cpu.segmentCaches[2].default32 = false;
  cpu.esp = 0x12340200;
  cpu.ebp = 0x89abcdef;
  cpu.step();
  assert.deepEqual([cpu.ebp, cpu.esp], [0x1fc, 0x123401f4]);
  assert.equal(get(memory, 0x1fc, 4), 0x89abcdef);
  cpu.step();
  assert.deepEqual([cpu.ebp, cpu.esp], [0x89abcdef, 0x12340200]);
});

test("nested ENTER copies ancestor frames and the new frame pointer", () => {
  const { cpu, memory } = fixture([0xc8, 4, 0, 3]);
  cpu.sp = 0x200;
  cpu.bp = 0x180;
  put(memory, 0x17e, 0x1111, 2);
  put(memory, 0x17c, 0x2222, 2);
  cpu.step();
  assert.deepEqual([cpu.bp, cpu.sp], [0x1fe, 0x1f4]);
  assert.deepEqual(
    [0x1fc, 0x1fa, 0x1f8].map(address => get(memory, address, 2)),
    [0x1111, 0x2222, 0x1fe],
  );
});

test("LEAVE faults before changing the stack or frame pointer", () => {
  const { cpu } = fixture([0xc9]);
  cpu.cr0 = 1;
  cpu.segmentCaches[2] = {
    base: 0,
    limit: 0xff,
    present: true,
    code: false,
    readable: true,
    writable: true,
    default32: false,
  };
  cpu.sp = 0x80;
  cpu.bp = 0x100;
  assert.throws(() => cpu.step(), error => error?.vector === 12);
  assert.deepEqual([cpu.sp, cpu.bp], [0x80, 0x100]);
});

test("VM86 ENTER applies user-page write protection without stack mutation", () => {
  const { cpu, memory } = fixture([0xc8, 0, 0, 0]);
  put(memory, 0x1000, 0x2007, 4); // user, writable page table
  put(memory, 0x2000, 0x0005, 4); // user, read-only code and stack page
  cpu.cr0 = 0x80000001;
  cpu.cr3 = 0x1000;
  cpu.eflags |= 0x20000;
  cpu.sp = 0x200;
  cpu.bp = 0x180;
  const stackBefore = [0x1fe, 0x1ff].map(address => memory.get(address) ?? 0);
  assert.throws(
    () => cpu.step(),
    error => error?.vector === 14 && error.errorCode === 7,
  );
  assert.deepEqual([cpu.eip, cpu.sp, cpu.bp], [0, 0x200, 0x180]);
  assert.deepEqual(
    [0x1fe, 0x1ff].map(address => memory.get(address) ?? 0),
    stackBefore,
  );
});
