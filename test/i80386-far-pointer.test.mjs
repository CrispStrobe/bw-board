import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

function fixture(bytes) {
  const memory = new Map(bytes.map((value, index) => [index, value]));
  const reads = [];
  const cpu = new I80386({
    read(address) {
      reads.push(address >>> 0);
      return memory.get(address >>> 0) ?? 0;
    },
    fetch: (address) => memory.get(address >>> 0) ?? 0,
    write: (address, value) => memory.set(address >>> 0, value & 0xff),
  });
  const put = (at, values) =>
    values.forEach((value, index) => memory.set(at + index, value));
  return { cpu, memory, reads, put };
}

function descriptor(base, access) {
  return [
    0xff,
    0xff,
    base,
    base >>> 8,
    base >>> 16,
    access,
    0x40,
    base >>> 24,
  ].map((value) => value & 0xff);
}

test("LES/LDS/LSS/LFS/LGS load complete 16/32-bit pointers", () => {
  const f = fixture([
    0xc4, 0x06, 0x00, 0x01,
    0xc5, 0x1e, 0x06, 0x01,
    0x0f, 0xb2, 0x16, 0x0c, 0x01,
    0x66, 0x0f, 0xb4, 0x0e, 0x12, 0x01,
    0x66, 0x0f, 0xb5, 0x36, 0x18, 0x01,
  ]);
  f.put(0x100, [0x34, 0x12, 0x20, 0x00]);
  f.put(0x106, [0x78, 0x56, 0x30, 0x00]);
  f.put(0x40c, [0xbc, 0x9a, 0x40, 0x00]);
  f.put(0x412, [0x78, 0x56, 0x34, 0x12, 0x50, 0x00]);
  f.put(0x418, [0xef, 0xcd, 0xab, 0x89, 0x60, 0x00]);
  f.cpu.step();
  f.cpu.step();
  f.cpu.step();
  f.cpu.step();
  f.cpu.step();
  assert.deepEqual(
    [f.cpu.ax, f.cpu.bx, f.cpu.dx, f.cpu.ecx, f.cpu.esi],
    [0x1234, 0x5678, 0x9abc, 0x12345678, 0x89abcdef],
  );
  assert.deepEqual(
    [f.cpu.es, f.cpu.ds, f.cpu.ss, f.cpu.fs, f.cpu.gs],
    [0x20, 0x30, 0x40, 0x50, 0x60],
  );
});

test("protected far-pointer target failure leaves register and cache unchanged", () => {
  const f = fixture([0xc5, 0x06, 0x00, 0x01]);
  f.put(0x100, [0x78, 0x56, 0x08, 0x00]);
  f.put(0x208, descriptor(0x4000, 0x12));
  f.cpu.cr0 = 1;
  f.cpu.gdtr = { base: 0x200, limit: 0x0f };
  f.cpu.ax = 0xabcd;
  const before = { ...f.cpu.segmentCaches[3] };
  assert.throws(
    () => f.cpu.step(),
    (error) => error?.vector === 11 && error.errorCode === 8,
  );
  assert.equal(f.cpu.ax, 0xabcd);
  assert.equal(f.cpu.ds, 0);
  assert.deepEqual(f.cpu.segmentCaches[3], before);
});

test("far-pointer source obeys execute-only protection before operand reads", () => {
  const f = fixture([0x2e, 0xc4, 0x06, 0x00, 0x01]);
  f.cpu.cr0 = 1;
  f.cpu.segmentCaches[1].readable = false;
  assert.throws(
    () => f.cpu.step(),
    (error) => error?.vector === 13 && error.errorCode === 0,
  );
  assert.equal(f.reads.length, 0);
});

test("far-pointer source admits the complete pointer span before bus reads", () => {
  const f = fixture([0x66, 0xc4, 0x06, 0x00, 0x01]);
  f.cpu.cr0 = 1;
  Object.assign(f.cpu.segmentCaches[3], {
    base: 0x1000,
    limit: 0x104,
    present: true,
    code: false,
    readable: true,
    writable: true,
  });
  f.cpu.eax = 0xdeadbeef;
  assert.throws(
    () => f.cpu.step(),
    (error) => error?.vector === 13 && error.errorCode === 0,
  );
  assert.equal(f.cpu.eax, 0xdeadbeef);
  assert.equal(f.reads.length, 0);
});

test("LSS shadows IRQ/NMI at its boundary and does not suppress later debug", () => {
  const f = fixture([0x0f, 0xb2, 0x16, 0x00, 0x01, 0x90]);
  f.put(0x100, [0x00, 0x02, 0x20, 0x00]);
  f.cpu.eflags |= 0x300;
  f.cpu.step();
  assert.deepEqual([f.cpu.dx, f.cpu.ss], [0x200, 0x20]);
  assert.equal(f.cpu.interrupt(0x20), false);
  assert.equal(f.cpu.interrupt(2, { nmi: true }), false);
  f.cpu.step();
  assert.equal(f.cpu._debugShadow, 0);
});
