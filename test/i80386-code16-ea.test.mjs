import test from 'node:test';
import assert from 'node:assert/strict';
import {ExperimentalI80386ATMachine, PCAT80386_EXPERIMENTAL_4M} from
  '../src/experimental/i80386-at-machine.js';
import {prevalidateI80386Code16Window as admitCode} from
  '../src/experimental/i80386-code16-window.js';
import {decodeI80386Code16EA as decode, resolveI80386Code16EA as resolve,
  prevalidateI80386Code16EADataWindow as admit,
  isI80386Code16EADataWindowValid as valid} from
  '../src/experimental/i80386-code16-ea.js';

function board() { return new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M); }
function setup(machine) {
  const cpu = machine.cpu;
  cpu.cs = 0x1000; cpu.ds = 0x2000; cpu.ss = 0x3000;
  cpu.segmentCaches[1] = {base: 0x10000, limit: 0xffff, default32: false,
    present: true, code: true, readable: true, writable: false};
  cpu.segmentCaches[3] = {base: 0x20000, limit: 0xffff, default32: false,
    present: true, code: false, readable: true, writable: true};
  cpu.segmentCaches[2] = {base: 0x30000, limit: 0xffff, default32: false,
    present: true, code: false, readable: true, writable: true};
  cpu.segmentCaches[0] = {base: 0x40000, limit: 0xffff, default32: false,
    present: true, code: false, readable: true, writable: true};
  cpu.bx = 0xfffa; cpu.bp = 0xfff8; cpu.si = 9; cpu.di = 0x20;
}
function oracle(machine, bytes, override = null) {
  const cpu = machine.cpu;
  machine.mem.set(bytes, 0x10020);
  cpu.eip = 0x20;
  cpu._instructionBytes = 0;
  const result = cpu._decodeEA(false, override);
  assert.equal(cpu.eip, 0x20 + bytes.length);
  return result;
}
function put32(machine, address, value) {
  for (let i = 0; i < 4; i++) machine._write386(address + i, value >>> (i * 8));
}
function map(machine, linear, physical) {
  machine.cpu.cr3 = 0x1000;
  put32(machine, 0x1000 + ((linear >>> 20) & 0xffc), 0x4000 | 7);
  put32(machine, 0x4000 + ((linear >>> 10) & 0xffc), physical | 7);
}

test('all 24 memory ModR/M forms match the CPU decoder, including BP/DS split', () => {
  const machine = board(); setup(machine);
  for (const mod of [0, 1, 2]) for (let rm = 0; rm < 8; rm++) {
    const bytes = mod === 0 && rm === 6 ? [0x28 | rm, 0xfe, 0xff]
      : mod === 0 ? [0x28 | rm]
        : mod === 1 ? [0x40 | 0x28 | rm, 0xf6]
          : [0x80 | 0x28 | rm, 0xfe, 0xff];
    const descriptor = decode(bytes);
    assert.ok(descriptor, `mod ${mod} rm ${rm}`);
    assert.equal(descriptor.length, bytes.length);
    const actual = resolve(descriptor, machine.cpu);
    const expected = oracle(machine, bytes);
    assert.deepEqual(actual, expected, `mod ${mod} rm ${rm}`);
    assert.equal(descriptor.defaultSegment,
      mod === 0 && rm === 6 ? 3 : [2, 3, 6].includes(rm) ? 2 : 3);
  }
});

test('signed displacements, modulo-16-bit wrap, reg field, and live registers', () => {
  const machine = board(); setup(machine);
  const descriptor = decode([0x40 | (7 << 3) | 2, 0xf6]);
  assert.deepEqual(resolve(descriptor, machine.cpu),
    oracle(machine, [0x40 | (7 << 3) | 2, 0xf6]));
  assert.equal(descriptor.reg, 7);
  assert.equal(descriptor.displacement, -10);
  assert.equal(resolve(descriptor, machine.cpu).off, 0xfff7);
  machine.cpu.bp = 3;
  assert.equal(resolve(descriptor, machine.cpu).off, 2,
    'register read happens at resolve time');
  const wide = decode([0x80 | 0, 0xfe, 0xff]);
  assert.equal(wide.displacement, -2);
  assert.equal(resolve(wide, machine.cpu).off, 1,
    'BX + SI - 2 wraps at 16 bits');
  const direct = decode([0x06, 0xfe, 0xff]);
  assert.equal(direct.displacement, 0xfffe);
  assert.equal(resolve(direct, machine.cpu).off, 0xfffe);
  assert.deepEqual(direct.terms, []);
});

