// SPDX-License-Identifier: MIT
// Original test cases derived from Intel's documented behavior, not emulator traces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MCS48, MCS48IllegalOpcodeError, validateMCS48State } from '../src/mcs48.js';
import { MCS48_OPCODES } from '../src/mcs48-disasm.js';

function machine(code = [], options = {}) {
  const rom = new Uint8Array(4096);
  rom.set(code);
  return new MCS48({ rom, ...options });
}

function steps(cpu, count) { for (let i = 0; i < count; i++) cpu.step(); }

test('the 230 documented NMOS opcode slots execute with their specified machine-cycle cost', () => {
  const reserved = [
    0x01, 0x06, 0x0b, 0x22, 0x33, 0x38, 0x3b, 0x63, 0x66, 0x73,
    0x82, 0x87, 0x8b, 0x9b, 0xa2, 0xa6, 0xb7, 0xc0, 0xc1, 0xc2,
    0xc3, 0xd6, 0xe0, 0xe1, 0xe2, 0xf3,
  ];
  assert.deepEqual(MCS48_OPCODES.filter((row) => !row.legal).map((row) => row.opcode), reserved);
  for (const row of MCS48_OPCODES.filter((entry) => entry.legal)) {
    const cpu = machine([row.opcode, 0x20]);
    assert.equal(cpu.step(), row.cycles, `opcode ${row.opcode.toString(16)} cost`);
    assert.equal(cpu.cycles, row.cycles);
    assert.equal(cpu.oscillatorPeriods, row.cycles * 15);
  }
});

test('undefined opcode traps before changing architectural state; NOP policy is explicit', () => {
  const cpu = machine([0x01]);
  const before = cpu.saveState();
  assert.throws(() => cpu.step(), (error) => error instanceof MCS48IllegalOpcodeError && error.address === 0 && error.opcode === 1);
  assert.deepEqual(cpu.saveState(), before);
  const compatible = machine([0x01, 0x17], { illegalOpcodeMode: 'nop' });
  assert.equal(compatible.step(), 1);
  assert.equal(compatible.pc, 1);
  compatible.step();
  assert.equal(compatible.a, 1);
});

test('ADD and ADDC produce all byte sums, carries, and auxiliary carries', () => {
  const cpu = machine([0x13, 0]);
  for (let carry = 0; carry < 2; carry++) {
    for (let left = 0; left < 256; left++) {
      for (let right = 0; right < 256; right++) {
        cpu.pc = 0;
        cpu.a = left;
        cpu.psw = 0x38 | (carry << 7);
        cpu.rom[1] = right;
        cpu.step();
        const sum = left + right + carry;
        assert.equal(cpu.a, sum % 256);
        assert.equal(cpu.carry, sum >= 256 ? 1 : 0);
        assert.equal(cpu.auxiliaryCarry, (left % 16) + (right % 16) + carry >= 16 ? 1 : 0);
        assert.equal(cpu.psw & 0x3f, 0x38, 'ADD preserves bank/F0/SP');
      }
    }
  }
  cpu.rom[0] = 0x03;
  cpu.pc = 0;
  cpu.a = 0xfe;
  cpu.rom[1] = 1;
  cpu.psw = 0x88;
  cpu.step();
  assert.equal(cpu.a, 0xff, 'ADD ignores incoming carry');
  assert.equal(cpu.carry, 0);
});

test('DA after addition implements every pair of packed decimal values with incoming carry', () => {
  const cpu = machine([0x13, 0, 0x57]);
  const packed = (n) => (Math.floor(n / 10) << 4) | (n % 10);
  for (let carry = 0; carry < 2; carry++) {
    for (let left = 0; left < 100; left++) {
      for (let right = 0; right < 100; right++) {
        cpu.pc = 0;
        cpu.a = packed(left);
        cpu.rom[1] = packed(right);
        cpu.psw = 0x38 | (carry << 7);
        cpu.step();
        const auxiliary = cpu.auxiliaryCarry;
        cpu.step();
        const sum = left + right + carry;
        assert.equal(cpu.a, packed(sum % 100));
        assert.equal(cpu.carry, sum >= 100 ? 1 : 0);
        assert.equal(cpu.auxiliaryCarry, auxiliary, 'DA preserves AC');
        assert.equal(cpu.psw & 0x3f, 0x38);
      }
    }
  }
  cpu.pc = 2;
  cpu.a = 0xfa;
  cpu.psw = 8;
  cpu.step();
  assert.equal(cpu.a, 0x60, 'low-digit correction may itself generate a carry');
  assert.equal(cpu.carry, 1);
});

