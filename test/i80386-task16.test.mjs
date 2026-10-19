import assert from 'node:assert/strict';
import test from 'node:test';
import I80386 from '../src/experimental/i80386.js';

const put = (memory, address, bytes) => bytes.forEach((value, index) => memory.set(address + index, value & 0xff));
const word = (memory, address, value) => put(memory, address, [value, value >>> 8]);
const dword = (memory, address, value) => put(memory, address, [value, value >>> 8, value >>> 16, value >>> 24]);
function descriptor(base, limit, access, flags = 0) {
  return [limit, limit >>> 8, base, base >>> 8, base >>> 16, access,
    flags | ((limit >>> 16) & 15), base >>> 24].map(value => value & 0xff);
}

function fixture(bus = {}) {
  const memory = new Map();
  const cpu = new I80386({
    ...bus,
    read: address => memory.get(address) ?? 0,
    fetch: address => memory.get(address) ?? 0,
    write: (address, value) => memory.set(address, value & 0xff),
  });
  put(memory, 0x208, descriptor(0, 0xffff, 0x9a));
  put(memory, 0x210, descriptor(0, 0xffff, 0x92));
  put(memory, 0x218, descriptor(0x400, 0x2b, 0x83));
  put(memory, 0x220, descriptor(0x500, 0x2b, 0x81));
  put(memory, 0, [0x9a, 0, 0, 0x20, 0, 0xf4]);
  put(memory, 0x100, [0xcf]);
  for (const [offset, value] of [
    [0x0e,0x100],[0x10,2],[0x12,0x1111],[0x14,0x2222],[0x16,0x3333],
    [0x18,0x4444],[0x1a,0x900],[0x1c,0x5555],[0x1e,0x6666],[0x20,0x7777],
    [0x22,0x10],[0x24,8],[0x26,0x10],[0x28,0x10],[0x2a,0],
  ]) word(memory, 0x500 + offset, value);
  cpu.cr0 = 1;
  cpu.gdtr = { base: 0x200, limit: 0x27 };
  cpu.cs = 8; cpu.ss = cpu.ds = cpu.es = 0x10; cpu.esp = 0x800;
  cpu.segmentCaches[1] = cpu._descriptor(8);
  for (const id of [0,2,3]) cpu.segmentCaches[id] = cpu._descriptor(0x10);
  cpu.tr = { selector: 0x18, base: 0x400, limit: 0x2b, present: true, type: 3 };
  cpu.cr3 = 0x12345000;
  cpu.eax = 0xaaaa1234;
  return { cpu, memory };
}

const bytes = (memory, address, length) =>
  Array.from({ length }, (_, index) => memory.get(address + index) ?? 0);

function assertOnlyRangeChanged(before, after, first, last) {
  for (let index = 0; index < before.length; index++) {
    if (index < first || index > last)
      assert.equal(after[index], before[index], `unexpected TSS write at ${index.toString(16)}`);
  }
}

function storeExpected(target, offset, width, value) {
  for (let index = 0; index < width; index++) target[offset + index] = value >>> (index * 8) & 0xff;
}

test('286 TSS CALL and nested IRET save and restore the 16-bit task images', () => {
  const { cpu, memory } = fixture();
  cpu.step();
  assert.deepEqual(
    [cpu.tr.selector, cpu.tr.type, cpu.eip, cpu.esp, cpu.eax, cpu.fs, cpu.gs, cpu.cr3],
    [0x20, 3, 0x100, 0x900, 0x1111, 0, 0, 0x12345000],
  );
  assert.equal((memory.get(0x500) ?? 0) | ((memory.get(0x501) ?? 0) << 8), 0x18);
  assert.equal(memory.get(0x225) & 15, 3);
  assert.equal((memory.get(0x40e) ?? 0) | ((memory.get(0x40f) ?? 0) << 8), 5);
  assert.equal((memory.get(0x412) ?? 0) | ((memory.get(0x413) ?? 0) << 8), 0x1234);

  cpu.step();
  assert.deepEqual([cpu.tr.selector, cpu.eip, cpu.esp, cpu.eax], [0x18, 5, 0x800, 0x1234]);
  assert.equal(memory.get(0x225) & 15, 1);
  cpu.step();
  assert.equal(cpu.halted, true);
});

test('an IDT task gate enters a 286 TSS and pushes a word error code', () => {
  const { cpu, memory } = fixture();
  cpu.idtr = { base: 0x600, limit: 0x7ff };
  put(memory, 0x600 + 13 * 8, [0xaa, 0xbb, 0x20, 0, 0xcc, 0x85, 0xdd, 0xee]);

  cpu._deliver(13, 0x55, 0x1234, { fault: true });

  assert.deepEqual(
    [cpu.tr.selector, cpu.tr.type, cpu.cs, cpu.eip, cpu.esp, cpu.cr3],
    [0x20, 3, 8, 0x100, 0x8fe, 0x12345000],
  );
  assert.deepEqual([memory.get(0x8fe), memory.get(0x8ff)], [0x34, 0x12]);
  assert.equal(memory.get(0x225) & 15, 3);
});

