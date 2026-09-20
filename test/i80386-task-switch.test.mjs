import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

function put(memory, address, bytes) {
  bytes.forEach((value, index) => memory.set(address + index, value & 255));
}

function descriptor(base, limit, access, flags = 0x40) {
  return [
    limit, limit >>> 8, base, base >>> 8, base >>> 16, access,
    ((limit >>> 16) & 15) | flags, base >>> 24,
  ];
}

function dword(memory, address, value) {
  put(memory, address, [value, value >>> 8, value >>> 16, value >>> 24]);
}

function word(memory, address, value) {
  put(memory, address, [value, value >>> 8]);
}

function pagingFaultFixture(kind) {
  const memory = new Map();
  put(memory, 0x208, descriptor(0, 0xfffff, 0x9a));
  put(memory, 0x210, descriptor(0, 0xfffff, 0x93));
  put(memory, 0x218, descriptor(0x400, 0x67, 0x8b, 0));
  put(memory, 0x220, descriptor(0x500, 0x67, 0x89, 0));
  put(memory, 0x228, descriptor(0x700, 0xff, 0x82, 0));
  put(memory, 0x1208, descriptor(0, 0xfffff, 0x93));
  dword(memory, 0x500 + 0x1c, 0x2000);
  dword(memory, 0x500 + 0x20, 0x100);
  dword(memory, 0x500 + 0x24, 2);
  dword(memory, 0x500 + 0x38, 0x900);
  const selectors = {
    ldt: { ldt: 0x28, cs: 8, ss: 0x10, ds: 0x10, page: 0, cr2: 0x228 },
    cs: { ldt: 0, cs: 8, ss: 0x10, ds: 0x10, page: 0, cr2: 0x208 },
    ss: { ldt: 0, cs: 8, ss: 0x1008, ds: 0x10, page: 1, cr2: 0x1208 },
    data: { ldt: 0, cs: 8, ss: 0x10, ds: 0x1008, page: 1, cr2: 0x1208 },
  }[kind];
  for (const [offset, selector] of [[0x48,0x10],[0x4c,selectors.cs],
    [0x50,selectors.ss],[0x54,selectors.ds],[0x58,0],[0x5c,0],
    [0x60,selectors.ldt]]) word(memory, 0x500 + offset, selector);
  dword(memory, 0x1000, 0x3003);
  dword(memory, 0x2000, 0x4003);
  for (let page = 0; page < 16; page++) {
    dword(memory, 0x3000 + page * 4, (page << 12) | 3);
    dword(memory, 0x4000 + page * 4,
      page === selectors.page ? 0 : (page << 12) | 3);
  }
  const cpu = new I80386({
    read: address => memory.get(address) ?? 0,
    fetch: address => memory.get(address) ?? 0,
    write: (address, value) => memory.set(address, value & 255),
  });
  cpu.cr0 = 0x80000001;
  cpu.cr3 = 0x1000;
  cpu.gdtr = { base: 0x200, limit: 0x100f };
  cpu.cs = 8; cpu.ss = cpu.ds = cpu.es = 0x10; cpu.eip = 0x40;
  cpu.segmentCaches[1] = { base: 0, limit: 0xfffff, default32: true,
    present: true, code: true, readable: true, writable: false };
  for (const id of [0,2,3]) cpu.segmentCaches[id] = { base: 0, limit: 0xfffff,
    default32: true, present: true, code: false, readable: true, writable: true };
  cpu.tr = { selector: 0x18, base: 0x400, limit: 0x67, present: true, type: 11 };
  return { cpu, memory, expectedCr2: selectors.cr2 };
}

test("postcommit task selector page faults retain PF, CR2, TR, busy, and outgoing save", () => {
  for (const kind of ["ldt", "cs", "ss", "data"]) {
    const { cpu, memory, expectedCr2 } = pagingFaultFixture(kind);
    assert.throws(
      () => cpu._taskSwitch(0x20, "call", { external: true }),
      error => error?.vector === 14 && error.errorCode === 0 && error.taskCommitted,
      kind,
    );
    assert.deepEqual([cpu.cr2, cpu.cr3, cpu.tr.selector], [expectedCr2, 0x2000, 0x20]);
    assert.equal(memory.get(0x225) & 15, 11, `${kind}: incoming busy remains set`);
    assert.equal(memory.get(0x21d) & 15, 11, `${kind}: outgoing busy remains set`);
    assert.deepEqual([0x420,0x421,0x422,0x423].map(a => memory.get(a)),
      [0x40,0,0,0], `${kind}: outgoing EIP was saved before commit`);
  }
});

