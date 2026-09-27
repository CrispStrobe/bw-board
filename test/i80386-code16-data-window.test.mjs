import test from 'node:test';
import assert from 'node:assert/strict';
import {ExperimentalI80386ATMachine, PCAT80386_EXPERIMENTAL_4M} from
  '../src/experimental/i80386-at-machine.js';
import {prevalidateI80386Code16Window as admitCode} from
  '../src/experimental/i80386-code16-window.js';
import {prevalidateI80386Code16DataWindow as admit,
  isI80386Code16DataWindowValid as valid} from
  '../src/experimental/i80386-code16-data-window.js';

const DS = 3;
function board() { return new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M); }
function setup(machine, base = 0x20000) {
  const cpu = machine.cpu;
  cpu.cs = 0x1000;
  cpu.ds = 0x2000;
  cpu.segmentCaches[1] = {base: 0x10000, limit: 0xffff, default32: false,
    present: true, code: true, readable: true, writable: false};
  cpu.segmentCaches[DS] = {base, limit: 0xffff, default32: false,
    present: true, code: false, readable: true, writable: true};
  machine.mem[0x10010] = 0x90;
  const code = admitCode(machine, 0x10, 1);
  assert.ok(code);
  return code;
}
function put32(machine, address, value) {
  for (let i = 0; i < 4; i++) machine._write386(address + i, value >>> (i * 8));
}
function map(machine, linear, physical, flags = 7) {
  machine.cpu.cr3 = 0x1000;
  put32(machine, 0x1000 + ((linear >>> 20) & 0xffc), 0x4000 | flags);
  const pte = 0x4000 + ((linear >>> 10) & 0xffc);
  put32(machine, pte, physical | flags);
  return pte;
}
function freshCode(machine) {
  if (machine.cpu.cr0 & 0x80000000) machine.cpu._translate(0x10010);
  const code = admitCode(machine, 0x10, 1);
  assert.ok(code, 'current mode has an admitted code byte');
  return code;
}
function expectRead(machine, code, offset, width) {
  const cpu = machine.cpu;
  const proof = admit(machine, code, DS, offset, width, 'read');
  assert.ok(proof, 'read admitted');
  assert.equal(valid(proof), true);
  let direct = 0;
  for (let i = 0; i < width; i++)
    direct += machine.mem[proof.physicalAddresses[i]] * 2 ** (8 * i);
  assert.equal(direct >>> 0, cpu._read(DS, offset, width * 8));
  return proof;
}
function expectWrite(machine, code, offset, width, value) {
  const cpu = machine.cpu;
  const proof = admit(machine, code, DS, offset, width, 'write');
  assert.ok(proof, 'write admitted');
  assert.equal(valid(proof), true);
  cpu._write(DS, offset, width * 8, value);
  for (let i = 0; i < width; i++)
    assert.equal(machine.mem[proof.physicalAddresses[i]], (value >>> (8 * i)) & 255);
  assert.equal(valid(proof), true, 'ordinary data mutation does not stale mapping proof');
  return proof;
}

test('real, protected16, and VM86 RAM reads/writes follow the interpreter', () => {
  for (const mode of ['real', 'protected16', 'vm86']) {
    const machine = board(), cpu = machine.cpu;
    setup(machine);
    if (mode !== 'real') cpu.cr0 = 1;
    if (mode === 'vm86') cpu.eflags |= 0x20000;
    const code = freshCode(machine);
    machine.mem.set([0x12, 0x34, 0x56, 0x78], 0x20020);
    expectRead(machine, code, 0x20, 1);
    expectRead(machine, code, 0x20, 2);
    expectRead(machine, code, 0x20, 4);
    expectWrite(machine, code, 0x20, 4, 0xa1b2c3d4);
  }
});

test('page crossing uses both cached mappings and preserves physical byte order', () => {
  const machine = board(), cpu = machine.cpu;
  setup(machine, 0x20f00);
  cpu.cr0 = 0x80000001;
  map(machine, 0x20000, 0x120000);
  map(machine, 0x21000, 0x130000);
  map(machine, 0x10000, 0x10000);
  const code = freshCode(machine);
  machine.mem.set([0x11, 0x22], 0x120ffe);
  machine.mem.set([0x33, 0x44], 0x130000);
  assert.equal(admit(machine, code, DS, 0xfe, 4, 'read'), null,
    'uncached crossing refused');
  cpu._translate(0x20ffe, {write: true});
  assert.equal(admit(machine, code, DS, 0xfe, 4, 'write'), null,
    'second page must also be cached');
  cpu._translate(0x21000, {write: true});
  const read = expectRead(machine, code, 0xfe, 4);
  assert.deepEqual(read.physicalAddresses, [0x120ffe, 0x120fff, 0x130000, 0x130001]);
  expectWrite(machine, code, 0xfe, 4, 0x88776655);
  cpu.invalidateTranslationCache();
  assert.equal(valid(read), false);
});

