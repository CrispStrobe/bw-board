import assert from 'node:assert/strict';
import test from 'node:test';
import I80386 from '../src/experimental/i80386.js';

const put = (memory, address, values) => values.forEach((value, index) => memory.set(address + index, value & 0xff));
const word = (memory, address, value) => put(memory, address, [value, value >>> 8]);
const dword = (memory, address, value) => put(memory, address, [value, value >>> 8, value >>> 16, value >>> 24]);
const descriptor = (base, limit, access, flags = 0x40) => [
  limit, limit >>> 8, base, base >>> 8, base >>> 16, access,
  flags | (limit >>> 16 & 15), base >>> 24,
].map(value => value & 0xff);

function task(memory, base, { cr3, eip, eflags, esp, es, cs, ss, ds, fs, gs }) {
  for (const [offset, value] of [
    [0x1c,cr3],[0x20,eip],[0x24,eflags],[0x28,0x11111111],
    [0x2c,0x22222222],[0x30,0x33333333],[0x34,0x44444444],
    [0x38,esp],[0x3c,0x55555555],[0x40,0x66666666],[0x44,0x77777777],
  ]) dword(memory, base + offset, value);
  for (const [offset, value] of [
    [0x48,es],[0x4c,cs],[0x50,ss],[0x54,ds],[0x58,fs],[0x5c,gs],[0x60,0],
  ]) word(memory, base + offset, value);
}

function fixture() {
  const memory = new Map();
  put(memory, 0, [0x9a,0,0,0x20,0,0xf4]);
  put(memory, 0x100, [0xcf]);
  put(memory, 0x208, descriptor(0, 0xffff, 0x9a, 0));
  put(memory, 0x210, descriptor(0, 0xffff, 0x92, 0));
  put(memory, 0x218, descriptor(0x400, 0x67, 0x8b, 0));
  put(memory, 0x220, descriptor(0x500, 0x67, 0x89, 0));
  put(memory, 0x228, descriptor(0x700, 0x67, 0x89, 0));
  task(memory, 0x500, {
    cr3: 0x2000, eip: 0, eflags: 0x20202, esp: 0x800,
    es: 0x100, cs: 0x100, ss: 0x200, ds: 0x300, fs: 0x400, gs: 0x500,
  });
  task(memory, 0x700, {
    cr3: 0x2000, eip: 0x100, eflags: 2, esp: 0x900,
    es: 0x10, cs: 8, ss: 0x10, ds: 0x10, fs: 0, gs: 0,
  });
  dword(memory, 0x400 + 0x1c, 0x1000);
  for (const [directory, table] of [[0x1000,0x3000],[0x2000,0x4000]]) {
    dword(memory, directory, table | 7);
    for (let page = 0; page < 16; page++) dword(memory, table + page * 4, page * 0x1000 | 7);
  }
  dword(memory, 0x4000 + 4, 0x6007);
  put(memory, 0x6000, [0xb8,0x34,0x12]);
  const cpu = new I80386({
    read: address => memory.get(address) ?? 0,
    fetch: address => memory.get(address) ?? 0,
    write: (address, value) => memory.set(address, value & 0xff),
  });
  cpu.cr0 = 0x80000001;
  cpu.cr3 = 0x1000;
  cpu.gdtr = { base: 0x200, limit: 0x2f };
  cpu.idtr = { base: 0x800, limit: 0x7ff };
  cpu.cs = 8; cpu.ss = cpu.ds = cpu.es = 0x10; cpu.esp = 0x800;
  cpu.segmentCaches[1] = cpu._descriptor(8);
  for (const id of [0,2,3]) cpu.segmentCaches[id] = cpu._descriptor(0x10);
  cpu.tr = { selector: 0x18, base: 0x400, limit: 0x67, present: true, type: 11 };
  return { cpu, memory };
}

