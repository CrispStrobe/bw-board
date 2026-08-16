// The Z80 display chain, engine-side: OUT (0),A through a 74HC374 OUT
// latch lights LEDs seated on a real board — PainfulDiodes' first
// program, the Z80 mirror of the 6502's machine→VIA→LCD chain. The
// machine's latch emits chip-qualified Q edges; the board resolves them
// onto the seated part's terminals; MNA lights the diodes.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { createZ80Adapter } from '../src/z80-adapter.js';

registerAllDevices();

function ledBoard() {
  const parts = [
    { id: 'latch1', kind: '74hc374', params: {},
      terminals: ['oeb', 'clk', 'vcc', 'gnd',
        ...Array.from({ length: 8 }, (_, i) => `d${i}`),
        ...Array.from({ length: 8 }, (_, i) => `q${i}`)] },
    { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ];
  const nets = [
    { id: 'n_vcc', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 'latch1', terminal: 'vcc' }] },
    { id: 'n_gnd', terminals: [{ part: 'g1', terminal: 'gnd' }, { part: 'latch1', terminal: 'gnd' }, { part: 'latch1', terminal: 'oeb' }] },
  ];
  for (let i = 0; i < 8; i++) {
    parts.push({ id: `r${i}`, kind: 'resistor', params: { ohms: 220 }, terminals: ['a', 'b'] });
    parts.push({ id: `led${i}`, kind: 'led', params: {}, terminals: ['anode', 'cathode'] });
    nets.push({ id: `n_q${i}`, terminals: [{ part: 'latch1', terminal: `q${i}` }, { part: `r${i}`, terminal: 'a' }] });
    nets.push({ id: `n_l${i}`, terminals: [{ part: `r${i}`, terminal: 'b' }, { part: `led${i}`, terminal: 'anode' }] });
    nets.push({ id: `n_k${i}`, terminals: [{ part: `led${i}`, terminal: 'cathode' }, { part: 'g1', terminal: 'gnd' }] });
  }
  const b = new BoardImpl(5.0);
  b.setNetlist(parts, nets);
  b.setPower(true);
  return b;
}

describe('Z80 OUT latch → board LEDs', () => {
  it('OUT (0),$AA lights the odd-bit LEDs and leaves the rest dark', () => {
    const board = ledBoard();
    // LD A,$AA ; OUT ($00),A ; HALT
    const rom = new Uint8Array([0x3e, 0xaa, 0xd3, 0x00, 0x76]);
    const adapter = createZ80Adapter({
      config: {
        clockHz: 4_000_000,
        regions: [{ kind: 'rom', start: 0x0000, end: 0x1fff },
          { kind: 'ram', start: 0x8000, end: 0xffff }],
        ports: [{ kind: 'latch', name: 'latch1', at: 0x00 }],
      },
      rom,
    });
    adapter.attachBoard(board);
    adapter.advanceNs(1_000_000); // 1 ms — the program is five bytes
    for (let i = 0; i < 8; i++) {
      const bright = board.ledBrightness(`led${i}`);
      if (i % 2 === 1) assert.ok(bright > 0.5, `led${i} (bit set) lit, got ${bright}`);
      else assert.ok(bright < 0.05, `led${i} (bit clear) dark, got ${bright}`);
    }
  });
});
