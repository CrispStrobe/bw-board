/**
 * Regression tests: specific bugs that were found and fixed.
 * Each test documents the bug and verifies the fix.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { inferNetlist } from '../src/infer-netlist.js';

describe('regression: LED brightness pruning (was losing samples)', () => {
  it('brightness correct after long gap between setPin and advanceTo', () => {
    // Bug: LED samples were pruned too aggressively, losing the sample
    // that established the current. After a long advanceTo, the brightness
    // integrator had no record of the LED being on.
    const { parts, nets } = inferNetlist({
      pins: [
        { name: 'led', port: 1, bit: 0, direction: 'output', activeLow: true },
        { name: 'pot', port: 1, bit: 3, direction: 'analog', activeLow: false },
        { name: 'btn', port: 3, bit: 2, direction: 'input', activeLow: false },
      ],
    });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    board.setPin('P1.0', 'quasi', true);
    board.setPin('P1.3', 'input', false);
    board.setPin('P3.2', 'input', false);
    board.setControl('POT_pot', 0.5);
    board.advanceTo(0n);

    // Turn on at 10ms
    board.advanceTo(10_000_000n);
    board.setPin('P1.0', 'quasi', false);

    // Check at 260ms — long gap
    board.advanceTo(260_000_000n);
    const b = board.ledBrightness('LED_led');
    assert.ok(b > 0.10, `brightness after long gap: ${b} should be > 0.10`);
  });
});

describe('regression: parallel paths to same known-voltage net', () => {
  it('three resistors in parallel to GND produce correct node voltage', () => {
    // Bug: _gatherSources marked GND net as visited after the first path,
    // so the second and third parallel resistors to GND were missed.
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R_top', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R3', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R_top', terminal: 'a' }] },
        { id: 'nm', terminals: [
          { part: 'R_top', terminal: 'b' },
          { part: 'R1', terminal: 'a' },
          { part: 'R2', terminal: 'a' },
          { part: 'R3', terminal: 'a' },
        ]},
        { id: 'ng', terminals: [
          { part: 'GND', terminal: 'gnd' },
          { part: 'R1', terminal: 'b' },
          { part: 'R2', terminal: 'b' },
          { part: 'R3', terminal: 'b' },
        ]},
      ],
    );

    // R_bottom = 1k ∥ 1k ∥ 1k = 333.33Ω
    // V = 5 * 333.33 / (1000 + 333.33) = 1.25V
    const v = board.nodeVoltage('nm');
    assert.ok(Math.abs(v - 1.25) < 0.02,
      `parallel paths: ${v} should be 1.25V, not 2.5V`);
  });
});

describe('regression: RC source impedance through cached net', () => {
  it('quasi pin charges cap slowly (not instantly through cached 5V net)', () => {
    // Bug: _integrateCapacitors used _traceToSource which stopped at a cached
    // net voltage, losing the quasi pin's 21.7kΩ source impedance.
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'C1', kind: 'capacitor', params: { farads: 0.0001 }, terminals: ['a', 'b'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'np', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nrc', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
      ],
    );
    board.setPin('P1.0', 'quasi', true);

    // RC = (21700 + 1000) * 0.0001 = 2.27s. After 0.5s (~0.22RC), should be ~20%
    board.advanceTo(500_000_000n);
    const v = board.nodeVoltage('nrc');
    assert.ok(v < 2.0, `quasi RC at 0.22RC: ${v} should be < 2.0V (not 5V)`);
    assert.ok(v > 0.5, `quasi RC at 0.22RC: ${v} should be > 0.5V`);
  });
});

describe('regression: setNetlist calls _solve() and _recordLedSamples', () => {
  it('pin state set before setNetlist is reflected in brightness', () => {
    // Bug: setNetlist didn't call _solve() or _recordLedSamples, so
    // pre-existing pin states weren't reflected.
    const board = new BoardImpl(5.0);
    board.setPin('P1.0', 'pushpull', false); // set BEFORE netlist

    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
        { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    board.advanceTo(25_000_000n);

    assert.ok(board.ledBrightness('LED1') > 0.10,
      'pre-existing pin state should produce brightness');
  });
});

describe('regression: setPower(false) clears node voltages and records samples', () => {
  it('LED brightness drops to 0 after power off + window time', () => {
    // Bug: setPower(false) didn't call _solve() or _recordLedSamples,
    // so LED brightness stayed at the pre-off value.
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
        { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(1_000_000n);
    assert.ok(board.ledBrightness('LED1') > 0.10, 'LED on');

    board.setPower(false);
    board.advanceTo(25_000_000n); // past the 20ms window
    assert.ok(board.ledBrightness('LED1') < 0.01, 'LED off after power off');
  });
});

describe('regression: cap voltage initialized to 0 in setNetlist', () => {
  it('uncharged cap reads 0V at t=0', () => {
    // Bug: cap had no entry in capVoltages at t=0, so the voltage override
    // didn't fire and the net showed the steady-state (fully charged) value.
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'C1', kind: 'capacitor', params: { farads: 0.0001 }, terminals: ['a', 'b'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nrc', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'C1', terminal: 'a' },
          { part: 'MCU', terminal: 'P1.3' },
        ]},
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
      ],
    );
    board.setPin('P1.3', 'input', false);

    // At t=0, cap should be 0V (uncharged)
    const v = board.readAnalog('P1.3');
    assert.ok(v < 0.1, `uncharged cap at t=0: ${v} should be ~0V, not 5V`);
    assert.equal(board.readPin('P1.3'), 0, 'digital: below threshold');
  });
});
