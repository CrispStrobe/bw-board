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