test('register-bank selection, 7-bit indirect addressing, and nibble exchange share RAM correctly', () => {
  const cpu = machine([
    0xb8, 0xff, // MOV R0,#FF in bank 0
    0xb0, 0xa5, // MOV @R0,#A5 -> RAM 7F
    0x23, 0x3c, 0x30, // XCHD A,@R0 -> A=35, RAM7F=AC
    0xd5, 0xb8, 0x60, // SEL RB1; MOV R0,#60
    0xb0, 0x52, 0xf0, // bank1 pointer -> RAM60 -> A
    0xc5, 0xf0, // SEL RB0; MOV A,@R0
  ]);
  steps(cpu, 4);
  assert.equal(cpu.a, 0x35);
  assert.equal(cpu.ram[0x7f], 0xac);
  steps(cpu, 4);
  assert.equal(cpu.ram[24], 0x60);
  assert.equal(cpu.ram[0], 0xff);
  assert.equal(cpu.ram[0x60], 0x52);
  assert.equal(cpu.a, 0x52);
  steps(cpu, 2);
  assert.equal(cpu.a, 0xac);
});

test('rotations through carry change C only; INC, DEC and SWAP leave status intact', () => {
  const cpu = machine([0x67, 0xf7, 0x77, 0xe7, 0x17, 0x07, 0x47]);
  cpu.a = 0x03;
  cpu.psw = 0xf8;
  cpu.step();
  assert.equal(cpu.a, 0x81);
  assert.equal(cpu.psw, 0xf8);
  cpu.step();
  assert.equal(cpu.a, 0x03);
  assert.equal(cpu.psw, 0xf8);
  steps(cpu, 2);
  assert.equal(cpu.a, 0x03);
  steps(cpu, 3);
  assert.equal(cpu.a, 0x30);
  assert.equal(cpu.psw, 0xf8);
});

test('conditional branches use the page of the operand byte, including FE/FF edges', () => {
  for (const address of [0x0fe, 0x0ff, 0x1fe, 0x1ff, 0x8fe, 0x8ff]) {
    const cpu = machine();
    cpu.pc = address;
    cpu.a = 1;
    cpu.rom[address] = 0x96; // JNZ
    cpu.rom[address + 1] = 0x44;
    cpu.step();
    assert.equal(cpu.pc, ((address + 1) & 0xf00) | 0x44);
    cpu.pc = address;
    cpu.a = 0;
    cpu.step();
    assert.equal(cpu.pc, address + 2);
  }
});

test('DJNZ wraps 00 to FF and uses the pre-operand page; all accumulator bit tests branch', () => {
  const cpu = machine();
  cpu.rom.set([0xe8, 0x40], 0xfe);
  cpu.pc = 0xfe;
  cpu.setRegister(0, 0);
  cpu.step();
  assert.equal(cpu.pc, 0x40);
  assert.equal(cpu.getRegister(0), 255);
  cpu.pc = 0xfe;
  cpu.setRegister(0, 1);
  cpu.step();
  assert.equal(cpu.pc, 0x100);
  for (let bit = 0; bit < 8; bit++) {
    cpu.rom[0] = 0x12 + bit * 0x20;
    cpu.rom[1] = 0x55;
    cpu.pc = 0;
    cpu.a = 1 << bit;
    cpu.step();
    assert.equal(cpu.pc, 0x55);
    cpu.pc = 0;
    cpu.a ^= 255;
    cpu.step();
    assert.equal(cpu.pc, 2);
  }
});

