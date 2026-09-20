import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

const CF = 1;

function fixture(program) {
  const memory = new Map(program.map((value, index) => [index, value]));
  const writes = [];
  const cpu = new I80386({
    read: address => memory.get(address) ?? 0,
    fetch: address => memory.get(address) ?? 0,
    write: (address, value) => {
      writes.push(address);
      memory.set(address, value & 255);
    },
  });
  return { cpu, memory, writes };
}

function put(memory, address, value, bytes) {
  for (let index = 0; index < bytes; index++)
    memory.set(address + index, (value >>> (index * 8)) & 255);
}

test("BT register forms wrap the index and change only CF", () => {
  const { cpu } = fixture([0x0f, 0xa3, 0xc8]); // BT AX,CX
  cpu.ax = 0x8000;
  cpu.cx = 31;
  cpu.eflags = 0x8d4;
  cpu.step();
  assert.equal(cpu.eflags, 0x8d5);
  assert.equal(cpu.ax, 0x8000);
});

test("register-indexed memory BT uses a signed unmasked bit offset", () => {
  const { cpu, memory, writes } = fixture([0x0f, 0xa3, 0x0e, 0x00, 0x02]);
  cpu.cx = 0xffff; // bit -1 is bit 15 of the preceding word
  put(memory, 0x1fe, 0x8000, 2);
  cpu.step();
  assert.ok(cpu.eflags & CF);
  assert.deepEqual(writes, []);
});

test("immediate BTS/BTR/BTC address later words without masking the index", () => {
  for (const [extension, initial, expected] of [
    [5, 0, 2],
    [6, 3, 1],
    [7, 0, 2],
  ]) {
    const { cpu, memory } = fixture([0x0f, 0xba, 0x00 | extension << 3, 17]);
    cpu.bx = 0x200;
    put(memory, 0x202, initial, 2);
    cpu.step();
    assert.equal((memory.get(0x202) ?? 0) | ((memory.get(0x203) ?? 0) << 8), expected);
    assert.equal(!!(cpu.eflags & CF), !!(initial & 2));
  }
});

test("modifying bit tests preflight write permission before reading memory", () => {
  const reads = [];
  const program = [0x0f, 0xab, 0x06, 0x00, 0x02];
  const cpu = new I80386({
    read: address => { reads.push(address); return 0; },
    fetch: address => program[address] ?? 0,
    write: () => {},
  });
  cpu.cr0 = 1;
  cpu.segmentCaches[3] = {
    base: 0,
    limit: 0xffff,
    present: true,
    code: false,
    readable: true,
    writable: false,
    default32: false,
  };
  assert.throws(
    () => cpu.step(),
    error => error?.vector === 13 && error.errorCode === 0,
  );
  assert.deepEqual(reads, []);
});
