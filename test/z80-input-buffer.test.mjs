/**
 * Z80 input path: IN (n),A reads board pins through a 74HC244 buffer.
 *
 * The Latch374 gives Z80 machines an OUT path (write port → Q pins →
 * board LEDs). This test verifies the mirror: a Buffer244 gives an IN
 * path (board buttons → A pins → read port → CPU register).
 *
 * Golden: a hand-assembled Z80 program does IN A,(port) and the
 * accumulator reflects the board's button/DIP state.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { Z80Machine } from '../src/z80-machine.js';
import { createZ80Adapter } from '../src/z80-adapter.js';

describe('Z80 input via 74HC244 buffer port', () => {

  /** Config with a buffer at port $40 and a latch at port $80. */
  const CONFIG = Object.freeze({
    clockHz: 4_000_000,
    regions: [
      { kind: 'ram', start: 0x0000, end: 0xffff },
    ],
    ports: [
      { kind: 'buffer', name: 'buf1', at: 0x40 },
      { kind: 'latch', name: 'latch1', at: 0x80 },
    ],
  });

  it('IN A,(port) returns the value sampled from onBufferRead', () => {
    let boardValue = 0xA5;
    const machine = new Z80Machine(CONFIG, {
      onBufferRead(chipName) {
        assert.equal(chipName, 'buf1');
        return boardValue;
      },
    });

    // Hand-assembled Z80: IN A,($40); HALT
    // IN A,(n): opcode DB nn → reads port nn into A
    machine.mem[0] = 0xDB;  // IN A,(n)
    machine.mem[1] = 0x40;  // port $40
    machine.mem[2] = 0x76;  // HALT
    machine.cpu.pc = 0;

    machine.step(); // IN A,($40)
    assert.equal(machine.cpu.a, 0xA5, `A should be 0xA5 from buffer, got 0x${machine.cpu.a.toString(16)}`);

    // Change board value and read again
    boardValue = 0x3C;
    machine.cpu.pc = 0;
    machine.step();
    assert.equal(machine.cpu.a, 0x3C, `A should be 0x3C after change, got 0x${machine.cpu.a.toString(16)}`);
  });

  it('buffer read is live — each IN samples current state', () => {
    let counter = 0;
    const machine = new Z80Machine(CONFIG, {
      onBufferRead() { return ++counter; },
    });

    // IN A,($40) three times
    machine.mem[0] = 0xDB; machine.mem[1] = 0x40; // IN A,($40)
    machine.mem[2] = 0xDB; machine.mem[3] = 0x40; // IN A,($40)
    machine.mem[4] = 0xDB; machine.mem[5] = 0x40; // IN A,($40)
    machine.mem[6] = 0x76;
    machine.cpu.pc = 0;

    machine.step();
    assert.equal(machine.cpu.a, 1);
    machine.step();
    assert.equal(machine.cpu.a, 2);
    machine.step();
    assert.equal(machine.cpu.a, 3);
  });

  it('unaddressed port returns 0xFF (open bus)', () => {
    const machine = new Z80Machine(CONFIG, { onBufferRead: () => 0xAA });

    // IN A,($41) — port $41, buffer is at $40
    machine.mem[0] = 0xDB; machine.mem[1] = 0x41;
    machine.mem[2] = 0x76;
    machine.cpu.pc = 0;

    machine.step();
    assert.equal(machine.cpu.a, 0xFF, 'unmapped port should return 0xFF');
  });
});

describe('Z80 adapter: board.readPin → IN port via buffer', () => {

  const CONFIG = Object.freeze({
    clockHz: 4_000_000,
    regions: [{ kind: 'ram', start: 0x0000, end: 0xffff }],
    ports: [{ kind: 'buffer', name: 'buf1', at: 0x40 }],
  });

  it('IN A,($40) reflects board pin state through qualified readPin', () => {
    const adapter = createZ80Adapter({ config: CONFIG });

    // Stub board with readPin
    const pinState = {};
    const board = {
      readPin(pin) {
        return pinState[pin] ?? 0;
      },
      advanceTo() {},
    };
    adapter.attachBoard(board);

    // Set pins: group 1 bits 0,2 high (1a0, 1a2), group 2 bit 1 high (2a1)
    pinState['buf1.1a0'] = 1;  // bit 0
    pinState['buf1.1a2'] = 1;  // bit 2
    pinState['buf1.2a1'] = 1;  // bit 5 (group 2 bit 1 = overall bit 5)

    // IN A,($40); HALT
    adapter.machine.mem[0] = 0xDB;
    adapter.machine.mem[1] = 0x40;
    adapter.machine.mem[2] = 0x76;
    adapter.machine.cpu.pc = 0;

    adapter.machine.step();
    // Expected: bit 0 + bit 2 + bit 5 = 0x25
    assert.equal(adapter.machine.cpu.a, 0x25,
      `expected 0x25 (bits 0,2,5), got 0x${adapter.machine.cpu.a.toString(16)}`);
  });

  it('pressing a button changes the IN port reading', () => {
    const adapter = createZ80Adapter({ config: CONFIG });

    const pinState = {};
    const board = {
      readPin(pin) { return pinState[pin] ?? 0; },
      advanceTo() {},
    };
    adapter.attachBoard(board);

    // First read: all pins low → 0x00
    adapter.machine.mem[0] = 0xDB; adapter.machine.mem[1] = 0x40;
    adapter.machine.mem[2] = 0x76;
    adapter.machine.cpu.pc = 0;
    adapter.machine.step();
    assert.equal(adapter.machine.cpu.a, 0x00, 'all pins low = 0x00');

    // Press button on 1a3 (bit 3)
    pinState['buf1.1a3'] = 1;
    adapter.machine.cpu.pc = 0;
    adapter.machine.step();
    assert.equal(adapter.machine.cpu.a, 0x08, 'button on 1a3 = bit 3 = 0x08');
  });
});
