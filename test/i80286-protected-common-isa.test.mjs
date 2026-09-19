import test from "node:test";
import assert from "node:assert/strict";
import ProtectedI80286, {
  ProtectedModeFault,
  SEG_DS,
  SEG_ES,
  SEG_SS,
} from "../src/experimental/i80286-protected.js";
function fixture(program, bus = {}) {
  const mem = new Map(),
    reads = [],
    writes = [],
    ports = [];
  const cpu = new ProtectedI80286({
    read: (a) => {
      reads.push(a);
      return mem.get(a) ?? 0;
    },
    fetch: (a) => mem.get(a) ?? 0,
    write: (a, v) => {
      writes.push([a, v & 255]);
      mem.set(a, v & 255);
    },
    in: bus.in,
    out: (p, v) => {
      ports.push([p, v]);
      bus.out?.(p, v);
    },
  });
  const put = (a, b) => b.forEach((v, i) => mem.set(a + i, v));
  const desc = (a, b, l, x) =>
    put(a, [
      l & 255,
      l >> 8,
      b & 255,
      (b >> 8) & 255,
      (b >> 16) & 255,
      x,
      0,
      0,
    ]);
  put(0, [0x0f, 1, 0x16, 0, 1, 0xb8, 1, 0, 0x0f, 1, 0xf0, 0xea, 0, 0, 8, 0]);
  put(0x100, [0x27, 0, 0, 2, 0]);
  desc(0x208, 0x100000, 0xffff, 0x9a);
  desc(0x210, 0x120000, 0xffff, 0x92);
  desc(0x218, 0x130000, 0xffff, 0x92);
  desc(0x220, 0x140000, 0xffff, 0x92);
  put(0x100000, [
    0xb8,
    0x10,
    0,
    0x8e,
    0xd8,
    0xb8,
    0x18,
    0,
    0x8e,
    0xd0,
    0xbc,
    0,
    2,
    ...program,
  ]);
  cpu.cs = 0;
  cpu.ip = 0;
  for (let i = 0; i < 9; i++) cpu.step();
  return { cpu, mem, reads, writes, ports, put, desc };
}

test("MUL IMUL DIV and IDIV execute while divide errors restart all state", () => {
  const f = fixture([0xf7, 0xe3, 0x6b, 0xcb, 0xfe, 0xf7, 0xf3]);
  f.cpu.ax = 300;
  f.cpu.bx = 10;
  f.cpu.step();
  assert.deepEqual([f.cpu.dx, f.cpu.ax], [0, 3000]);
  f.cpu.step();
  assert.equal(f.cpu.cx, 0xffec);
  f.cpu.dx = 1;
  f.cpu.ax = 0;
  f.cpu.bx = 1;
  const state = f.cpu.getProtectedState();
  assert.throws(
    () => f.cpu.step(),
    (e) =>
      e instanceof ProtectedModeFault &&
      e.vector === 0 &&
      e.restartIp === state.ip,
  );
  assert.deepEqual(f.cpu.getProtectedState(), state);
});

test("signed divide accepts negative endpoints and rejects overflow before register commit", () => {
  const ok = fixture([0xf6, 0xfb]);
  ok.cpu.ax = 0xff80;
  ok.cpu.bl = 1;
  ok.cpu.step();
  assert.equal(ok.cpu.al, 0x80);
  assert.equal(ok.cpu.ah, 0);
  const bad = fixture([0xf6, 0xfb]);
  bad.cpu.ax = 0x8000;
  bad.cpu.bl = 0xff;
  const state = bad.cpu.getProtectedState();
  assert.throws(
    () => bad.cpu.step(),
    (e) => e instanceof ProtectedModeFault && e.vector === 0,
  );
  assert.deepEqual(bad.cpu.getProtectedState(), state);
});

test("PUSHA and POPA preflight complete frames and preserve original SP slot", () => {
  const f = fixture([0x60, 0xb8, 0, 0, 0xbb, 0, 0, 0x61]);
  Object.assign(f.cpu, { ax: 1, cx: 2, dx: 3, bx: 4, bp: 5, si: 6, di: 7 });
  f.cpu.step();
  assert.equal(f.cpu.sp, 0x1f0);
  f.cpu.step();
  f.cpu.step();
  f.cpu.step();
  assert.deepEqual(
    [
      f.cpu.ax,
      f.cpu.cx,
      f.cpu.dx,
      f.cpu.bx,
      f.cpu.sp,
      f.cpu.bp,
      f.cpu.si,
      f.cpu.di,
    ],
    [1, 2, 3, 4, 0x200, 5, 6, 7],
  );
  const bad = fixture([0x60]);
  bad.cpu.sp = 8;
  bad.cpu.segmentCaches[SEG_SS].limit = 0x20;
  const state = bad.cpu.getProtectedState(),
    writes = bad.writes.length;
  assert.throws(
    () => bad.cpu.step(),
    (e) => e instanceof ProtectedModeFault && e.vector === 12,
  );
  assert.deepEqual(bad.cpu.getProtectedState(), state);
  assert.equal(bad.writes.length, writes);
});

