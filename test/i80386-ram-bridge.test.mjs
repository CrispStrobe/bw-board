import test from 'node:test';
import assert from 'node:assert/strict';
import {createI80386RamBridge} from '../src/experimental/i80386-ram-bridge.js';
import {ExperimentalI80386ATMachine,
  PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP} from '../src/experimental/i80386-at-machine.js';

test('WASM RAM backing is shared with 386 CPU, host and DMA bus writes', async () => {
  const machine = new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP);
  machine._write(0x120000, 0x35);
  const bridge = await createI80386RamBridge();
  const before = machine.mem;
  const boardRam = bridge.attach(machine);
  assert.notEqual(boardRam, before);
  assert.equal(boardRam.buffer, bridge.memory.buffer);
  assert.equal(bridge.ram[0x120000], 0x35);
  machine._write386(0x120001, 0x46);
  assert.equal(bridge.ram[0x120001], 0x46);
  machine._write(0x120002, 0x57); // The DMA and host path uses _write.
  assert.equal(bridge.ram[0x120002], 0x57);
  bridge.ram[0x120003] = 0x68;
  assert.equal(machine.cpu.fetch(0x120003), 0x68);
  assert.equal(machine._read386(0x120003), 0x68);
  assert.throws(() => bridge.attach(machine), TypeError);
  assert.throws(() => bridge.memory.grow(1), RangeError);
});

test('shared RAM leaves A20 alias and APIC device decode with the board', async () => {
  const machine = new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP);
  const bridge = await createI80386RamBridge();
  bridge.attach(machine);
  machine._a20Enabled = false;
  machine._write(0, 0x27);
  bridge.ram[0x100000] = 0x39;
  assert.equal(machine._read386(0x100000), 0x27);
  machine._a20Enabled = true;
  assert.equal(machine._read386(0x100000), 0x39);
  machine._lapic[0x20 / 4] = 0x12345678;
  assert.equal(machine._read386(0xfee00020), 0x78);
  assert.equal(machine._read386(0xfee00021), 0x56);
});
