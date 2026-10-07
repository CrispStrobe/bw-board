import test from "node:test";
import assert from "node:assert/strict";
import I80386, { I80386Fault } from "../src/experimental/i80386.js";

function fixture() {
  const cpu = new I80386({ fetch: () => 0xf4, read: () => 0, write: () => {} });
  const before = Array.from({ length: 6 }, (_, id) => cpu.segmentCaches[id]);
  return { cpu, before };
}

test("precommit instruction fault restores all six prior cache identities and registers", () => {
  const { cpu, before } = fixture();
  cpu.eax = 0x12345678;
  cpu.eip = 0x40;
  cpu._stepInstruction = function () {
    for (let id = 0; id < 6; id++)
      this.segmentCaches[id] = { ...this.segmentCaches[id], base: 0x1000 + id };
    this.eax = 0;
    this.eip = 0x80;
    throw new I80386Fault(13, 0, "precommit fault after cache replacements");
  };
  assert.throws(() => cpu.step(), error =>
    error instanceof I80386Fault && error.vector === 13 && error.errorCode === 0);
  for (let id = 0; id < 6; id++)
    assert.strictEqual(cpu.segmentCaches[id], before[id], `cache ${id}`);
  assert.deepEqual([cpu.eax, cpu.eip], [0x12345678, 0x40]);
});

test("nested instruction snapshots retain their own cache replacement boundaries", () => {
  const { cpu, before } = fixture();
  let nested = false;
  cpu._stepInstruction = function () {
    if (nested) {
      this.segmentCaches[1] = { ...this.segmentCaches[1], base: 0x2222 };
      throw new I80386Fault(13, 0, "nested precommit fault");
    }
    this.segmentCaches[0] = { ...this.segmentCaches[0], base: 0x1111 };
    const outerCache = this.segmentCaches[0];
    nested = true;
    assert.throws(() => this.step(), error =>
      error instanceof I80386Fault && error.vector === 13);
    assert.strictEqual(this.segmentCaches[0], outerCache);
    assert.strictEqual(this.segmentCaches[1], before[1]);
    throw new I80386Fault(13, 0, "outer precommit fault");
  };
  assert.throws(() => cpu.step(), error =>
    error instanceof I80386Fault && error.vector === 13);
  assert.strictEqual(cpu.segmentCaches[0], before[0]);
  assert.strictEqual(cpu.segmentCaches[1], before[1]);
});
