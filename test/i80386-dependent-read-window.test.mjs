import test from 'node:test';
import assert from 'node:assert/strict';
import {ExperimentalI80386ATMachine,
  PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP} from
  '../src/experimental/i80386-at-machine.js';
import {prevalidateI80386DependentRead, isI80386DependentReadValid} from
  '../src/experimental/i80386-dependent-read-window.js';

const CODE = 0x80120000, FIRST = 0x80130020, SECOND = 0x80140028;
const CODE_PHYS = 0x120000, FIRST_PHYS = 0x130020, SECOND_PHYS = 0x140028;
const SECOND_PTE = 0x4000 + 0x140 * 4;

function fixture({cacheSecond = true} = {}) {
  const machine = new ExperimentalI80386ATMachine(
    PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP);
  const put32 = (address, value) => {
    for (let i = 0; i < 4; i++)
      machine._write386(address + i, (value >>> (8 * i)) & 255);
  };
  put32(0x1800, 0x4007);
  for (const page of [0x120, 0x130, 0x140])
    put32(0x4000 + page * 4, page * 4096 | 7);
  put32(FIRST_PHYS, SECOND);
  put32(SECOND_PHYS, 0x12345678);
  const cpu = machine.cpu;
  cpu.segmentCaches[1] = {base:0, limit:0xffffffff, default32:true,
    present:true, code:true, readable:true, writable:false, dpl:0,
    address:0x9000};
  cpu.segmentCaches[3] = {base:0, limit:0xffffffff, default32:true,
    present:true, code:false, readable:true, writable:true, dpl:0};
  cpu.cs = 8;
  cpu.ds = 16;
  cpu.cr0 = 0x80000001;
  cpu.cr3 = 0x1000;
  cpu.eip = CODE;
  cpu._translate(CODE);
  cpu._translate(FIRST);
  if (cacheSecond) cpu._translate(SECOND);
  return {machine, cpu, put32};
}

const admit = machine =>
  prevalidateI80386DependentRead(machine, FIRST, 4, pointer => pointer);

test('cached plain-RAM dependent reads admit without A/D or guest-state changes', () => {
  const {machine, cpu} = fixture();
  const before = {
    pde:Array.from(machine.mem.subarray(0x1800, 0x1804)),
    firstPte:Array.from(machine.mem.subarray(0x4000 + 0x130 * 4,
      0x4000 + 0x130 * 4 + 4)),
    secondPte:Array.from(machine.mem.subarray(SECOND_PTE, SECOND_PTE + 4)),
    generation:cpu._translationGeneration, cr2:cpu.cr2, cycles:cpu.cycles,
  };
  const proof = admit(machine);
  assert.equal(proof?.firstValue, SECOND);
  assert.equal(proof?.secondOffset, SECOND);
  assert.equal(proof?.second.physicalPage + (SECOND & 0xfff), SECOND_PHYS);
  assert.equal(isI80386DependentReadValid(proof), true);
  assert.equal(Object.isFrozen(proof), true);
  assert.equal(Object.isFrozen(proof.csFields), true);
  assert.equal(Object.isFrozen(proof.dsFields), true);
  assert.equal(Object.isFrozen(proof.translationFields), true);
  assert.equal(Object.isFrozen(proof.translationFields[0]), true);
  assert.throws(() => { proof.csFields[0] = 123; }, TypeError);
  cpu.eip = CODE + 16;
  assert.equal(isI80386DependentReadValid(proof), true,
    'prior steps may advance within the proven code page');
  cpu.eip = CODE + 4096;
  assert.equal(isI80386DependentReadValid(proof), false);
  cpu.eip = CODE;
  assert.deepEqual({
    pde:Array.from(machine.mem.subarray(0x1800, 0x1804)),
    firstPte:Array.from(machine.mem.subarray(0x4000 + 0x130 * 4,
      0x4000 + 0x130 * 4 + 4)),
    secondPte:Array.from(machine.mem.subarray(SECOND_PTE, SECOND_PTE + 4)),
    generation:cpu._translationGeneration, cr2:cpu.cr2, cycles:cpu.cycles,
  }, before);
});

test('stale source bytes, CS/segment/A20 changes revoke admission', () => {
  const {machine, cpu, put32} = fixture();
  const proof = admit(machine);
  assert.ok(proof);
  // Direct host/DMA RAM writes do not have to bump translation generation.
  machine.mem[FIRST_PHYS] ^= 1;
  assert.equal(isI80386DependentReadValid(proof), false);
  put32(FIRST_PHYS, SECOND);
  assert.equal(isI80386DependentReadValid(proof), true);
  cpu.segmentCaches[1].limit--;
  assert.equal(isI80386DependentReadValid(proof), false);
  cpu.segmentCaches[1].limit++;
  cpu.segmentCaches[1].address++;
  assert.equal(isI80386DependentReadValid(proof), false);
  cpu.segmentCaches[1].address--;
  cpu.segmentCaches[3].dpl = 1;
  assert.equal(isI80386DependentReadValid(proof), false);
  cpu.segmentCaches[3].dpl = 0;
  machine._a20Configured = !machine._a20Configured;
  assert.equal(isI80386DependentReadValid(proof), false);
  machine._a20Configured = !machine._a20Configured;
  cpu._translationCacheEnabled = false;
  assert.equal(isI80386DependentReadValid(proof), false);
});

