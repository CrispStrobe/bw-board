import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

function cpuFor(bytes) {
  const reads = [];
  const cpu = new I80386({
    read(address) { reads.push(address >>> 0); return 0; },
    fetch: (address) => bytes[address] ?? 0,
  });
  return { cpu, reads };
}

test("LEA selects address and operand sizes independently", () => {
  const a = cpuFor([0x8d, 0x46, 0x10]);
  a.cpu.ebp = 0xaaaa0100;
  a.cpu.eax = 0xbbbb0000;
  a.cpu.step();
  assert.equal(a.cpu.eax, 0xbbbb0110);

  const b = cpuFor([0x66, 0x8d, 0x86, 0x34, 0x12]);
  b.cpu.bp = 0x100;
  b.cpu.step();
  assert.equal(b.cpu.eax, 0x1334);

  const c = cpuFor([0x67, 0x8d, 0x44, 0x8d, 0x20]);
  c.cpu.ebp = 0x10000000;
  c.cpu.ecx = 3;
  c.cpu.eax = 0xaaaa0000;
  c.cpu.step();
  assert.equal(c.cpu.eax, 0xaaaa002c);

  const d = cpuFor([0x67, 0x66, 0x8d, 0x44, 0x8d, 0x20]);
  d.cpu.ebp = 0x10000000;
  d.cpu.ecx = 3;
  d.cpu.step();
  assert.equal(d.cpu.eax, 0x1000002c);
});

test("LEA performs no segment or memory access and rejects register encoding", () => {
  const valid = cpuFor([0x8d, 0x06, 0x00, 0x01]);
  valid.cpu.cr0 = 1;
  valid.cpu.segmentCaches[3] = { base:0, limit:0, present:false, null:true, code:false, readable:false, writable:false };
  valid.cpu.step();
  assert.equal(valid.cpu.ax, 0x100);
  assert.deepEqual(valid.reads, []);

  const invalid = cpuFor([0x8d, 0xc0]);
  assert.throws(
    () => invalid.cpu.step(),
    (error) => error?.vector === 6 && error.errorCode === null,
  );
});