test('test-pin, F0, F1, carry, zero, and active-low interrupt conditions are independent', () => {
  const scenarios = [
    [0x26, (cpu) => cpu.setTest(0, 0)], [0x36, (cpu) => cpu.setTest(0, 1)],
    [0x46, (cpu) => cpu.setTest(1, 0)], [0x56, (cpu) => cpu.setTest(1, 1)],
    [0x76, (cpu) => { cpu.f1 = true; }], [0xb6, (cpu) => { cpu.psw |= 0x20; }],
    [0xe6, (cpu) => { cpu.psw &= ~0x80; }], [0xf6, (cpu) => { cpu.psw |= 0x80; }],
    [0xc6, (cpu) => { cpu.a = 0; }], [0x96, (cpu) => { cpu.a = 1; }],
    [0x86, (cpu) => cpu.setInterrupt(true)],
  ];
  for (const [opcode, setCondition] of scenarios) {
    const cpu = machine([opcode, 0x71]);
    setCondition(cpu);
    cpu.step();
    assert.equal(cpu.pc, 0x71, `condition opcode ${opcode.toString(16)}`);
  }
});

test('MOVP, MOVP3 and JMPP use program memory and preserve their documented bank/page', () => {
  const cpu = machine();
  cpu.rom[0xff] = 0xa3;
  cpu.rom[0x123] = 0x69;
  cpu.pc = 0xff;
  cpu.a = 0x23;
  cpu.step();
  assert.equal(cpu.a, 0x69);
  assert.equal(cpu.pc, 0x100);
  cpu.rom[0x8ff] = 0xb3;
  cpu.rom[0x923] = 0x42;
  cpu.pc = 0x8ff;
  cpu.a = 0x23;
  cpu.step();
  assert.equal(cpu.pc, 0x942);
  assert.equal(cpu.a, 0x23);
  cpu.rom[0x800] = 0xe3;
  cpu.rom[0xb23] = 0x77;
  cpu.rom[0x323] = 0x88;
  cpu.pc = 0x800;
  cpu.a = 0x23;
  cpu.step();
  assert.equal(cpu.a, 0x77, 'MOVP3 keeps PC bit 11');
  assert.equal(cpu.pc, 0x801);
});

test('SEL MB affects JMP/CALL but sequential fetch wraps within its current 2 KiB bank', () => {
  const cpu = machine([0xf5, 0x00, 0x04, 0x20]);
  cpu.step();
  assert.equal(cpu.pc, 1, 'SEL does not immediately move PC');
  steps(cpu, 2);
  assert.equal(cpu.pc, 0x820);
  cpu.pc = 0x7ff;
  cpu.step();
  assert.equal(cpu.pc, 0);
  cpu.pc = 0xfff;
  cpu.step();
  assert.equal(cpu.pc, 0x800);
});

test('CALL stacks PC and high PSW in internal RAM; RET restores PC but preserves current flags', () => {
  const cpu = machine([0xf5, 0x14, 0x20]);
  cpu.rom[0x820] = 0x83;
  cpu.psw = 0xd8;
  steps(cpu, 2);
  assert.equal(cpu.pc, 0x820);
  assert.equal(cpu.ram[8], 3);
  assert.equal(cpu.ram[9], 0xd0);
  assert.equal(cpu.stackPointer, 1);
  cpu.psw = 0x29;
  cpu.step();
  assert.equal(cpu.pc, 3);
  assert.equal(cpu.psw, 0x28);
  assert.equal(cpu.memoryBank, 1, 'RET does not change the SEL MB latch');
});

