// The CTC on the Z80 machine's port bus: a real Z80 program sets IM 2,
// programs channel 0 (prescale 256, TC 125 → exactly 32000 cycles per
// interrupt), and its ISR counts. Hand-assembled; every expectation
// from the Zilog manual's cycle arithmetic.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Z80Machine } from '../src/z80-machine.js';

describe('Z8430 on the Z80 machine', () => {
  it('IM 2 vectored interrupts count frames at the programmed rate', () => {
    const m = new Z80Machine({
      clockHz: 1_000_000,
      regions: [],                     // flat RAM
      ports: [{ kind: 'ctc', name: 'ctc1', at: 0x10 }],
    });
    const prog = [
      0x31, 0x00, 0x80,   // LD SP,$8000
      0x3e, 0x20,         // LD A,$20      vector table page
      0xed, 0x47,         // LD I,A
      0xed, 0x5e,         // IM 2
      0x3e, 0x00,         // LD A,$00      CTC vector base (bit0=0 → vector write)
      0xd3, 0x10,         // OUT ($10),A
      0x3e, 0xa5,         // LD A,$A5      IE | prescale 256 | TC follows | control
      0xd3, 0x10,         // OUT ($10),A
      0x3e, 0x7d,         // LD A,125      time constant
      0xd3, 0x10,         // OUT ($10),A
      0xfb,               // EI
      0x76,               // HALT
      0x18, 0xfc,         // JR -4 (EI; HALT loop)
    ];
    const isr = [
      0x3a, 0x00, 0x70,   // LD A,($7000)
      0x3c,               // INC A
      0x32, 0x00, 0x70,   // LD ($7000),A
      0xfb,               // EI
      0xed, 0x4d,         // RETI
    ];
    m.load(prog, 0);
    m.load(isr, 0x0140);
    m.load([0x40, 0x01], 0x2000);     // vector table entry 0 → $0140
    m.cpu.pc = 0;
    m.advanceToMs(100.5);             // 100500 cycles ≈ 3 periods of 32000
    const count = m.mem[0x7000];
    assert.ok(count >= 2 && count <= 4, `~3 CTC interrupts in 100ms at 1MHz, got ${count}`);
  });

  it('the down-counter is poll-readable through the port', () => {
    const m = new Z80Machine({
      clockHz: 1_000_000, regions: [],
      ports: [{ kind: 'ctc', name: 'ctc1', at: 0x10 }],
    });
    // Program ch1 (port $11): no IE, prescale 256, TC 200; then IN and store.
    const prog = [
      0x3e, 0x25, 0xd3, 0x11,   // control: prescale 256 | TC follows | control
      0x3e, 0xc8, 0xd3, 0x11,   // TC 200
      0xdb, 0x11,               // IN A,($11)
      0x32, 0x00, 0x70,         // LD ($7000),A
      0x76,                     // HALT
    ];
    m.load(prog, 0);
    m.cpu.pc = 0;
    m.advanceToMs(1);
    const v = m.mem[0x7000];
    assert.ok(v > 190 && v <= 200, `counter freshly loaded, read ${v}`);
  });
});