test('286 current TSS supplies ring-zero SP and SS for an inner interrupt', () => {
  const { cpu, memory } = fixture();
  word(memory, 0x402, 0x700);
  word(memory, 0x404, 0x10);
  cpu.idtr = { base: 0x600, limit: 0x7ff };
  put(memory, 0x218, descriptor(0x400, 0x2b, 0x83));
  put(memory, 0x228, descriptor(0, 0xffff, 0xfa));
  put(memory, 0x230, descriptor(0, 0xffff, 0xf2));
  cpu.gdtr.limit = 0x37;
  put(memory, 0x600 + 0x20 * 8, [0,1,8,0,0,0xee,0,0]);
  cpu.cs = 0x2b; cpu.ss = 0x33; cpu.esp = 0x900;
  cpu.segmentCaches[1] = cpu._ringCodeDescriptor(0x2b);
  cpu.segmentCaches[2] = cpu._ringStackDescriptor(0x33, 3, { returnPath: true });
  put(memory, 0, [0xcd, 0x20]);
  cpu.step();
  assert.deepEqual([cpu.cs, cpu.ss, cpu.eip, cpu.esp], [8, 0x10, 0x100, 0x6ec]);
});

test('short and busy 286 TSS targets fault before task state mutation', () => {
  for (const [limit, access] of [[0x2a, 0x81], [0x2b, 0x83]]) {
    const { cpu, memory } = fixture();
    put(memory, 0x220, descriptor(0x500, limit, access));
    const before = cpu._snapshotInstruction();
    assert.throws(
      () => cpu.step(),
      (error) => error?.vector === (access === 0x83 ? 13 : 10)
        && error.errorCode === 0x20,
    );
    assert.deepEqual(cpu._snapshotInstruction(), before);
    assert.equal(memory.get(0x225), access);
  }
});

test('mixed 386-to-286 CALL preserves CR3 and returns through the 386 image', () => {
  const { cpu, memory } = fixture();
  put(memory, 0x218, descriptor(0x400, 0x67, 0x8b));
  put(memory, 0x228, descriptor(0x700, 0xff, 0x82));
  cpu.gdtr.limit = 0x2f;
  cpu.tr = { selector: 0x18, base: 0x400, limit: 0x67, present: true, type: 11 };
  for (let offset = 0; offset <= 0x67; offset++) memory.set(0x400 + offset, 0xa5);
  word(memory, 0x400, 0xbeef);
  dword(memory, 0x400 + 0x1c, 0x12345000);
  word(memory, 0x400 + 0x60, 0x28);
  word(memory, 0x400 + 0x64, 0);
  cpu.eax = 0x89abcdef;
  cpu.ecx = 0x76543210;
  const before = bytes(memory, 0x400, 0x68);
  const expected = before.slice();
  for (const [offset, value] of [
    [0x20,5],[0x24,cpu.eflags],[0x28,cpu.eax],[0x2c,cpu.ecx],
    [0x30,cpu.edx],[0x34,cpu.ebx],[0x38,cpu.esp],[0x3c,cpu.ebp],
    [0x40,cpu.esi],[0x44,cpu.edi],
  ]) storeExpected(expected, offset, 4, value);
  for (const [offset, value] of [
    [0x48,cpu.es],[0x4c,cpu.cs],[0x50,cpu.ss],[0x54,cpu.ds],
    [0x58,cpu.fs],[0x5c,cpu.gs],
  ]) storeExpected(expected, offset, 2, value);

  cpu.step();
  assert.deepEqual([cpu.tr.selector, cpu.tr.type, cpu.cr3], [0x20, 3, 0x12345000]);
  const saved = bytes(memory, 0x400, 0x68);
  assert.deepEqual(saved, expected, 'the outgoing 386 image has the exact save footprint');
  assertOnlyRangeChanged(before, saved, 0x20, 0x5d);
  assert.deepEqual(saved.slice(0, 2), [0xef, 0xbe], 'backlink is static');
  assert.deepEqual(saved.slice(0x1c, 0x20), [0x00,0x50,0x34,0x12], 'CR3 is static');
  assert.deepEqual(saved.slice(0x20, 0x24), [5,0,0,0]);
  assert.deepEqual(saved.slice(0x28, 0x30), [0xef,0xcd,0xab,0x89,0x10,0x32,0x54,0x76]);
  assert.deepEqual(saved.slice(0x60, 0x62), [0x28,0], 'LDT is static');
  cpu.step();
  assert.deepEqual([cpu.tr.selector, cpu.tr.type, cpu.eip, cpu.cr3, cpu.eax, cpu.ecx],
    [0x18, 11, 5, 0x12345000, 0x89abcdef, 0x76543210]);
});

