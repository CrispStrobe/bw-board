import assert from 'node:assert/strict';
import test from 'node:test';

import ExperimentalI80386ATMachine, {
  PCAT80386_EXPERIMENTAL,
  PCAT80386_EXPERIMENTAL_4M,
  PCAT80386_EXPERIMENTAL_4M_HDD,
  PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS,
  PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP,
  PCAT80386_EXPERIMENTAL_16M_HDD_XV6_SMP,
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
  assert.equal(machine.step(), 6, 'completed reset-vector HLT receives functional charge');
  assert.equal(machine.cpu.halted, true);
});

test('FreeDOS HDD profile grades the 1.2MB medium data rate without changing seek policy', () => {
  const ordinary = new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M_HDD);
  const freedos = new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS);
  assert.equal(ordinary.chips.fdc1.seekBeyondEnd, 'error');
  assert.equal(freedos.chips.fdc1.seekBeyondEnd, 'error');
  assert.deepEqual(freedos.chips.fdc1.acceptedCcrByImageBytes,{1228800:[0]});
});

test('experimental 386 HDD profile reports IBM type 1 drive C with a matching CMOS checksum', () => {
  const machine = new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M_HDD);
  const cmos = register => {
    machine._out(0x70, register);
    return machine._in(0x71);
  };
  assert.equal(cmos(0x12), 0x10);
  let checksum = 0;
  for (let register = 0x10; register <= 0x2d; register++) checksum += cmos(register);
  assert.equal(checksum & 0xffff, cmos(0x2f) | cmos(0x2e) << 8);
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

test('experimental 386 AT 4MiB profile exposes only installed RAM and matching CMOS sizes', () => {
  const machine = new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M);
  machine.cpu.write(0x45ffff, 0x5a);
  machine.cpu.write(0x460000, 0xa5);
  assert.equal(machine.cpu.read(0x45ffff), 0x5a);
  assert.equal(machine.cpu.read(0x460000), 0xff, 'first byte beyond installed RAM is open bus');

  const cmos = register => {
    machine._out(0x70, register);
    return machine._in(0x71);
  };
  assert.equal(cmos(0x15) | cmos(0x16) << 8, 640);
  assert.equal(cmos(0x17) | cmos(0x18) << 8, 3456);
  assert.equal(cmos(0x30) | cmos(0x31) << 8, 3456);
  let checksum = 0;
  for (let register = 0x10; register <= 0x2d; register++) checksum += cmos(register);
  assert.equal(checksum & 0xffff, cmos(0x2f) | cmos(0x2e) << 8);
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
  assert.equal(machine.step(), 6, 'completed reset-vector HLT receives functional charge');
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

test('xv6 stock profile exposes the 14MiB PHYSTOP RAM window', () => {
  const machine = new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_16M_HDD_XV6_SMP);
  machine.cpu.write(0xe00000, 0x5a);
  assert.equal(machine.cpu.read(0xe00000), 0x5a);
  assert.equal(machine.cpu.read(0x1000000), 0xff);
  const cmos = register => { machine._out(0x70, register); return machine._in(0x71); };
  let checksum = 0;
  for (let register = 0x10; register <= 0x2d; register++) checksum += cmos(register);
  assert.equal(checksum & 0xffff, cmos(0x2f) | cmos(0x2e) << 8);
});

test('xv6 SMP profile exposes checksummed MP metadata and non-sticky LAPIC delivery status', () => {
  const machine = new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP);
  machine._mpReady = true;
  const read = address => machine._read386(address);
  assert.deepEqual([read(0x9fc00), read(0x9fc01), read(0x9fc02), read(0x9fc03)], [0x5f, 0x4d, 0x50, 0x5f]);
  machine._write386(0xfee00300, 0x8100);
  assert.equal(read(0xfee00300) & 0x1000, 0, 'LAPIC ICR delivery completes');
});

test('xv6 SMP profile routes an enabled IDE IRQ through the IOAPIC vector', () => {
  const machine = new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP);
  machine._ioapic[0x10 + 14 * 2] = 0x2e;
  machine._apicIrq[14] = 1;
  machine.cpu.eflags |= 0x200;
  let vector = null;
  machine.cpu.interrupt = value => { vector = value; };
  assert.equal(machine._serviceInterrupts(), true);
  assert.equal(vector, 0x2e);
  assert.equal(machine._apicIrq[14], 0);
});

