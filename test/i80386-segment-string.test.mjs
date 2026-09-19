import test from "node:test";
import assert from "node:assert/strict";
import I80386, { I80386Fault } from "../src/experimental/i80386.js";

function fixture(bytes) {
  const memory = new Map(bytes.map((value, index) => [index, value]));
  const writes = [];
  const cpu = new I80386({
    read: (address) => memory.get(address) ?? 0,
    fetch: (address) => memory.get(address) ?? 0,
    write(address, value) {
      writes.push([address, value & 0xff]);
      memory.set(address, value & 0xff);
    },
  });
  return { cpu, memory, writes };
}

function descriptor(base, access, flags = 0x40) {
  return [
    0xff,
    0xff,
    base,
    base >>> 8,
    base >>> 16,
    access,
    flags,
    base >>> 24,
  ].map((value) => value & 0xff);
}

test("MOV from segment register zero-extends 32-bit registers but writes 16-bit memory", () => {
  const { cpu, writes } = fixture([
    0x66, 0x8c, 0xd8,
    0x8c, 0x26, 0x00, 0x01,
    0x8c, 0xe1,
    0x8c, 0xe9,
  ]);
  cpu.eax = 0xaaaa5555;
  cpu.ds = 0x1234;
  cpu.fs = 0x5678;
  cpu.gs = 0x9abc;
  cpu.step();
  assert.equal(cpu.eax, 0x1234);
  cpu.step();
  assert.deepEqual(writes.slice(-2), [[0x100, 0x78], [0x101, 0x56]]);
  cpu.step();
  assert.equal(cpu.cx, 0x5678);
  cpu.step();
  assert.equal(cpu.cx, 0x9abc);
});

test("XCHG swaps byte, word, dword, accumulator, and memory operands", () => {
  const { cpu, memory } = fixture([
    0x86, 0xd8,
    0x87, 0xd1,
    0x66, 0x87, 0xfe,
    0x93,
    0x87, 0x1e, 0x00, 0x01,
  ]);
  cpu.eax = 0x111122aa;
  cpu.ebx = 0x333344bb;
  cpu.ecx = 0x55556666;
  cpu.edx = 0x77778888;
  cpu.esi = 0x9999aaaa;
  cpu.edi = 0xbbbbcccc;
  cpu.eflags = 0x8d7;
  memory.set(0x100, 0x34);
  memory.set(0x101, 0x12);
  cpu.step();
  assert.deepEqual([cpu.al, cpu.bl], [0xbb, 0xaa]);
  cpu.step();
  assert.deepEqual([cpu.cx, cpu.dx], [0x8888, 0x6666]);
  cpu.step();
  assert.deepEqual([cpu.esi, cpu.edi], [0xbbbbcccc, 0x9999aaaa]);
  cpu.step();
  assert.deepEqual([cpu.ax, cpu.bx], [0x44aa, 0x22bb]);
  cpu.step();
  assert.equal(cpu.bx, 0x1234);
  assert.deepEqual([memory.get(0x100), memory.get(0x101)], [0xbb, 0x22]);
  assert.equal(cpu.eflags, 0x8d7);
});

test("CLC, STC, and CMC change only carry", () => {
  const { cpu } = fixture([0xf8, 0xf9, 0xf5]);
  cpu.eflags = 0x8d7;
  cpu.step();
  assert.equal(cpu.eflags, 0x8d6);
  cpu.step();
  assert.equal(cpu.eflags, 0x8d7);
  cpu.step();
  assert.equal(cpu.eflags, 0x8d6);
});

test("LDT selectors 4..7 are not mistaken for null data selectors", () => {
  const { cpu } = fixture([0x8e, 0xd8]);
  cpu.cr0 = 1;
  cpu.ax = 4;
  assert.throws(
    () => cpu.step(),
    (error) =>
      error instanceof I80386Fault &&
      error.vector === 13 &&
      error.errorCode === 4,
  );
  assert.equal(cpu.ds, 0);
});