test('mixed 286-to-386 CALL changes CR3 and a 286 return leaves it selected', () => {
  const { cpu, memory } = fixture();
  put(memory, 0x228, descriptor(0x700, 0xff, 0x82));
  cpu.gdtr.limit = 0x2f;
  for (let offset = 0; offset <= 0x2b; offset++) memory.set(0x400 + offset, 0xa5);
  word(memory, 0x400, 0xbeef);
  word(memory, 0x402, 0x1111);
  word(memory, 0x404, 0x2222);
  word(memory, 0x400 + 0x2a, 0x28);
  for (let offset = 0x2c; offset < 0x34; offset++) memory.set(0x400 + offset, 0x5a);
  cpu.eax = 0x89abcdef;
  cpu.ecx = 0x76543210;
  const before = bytes(memory, 0x400, 0x34);
  const expected = before.slice();
  for (const [offset, value] of [
    [0x0e,5],[0x10,cpu.eflags],[0x12,cpu.eax],[0x14,cpu.ecx],
    [0x16,cpu.edx],[0x18,cpu.ebx],[0x1a,cpu.esp],[0x1c,cpu.ebp],
    [0x1e,cpu.esi],[0x20,cpu.edi],[0x22,cpu.es],[0x24,cpu.cs],
    [0x26,cpu.ss],[0x28,cpu.ds],
  ]) storeExpected(expected, offset, 2, value);
  put(memory, 0x220, descriptor(0x500, 0x67, 0x89));
  dword(memory, 0x500 + 0x1c, 0x56789000);
  dword(memory, 0x500 + 0x20, 0x100);
  dword(memory, 0x500 + 0x24, 2);
  for (const [offset, value] of [
    [0x28,0x1111],[0x2c,0x2222],[0x30,0x3333],[0x34,0x4444],
    [0x38,0x900],[0x3c,0x5555],[0x40,0x6666],[0x44,0x7777],
  ]) dword(memory, 0x500 + offset, value);
  for (const [offset, value] of [
    [0x48,0x10],[0x4c,8],[0x50,0x10],[0x54,0x10],[0x58,0],[0x5c,0],[0x60,0],
  ]) word(memory, 0x500 + offset, value);

  cpu.step();
  assert.deepEqual([cpu.tr.selector, cpu.tr.type, cpu.cr3], [0x20, 11, 0x56789000]);
  const saved = bytes(memory, 0x400, 0x34);
  assert.deepEqual(saved, expected, 'the outgoing 286 image has the exact save footprint');
  assertOnlyRangeChanged(before, saved, 0x0e, 0x29);
  assert.deepEqual(saved.slice(0, 6), [0xef,0xbe,0x11,0x11,0x22,0x22],
    'backlink and privilege-stack words are static');
  assert.deepEqual(saved.slice(0x0e, 0x12), [5,0,2,0]);
  assert.deepEqual(saved.slice(0x12, 0x16), [0xef,0xcd,0x10,0x32],
    'only low general-register words are saved');
  assert.deepEqual(saved.slice(0x2a, 0x2c), [0x28,0], 'LDT is static');
  assert.deepEqual(saved.slice(0x2c, 0x34), Array(8).fill(0x5a),
    'bytes beyond the 286 TSS image are untouched');
  cpu.step();
  assert.deepEqual([cpu.tr.selector, cpu.tr.type, cpu.eip, cpu.cr3, cpu.eax, cpu.ecx],
    [0x18, 3, 5, 0x56789000, 0xcdef, 0x3210]);
});

test('IOPL-denied IN with a current 286 TSS faults before the port callback', () => {
  let reads = 0;
  const { cpu, memory } = fixture({ inPort: () => { reads++; return 0x5a; } });
  put(memory, 0, [0xe4, 0x80]);
  cpu.cs = 3;
  cpu.eflags = 2;
  assert.throws(
    () => cpu.step(),
    error => error?.vector === 13 && error.errorCode === 0,
  );
  assert.equal(reads, 0);
  assert.equal(cpu.eip, 0);
});

test('286 TSS JMP clears the outgoing busy bit without writing a backlink', () => {
  const { cpu, memory } = fixture();
  word(memory, 0x500, 0xbeef);
  cpu._taskSwitch(0x20, 'jmp', { saveEip: 0x77 });
  assert.deepEqual([cpu.tr.selector, cpu.tr.type, cpu.eip], [0x20, 3, 0x100]);
  assert.equal(memory.get(0x21d) & 15, 1);
  assert.equal(memory.get(0x225) & 15, 3);
  assert.equal((memory.get(0x500) ?? 0) | ((memory.get(0x501) ?? 0) << 8), 0xbeef);
  assert.equal((memory.get(0x40e) ?? 0) | ((memory.get(0x40f) ?? 0) << 8), 0x77);
});