test('CR3, remap, privilege, and RAM-kind changes revoke admission', () => {
  const {machine, cpu, put32} = fixture();
  const proof = admit(machine);
  assert.ok(proof);
  cpu.cr3 = 0x2000;
  assert.equal(isI80386DependentReadValid(proof), false);
  cpu.cr3 = 0x1000;
  put32(SECOND_PTE, 0x150007);
  assert.equal(isI80386DependentReadValid(proof), false);
  assert.equal(admit(machine), null);
  put32(SECOND_PTE, 0x140007);
  cpu._translate(CODE); cpu._translate(FIRST); cpu._translate(SECOND);
  const remapped = admit(machine);
  assert.ok(remapped);
  cpu.cs = 11;
  assert.equal(isI80386DependentReadValid(remapped), false);
  assert.equal(admit(machine), null, 'supervisor descriptor rejects CPL 3');
  cpu.cs = 8;
  machine._page[SECOND_PHYS >>> 12] = 0;
  assert.equal(isI80386DependentReadValid(remapped), false);
  assert.equal(admit(machine), null);
});

test('user mode cannot use a cached supervisor-only source mapping', () => {
  const {machine, cpu} = fixture();
  cpu.cs = 11;
  cpu.ds = 19;
  cpu.segmentCaches[1].dpl = 3;
  cpu.segmentCaches[3].dpl = 3;
  assert.ok(admit(machine));
  cpu._translations[(FIRST >>> 12) & 511].userPage = false;
  assert.equal(admit(machine), null);
});

test('uncached, crossed, and aliased pages refuse without speculative translation', () => {
  const {machine, cpu} = fixture({cacheSecond:false});
  const before = Array.from(machine.mem.subarray(SECOND_PTE, SECOND_PTE + 4));
  const generation = cpu._translationGeneration;
  assert.equal(admit(machine), null);
  assert.deepEqual(Array.from(machine.mem.subarray(SECOND_PTE, SECOND_PTE + 4)), before);
  assert.equal(cpu._translationGeneration, generation);
  assert.equal(cpu.cr2, 0);
  const secondPte = 0x4000 + 0x140 * 4;
  for (let i = 0; i < 4; i++) machine._write386(secondPte + i, 0);
  assert.equal(admit(machine), null, 'unmapped second page must not be walked');
  assert.deepEqual(Array.from(machine.mem.subarray(secondPte, secondPte + 4)),
    [0, 0, 0, 0]);
  assert.equal(cpu.cr2, 0);
  for (let i = 0; i < 4; i++) machine._write386(secondPte + i,
    (0x140007 >>> (8 * i)) & 255);
  cpu._translate(CODE);
  cpu._translate(FIRST);
  cpu._translate(SECOND);
  assert.equal(prevalidateI80386DependentRead(machine, FIRST + 0xfdd, 4,
    pointer => pointer), null, 'first scalar crosses a page');
  assert.equal(prevalidateI80386DependentRead(machine, FIRST, 4,
    () => SECOND + 0xfd6, 4), null, 'second scalar crosses a page');
  assert.equal(prevalidateI80386DependentRead(machine, FIRST, 4,
    () => 0xfffffffe, 4), null, 'second scalar wraps 32 bits');
  assert.equal(prevalidateI80386DependentRead(machine, FIRST, 4,
    () => FIRST + 8), null, 'aliased source and derived pages refuse');
  assert.equal(prevalidateI80386DependentRead(machine, FIRST, 4,
    () => CODE + 8), null, 'code/data alias refuses');
});

test('cached page-table RAM reads produce a read-only proof', () => {
  const {machine, cpu} = fixture();
  cpu._translationTablePages.add(FIRST_PHYS >>> 12);
  cpu._translationTablePages.add(SECOND_PHYS >>> 12);
  const proof = admit(machine);
  assert.equal(proof?.readOnly, true);
  assert.equal('writeWindows' in proof, false);
  assert.equal(isI80386DependentReadValid(proof), true);
  machine.mem[FIRST_PHYS] ^= 1;
  assert.equal(isI80386DependentReadValid(proof), false,
    'even an untracked direct write changes the captured source value');
});

test('admission does not invoke translation, bus reads, or writes', () => {
  const {machine, cpu} = fixture();
  const originalTranslate = cpu._translate;
  const originalRead = machine._read386;
  const originalWrite = machine._write386;
  cpu._translate = () => { throw new Error('guest translation walk'); };
  machine._read386 = () => { throw new Error('bus read'); };
  machine._write386 = () => { throw new Error('bus write'); };
  try {
    assert.ok(admit(machine));
  } finally {
    cpu._translate = originalTranslate;
    machine._read386 = originalRead;
    machine._write386 = originalWrite;
  }
});
