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

/**
 * The gallery benches wire each output through a resistor to an LED, not to a
 * bare resistor. An LED is nonlinear, so its net is solved by MNA rather than
 * by the closed-form net resolver — and MNA had no stamp for a shift register
 * at all, so every output sat at 0 V while the latch register held the right
 * byte. The whole of 20-shift-register-binary and 08-led-chaser-595 was dark.
 */
describe('74HC595: outputs drive a nonlinear load', () => {
  const PATTERN = [1, 0, 0, 0, 0, 1, 0, 1]; // 0xA1 read out as Q0..Q7 (bits 0, 5, 7)

  /** @param {'resistor' | 'led'} load */
  function ledLoadBench(load, { oeHigh = false, skipLatch = false } = {}) {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2', 'P1.3'] },
      { id: 'U1', kind: 'shift_register', params: { rOut: 50 },
        terminals: ['data', 'clock', 'latch', 'oe', 'q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    ];
    const gndNet = { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] };
    const nets = [
      { id: 'net_data', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'U1', terminal: 'data' }] },
      { id: 'net_clock', terminals: [{ part: 'MCU', terminal: 'P1.1' }, { part: 'U1', terminal: 'clock' }] },
      { id: 'net_latch', terminals: [{ part: 'MCU', terminal: 'P1.2' }, { part: 'U1', terminal: 'latch' }] },
      { id: 'net_oe', terminals: [{ part: 'MCU', terminal: 'P1.3' }, { part: 'U1', terminal: 'oe' }] },
      gndNet,
    ];
    for (let i = 0; i < 8; i++) {
      parts.push({ id: `R${i}`, kind: 'resistor', params: { ohms: 330 }, terminals: ['a', 'b'] });
      nets.push({ id: `net_q${i}`, terminals: [{ part: 'U1', terminal: `q${i}` }, { part: `R${i}`, terminal: 'a' }] });
      if (load === 'led') {
        parts.push({ id: `D${i}`, kind: 'led', params: { vf: 2, color: 'red' }, terminals: ['anode', 'cathode'] });
        nets.push({ id: `net_m${i}`, terminals: [{ part: `R${i}`, terminal: 'b' }, { part: `D${i}`, terminal: 'anode' }] });
        gndNet.terminals.push({ part: `D${i}`, terminal: 'cathode' });
      } else {
        gndNet.terminals.push({ part: `R${i}`, terminal: 'b' });
      }
    }
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'pushpull', oeHigh); // /OE: LOW enables the outputs
    board.setPin('P1.1', 'pushpull', false);
    board.setPin('P1.2', 'pushpull', false);
    for (const bit of [1, 0, 1, 0, 0, 0, 0, 1]) clockBit(board, bit); // MSB first → 0xA1
    if (!skipLatch) latch(board);
    return board;
  }

  it('lights the pattern through a series resistor and LED', () => {
    const board = ledLoadBench('led');
    // The register itself was never the problem: prove it holds the byte, so a
    // failure below is attributed to the drive and not to the shift logic.
    assert.equal(board._shiftRegisters.get('U1').latchReg, 0xA1);
    for (let i = 0; i < 8; i++) {
      const v = board.nodeVoltage(`net_q${i}`);
      if (PATTERN[i]) assert.ok(v > 2.0, `Q${i} should drive its LED, got ${v.toFixed(3)} V`);
      else assert.ok(v < 1.0, `Q${i} should be LOW, got ${v.toFixed(3)} V`);
    }
  });

  it('agrees with the purely resistive bench on which outputs are high', () => {
    const led = ledLoadBench('led');
    const res = ledLoadBench('resistor');
    for (let i = 0; i < 8; i++) {
      const high = v => v > 2.0;
      assert.equal(high(led.nodeVoltage(`net_q${i}`)), high(res.nodeVoltage(`net_q${i}`)),
        `Q${i} disagrees between the LED and resistor benches`);
    }
  });

  it('drives nothing through the nonlinear load while OE is inactive', () => {
    const board = ledLoadBench('led', { oeHigh: true });
    assert.equal(board._shiftRegisters.get('U1').latchReg, 0xA1); // latched, but disabled
    for (let i = 0; i < 8; i++) {
      assert.ok(board.nodeVoltage(`net_q${i}`) < 1.0,
        `Q${i} must not drive while /OE is high, got ${board.nodeVoltage(`net_q${i}`).toFixed(3)} V`);
    }
  });

  it('shows the LATCHED byte, not the byte still in the shift register', () => {
    // Clock the pattern in but never pulse latch: the outputs must still show
    // the previous latch contents (all zero), or the storage register is not
    // doing its job and a cascade would glitch mid-shift.
    const board = ledLoadBench('led', { skipLatch: true });
    const sr = board._shiftRegisters.get('U1');
    assert.equal(sr.shiftReg, 0xA1, 'the shift register should hold the clocked byte');
    assert.equal(sr.latchReg, 0, 'nothing was latched');
    for (let i = 0; i < 8; i++) {
      assert.ok(board.nodeVoltage(`net_q${i}`) < 1.0,
        `Q${i} showed un-latched data, got ${board.nodeVoltage(`net_q${i}`).toFixed(3)} V`);
    }
  });
});