test("readable conforming code loads as data without RPL/DPL admission", () => {
  const { cpu, memory } = fixture([0x8e, 0xd8]);
  cpu.cr0 = 1;
  cpu.cs = 3;
  cpu.gdtr = { base: 0x200, limit: 0x17 };
  descriptor(0x4000, 0x9e).forEach((value, index) =>
    memory.set(0x208 + index, value),
  );
  cpu.ax = 0x0b;
  cpu.step();
  assert.equal(cpu.ds, 0x0b);
  assert.equal(cpu.segmentCaches[3].base, 0x4000);
});

test("MOV to segment rejects invalid encodings and null SS architecturally", () => {
  for (const bytes of [[0x8e, 0xc8], [0x8e, 0xf0]]) {
    const { cpu } = fixture(bytes);
    assert.throws(() => cpu.step(), (error) => error?.vector === 6);
    assert.equal(cpu.eip, 0);
  }
  const { cpu } = fixture([0x8e, 0xd0]);
  cpu.cr0 = 1;
  cpu.ax = 0;
  assert.throws(
    () => cpu.step(),
    (error) => error?.vector === 13 && error.errorCode === 0,
  );
});

test("protected data loads validate presence and null selectors before commit", () => {
  const { cpu, memory } = fixture([0x8e, 0xd8]);
  cpu.cr0 = 1;
  cpu.gdtr = { base: 0x200, limit: 0x17 };
  descriptor(0x4000, 0x12).forEach((value, index) =>
    memory.set(0x208 + index, value),
  );
  cpu.ax = 8;
  assert.throws(
    () => cpu.step(),
    (error) => error?.vector === 11 && error.errorCode === 8,
  );
  assert.equal(cpu.ds, 0);

  cpu.eip = 0;
  cpu.ax = 0;
  cpu.step();
  assert.equal(cpu.ds, 0);
  assert.throws(
    () => cpu._read(3, 0, 8),
    (error) => error?.vector === 13 && error.errorCode === 0,
  );
});

test("single string operations honor sizes, overrides, and DF index direction", () => {
  const { cpu, memory } = fixture([
    0x67, 0xa4,
    0x66, 0xab,
    0xfd,
    0xac,
    0xae,
  ]);
  cpu.esi = 0x10000;
  cpu.edi = 0x10010;
  cpu.segmentCaches[0].limit = 0x1ffff;
  cpu.segmentCaches[3].limit = 0x1ffff;
  cpu.eax = 0x44332211;
  memory.set(0x10000, 0x5a);
  cpu.step();
  assert.equal(memory.get(0x10010), 0x5a);
  assert.deepEqual([cpu.esi, cpu.edi], [0x10001, 0x10011]);
  cpu.step();
  assert.deepEqual(
    [0, 1, 2, 3].map((index) => memory.get(0x0011 + index)),
    [0x11, 0x22, 0x33, 0x44],
  );
  cpu.step();
  cpu.si = 0x200;
  cpu.di = 0x300;
  memory.set(0x200, 0x80);
  memory.set(0x300, 0x80);
  cpu.step();
  assert.deepEqual([cpu.al, cpu.si], [0x80, 0x1ff]);
  cpu.step();
  assert.equal(cpu.di, 0x2ff);
  assert.equal(cpu.eflags & 0x40, 0x40);
});

test("REP exposes every completed iteration as an interruptible boundary", () => {
  const { cpu, memory } = fixture([0xf3, 0xaa, 0xf4]);
  cpu.cx = 3;
  cpu.di = 0x100;
  cpu.al = 0x5a;
  cpu.step();
  assert.deepEqual([cpu.eip, cpu.cx, cpu.di], [0, 2, 0x101]);
  assert.equal(memory.get(0x100), 0x5a);
  cpu.step();
  assert.deepEqual([cpu.eip, cpu.cx, cpu.di], [0, 1, 0x102]);
  cpu.step();
  assert.deepEqual([cpu.eip, cpu.cx, cpu.di], [2, 0, 0x103]);
  cpu.step();
  assert.equal(cpu.halted, true);
});

