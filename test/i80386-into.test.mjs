import assert from 'node:assert/strict';
import test from 'node:test';
import I80386, { I80386Fault } from '../src/experimental/i80386.js';

const OF = 0x0800;

function fixture(options = {}) {
  const memory = new Map();
  const cpu = new I80386({
    read: (address) => memory.get(address >>> 0) ?? 0,
    fetch: (address) => memory.get(address >>> 0) ?? 0,
    write: (address, value) => memory.set(address >>> 0, value & 0xff),
  }, options);
  const put = (address, bytes) => bytes.forEach((value, index) => {
    memory.set((address + index) >>> 0, value & 0xff);
  });
  const word = (address) => (memory.get(address) ?? 0) | ((memory.get(address + 1) ?? 0) << 8);
  const dword = (address) => (word(address) | (word(address + 2) << 16)) >>> 0;
  return { cpu, memory, put, word, dword };
}

function descriptor(base, access) {
  return [0xff, 0xff, base, base >>> 8, base >>> 16, access, 0xcf, base >>> 24]
    .map((value) => value & 0xff);
}

function gate(offset, selector, dpl = 3) {
  return [
    offset, offset >>> 8, selector, selector >>> 8, 0,
    0x80 | (dpl << 5) | 0x0f, offset >>> 16, offset >>> 24,
  ].map((value) => value & 0xff);
}

test('real-mode INTO is a next-IP trap only when OF is set', () => {
  const clear = fixture();
  clear.put(0, [0xce, 0xf4]);
  clear.cpu.eflags = 0x202;
  clear.cpu.step();
  assert.deepEqual([clear.cpu.eip, clear.cpu.esp, clear.cpu.eflags], [1, 0, 0x202]);

  const set = fixture();
  set.cpu._loadSeg(2, 0x1000);
  set.cpu.sp = 0x100;
  set.cpu.eflags = 0xa02;
  set.put(0, [0xce]);
  set.put(4 * 4, [0x00, 0x02, 0x00, 0x20]);
  set.cpu.step();
  assert.deepEqual([set.cpu.cs, set.cpu.eip, set.cpu.sp], [0x2000, 0x200, 0xfa]);
  assert.deepEqual(
    [set.word(0x100fa), set.word(0x100fc), set.word(0x100fe)],
    [1, 0, 0xa02],
  );
});

test('protected INTO uses gate DPL, preserves IF in a trap gate, and saves next EIP without RF', () => {
  const f = fixture();
  f.cpu.cr0 = 1;
  f.cpu.gdtr = { base: 0x200, limit: 0x17 };
  f.cpu.idtr = { base: 0x400, limit: 0x7ff };
  f.put(0x208, descriptor(0x100000, 0x9a));
  f.put(0x210, descriptor(0x120000, 0x92));
  f.put(0x400 + 4 * 8, gate(0x100, 8));
  f.cpu.cs = 8;
  f.cpu.ss = 0x10;
  f.cpu.segmentCaches[1] = f.cpu._descriptor(8);
  f.cpu.segmentCaches[2] = f.cpu._descriptor(0x10);
  f.cpu.esp = 0x400;
  f.cpu.eflags = 0xa02;
  f.put(0x100000, [0xce]);
  f.cpu.step();
  assert.deepEqual([f.cpu.cs, f.cpu.eip, f.cpu.esp], [8, 0x100, 0x3f4]);
  assert.equal(f.dword(0x1203f4), 1);
  assert.equal(f.dword(0x1203fc), 0xa02);
  assert.equal(f.dword(0x1203fc) & 0x10000, 0, 'INTO is a trap, not a fault');
  assert.equal(f.cpu.eflags & 0x200, 0x200, 'trap gate preserves IF');

  const denied = fixture();
  denied.cpu.cr0 = 1;
  denied.cpu.gdtr = { base: 0x200, limit: 0x1f };
  denied.cpu.idtr = { base: 0x400, limit: 0x7ff };
  denied.put(0x218, descriptor(0x100000, 0xfa));
  denied.put(0x400 + 4 * 8, gate(0x100, 0x18, 0));
  denied.cpu.cs = 0x1b;
  denied.cpu.segmentCaches[1] = denied.cpu._ringCodeDescriptor(0x1b);
  denied.cpu.eflags = OF | 2;
  denied.put(0x100000, [0xce]);
  assert.throws(
    () => denied.cpu.step(),
    (error) => error instanceof I80386Fault
      && error.vector === 13 && error.errorCode === (4 * 8 + 2),
  );
  assert.equal(denied.cpu.eip, 0);
});

test('VM86 INTO bypasses the INT-n IOPL check but still enforces software gate DPL', () => {
  const f = fixture();
  f.cpu.cr0 = 1;
  f.cpu.eflags = 0x20002;
  f.cpu.cs = 0x1234;
  f.cpu.eip = 0x10;
  f.cpu.ss = 0x2000;
  f.cpu.esp = 0x200;
  for (const [id, selector] of [[1,0x1234],[2,0x2000]]) {
    f.cpu.segmentCaches[id] = {
      base: selector << 4, limit: 0xffff, default32: false,
      present: true, code: id === 1, readable: true, writable: id !== 1,
    };
  }
  f.cpu.gdtr = { base: 0x200, limit: 0x2ff };
  f.cpu.idtr = { base: 0x300, limit: 0x7ff };
  f.cpu.tr = { selector: 0x28, base: 0x600, limit: 0x67, present: true, type: 11 };
  f.put(0x208, descriptor(0x100000, 0x9a));
  f.put(0x210, descriptor(0x120000, 0x92));
  f.put(0x604, [0, 4, 0, 0, 0x10, 0]);
  f.put(0x300 + 4 * 8, gate(0x100, 8, 3));
  f.put(0x12350, [0xce]);
  f.cpu.eflags |= OF;
  f.cpu.step();
  assert.deepEqual([f.cpu.virtual8086, f.cpu.cs, f.cpu.eip, f.cpu.esp], [false, 8, 0x100, 0x3dc]);

  const denied = fixture();
  denied.cpu.cr0 = 1;
  denied.cpu.eflags = 0x20802;
  denied.cpu.cs = 0x1234;
  denied.cpu.eip = 0x10;
  denied.cpu.segmentCaches[1] = {
    base: 0x12340, limit: 0xffff, default32: false,
    present: true, code: true, readable: true, writable: false,
  };
  denied.cpu.idtr = { base: 0x300, limit: 0x7ff };
  denied.put(0x300 + 4 * 8, gate(0x100, 8, 0));
  denied.put(0x12350, [0xce]);
  assert.throws(
    () => denied.cpu.step(),
    (error) => error?.vector === 13 && error.errorCode === (4 * 8 + 2),
  );
});