test('stack wraps at eight levels and returns from the visible RAM contents', () => {
  const cpu = machine([0x14, 0]); // recursively CALL 0
  steps(cpu, 9);
  assert.equal(cpu.stackPointer, 1);
  for (let slot = 8; slot < 24; slot += 2) assert.equal(cpu.ram[slot], 2);
  cpu.ram[8] = 0x34;
  cpu.ram[9] = 0xa9;
  cpu.rom[0] = 0x93;
  cpu.step();
  assert.equal(cpu.pc, 0x934);
  assert.equal(cpu.psw, 0xa8);
  assert.equal(cpu.stackPointer, 0);
});

test('interrupt entry takes two cycles, forces bank zero, and RETR restores PC and high PSW', () => {
  const cpu = machine();
  cpu.pc = 0x923;
  cpu.psw = 0xd8;
  cpu.memoryBank = 1;
  cpu.externalInterruptEnabled = true;
  cpu.setInterrupt(true);
  assert.equal(cpu.step(), 2);
  assert.equal(cpu.cycles, 2);
  assert.equal(cpu.pc, 3);
  assert.equal(cpu.ram[8], 0x23);
  assert.equal(cpu.ram[9], 0xd9);
  assert.equal(cpu.interruptInProgress, true);
  assert.equal(cpu.lastStep.kind, 'interrupt');
  cpu.rom.set([0x04, 0x10], 3);
  cpu.rom[0x10] = 0x93;
  cpu.step();
  assert.equal(cpu.pc, 0x10, 'JMP ignores selected MB1 while servicing an interrupt');
  cpu.psw = 0x29;
  cpu.f1 = true;
  cpu.setInterrupt(false);
  cpu.step();
  assert.equal(cpu.pc, 0x923);
  assert.equal(cpu.psw, 0xd8);
  assert.equal(cpu.f1, true, 'F1 is not on the stack');
  assert.equal(cpu.memoryBank, 1);
  assert.equal(cpu.interruptInProgress, false);
});

test('external IRQ wins simultaneous requests, timer remains pending, and there is no nesting', () => {
  const cpu = machine();
  cpu.externalInterruptEnabled = true;
  cpu.timerInterruptEnabled = true;
  cpu.timerInterruptPending = true;
  cpu.timerFlag = true;
  cpu.setInterrupt(true);
  cpu.step();
  assert.equal(cpu.pc, 3);
  assert.equal(cpu.timerInterruptPending, true);
  cpu.step();
  assert.equal(cpu.pc, 4, 'pending IRQ does not nest');
  cpu.rom[4] = 0x93;
  cpu.setInterrupt(false);
  cpu.step();
  cpu.step();
  assert.equal(cpu.pc, 7);
  assert.equal(cpu.timerInterruptPending, false);
  assert.equal(cpu.timerFlag, true, 'servicing timer IRQ does not clear JTF flag');
});

test('holding /INT low retriggers after RETR; DIS I changes enable but not the interrupt lock', () => {
  const cpu = machine([0x05]);
  cpu.rom.set([0x15, 0x05, 0x93], 3);
  cpu.setInterrupt(true);
  cpu.step();
  cpu.step();
  assert.equal(cpu.pc, 3);
  cpu.step();
  assert.equal(cpu.externalInterruptEnabled, false);
  assert.equal(cpu.interruptInProgress, true);
  steps(cpu, 2);
  assert.equal(cpu.pc, 1);
  assert.equal(cpu.interruptInProgress, false);
  cpu.step();
  assert.equal(cpu.pc, 3);
});

test('STRT T resets the /32 prescaler; instruction and IRQ cycles both count', () => {
  const cpu = machine([0x55]);
  cpu.timer = 0x10;
  cpu.timerPrescaler = 27;
  cpu.step();
  assert.equal(cpu.timerPrescaler, 0);
  steps(cpu, 31);
  assert.equal(cpu.timer, 0x10);
  assert.equal(cpu.timerPrescaler, 31);
  cpu.externalInterruptEnabled = true;
  cpu.setInterrupt(true);
  assert.equal(cpu.step(), 2);
  assert.equal(cpu.timer, 0x11);
  assert.equal(cpu.timerPrescaler, 1);
  assert.equal(cpu.cycles, 34);
});

