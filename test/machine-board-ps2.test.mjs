// The PS/2 keyboard chain, end to end through the board: a PS/2 part
// seated on the board with d0-d7 wired to VIA PA0-7 and da wired to
// CA1 (the KiT build's wiring). A hand-assembled ROM runs an IRQ-driven
// ISR that stores each captured scan-code byte at $0200+. Face-side
// keypresses reach the machine as Code Set 2 make/break sequences.
//
// This is the keyboard counterpart of machine-board-lcd.test.mjs: the
// LCD test proves output (machine → board → display), this one proves
// input (face → board → machine).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { createM6502Adapter } from '../src/m6502-adapter.js';
import { SCAN_CODES } from '../src/ps2.js';

registerAllDevices();

/**
 * Build a board with a VIA (as mcu) and a PS/2 part, wired like the
 * KiT build: PS/2 d0-d7 → VIA PA0-PA7, PS/2 da → VIA CA1 net.
 *
 * The VIA's CA1 is a control-line input, not a port pin. On the board
 * the da terminal is wired to a net, and the adapter's syncInputs reads
 * VIA port pins. For CA1, the adapter needs the board to carry the edge.
 * We wire da to a dedicated net that the adapter can read.
 */
function ps2Board() {
  const pa = Array.from({ length: 8 }, (_, i) => `PA${i}`);
  const parts = [
    { id: 'via', kind: 'mcu', params: {}, terminals: [...pa] },
    { id: 'kbd', kind: 'ps2', params: {},
      terminals: ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'da'] },
    { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ];
  const nets = [];
  // Data lines: PS/2 d0-d7 → VIA PA0-PA7
  // (The adapter reads this wiring to auto-detect port A for ps2OnVia.)
  for (let i = 0; i < 8; i++) {
    nets.push({ id: `n_d${i}`, terminals: [
      { part: 'kbd', terminal: `d${i}` },
      { part: 'via', terminal: `PA${i}` },
    ] });
  }
  // DA → VIA CA1 (the adapter reads this to auto-detect the control line)
  nets.push({ id: 'n_da', terminals: [
    { part: 'kbd', terminal: 'da' },
    { part: 'via', terminal: 'CA1' },
  ] });
  // Power
  nets.push({ id: 'n_vcc', terminals: [{ part: 'v1', terminal: 'vcc' }] });
  nets.push({ id: 'n_gnd', terminals: [{ part: 'g1', terminal: 'gnd' }] });

  const b = new BoardImpl(5.0);
  b.setNetlist(parts, nets);
  b.setPower(true);
  return b;
}

/**
 * ROM: IRQ-driven PS/2 monitor on the Eater map (VIA at $6000).
 *
 * Setup:
 *   LDA #$00 / STA DDRA    — Port A all inputs
 *   LDA #$01 / STA PCR     — CA1 positive edge
 *   LDA PORTA              — clear stale IFR flag
 *   LDA #$82 / STA IER     — enable CA1 interrupt
 *   LDX #$00 / STX $00     — buffer index = 0
 *   CLI                    — enable IRQs
 *   JMP self               — spin
 *
 * ISR:
 *   LDX $00 / LDA PORTA / STA $0200,X / INX / STX $00 / RTI
 *
 * Hand-assembled, addresses match the ps2.test.mjs golden.
 */
function ps2MonitorRom() {
  const rom = new Uint8Array(0x8000).fill(0xea); // NOPs
  const code = [
    0xa9, 0x00, 0x8d, 0x03, 0x60,             // LDA #0   / STA DDRA ($6003)
    0xa9, 0x01, 0x8d, 0x0c, 0x60,             // LDA #1   / STA PCR  ($600C) CA1 rising
    0xad, 0x01, 0x60,                         // LDA PORTA ($6001)   clear stale flag
    0xa9, 0x82, 0x8d, 0x0e, 0x60,             // LDA #$82 / STA IER  ($600E)
    0xa2, 0x00, 0x86, 0x00,                   // LDX #0   / STX $00  buffer index
    0x58,                                     // CLI
    0x4c, 0x16, 0x80,                         // loop: JMP loop ($8016)
    // ISR at $801A
    0x48, 0x8a, 0x48,                         // PHA / TXA / PHA
    0xa6, 0x00,                               // LDX $00
    0xad, 0x01, 0x60,                         // LDA PORTA — the byte; clears CA1 IFR
    0x9d, 0x00, 0x02,                         // STA $0200,X
    0xe8, 0x86, 0x00,                         // INX / STX $00
    0x68, 0xaa, 0x68,                         // PLA / TAX / PLA
    0x40,                                     // RTI
  ];
  rom.set(code, 0x0000); // loads at $8000
  rom[0x7ffc] = 0x00; rom[0x7ffd] = 0x80;    // RESET → $8000
  rom[0x7ffe] = 0x1a; rom[0x7fff] = 0x80;    // IRQ   → $801A
  return rom;
}

describe('machine → board → PS/2 keyboard, end to end', () => {
  it('face-side keypresses arrive as Code Set 2 scan codes via IRQ', () => {
    const board = ps2Board();
    const adapter = createM6502Adapter({
      config: {
        clockHz: 1_000_000,
        regions: [
          { kind: 'ram', start: 0x0000, end: 0x3fff },
          { kind: 'rom', start: 0x8000, end: 0xffff },
        ],
        chips: [{ kind: 'via', name: 'via', at: 0x6000 }],
      },
      rom: ps2MonitorRom(),
    });
    adapter.attachBoard(board);

    // Let the ROM initialise (setup code + CLI)
    adapter.advanceNs(500_000); // 0.5 ms

    // Push keys into the PS/2 device's face-side state
    const ps2 = board.getDeviceState('kbd');
    assert.ok(ps2, 'PS/2 device state exists');
    assert.ok(typeof ps2.keyDown === 'function', 'face-side keyDown exists');

    ps2.keyDown('k');
    ps2.keyUp('k');
    ps2.keyDown('enter');
    ps2.keyUp('enter');
    // Expected: 0x42, F0 42, 5A, F0 5A — 6 bytes total

    // Advance in 1ms steps to let the PS/2 pacing deliver frames and
    // syncInputs carry them to the VIA between each step.
    for (let i = 0; i < 20; i++) {
      adapter.advanceNs(1_000_000); // 1 ms per step
    }

    const n = adapter.machine.mem[0x00];
    const buf = Array.from(adapter.machine.mem.slice(0x0200, 0x0200 + n));
    assert.equal(n, 6, `expected 6 scan-code bytes, got ${n}`);
    assert.deepEqual(buf, [
      SCAN_CODES.k, 0xf0, SCAN_CODES.k,       // make k, break k
      SCAN_CODES.enter, 0xf0, SCAN_CODES.enter, // make enter, break enter
    ], 'Code Set 2 make/break sequence');
  });
});
