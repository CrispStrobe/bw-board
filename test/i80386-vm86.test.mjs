import test from "node:test";
import assert from "node:assert/strict";
import I80386, { I80386Fault } from "../src/experimental/i80386.js";

function fixture(target = 0x10) {
  const memory = new Map([[0, 0xcf]]);
  const cpu = new I80386({
    read: (address) => memory.get(address >>> 0) ?? 0,
    fetch: (address) => memory.get(address >>> 0) ?? 0,
    write: (address, value) => memory.set(address >>> 0, value & 0xff),
  });
  cpu.cr0 = 1;
  cpu.cs = 8;
  cpu.ss = 0x10;
  cpu.eip = 0;
  cpu.esp = 0x100;
  cpu.segmentCaches[1] = {
    base: 0,
    limit: 0xffff,
    default32: true,
    present: true,
    code: true,
    readable: true,
    writable: false,
  };
  cpu.segmentCaches[2] = {
    base: 0x1000,
    limit: 0xffff,
    default32: true,
    present: true,
    code: false,
    readable: true,
    writable: true,
  };
  const frame = [target, 0x1234, 0x23202, 0x200, 0x2000, 0x3000, 0x4000, 0x5000, 0x6000];
  frame.forEach((value, index) => {
    for (let byte = 0; byte < 4; byte++)
      memory.set(0x1100 + index * 4 + byte, (value >>> (byte * 8)) & 0xff);
  });
  return { cpu, memory };
}

function put(memory, address, bytes) {
  bytes.forEach((value, index) => memory.set(address + index, value & 0xff));
}

function descriptor(base, access) {
  return [0xff,0xff,base,base>>>8,base>>>16,access,0xcf,base>>>24];
}

test("IRETD enters VM86 with real-address caches and executes 16-bit code", () => {
  const { cpu, memory } = fixture();
  memory.set(0x12350, 0xb8);
  memory.set(0x12351, 0x78);
  memory.set(0x12352, 0x56);
  cpu.step();
  assert.equal(cpu.virtual8086, true);
  assert.deepEqual(
    [cpu.cs, cpu.eip, cpu.ss, cpu.esp, cpu.es, cpu.ds, cpu.fs, cpu.gs],
    [0x1234, 0x10, 0x2000, 0x200, 0x3000, 0x4000, 0x5000, 0x6000],
  );
  assert.deepEqual(
    [1, 2, 0, 3, 4, 5].map((id) => cpu.segmentCaches[id].base),
    [0x12340, 0x20000, 0x30000, 0x40000, 0x50000, 0x60000],
  );
  cpu.step();
  assert.equal(cpu.ax, 0x5678);
  assert.equal(cpu.eip, 0x13);
});

test("VM86 IRET validates the complete frame and 16-bit target before commit", () => {
  const short = fixture();
  short.cpu.segmentCaches[2].limit = 0x11f;
  const beforeShort = short.cpu._snapshotInstruction();
  assert.throws(() => short.cpu.step(), (error) => error instanceof I80386Fault && error.vector === 12);
  assert.deepEqual(short.cpu._snapshotInstruction(), beforeShort);

  const badTarget = fixture(0x10000);
  const beforeTarget = badTarget.cpu._snapshotInstruction();
  assert.throws(() => badTarget.cpu.step(), (error) => error instanceof I80386Fault && error.vector === 13 && error.errorCode === 0);
  assert.deepEqual(badTarget.cpu._snapshotInstruction(), beforeTarget);
});

test("VM86 privilege checks use CPL3 rather than visible CS RPL", () => {
  const { cpu, memory } = fixture();
  memory.set(0x12350, 0xfa);
  cpu.step();
  cpu.eflags &= ~0x3000;
  assert.throws(() => cpu.step(), (error) => error instanceof I80386Fault && error.vector === 13 && error.errorCode === 0);
  assert.equal(cpu.eip, 0x10);
});

test("a VM86 software interrupt builds the extended inner frame and IRETD returns", () => {
  const { cpu, memory } = fixture();
  cpu.gdtr = { base: 0x200, limit: 0x2ff };
  cpu.idtr = { base: 0x300, limit: 0x7ff };
  cpu.tr = { selector: 0x28, base: 0x600, limit: 0x67, present: true, type: 11 };
  put(memory, 0x208, descriptor(0x100000, 0x9a));
  put(memory, 0x210, descriptor(0x120000, 0x92));
  put(memory, 0x604, [0,4,0,0,0x10,0]);
  put(memory, 0x300 + 0x20 * 8, [0,1,8,0,0,0xee,0,0]);
  put(memory, 0x12350, [0xcd,0x20]);
  put(memory, 0x100100, [0xcf]);
  cpu.step();
  cpu.step();
  assert.deepEqual([cpu.virtual8086,cpu.cs,cpu.eip,cpu.ss,cpu.esp],[false,8,0x100,0x10,0x3dc]);
  const dword = (address) =>
    [0,1,2,3].reduce((value, byte) => value + (memory.get(address + byte) ?? 0) * 2 ** (byte * 8), 0) >>> 0;
  assert.deepEqual(
    Array.from({ length: 9 }, (_, index) => dword(0x1203dc + index * 4)),
    [0x12,0x1234,0x23202,0x200,0x2000,0x3000,0x4000,0x5000,0x6000],
  );
  cpu.step();
  assert.deepEqual(
    [cpu.virtual8086,cpu.cs,cpu.eip,cpu.ss,cpu.esp,cpu.es,cpu.ds,cpu.fs,cpu.gs],
    [true,0x1234,0x12,0x2000,0x200,0x3000,0x4000,0x5000,0x6000],
  );
});
