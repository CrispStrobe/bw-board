import test from "node:test";
import assert from "node:assert/strict";
import I80386, { I80386Fault } from "../src/experimental/i80386.js";

function fixture() {
  const memory = new Map(),
    reads = [],
    writes = [];
  const cpu = new I80386({
    read(address) {
      reads.push(address >>> 0);
      return memory.get(address >>> 0) ?? 0;
    },
    fetch(address) {
      reads.push(address >>> 0);
      return memory.get(address >>> 0) ?? 0;
    },
    write(address, value) {
      writes.push([address >>> 0, value & 255]);
      memory.set(address >>> 0, value & 255);
    },
  });
  const put = (address, bytes) =>
    bytes.forEach((byte, i) => memory.set(address + i, byte));
  const dword = (address) =>
    ((memory.get(address) ?? 0) |
      ((memory.get(address + 1) ?? 0) << 8) |
      ((memory.get(address + 2) ?? 0) << 16) |
      ((memory.get(address + 3) ?? 0) * 0x1000000)) >>>
    0;
  const putDword = (address, value) =>
    put(address, [value, value >>> 8, value >>> 16, value >>> 24]);
  cpu.segmentCaches[1] = {
    base: 0,
    limit: 0xffffffff,
    default32: true,
    present: true,
    code: true,
    readable: true,
    writable: false,
  };
  cpu.segmentCaches[2] = cpu.segmentCaches[3] = {
    base: 0,
    limit: 0xffffffff,
    default32: true,
    present: true,
    code: false,
    readable: true,
    writable: true,
  };
  cpu.cr0 = 0x80000001;
  cpu.cr3 = 0x1000;
  const map = (
    linear,
    physical,
    flags = 7,
    directory = 0x1000,
    table = 0x2000,
  ) => {
    putDword(directory + ((linear >>> 20) & 0xffc), table | flags);
    putDword(
      table + ((linear >>> 10) & 0xffc),
      (physical & 0xfffff000) | flags,
    );
  };
  return { cpu, memory, reads, writes, put, dword, putDword, map };
}

test("walks PDE/PTE, sets accessed/dirty in walk order, and honors original supervisor writes", () => {
  const f = fixture();
  f.map(0, 0x3000, 3);
  f.map(0x4000, 0x6000, 1);
  f.put(0x3000, [0x89, 0x03]);
  f.cpu.ebx = 0x4000;
  f.cpu.eax = 0x12345678;
  f.cpu.step();
  assert.equal(
    f.dword(0x6000),
    0x12345678,
    "386 supervisor writes ignore page R/W",
  );
  assert.equal(f.dword(0x1000) & 0x20, 0x20);
  assert.equal(f.dword(0x2000) & 0x20, 0x20);
  assert.equal(
    f.dword(0x2010) & 0x60,
    0x60,
    "data PTE records accessed and dirty",
  );
});

test("faulting second page retains first-page walk/read effects and precise restart state", () => {
  const f = fixture();
  f.map(0, 0x3000);
  f.map(0x4000, 0x6000);
  f.put(0x3000, [0x8b, 0x03]);
  f.put(0x6fff, [0xaa]);
  f.cpu.ebx = 0x4fff;
  f.cpu.eax = 0x11223344;
  assert.throws(
    () => f.cpu.step(),
    (error) =>
      error instanceof I80386Fault &&
      error.vector === 14 &&
      error.errorCode === 0,
  );
  assert.deepEqual([f.cpu.eip, f.cpu.eax, f.cpu.cr2], [0, 0x11223344, 0x5000]);
  assert.equal(
    f.dword(0x2010) & 0x20,
    0x20,
    "first data page remains accessed",
  );
  assert.ok(
    f.reads.includes(0x6fff),
    "the completed first-page byte read remains observable",
  );

  const write = fixture();
  write.map(0, 0x3000);
  write.map(0x4000, 0x6000);
  write.put(0x3000, [0x89, 0x03]);
  write.cpu.ebx = 0x4fff;
  write.cpu.eax = 0x12345678;
  assert.throws(
    () => write.cpu.step(),
    (error) =>
      error instanceof I80386Fault &&
      error.vector === 14 &&
      error.errorCode === 2,
  );
  assert.equal(
    write.memory.get(0x6fff),
    undefined,
    "scalar destination bytes wait until the full span translates",
  );
  assert.equal(write.dword(0x2010) & 0x60, 0x60);

  const fetch = fixture();
  fetch.map(0, 0x3000);
  fetch.cpu.eip = 0xfff;
  fetch.put(0x3fff, [0x66]);
  assert.throws(
    () => fetch.cpu.step(),
    (error) =>
      error instanceof I80386Fault &&
      error.vector === 14 &&
      error.errorCode === 0,
  );
  assert.deepEqual([fetch.cpu.eip, fetch.cpu.cr2], [0xfff, 0x1000]);
});

