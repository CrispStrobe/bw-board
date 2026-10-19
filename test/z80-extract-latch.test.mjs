// PainfulDiodes' first build, from WIRES to lit LEDs: a Z80, a 28C256, a
// 62256, and a 74HC374 whose clk is the classic /IORQ-OR-/WR strobe
// through a 74HC32. The extractor must recognize the latch as a
// write-strobed OUT port, and the machine booted from THAT config must
// light board LEDs on OUT (n),A — the whole in-app chain, headless.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractZ80Machine } from '../src/z80-extract.js';
import { createZ80Adapter } from '../src/z80-adapter.js';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

function pdWiresFinal() {
  const parts = [
    { id: 'cpu', kind: 'z80' },
    { id: 'rom', kind: '28c256' },
    { id: 'ram', kind: '62256' },
    { id: 'nand1', kind: '74hc00' },
    { id: 'or1', kind: '74hc32' },
    { id: 'latch1', kind: '74hc374' },
    { id: 'v1', kind: 'vcc' },
    { id: 'g1', kind: 'gnd' },
  ];
  const w = (from, fromTerminal, to, toTerminal) => ({ from, fromTerminal, to, toTerminal });
  const wires = [
    // ROM owns the low half: /CE = A15.
    w('cpu', 'a15', 'rom', 'ceb'),
    // RAM owns the high half: /CS = NOT(A15) via NAND(A15, A15).
    w('cpu', 'a15', 'nand1', '1a'),
    w('cpu', 'a15', 'nand1', '1b'),
    w('nand1', '1y', 'ram', 'csb'),
    // The OUT strobe: clk = OR(/IORQ, /WR) — low only during an IO write.
    w('cpu', 'iorqb', 'or1', '1a'),
    w('cpu', 'wrb', 'or1', '1b'),
    w('or1', '1y', 'latch1', 'clk'),
  ];
  // Address lines ride straight — the extractor refuses anything else.
  for (let i = 0; i < 15; i++) {
    wires.push(w('cpu', `a${i}`, 'rom', `a${i}`));
    wires.push(w('cpu', `a${i}`, 'ram', `a${i}`));
  }
  return { parts, wires };
}

describe('Z80 extract: the OUT latch from real wiring', () => {
  it('extracts latch1 as a write-strobed port and the machine lights LEDs', () => {
    const result = extractZ80Machine(pdWiresFinal());
    assert.ok(result.ok, `extraction succeeds: ${JSON.stringify(result.reasons)}`);
    const latch = (result.ports || []).find(p => p.kind === 'latch');
    assert.ok(latch, `latch port extracted: ${JSON.stringify(result.ports)}`);
    assert.equal(latch.name, 'latch1');

    // Boot the machine FROM THE EXTRACTED CONFIG with the OUT program and
    // a board carrying the latch + LEDs.
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
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPower(true);

    const rom = new Uint8Array([0x3e, 0x55, 0xd3, latch.at & 0xff, 0x76]); // LD A,$55; OUT (at),A; HALT
    const adapter = createZ80Adapter({
      config: { clockHz: 4_000_000, regions: result.regions, ports: result.ports },
      rom,
    });
    adapter.attachBoard(board);
    adapter.advanceNs(1_000_000);
    for (let i = 0; i < 8; i++) {
      const bright = board.ledBrightness(`led${i}`);
      if (i % 2 === 0) assert.ok(bright > 0.5, `led${i} lit, got ${bright}`);
      else assert.ok(bright < 0.05, `led${i} dark, got ${bright}`);
    }
  });
});
