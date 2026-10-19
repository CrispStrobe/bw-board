import test from "node:test";
import assert from "node:assert/strict";
import I80386, { I80386Fault } from "../src/experimental/i80386.js";
const descriptor = (base, access, limit = 0xfffff, flags = 0xc0) =>
  [
    limit,
    limit >>> 8,
    base,
    base >>> 8,
    base >>> 16,
    access,
    flags | ((limit >>> 16) & 15),
    base >>> 24,
  ].map((v) => v & 255);
const gate = (offset, selector, type = 14, dpl = 3) =>
  [
    offset,
    offset >>> 8,
    selector,
    selector >>> 8,
    0,
    0x80 | (dpl << 5) | type,
    offset >>> 16,
    offset >>> 24,
  ].map((v) => v & 255);
function fixture() {
  const memory = new Map(),
    cpu = new I80386(
      {
        read: (a) => memory.get(a >>> 0) ?? 0,
        fetch: (a) => memory.get(a >>> 0) ?? 0,
        write: (a, v) => memory.set(a >>> 0, v & 255),
      },
      { deliverFaults: true },
    );
  const put = (a, b) => b.forEach((v, i) => memory.set(a + i, v));
  const dword = (a) =>
    ((memory.get(a) ?? 0) |
      ((memory.get(a + 1) ?? 0) << 8) |
      ((memory.get(a + 2) ?? 0) << 16) |
      ((memory.get(a + 3) ?? 0) * 0x1000000)) >>>
    0;
  cpu.cr0 = 1;
  cpu.gdtr = { base: 0x200, limit: 0x37 };
  cpu.idtr = { base: 0x400, limit: 0x7ff };
  put(0x208, descriptor(0x100000, 0x9e));
  put(0x210, descriptor(0x120000, 0x92));
  put(0x218, descriptor(0x140000, 0xfa));
  put(0x220, descriptor(0x160000, 0xf2));
  return { cpu, memory, put, dword };
}
function ring3(f) {
  f.cpu.cs = 0x1b;
  f.cpu.ss = 0x23;
  f.cpu.esp = 0x800;
  f.cpu.segmentCaches[1] = f.cpu._ringCodeDescriptor(0x1b);
  f.cpu.segmentCaches[2] = f.cpu._ringStackDescriptor(0x23, 3, {
    returnPath: true,
  });
}

test("conforming interrupt target retains CPL and the current stack", () => {
  const f = fixture();
  ring3(f);
  f.put(0x400 + 0x20 * 8, gate(0x100, 8));
  f.put(0x140000, [0xcd, 0x20]);
  f.put(0x100100, [0xcf]);
  f.cpu.step();
  assert.deepEqual(
    [f.cpu.cs, f.cpu.eip, f.cpu.ss, f.cpu.esp],
    [0x0b, 0x100, 0x23, 0x7f4],
  );
  assert.deepEqual(
    [f.dword(0x1607f4), f.dword(0x1607f8), f.dword(0x1607fc)],
    [2, 0x1b, 2],
  );
  f.cpu.step();
  assert.deepEqual(
    [f.cpu.cs, f.cpu.eip, f.cpu.ss, f.cpu.esp],
    [0x1b, 2, 0x23, 0x800],
  );
});

test("direct and call-gate conforming calls retain CPL without a TSS stack switch", () => {
  const direct = fixture();
  ring3(direct);
  direct.put(0x140000, [0x9a, 0x00, 0x01, 0, 0, 0x08, 0]);
  direct.put(0x100100, [0xcb]);
  direct.cpu.step();
  assert.deepEqual([direct.cpu.cs, direct.cpu.esp], [0x0b, 0x7f8]);
  direct.cpu.step();
  assert.deepEqual(
    [direct.cpu.cs, direct.cpu.eip, direct.cpu.esp],
    [0x1b, 7, 0x800],
  );
  const gated = fixture();
  ring3(gated);
  gated.put(0x228, gate(0x100, 8, 12, 3));
  gated.put(0x140000, [0x9a, 0, 0, 0, 0, 0x2b, 0]);
  gated.cpu.step();
  assert.deepEqual(
    [gated.cpu.cs, gated.cpu.eip, gated.cpu.ss, gated.cpu.esp],
    [0x0b, 0x100, 0x23, 0x7f8],
  );
});

test("IRET and RETF apply their distinct conforming outer-return privilege rules", () => {
  const iret = fixture();
  iret.put(0x208, descriptor(0x100000, 0xbe));
  iret.cpu.cs = 8;
  iret.cpu.ss = 0x10;
  iret.cpu.esp = 0x300;
  iret.cpu.segmentCaches[1] = iret.cpu._ringCodeDescriptor(8);
  iret.cpu.segmentCaches[2] = iret.cpu._ringStackDescriptor(0x10, 0, {
    returnPath: true,
  });
  iret.put(0x100000, [0xcf]);
  iret.put(
    0x120300,
    [1, 0, 0, 0, 0x0b, 0, 0, 0, 2, 0, 0, 0, 0, 8, 0, 0, 0x23, 0, 0, 0],
  );
  iret.cpu.step();
  assert.deepEqual(
    [iret.cpu.cs, iret.cpu.eip, iret.cpu.ss, iret.cpu.esp],
    [0x0b, 1, 0x23, 0x800],
  );
  const bad = fixture();
  bad.cpu.cs = 8;
  bad.cpu.ss = 0x10;
  bad.cpu.esp = 0x300;
  bad.cpu.segmentCaches[1] = bad.cpu._ringCodeDescriptor(8);
  bad.cpu.segmentCaches[2] = bad.cpu._ringStackDescriptor(0x10, 0, {
    returnPath: true,
  });
  bad.put(0x100000, [0xcf]);
  bad.put(
    0x120300,
    [1, 0, 0, 0, 0x0b, 0, 0, 0, 2, 0, 0, 0, 0, 8, 0, 0, 0x23, 0, 0, 0],
  );
  assert.throws(
    () => bad.cpu._iret(32),
    (e) => e instanceof I80386Fault && e.vector === 13 && e.errorCode === 8,
  );
  const ret = fixture();
  ret.cpu.cs = 8;
  ret.cpu.ss = 0x10;
  ret.cpu.esp = 0x300;
  ret.cpu.segmentCaches[1] = ret.cpu._ringCodeDescriptor(8);
  ret.cpu.segmentCaches[2] = ret.cpu._ringStackDescriptor(0x10, 0, {
    returnPath: true,
  });
  ret.put(0x120300, [1, 0, 0, 0, 0x0b, 0, 0, 0, 0, 8, 0, 0, 0x23, 0, 0, 0]);
  ret.cpu._protectedFarReturn(32, 0);
  assert.deepEqual(
    [ret.cpu.cs, ret.cpu.eip, ret.cpu.ss, ret.cpu.esp],
    [0x0b, 1, 0x23, 0x800],
  );
});
