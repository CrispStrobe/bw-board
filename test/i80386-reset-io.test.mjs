import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

test("hardwareReset uses the 386 reset cache until a real CS reload", () => {
  const seen = [];
  const cpu = new I80386(
    {
      fetch: (address) => {
        seen.push(address >>> 0);
        return address === 0xfffffff0
          ? 0xea
          : ([0x45, 0, 0, 0xf0][address - 0xfffffff1] ?? 0);
      },
    },
    { hardwareReset: true },
  );
  assert.deepEqual(
    [cpu.cs, cpu.eip, cpu.pc, cpu.cr0, cpu.edx],
    [0xf000, 0xfff0, 0xfffffff0, 0, 0x300],
  );
  cpu.step();
  assert.deepEqual([cpu.cs, cpu.eip, cpu.pc], [0xf000, 0x45, 0xf0045]);
  assert.equal(seen[0], 0xfffffff0);
  const ordinary = new I80386();
  assert.deepEqual([ordinary.cs, ordinary.eip, ordinary.pc], [0, 0, 0]);

  const with387 = new I80386();
  with387.hardwareReset({ coprocessor: "80387", stepping: 0x12 });
  assert.deepEqual([with387.cr0, with387.edx], [0x10, 0x312]);
  assert.throws(() => with387.hardwareReset({ coprocessor: "80487" }), TypeError);
});

test("PUSHFD/POPFD mask system and reserved flags with privilege rules", () => {
  const memory = new Map();
  const bus = {
    read: (address) => memory.get(address) ?? 0,
    fetch: (address) => memory.get(address) ?? 0,
    write: (address, value) => memory.set(address, value),
  };
  [0x66, 0x9c].forEach((value, index) => memory.set(index, value));
  const push = new I80386(bus);
  push.esp = 0x100;
  push.eflags = 0x0003ffff;
  push.step();
  const image = [0, 1, 2, 3].reduce(
    (value, index) => value | ((memory.get(0xfc + index) ?? 0) << (index * 8)),
    0,
  );
  assert.equal(image >>> 0, 0x7fd7);

  memory.clear();
  [0x66, 0x9d].forEach((value, index) => memory.set(index, value));
  [0xff, 0xff, 0xff, 0xff].forEach((value, index) => memory.set(0x100 + index, value));
  const pop = new I80386(bus);
  pop.esp = 0x100;
  pop.eflags = 0x00030002;
  pop.cr0 = 1;
  pop.cs = 3;
  pop.step();
  assert.equal(pop.eflags & 0x3000, 0);
  assert.equal(pop.eflags & 0x200, 0);
  assert.equal(pop.eflags & 0x30000, 0x30000);
  assert.equal(pop.eflags & 0xfff80028, 0);
});

test("LOOP uses address size for count and operand size for wrapped target", () => {
  const bytes = new Map([
    [0xfffe, 0x66],
    [0xffff, 0xe2],
    [0x10000, 0xfd],
  ]);
  const cpu = new I80386({
    read: (address) => bytes.get(address) ?? 0,
    fetch: (address) => bytes.get(address) ?? 0,
  });
  cpu.segmentCaches[1].default32 = true;
  cpu.segmentCaches[1].limit = 0x1ffff;
  cpu.eip = 0xfffe;
  cpu.ecx = 2;
  cpu.step();
  assert.deepEqual([cpu.eip, cpu.ecx], [0xfffe, 1]);
});

test("CLI, STI, and HLT fault at insufficient protected privilege", () => {
  for (const opcode of [0xfa, 0xfb, 0xf4]) {
    const cpu = new I80386({ read: () => opcode, fetch: () => opcode });
    cpu.cr0 = 1;
    cpu.cs = 3;
    cpu.eflags = 2;
    assert.throws(
      () => cpu.step(),
      (error) => error?.vector === 13 && error.errorCode === 0,
    );
    assert.deepEqual([cpu.eip, cpu.eflags, cpu.halted], [0, 2, false]);
  }
});

test("IN/OUT preserve width and fault precisely when protected I/O has no bitmap", () => {
  const writes = [];
  const memory = new Map([
    [0, 0xe4],
    [1, 0x20],
    [2, 0xe7],
    [3, 0x21],
    [4, 0xe5],
    [5, 0x22],
    [6, 0x66],
    [7, 0xed],
    [8, 0x66],
    [9, 0xef],
  ]);
  const cpu = new I80386({
    fetch: (a) => memory.get(a) ?? 0,
    read: (a) => memory.get(a) ?? 0,
    inPort: (port, width) =>
      width === 8 ? 0xaa : width === 16 ? 0x1234 : 0x89abcdef,
    outPort: (port, value, width) => writes.push([port, value >>> 0, width]),
  });
  cpu.edx = 0x30;
  cpu.step();
  assert.equal(cpu.al, 0xaa);
  cpu.step();
  assert.deepEqual(writes.pop(), [0x21, 0xaa, 16]);
  cpu.step();
  assert.equal(cpu.ax, 0x1234);
  cpu.step();
  assert.equal(cpu.eax, 0x89abcdef);
  cpu.step();
  assert.deepEqual(writes.pop(), [0x30, 0x89abcdef, 32]);

  let deniedReads=0;
  const denied = new I80386({ fetch: () => 0xec, inPort:()=>{deniedReads++;return 1;} });
  denied.cr0 = 1;
  denied.cs = 3;
  denied.eax=0x12345678;
  assert.throws(
    () => denied.step(),
    (e) => e?.vector===13&&e.errorCode===0,
  );
  assert.deepEqual([denied.eip,denied.eax,deniedReads],[0,0x12345678,0]);
});

test("LOOP address size and accumulator/group immediates execute general byte streams", () => {
  const bytes = [
    0xb9, 2, 0, 0xe2, 0xfe, 0x66, 0x3d, 0, 0, 0, 0, 0x81, 0xc8, 0x34, 0x12,
    0xa9, 0x30, 0x00,
  ];
  const cpu = new I80386({
    read: (a) => bytes[a] ?? 0,
    fetch: (a) => bytes[a] ?? 0,
  });
  cpu.step();
  cpu.step();
  cpu.step();
  assert.equal(cpu.cx, 0);
  cpu.step();
  assert.equal(cpu.eflags & 0x40, 0x40);
  cpu.step();
  assert.equal(cpu.ax, 0x1234);
  cpu.step();
  assert.equal(cpu.eflags & 0x40, 0);
});
