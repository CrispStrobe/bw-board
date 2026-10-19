import test from 'node:test';
import assert from 'node:assert/strict';

import I80386 from '../src/experimental/i80386.js';

function fixture(bytes) {
  const memory = new Map(bytes.map((value, index) => [index, value]));
  const writes = [];
  const cpu = new I80386({
    fetch: address => memory.get(address) ?? 0,
    read: address => memory.get(address) ?? 0,
    write: (address, value) => {
      writes.push([address, value & 0xff]);
      memory.set(address, value & 0xff);
    },
  });
  return {cpu, memory, writes};
}

test('opcode 82 is the byte-immediate Group 1 alias', () => {
  const compare = fixture([0x82, 0x3c, 0x00]); // CMP byte [SI],0
  compare.cpu.si = 0x100;
  compare.memory.set(0x100, 0);
  compare.cpu.eflags = 0x811;
  compare.cpu.step();
  assert.equal(compare.cpu.eip, 3);
  assert.equal(compare.cpu.eflags & 0x8d5, 0x044);
  assert.deepEqual(compare.writes, []);

  const adc = fixture([0x66, 0x82, 0xd0, 0x7f]); // ADC AL,7fh
  adc.cpu.eax = 0x12345600;
  adc.cpu.eflags = 0x003;
  adc.cpu.step();
  assert.equal(adc.cpu.eax, 0x12345680);
  assert.equal(adc.cpu.eflags & 0x8d5, 0x890);
});

test('opcode 82 memory writes preserve Group 1 write-admission ordering', () => {
  const reads = [];
  const writes = [];
  const bytes = [0x2e, 0x82, 0x06, 0x00, 0x01, 1]; // ADD byte CS:[100h],1
  const cpu = new I80386({
    fetch: address => bytes[address] ?? 0,
    read: address => { reads.push(address); return 0; },
    write: (address, value) => writes.push([address, value]),
  });
  cpu.cr0 = 1;
  cpu.segmentCaches[1] = {
    ...cpu.segmentCaches[1],
    code: true,
    readable: true,
    writable: false,
  };
  assert.throws(() => cpu.step(), error => error?.vector === 13 && error.errorCode === 0);
  assert.deepEqual([reads, writes, cpu.eip], [[], [], 0]);
});
