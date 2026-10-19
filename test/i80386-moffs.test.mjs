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
  return { cpu, memory, reads };
}

test("MOV moffs covers byte/word/dword operands and 16/32-bit addresses", () => {
  const f = fixture([
    0xa0, 0x00, 0x02,
    0xa2, 0x01, 0x02,
    0xa1, 0x02, 0x02,
    0x66, 0xa3, 0x04, 0x02,
    0x67, 0x66, 0xa1, 0x08, 0x02, 0x00, 0x00,
  ]);
  [0x5a, 0, 0x34, 0x12, 0, 0, 0, 0, 0xef, 0xcd, 0xab, 0x89].forEach(
    (value, index) => f.memory.set(0x200 + index, value),
  );
  f.cpu.step();
  assert.equal(f.cpu.al, 0x5a);
  f.cpu.step();
  assert.equal(f.memory.get(0x201), 0x5a);
  f.cpu.step();
  assert.equal(f.cpu.ax, 0x1234);
  f.cpu.eax = 0x76543210;
  f.cpu.step();
  assert.deepEqual(
    [0x204, 0x205, 0x206, 0x207].map((address) => f.memory.get(address)),
    [0x10, 0x32, 0x54, 0x76],
  );
  f.cpu.step();
  assert.equal(f.cpu.eax, 0x89abcdef);
});

test("MOV moffs honors segment override and stores without reading destination", () => {
  const f = fixture([0x26, 0xa3, 0x00, 0x01]);
  f.cpu.es = 0x100;
  f.cpu.segmentCaches[0].base = 0x1000;
  f.cpu.ax = 0xbeef;
  f.cpu.step();
  assert.deepEqual([f.memory.get(0x1100), f.memory.get(0x1101)], [0xef, 0xbe]);
  assert.deepEqual(f.reads, []);
});

test("MOV moffs store faults before writes and load leaves accumulator atomic", () => {
  for (const bytes of [[0xa3, 0xff, 0xff], [0xa1, 0xff, 0xff]]) {
    const f = fixture(bytes);
    f.cpu.cr0 = 1;
    f.cpu.segmentCaches[3].limit = 0xffff;
    f.cpu.eax = 0x12345678;
    assert.throws(() => f.cpu.step(), (error) => error?.vector === 13);
    assert.equal(f.cpu.eax, 0x12345678);
  }
});