test('a second-page write fault leaves the first physical byte untouched', () => {
  const machine = board(), cpu = machine.cpu;
  setup(machine, 0x20fff);
  cpu.cr0 = 0x80000001;
  map(machine, 0x20000, 0x120000);
  map(machine, 0x10000, 0x10000);
  const code = freshCode(machine);
  cpu._translate(0x20fff, {write: true});
  machine.mem[0x120fff] = 0x5a;
  const before = [machine.mem[0x120fff], cpu.cr2,
    machine.mem[0x4000 + ((0x21000 >>> 10) & 0xffc)]];
  assert.equal(admit(machine, code, DS, 0, 2, 'write'), null);
  assert.deepEqual([machine.mem[0x120fff], cpu.cr2,
    machine.mem[0x4000 + ((0x21000 >>> 10) & 0xffc)]], before,
  'admission changed neither data nor fault state nor PTE');
  assert.throws(() => cpu._write(DS, 0, 16, 0xbeef), {vector: 14});
  assert.equal(machine.mem[0x120fff], 0x5a,
    'interpreter translates second byte before either store');
});

test('A20 decode, ROM reads, and ROM writes match bus behavior', () => {
  const machine = board(), cpu = machine.cpu;
  setup(machine, 0x120000);
  machine._a20Enabled = false;
  const code = freshCode(machine);
  machine.mem[0x20020] = 0x5a;
  machine.mem[0x120020] = 0xa5;
  const aliased = expectRead(machine, code, 0x20, 1);
  assert.deepEqual(aliased.physicalAddresses, [0x20020]);
  assert.equal(admit(machine, code, DS, 0x20, 1, 'write'), null,
    'A20-gated writes would omit board TLB invalidation');
  cpu._write(DS, 0x20, 8, 0x68);
  assert.equal(machine.mem[0x20020], 0x68);
  assert.equal(machine.mem[0x120020], 0xa5);
  machine._a20Enabled = true;
  assert.equal(valid(aliased), false);
  const enabledCode = freshCode(machine);
  expectRead(machine, enabledCode, 0x20, 1);
  cpu.segmentCaches[DS].base = 0xf0000;
  machine.loadRom(Uint8Array.of(0x12, 0x34), 0xf0020);
  expectRead(machine, enabledCode, 0x20, 2);
  assert.equal(admit(machine, enabledCode, DS, 0x20, 2, 'write'), null);
  const before = machine.mem[0xf0020];
  cpu._write(DS, 0x20, 8, 0xff);
  assert.equal(machine.mem[0xf0020], before, 'ordinary ROM write is swallowed');
});

test('segment access and fault boundaries are refused', () => {
  const machine = board(), cpu = machine.cpu;
  const code = setup(machine);
  const cache = cpu.segmentCaches[DS];
  cache.limit = 0x20;
  assert.equal(admit(machine, code, DS, 0x20, 2, 'read'), null);
  assert.ok(admit(machine, code, DS, 0x20, 1, 'read'));
  cache.limit = 0xffff;
  cache.expandDown = true;
  cache.limit = 0x100;
  assert.equal(admit(machine, code, DS, 0x100, 1, 'read'), null);
  assert.ok(admit(machine, code, DS, 0x101, 1, 'read'));
  cache.expandDown = false;
  cache.limit = 0xffff;
  cache.null = true;
  assert.equal(admit(machine, code, DS, 0, 1, 'read'), null);
  cache.null = false;
  cache.present = false;
  assert.equal(admit(machine, code, DS, 0, 1, 'read'), null);
  cache.present = true;
  cpu.cr0 = 1;
  const protectedCode = freshCode(machine);
  cache.writable = false;
  assert.equal(admit(machine, protectedCode, DS, 0, 1, 'write'), null);
  assert.ok(admit(machine, protectedCode, DS, 0, 1, 'read'));
  cache.code = true;
  cache.readable = false;
  assert.equal(admit(machine, protectedCode, DS, 0, 1, 'read'), null);
});

