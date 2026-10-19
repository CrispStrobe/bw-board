/**
 * M6502Machine saveState/loadState — round-trip lockstep test.
 *
 * Runs a program partway, snapshots, runs further, restores the
 * snapshot, runs the SAME distance again, and asserts the CPU + memory
 * state matches. Same pattern as the Z80 test in tms9918.test.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { M6502Machine, EATER6502 } from '../src/m6502-machine.js';

// A program that counts in a loop writing to $0100:
//   LDX #0         ; 0x8000
//   STX $0100      ; 0x8002
//   INX            ; 0x8005
//   CPX #$10       ; 0x8006
//   BNE $8002      ; 0x8008
//   STP            ; 0x800A
const PROG = [
  0xa2, 0x00,       // LDX #0
  0x8e, 0x00, 0x01, // STX $0100
  0xe8,             // INX
  0xe0, 0x10,       // CPX #$10
  0xd0, 0xf8,       // BNE -8 (→ $8002)
  0xdb,             // STP
];

function makeMachine() {
  const m = new M6502Machine(EATER6502, {});
  m.loadRom(PROG);
  m.mem[0xfffc] = 0x00; m.mem[0xfffd] = 0x80; // reset vector
  m.reset();
  return m;
}

test('M6502 save/load round-trip: state matches after restore', () => {
  const m1 = makeMachine();

  // Run partway — 20 instructions (loop iterations: X goes 0→3ish)
  for (let i = 0; i < 20; i++) m1.step();
  const snap = m1.saveState();

  // Record CPU state at snapshot
  const snapPC = m1.cpu.pc;
  const snapX = m1.cpu.x;
  const snapCycles = m1.cycles;
  const snapMem = m1.mem[0x0100];

  // Run another 10 instructions (state diverges, still in loop)
  for (let i = 0; i < 10; i++) m1.step();
  assert.ok(m1.cpu.x !== snapX || m1.cpu.pc !== snapPC, 'state changed after snapshot');

  // Restore the snapshot
  m1.loadState(snap);
  assert.equal(m1.cpu.pc, snapPC, 'PC restored');
  assert.equal(m1.cpu.x, snapX, 'X restored');
  assert.equal(m1.cycles, snapCycles, 'cycles restored');
  assert.equal(m1.mem[0x0100], snapMem, 'memory restored');

  // Run 10 instructions from the restored state
  for (let i = 0; i < 10; i++) m1.step();
  const afterRestore = { pc: m1.cpu.pc, x: m1.cpu.x, cycles: m1.cycles, m: m1.mem[0x0100] };

  // Do the same from a fresh machine: run 20 + 10 = 30 instructions
  const m2 = makeMachine();
  for (let i = 0; i < 30; i++) m2.step();

  assert.equal(afterRestore.pc, m2.cpu.pc, 'PC matches after lockstep');
  assert.equal(afterRestore.x, m2.cpu.x, 'X matches after lockstep');
  assert.equal(afterRestore.cycles, m2.cycles, 'cycles match after lockstep');
  assert.equal(afterRestore.m, m2.mem[0x0100], 'memory matches after lockstep');
});

test('M6502 saveState includes VIA chip state', () => {
  const m = new M6502Machine(EATER6502, {});
  m.loadRom([0xdb]); // STP
  m.mem[0xfffc] = 0x00; m.mem[0xfffd] = 0x80;
  m.reset();

  // Write to VIA DDRB (reg 2) and ORB (reg 0)
  m.chips.via1.write(2, 0xff); // DDRB = all output
  m.chips.via1.write(0, 0x42); // ORB = 0x42

  const snap = m.saveState();
  assert.ok(snap.chips.via1, 'VIA state included');
  assert.equal(snap.chips.via1.ddrb, 0xff, 'DDRB saved');
  assert.equal(snap.chips.via1.orb, 0x42, 'ORB saved');

  // Mutate VIA, then restore
  m.chips.via1.write(0, 0x00);
  m.loadState(snap);
  // ORB restored
  assert.equal(m.chips.via1.orb, 0x42, 'ORB restored after loadState');
});

test('saveState version must be 1', () => {
  const m = makeMachine();
  assert.throws(() => m.loadState({ v: 99 }), /unknown machine state version/);
});