test("external task selector errors add EXT while page faults retain their bits", () => {
  const nullTarget = pagingFaultFixture("cs").cpu;
  assert.throws(
    () => nullTarget._taskSwitch(0, "call", { external: true }),
    error => error?.vector === 13 && error.errorCode === 1,
  );
  const absent = pagingFaultFixture("cs");
  absent.memory.set(0x225, absent.memory.get(0x225) & 0x7f);
  assert.throws(
    () => absent.cpu._taskSwitch(0x20, "call", { external: true }),
    error => error?.vector === 11 && error.errorCode === 0x21,
  );
});

test("incoming one-page TSS faults and bounded task refusals are precommit", () => {
  const missing = pagingFaultFixture("cs");
  put(missing.memory, 0x220, descriptor(0x5000, 0x67, 0x89, 0));
  dword(missing.memory, 0x3000 + 5 * 4, 0);
  assert.throws(
    () => missing.cpu._taskSwitch(0x20, "call"),
    error => error?.vector === 14 && error.errorCode === 0 && !error.taskCommitted,
  );
  assert.deepEqual([missing.cpu.cr2, missing.cpu.cr3, missing.cpu.tr.selector],
    [0x5000, 0x1000, 0x18]);
  assert.equal(missing.memory.get(0x225) & 15, 9);
  assert.deepEqual([0x420,0x421,0x422,0x423].map(a => missing.memory.get(a) ?? 0),
    [0,0,0,0]);

  for (const kind of ["vm", "debug"]) {
    const f = pagingFaultFixture("cs");
    if (kind === "vm") dword(f.memory, 0x500 + 0x24, 0x20002);
    else word(f.memory, 0x500 + 0x64, 1);
    assert.throws(() => f.cpu._taskSwitch(0x20, "call"), /outside the bounded task profile/);
    assert.deepEqual([f.cpu.cr3, f.cpu.tr.selector], [0x1000, 0x18]);
    assert.equal(f.memory.get(0x225) & 15, 9);
    assert.deepEqual([0x420,0x421,0x422,0x423].map(a => f.memory.get(a) ?? 0),
      [0,0,0,0]);
  }
});

