// 6502 breadboard computer wired through the factory + board — the same
// BLINK_ROM fixture from m6502-machine.test.mjs, now proving the full
// boundary-A → board → boundary-D path.
//
// Oracle arithmetic (from the machine test):
//   T1 latch = 998 → period = 1000 cycles = 1.000 ms at 1 MHz.
//   Each T1 timeout, the ROM toggles via1.PA0.
//   In 6 ms: 5+ edges on via1.PA0, alternating 1/0, grid-aligned ±10 µs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDebugTarget, getTargetKinds } from '../src/debug-target-factory.js';
import { BoardImpl } from '../src/board.js';

// LDA/STA setup, poll IFR6, clear via T1C-L, toggle PA0.
// Identical to the fixture in m6502-machine.test.mjs.
const BLINK_ROM = new Uint8Array([
    0xa9, 0xff, 0x8d, 0x03, 0x60,       // LDA #$FF, STA DDRA
    0xa9, 0x40, 0x8d, 0x0b, 0x60,       // LDA #$40, STA ACR (T1 free-run)
    0xa9, 0xe6, 0x8d, 0x04, 0x60,       // LDA #$E6, STA T1C-L (998 lo)
    0xa9, 0x03, 0x8d, 0x05, 0x60,       // LDA #$03, STA T1C-H (start)
    0xad, 0x0d, 0x60,                    // wait: LDA IFR
    0x29, 0x40,                          // AND #$40
    0xf0, 0xf9,                          // BEQ wait
    0xad, 0x04, 0x60,                    // LDA T1C-L (clear IFR6)
    0xad, 0x01, 0x60,                    // LDA ORA
    0x49, 0x01,                          // EOR #$01
    0x8d, 0x01, 0x60,                    // STA ORA (toggle PA0)
    0x4c, 0x14, 0x80,                    // JMP wait
]);

// Build a full ROM image: 32 KB, program at $8000, reset vector at $FFFC.
function makeRomImage() {
  const rom = new Uint8Array(0x8000);
  rom.set(BLINK_ROM, 0); // starts at $8000 (offset 0 in the rom image)
  rom[0x7ffc] = 0x00; // $FFFC → $8000
  rom[0x7ffd] = 0x80; // $FFFD
  return rom;
}

