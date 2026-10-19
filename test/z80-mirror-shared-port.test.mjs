// The complete PainfulDiodes stage one, one port, both directions:
// IN A,(0) samples a DIP through a 74HC244; OUT (0),A drives LEDs
// through a 74HC374 — read-chip and write-chip legally SHARING port 0.
// The machine's port slots are direction-aware now: a single last-wins
// slot sent OUT into the buffer's no-op write and no LED ever lit.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { createZ80Adapter } from '../src/z80-adapter.js';

registerAllDevices();

function bench() {
  const parts = [
    { id: 'latch1', kind: '74hc374', params: {},
      terminals: ['oeb', 'clk', 'vcc', 'gnd',
        ...Array.from({ length: 8 }, (_, i) => `d${i}`),
        ...Array.from({ length: 8 }, (_, i) => `q${i}`)] },
    { id: 'in1', kind: '74hc244', params: {},
      terminals: ['vcc', 'gnd', '1oeb', '2oeb',
        ...Array.from({ length: 4 }, (_, i) => `1a${i}`), ...Array.from({ length: 4 }, (_, i) => `1y${i}`),
        ...Array.from({ length: 4 }, (_, i) => `2a${i}`), ...Array.from({ length: 4 }, (_, i) => `2y${i}`)] },
    { id: 'dip1', kind: 'dip_switch', params: { switches: 0b0101 },
      terminals: ['s0_a', 's0_b', 's1_a', 's1_b', 's2_a', 's2_b', 's3_a', 's3_b'] },
    { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ];
  // ONE net per electrical node — a terminal listed in two nets is a
  // malformed netlist (the app's union-find can never produce it), and
  // the solver stamps sources by FIRST net found.
  const vccT = [{ part: 'v1', terminal: 'vcc' }, { part: 'latch1', terminal: 'vcc' }, { part: 'in1', terminal: 'vcc' }];
  const gndT = [{ part: 'g1', terminal: 'gnd' }, { part: 'latch1', terminal: 'gnd' }, { part: 'latch1', terminal: 'oeb' }, { part: 'in1', terminal: 'gnd' }];
  const nets = [];
  for (let i = 0; i < 8; i++) {
    parts.push({ id: `lr${i}`, kind: 'resistor', params: { ohms: 220 }, terminals: ['a', 'b'] });
    parts.push({ id: `led${i}`, kind: 'led', params: {}, terminals: ['anode', 'cathode'] });
    nets.push({ id: `n_q${i}`, terminals: [{ part: 'latch1', terminal: `q${i}` }, { part: `lr${i}`, terminal: 'a' }] });
    nets.push({ id: `n_l${i}`, terminals: [{ part: `lr${i}`, terminal: 'b' }, { part: `led${i}`, terminal: 'anode' }] });
    gndT.push({ part: `led${i}`, terminal: 'cathode' });
  }
  for (let i = 0; i < 4; i++) {
    parts.push({ id: `pd${i}`, kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] });
    nets.push({ id: `n_sw${i}`, terminals: [
      { part: 'dip1', terminal: `s${i}_b` }, { part: 'in1', terminal: `1a${i}` }, { part: `pd${i}`, terminal: 'a' }] });
    vccT.push({ part: 'dip1', terminal: `s${i}_a` });
    gndT.push({ part: `pd${i}`, terminal: 'b' });
    gndT.push({ part: 'in1', terminal: `2a${i}` });
  }
  nets.push({ id: 'n_vcc', terminals: vccT });
  nets.push({ id: 'n_gnd', terminals: gndT });
  const b = new BoardImpl(5.0);
  b.setNetlist(parts, nets);
  b.setPower(true);
  return b;
}

describe('Z80 switch mirror: IN and OUT share port 0', () => {
  it('flip the switches, the LEDs follow', () => {
    const board = bench();
    const rom = new Uint8Array([0xdb, 0x00, 0xd3, 0x00, 0x18, 0xfa]); // IN A,(0); OUT (0),A; JR -6
    const adapter = createZ80Adapter({
      config: {
        clockHz: 4_000_000,
        regions: [{ kind: 'rom', start: 0, end: 0x7fff }, { kind: 'ram', start: 0x8000, end: 0xffff }],
        ports: [
          { kind: 'latch', name: 'latch1', at: 0 },
          { kind: 'buffer', name: 'in1', at: 0 },
        ],
      },
      rom,
    });
    adapter.attachBoard(board);
    const dip = board.partMap.get('dip1');
    const lit = () => Array.from({ length: 8 }, (_, i) => board.ledBrightness(`led${i}`) > 0.5 ? 1 : 0).reverse().join('');
    // 40 ms per state — well past the 20 ms brightness window.
    const settle = () => { for (let k = 0; k < 20; k++) adapter.advanceNs(2_000_000); };
    settle();
    assert.equal(lit(), '00000101', 'boot state mirrors the DIP');
    dip.params.switches = 0b1010;
    settle();
    assert.equal(lit(), '00001010', 'flipped switches mirror through');
    dip.params.switches = 0b0000;
    settle();
    assert.equal(lit(), '00000000', 'all open reads all dark');
  });
});
