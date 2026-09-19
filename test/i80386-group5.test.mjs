import test from "node:test";
import assert from "node:assert/strict";
import I80386, { UnsupportedI80386 } from "../src/experimental/i80386.js";

function fixture(bytes) {
  const memory = new Map(bytes.map((value, index) => [index, value]));
  const writes = [];
  const cpu = new I80386({
    read: (address) => memory.get(address) ?? 0,
    fetch: (address) => memory.get(address) ?? 0,
    write(address, value) {
      writes.push([address >>> 0, value & 0xff]);
      memory.set(address >>> 0, value & 0xff);
    },
  });
  return { cpu, memory, writes };
}

test("FE/FF INC and DEC preserve carry across byte, word, and memory forms", () => {
  const { cpu, memory } = fixture([
    0xfe, 0xc0,
    0xff, 0xc8,
    0xff, 0x06, 0x00, 0x01,
  ]);
  cpu.eax = 0x123400ff;
  cpu.eflags = 3;
  memory.set(0x100, 0xff);
  memory.set(0x101, 0x7f);
  cpu.step();
  assert.equal(cpu.eax, 0x12340000);
  assert.equal(cpu.eflags & 1, 1);
  cpu.step();
  assert.equal(cpu.ax, 0xffff);
  assert.equal(cpu.eflags & 1, 1);
  cpu.step();
  assert.deepEqual([memory.get(0x100), memory.get(0x101)], [0x00, 0x80]);
  assert.equal(cpu.eflags & 1, 1);
});

test("near indirect CALL and JMP validate targets before stack mutation", () => {
  const call = fixture([0xff, 0xd0]);
  call.cpu.ax = 0x10;
  call.cpu.sp = 0x100;
  call.cpu.step();
  assert.deepEqual([call.cpu.eip, call.cpu.sp], [0x10, 0xfe]);
  assert.deepEqual([call.memory.get(0xfe), call.memory.get(0xff)], [2, 0]);

  const jump = fixture([0xff, 0xe3]).cpu;
  jump.bx = 0x20;
  jump.step();
  assert.equal(jump.eip, 0x20);

  const bad = fixture([0xff, 0xd0]).cpu;
  bad.ax = 0x10;
  bad.sp = 0x100;
  bad.segmentCaches[1].limit = 5;
  assert.throws(() => bad.step(), (error) => error?.vector === 13);
  assert.deepEqual([bad.eip, bad.sp], [0, 0x100]);
});

test("PUSH r/m uses the old ESP effective address before stack update", () => {
  const { cpu, memory } = fixture([0x66, 0x67, 0xff, 0x34, 0x24]);
  cpu.esp = 0x200;
  [0x78, 0x56, 0x34, 0x12].forEach((value, index) =>
    memory.set(0x200 + index, value),
  );
  cpu.step();
  assert.equal(cpu.esp, 0x1fc);
  assert.deepEqual(
    [0, 1, 2, 3].map((index) => memory.get(0x1fc + index)),
    [0x78, 0x56, 0x34, 0x12],
  );
});

test("far indirect forms stay explicit refusals and reserved extensions are #UD", () => {
  for (const modrm of [0x18, 0x28]) {
    const cpu = fixture([0xff, modrm]).cpu;
    cpu.cr0 = 1;
    assert.throws(() => cpu.step(), UnsupportedI80386);
    assert.equal(cpu.eip, 0);
  }
  for (const bytes of [[0xfe, 0xd0], [0xff, 0xf8]]) {
    const cpu = fixture(bytes).cpu;
    assert.throws(() => cpu.step(), (error) => error?.vector === 6);
    assert.equal(cpu.eip, 0);
  }
});

test("real far CALL/RETF and indirect far JMP use complete pointer/frame spans", () => {
  const direct = fixture([0x9a, 0x10, 0x00, 0x20, 0x00]);
  direct.memory.set(0x210, 0xcb);
  direct.cpu.sp = 0x100;
  direct.cpu.step();
  assert.deepEqual(
    [direct.cpu.cs, direct.cpu.eip, direct.cpu.sp],
    [0x20, 0x10, 0xfc],
  );
  assert.deepEqual(
    [0, 1, 2, 3].map((index) => direct.memory.get(0xfc + index)),
    [5, 0, 0, 0],
  );
  direct.cpu.step();
  assert.deepEqual([direct.cpu.cs, direct.cpu.eip, direct.cpu.sp], [0, 5, 0x100]);

  const indirect = fixture([0xff, 0x2e, 0x00, 0x01]);
  [0x34, 0x12, 0x00, 0x20].forEach((value, index) =>
    indirect.memory.set(0x100 + index, value),
  );
  indirect.cpu.step();
  assert.deepEqual([indirect.cpu.cs, indirect.cpu.eip], [0x2000, 0x1234]);
});
