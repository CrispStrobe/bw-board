import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

function cpuWith(program) {
  const memory = new Map(program.map((value, index) => [index, value]));
  const cpu = new I80386({
    read: address => memory.get(address) ?? 0,
    fetch: address => memory.get(address) ?? 0,
    write: (address, value) => memory.set(address, value & 255),
  });
  return { cpu, memory };
}

function put(memory, address, value, bytes) {
  for (let index = 0; index < bytes; index++)
    memory.set(address + index, (value >>> (index * 8)) & 255);
}

test("RET imm16 separates operand width from stack address size", () => {
  {
    const { cpu, memory } = cpuWith([0xc2, 0x34, 0x12]);
    cpu.esp = 0x1234fff0;
    cpu.segmentCaches[2].default32 = true;
    cpu.segmentCaches[2].limit = 0xffffffff;
    put(memory, 0x1234fff0, 0x5678, 2);
    cpu.step();
    assert.deepEqual([cpu.eip, cpu.esp], [0x5678, 0x12351226]);
  }
  {
    const { cpu, memory } = cpuWith([0x66, 0xc2, 4, 0]);
    cpu.esp = 0x12340100;
    cpu.segmentCaches[2].default32 = false;
    cpu.segmentCaches[1].limit = 0xffffffff;
    put(memory, 0x100, 0x89abcdef, 4);
    cpu.step();
    assert.deepEqual([cpu.eip, cpu.esp], [0x89abcdef, 0x12340108]);
  }
});

test("RET imm16 validates the target before committing SP", () => {
  const { cpu, memory } = cpuWith([0xc2, 8, 0]);
  cpu.cr0 = 1;
  cpu.segmentCaches[1] = {
    base: 0,
    limit: 0xff,
    present: true,
    code: true,
    readable: true,
    writable: false,
    default32: false,
  };
  cpu.sp = 0x200;
  put(memory, 0x200, 0x100, 2);
  assert.throws(
    () => cpu.step(),
    error => error?.vector === 13 && error.errorCode === 0,
  );
  assert.equal(cpu.sp, 0x200);
});