test("an external interrupt resumes REP with completed progress preserved", () => {
  const memory = new Map();
  const put = (at, bytes) =>
    bytes.forEach((value, index) => memory.set(at + index, value));
  put(0x1000, [0xf3, 0xaa]);
  put(0x80, [0x00, 0x02, 0x00, 0x00]);
  put(0x200, [0xcf]);
  const cpu = new I80386({
    read: (address) => memory.get(address) ?? 0,
    fetch: (address) => memory.get(address) ?? 0,
    write: (address, value) => memory.set(address, value & 0xff),
  });
  cpu.cs = 0x100;
  cpu.segmentCaches[1].base = 0x1000;
  cpu.sp = 0x100;
  cpu.cx = 2;
  cpu.di = 0x300;
  cpu.al = 0x44;
  cpu.eflags |= 0x200;
  cpu.step();
  assert.deepEqual([cpu.eip, cpu.cx, cpu.di], [0, 1, 0x301]);
  assert.equal(cpu.interrupt(0x20), true);
  assert.deepEqual([cpu.cs, cpu.eip, cpu.cx, cpu.di], [0, 0x200, 1, 0x301]);
  cpu.step();
  assert.deepEqual([cpu.cs, cpu.eip, cpu.cx, cpu.di], [0x100, 0, 1, 0x301]);
  cpu.step();
  assert.deepEqual([cpu.eip, cpu.cx, cpu.di], [2, 0, 0x302]);
});

test("STI and MOV SS shadows expire after the first REP iteration", () => {
  const sti = fixture([0xfb, 0xf3, 0xaa]).cpu;
  sti.cx = 2;
  sti.di = 0x100;
  sti.step();
  sti.step();
  assert.equal(sti.eip, 1);
  assert.equal(sti.interrupt(0x20), true);

  const ss = fixture([0x8e, 0xd0, 0xf3, 0xaa]).cpu;
  ss.ax = 0x10;
  ss.cx = 2;
  ss.di = 0x100;
  ss.eflags |= 0x200;
  ss.step();
  assert.equal(ss.interrupt(0x20), false);
  ss.step();
  assert.equal(ss.eip, 2);
  assert.equal(ss.interrupt(0x20), true);
});

test("TF traps after each completed REP iteration with restart EIP", () => {
  const memory = new Map();
  const put = (at, bytes) =>
    bytes.forEach((value, index) => memory.set(at + index, value));
  put(0x1000, [0xf3, 0xaa]);
  put(4, [0x00, 0x02, 0x00, 0x00]);
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
  cpu.cx = 2;
  cpu.di = 0x300;
  cpu.al = 0x55;
  cpu.eflags |= 0x100;
  cpu.step();
  assert.deepEqual([cpu.cs, cpu.eip, cpu.cx, cpu.di], [0, 0x200, 1, 0x301]);
  const word = (at) => (memory.get(at) ?? 0) | ((memory.get(at + 1) ?? 0) << 8);
  assert.equal(word(0xfa), 0);
});

test("REP fault restarts only the uncompleted iteration", () => {
  const { cpu, memory } = fixture([0x67, 0xf3, 0xaa]);
  cpu.ecx = 2;
  cpu.edi = 0;
  cpu.al = 0x33;
  cpu.segmentCaches[0].base = 0x100;
  cpu.segmentCaches[0].limit = 0;
  cpu.step();
  assert.deepEqual([cpu.eip, cpu.ecx, cpu.edi], [0, 1, 1]);
  assert.equal(memory.get(0x100), 0x33);
  assert.throws(() => cpu.step(), (error) => error?.vector === 13);
  assert.deepEqual([cpu.eip, cpu.ecx, cpu.edi], [0, 1, 1]);
});

test("faulting REPE restores flags from before the repeat span", () => {
  const { cpu, memory } = fixture([0xf3, 0xa6]);
  cpu.cx = 2;
  cpu.segmentCaches[3].base = 0x100;
  cpu.segmentCaches[0].base = 0x200;
  cpu.segmentCaches[0].limit = 0;
  memory.set(0x100, 0x5a);
  memory.set(0x200, 0x5a);
  cpu.eflags = 0x803;
  cpu.step();
  assert.equal(cpu.eflags & 0x8c5, 0x44);
  assert.throws(() => cpu.step(), (error) => error?.vector === 13);
  assert.equal(cpu.eflags, 0x803);
  assert.deepEqual([cpu.eip, cpu.cx, cpu.si, cpu.di], [0, 1, 1, 1]);
  assert.equal(cpu._repeatContext, null);
});