test('paging permissions, dirty bits, code overlap, and page tables block writes', () => {
  const machine = board(), cpu = machine.cpu;
  setup(machine, 0x20000);
  cpu.cr0 = 0x80000001;
  const pte = map(machine, 0x20000, 0x120000, 3);
  map(machine, 0x10000, 0x10000);
  map(machine, 0x4000, 0x4000);
  cpu._translate(0x20020);
  const code = freshCode(machine);
  assert.ok(admit(machine, code, DS, 0x20, 1, 'read'));
  assert.equal(admit(machine, code, DS, 0x20, 1, 'write'), null, 'clean PTE refused');
  assert.equal(machine.mem[pte] & 0x40, 0, 'admission did not set dirty');
  cpu._translate(0x20020, {write: true});
  expectWrite(machine, code, 0x20, 1, 0x7b);
  cpu.cs = 0x1003;
  assert.equal(admit(machine, code, DS, 0x20, 1, 'read'), null,
    'code proof invalidated by CS change');
  cpu.cs = 0x1000;
  cpu.eflags |= 0x20000;
  assert.equal(admit(machine, code, DS, 0x20, 1, 'read'), null,
    'VM86 needs user page');
  cpu.eflags &= ~0x20000;
  cpu.segmentCaches[DS].base = 0x10000;
  cpu._translate(0x10010, {write: true});
  assert.equal(admit(machine, code, DS, 0x10, 1, 'write'), null,
    'captured code byte refused');
  cpu.segmentCaches[DS].base = 0x4000;
  cpu._translate(0x4000, {write: true});
  assert.ok(admit(machine, code, DS, 0, 1, 'read'),
    'page-table page is otherwise readable mapped RAM');
  assert.equal(admit(machine, code, DS, 0, 1, 'write'), null,
    'page-table page refused');
});

test('user read-only pages and device/open-bus regions are refused safely', () => {
  const machine = board(), cpu = machine.cpu;
  const code = setup(machine);
  cpu.cr0 = 0x80000001;
  map(machine, 0x20000, 0x120000, 5);
  map(machine, 0x10000, 0x10000);
  cpu._translate(0x20020, {write: true});
  const supervisorCode = freshCode(machine);
  assert.ok(admit(machine, supervisorCode, DS, 0x20, 1, 'write'),
    'interpreter permits a dirty supervisor write on a read-only PTE');
  cpu.cs = 0x1003;
  const userCode = freshCode(machine);
  assert.ok(admit(machine, userCode, DS, 0x20, 1, 'read'));
  assert.equal(admit(machine, userCode, DS, 0x20, 1, 'write'), null);
  cpu.cr0 = 0;
  cpu.cs = 0x1000;
  for (const physical of [0x9fc00, 0xa0000, 0xbffff, 0xc0000, 0xfee00000,
    0xfec00000, 0xffff0000]) {
    cpu.segmentCaches[DS].base = physical;
    assert.equal(admit(machine, code, DS, 0, 1, 'read'), null,
      `device/open-bus read at ${physical.toString(16)}`);
    assert.equal(admit(machine, code, DS, 0, 1, 'write'), null,
      `device/open-bus write at ${physical.toString(16)}`);
  }
});

test('admission and validation do not touch the bus, CPU, or page-table bits', () => {
  const machine = board(), cpu = machine.cpu, code = setup(machine);
  const original = [machine._read386, machine._write386, cpu._translate];
  machine._read386 = () => { throw new Error('bus read'); };
  machine._write386 = () => { throw new Error('bus write'); };
  cpu._translate = () => { throw new Error('page walk'); };
  try {
    const before = [cpu.cr2, cpu.eip, cpu._translationGeneration,
      machine.mem[0x20020]];
    const proof = admit(machine, code, DS, 0x20, 1, 'write');
    assert.ok(proof);
    assert.equal(valid(proof), true);
    machine._page[0x20000 >>> 12] = 3;
    assert.equal(valid(proof), false);
    assert.equal(admit(machine, code, DS, 0x20, 1, 'write'), null);
    assert.deepEqual([cpu.cr2, cpu.eip, cpu._translationGeneration,
      machine.mem[0x20020]], before);
  } finally {
    [machine._read386, machine._write386, cpu._translate] = original;
  }
});