test('timer overflow flag exists while interrupts are disabled, without a stale pending request', () => {
  const cpu = machine([0x00, 0x25, 0x16, 0x20]);
  cpu.timer = 255;
  cpu.timerMode = 'timer';
  cpu.timerPrescaler = 31;
  cpu.step();
  assert.equal(cpu.timer, 0);
  assert.equal(cpu.timerFlag, true);
  assert.equal(cpu.timerInterruptPending, false);
  cpu.step(); // EN TCNTI
  cpu.step(); // JTF
  assert.equal(cpu.pc, 0x20);
  assert.equal(cpu.timerFlag, false);
  assert.equal(cpu.interruptInProgress, false);
  cpu.pc = 2;
  cpu.step();
  assert.equal(cpu.pc, 4, 'JTF is also cleared after a not-taken test');
});

test('DIS TCNTI clears a pending request without clearing TF or stopping the timer', () => {
  const cpu = machine([0x35, 0x65]);
  cpu.timerInterruptEnabled = true;
  cpu.timerInterruptPending = true;
  cpu.interruptInProgress = true; // pending request while serving another IRQ
  cpu.timerFlag = true;
  cpu.timerMode = 'timer';
  cpu.timerPrescaler = 30;
  cpu.step();
  assert.equal(cpu.timerInterruptEnabled, false);
  assert.equal(cpu.timerInterruptPending, false);
  assert.equal(cpu.timerFlag, true);
  assert.equal(cpu.timerMode, 'timer');
  cpu.step(); // timer clock precedes STOP in this instruction
  assert.equal(cpu.timer, 1);
  assert.equal(cpu.timerMode, 'stopped');
  steps(cpu, 40);
  assert.equal(cpu.timer, 1);
});

test('counter samples T1 every machine cycle and increments only on falling edges', () => {
  const events = [];
  const cpu = machine([0x45, 0x23, 0x42, 0x00, 0x00], {
    onCycles(count, core) {
      events.push([count, core.cycles]);
      if (core.cycles === 2 || core.cycles === 4) core.setTest(1, 0);
      if (core.cycles === 3) core.setTest(1, 1);
    },
  });
  cpu.timer = 254;
  cpu.timerInterruptEnabled = true;
  cpu.step(); // STRT CNT; records initial high T1
  cpu.step(); // two cycles: falling, rising
  assert.equal(cpu.timer, 255);
  cpu.step(); // falling
  assert.equal(cpu.timer, 0);
  assert.equal(cpu.timerFlag, true);
  assert.equal(cpu.timerInterruptPending, true);
  cpu.interruptInProgress = true;
  cpu.step(); // stable low
  assert.equal(cpu.timer, 0);
  assert.deepEqual(events, [[1, 1], [1, 2], [1, 3], [1, 4], [1, 5]]);
});

test('starting counter on a low T1 does not invent an initial falling edge', () => {
  const cpu = machine([0x45]);
  cpu.setTest(1, 0);
  cpu.step();
  steps(cpu, 3);
  assert.equal(cpu.timer, 0);
  cpu.setTest(1, 1);
  cpu.step();
  cpu.setTest(1, 0);
  cpu.step();
  assert.equal(cpu.timer, 1);
});

test('input samples pins through the output latch; ORL/ANL modify the latch, not pin levels', () => {
  const writes = [];
  const cpu = machine([0x09, 0x89, 0x01, 0x99, 0xf0, 0x0a], {
    readPort(port) { return port === 1 ? 0x55 : 0x3c; },
    writePort(port, value, core) { writes.push([port, value, core.cycles]); },
  });
  cpu.p1 = 0xaa;
  cpu.p2 = 0xf0;
  cpu.step();
  assert.equal(cpu.a, 0);
  cpu.step();
  assert.equal(cpu.p1, 0xab);
  cpu.step();
  assert.equal(cpu.p1, 0xa0);
  cpu.step();
  assert.equal(cpu.a, 0x30);
  assert.deepEqual(writes, [[1, 0xab, 2], [1, 0xa0, 4]]);
});

