import test from 'node:test';
import assert from 'node:assert/strict';
import {ExperimentalI80386ATMachine, PCAT80386_EXPERIMENTAL_4M} from
  '../src/experimental/i80386-at-machine.js';
import {prevalidateI80386Code16Window as admit,
  isI80386Code16WindowValid as valid} from
  '../src/experimental/i80386-code16-window.js';

function board() { return new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M); }
function code(cpu, base, limit = 0xffff) {
  cpu.cs = 0x1000;
  cpu.segmentCaches[1] = {base, limit, default32: false, present: true,
    code: true, readable: false, writable: false};
}
function sameAsFetch(machine, offset, length) {
  const cpu = machine.cpu;
  const window = admit(machine, offset, length);
  assert.ok(window, 'code span admitted');
  assert.equal(valid(window), true);
  cpu.eip = offset;
  cpu._instructionBytes = 0;
  const fetched = Array.from({length}, () => cpu._fetch8());
  assert.deepEqual(window.bytes, fetched);
  assert.equal(cpu.eip, offset + length);
  return window;
}
function put32(machine, address, value) {
  for (let i = 0; i < 4; i++) machine._write386(address + i, value >>> (i * 8));
}
function page(machine, linear, physical, user = true) {
  const cpu = machine.cpu;
  cpu.cr3 = 0x1000;
  const pde = 0x1000 + ((linear >>> 20) & 0xffc);
  const table = 0x4000;
  put32(machine, pde, table | (user ? 7 : 3));
  const pte = table + ((linear >>> 10) & 0xffc);
  put32(machine, pte, physical | (user ? 7 : 3));
  return {pde, pte};
}

test('real-mode RAM and ROM windows match bytewise fetch, including A20 alias', () => {
  const machine = board(), cpu = machine.cpu;
  code(cpu, 0x20000);
  machine.mem.set([0x90, 0x66, 0x89, 0xd8], 0x20020);
  sameAsFetch(machine, 0x20, 4);
  code(cpu, 0xf0000);
  machine.loadRom(Uint8Array.of(0xea, 0x12, 0x34), 0xf0020);
  assert.equal(machine._page[0xf0000 >>> 12], 2);
  const rom = sameAsFetch(machine, 0x20, 3);
  machine.loadRom(Uint8Array.of(0x90), 0xf0021);
  assert.equal(valid(rom), false, 'host ROM reload invalidates captured bytes');
  code(cpu, 0x120000);
  machine._a20Enabled = false;
  machine.mem.set([0x31, 0xc0, 0x90], 0x20020);
  machine.mem.set([0xcc, 0xcc, 0xcc], 0x120020);
  code(cpu, 0x20000);
  assert.equal(sameAsFetch(machine, 0x20, 3).physicalAddress, 0x20020,
    'A20-off address below 1 MiB stays put');
  code(cpu, 0x120000);
  const aliased = sameAsFetch(machine, 0x20, 3);
  assert.equal(aliased.physicalAddress, 0x20020);
  machine._a20Enabled = true;
  assert.equal(valid(aliased), false);
  sameAsFetch(machine, 0x20, 3);
});

test('protected 16-bit CPL0/CPL3 and paged VM86 windows match ordinary fetch', () => {
  const machine = board(), cpu = machine.cpu;
  code(cpu, 0x30000, 0x1ffff);
  cpu.cr0 = 1;
  machine.mem.set([0x8b, 0x46, 0xfe], 0x40020);
  sameAsFetch(machine, 0x10020, 3); // EIP is not forced to 16 bits.
  cpu.cs = 0x1003;
  sameAsFetch(machine, 0x10020, 3);
  const linear = 0x28040, physical = 0x121000;
  code(cpu, 0x28000);
  cpu.cs = 0x2803;
  cpu.cr0 = 0x80000001;
  page(machine, linear, physical, true);
  machine.mem.set([0xf3, 0xa4, 0x90], physical + 0x40);
  const oldEip = cpu.eip, oldCr2 = cpu.cr2, oldGeneration = cpu._translationGeneration;
  assert.equal(admit(machine, 0x40, 3), null, 'uncached page refused');
  assert.deepEqual([cpu.eip, cpu.cr2, cpu._translationGeneration],
    [oldEip, oldCr2, oldGeneration]);
  assert.equal(machine.mem[0x4000 + ((linear >>> 10) & 0xffc) + 0] & 0x20, 0,
    'admission did not set PTE accessed');
  assert.equal(cpu._translate(linear), physical + 0x40);
  sameAsFetch(machine, 0x40, 3);
  cpu.eflags |= 0x20000;
  code(cpu, 0x28000);
  cpu.cs = 0x2803;
  sameAsFetch(machine, 0x40, 3);
  cpu.eflags &= ~0x20000;
});

