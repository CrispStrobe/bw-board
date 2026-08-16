// Chip-qualified pin ids — `<partId>.<terminal>` — the bridge that lets a
// machine adapter address ONE chip's terminal in a bench full of chips.
// The designer collapses machine DIPs (w65c22, 28c256, 62256…) to kind
// 'mcu', so their terminals all land in one bare namespace where 'D0'
// names a pin on the ROM, the RAM and the VIA at once. The claims:
//   1. setPin('via.PA0') drives the net at that part's terminal — an LED
//      wired to it lights.
//   2. Bare MCU pin names keep absolute precedence: an 8051's 'P1.0' never
//      parses as part 'P1', even with a part of that id seated.
//   3. readPin('via.PB7') reads the net at the terminal.
//   4. Two chips sharing a terminal NAME stay distinct under qualification.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function machineBench() {
  const parts = [
    { id: 'via', kind: 'mcu', params: {}, terminals: ['PA0', 'PA1', 'PB7'] },
    { id: 'r1', kind: 'resistor', params: { ohms: 220 }, terminals: ['a', 'b'] },
    { id: 'd1', kind: 'led', params: {}, terminals: ['anode', 'cathode'] },
    { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ];
  const nets = [
    { id: 'n_pa0', terminals: [{ part: 'via', terminal: 'PA0' }, { part: 'r1', terminal: 'a' }] },
    { id: 'n_led', terminals: [{ part: 'r1', terminal: 'b' }, { part: 'd1', terminal: 'anode' }] },
    { id: 'n_gnd', terminals: [{ part: 'd1', terminal: 'cathode' }, { part: 'g1', terminal: 'gnd' }] },
    { id: 'n_vcc', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 'via', terminal: 'PB7' }] },
  ];
  const b = new BoardImpl(5.0);
  b.setNetlist(parts, nets);
  b.setPower(true);
  return b;
}

describe('chip-qualified pins', () => {
  it('drives an unmodeled chip terminal: via.PA0 high lights the LED', () => {
    const b = machineBench();
    b.setPin('via.PA0', 'pushpull', true);
    const v = b.nodeVoltage('n_pa0');
    assert.ok(v > 4.0, `PA0 net near rail, got ${v}`);
    assert.ok(b.ledBrightness('d1') > 0.5, `LED lit, got ${b.ledBrightness('d1')}`);
    b.setPin('via.PA0', 'pushpull', false);
    assert.ok(b.ledBrightness('d1') < 0.05, `LED dark after low, got ${b.ledBrightness('d1')}`);
  });

  it('is case-blind the way every other pin id is', () => {
    const b = machineBench();
    b.setPin('VIA.pa0', 'pushpull', true);
    assert.ok(b.nodeVoltage('n_pa0') > 4.0, 'mixed case resolves to the same terminal');
  });

  it('reads a chip input terminal: via.PB7 wired to VCC reads 1', () => {
    const b = machineBench();
    assert.equal(b.readPin('via.PB7'), 1);
  });

  it("bare MCU names win: 'P1.0' stays the 8051 pin beside a part id 'P1'", () => {
    const parts = [
      { id: 'mcu1', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      { id: 'P1', kind: 'mcu', params: {}, terminals: ['0'] },
      { id: 'r1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'r2', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ];
    // n_mcu -r1- n_chip -r2- gnd: if ONLY the MCU pin drives, the divider
    // puts n_chip at ~2.5 V; if 'P1.0' also (wrongly) drove part P1's
    // terminal '0', n_chip would sit at the rail.
    const nets = [
      { id: 'n_mcu', terminals: [{ part: 'mcu1', terminal: 'P1.0' }, { part: 'r1', terminal: 'a' }] },
      { id: 'n_chip', terminals: [{ part: 'P1', terminal: '0' }, { part: 'r1', terminal: 'b' }, { part: 'r2', terminal: 'a' }] },
      { id: 'n_gnd', terminals: [{ part: 'r2', terminal: 'b' }, { part: 'g1', terminal: 'gnd' }] },
    ];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    b.setPower(true);
    b.setPin('P1.0', 'pushpull', true);
    const vMcu = b.nodeVoltage('n_mcu');
    const vChip = b.nodeVoltage('n_chip');
    assert.ok(vMcu > 4.0, `MCU pin driven: ${vMcu}`);
    assert.ok(vChip > 2.0 && vChip < 3.0, `divider midpoint, not a second drive: ${vChip}`);
  });

  it('two chips sharing a terminal name stay distinct: rom.D0 is not ram.D0', () => {
    const parts = [
      { id: 'rom', kind: 'mcu', params: {}, terminals: ['D0'] },
      { id: 'ram', kind: 'mcu', params: {}, terminals: ['D0'] },
      { id: 'r1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'r2', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ];
    const nets = [
      { id: 'n_rom', terminals: [{ part: 'rom', terminal: 'D0' }, { part: 'r1', terminal: 'a' }] },
      { id: 'n_ram', terminals: [{ part: 'ram', terminal: 'D0' }, { part: 'r2', terminal: 'a' }] },
      { id: 'n_gnd', terminals: [{ part: 'r1', terminal: 'b' }, { part: 'r2', terminal: 'b' }, { part: 'g1', terminal: 'gnd' }] },
    ];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    b.setPower(true);
    b.setPin('rom.D0', 'pushpull', true);
    assert.ok(b.nodeVoltage('n_rom') > 4.0, `rom side driven: ${b.nodeVoltage('n_rom')}`);
    assert.ok(b.nodeVoltage('n_ram') < 0.5, `ram side untouched: ${b.nodeVoltage('n_ram')}`);
  });

  it('an unresolvable qualified id drives nothing and reads 0', () => {
    const b = machineBench();
    b.setPin('nosuch.PA9', 'pushpull', true);
    assert.equal(b.readPin('nosuch.PA9'), 0);
    assert.ok(b.ledBrightness('d1') < 0.05, 'stray id changed nothing');
  });
});
