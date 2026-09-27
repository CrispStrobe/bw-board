import assert from 'node:assert/strict';
import test from 'node:test';
import I80386, {I80386Fault, UnsupportedI80386} from '../src/experimental/i80386.js';

const fixture = bytes => {
  const mem = new Uint8Array(32);
  mem.set(bytes);
  return new I80386({read: address => mem[address] ?? 0,
    fetch: address => mem[address] ?? 0});
};

test('80386 MOV DR transfers full-width values and resets the debug bank', () => {
  const cpu = fixture([0x0f, 0x23, 0xc0, 0x0f, 0x21, 0xc3]);
  cpu.eax = 0x12345678;
  cpu.step(); // MOV DR0,EAX
  cpu.eax = 0;
  cpu.step(); // MOV EBX,DR0
  assert.equal(cpu.ebx, 0x12345678);
  cpu.reset();
  assert.equal(cpu._debugRegisters[0], 0);
});

test('80386 MOV DR refuses memory forms, reserved registers, and nonzero CPL', () => {
  for (const [bytes, vector] of [
    [[0x0f, 0x21, 0x00], 6], // memory operand
    [[0x0f, 0x21, 0xe0], 6], // reserved DR4
  ]) {
    const cpu = fixture(bytes);
    assert.throws(() => cpu.step(), error => error instanceof I80386Fault && error.vector === vector);
    assert.equal(cpu.eip, 0);
  }
  const user = fixture([0x0f, 0x21, 0xc0]);
  user.cr0 = 1;
  user.cs = 3;
  assert.throws(() => user.step(), error => error instanceof I80386Fault && error.vector === 13);
  assert.equal(user.eip, 0);
});

test('enabling hardware breakpoints is explicit until comparator traps are modeled', () => {
  const cpu = fixture([0x0f, 0x23, 0xf8]); // MOV DR7,EAX
  cpu.eax = 1;
  assert.throws(() => cpu.step(), UnsupportedI80386);
  assert.equal(cpu.eip, 0);
  assert.equal(cpu._debugRegisters[7], 0);
  cpu.eax = 0;
  cpu.step();
  assert.equal(cpu._debugRegisters[7], 0);
});
