/**
 * 74HC595 shift register tests — hand-computed oracles.
 *
 * Oracle: clock in 0xA5 (10100101) MSB first, latch, verify Q0-Q7.
 * Q0 = LSB = 1, Q7 = MSB = 1. Pattern: 10100101 = Q7..Q0.
 *
 * Terminal names (existing built-in): data, clock, latch, oe, q0-q7
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function make595Circuit() {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'shift_register', params: { rOut: 50 },
      terminals: ['data', 'clock', 'latch', 'oe', 'q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'] },
    { id: 'MCU', kind: 'mcu', params: {},
      terminals: ['P1.0', 'P1.1', 'P1.2', 'P1.3'] },
  ];

  // Add load resistors on each output for voltage measurement
  for (let i = 0; i < 8; i++) {
    parts.push({ id: `R${i}`, kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] });
  }

  const nets = [
    { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
    { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    // MCU connections: P1.0=data, P1.1=clock, P1.2=latch, P1.3=OE
    { id: 'net_data', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'U1', terminal: 'data' }] },
    { id: 'net_clock', terminals: [{ part: 'MCU', terminal: 'P1.1' }, { part: 'U1', terminal: 'clock' }] },
    { id: 'net_latch', terminals: [{ part: 'MCU', terminal: 'P1.2' }, { part: 'U1', terminal: 'latch' }] },
    { id: 'net_oe', terminals: [{ part: 'MCU', terminal: 'P1.3' }, { part: 'U1', terminal: 'oe' }] },
  ];

  // Wire each Q output through a load resistor to GND
  for (let i = 0; i < 8; i++) {
    nets.push({
      id: `net_q${i}`,
      terminals: [{ part: 'U1', terminal: `q${i}` }, { part: `R${i}`, terminal: 'a' }],
    });
    // Connect resistor b to GND net
    nets[1].terminals.push({ part: `R${i}`, terminal: 'b' });
  }

  return { parts, nets };
}

function clockBit(board, bit) {
  // Set data
  board.setPin('P1.0', 'pushpull', bit === 1);
  // Rising edge on clock
  board.setPin('P1.1', 'pushpull', true);
  // Falling edge on clock
  board.setPin('P1.1', 'pushpull', false);
}

function latch(board) {
  board.setPin('P1.2', 'pushpull', true);
  board.setPin('P1.2', 'pushpull', false);
}

describe('74HC595: clock in 0xA5, latch, verify outputs', () => {
  it('Q0-Q7 match 0xA5 bit pattern after shift and latch', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = make595Circuit();
    board.setNetlist(parts, nets);

    // OE active (LOW) — outputs enabled
    board.setPin('P1.3', 'pushpull', false);
    // Initial: clock and latch low
    board.setPin('P1.1', 'pushpull', false);
    board.setPin('P1.2', 'pushpull', false);

    // Clock in 0xA5 = 10100101 MSB first
    // After shifting MSB first, the shift register holds:
    // bit7=1, bit6=0, bit5=1, bit4=0, bit3=0, bit2=1, bit1=0, bit0=1
    // which is Q7=1, Q6=0, Q5=1, Q4=0, Q3=0, Q2=1, Q1=0, Q0=1
    const bits = [1, 0, 1, 0, 0, 1, 0, 1]; // MSB first
    for (const b of bits) {
      clockBit(board, b);
    }

    // Latch
    latch(board);

    // Oracle: 0xA5 = 10100101
    // Q0 (bit 0) = 1, Q1 = 0, Q2 = 1, Q3 = 0, Q4 = 0, Q5 = 1, Q6 = 0, Q7 = 1
    const expected = [1, 0, 1, 0, 0, 1, 0, 1]; // Q0..Q7

    for (let i = 0; i < 8; i++) {
      const v = board.nodeVoltage(`net_q${i}`);
      if (expected[i]) {
        // HIGH output: 5V through 50 Ohm into 10kOhm to GND
        // V = 5 * 10000 / (10000 + 50) = 4.975V
        assert.ok(v > 4.0, `Q${i} should be HIGH (~4.975V), got ${v.toFixed(3)}V`);
      } else {
        // LOW output: 0V through 50 Ohm
        assert.ok(v < 1.0, `Q${i} should be LOW (~0V), got ${v.toFixed(3)}V`);
      }
    }
  });

  it('OE HIGH → outputs are high-Z (not driven)', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = make595Circuit();
    board.setNetlist(parts, nets);

    // OE inactive (HIGH)
    board.setPin('P1.3', 'pushpull', true);
    board.setPin('P1.1', 'pushpull', false);
    board.setPin('P1.2', 'pushpull', false);

    // Clock in all 1s
    for (let i = 0; i < 8; i++) clockBit(board, 1);
    latch(board);

    // With OE high, outputs should be high-Z → pulled to GND by load resistor
    for (let i = 0; i < 8; i++) {
      const v = board.nodeVoltage(`net_q${i}`);
      assert.ok(v < 1.0, `Q${i} with OE inactive should not drive HIGH, got ${v.toFixed(3)}V`);
    }
  });

  it('shift register starts at 0x00', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = make595Circuit();
    board.setNetlist(parts, nets);

    // OE active
    board.setPin('P1.3', 'pushpull', false);
    board.setPin('P1.1', 'pushpull', false);
    board.setPin('P1.2', 'pushpull', false);

    // Latch without clocking anything
    latch(board);

    // All outputs should be LOW (shift register starts at 0)
    for (let i = 0; i < 8; i++) {
      const v = board.nodeVoltage(`net_q${i}`);
      assert.ok(v < 1.0, `Q${i} should start LOW, got ${v.toFixed(3)}V`);
    }
  });

  it('partial shift: 4 bits clocked, only lower 4 valid after latch', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = make595Circuit();
    board.setNetlist(parts, nets);

    board.setPin('P1.3', 'pushpull', false); // OE active
    board.setPin('P1.1', 'pushpull', false);
    board.setPin('P1.2', 'pushpull', false);

    // Clock in 4 bits: 1010 (MSB first) → register = 0000_1010
    clockBit(board, 1);
    clockBit(board, 0);
    clockBit(board, 1);
    clockBit(board, 0);
    latch(board);

    // Q0=0, Q1=1, Q2=0, Q3=1, Q4-Q7=0
    const expected = [0, 1, 0, 1, 0, 0, 0, 0];
    for (let i = 0; i < 8; i++) {
      const v = board.nodeVoltage(`net_q${i}`);
      if (expected[i]) {
        assert.ok(v > 4.0, `Q${i} should be HIGH, got ${v.toFixed(3)}V`);
      } else {
        assert.ok(v < 1.0, `Q${i} should be LOW, got ${v.toFixed(3)}V`);
      }
    }
  });
});