test('MOVX addresses the full 8-bit register, uses external callbacks, and releases BUS', () => {
  const transactions = [];
  const cpu = machine([0x90, 0x81], {
    writeExternal(at, value, core) { transactions.push(['write', at, value, core.cycles]); },
    readExternal(at, core) { transactions.push(['read', at, core.cycles]); return 0xa9; },
  });
  cpu.setRegister(0, 0xe1);
  cpu.setRegister(1, 0xf2);
  cpu.a = 0x5a;
  cpu.bus = 0x23;
  cpu.busOutputEnabled = true;
  steps(cpu, 2);
  assert.deepEqual(transactions, [['write', 0xe1, 0x5a, 0], ['read', 0xf2, 2]]);
  assert.equal(cpu.a, 0xa9);
  assert.equal(cpu.busOutputEnabled, false);
  assert.equal(cpu.cycles, 4);
});

test('BUS I/O, latch logic, and expander nibble commands reach their hooks', () => {
  const busWrites = [];
  const portWrites = [];
  const expanderWrites = [];
  const prog = [];
  const cpu = machine([0x02, 0x88, 0x03, 0x98, 0x3f, 0x08, 0x3d, 0x8d, 0x9d, 0x0d], {
    writeBus(value) { busWrites.push(value); }, readBus() { return 0x96; },
    writePort(port, value) { portWrites.push([port, value]); },
    writeExpander(port, value, operation, operand) { expanderWrites.push([port, value, operation, operand]); },
    readExpander() { return 0xab; }, writeProg(level) { prog.push(level); },
  });
  cpu.a = 0xa0;
  steps(cpu, 4);
  assert.deepEqual(busWrites, [0xa0, 0xa3, 0x23]);
  assert.equal(cpu.a, 0x96);
  assert.equal(cpu.busOutputEnabled, false);
  cpu.p2 = 0xa0;
  cpu.a = 0xf3;
  cpu.step();
  cpu.a = 4;
  cpu.step();
  cpu.a = 6;
  cpu.step();
  cpu.a = 0xff;
  cpu.step();
  assert.deepEqual(expanderWrites, [[5, 3, 'write', 3], [5, 7, 'or', 4], [5, 6, 'and', 6]]);
  assert.deepEqual(portWrites, [[2, 0xa5], [2, 0xa3], [2, 0xa9], [2, 0xa4], [2, 0xad], [2, 0xa6], [2, 0xa1], [2, 0xaf]]);
  assert.deepEqual(prog, [0, 1, 0, 1, 0, 1, 0, 1]);
  assert.equal(cpu.a, 0x0b, 'MOVD clears high accumulator nibble');
  assert.equal(cpu.p2, 0xaf, 'MOVD read releases P2 low nibble');
});

test('RESET clears control state but retains A, carry, auxiliary carry, timer, and RAM', () => {
  const ports = [];
  const clocks = [];
  const cpu = machine([0x75], {
    writePort(port, value) { ports.push([port, value]); },
    clockOutput(enabled) { clocks.push(enabled); },
  });
  cpu.step();
  cpu.a = 0xa5;
  cpu.timer = 0x81;
  cpu.ram[100] = 0x42;
  cpu.psw = 0xff;
  cpu.memoryBank = 1;
  cpu.f1 = true;
  cpu.timerFlag = true;
  cpu.timerInterruptPending = true;
  cpu.timerInterruptEnabled = true;
  cpu.externalInterruptEnabled = true;
  cpu.interruptInProgress = true;
  cpu.timerMode = 'counter';
  cpu.p1 = 0;
  cpu.p2 = 0;
  cpu.reset();
  assert.equal(cpu.pc, 0);
  assert.equal(cpu.psw, 0xc8);
  assert.equal(cpu.a, 0xa5);
  assert.equal(cpu.timer, 0x81);
  assert.equal(cpu.ram[100], 0x42);
  assert.equal(cpu.memoryBank, 0);
  assert.equal(cpu.f1, false);
  assert.equal(cpu.timerFlag, false);
  assert.equal(cpu.timerInterruptPending, false);
  assert.equal(cpu.timerInterruptEnabled, false);
  assert.equal(cpu.externalInterruptEnabled, false);
  assert.equal(cpu.interruptInProgress, false);
  assert.equal(cpu.timerMode, 'stopped');
  assert.equal(cpu.busOutputEnabled, false);
  assert.equal(cpu.p1, 255);
  assert.equal(cpu.p2, 255);
  assert.equal(cpu.cycles, 0);
  assert.deepEqual(ports, [[1, 255], [2, 255]]);
  assert.deepEqual(clocks, [true, false]);
  cpu.reset({ cold: true });
  assert.equal(cpu.a, 0);
  assert.equal(cpu.timer, 0);
  assert.equal(cpu.psw, 8);
  assert.equal(cpu.ram[100], 0);
});