test("ENTER and LEAVE build and discard a nested display transactionally", () => {
  const f = fixture([0xc8, 4, 0, 2, 0xc9]);
  f.cpu.bp = 0x180;
  f.mem.set(0x13017e, 0x34);
  f.mem.set(0x13017f, 0x12);
  f.cpu.step();
  assert.deepEqual([f.cpu.bp, f.cpu.sp], [0x1fe, 0x1f6]);
  assert.equal(f.mem.get(0x1301fc) | (f.mem.get(0x1301fd) << 8), 0x1234);
  f.cpu.step();
  assert.deepEqual([f.cpu.bp, f.cpu.sp], [0x180, 0x200]);
});

test("LDS and LES validate full pointers before committing register or cache state", () => {
  const f = fixture([0xc5, 0x06, 0, 0x20, 0xc4, 0x1e, 4, 0x20]);
  f.put(0x122000, [0x78, 0x56, 0x20, 0, 0x34, 0x12, 0x20, 0]);
  f.cpu.step();
  assert.equal(f.cpu.ax, 0x5678);
  assert.equal(f.cpu.segmentCaches[SEG_DS].base, 0x140000);
  f.cpu.ds = 0x10;
  f.cpu.segmentCaches[SEG_DS] = {
    ...f.cpu.segmentCaches[SEG_ES],
    selector: 0x10,
    base: 0x120000,
  };
  f.cpu.step();
  assert.equal(f.cpu.bx, 0x1234);
  assert.equal(f.cpu.es, 0x20);
});

test("REP INS and OUTS preflight memory before port side effects and honor IOPL", () => {
  let inputs = 0;
  const f = fixture([0xf3, 0x6c, 0xf3, 0x6e], { in: () => ++inputs });
  f.cpu._sregSet(0, 0x20);
  Object.assign(f.cpu, { cx: 2, dx: 0x20, di: 0x10 });
  f.cpu.step();
  f.cpu.step();
  assert.deepEqual(
    [f.mem.get(0x140010), f.mem.get(0x140011), f.cpu.cx],
    [1, 2, 0],
  );
  f.cpu.cx = 1;
  f.cpu.si = 0x20;
  f.mem.set(0x120020, 0x77);
  f.cpu.step();
  assert.deepEqual(f.ports, [[0x20, 0x77]]);
  const denied = fixture([0x6c], {
    in: () => {
      throw new Error("port touched");
    },
  });
  denied.cpu.cpl = 3;
  denied.cpu.flags &= ~0x3000;
  assert.throws(
    () => denied.cpu.step(),
    (e) => e instanceof ProtectedModeFault && e.vector === 13,
  );
});

test("BOUND, XLAT, BCD adjusts, and descriptor queries cover success and failure flags", () => {
  const f = fixture([
    0x62, 0x06, 0, 0x20, 0xd7, 0x27, 0x37, 0x0f, 2, 0xd8, 0x0f, 3, 0xc8, 0x0f,
    0, 0xe0, 0x0f, 0, 0xe8,
  ]);
  f.put(0x122000, [0xfb, 0xff, 5, 0]);
  f.cpu.ax = 3;
  f.cpu.step();
  f.cpu.bx = 0x30;
  f.cpu.al = 2;
  f.mem.set(0x120032, 0x9a);
  f.cpu.step();
  assert.equal(f.cpu.al, 0x9a);
  f.cpu.step();
  f.cpu.step();
  f.cpu.ax = 0x10;
  f.cpu.step();
  assert.ok(f.cpu.flags & 0x40);
  assert.equal(f.cpu.bx, 0x9300);
  f.cpu.ax = 0x10;
  f.cpu.step();
  assert.equal(f.cpu.cx, 0xffff);
  f.cpu.ax = 0x10;
  f.cpu.step();
  assert.ok(f.cpu.flags & 0x40);
  f.cpu.ax = 8;
  f.cpu.step();
  assert.ok(!(f.cpu.flags & 0x40));
});

test("ARPL raises a destination RPL and reports whether it changed", () => {
  const f = fixture([0x63, 0xd8, 0x63, 0xd8]);
  f.cpu.ax = 0x10;
  f.cpu.bx = 3;
  f.cpu.step();
  assert.equal(f.cpu.ax, 0x13);
  assert.ok(f.cpu.flags & 0x40);
  f.cpu.step();
  assert.equal(f.cpu.ax, 0x13);
  assert.ok(!(f.cpu.flags & 0x40));
});