test('32-bit TSS CALL enters VM86 with user paging and all six real caches', () => {
  const { cpu } = fixture();
  cpu.step();
  assert.deepEqual([cpu.tr.selector, cpu.cr3, cpu.virtual8086, cpu.currentPrivilegeLevel],
    [0x20, 0x2000, true, 3]);
  assert.equal(cpu.eflags & 0x4000, 0x4000);
  assert.deepEqual([cpu.es,cpu.cs,cpu.ss,cpu.ds,cpu.fs,cpu.gs],
    [0x100,0x100,0x200,0x300,0x400,0x500]);
  assert.deepEqual([0,1,2,3,4,5].map(id => cpu.segmentCaches[id].base),
    [0x1000,0x1000,0x2000,0x3000,0x4000,0x5000]);
  cpu.step();
  assert.deepEqual([cpu.eip, cpu.eax & 0xffff], [3, 0x1234],
    'VM fetch used the incoming user page mapping');
});

test('far JMP into a VM86 task retains the EIP loaded from its TSS', () => {
  const { cpu, memory } = fixture();
  memory.set(0, 0xea);
  dword(memory, 0x500 + 0x20, 0x123);
  cpu.step();
  assert.deepEqual([cpu.tr.selector, cpu.virtual8086, cpu.cs, cpu.eip],
    [0x20, true, 0x100, 0x123]);
});

test('VM86 task EIP overflow faults after the task and real caches commit', () => {
  const { cpu, memory } = fixture();
  dword(memory, 0x500 + 0x20, 0x10000);
  assert.throws(
    () => cpu.step(),
    error => error?.vector === 13 && error.errorCode === 0 && error.taskCommitted,
  );
  assert.deepEqual([cpu.tr.selector, cpu.cr3, cpu.virtual8086, cpu.cs],
    [0x20, 0x2000, true, 0x100]);
  assert.equal(memory.get(0x225) & 15, 11);
});

test('VM86 task LDTR faults occur after CR3, busy, and TR commit', () => {
  const invalid = fixture();
  word(invalid.memory, 0x500 + 0x60, 0x30);
  assert.throws(
    () => invalid.cpu.step(),
    error => error?.vector === 10 && error.errorCode === 0x30 && error.taskCommitted,
  );
  assert.deepEqual([invalid.cpu.tr.selector, invalid.cpu.cr3, invalid.memory.get(0x225) & 15],
    [0x20, 0x2000, 11]);

  const paged = fixture();
  paged.cpu.gdtr.limit = 0x100f;
  word(paged.memory, 0x500 + 0x60, 0x1008);
  dword(paged.memory, 0x4000 + 4, 0);
  assert.throws(
    () => paged.cpu.step(),
    error => error?.vector === 14 && error.errorCode === 0 && error.taskCommitted,
  );
  assert.deepEqual([paged.cpu.cr2, paged.cpu.tr.selector, paged.cpu.cr3],
    [0x1208, 0x20, 0x2000]);
});

test('VM86 task debug-trap refusal remains precommit', () => {
  const { cpu, memory } = fixture();
  word(memory, 0x500 + 0x64, 1);
  const before = cpu._snapshotInstruction();
  assert.throws(() => cpu.step(), /debug-trap task entry is outside the bounded task profile/);
  assert.deepEqual(cpu._snapshotInstruction(), before);
  assert.equal(memory.get(0x225) & 15, 9);
});

test('an IDT task gate leaves VM86 and protected NT IRET returns to its saved VM task', () => {
  const { cpu, memory } = fixture();
  cpu.step();
  cpu.halted = false;
  put(memory, 0x800 + 0x20 * 8, [0xaa,0xbb,0x28,0,0xcc,0x85,0xdd,0xee]);
  cpu._deliver(0x20, cpu.eip, null, { external: true });
  assert.deepEqual([cpu.tr.selector, cpu.virtual8086, cpu.cs, cpu.eip, cpu.cr3],
    [0x28, false, 8, 0x100, 0x2000]);
  assert.equal(cpu.eflags & 0x4000, 0x4000);
  cpu.step();
  assert.deepEqual([cpu.tr.selector, cpu.virtual8086, cpu.cs, cpu.eip, cpu.cr3],
    [0x20, true, 0x100, 0, 0x2000]);
  assert.deepEqual([0,1,2,3,4,5].map(id => cpu.segmentCaches[id].base),
    [0x1000,0x1000,0x2000,0x3000,0x4000,0x5000]);
});