test('uncertain mappings and fetch boundaries are refused without side effects', () => {
  const machine = board(), cpu = machine.cpu;
  code(cpu, 0x20000, 0x23);
  assert.equal(admit(machine, 0x22, 3), null, 'CS limit');
  assert.ok(admit(machine, 0x22, 2));
  code(cpu, 0x20000);
  assert.equal(admit(machine, 0xfef, 18), null, 'linear page boundary');
  assert.ok(admit(machine, 0xfef, 17));
  code(cpu, 0xa0000);
  assert.equal(admit(machine, 0, 1), null, 'VGA aperture');
  code(cpu, 0x9fc00);
  assert.equal(admit(machine, 0, 1), null, 'MP override aperture');
  code(cpu, 0xc0000);
  assert.equal(admit(machine, 0, 1), null, 'open bus page');
  code(cpu, 0xffff0000);
  assert.equal(admit(machine, 0xfff0, 1), null, 'reset ROM alias');
  code(cpu, 0x20000);
  cpu.segmentCaches[1].present = false;
  assert.equal(admit(machine, 0, 1), null, 'nonpresent CS');
  cpu.segmentCaches[1].present = true;
  cpu.segmentCaches[1].default32 = true;
  assert.equal(admit(machine, 0, 1), null, '32-bit CS');
  cpu.segmentCaches[1].default32 = false;
  cpu.segmentCaches[1].code = false;
  assert.equal(admit(machine, 0, 1), null, 'non-code CS');
});

test('page permissions, TLB identity, A20 and byte mutation invalidate admission', () => {
  const machine = board(), cpu = machine.cpu;
  code(cpu, 0x30000);
  cpu.cr0 = 0x80000001;
  const linear = 0x30020, physical = 0x122000;
  const {pte} = page(machine, linear, physical, false);
  cpu._translate(linear); // Supervisor mapping is legal for CPL0.
  machine.mem.set([0x90, 0x40, 0x90], physical + 0x20);
  const supervisor = sameAsFetch(machine, 0x20, 3);
  cpu.cs = 0x1003;
  assert.equal(valid(supervisor), false);
  assert.equal(admit(machine, 0x20, 3), null, 'CPL3 refuses supervisor page');
  cpu.eflags |= 0x20000;
  assert.equal(admit(machine, 0x20, 3), null, 'VM86 refuses supervisor page');
  cpu.eflags &= ~0x20000;
  cpu.cs = 0x1000;
  put32(machine, pte, physical | 7);
  assert.equal(valid(supervisor), false, 'page-table write invalidates old TLB');
  assert.equal(admit(machine, 0x20, 3), null, 'uncached remap refused');
  cpu._translate(linear);
  const window = sameAsFetch(machine, 0x20, 3);
  machine.mem[physical + 0x21] ^= 0xff;
  assert.equal(valid(window), false, 'raw host write caught by byte guard');
  machine.mem[physical + 0x21] ^= 0xff;
  assert.equal(valid(window), true);
  cpu.cr3 = 0x2000;
  assert.equal(valid(window), false, 'CR3 change');
  cpu.cr3 = 0x1000;
  assert.equal(valid(window), true);
  cpu.invalidateTranslationCache();
  assert.equal(valid(window), false, 'TLB generation change');
});

test('admission/validation never access the bus and reject altered map or CS', () => {
  const machine = board(), cpu = machine.cpu;
  code(cpu, 0x22000);
  machine.mem.set([0x90, 0x90], 0x22010);
  const oldRead = machine._read386, oldWrite = machine._write386;
  machine._read386 = () => { throw new Error('unexpected bus read'); };
  machine._write386 = () => { throw new Error('unexpected bus write'); };
  try {
    const window = admit(machine, 0x10, 2);
    assert.ok(window);
    assert.equal(valid(window), true);
    cpu.eip = 0x11;
    assert.equal(valid(window), true, 'runner must check starting EIP separately');
    machine._page[0x22000 >>> 12] = 3;
    assert.equal(valid(window), false, 'slow map kind');
    assert.equal(admit(machine, 0x10, 2), null);
    machine._page[0x22000 >>> 12] = 1;
    cpu.segmentCaches[1].limit = 0x10;
    assert.equal(valid(window), false, 'mutated CS limit');
    cpu.segmentCaches[1].limit = 0xffff;
    assert.equal(valid(window), true);
    cpu.segmentCaches[1].code = false;
    assert.equal(valid(window), false, 'mutated CS type');
  } finally {
    machine._read386 = oldRead;
    machine._write386 = oldWrite;
  }
});
