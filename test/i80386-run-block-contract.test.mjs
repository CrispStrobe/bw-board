import test from 'node:test';
import assert from 'node:assert/strict';
import {ExperimentalI80386ATMachine, PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA} from
  '../src/experimental/i80386-at-machine.js';

function put32(machine, address, value) {
  for (let i = 0; i < 4; i++) machine._write(address + i, value >>> (8 * i));
}

function machineWithCode(bytes) {
  const machine = new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA);
  const cpu = machine.cpu;
  cpu.segmentCaches[1] = {base:0, limit:0xffffffff, default32:true,
    present:true, code:true, readable:true, writable:false};
  put32(machine, 0x1000, 0x2007);
  put32(machine, 0x2000, 0x6007);
  bytes.forEach((value, i) => machine._write(0x6000 + i, value));
  cpu.cr0 = 0x80000001;
  cpu.cr3 = 0x1000;
  machine._flushChips();
  return machine;
}

test('bounded board block matches individual memory and branch instructions', () => {
  const code = [
    0x8b,0x05,0x00,0x02,0x00,0x00, // MOV EAX,[0200h]
    0x83,0xc0,0x01,                 // ADD EAX,1
    0x89,0x05,0x04,0x02,0x00,0x00, // MOV [0204h],EAX
    0x39,0xc0,                      // CMP EAX,EAX
    0x75,0x01,                      // JNZ +1 (not taken)
    0x90,                           // NOP
  ];
  const batched = machineWithCode(code), reference = machineWithCode(code);
  for (const machine of [batched, reference]) put32(machine, 0x6200, 0x12345678);
  const result = batched.runBlock(6);
  for (let i = 0; i < 6; i++) reference.step();
  assert.deepEqual(result, {instructions:6, cycles:36, reason:'instruction-budget'});
  assert.equal(batched._read386(0x6204), 0x79);
  assert.deepEqual([batched.cpu.eax,batched.cpu.eip,batched.cpu.eflags,
    batched.cpu.cycles,batched.cycles,batched._chipDebt],
  [reference.cpu.eax,reference.cpu.eip,reference.cpu.eflags,
    reference.cpu.cycles,reference.cycles,reference._chipDebt]);
});

test('block returns before chip deadline and sees host code edits on retry', () => {
  const machine = machineWithCode([0xb8,0x01,0,0,0,0xb8,0x02,0,0,0]);
  machine._chipDeadline = machine._chipDebt + machine.functionalInstructionCycles;
  assert.deepEqual(machine.runBlock(2),
    {instructions:1,cycles:6,reason:'chip-event'});
  assert.equal(machine.cpu.eax,1);
  machine._write(0x6006,3); // Host/DMA ingress changes the next immediate.
  machine.step(); // Services the due chip event before the next instruction.
  assert.deepEqual([machine.cpu.eax,machine.cpu.eip],[3,10]);
});

test('taken branch changes the next instruction within the board block', () => {
  const machine = machineWithCode([
    0xb8,1,0,0,0, 0x83,0xf8,0, 0x75,5,
    0xb8,2,0,0,0, 0x90,
  ]);
  assert.deepEqual(machine.runBlock(4),
    {instructions:4,cycles:24,reason:'instruction-budget'});
  assert.deepEqual([machine.cpu.eax,machine.cpu.eip],[1,16]);
});

test('guest write to a later code byte is visible in the same board block', () => {
  const machine = machineWithCode([
    0xc6,0x05,0x08,0,0,0,0x03, // MOV BYTE PTR [8],3
    0xb8,0x01,0,0,0,           // MOV EAX,1 before the write
  ]);
  assert.deepEqual(machine.runBlock(2),
    {instructions:2,cycles:12,reason:'instruction-budget'});
  assert.deepEqual([machine.cpu.eax,machine.cpu.eip],[3,12]);
});

test('block budget is bounded and zero-step exits preserve state', () => {
  const machine = machineWithCode([0x90]);
  assert.throws(()=>machine.runBlock(0),RangeError);
  assert.throws(()=>machine.runBlock(65),RangeError);
  machine._chipDeadline = machine._chipDebt;
  const before = [machine.cpu.eip,machine.cpu.cycles,machine.cycles];
  assert.deepEqual(machine.runBlock(1),
    {instructions:0,cycles:0,reason:'chip-event'});
  assert.deepEqual([machine.cpu.eip,machine.cpu.cycles,machine.cycles],before);
});
