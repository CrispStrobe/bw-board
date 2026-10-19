import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

function fixture(bytes) {
  const memory = new Map(bytes.map((value, index) => [index, value]));
  const reads = [];
  const cpu = new I80386({
    fetch: (address) => memory.get(address) ?? 0,
    read: (address) => {
      reads.push(address);
      return memory.get(address) ?? 0;
    },
    write: (address, value) => memory.set(address, value & 0xff),
  });
  return { cpu, memory, reads };
}

test("XLAT uses address-size BX or EBX plus unsigned AL", () => {
  const sixteen = fixture([0xd7]);
  sixteen.cpu.ebx = 0x1234fff0;
  sixteen.cpu.al = 0x20;
  sixteen.memory.set(0x10, 0xa5);
  sixteen.cpu.step();
  assert.equal(sixteen.cpu.al, 0xa5);
  assert.deepEqual(sixteen.reads, [0x10]);

  const thirtyTwo = fixture([0x67, 0xd7]);
  thirtyTwo.cpu.ebx = 0x1234fff0;
  thirtyTwo.cpu.al = 0x20;
  thirtyTwo.cpu.segmentCaches[3].limit = 0xffffffff;
  thirtyTwo.memory.set(0x12350010, 0x5a);
  thirtyTwo.cpu.step();
  assert.equal(thirtyTwo.cpu.al, 0x5a);
  assert.deepEqual(thirtyTwo.reads, [0x12350010]);
});

test("XLAT honors a segment override and faults before changing AL", () => {
  const overridden = fixture([0x26, 0xd7]);
  overridden.cpu.segmentCaches[0].base = 0x1000;
  overridden.cpu.bx = 0x20;
  overridden.cpu.al = 3;
  overridden.memory.set(0x1023, 0x7e);
  overridden.cpu.step();
  assert.equal(overridden.cpu.al, 0x7e);
  assert.deepEqual(overridden.reads, [0x1023]);

  const fault = fixture([0xd7]);
  fault.cpu.cr0 = 1;
  fault.cpu.segmentCaches[3] = {
    base: 0,
    limit: 0xffff,
    present: true,
    code: true,
    readable: false,
    writable: false,
  };
  fault.cpu.al = 0x44;
  assert.throws(() => fault.cpu.step(), (error) => error?.vector === 13);
  assert.equal(fault.cpu.al, 0x44);
  assert.deepEqual(fault.reads, []);
});