test('override index zero selects ES, and unsupported forms are refused', () => {
  const machine = board(); setup(machine);
  const bytes = [0x46, 0xfd]; // [BP - 3], normally SS.
  const descriptor = decode(bytes, {segmentOverride: 0});
  assert.equal(descriptor.defaultSegment, 2);
  assert.equal(resolve(descriptor, machine.cpu).seg, 0);
  assert.deepEqual(resolve(descriptor, machine.cpu), oracle(machine, bytes, 0));
  for (const bad of [decode([0xc0]), decode([0x00], {address32: true}),
    decode([0x46]), decode([0x86, 0x01]),
    decode([0x00], {segmentOverride: 6})]) assert.equal(bad, null);
});

test('live EA pairs with data admission and invalidates when registers change', () => {
  const machine = board(); setup(machine);
  const cpu = machine.cpu;
  const bytes = [0x00]; // BX + SI, DS.
  machine.mem.set(bytes, 0x10020);
  const code = admitCode(machine, 0x20, bytes.length);
  const descriptor = decode(bytes);
  machine.mem[0x20003] = 0x77;
  const proof = admit(machine, code, descriptor, 1, 'read');
  assert.ok(proof);
  assert.deepEqual(proof.ea, oracle(machine, bytes));
  assert.equal(proof.dataWindow.physicalAddresses[0], 0x20003);
  assert.equal(valid(proof), true);
  cpu.bx = 0;
  assert.equal(valid(proof), false, 'live BX change invalidates old address');
  const next = admit(machine, code, descriptor, 1, 'read');
  assert.ok(next);
  assert.equal(next.ea.off, 9);
  assert.equal(next.dataWindow.physicalAddresses[0], 0x20009);
});

test('BP defaults to SS; explicit ES override chooses a separate physical base', () => {
  const machine = board(); setup(machine);
  machine.cpu.bp = 0x30;
  const bytes = [0x46, 0xf0];
  machine.mem.set(bytes, 0x10020);
  const code = admitCode(machine, 0x20, bytes.length);
  const ss = admit(machine, code, decode(bytes), 2, 'read');
  const es = admit(machine, code, decode(bytes, {segmentOverride: 0}), 2, 'read');
  assert.ok(ss); assert.ok(es);
  assert.equal(ss.ea.seg, 2);
  assert.equal(es.ea.seg, 0);
  assert.deepEqual(ss.dataWindow.physicalAddresses, [0x30020, 0x30021]);
  assert.deepEqual(es.dataWindow.physicalAddresses, [0x40020, 0x40021]);
});

test('page-crossing EA admission requires both cached pages', () => {
  const machine = board(); setup(machine);
  const cpu = machine.cpu;
  cpu.segmentCaches[3].base = 0x20f00;
  cpu.bx = 0xfe; cpu.si = 0;
  cpu.cr0 = 0x80000001;
  map(machine, 0x10000, 0x10000);
  map(machine, 0x20000, 0x120000);
  map(machine, 0x21000, 0x130000);
  cpu._translate(0x10020);
  const bytes = [0x00];
  machine.mem.set(bytes, 0x10020);
  const code = admitCode(machine, 0x20, bytes.length);
  const descriptor = decode(bytes);
  cpu._translate(0x20ffe);
  assert.equal(admit(machine, code, descriptor, 4, 'read'), null);
  cpu._translate(0x21000);
  const proof = admit(machine, code, descriptor, 4, 'read');
  assert.ok(proof);
  assert.deepEqual(proof.ea, oracle(machine, bytes));
  assert.deepEqual(proof.dataWindow.physicalAddresses,
    [0x120ffe, 0x120fff, 0x130000, 0x130001]);
});

test('protected16 and VM86 segment bases match the CPU decoder and admission', () => {
  for (const mode of ['protected16', 'vm86']) {
    const machine = board(); setup(machine);
    const cpu = machine.cpu;
    cpu.cr0 = 1;
    if (mode === 'vm86') cpu.eflags |= 0x20000;
    cpu.segmentCaches[2].base = mode === 'vm86' ? 0x33000 : 0x35000;
    cpu.bp = 0x40;
    const bytes = [0x46, 0xf0];
    machine.mem.set(bytes, 0x10020);
    const code = admitCode(machine, 0x20, bytes.length);
    const descriptor = decode(bytes);
    const proof = admit(machine, code, descriptor, 2, 'read');
    assert.ok(proof);
    assert.deepEqual(proof.ea, oracle(machine, bytes));
    assert.deepEqual(proof.dataWindow.physicalAddresses,
      [cpu.segmentCaches[2].base + 0x30, cpu.segmentCaches[2].base + 0x31]);
  }
});
