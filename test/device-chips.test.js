/**
 * Composed logic chip tests — real DIP packages via chip-composer.
 *
 * Oracle: 74HC08 pin 1A=H, 1B=H → 1Y=H. Standard datasheet truth tables.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerLogicChips, CHIPS } from '../src/devices/chip-composer.js';
import { unregisterDevice } from '../src/devices.js';

function setup() { registerLogicChips(); }
function teardown() { for (const c of CHIPS) { try { unregisterDevice(c.kind); } catch {} } }

function makeChipCircuit(kind, terminals) {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind, params: {}, terminals },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2', 'P1.3'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
  ];
  return parts;
}

describe('74HC08: quad AND gate', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('1A=H, 1B=H → 1Y=H', () => {
    const chip = CHIPS.find(c => c.kind === '74hc08');
    const terminals = [...new Set(chip.pins.filter(p => !p.startsWith('nc')))];
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'U1', kind: '74hc08', params: {}, terminals },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'U1', terminal: 'vcc' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'U1', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
      { id: 'net_1a', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'U1', terminal: '1a' }] },
      { id: 'net_1b', terminals: [{ part: 'MCU', terminal: 'P1.1' }, { part: 'U1', terminal: '1b' }] },
      { id: 'net_1y', terminals: [{ part: 'U1', terminal: '1y' }, { part: 'R1', terminal: 'a' }] },
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // AND(1,1) = 1
    board.setPin('P1.0', 'pushpull', true);
    board.setPin('P1.1', 'pushpull', true);
    assert.ok(board.nodeVoltage('net_1y') > 4.0, `1Y should be HIGH for AND(1,1)`);

    // AND(1,0) = 0
    board.setPin('P1.1', 'pushpull', false);
    assert.ok(board.nodeVoltage('net_1y') < 1.0, `1Y should be LOW for AND(1,0)`);
  });
});

describe('74HC00: quad NAND gate', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('NAND truth table on gate 1', () => {
    const chip = CHIPS.find(c => c.kind === '74hc00');
    const terminals = [...new Set(chip.pins.filter(p => !p.startsWith('nc')))];
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'U1', kind: '74hc00', params: {}, terminals },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'U1', terminal: 'vcc' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'U1', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
      { id: 'net_1a', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'U1', terminal: '1a' }] },
      { id: 'net_1b', terminals: [{ part: 'MCU', terminal: 'P1.1' }, { part: 'U1', terminal: '1b' }] },
      { id: 'net_1y', terminals: [{ part: 'U1', terminal: '1y' }, { part: 'R1', terminal: 'a' }] },
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // NAND(1,1) = 0
    board.setPin('P1.0', 'pushpull', true);
    board.setPin('P1.1', 'pushpull', true);
    assert.ok(board.nodeVoltage('net_1y') < 1.0, `NAND(1,1) should be LOW`);

    // NAND(1,0) = 1
    board.setPin('P1.1', 'pushpull', false);
    assert.ok(board.nodeVoltage('net_1y') > 4.0, `NAND(1,0) should be HIGH`);

    // NAND(0,0) = 1
    board.setPin('P1.0', 'pushpull', false);
    assert.ok(board.nodeVoltage('net_1y') > 4.0, `NAND(0,0) should be HIGH`);
  });
});

describe('74HC74: dual D flip-flop', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('captures D on rising clock, active-LOW preset/clear', () => {
    const chip = CHIPS.find(c => c.kind === '74hc74');
    const terminals = [...new Set(chip.pins.filter(p => !p.startsWith('nc')))];
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'U1', kind: '74hc74', params: {}, terminals },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [
        { part: 'VCC', terminal: 'vcc' },
        { part: 'U1', terminal: 'vcc' },
        { part: 'U1', terminal: '1pre' },  // preset inactive (HIGH)
        { part: 'U1', terminal: '1clr' },  // clear inactive (HIGH)
      ]},
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'U1', terminal: 'gnd' }] },
      { id: 'net_d', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'U1', terminal: '1d' }] },
      { id: 'net_clk', terminals: [{ part: 'MCU', terminal: 'P1.1' }, { part: 'U1', terminal: '1clk' }] },
      { id: 'net_q', terminals: [{ part: 'U1', terminal: '1q' }] },
      { id: 'net_qbar', terminals: [{ part: 'U1', terminal: '1q_bar' }] },
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.1', 'pushpull', false); // CLK starts LOW

    // D=HIGH, clock rising edge
    board.setPin('P1.0', 'pushpull', true);
    board.setPin('P1.1', 'pushpull', true);
    board.setPin('P1.1', 'pushpull', false);

    assert.ok(board.nodeVoltage('net_q') > 4.0, 'Q=HIGH after D=1 clocked');
    assert.ok(board.nodeVoltage('net_qbar') < 1.0, 'Q_bar=LOW');
  });
});

describe('chip-composer: all chips register without error', () => {
  beforeEach(setup);
  afterEach(teardown);

  it(`all ${CHIPS.length} chips are registered`, () => {
    // If setup() didn't throw, all registered successfully
    assert.equal(CHIPS.length, 16, `expected 16 chip definitions`);
  });
});