test('factory: eater6502 creates adapter and debug target', async () => {
  const board = new BoardImpl(5.0);
  board.setNetlist(
    [
      { id: 'eater', kind: 'mcu', params: {}, terminals: ['via1.PA0'] },
      { id: 'g', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ],
    [
      { id: 'n1', terminals: [{ part: 'eater', terminal: 'via1.PA0' }] },
      { id: 'ng', terminals: [{ part: 'g', terminal: 'gnd' }] },
    ]
  );
  board.setPower(true);

  const { target, adapter } = await createDebugTarget('eater6502', {
    board,
    rom: makeRomImage(),
  });

  assert.ok(adapter, 'adapter created');
  assert.ok(target, 'debug target created');
  assert.equal(adapter.clockHz, 1_000_000);
});

test('factory: blink ROM through eater6502 toggles via1.PA0 on the board', async () => {
  const board = new BoardImpl(5.0);
  board.setNetlist(
    [
      { id: 'eater', kind: 'mcu', params: {}, terminals: ['via1.PA0'] },
      { id: 'g', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ],
    [
      { id: 'n1', terminals: [{ part: 'eater', terminal: 'via1.PA0' }] },
      { id: 'ng', terminals: [{ part: 'g', terminal: 'gnd' }] },
    ]
  );
  board.setPower(true);

  const { adapter } = await createDebugTarget('eater6502', {
    board,
    rom: makeRomImage(),
  });

  // Run 6 ms of simulated time — should produce 5+ edges on via1.PA0
  adapter.advanceNs(6_000_000);

  // Read the pin state from the board — it should have been driven
  const pinState = board.pinStates.get('via1.pa0');
  assert.ok(pinState, 'via1.PA0 must have been driven');
  assert.equal(pinState.mode, 'pushpull', 'VIA outputs are push-pull');
});

test('factory: debug target step and regs work on 6502', async () => {
  const board = new BoardImpl(5.0);
  board.setNetlist(
    [
      { id: 'eater', kind: 'mcu', params: {}, terminals: ['via1.PA0'] },
      { id: 'g', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ],
    [
      { id: 'n1', terminals: [{ part: 'eater', terminal: 'via1.PA0' }] },
      { id: 'ng', terminals: [{ part: 'g', terminal: 'gnd' }] },
    ]
  );
  board.setPower(true);

  const { target } = await createDebugTarget('eater6502', {
    board,
    rom: makeRomImage(),
  });

  // Initial state after reset: PC = $8000
  const regs = target.regs();
  assert.equal(regs.pc, 0x8000, 'reset vector → $8000');
  assert.equal(typeof regs.a, 'number');
  assert.equal(typeof regs.sp, 'number');

  // Single-step: LDA #$FF (2 bytes, 2 cycles)
  target.step('insn', 1);
  assert.equal(target.runFor(1_000_000), 'halted');
  const after = target.regs();
  assert.equal(after.pc, 0x8002, 'advanced past LDA #$FF');
  assert.equal(after.a, 0xff, 'A loaded with $FF');
});

test('factory: code breakpoint halts at the target address', async () => {
  const board = new BoardImpl(5.0);
  board.setNetlist(
    [
      { id: 'eater', kind: 'mcu', params: {}, terminals: ['via1.PA0'] },
      { id: 'g', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ],
    [
      { id: 'n1', terminals: [{ part: 'eater', terminal: 'via1.PA0' }] },
      { id: 'ng', terminals: [{ part: 'g', terminal: 'gnd' }] },
    ]
  );
  board.setPower(true);

  const { target } = await createDebugTarget('eater6502', {
    board,
    rom: makeRomImage(),
  });

  const halts = [];
  target.onHalt(why => halts.push(why));

  // Break at the poll loop: $8014 (LDA IFR)
  const handle = target.setBreakpoint({ kind: 'code', addr: 0x8014 });
  assert.equal(typeof handle, 'number');

  target.run();
  assert.equal(target.runFor(5_000_000), 'halted');
  assert.equal(target.regs().pc, 0x8014, 'stopped at breakpoint');
  assert.equal(halts[0].cause, 'breakpoint');
  assert.equal(halts[0].bp, handle);
});

test('factory: capabilities declare what the 6502 target offers', async () => {
  const board = new BoardImpl(5.0);
  board.setNetlist(
    [
      { id: 'eater', kind: 'mcu', params: {}, terminals: ['via1.PA0'] },
      { id: 'g', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ],
    [
      { id: 'n1', terminals: [{ part: 'eater', terminal: 'via1.PA0' }] },
      { id: 'ng', terminals: [{ part: 'g', terminal: 'gnd' }] },
    ]
  );
  board.setPower(true);

  const { target } = await createDebugTarget('eater6502', {
    board,
    rom: makeRomImage(),
  });

  const caps = target.capabilities();
  assert.deepEqual(caps.steps, ['insn', 'over', 'out']);
  assert.deepEqual(caps.breakpoints, ['code', 'write']);
  assert.equal(caps.timeFreezes, true);
});

test('factory: memory read/write on 6502', async () => {
  const board = new BoardImpl(5.0);
  board.setNetlist(
    [
      { id: 'eater', kind: 'mcu', params: {}, terminals: ['via1.PA0'] },
      { id: 'g', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ],
    [
      { id: 'n1', terminals: [{ part: 'eater', terminal: 'via1.PA0' }] },
      { id: 'ng', terminals: [{ part: 'g', terminal: 'gnd' }] },
    ]
  );
  board.setPower(true);

  const { target } = await createDebugTarget('eater6502', {
    board,
    rom: makeRomImage(),
  });

  // Write to RAM, read it back
  target.writeMem('mem', 0x0200, new Uint8Array([0xAB, 0xCD]));
  assert.deepEqual(Array.from(target.readMem('mem', 0x0200, 2)), [0xAB, 0xCD]);

  // Read ROM: first two bytes are LDA #$FF → $A9 $FF
  assert.deepEqual(Array.from(target.readMem('mem', 0x8000, 2)), [0xA9, 0xFF]);

  // Unknown space refuses
  assert.ok(target.readMem('xram', 0, 1).unsupported);
});

test('getTargetKinds includes eater6502', () => {
  const kinds = getTargetKinds();
  assert.ok(kinds.find(k => k.kind === 'eater6502'));
  assert.equal(kinds.length, 7);
});
