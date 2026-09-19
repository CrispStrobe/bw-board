import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

function fixture(bytes) {
  const memory = new Map(bytes.map((value, index) => [index, value]));
  return {
    memory,
    cpu: new I80386({
      read: (address) => memory.get(address) ?? 0,
      fetch: (address) => memory.get(address) ?? 0,
      write: (address, value) => memory.set(address, value & 0xff),
    }),
  };
}

test("group 3 TEST, NOT, and NEG honor byte and wide aliases", () => {
  const { cpu } = fixture([
    0xf6, 0xc0, 0x80,
    0xf6, 0xd0,
    0x66, 0xf7, 0xd8,
  ]);
  cpu.eax = 0x12340080;
  cpu.step();
  assert.equal(cpu.eflags & 0xc0, 0x80);
  cpu.step();
  assert.equal(cpu.eax, 0x1234007f);
  cpu.step();
  assert.equal(cpu.eax, 0xedcbff81);
  assert.equal(cpu.eflags & 1, 1);
});

test("reserved group 3 extension raises architectural invalid-opcode", () => {
  const cpu = fixture([0xf6, 0xc8]).cpu;
  assert.throws(
    () => cpu.step(),
    (error) => error?.vector === 6 && error.errorCode === null,
  );
  assert.equal(cpu.eip, 0);
});

test("MUL and IMUL use exact double-width products and only define CF/OF", () => {
  const byte = fixture([0xf6, 0xe3]).cpu;
  byte.al = 0xff;
  byte.bl = 2;
  byte.eflags = 0x46;
  byte.step();
  assert.equal(byte.ax, 0x01fe);
  assert.equal(byte.eflags & 0x8c7, 0x847);

  const wide = fixture([0x66, 0xf7, 0xeb]).cpu;
  wide.eax = 0x80000000;
  wide.ebx = 0xffffffff;
  wide.eflags = 0x46;
  wide.step();
  assert.deepEqual([wide.edx, wide.eax], [0, 0x80000000]);
  assert.equal(wide.eflags & 0x8c7, 0x847);
});

test("DIV and IDIV commit quotient/remainder only after range admission", () => {
  const byte = fixture([0xf6, 0xf3]).cpu;
  byte.ax = 0x0101;
  byte.bl = 2;
  byte.step();
  assert.deepEqual([byte.al, byte.ah], [0x80, 1]);

  for (const [bytes, setup] of [
    [[0x66, 0xf7, 0xf3], (cpu) => {
      cpu.edx = 1;
      cpu.eax = 0;
      cpu.ebx = 1;
    }],
    [[0x66, 0xf7, 0xfb], (cpu) => {
      cpu.edx = 0xffffffff;
      cpu.eax = 0x80000000;
      cpu.ebx = 0xffffffff;
    }],
    [[0xf7, 0xf3], (cpu) => {
      cpu.dx = 0x1234;
      cpu.ax = 0x5678;
      cpu.bx = 0;
    }],
  ]) {
    const cpu = fixture(bytes).cpu;
    setup(cpu);
    const before = [cpu.eax, cpu.edx, cpu.ebx];
    assert.throws(
      () => cpu.step(),
      (error) => error?.vector === 0 && error.errorCode === null,
    );
    assert.deepEqual([cpu.eax, cpu.edx, cpu.ebx], before);
    assert.equal(cpu.eip, 0);
  }
});

test("divide error enters the real IVT handler with the restart frame", () => {
  const memory = new Map();
  const put = (at, bytes) =>
    bytes.forEach((value, index) => memory.set(at + index, value));
  put(0, [0x00, 0x02, 0x00, 0x00]);
  put(0x1000, [0xf6, 0xf3]);
  put(0x200, [0xf4]);
  const cpu = new I80386(
    {
      read: (address) => memory.get(address) ?? 0,
      fetch: (address) => memory.get(address) ?? 0,
      write: (address, value) => memory.set(address, value & 0xff),
    },
    { deliverFaults: true },
  );
  cpu.cs = 0x100;
  cpu.segmentCaches[1].base = 0x1000;
  cpu.sp = 0x100;
  cpu.bl = 0;
  cpu.step();
  assert.deepEqual([cpu.cs, cpu.eip, cpu.sp], [0, 0x200, 0xfa]);
  const word = (at) => (memory.get(at) ?? 0) | ((memory.get(at + 1) ?? 0) << 8);
  assert.deepEqual([word(0xfa), word(0xfc), word(0xfe)], [0, 0x100, 2]);
  cpu.step();
  assert.equal(cpu.halted, true);
});

test("group 3 write intent rejects protected code before operand reads", () => {
  let dataReads = 0;
  const bytes = [0x2e, 0xf7, 0x1e, 0x00, 0x01];
  const cpu = new I80386({
    fetch: (address) => bytes[address] ?? 0,
    read: () => {
      dataReads++;
      return 0;
    },
  });
  cpu.cr0 = 1;
  cpu.segmentCaches[1].writable = false;
  assert.throws(() => cpu.step(), (error) => error?.vector === 13);
  assert.equal(dataReads, 0);
});

test("group 3 read-modify-write reports paging write intent before reading", () => {
  const memory = new Map();
  const put = (address, bytes) =>
    bytes.forEach((value, index) => memory.set(address + index, value & 0xff));
  const putDword = (address, value) =>
    put(address, [value, value >>> 8, value >>> 16, value >>> 24]);
  const reads = [];
  const cpu = new I80386({
    read(address) {
      reads.push(address >>> 0);
      return memory.get(address >>> 0) ?? 0;
    },
    fetch(address) {
      return memory.get(address >>> 0) ?? 0;
    },
    write(address, value) {
      memory.set(address >>> 0, value & 0xff);
    },
  });
  putDword(0x1000, 0x2007);
  putDword(0x2000, 0x3007);
  put(0x3000, [0xf7, 0x13]);
  cpu.segmentCaches[1] = {
    base: 0,
    limit: 0xffffffff,
    default32: true,
    present: true,
    code: true,
    readable: true,
    writable: false,
  };
  cpu.segmentCaches[3] = {
    base: 0,
    limit: 0xffffffff,
    default32: true,
    present: true,
    code: false,
    readable: true,
    writable: true,
  };
  cpu.cr0 = 0x80000001;
  cpu.cr3 = 0x1000;
  cpu.cs = 3;
  cpu.ebx = 0x4000;
  assert.throws(
    () => cpu.step(),
    (error) => error?.vector === 14 && error.errorCode === 6,
  );
  assert.equal(cpu.cr2, 0x4000);
  assert.equal(reads.includes(0x4000), false);
});
