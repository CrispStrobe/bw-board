import test from "node:test";
import assert from "node:assert/strict";
import I80386, {
  I80386Fault,
  UnsupportedI80386,
} from "../src/experimental/i80386.js";

function fixture(bytes, options = {}) {
  const memory = new Map(bytes.map((value, index) => [index, value]));
  const reads = [];
  const writes = [];
  const cpu = new I80386(
    {
      fetch: (address) => memory.get(address) ?? 0,
      read: (address) => {
        reads.push(address);
        return memory.get(address) ?? 0;
      },
      write: (address, value) => {
        writes.push([address, value]);
        memory.set(address, value & 0xff);
      },
    },
    options,
  );
  return { cpu, memory, reads, writes };
}

test("an absent NPX decodes FNINIT and leaves an FNSTCW destination untouched", () => {
  const f = fixture([
    0xdb, 0xe3,             // FNINIT
    0xd9, 0x3e, 0x67, 0x00, // FNSTCW word [0067]
    0x9b,                   // WAIT
  ]);
  f.memory.set(0x67, 0x3f);
  f.memory.set(0x68, 0x03);

  f.cpu.step();
  f.cpu.step();
  f.cpu.step();

  assert.equal(f.cpu.eip, 7);
  assert.deepEqual([f.memory.get(0x67), f.memory.get(0x68)], [0x3f, 0x03]);
  assert.deepEqual(f.reads, [], "an absent coprocessor causes no operand read");
  assert.deepEqual(f.writes, [], "an absent coprocessor causes no operand write");
});

test("WAIT and ESC apply the original 386 MP, EM, and TS #NM rules", () => {
  for (const [bytes, cr0] of [
    [[0x9b], 0x0a],
    [[0xd9, 0xc0], 0x04],
    [[0xd9, 0xc0], 0x08],
  ]) {
    const { cpu } = fixture(bytes);
    cpu.cr0 = cr0;
    assert.throws(
      () => cpu.step(),
      (error) => error instanceof I80386Fault && error.vector === 7,
    );
    assert.equal(cpu.eip, 0);
  }

  const emOnlyWait = fixture([0x9b]).cpu;
  emOnlyWait.cr0 = 0x04;
  emOnlyWait.step();
  assert.equal(emOnlyWait.eip, 1, "EM alone does not make WAIT raise #NM");
});

test("declaring a coprocessor never fabricates x87 execution", () => {
  const { cpu } = fixture([0xdb, 0xe3]);
  cpu.hardwareReset({ coprocessor: "80387" });
  cpu.cs = 0;
  cpu.eip = 0;
  cpu.segmentCaches[1].base = 0;
  assert.throws(() => cpu.step(), UnsupportedI80386);
  assert.equal(cpu.eip, 0);
});
