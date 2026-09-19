import test from "node:test";
import assert from "node:assert/strict";
import I80386, { UnsupportedI80386 } from "../src/experimental/i80386.js";

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
    [cpu.cs, cpu.eip, cpu.pc, cpu.cr0],
    [0xf000, 0xfff0, 0xfffffff0, 0x60000010],
  );
  cpu.step();
  assert.deepEqual([cpu.cs, cpu.eip, cpu.pc], [0xf000, 0x45, 0xf0045]);
  assert.equal(seen[0], 0xfffffff0);
  const ordinary = new I80386();
  assert.deepEqual([ordinary.cs, ordinary.eip, ordinary.pc], [0, 0, 0]);
});

test("IN/OUT preserve width and refuse unimplemented protected bitmap admission", () => {
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

  const denied = new I80386({ fetch: () => 0xec });
  denied.cr0 = 1;
  denied.cs = 3;
  assert.throws(
    () => denied.step(),
    (e) => e instanceof UnsupportedI80386 && /bitmap/.test(e.message),
  );
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