test("REPE/REPNE stop after the iteration that breaks their condition", () => {
  for (const [prefix, values] of [
    [0xf3, [7, 8]],
    [0xf2, [8, 7]],
  ]) {
    const { cpu, memory } = fixture([prefix, 0xa6]);
    cpu.cx = 3;
    cpu.si = 1;
    cpu.di = 3;
    cpu.segmentCaches[3].base = 0x100;
    cpu.segmentCaches[0].base = 0x200;
    memory.set(0x101, values[0]);
    memory.set(0x203, 7);
    memory.set(0x102, values[1]);
    memory.set(0x204, 7);
    cpu.step();
    assert.equal(cpu.eip, 0);
    cpu.step();
    assert.deepEqual([cpu.eip, cpu.cx, cpu.si], [2, 1, 3]);
  }
});

test("zero-count REP avoids memory and invalid REP encoding raises #UD", () => {
  let reads = 0;
  const zero = new I80386({
    fetch: (address) => [0xf3, 0xa4][address] ?? 0,
    read: () => {
      reads++;
      return 0;
    },
  });
  zero.cx = 0;
  zero.step();
  assert.deepEqual([zero.eip, zero.si, zero.di, reads], [2, 0, 0, 0]);
  const invalid = fixture([0xf3, 0x90]).cpu;
  assert.throws(() => invalid.step(), (error) => error?.vector === 6);
  assert.equal(invalid.eip, 0);
  const io = [];
  const zeroIo = new I80386({
    fetch: address => [0xf3, 0x6c][address] ?? 0,
    inPort: (...args) => { io.push(args); return 0; },
  });
  zeroIo.cx = 0;
  zeroIo.step();
  assert.deepEqual([zeroIo.eip, zeroIo.di, io], [2, 0, []]);
});

test("INS/OUTS honor operand/address sizes, direction, and segment override", () => {
  const memory = new Map();
  const input = [];
  const output = [];
  const bytes = [
    0x6c,             // INSB
    0x66, 0x67, 0x6d, // INSD with EDI
    0x64, 0x6f,       // OUTSW FS:[SI]
  ];
  bytes.forEach((value, index) => memory.set(index, value));
  const cpu = new I80386({
    fetch: address => memory.get(address) ?? 0,
    read: address => memory.get(address) ?? 0,
    write: (address, value) => memory.set(address, value & 0xff),
    inPort: (port, width) => {
      input.push([port, width]);
      return width === 8 ? 0x5a : 0x12345678;
    },
    outPort: (...args) => output.push(args),
  });
  cpu.dx = 0x1f0;
  cpu.di = 0x100;
  cpu.step();
  assert.deepEqual([memory.get(0x100), cpu.di], [0x5a, 0x101]);
  cpu.edi = 0x200;
  cpu.eflags |= 0x400;
  cpu.step();
  assert.deepEqual(
    [[0, 1, 2, 3].map(index => memory.get(0x200 + index)), cpu.edi],
    [[[0x78, 0x56, 0x34, 0x12][0], 0x56, 0x34, 0x12], 0x1fc],
  );
  cpu.segmentCaches[4].base = 0x300;
  cpu.si = 0x10;
  memory.set(0x310, 0xcd);
  memory.set(0x311, 0xab);
  cpu.step();
  assert.deepEqual(input, [[0x1f0, 8], [0x1f0, 32]]);
  assert.deepEqual(output, [[0x1f0, 0xabcd, 16]]);
  assert.equal(cpu.si, 0x0e);
});

test("REP INS commits one interruptible iteration per step", () => {
  const memory = new Map([[0, 0xf3], [1, 0x6c]]);
  let value = 0x40;
  const cpu = new I80386({
    fetch: address => memory.get(address) ?? 0,
    read: address => memory.get(address) ?? 0,
    write: (address, byte) => memory.set(address, byte),
    inPort: () => value++,
  });
  cpu.cx = 2;
  cpu.di = 0x100;
  cpu.step();
  assert.deepEqual([cpu.eip, cpu.cx, cpu.di, memory.get(0x100)], [0, 1, 0x101, 0x40]);
  cpu.step();
  assert.deepEqual([cpu.eip, cpu.cx, cpu.di, memory.get(0x101)], [2, 0, 0x102, 0x41]);
});

