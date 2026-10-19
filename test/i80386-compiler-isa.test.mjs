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

test("IMUL immediate forms sign-extend operands and define only CF/OF", () => {
  const short = fixture([0x66, 0x6b, 0xc3, 0xfe]).cpu;
  short.ebx = 0x40000001;
  short.eflags = 0x46;
  short.step();
  assert.equal(short.eax, 0x7ffffffe);
  assert.equal(short.eflags & 0x8c7, 0x847);

  const fitting = fixture([0x69, 0xcb, 0xff, 0xff]).cpu;
  fitting.ebx = 2;
  fitting.ecx = 0xaaaa0000;
  fitting.eflags = 0x8c7;
  fitting.step();
  assert.equal(fitting.ecx, 0xaaaafffe);
  assert.equal(fitting.eflags & 0x801, 0);
  assert.equal(fitting.eflags & 0xc6, 0xc6);
});

test("IMUL source faults preserve the destination, flags, and restart EIP", () => {
  const { cpu, memory } = fixture([
    0x67, 0x66, 0x69, 0x0d, 0x00, 0x40, 0x00, 0x00, 1, 0, 0, 0,
  ]);
  const put32 = (address, value) => {
    for (let index = 0; index < 4; index++)
      memory.set(address + index, (value >>> (index * 8)) & 0xff);
  };
  put32(0x1000, 0x2003);
  put32(0x2000, 0x0003);
  cpu.cr0 = 0x80000001;
  cpu.cr3 = 0x1000;
  cpu.ecx = 0x12345678;
  cpu.eflags = 0x847;
  assert.throws(
    () => cpu.step(),
    (error) => error?.vector === 14 && error.errorCode === 0,
  );
  assert.deepEqual(
    [cpu.ecx, cpu.eflags, cpu.eip, cpu.cr2],
    [0x12345678, 0x847, 0, 0x4000],
  );
});

test("SETcc writes canonical bytes without changing flags", () => {
  const cpu = fixture([
    0x0f, 0x94, 0xc0, // SETZ AL
    0x0f, 0x9c, 0xc3, // SETL BL
    0x0f, 0x97, 0xc1, // SETA CL
    0x0f, 0x90, 0xc2, // SETO DL
  ]).cpu;
  cpu.eax = cpu.ebx = cpu.ecx = cpu.edx = 0xffffffff;
  cpu.eflags = 0x82; // SF=1; OF=ZF=CF=0
  for (let count = 0; count < 4; count++) cpu.step();
  assert.deepEqual(
    [cpu.eax, cpu.ebx, cpu.ecx, cpu.edx],
    [0xffffff00, 0xffffff01, 0xffffff01, 0xffffff00],
  );
  assert.equal(cpu.eflags, 0x82);
});

test("SETcc memory faults before any destination write", () => {
  const reads = [];
  const writes = [];
  const bytes = [0x2e, 0x0f, 0x94, 0x06, 0x00, 0x01];
  const cpu = new I80386({
    fetch: (address) => bytes[address] ?? 0,
    read: (address) => { reads.push(address); return 0; },
    write: (address, value) => writes.push([address, value]),
  });
  cpu.cr0 = 1;
  cpu.segmentCaches[1] = {
    ...cpu.segmentCaches[1],
    code: true,
    readable: true,
    writable: false,
  };
  assert.throws(() => cpu.step(), (error) => error?.vector === 13);
  assert.deepEqual([reads, writes, cpu.eip], [[], [], 0]);
});

test("SHLD and SHRD combine 16- and 32-bit operands with defined flags", () => {
  const left = fixture([0x66, 0x0f, 0xa4, 0xd8, 1]).cpu;
  left.eax = 0x80000000;
  left.ebx = 0;
  left.eflags = 0x12;
  left.step();
  assert.equal(left.eax, 0);
  assert.equal(left.eflags & 0x8c5, 0x845);
  assert.equal(left.eflags & 0x10, 0x10, "AF is undefined and left unchanged");

  const right = fixture([0x0f, 0xac, 0xd8, 1]).cpu;
  right.ax = 1;
  right.bx = 0;
  right.eflags = 2;
  right.step();
  assert.equal(right.ax, 0);
  assert.equal(right.eflags & 0x8c5, 0x45);
});

test("double shifts use CL and memory addressing without changing the source", () => {
  const { cpu, memory } = fixture([
    0x67, 0x66, 0x0f, 0xad, 0x15, 0x00, 0x04, 0x00, 0x00,
  ]);
  [0x78, 0x56, 0x34, 0x12].forEach((value, index) => memory.set(0x400 + index, value));
  cpu.edx = 0xabcdef01;
  cpu.cl = 4;
  cpu.step();
  const result = [0, 1, 2, 3].reduce(
    (value, index) => value | ((memory.get(0x400 + index) ?? 0) << (index * 8)),
    0,
  ) >>> 0;
  assert.equal(result, 0x11234567);
  assert.equal(cpu.edx, 0xabcdef01);
});

test("double-shift write admission precedes source-segment reads", () => {
  const reads = [];
  const writes = [];
  const bytes = [0x2e, 0x66, 0x0f, 0xa4, 0x16, 0x00, 0x01, 1];
  const cpu = new I80386({
    fetch: (address) => bytes[address] ?? 0,
    read: (address) => { reads.push(address); return 0; },
    write: (address, value) => writes.push([address, value]),
  });
  cpu.cr0 = 1;
  cpu.segmentCaches[1] = {
    ...cpu.segmentCaches[1],
    code: true,
    readable: true,
    writable: false,
  };
  assert.throws(() => cpu.step(), (error) => error?.vector === 13);
  assert.deepEqual([reads, writes, cpu.eip], [[], [], 0]);
});

test("TEST ModR/M forms set logic flags without writing either operand", () => {
  const byte = fixture([0x84, 0xd8]).cpu;
  byte.al = 0x80;
  byte.bl = 0xff;
  byte.eflags = 0x811;
  byte.step();
  assert.deepEqual([byte.al, byte.bl, byte.eflags & 0x8d5], [0x80, 0xff, 0x080]);

  const { cpu, memory } = fixture([0x66, 0x85, 0x1e, 0x00, 0x02]);
  [0xff, 0xff, 0xff, 0x7f].forEach((value, index) => memory.set(0x200 + index, value));
  cpu.ebx = 0x80000000;
  cpu.step();
  assert.equal(cpu.eflags & 0xc4, 0x44);
  assert.deepEqual(
    [0, 1, 2, 3].map(index => memory.get(0x200 + index)),
    [0xff, 0xff, 0xff, 0x7f],
  );
});