test("distinguishes missing PDE/PTE and rejects user writes with exact #PF bits", () => {
  const missingPde = fixture();
  assert.throws(
    () => missingPde.cpu._readLinear(0x400000, 1),
    (e) =>
      e instanceof I80386Fault &&
      e.errorCode === 0 &&
      missingPde.cpu.cr2 === 0x400000,
  );

  const missingPte = fixture();
  missingPte.putDword(0x1000, 0x2007);
  assert.throws(
    () => missingPte.cpu._readLinear(0x4000, 1),
    (e) => e instanceof I80386Fault && e.errorCode === 0,
  );
  assert.equal(
    missingPte.dword(0x1000) & 0x20,
    0x20,
    "present PDE is accessed before missing PTE faults",
  );

  const denied = fixture();
  denied.map(0, 0x3000, 7);
  denied.map(0x4000, 0x6000, 5);
  denied.put(0x3000, [0x89, 0x03]);
  denied.cpu.cs = 3;
  denied.cpu.ebx = 0x4000;
  assert.throws(
    () => denied.cpu.step(),
    (e) => e instanceof I80386Fault && e.errorCode === 7,
  );
  assert.deepEqual([denied.cpu.eip, denied.cpu.cr2], [0, 0x4000]);
  assert.equal(
    denied.dword(0x2010) & 0x60,
    0,
    "denied PTE is neither accessed nor dirtied",
  );

  for (const [bytes, expected, label] of [
    [[0x01, 0x03], 7, "ADD RMW is a write access"],
    [[0x39, 0x03], 5, "CMP remains a read access"],
    [[0xc1, 0x23, 0], 7, "count-zero memory shift retains RMW write admission"],
  ]) {
    const rmw = fixture();
    rmw.map(0, 0x3000, 7);
    rmw.map(0x4000, 0x6000, 1);
    rmw.putDword(0x1000, 0x2007);
    rmw.put(0x3000, bytes);
    rmw.cpu.cs = 3;
    rmw.cpu.ebx = 0x4000;
    assert.throws(
      () => rmw.cpu.step(),
      (e) => e instanceof I80386Fault && e.errorCode === expected,
      label,
    );
  }
});

test("system-table walks use supervisor privilege and MOV CR3 remaps immediately", () => {
  const f = fixture();
  f.map(0, 0x3000, 7);
  f.map(0x8000, 0x7000, 1);
  f.cpu.cs = 3;
  f.cpu.gdtr = { base: 0x8000, limit: 0x0f };
  f.put(0x7008, [0xff, 0xff, 0, 0, 0, 0x9a, 0xcf, 0]);
  assert.equal(
    f.cpu._descriptor(8).code,
    true,
    "GDT reads override CPL3 page privilege",
  );

  const remap = fixture();
  remap.map(0, 0x3000);
  remap.put(0x3000, [0x0f, 0x22, 0xd8]);
  remap.putDword(0x4000, 0x5007);
  remap.putDword(0x5000, 0x7007);
  remap.cpu.eax = 0x4000;
  remap.cpu.step();
  assert.equal(remap.cpu.cr3, 0x4000);
  remap.put(0x7000, [0x5a]);
  assert.equal(remap.cpu._readLinear(0, 1), 0x5a);

  for (const bytes of [
    [0x0f, 0x20, 0xc0],
    [0x0f, 0x22, 0xd8],
    [0x0f, 0x01, 0x16, 0x20, 0],
    [0x0f, 0x01, 0x1e, 0x20, 0],
  ]) {
    const user = fixture();
    user.map(0, 0x3000, 7);
    user.put(0x3000, bytes);
    user.cpu.cs = 3;
    const before = {
      cr0: user.cpu.cr0,
      cr3: user.cpu.cr3,
      gdtr: { ...user.cpu.gdtr },
      idtr: { ...user.cpu.idtr },
    };
    assert.throws(
      () => user.cpu.step(),
      (e) => e instanceof I80386Fault && e.vector === 13 && e.errorCode === 0,
    );
    assert.deepEqual(
      {
        cr0: user.cpu.cr0,
        cr3: user.cpu.cr3,
        gdtr: user.cpu.gdtr,
        idtr: user.cpu.idtr,
      },
      before,
    );
  }
});

