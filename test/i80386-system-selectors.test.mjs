import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

function fixture(bytes) {
  const memory = new Map(bytes.map((value, index) => [index, value]));
  const cpu = new I80386({
    read: (address) => memory.get(address >>> 0) ?? 0,
    fetch: (address) => memory.get(address >>> 0) ?? 0,
    write: (address, value) => memory.set(address >>> 0, value & 0xff),
  });
  const put = (address, values) =>
    values.forEach((value, index) => memory.set(address + index, value));
  return { cpu, memory, put };
}

function descriptor(base, limit, access) {
  return [
    limit,
    limit >>> 8,
    base,
    base >>> 8,
    base >>> 16,
    access,
    (limit >>> 16) & 15,
    base >>> 24,
  ].map((value) => value & 255);
}

test("LLDT enables LDT data lookup and SLDT returns the visible selector", () => {
  const f = fixture([0x0f, 0x00, 0xd0, 0x8e, 0xd8, 0x0f, 0x00, 0xc3]);
  f.cpu.cr0 = 1;
  f.cpu.gdtr = { base: 0x100, limit: 0x17 };
  f.put(0x108, descriptor(0x300, 0x0f, 0x82));
  f.put(0x308, descriptor(0x123400, 0xffff, 0x92));
  f.cpu.ax = 8;
  f.cpu.step();
  assert.deepEqual(f.cpu.ldtr, {
    selector: 8,
    base: 0x300,
    limit: 0x0f,
    present: true,
    type: 2,
  });
  f.cpu.ax = 0x0c;
  f.cpu.step();
  assert.equal(f.cpu.ds, 0x0c);
  assert.equal(f.cpu.segmentCaches[3].base, 0x123400);
  f.cpu.step();
  assert.equal(f.cpu.bx, 8);
});

test("LTR marks an available TSS busy before committing TR, and STR reports it", () => {
  const f = fixture([0x0f, 0x00, 0xd8, 0x0f, 0x00, 0xc9]);
  f.cpu.cr0 = 1;
  f.cpu.gdtr = { base: 0x100, limit: 0x17 };
  f.put(0x110, descriptor(0x400, 0x67, 0x89));
  f.cpu.ax = 0x10;
  f.cpu.step();
  assert.equal(f.memory.get(0x115), 0x8b);
  assert.deepEqual(f.cpu.tr, {
    selector: 0x10,
    base: 0x400,
    limit: 0x67,
    present: true,
    type: 9,
  });
  f.cpu.step();
  assert.equal(f.cpu.cx, 0x10);
});

test("LLDT/LTR enforce privilege, table, type, presence, and TSS limit before commit", () => {
  const cases = [
    { selector: 4, descriptor: null, vector: 13 },
    { selector: 8, descriptor: descriptor(0, 0, 0x92), vector: 13 },
    { selector: 8, descriptor: descriptor(0, 0, 0x02), vector: 11 },
  ];
  for (const item of cases) {
    const f = fixture([0x0f, 0x00, 0xd0]);
    f.cpu.cr0 = 1;
    f.cpu.gdtr = { base: 0x100, limit: 0x0f };
    if (item.descriptor) f.put(0x108, item.descriptor);
    f.cpu.ax = item.selector;
    assert.throws(() => f.cpu.step(), (error) => error?.vector === item.vector);
    assert.equal(f.cpu.ldtr.present, false);
  }
  const short = fixture([0x0f, 0x00, 0xd8]);
  short.cpu.cr0 = 1;
  short.cpu.gdtr = { base: 0x100, limit: 0x0f };
  short.put(0x108, descriptor(0x400, 0x66, 0x89));
  short.cpu.ax = 8;
  short.cpu.step();
  assert.equal(short.cpu.tr.limit, 0x66);
  assert.equal(short.memory.get(0x10d), 0x8b);

  const user = fixture([0x0f, 0x00, 0xd0]);
  user.cpu.cr0 = 1;
  user.cpu.cs = 3;
  user.cpu.ax = 0;
  assert.throws(
    () => user.cpu.step(),
    (error) => error?.vector === 13 && error.errorCode === 0,
  );
});

test("LDT index zero is usable while an unloaded LDT reference is #GP", () => {
  const unloaded = fixture([0x8e, 0xd8]);
  unloaded.cpu.cr0 = 1;
  unloaded.cpu.ax = 4;
  assert.throws(
    () => unloaded.cpu.step(),
    (error) => error?.vector === 13 && error.errorCode === 4,
  );

  const loaded = fixture([0x8e, 0xd8]);
  loaded.cpu.cr0 = 1;
  loaded.cpu.ldtr = { selector: 8, base: 0x300, limit: 7, present: true, type: 2 };
  loaded.put(0x300, descriptor(0x567800, 0xffff, 0x92));
  loaded.cpu.ax = 4;
  loaded.cpu.step();
  assert.equal(loaded.cpu.segmentCaches[3].base, 0x567800);
});

test("a failed LTR busy-bit write leaves TR unchanged", () => {
  const memory = new Map([[0, 0x0f], [1, 0x00], [2, 0xd8]]);
  const cpu = new I80386({
    read: (address) => memory.get(address) ?? 0,
    fetch: (address) => memory.get(address) ?? 0,
    write() { throw new Error("busy write refused"); },
  });
  cpu.cr0 = 1;
  cpu.gdtr = { base: 0x100, limit: 0x0f };
  descriptor(0x400, 0x67, 0x89).forEach((value, index) => memory.set(0x108 + index, value));
  cpu.ax = 8;
  assert.throws(() => cpu.step(), /busy write refused/);
  assert.equal(cpu.tr.present, false);
});

test("SMSW reports CR0 low bits and LMSW sets but cannot clear PE", () => {
  const f = fixture([
    0x0f, 0x01, 0xe0,
    0x0f, 0x01, 0xf1,
    0x0f, 0x01, 0xe2,
  ]);
  f.cpu.cr0 = 0x00000019;
  f.cpu.eax = 0xaaaa0000;
  f.cpu.cx = 0x0006;
  f.cpu.step();
  assert.equal(f.cpu.eax, 0xaaaa0019);
  f.cpu.step();
  assert.equal(f.cpu.cr0, 0x00000017);
  f.cpu.step();
  assert.equal(f.cpu.dx, 0x0017);

  const user = fixture([0x0f, 0x01, 0xf0]);
  user.cpu.cr0 = 1;
  user.cpu.cs = 3;
  assert.throws(
    () => user.cpu.step(),
    (error) => error?.vector === 13 && error.errorCode === 0,
  );
  assert.equal(user.cpu.cr0, 1);
});
