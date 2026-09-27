import test from 'node:test';
import assert from 'node:assert/strict';
import {ExperimentalI80386ATMachine, PCAT80386_EXPERIMENTAL_4M} from
  '../src/experimental/i80386-at-machine.js';
import {enableI80386Code16LoadExecution} from
  '../src/experimental/i80386-code16-load-exec.js';

function board(enabled) {
  const machine = new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M);
  if (enabled) enableI80386Code16LoadExecution(machine);
  const cpu = machine.cpu;
  cpu.cs = 0x1000; cpu.ds = 0x2000; cpu.ss = 0x3000;
  cpu.segmentCaches[1] = {base: 0x10000, limit: 0xffff, default32: false,
    present: true, code: true, readable: true, writable: false};
  cpu.segmentCaches[3] = {base: 0x20000, limit: 0xffff, default32: false,
    present: true, code: false, readable: true, writable: true};
  cpu.segmentCaches[2] = {base: 0x30000, limit: 0xffff, default32: false,
    present: true, code: false, readable: true, writable: true};
  cpu.eip = 0x20; cpu.bx = 0x31; cpu.si = 2; cpu.bp = 0x40;
  return machine;
}

function put32(machine, address, value) {
  for (let i = 0; i < 4; i++) machine._write386(address + i, value >>> (8 * i));
}

function map(machine, linear, physical) {
  put32(machine, 0x1000 + ((linear >>> 20) & 0xffc), 0x4000 | 7);
  put32(machine, 0x4000 + ((linear >>> 10) & 0xffc), physical | 7);
}

function run(bytes, data, configure = () => {}) {
  const reference = board(false), candidate = board(true);
  for (const machine of [reference, candidate]) {
    machine.mem.set(bytes, 0x10020);
    for (const [address, value] of data) machine.mem[address] = value;
    configure(machine);
  }
  let fetchCalls = 0;
  const originalFetch = candidate.cpu._fetch8;
  candidate.cpu._fetch8 = function () { fetchCalls++; return originalFetch.call(this); };
  const expectedCycles = reference.step();
  const actualCycles = candidate.step();
  assert.equal(actualCycles, expectedCycles);
  assert.deepEqual(candidate.cpu._snapshotInstruction(), reference.cpu._snapshotInstruction());
  assert.equal(candidate.cycles, reference.cycles);
  assert.equal(candidate._chipDebt, reference._chipDebt);
  return {reference, candidate, slowCalls: Number(fetchCalls > 0)};
}

test('8A byte and 8B word loads retire through the admitted path with live memory', () => {
  const byte = run([0x8a, 0x20], [[0x20033, 0x9a]], machine => {
    machine.cpu.eax = 0x12345678;
  });
  assert.equal(byte.slowCalls, 0);
  assert.equal(byte.candidate.cpu.ah, 0x9a);
  const word = run([0x8b, 0x46, 0xf2], [[0x30032, 0xcd], [0x30033, 0xab]]);
  assert.equal(word.slowCalls, 0);
  assert.equal(word.candidate.cpu.ax, 0xabcd);
  const direct = run([0x8b, 0x1e, 0x10, 0x00], [[0x20010, 0x34], [0x20011, 0x12]]);
  assert.equal(direct.slowCalls, 0);
  assert.equal(direct.candidate.cpu.bx, 0x1234);
});

test('all memory ModR/M addressing forms execute with the same state as the interpreter', () => {
  for (const mod of [0, 1, 2]) for (let rm = 0; rm < 8; rm++) {
    const tail = mod === 0 && rm === 6 ? [0x80, 0x00]
      : mod === 0 ? [] : mod === 1 ? [0x01] : [0x01, 0x00];
    const bytes = [0x8b, (mod << 6) | (2 << 3) | rm, ...tail];
    const result = run(bytes, Array.from({length: 0x400}, (_, i) => [0x20000 + i, i & 255]));
    assert.equal(result.slowCalls, 0, `mod ${mod} rm ${rm}`);
  }
});

test('protected16 and VM86 paged loads read live bytes across two physical pages', () => {
  for (const mode of ['protected16', 'vm86']) {
    const result = run([0x8b, 0x00], [[0x120fff, 0x78], [0x130000, 0x56]], machine => {
      const cpu = machine.cpu;
      cpu.cr3 = 0x1000;
      cpu.cr0 = 0x80000001;
      if (mode === 'vm86') cpu.eflags |= 0x20000;
      cpu.segmentCaches[3].base = 0x20f00;
      cpu.bx = 0xff; cpu.si = 0;
      map(machine, 0x10000, 0x10000);
      map(machine, 0x20000, 0x120000);
      map(machine, 0x21000, 0x130000);
      cpu._translate(0x10020);
      cpu._translate(0x20ffe);
      cpu._translate(0x21000);
    });
    assert.equal(result.slowCalls, 0, mode);
    assert.equal(result.candidate.cpu.ax, 0x5678);
  }
});

test('prefixes, traps, debug state, and unproved data fall back before changing state', () => {
  assert.equal(run([0x26, 0x8a, 0x00], [[0x20033, 0x55]]).slowCalls, 1);
  assert.equal(run([0x8b, 0x00], [[0x20033, 0x55]], machine => {
    machine.cpu.eflags |= 0x10000;
  }).slowCalls, 1);
  assert.equal(run([0x8b, 0x00], [[0x20033, 0x55]], machine => {
    machine.cpu._debugRegisters[7] = 1;
  }).slowCalls, 1);
  assert.equal(run([0x8b, 0x00], [[0x20033, 0x55]], machine => {
    machine.cpu._interruptShadow = 1;
  }).slowCalls, 1);
  assert.equal(run([0x8b, 0x00], [[0x20033, 0x55]], machine => {
    machine.cpu.segmentCaches[1].default32 = true;
  }).slowCalls, 1);
  assert.equal(run([0x8b, 0x00], [[0x20033, 0x55]], machine => {
    machine.cpu.segmentCaches[3].base = 0x9ff00;
    machine.cpu.bx = 0x100; machine.cpu.si = 0;
  }).slowCalls, 1);
});

test('a code-window refusal leaves the ordinary fault and restart path in charge', () => {
  const result = run([0x8b, 0x46, 0xf2], [[0x30032, 0x55]], machine => {
    machine.cpu.segmentCaches[1].limit = 0x21;
  });
  assert.equal(result.slowCalls, 1);
  assert.equal(result.candidate.cpu.eip, result.reference.cpu.eip);
});
