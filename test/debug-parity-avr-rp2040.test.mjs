/**
 * Debug parity: step-over/out + write watchpoints for avr8js and rp2040js,
 * mirroring the 6502/Z80 tests in debug-parity.test.mjs.
 *
 * AVR program (ATmega328P, word-addressed progMem, byte-addressed PC):
 *   0x0000: RCALL +3   (0xD003 — call subroutine at 0x0008)
 *   0x0002: LDI R16,1  (0xE001)
 *   0x0004: BREAK      (0x9598 — halts the CPU)
 *   0x0006: NOP        (0x0000)
 *   0x0008: LDI R16,$42 (0xE402)
 *   0x000A: STS $0100,R16 (0x9300 0x0100 — store R16 to SRAM $0100)
 *   0x000E: RET        (0x9508)
 *
 * RP2040 program (Thumb, at SRAM 0x20000000):
 *   0x00: BL +8        (call subroutine at 0x0C)
 *   0x04: MOVS R0,#1
 *   0x06: BKPT #0      (halt)
 *   0x08: NOP; NOP     (padding)
 *   0x0C: MOVS R0,#0x42
 *   0x0E: LDR R1,=0x20001000 (from literal pool)
 *   0x10: STR R0,[R1]  (store to 0x20001000)
 *   0x12: BX LR        (return)
 *   0x14: literal pool: 0x20001000
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvr8jsAdapter } from '../src/avr8js-adapter.js';
import { createAvr8jsDebugTarget } from '../src/avr8js-debug.js';

// ─── AVR test setup ───────────────────────────────────────────────
function avrSetup() {
  const adapter = createAvr8jsAdapter({ chip: 'atmega328p' });
  const cpu = adapter.cpu;

  // Hand-assemble the program into progMem (word-addressed)
  // Word 0 (byte 0x0000): RCALL +3 → opcode 0xD003
  cpu.progMem[0] = 0xd003;
  // Word 1 (byte 0x0002): LDI R16, 0x01 → 0xE001
  cpu.progMem[1] = 0xe001;
  // Word 2 (byte 0x0004): BREAK → 0x9598
  cpu.progMem[2] = 0x9598;
  // Word 3 (byte 0x0006): NOP
  cpu.progMem[3] = 0x0000;
  // Word 4 (byte 0x0008): LDI R16, 0x42 → 0xE402 (LDI Rd,K: 1110 KKKK dddd KKKK, d=R16=0, K=0x42)
  cpu.progMem[4] = 0xe402;
  // Words 5-6 (byte 0x000A): STS $0100, R16 → 0x9300 0x0100
  cpu.progMem[5] = 0x9300;
  cpu.progMem[6] = 0x0100;
  // Word 7 (byte 0x000E): RET → 0x9508
  cpu.progMem[7] = 0x9508;

  cpu.pc = 0; // word address 0
  // SP starts at end of SRAM (ATmega328P: 0x08FF)
  cpu.data[0x5d] = 0xff; cpu.data[0x5e] = 0x08;

  const target = createAvr8jsDebugTarget(adapter);
  return { adapter, cpu, target };
}

// ─── AVR tests ────────────────────────────────────────────────────

test('AVR step-over: RCALL body runs, halts after it', () => {
  const { cpu, target } = avrSetup();
  target.step('over');
  assert.equal(target.runFor(1_000_000_000), 'halted');
  assert.equal(target.regs().pc, 0x0002, 'halted at instruction after RCALL');
  // R16 (data[16]) should be 0x42 from the subroutine
  assert.equal(cpu.data[16], 0x42, 'subroutine ran (R16 = 0x42)');
});

test('AVR step-out: from inside subroutine back to caller', () => {
  const { target } = avrSetup();
  target.step('insn'); target.runFor(1_000_000_000); // execute RCALL
  assert.equal(target.regs().pc, 0x0008, 'inside subroutine');
  target.step('out');
  assert.equal(target.runFor(1_000_000_000), 'halted');
  assert.equal(target.regs().pc, 0x0002, 'back at return site');
});

test('AVR step-over on non-call is single step', () => {
  const { cpu, target } = avrSetup();
  // Step into the subroutine first
  target.step('insn'); target.runFor(1_000_000_000);
  assert.equal(target.regs().pc, 0x0008);
  // Now step-over on LDI (not a call) → single step
  target.step('over'); target.runFor(1_000_000_000);
  assert.equal(target.regs().pc, 0x000a, 'one instruction, no depth wait');
});

test('AVR write watchpoint: STS fires with address and value', () => {
  const { target } = avrSetup();
  const id = target.setBreakpoint({ kind: 'write', addr: 0x0100 });
  assert.equal(typeof id, 'number');
  let cause = null;
  target.onHalt((info) => { cause = info; });
  target.run();
  target.runFor(1_000_000_000);
  assert.ok(cause, 'halt callback fired');
  assert.equal(cause.cause, 'watchpoint');
  assert.equal(cause.addr, 0x0100);
  assert.equal(cause.value, 0x42);
  target.clearBreakpoint(id);
});

test('AVR capabilities declare over/out/write', () => {
  const { target } = avrSetup();
  const c = target.capabilities();
  assert.ok(c.steps.includes('over'));
  assert.ok(c.steps.includes('out'));
  assert.ok(c.breakpoints.includes('write'));
});

// ─── RP2040 tests ─────────────────────────────────────────────────

let rp2040Available = true;
try {
  await import('rp2040js');
} catch {
  rp2040Available = false;
}

test('RP2040 step-over: BL body runs, halts after it', {
  skip: !rp2040Available && 'rp2040js not available',
}, async () => {
  const { createRp2040jsAdapter } = await import('../src/rp2040js-adapter.js');
  const { createRp2040jsDebugTarget } = await import('../src/rp2040js-debug.js');

  const adapter = createRp2040jsAdapter();
  const { rp2040, core } = adapter;

  // Hand-assemble Thumb program at SRAM start (0x20000000)
  const base = 0x20000000;
  // BL +8 (to 0x0C): encoding = F000 F004 (offset = 0x0C - 0x04 = 8, /2 = 4)
  rp2040.writeUint16(base + 0x00, 0xf000); // BL high
  rp2040.writeUint16(base + 0x02, 0xf804); // BL low (offset 4 halfwords = +8 bytes from PC+4)
  // MOVS R0, #1
  rp2040.writeUint16(base + 0x04, 0x2001);
  // BKPT #0 (would normally fault; we use it as a marker to stop)
  rp2040.writeUint16(base + 0x06, 0xbe00);
  // NOP padding
  rp2040.writeUint16(base + 0x08, 0x46c0);
  rp2040.writeUint16(base + 0x0a, 0x46c0);
  // Subroutine at 0x0C:
  // MOVS R0, #0x42
  rp2040.writeUint16(base + 0x0c, 0x2042);
  // LDR R1, [PC, #4] (literal pool at PC+4+2 aligned = base+0x14)
  rp2040.writeUint16(base + 0x0e, 0x4901);
  // STR R0, [R1, #0]
  rp2040.writeUint16(base + 0x10, 0x6008);
  // BX LR
  rp2040.writeUint16(base + 0x12, 0x4770);
  // Literal pool at 0x14: address 0x20001000
  rp2040.writeUint32(base + 0x14, 0x20001000);

  // Set PC and SP
  core.PC = base | 1; // Thumb bit
  core.SP = base + 0x8000; // SP high in SRAM
  core.LR = 0; // no return

  const target = createRp2040jsDebugTarget(adapter);

  target.step('over');
  const result = target.runFor(1_000_000_000);
  assert.equal(result, 'halted');
  assert.equal(target.regs().pc, base + 0x04, 'halted after BL');
  // R0 should be 0x42 from the subroutine
  assert.equal(core.registers[0], 0x42, 'subroutine ran');
  // SRAM at 0x20001000 should have 0x42
  assert.equal(rp2040.readUint8(0x20001000), 0x42, 'store executed');
});

test('RP2040 write watchpoint: STR fires with address and value', {
  skip: !rp2040Available && 'rp2040js not available',
}, async () => {
  const { createRp2040jsAdapter } = await import('../src/rp2040js-adapter.js');
  const { createRp2040jsDebugTarget } = await import('../src/rp2040js-debug.js');

  const adapter = createRp2040jsAdapter();
  const { rp2040, core } = adapter;
  const base = 0x20000000;

  // Simple program: MOVS R0, #0x42; LDR R1, [PC, #0]; STR R0, [R1]; BKPT
  // Literal at +8: 0x20001000
  rp2040.writeUint16(base + 0x00, 0x2042); // MOVS R0, #0x42
  rp2040.writeUint16(base + 0x02, 0x4901); // LDR R1, [PC, #4] → base+0x08
  rp2040.writeUint16(base + 0x04, 0x6008); // STR R0, [R1]
  rp2040.writeUint16(base + 0x06, 0xbe00); // BKPT
  rp2040.writeUint32(base + 0x08, 0x20001000);

  core.PC = base | 1;
  core.SP = base + 0x8000;

  const target = createRp2040jsDebugTarget(adapter);
  const id = target.setBreakpoint({ kind: 'write', addr: 0x20001000 });
  assert.equal(typeof id, 'number');

  let cause = null;
  target.onHalt((info) => { cause = info; });
  target.run();
  target.runFor(1_000_000_000);
  assert.ok(cause, 'halt callback fired');
  assert.equal(cause.cause, 'watchpoint');
  assert.equal(cause.addr, 0x20001000);
  assert.equal(cause.value, 0x42);
  target.clearBreakpoint(id);
});

test('RP2040 capabilities declare over/out/write', {
  skip: !rp2040Available && 'rp2040js not available',
}, async () => {
  const { createRp2040jsAdapter } = await import('../src/rp2040js-adapter.js');
  const { createRp2040jsDebugTarget } = await import('../src/rp2040js-debug.js');
  const adapter = createRp2040jsAdapter();
  const target = createRp2040jsDebugTarget(adapter);
  const c = target.capabilities();
  assert.ok(c.steps.includes('over'));
  assert.ok(c.steps.includes('out'));
  assert.ok(c.breakpoints.includes('write'));
});
