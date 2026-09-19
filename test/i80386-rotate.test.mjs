import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

const CF = 1, PF = 4, ZF = 0x40, SF = 0x80, OF = 0x800;

function cpuFor(bytes, readLog = []) {
  const memory = new Map(bytes.map((value, index) => [index, value]));
  const cpu = new I80386({
    read(address) {
      readLog.push(address >>> 0);
      return memory.get(address >>> 0) ?? 0;
    },
    fetch: (address) => memory.get(address >>> 0) ?? 0,
    write: (address, value) => memory.set(address >>> 0, value & 0xff),
  });
  return { cpu, memory };
}

test("ROL/ROR/RCL/RCR count-one results and defined flags match the bit ring", () => {
  const cases = [
    { extension: 0, value: 0x81, result: 0x03 },
    { extension: 1, value: 0x01, result: 0x80 },
    { extension: 2, value: 0x80, result: 0x01 },
    { extension: 3, value: 0x01, result: 0x80 },
  ];
  for (const item of cases) {
    const { cpu } = cpuFor([0xd0, 0xc0 | (item.extension << 3)]);
    cpu.al = item.value;
    cpu.eflags = 2 | CF | PF | ZF | SF;
    cpu.step();
    assert.equal(cpu.al, item.result);
    assert.equal(cpu.eflags & (CF | OF), CF | OF);
    assert.equal(cpu.eflags & (PF | ZF | SF), PF | ZF | SF);
  }
});

test("rotate counts reduce by width or carry-ring width at 8/16/32 bits", () => {
  const unchanged = [
    { bytes: [0xc0, 0xc0, 8], register: "al", value: 0x81 },
    { bytes: [0xc0, 0xd0, 9], register: "al", value: 0x81 },
    { bytes: [0xc1, 0xc8, 16, 0], register: "ax", value: 0x8001 },
    { bytes: [0xc1, 0xd8, 17, 0], register: "ax", value: 0x8001 },
    { bytes: [0x66, 0xc1, 0xc0, 0x20, 0, 0, 0], register: "eax", value: 0x80000001 },
  ];
  for (const item of unchanged) {
    const { cpu } = cpuFor(item.bytes);
    cpu[item.register] = item.value;
    cpu.eflags = 2 | CF | OF | PF;
    cpu.step();
    assert.equal(cpu[item.register], item.value);
    assert.equal(cpu.eflags & (CF | OF | PF), CF | OF | PF);
  }
  const { cpu } = cpuFor([0xb1, 31, 0xd2, 0xd0]);
  cpu.al = 0x81;
  cpu.eflags |= CF;
  cpu.step();
  cpu.step();
  assert.equal(cpu.al, 0x1c, "RCL8 count31 reduces to four positions");
  assert.equal(cpu.eflags & CF, 0);
});

test("rotate memory forms establish write intent before operand reads", () => {
  const reads = [];
  const { cpu } = cpuFor([0xd0, 0x16, 0x00, 0x01], reads);
  cpu.cr0 = 1;
  cpu.segmentCaches[3].writable = false;
  assert.throws(
    () => cpu.step(),
    (error) => error?.vector === 13 && error.errorCode === 0,
  );
  assert.deepEqual(reads, []);
});
