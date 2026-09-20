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

function fixture() {
  const memory = new Map();
  const cpu = new I80386({
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
  cpu.tr = { selector: 0x18, base: 0x400, limit: 0x67, present: true, type: 11 };
  dword(memory, 0x400 + 0x1c, 0x12345000);

  cpu.step();
  assert.deepEqual([cpu.tr.selector, cpu.tr.type, cpu.cr3], [0x20, 3, 0x12345000]);
  assert.equal((memory.get(0x420) ?? 0) | ((memory.get(0x421) ?? 0) << 8), 5);
  cpu.step();
  assert.deepEqual([cpu.tr.selector, cpu.tr.type, cpu.eip, cpu.cr3], [0x18, 11, 5, 0x12345000]);
});

test('mixed 286-to-386 CALL changes CR3 and a 286 return leaves it selected', () => {
  const { cpu, memory } = fixture();
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
  cpu.step();
  assert.deepEqual([cpu.tr.selector, cpu.tr.type, cpu.eip, cpu.cr3], [0x18, 3, 5, 0x56789000]);
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
