/**
 * Stress tests: large netlists, many components, rapid state changes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('stress: large netlist', () => {
  it('20 LEDs with individual resistors', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ];
    const mcuTerminals = [];
    const nets = [];
    const vccNet = { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }] };
    const gndNet = { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] };

    for (let i = 0; i < 20; i++) {
      const port = Math.floor(i / 8);
      const bit = i % 8;
      const pinId = `P${port}.${bit}`;
      mcuTerminals.push(pinId);

      parts.push({ id: `R${i}`, kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] });
      parts.push({ id: `LED${i}`, kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] });

      vccNet.terminals.push({ part: `R${i}`, terminal: 'a' });
      nets.push({
        id: `nr${i}`,
        terminals: [{ part: `R${i}`, terminal: 'b' }, { part: `LED${i}`, terminal: 'anode' }],
      });
      nets.push({
        id: `np${i}`,
        terminals: [{ part: `LED${i}`, terminal: 'cathode' }, { part: 'MCU', terminal: pinId }],
      });
    }

    parts.push({ id: 'MCU', kind: 'mcu', params: {}, terminals: mcuTerminals });
    nets.push(vccNet);
    nets.push(gndNet);

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Turn on all 20 LEDs
    for (let i = 0; i < 20; i++) {
      const port = Math.floor(i / 8);
      const bit = i % 8;
      board.setPin(`P${port}.${bit}`, 'pushpull', false);
    }
    board.advanceTo(1_000_000n);

    // All should be on
    for (let i = 0; i < 20; i++) {
      const b = board.ledBrightness(`LED${i}`);
      assert.ok(b > 0.10, `LED${i} brightness ${b} should be > 0.10`);
    }

    // Turn off the even ones
    for (let i = 0; i < 20; i += 2) {
      const port = Math.floor(i / 8);
      const bit = i % 8;
      board.setPin(`P${port}.${bit}`, 'pushpull', true);
    }
    board.advanceTo(25_000_000n);

    for (let i = 0; i < 20; i++) {
      const b = board.ledBrightness(`LED${i}`);
      if (i % 2 === 0) {
        assert.ok(b < 0.01, `LED${i} (even, off) brightness ${b}`);
      } else {
        assert.ok(b > 0.10, `LED${i} (odd, on) brightness ${b}`);
      }
    }
  });

  it('MNA solver handles 20-LED netlist', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ];
    const nets = [];
    const vccNet = { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] };
    const gndNet = { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] };

    for (let i = 0; i < 20; i++) {
      parts.push({ id: `R${i}`, kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] });
      parts.push({ id: `LED${i}`, kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] });

      vccNet.terminals.push({ part: `R${i}`, terminal: 'a' });
      nets.push({
        id: `nr${i}`,
        terminals: [{ part: `R${i}`, terminal: 'b' }, { part: `LED${i}`, terminal: 'anode' }],
      });
      gndNet.terminals.push({ part: `LED${i}`, terminal: 'cathode' });
    }

    nets.push(vccNet);
    nets.push(gndNet);

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // All 20 LED currents should be computable
    for (let i = 0; i < 20; i++) {
      const current = board.branchCurrent(`LED${i}`, 'anode');
      // I = (5-2)/(1000+10) = 2.970 mA
      assert.ok(Math.abs(current - 0.00297) < 0.0005,
        `LED${i} current ${current} should be ~2.97 mA`);
    }
  });
});

describe('stress: rapid pin toggling', () => {
  it('10000 pin toggles without memory issues', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
    ];
    board.setNetlist(parts, nets);

    for (let i = 0; i < 10000; i++) {
      board.advanceTo(BigInt(i) * 100_000n); // 100µs intervals
      board.setPin('P1.0', 'pushpull', i % 2 === 0);
    }

    // Should still work correctly
    const b = board.ledBrightness('LED1');
    assert.ok(!Number.isNaN(b), 'brightness should not be NaN after 10K toggles');
    // 50% duty
    assert.ok(b > 0.05, `brightness ${b} should be ~50% of steady state`);
    assert.ok(b < 0.10, `brightness ${b} should be ~50% of steady state`);
  });
});

describe('stress: resistance measurement on large network', () => {
  it('10 resistors in series', () => {
    const board = new BoardImpl(5.0);
    const parts = [{ id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] }];
    const nets = [{ id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] }];

    for (let i = 0; i < 10; i++) {
      parts.push({ id: `R${i}`, kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] });
      nets.push({
        id: `n${i}`,
        terminals: [
          { part: `R${i}`, terminal: 'a' },
          ...(i > 0 ? [{ part: `R${i - 1}`, terminal: 'b' }] : []),
        ],
      });
    }
    // Last resistor's b terminal
    nets.push({ id: 'n_end', terminals: [{ part: 'R9', terminal: 'b' }] });

    board.setNetlist(parts, nets);
    board.setPower(false);

    const r = board.resistance('n0', 'n_end');
    assert.ok(typeof r === 'number');
    assert.ok(Math.abs(/** @type {number} */(r) - 10000) < 50,
      `10 × 1kΩ in series = ${r}, expected 10kΩ`);
  });
});
