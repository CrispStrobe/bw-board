/**
 * Detailed snapshot/restore tests: multiple snapshots, interleaving,
 * restore after netlist change, cap voltage preservation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('snapshot: multiple save points', () => {
  it('can restore to any of several snapshots', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'POT', kind: 'potentiometer', params: { ohms: 10000 }, terminals: ['a', 'b', 'wiper'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'POT', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'POT', terminal: 'b' }] },
        { id: 'nw', terminals: [{ part: 'POT', terminal: 'wiper' }, { part: 'MCU', terminal: 'P1.3' }] },
      ],
    );
    board.setPin('P1.3', 'input', false);

    // Snapshot 1: pot at 0.2
    board.setControl('POT', 0.2);
    board.advanceTo(1_000_000n);
    const snap1 = board.snapshot();

    // Snapshot 2: pot at 0.5
    board.setControl('POT', 0.5);
    board.advanceTo(2_000_000n);
    const snap2 = board.snapshot();

    // Snapshot 3: pot at 0.9
    board.setControl('POT', 0.9);
    board.advanceTo(3_000_000n);
    const snap3 = board.snapshot();

    // Restore to snap1
    board.restore(snap1);
    assert.equal(board.getControl('POT'), 0.2);
    assert.equal(board.getTime(), 1_000_000n);
    assert.ok(Math.abs(board.readAnalog('P1.3') - 1.0) < 0.1);

    // Restore to snap3
    board.restore(snap3);
    assert.equal(board.getControl('POT'), 0.9);
    assert.equal(board.getTime(), 3_000_000n);

    // Restore to snap2
    board.restore(snap2);
    assert.equal(board.getControl('POT'), 0.5);
    assert.equal(board.getTime(), 2_000_000n);
    assert.ok(Math.abs(board.readAnalog('P1.3') - 2.5) < 0.1);
  });
});

describe('snapshot: preserves capacitor charge', () => {
  it('cap voltage restored correctly', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'C1', kind: 'capacitor', params: { farads: 0.001 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nrc', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
      ],
    );

    // Charge to ~63% (1 RC = 1s)
    board.advanceTo(1_000_000_000n);
    const vAtRC = board.getCapVoltage('C1');
    assert.ok(vAtRC > 2.5 && vAtRC < 4.0, `at 1RC: ${vAtRC}`);
    const snap = board.snapshot();

    // Continue charging to ~99%
    board.advanceTo(5_000_000_000n);
    assert.ok(board.getCapVoltage('C1') > 4.9);

    // Restore to 1RC
    board.restore(snap);
    assert.ok(Math.abs(board.getCapVoltage('C1') - vAtRC) < 0.01,
      `restored cap voltage: ${board.getCapVoltage('C1')} ≈ ${vAtRC}`);
  });
});

describe('snapshot: preserves power state', () => {
  it('restores powered-off state', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );

    board.setPower(false);
    const snap = board.snapshot();
    board.setPower(true);
    assert.equal(board.isPowered(), true);

    board.restore(snap);
    assert.equal(board.isPowered(), false);
  });
});

describe('reset: preserves controls', () => {
  it('controls survive reset', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'POT', kind: 'potentiometer', params: { ohms: 10000 }, terminals: ['a', 'b', 'wiper'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'POT', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'POT', terminal: 'b' }] },
        { id: 'nw', terminals: [{ part: 'POT', terminal: 'wiper' }] },
      ],
    );
    board.setControl('POT', 0.7);
    board.setPin('P1.0', 'quasi', false);
    board.advanceTo(5_000_000n);

    board.reset();
    // Controls preserved
    assert.equal(board.getControl('POT'), 0.7);
    // Pin states cleared
    assert.equal(board.getPinState('P1.0'), null);
    // Time reset
    assert.equal(board.getTime(), 0n);
  });
});

describe('reset: clears cap voltages', () => {
  it('caps go back to 0V', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'C1', kind: 'capacitor', params: { farads: 0.001 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nrc', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
      ],
    );
    board.advanceTo(5_000_000_000n);
    assert.ok(board.getCapVoltage('C1') > 4.9);

    board.reset();
    assert.equal(board.getCapVoltage('C1'), 0);
  });
});
