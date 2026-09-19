import assert from 'node:assert/strict';
import test from 'node:test';

import ExperimentalI80386ATMachine, {
  PCAT80386_EXPERIMENTAL,
} from '../src/experimental/i80386-at-machine.js';

test('experimental 386 AT fetches the reset ROM at FFFFFFF0 without broad high-address aliasing', () => {
  const machine = new ExperimentalI80386ATMachine();
  const rom = new Uint8Array(0x10000);
  rom[0xfff0] = 0xf4; // HLT
  assert.equal(machine.loadRom(rom), 0xff0000);
  machine.reset();
  assert.equal(machine.cpu.pc, 0xfffffff0);
  assert.equal(machine.cpu.read(0xfffffff0), 0xf4);
  assert.equal(machine.cpu.read(0x10fffff0), 0xff);
  assert.equal(machine.step(), 4, 'completed reset-vector HLT receives functional charge');
  assert.equal(machine.cpu.halted, true);
});

test('experimental 386 AT A20 gates bit 20 and retains addresses above the 286 bus', () => {
  const machine = new ExperimentalI80386ATMachine();
  machine.mem[0] = 0x11;
  machine.mem[0x100000] = 0x22;
  assert.equal(machine.cpu.read(0x100000), 0x22);
  machine.setA20Enabled(false);
  assert.equal(machine.cpu.read(0x100000), 0x11);
  assert.equal(machine.cpu.read(0x01000000), 0xff, '16MiB must not wrap to address zero');
  machine.setA20Enabled(true);
  assert.equal(machine.cpu.read(0x100000), 0x22);
});

test('experimental 386 AT cold board reset restores configured A20 before reset-vector fetch', () => {
  const machine = new ExperimentalI80386ATMachine();
  const rom = new Uint8Array(0x10000);
  rom[0xfff0] = 0xf4;
  machine.loadRom(rom);
  machine.setA20Enabled(false);
  assert.equal(machine.cpu.read(0xfffffff0), 0xff,
    'a CPU-only reset with the external A20 gate low does not invent a ROM alias');
  machine.reset();
  assert.equal(machine.a20Enabled, true, 'cold board reset restores the profile output-port state');
  assert.equal(machine.step(), 4, 'completed reset-vector HLT receives functional charge');
  assert.equal(machine.cpu.halted, true);
});

test('experimental 386 AT bridges little-endian port widths and refuses legacy state/timing APIs', () => {
  const events = [];
  const machine = new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL, {
    onPortAccess: event => events.push(event),
  });
  machine.cpu.outPort(0x80, 0x44332211, 32);
  assert.deepEqual(events.slice(-4).map(event => [event.port, event.value]), [
    [0x80, 0x11], [0x81, 0x22], [0x82, 0x33], [0x83, 0x44],
  ]);
  assert.equal(machine.checkpointSupport().supported, false);
  assert.throws(() => machine.saveState(), /checkpoint is unsupported/);
  assert.throws(() => machine.enableI8088CycleTiming(), /refuses 8088 cycle timing/);
  assert.throws(() => machine._architecturalRegisters(), /debug register snapshot is unsupported/);
});

test('experimental 386 AT routes a pending NMI through the 386 interrupt API', () => {
  const machine = new ExperimentalI80386ATMachine();
  machine.cpu.reset();
  machine.cpu.ss = 0;
  machine.cpu.sp = 0x800;
  machine.mem[8] = 0x00;
  machine.mem[9] = 0x02;
  machine.mem[10] = 0x00;
  machine.mem[11] = 0x00;
  machine.mem[0x200] = 0xf4;
  machine.nmi();
  assert.equal(machine._serviceInterrupts(), true);
  assert.equal(machine.cpu.eip, 0x200);
  machine.step();
  assert.equal(machine.cpu.halted, true);
});

test('experimental 386 AT wakes HLT for a maskable PIC interrupt', () => {
  const machine = new ExperimentalI80386ATMachine();
  const master = machine.chips.pic1;
  const slave = machine.chips.pic2;
  master.write(0, 0x11); master.write(1, 0x20); master.write(1, 4); master.write(1, 1);
  slave.write(0, 0x11); slave.write(1, 0x28); slave.write(1, 2); slave.write(1, 1);
  machine.cpu.reset();
  machine.cpu.ss = 0;
  machine.cpu.sp = 0x800;
  machine.cpu.eflags |= 0x200;
  machine.cpu.halted = true;
  machine.mem[0x80] = 0x00;
  machine.mem[0x81] = 0x03;
  machine.mem[0x82] = 0x00;
  machine.mem[0x83] = 0x00;
  master.setIRQ(0, 1);
  machine.mem[0x300] = 0xf4;
  const machineCycles = machine.cycles;
  const cpuCycles = machine.cpu.cycles;
  assert.equal(machine.step(), 4, 'IRQ wake executes and charges the handler HLT');
  assert.equal(machine.cycles - machineCycles, 4);
  assert.equal(machine.cpu.cycles - cpuCycles, 1);
  assert.equal(machine.cpu.halted, true, 'machine.step wakes, vectors, and executes the handler HLT');
  assert.equal(machine.cpu.eip, 0x301);
});

test('experimental 386 AT does not charge idle horizons or fault-only delivery as instructions', () => {
  const idle = new ExperimentalI80386ATMachine();
  idle.cpu.halted = true;
  const idleCpuCycles = idle.cpu.cycles;
  const idleElapsed = idle.step();
  assert.ok(idleElapsed > 0);
  assert.equal(idle.cpu.cycles, idleCpuCycles, 'an idle horizon completes no instruction');

  const fault = new ExperimentalI80386ATMachine();
  const faultCpuCycles = fault.cpu.cycles;
  const originalStep = fault.cpu.step;
  fault.cpu.step = () => 1; // Models a delivered fault whose instruction did not retire.
  assert.equal(fault.step(), 1);
  assert.equal(fault.cpu.cycles, faultCpuCycles);
  fault.cpu.step = originalStep;
});

test('experimental 386 AT shutdown does not consume pending interrupt state', () => {
  const machine = new ExperimentalI80386ATMachine();
  machine.cpu.shutdown = true;
  machine.cpu.eflags |= 0x200;
  machine._nmiPending = true;
  machine.chips.pic1.setIRQ(0, 1);
  assert.equal(machine._serviceInterrupts(), false);
  assert.equal(machine._nmiPending, true);
  assert.equal(machine.chips.pic1.intActive, true);
});

test('experimental 386 AT functional pacing lets a bounded PIT poll observe terminal count', () => {
  const machine = new ExperimentalI80386ATMachine();
  machine.cpu.reset();
  machine.mem.fill(0x90, 0, 0x100); // NOP polling body
  machine._out(0x21, 0xff);         // retain IRQ0 in IRR for observation
  machine._out(0x43, 0x30);         // counter 0, lsb/msb, mode 0
  machine._out(0x40, 44);
  machine._out(0x40, 0);
  const start = machine.cycles;
  for (let instruction = 0; instruction < 60; instruction++)
    assert.equal(machine.step(), 4);
  assert.equal(machine.cycles - start, 240);
  assert.ok(machine.chips.pic1.irr & 1,
    '44 PIT ticks expire within a 60-instruction functional polling window');
});