test('PSW bit 3 always reads as one, including MOV PSW,A and MOV A,PSW', () => {
  const cpu = machine([0xd7, 0xc7]);
  cpu.a = 0x97;
  cpu.step();
  assert.equal(cpu.psw, 0x9f);
  cpu.step();
  assert.equal(cpu.a, 0x9f);
});

test('snapshot restore is deterministic, copied, callback-free, and transactional on every bad field', () => {
  const writes = [];
  const cpu = machine([0x55, 0x17, 0x04, 1], { writePort(...args) { writes.push(args); } });
  steps(cpu, 20);
  cpu.setTest(0, 0);
  cpu.expanderLatches[2] = 3;
  const saved = cpu.saveState();
  steps(cpu, 40);
  const future = cpu.saveState();
  cpu.loadState(saved);
  assert.deepEqual(cpu.saveState(), saved);
  assert.equal(writes.length, 0);
  steps(cpu, 40);
  assert.deepEqual(cpu.saveState(), future);
  saved.ram[0] = 0xab;
  assert.notEqual(cpu.ram[0], 0xab, 'restored state must not alias caller arrays');
  const before = cpu.saveState();
  const invalid = [
    (s) => { s.version = 2; }, (s) => { s.pc = -1; }, (s) => { s.a = 1.5; },
    (s) => { s.psw = 0; }, (s) => { s.timerPrescaler = 32; },
    (s) => { s.cycles = NaN; }, (s) => { s.f1 = 1; },
    (s) => { s.timerMode = 'running'; }, (s) => { s.ram[127] = 256; },
    (s) => { s.rom.pop(); }, (s) => { s.expanderLatches[3] = 16; },
    (s) => { s.testPins[1] = 2; }, (s) => { s.illegalOpcodeMode = 'execute'; },
    (s) => { s.timerInterruptEnabled = false; s.timerInterruptPending = true; },
    (s) => { s.interruptInProgress = true; s.pc = 0x800; },
  ];
  for (const corrupt of invalid) {
    const bad = structuredClone(before);
    corrupt(bad);
    assert.throws(() => cpu.loadState(bad));
    assert.deepEqual(cpu.saveState(), before);
  }
  const checked = validateMCS48State(before);
  checked.ram[0] ^= 255;
  assert.deepEqual(cpu.saveState(), before);
});

test('ROM loads validate before changing code and preserve exact bank offsets', () => {
  const cpu = machine([0x17]);
  const before = Array.from(cpu.rom);
  assert.throws(() => cpu.loadRom([0, -1]));
  assert.deepEqual(Array.from(cpu.rom), before);
  assert.throws(() => cpu.loadRom(new Uint8Array(2), { offset: 4095 }));
  assert.deepEqual(Array.from(cpu.rom), before);
  cpu.loadRom(new Uint8Array([0x23, 0x55]).buffer, { offset: 0x800, clear: false });
  assert.equal(cpu.rom[0], 0x17);
  cpu.pc = 0x800;
  cpu.step();
  assert.equal(cpu.a, 0x55);
});
