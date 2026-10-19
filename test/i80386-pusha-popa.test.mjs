import test from "node:test";
import assert from "node:assert/strict";
import I80386 from "../src/experimental/i80386.js";

function fixture(bytes = []) {
  const memory = new Map(bytes.map((value, index) => [index, value]));
  const writes = [];
  const cpu = new I80386({
    read: (address) => memory.get(address >>> 0) ?? 0,
    fetch: (address) => memory.get(address >>> 0) ?? 0,
    write(address, value) {
      writes.push([address >>> 0, value & 0xff]);
      memory.set(address >>> 0, value & 0xff);
    },
  });
  return { cpu, memory, writes };
}

function read(memory, address, bytes) {
  let value = 0;
  for (let i = 0; i < bytes; i++) value += (memory.get(address + i) ?? 0) * 2 ** (8 * i);
  return value >>> 0;
}

test("PUSHA stores the original stack pointer in architectural register order", () => {
  const f = fixture([0x60, 0x66, 0x60]);
  Object.assign(f.cpu, {
    eax: 0x1111aaaa,
    ecx: 0x2222bbbb,
    edx: 0x3333cccc,
    ebx: 0x4444dddd,
    esp: 0x12340200,
    ebp: 0x5555eeee,
    esi: 0x6666ffff,
    edi: 0x77778888,
  });
  f.cpu.step();
  assert.equal(f.cpu.esp, 0x123401f0);
  assert.deepEqual(
    Array.from({ length: 8 }, (_, i) => read(f.memory, 0x1f0 + i * 2, 2)),
    [0x8888, 0xffff, 0xeeee, 0x0200, 0xdddd, 0xcccc, 0xbbbb, 0xaaaa],
  );
  f.cpu.esp = 0x12340280;
  f.cpu.step();
  assert.equal(f.cpu.esp, 0x12340260);
  assert.deepEqual(
    Array.from({ length: 8 }, (_, i) => read(f.memory, 0x260 + i * 4, 4)),
    [0x77778888, 0x6666ffff, 0x5555eeee, 0x12340280, 0x4444dddd, 0x3333cccc, 0x2222bbbb, 0x1111aaaa],
  );
});

test("POPA skips its saved stack slot and respects operand size independently of SS.B", () => {
  const f = fixture([0x61, 0x66, 0x61]);
  f.cpu.segmentCaches[2].default32 = true;
  f.cpu.esp = 0x100;
  const words = [7, 6, 5, 0xdead, 3, 2, 1, 0];
  words.forEach((value, index) => {
    f.memory.set(0x100 + index * 2, value);
    f.memory.set(0x101 + index * 2, 0);
  });
  f.cpu.step();
  assert.deepEqual(
    [f.cpu.di, f.cpu.si, f.cpu.bp, f.cpu.bx, f.cpu.dx, f.cpu.cx, f.cpu.ax, f.cpu.esp],
    [7, 6, 5, 3, 2, 1, 0, 0x110],
  );
  f.cpu.esp = 0x180;
  [17, 16, 15, 0xfeedface, 13, 12, 11, 10].forEach((value, index) => {
    for (let byte = 0; byte < 4; byte++)
      f.memory.set(0x180 + index * 4 + byte, (value >>> (byte * 8)) & 0xff);
  });
  f.cpu.step();
  assert.deepEqual(
    [f.cpu.edi, f.cpu.esi, f.cpu.ebp, f.cpu.ebx, f.cpu.edx, f.cpu.ecx, f.cpu.eax, f.cpu.esp],
    [17, 16, 15, 13, 12, 11, 10, 0x1a0],
  );
});

test("PUSHA and POPA admit the full stack span before visible effects", () => {
  const push = fixture([0x60]);
  push.cpu.cr0 = 1;
  push.cpu.sp = 0x0f;
  assert.throws(() => push.cpu.step(), (error) => error?.vector === 12);
  assert.equal(push.cpu.sp, 0x0f);
  assert.deepEqual(push.writes, []);

  const pop = fixture([0x61]);
  pop.cpu.cr0 = 1;
  pop.cpu.sp = 0x100;
  pop.cpu.segmentCaches[2].limit = 0x10e;
  pop.cpu.eax = 0xaaaaaaaa;
  assert.throws(() => pop.cpu.step(), (error) => error?.vector === 12);
  assert.deepEqual([pop.cpu.eax, pop.cpu.sp], [0xaaaaaaaa, 0x100]);
});

test("invalid register FF far forms raise #UD before protected far-transfer refusal", () => {
  for (const modrm of [0xd8, 0xe8]) {
    const { cpu } = fixture([0xff, modrm]);
    cpu.cr0 = 1;
    assert.throws(
      () => cpu.step(),
      (error) => error?.vector === 6 && error.errorCode === null,
    );
  }
});

test("real-mode PUSHA applies the documented shutdown and #GP boundaries", () => {
  for (const sp of [1, 3, 5]) {
    const { cpu } = fixture([0x60]);
    cpu.sp = sp;
    cpu.step();
    assert.equal(cpu.shutdown, true);
    assert.equal(cpu.sp, sp);
  }
  for (const sp of [7, 9, 11, 13, 15]) {
    const { cpu } = fixture([0x60]);
    cpu.sp = sp;
    assert.throws(
      () => cpu.step(),
      (error) => error?.vector === 13 && error.errorCode === 0,
    );
    assert.equal(cpu.sp, sp);
  }
  const pushad = fixture([0x66, 0x60]);
  pushad.cpu.esp = 0x10021;
  pushad.cpu.step();
  assert.equal(pushad.cpu.shutdown, false);
});