test('xv6 SMP profile emits a deterministic periodic LAPIC timer interrupt', () => {
  const machine = new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP);
  machine._mpReady = true;
  machine.cpu.eflags |= 0x200;
  let vector = null;
  machine.cpu.interrupt = value => { vector = value; };
  const write32 = (address, value) => { for (let byte = 0; byte < 4; byte++) machine._write386(address + byte, value >>> (byte * 8)); };
  write32(0xfee000f0, 0x100); // software-enable the local APIC
  write32(0xfee00320, 0x20 | 0x20000); // periodic, vector 32
  write32(0xfee00380, 10); // initial count in functional cycles
  machine.cycles = 10;
  assert.equal(machine._serviceInterrupts(), true);
  assert.equal(vector, 0x20);
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
  assert.equal(machine.step(), 6, 'IRQ wake executes and charges the handler HLT');
  assert.equal(machine.cycles - machineCycles, 6);
  assert.equal(machine.cpu.cycles - cpuCycles, 1);
  assert.equal(machine.cpu.halted, true, 'machine.step wakes, vectors, and executes the handler HLT');
  assert.equal(machine.cpu.eip, 0x301);
});

test('experimental 386 AT does not charge idle horizons or fault-only delivery as instructions', () => {
  const idle = new ExperimentalI80386ATMachine();
  idle.cpu.halted = true;
  const idleCpuCycles = idle.cpu.cycles;
  const idleMachineCycles = idle.cycles;
  const idleElapsed = idle.step();
  assert.ok(idleElapsed > 0);
  assert.equal(idle.cpu.cycles, idleCpuCycles, 'an idle horizon completes no instruction');
  assert.equal(idle.cycles - idleMachineCycles, idleElapsed,
    'idle receives its horizon without an extra instruction charge');

  const fault = new ExperimentalI80386ATMachine();
  fault.cpu.cs = 0;
  fault.cpu._loadSeg(1, 0);
  fault.cpu.eip = 0;
  fault.cpu.ss = 0x100;
  fault.cpu._loadSeg(2, 0x100);
  fault.cpu.sp = 0x100;
  fault.cpu.eflags = 0x202;
  fault.mem.set([0x00, 0x02, 0x00, 0x20], 6 * 4);
  fault.mem.set([0x8e, 0xc8], 0); // MOV CS is #UD on 386.
  const faultCpuCycles = fault.cpu.cycles;
  const faultMachineCycles = fault.cycles;
  assert.equal(fault.step(), 0);
  assert.equal(fault.cpu.cycles, faultCpuCycles);
  assert.equal(fault.cycles, faultMachineCycles,
    'architectural fault delivery receives no instruction charge');
  assert.deepEqual([fault.cpu.cs, fault.cpu.ip, fault.cpu.sp], [0x2000, 0x200, 0xfa]);
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
    assert.equal(machine.step(), 6);
  assert.equal(machine.cycles - start, 360);
  assert.ok(machine.chips.pic1.irr & 1,
    '44 PIT ticks expire within a 60-instruction functional polling window');
});

test('experimental 386 AT firmware-shaped RTC polling observes and exits the UIP window', () => {
  const pollingProgram = [
    0xbb, 0x03, 0x00,       // MOV BX,3
    0xb9, 0x00, 0x00,       // retry: MOV CX,0 (65536 iterations)
    0xb0, 0x0a, 0xe6, 0x70, // poll: select register A
    0xe4, 0x71, 0xa8, 0x80, // read and test UIP
    0x75, 0x07,             // JNZ observed
    0xe2, 0xf4,             // LOOP poll
    0xfe, 0xcb, 0x75, 0xed, // DEC BL; JNZ retry
    0xf4,                   // timeout HLT
    0xc6, 0x06, 0x00, 0x01, 0x01, // observed: MOV byte [0100],1
    0xf4,
  ];
  const runPoll = functionalInstructionCycles => {
    const machine = new ExperimentalI80386ATMachine({
      ...PCAT80386_EXPERIMENTAL,
      functionalInstructionCycles,
    });
    machine.cpu.reset();
    machine.mem.set(pollingProgram, 0);
    // Put the next UIP window beyond the old four-clock polling budget but
    // inside the six-clock budget.
    machine.chips.rtc1.cyclePhase = 1_000_000;
    for (let steps = 0; steps < 1_200_000 && !machine.cpu.halted; steps++)
      machine.step();
    return machine;
  };

  assert.equal(runPoll(4).mem[0x100], 0, 'the former charge times out before UIP');
  const paced = runPoll(6);
  assert.equal(paced.mem[0x100], 1, 'the admitted profile observes UIP');
  paced._out(0x70, 0x0a);
  assert.ok(paced._in(0x71) & 0x80);
  paced.cpu.halted = false;
  paced.cpu.eip = 0x200;
  paced.mem.fill(0x90, 0x200, 0x400);
  for (let instruction = 0; instruction < 300; instruction++) paced.step();
  assert.equal(paced._in(0x71) & 0x80, 0, 'UIP clears after its bounded update window');
});