test("386 TSS CALL changes CR3 and nested IRET restores the original mapping", () => {
  const memory = new Map();
  put(memory, 0, [0x9a, 0, 0, 0x20, 0, 0xf4]);
  put(memory, 0x100, [0xa1, 0, 0x80, 0, 0, 0xcf]);
  put(memory, 0x208, descriptor(0, 0xfffff, 0x9a));
  put(memory, 0x210, descriptor(0, 0xfffff, 0x93));
  put(memory, 0x218, descriptor(0x400, 0x67, 0x8b, 0));
  put(memory, 0x220, descriptor(0x500, 0x67, 0x89, 0));
  dword(memory, 0x500 + 0x20, 0x100);
  dword(memory, 0x500 + 0x24, 2);
  dword(memory, 0x500 + 0x1c, 0x2000);
  dword(memory, 0x400 + 0x1c, 0x1000);
  dword(memory, 0x500 + 0x38, 0x900);
  for (const [offset, selector] of [[0x48,0x10],[0x4c,8],[0x50,0x10],
    [0x54,0x10],[0x58,0],[0x5c,0],[0x60,0]]) word(memory, 0x500 + offset, selector);
  dword(memory, 0x1000, 0x3003);
  dword(memory, 0x2000, 0x4003);
  for (let page = 0; page < 16; page++) {
    dword(memory, 0x3000 + page * 4, (page << 12) | 3);
    dword(memory, 0x4000 + page * 4, (page << 12) | 3);
  }
  dword(memory, 0x3000 + 8 * 4, 0x9003);
  dword(memory, 0x4000 + 8 * 4, 0xa003);
  dword(memory, 0x9000, 0x11111111);
  dword(memory, 0xa000, 0x22222222);
  const cpu = new I80386({
    read: address => memory.get(address) ?? 0,
    fetch: address => memory.get(address) ?? 0,
    write: (address, value) => memory.set(address, value & 255),
  });
  cpu.cr0 = 0x80000001;
  cpu.cr3 = 0x1000;
  cpu.gdtr = { base: 0x200, limit: 0x27 };
  cpu.cs = 8;
  cpu.ss = cpu.ds = cpu.es = 0x10;
  cpu.segmentCaches[1] = { base: 0, limit: 0xfffff, default32: false,
    present: true, code: true, readable: true, writable: false };
  for (const id of [0, 2, 3]) cpu.segmentCaches[id] = { base: 0, limit: 0xfffff,
    default32: true, present: true, code: false, readable: true, writable: true };
  cpu.tr = { selector: 0x18, base: 0x400, limit: 0x67, present: true, type: 11 };
  cpu.eax = 0xabcdef01;
  cpu.esp = 0x800;

  cpu.step();
  assert.deepEqual([cpu.tr.selector, cpu.eip, cpu.cr3, cpu.eflags & 0x4000],
    [0x20, 0x100, 0x2000, 0x4000]);
  assert.equal(memory.get(0x20d), 0x9b, "incoming CS is marked accessed");
  assert.equal((memory.get(0x205 + 0x20) ?? 0) & 15, 11);
  assert.equal((memory.get(0x205 + 0x18) ?? 0) & 15, 11);
  assert.equal((memory.get(0x500) ?? 0) | ((memory.get(0x501) ?? 0) << 8), 0x18);

  cpu.step();
  assert.equal(cpu.eax, 0x22222222, "the incoming CR3 selects the new data mapping");
  cpu.step();
  assert.deepEqual([cpu.tr.selector, cpu.eip, cpu.eax, cpu.esp],
    [0x18, 5, 0xabcdef01, 0x800]);
  assert.equal(cpu.cr3, 0x1000);
  assert.deepEqual(
    [0x400 + 0x1c, 0x400 + 0x1d, 0x400 + 0x1e, 0x400 + 0x1f]
      .map(address => memory.get(address)),
    [0x00, 0x10, 0x00, 0x00],
    "task switches do not overwrite the static CR3 field of the outgoing TSS",
  );
  assert.equal(cpu.eflags & 0x4000, 0);
  assert.equal((memory.get(0x205 + 0x20) ?? 0) & 15, 9);
  cpu.step();
  assert.equal(cpu.halted, true);

  cpu.halted = false;
  cpu.idtr = { base: 0x600, limit: 0x7ff };
  put(memory, 0x600 + 13 * 8, [0xaa, 0xbb, 0x20, 0, 0xcc, 0x85, 0xdd, 0xee]);
  dword(memory, 0x500 + 0x20, 0x100);
  dword(memory, 0x500 + 0x24, 2);
  dword(memory, 0x500 + 0x1c, 0x2000);
  dword(memory, 0x500 + 0x38, 0x900);
  cpu._deliver(13, cpu.eip, 0x44, { fault: true });
  assert.deepEqual([cpu.tr.selector, cpu.eip, cpu.esp], [0x20, 0x100, 0x8fc]);
  assert.deepEqual([0x8fc, 0x8fd, 0x8fe, 0x8ff].map(a => memory.get(a)), [0x44, 0, 0, 0]);
  cpu.step();
  cpu.step();
  assert.deepEqual([cpu.tr.selector, cpu.eip, cpu.cr3], [0x18, 6, 0x1000]);

  put(memory, 0x300, [0x0f, 0x00, 0xf8]);
  put(memory, 0x600 + 6 * 8, [0, 0, 0x20, 0, 0, 0x85, 0, 0]);
  dword(memory, 0x500 + 0x20, 0x100);
  dword(memory, 0x500 + 0x24, 2);
  dword(memory, 0x500 + 0x1c, 0x2000);
  dword(memory, 0x500 + 0x38, 0x900);
  cpu.eip = 0x300;
  cpu.deliverFaults = true;
  cpu.step();
  assert.deepEqual([cpu.tr.selector, cpu.eip], [0x20, 0x100]);
  assert.deepEqual([0x420,0x421,0x422,0x423].map(a => memory.get(a)), [0,3,0,0]);
  assert.equal((memory.get(0x424) | memory.get(0x425)<<8 | memory.get(0x426)<<16 |
    memory.get(0x427)*0x1000000) & 0x10000, 0x10000);
  cpu.step();
  cpu.step();
  assert.deepEqual([cpu.tr.selector, cpu.eip], [0x18, 0x300]);
  cpu.deliverFaults = false;

  cpu.halted = false;
  memory.set(0x20d, 0x1a);
  assert.throws(
    () => cpu._taskSwitch(0x20, "call"),
    (error) => error?.vector === 11 && error.errorCode === 8 && error.taskCommitted,
  );
  assert.equal(cpu.tr.selector, 0x20);
  assert.equal(cpu.cr3, 0x2000);
  assert.equal(cpu.segmentCaches[1].present, false);
});