test("segment checks precede paging and paged IDT/GDT/stack references use their proper policies", () => {
  const segment = fixture();
  segment.map(0, 0x3000);
  segment.map(0x4000, 0x6000);
  segment.put(0x3000, [0x8b, 0x03]);
  segment.cpu.ebx = 0x4000;
  segment.cpu.segmentCaches[3].limit = 0;
  assert.throws(
    () => segment.cpu.step(),
    (e) => e instanceof I80386Fault && e.vector === 13,
  );
  assert.equal(
    segment.dword(0x2010) & 0x20,
    0,
    "segment fault occurs before the data-page walk",
  );

  const readonly = fixture();
  readonly.map(0, 0x3000);
  readonly.put(0x3000, [0x2e, 0x01, 0x03]);
  readonly.cpu.ebx = 0x4000;
  const cr2 = readonly.cpu.cr2;
  assert.throws(
    () => readonly.cpu.step(),
    (e) => e instanceof I80386Fault && e.vector === 13,
  );
  assert.equal(
    readonly.cpu.cr2,
    cr2,
    "read-only segment #GP wins over the missing page",
  );

  const system = fixture();
  system.map(0x8000, 0x7000, 1);
  system.map(0x9000, 0x8000, 1);
  system.map(0xa000, 0x9000, 3);
  system.cpu.gdtr = { base: 0x8000, limit: 0x17 };
  system.cpu.idtr = { base: 0x9000, limit: 0x7ff };
  const descriptor = (base, access) => [
    0xff,
    0xff,
    base & 255,
    (base >>> 8) & 255,
    (base >>> 16) & 255,
    access,
    0xcf,
    (base >>> 24) & 255,
  ];
  system.put(0x7008, descriptor(0, 0x9a));
  system.put(0x7010, descriptor(0xa000, 0x92));
  system.put(0x8000 + 13 * 8, [0x00, 0x01, 0x08, 0, 0, 0x8e, 0, 0]);
  system.cpu.cs = 8;
  system.cpu.ss = 0x10;
  system.cpu.esp = 0x100;
  system.cpu.segmentCaches[1] = system.cpu._descriptor(8);
  system.cpu.segmentCaches[2] = system.cpu._descriptor(0x10);
  system.cpu._deliverProtected(13, 0x44, 0, { fault: true });
  assert.deepEqual([system.cpu.eip, system.cpu.esp], [0x100, 0xf0]);
  assert.deepEqual(
    [system.dword(0x90f0), system.dword(0x90f4), system.dword(0x90f8)],
    [0, 0x44, 8],
  );
});

test("LGDT reads its six-byte operand in address order across a page fault", () => {
  const f = fixture();
  f.map(0, 0x3000);
  f.map(0x4000, 0x6000);
  f.put(0x3000, [0x0f, 0x01, 0x15, 0xff, 0x0f, 0x00, 0x00]);
  f.put(0x6fff, [0x34]);
  f.cpu.segmentCaches[3].base = 0x4000;
  const before = { ...f.cpu.gdtr };
  assert.throws(
    () => f.cpu.step(),
    (error) => error instanceof I80386Fault && error.vector === 14,
  );
  assert.equal(f.cpu.cr2, 0x5000);
  assert.deepEqual(f.cpu.gdtr, before);
  assert.equal(f.reads.includes(0x6fff), true);
});