test("an interrupt and IRET resume REP INS without consuming an extra FIFO byte", () => {
  const memory = new Map();
  const put = (at, bytes) =>
    bytes.forEach((value, index) => memory.set(at + index, value));
  put(0x1000, [0xf3, 0x6c]);
  put(0x80, [0x00, 0x02, 0x00, 0x00]);
  put(0x200, [0xcf]);
  const inputs = [];
  const cpu = new I80386({
    read: address => memory.get(address) ?? 0,
    fetch: address => memory.get(address) ?? 0,
    write: (address, value) => memory.set(address, value & 0xff),
    inPort: () => { inputs.push(inputs.length + 0x50); return inputs.at(-1); },
  });
  cpu.cs = 0x100;
  cpu.segmentCaches[1].base = 0x1000;
  cpu.sp = 0x100;
  cpu.cx = 2;
  cpu.di = 0x300;
  cpu.eflags |= 0x200;
  cpu.step();
  assert.deepEqual([cpu.eip, cpu.cx, cpu.di, inputs], [0, 1, 0x301, [0x50]]);
  assert.equal(cpu.interrupt(0x20), true);
  cpu.step();
  assert.deepEqual([cpu.cs, cpu.eip, inputs], [0x100, 0, [0x50]]);
  cpu.step();
  assert.deepEqual(
    [cpu.eip, cpu.cx, cpu.di, inputs, memory.get(0x300), memory.get(0x301)],
    [2, 0, 0x302, [0x50, 0x51], 0x50, 0x51],
  );
});

test("a later REP INS page fault preserves completed bytes and does not consume input", () => {
  const memory = new Map([[0, 0xf3], [1, 0x6c]]);
  const put32 = (address, value) => {
    for (let index = 0; index < 4; index++)
      memory.set(address + index, (value >>> (index * 8)) & 0xff);
  };
  put32(0x1000, 0x2003);
  put32(0x2000, 0x0003);
  put32(0x200c, 0x3003);
  let inputs = 0;
  const cpu = new I80386({
    read: address => memory.get(address) ?? 0,
    fetch: address => memory.get(address) ?? 0,
    write: (address, value) => memory.set(address, value & 0xff),
    inPort: () => { inputs++; return 0x66; },
  });
  cpu.cr0 = 0x80000001;
  cpu.cr3 = 0x1000;
  cpu.cx = 2;
  cpu.di = 0x3fff;
  cpu.step();
  assert.deepEqual([cpu.eip, cpu.cx, cpu.di, inputs, memory.get(0x3fff)], [0, 1, 0x4000, 1, 0x66]);
  assert.throws(
    () => cpu.step(),
    error => error?.vector === 14 && error.errorCode === 2,
  );
  assert.deepEqual([cpu.eip, cpu.cx, cpu.di, inputs, cpu.cr2], [0, 1, 0x4000, 1, 0x4000]);
});

test("a denied REP INS bitmap check consumes no device input", () => {
  const { cpu, memory } = fixture([0xf3, 0x6c]);
  let inputs = 0;
  cpu.inPort = () => { inputs++; return 0; };
  cpu.cr0 = 1;
  cpu.cs = 3;
  cpu.tr = { selector: 8, base: 0x100, limit: 0x68, present: true, type: 11 };
  memory.set(0x166, 0x68);
  memory.set(0x167, 0);
  memory.set(0x168, 1);
  cpu.cx = 1;
  assert.throws(
    () => cpu.step(),
    error => error?.vector === 13 && error.errorCode === 0,
  );
  assert.deepEqual([inputs, cpu.cx, cpu.di, cpu.eip], [0, 1, 0, 0]);
});

test("INS destination faults occur before a device read", () => {
  let inputs = 0;
  const cpu = fixture([0x6d]).cpu;
  cpu.inPort = () => { inputs++; return 0; };
  cpu.cr0 = 1;
  cpu.segmentCaches[0].writable = false;
  assert.throws(
    () => cpu.step(),
    error => error?.vector === 13 && error.errorCode === 0,
  );
  assert.deepEqual([inputs, cpu.di, cpu.eip], [0, 0, 0]);
});