test("faulting ENTER and INS perform no partial stack, memory, or port effects", () => {
  const enter = fixture([0xc8, 0x40, 0, 2]);
  enter.cpu.sp = 0x30;
  enter.cpu.bp = 0x20;
  enter.cpu.segmentCaches[SEG_SS].limit = 0x30;
  const state = enter.cpu.getProtectedState(),
    writes = enter.writes.length;
  assert.throws(
    () => enter.cpu.step(),
    (e) => e instanceof ProtectedModeFault && e.vector === 12,
  );
  assert.deepEqual(enter.cpu.getProtectedState(), state);
  assert.equal(enter.writes.length, writes);
  let ports = 0;
  const ins = fixture([0x6d], {
    in: () => {
      ports++;
      return 1;
    },
  });
  ins.cpu._sregSet(0, 0x20);
  ins.cpu.di = 0xffff;
  assert.throws(
    () => ins.cpu.step(),
    (e) => e instanceof ProtectedModeFault && e.vector === 13,
  );
  assert.equal(ports, 0);
});

test("word IDIV preserves signed endpoints and dividend-signed remainders", () => {
  const endpoint = fixture([0xf7, 0xfb]);
  Object.assign(endpoint.cpu, { dx: 0xffff, ax: 0x8000, bx: 1 });
  endpoint.cpu.step();
  assert.deepEqual([endpoint.cpu.ax, endpoint.cpu.dx], [0x8000, 0]);
  const remainder = fixture([0xf7, 0xfb]);
  Object.assign(remainder.cpu, { dx: 0xffff, ax: 0xfff9, bx: 3 });
  remainder.cpu.step();
  assert.deepEqual([remainder.cpu.ax, remainder.cpu.dx], [0xfffe, 0xffff]);
});

test("faulting LDS and invalid F6 /1 touch no data operand or architectural state", () => {
  const lds = fixture([0xc5, 0x06, 0xff, 0xff]);
  lds.cpu.segmentCaches[SEG_DS].limit = 0xffff;
  const before = lds.cpu.getProtectedState(),
    reads = lds.reads.length;
  assert.throws(
    () => lds.cpu.step(),
    (e) => e instanceof ProtectedModeFault && e.vector === 13,
  );
  assert.deepEqual(lds.cpu.getProtectedState(), before);
  assert.equal(lds.reads.length, reads);
  const invalid = fixture([0xf7, 0x0e, 0, 0x20]);
  invalid.mem.set(0x122000, 1);
  const invalidReads = invalid.reads.length;
  assert.throws(
    () => invalid.cpu.step(),
    (e) => e instanceof ProtectedModeFault && e.vector === 6,
  );
  assert.ok(!invalid.reads.slice(invalidReads).includes(0x122000));
});

test("REP INS later fault preserves one completed iteration without extra port input", () => {
  let inputs = 0;
  const f = fixture([0xf3, 0x6c], { in: () => ++inputs });
  f.cpu._sregSet(0, 0x20);
  f.cpu.segmentCaches[SEG_ES].limit = 0x10;
  Object.assign(f.cpu, { di: 0x10, cx: 2 });
  const prefix = f.cpu.ip;
  f.cpu.step();
  assert.deepEqual(
    [f.cpu.ip, f.cpu.di, f.cpu.cx, inputs, f.mem.get(0x140010)],
    [prefix, 0x11, 1, 1, 1],
  );
  const state = f.cpu.getProtectedState();
  assert.throws(
    () => f.cpu.step(),
    (e) =>
      e instanceof ProtectedModeFault &&
      e.vector === 13 &&
      e.restartIp === prefix,
  );
  assert.deepEqual(f.cpu.getProtectedState(), state);
  assert.equal(inputs, 1);
});

test("BOUND accepts negative bounds and #BR restarts an out-of-range value", () => {
  const f = fixture([0x62, 0x06, 0, 0x20, 0x62, 0x06, 0, 0x20]);
  f.put(0x122000, [0xfb, 0xff, 0xff, 0xff]);
  f.cpu.ax = 0xfffd;
  f.cpu.step();
  f.cpu.ax = 0;
  const state = f.cpu.getProtectedState();
  assert.throws(
    () => f.cpu.step(),
    (e) => e instanceof ProtectedModeFault && e.vector === 5,
  );
  assert.deepEqual(f.cpu.getProtectedState(), state);
});

test("LAR admits call/task gates while LSL and verification reject them by ZF", () => {
  const f = fixture([0x0f, 2, 0xd8, 0x0f, 3, 0xc8, 0x0f, 0, 0xe0]);
  f.desc(0x220, 0, 0, 0x84);
  f.cpu.ax = 0x20;
  f.cpu.step();
  assert.equal(f.cpu.bx, 0x8400);
  assert.ok(f.cpu.flags & 0x40);
  f.cpu.ax = 0x20;
  f.cpu.step();
  assert.ok(!(f.cpu.flags & 0x40));
  f.cpu.ax = 0x20;
  f.cpu.step();
  assert.ok(!(f.cpu.flags & 0x40));
});
