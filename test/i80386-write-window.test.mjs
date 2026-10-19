import test from 'node:test';
import assert from 'node:assert/strict';
import {ExperimentalI80386ATMachine,
  PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP} from
  '../src/experimental/i80386-at-machine.js';
import {prevalidateI80386WriteWindow, isI80386WriteWindowValid} from
  '../src/experimental/i80386-write-window.js';

const CODE = 0x80120000, DATA = 0x80130000;
const CODE_PHYS = 0x120000, DATA_PHYS = 0x130000;
const DATA_PTE = 0x4000 + 0x130 * 4;

function fixture({dirty = true} = {}) {
  const machine = new ExperimentalI80386ATMachine(
    PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP);
  const put32 = (address, value) => {
    for (let i = 0; i < 4; i++)
      machine._write386(address + i, (value >>> (8 * i)) & 255);
  };
  put32(0x1800, 0x4007);
  put32(0x4000 + 0x120 * 4, CODE_PHYS | 7);
  put32(DATA_PTE, DATA_PHYS | 7);
  machine._write386(CODE_PHYS, 0xab); // STOSD
  const cpu = machine.cpu;
  cpu.segmentCaches[1] = {base:0, limit:0xffffffff, default32:true,
    present:true, code:true, readable:true, writable:false};
  cpu.segmentCaches[0] = {base:0, limit:0xffffffff, default32:true,
    present:true, code:false, readable:true, writable:true};
  cpu.cr0 = 0x80000001;
  cpu.cr3 = 0x1000;
  cpu.eip = CODE;
  cpu.edi = DATA + 0x28;
  cpu.eax = 0x12345678;
  cpu._translate(CODE);
  cpu._translate(cpu.edi, dirty ? {write:true} : undefined);
  return {machine, cpu, put32};
}

test('write admission is side-effect-free and matches an ordinary STOSD store', () => {
  const fast = fixture(), ordinary = fixture();
  const {machine, cpu} = fast;
  const before = {
    generation:cpu._translationGeneration, cr2:cpu.cr2,
    pte:Array.from(machine.mem.subarray(DATA_PTE, DATA_PTE + 4)),
    bytes:Array.from(machine.mem.subarray(DATA_PHYS + 0x28, DATA_PHYS + 0x2c)),
  };
  const window = prevalidateI80386WriteWindow(machine, cpu.edi);
  assert.equal(window?.lo, DATA_PHYS);
  assert.equal(window?.hi, DATA_PHYS + 4096);
  assert.equal(window?.delta, 0x80000000);
  assert.equal(isI80386WriteWindowValid(window), true);
  assert.deepEqual({generation:cpu._translationGeneration, cr2:cpu.cr2,
    pte:Array.from(machine.mem.subarray(DATA_PTE, DATA_PTE + 4)),
    bytes:Array.from(machine.mem.subarray(DATA_PHYS + 0x28, DATA_PHYS + 0x2c))}, before);

  // Simulate only the RAM effect a future native writer would perform.
  const physical = (cpu.edi + window.delta) >>> 0;
  machine.mem.set(Uint8Array.of(0x78, 0x56, 0x34, 0x12), physical);
  ordinary.machine.step();
  assert.deepEqual(Array.from(machine.mem.subarray(DATA_PHYS + 0x28, DATA_PHYS + 0x2c)),
    Array.from(ordinary.machine.mem.subarray(DATA_PHYS + 0x28, DATA_PHYS + 0x2c)));
  assert.deepEqual(Array.from(machine.mem.subarray(DATA_PTE, DATA_PTE + 4)),
    Array.from(ordinary.machine.mem.subarray(DATA_PTE, DATA_PTE + 4)));
});

test('uncached, clean, and read-only translations cannot enter a write window', () => {
  const {machine, cpu} = fixture({dirty:false});
  assert.equal(prevalidateI80386WriteWindow(machine, DATA + 0x28), null);
  assert.equal(cpu._translations[(DATA >>> 12) & 511].dirty, false);
  cpu._translate(DATA + 0x28, {write:true});
  const window = prevalidateI80386WriteWindow(machine, DATA + 0x28);
  assert.ok(window);
  cpu._translations[(DATA >>> 12) & 511].writable = false;
  assert.equal(isI80386WriteWindowValid(window), false);
  assert.equal(prevalidateI80386WriteWindow(machine, DATA + 0x28), null);
  cpu._translations[(DATA >>> 12) & 511].writable = true;
  cpu.segmentCaches[0].writable = false;
  assert.equal(isI80386WriteWindowValid(window), false);
  assert.equal(prevalidateI80386WriteWindow(machine, DATA + 0x28), null);
  cpu.segmentCaches[0].writable = true;
  cpu.invalidateTranslationCache();
  assert.equal(prevalidateI80386WriteWindow(machine, DATA + 0x28), null);
});

test('page-table edits, code aliases, and page-table targets revoke admission', () => {
  const {machine, cpu, put32} = fixture();
  const window = prevalidateI80386WriteWindow(machine, cpu.edi);
  assert.ok(window);
  put32(DATA_PTE, 0x140047);
  assert.equal(isI80386WriteWindowValid(window), false);

  // Rebuild a cached mapping to the code page: native stores must not alter it.
  put32(DATA_PTE, CODE_PHYS | 0x47);
  cpu._translate(DATA + 0x28, {write:true});
  assert.equal(prevalidateI80386WriteWindow(machine, DATA + 0x28), null);

  put32(DATA_PTE, DATA_PHYS | 0x47);
  cpu._translate(DATA + 0x28, {write:true});
  cpu._translate(CODE);
  assert.ok(prevalidateI80386WriteWindow(machine, DATA + 0x28));
  cpu._translationTablePages.add(DATA_PHYS >>> 12);
  assert.equal(prevalidateI80386WriteWindow(machine, DATA + 0x28), null);
  assert.equal(isI80386WriteWindowValid(window), false);
});

test('segment, privilege, code location, A20, and RAM mapping changes revoke admission', () => {
  const {machine, cpu} = fixture();
  const window = prevalidateI80386WriteWindow(machine, cpu.edi);
  assert.ok(window);
  cpu.cs = 3;
  assert.equal(isI80386WriteWindowValid(window), true); // User mapping is allowed.
  cpu._translations[(DATA >>> 12) & 511].userPage = false;
  assert.equal(isI80386WriteWindowValid(window), false);
  cpu._translations[(DATA >>> 12) & 511].userPage = true;
  cpu.cs = 0;
  cpu.segmentCaches[0].limit = DATA + 0x100;
  assert.equal(isI80386WriteWindowValid(window), false);
  cpu.segmentCaches[0].limit = 0xffffffff;
  cpu.eip = DATA;
  assert.equal(isI80386WriteWindowValid(window), false);
  cpu.eip = CODE;
  machine._a20Configured = true;
  machine._a20Enabled = false;
  assert.equal(isI80386WriteWindowValid(window), false);
  machine._a20Enabled = true;
  machine._page[DATA_PHYS >>> 12] = 0;
  assert.equal(isI80386WriteWindowValid(window), false);
});
