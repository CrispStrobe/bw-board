/**
 * Capacitor-across-rails tests: rail-parallel cap charges instantly,
 * series RC cap still follows exponential.
 *
 * Regression: a capacitor wired DIRECTLY VCC-GND read 0V on the
 * closed-form walker path because _integrateCapacitors skipped
 * rSource=0. The fix: instant charge to vTarget when rSource=0.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('cap-across-rails: walker path', () => {

  it('cap directly VCC-GND reads full supply voltage', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'C1', kind: 'capacitor', params: { farads: 100e-6 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'top', terminals: [
          { part: 'VCC', terminal: 'vcc' },
          { part: 'C1', terminal: 'a' },
        ]},
        { id: 'bot', terminals: [
          { part: 'GND', terminal: 'gnd' },
          { part: 'C1', terminal: 'b' },
        ]},
      ],
    );

    // After a tiny time step the cap should read 5V
    board.advanceTo(1_000_000n); // 1 ms
    const vTop = board.nodeVoltage('top');
    assert.ok(vTop > 4.5, `cap-top should be ~5V, got ${vTop.toFixed(3)}`);

    // Cap stored voltage should also be 5V
    const capV = board.capVoltages.get('C1');
    assert.ok(capV > 4.5, `cap voltage should be ~5V, got ${capV?.toFixed(3)}`);
  });

  it('cap VCC-GND with 3.3V supply reads 3.3V', () => {
    const board = new BoardImpl(3.3);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: { voltage: 3.3 }, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'C1', kind: 'capacitor', params: { farads: 10e-6 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'top', terminals: [
          { part: 'VCC', terminal: 'vcc' },
          { part: 'C1', terminal: 'a' },
        ]},
        { id: 'bot', terminals: [
          { part: 'GND', terminal: 'gnd' },
          { part: 'C1', terminal: 'b' },
        ]},
      ],
    );

    board.advanceTo(1_000_000n);
    const vTop = board.nodeVoltage('top');
    assert.ok(vTop > 3.0, `cap-top should be ~3.3V, got ${vTop.toFixed(3)}`);
  });
});

describe('series RC: exponential still exact (timing guard)', () => {

  it('series RC charges to 63% at 1 time constant (validates walker path)', () => {
    // R=10kΩ, C=10µF → τ = 100ms. At t=100ms, V = 5*(1-e^-1) ≈ 3.16V.
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'C1', kind: 'capacitor', params: { farads: 10e-6 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'vcc_net', terminals: [
          { part: 'VCC', terminal: 'vcc' },
          { part: 'R1', terminal: 'a' },
        ]},
        { id: 'rc_mid', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'C1', terminal: 'a' },
        ]},
        { id: 'gnd_net', terminals: [
          { part: 'GND', terminal: 'gnd' },
          { part: 'C1', terminal: 'b' },
        ]},
      ],
    );

    // At τ = 100 ms, voltage should be 63.2% of 5V ≈ 3.16V
    board.advanceTo(100_000_000n); // 100 ms
    const vMid = board.nodeVoltage('rc_mid');
    const expected = 5 * (1 - Math.exp(-1)); // 3.1606...
    assert.ok(Math.abs(vMid - expected) < 0.3,
      `at 1τ, cap should be ~${expected.toFixed(2)}V, got ${vMid.toFixed(3)}V`);
  });

  it('at 5τ, series RC is >99% charged', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'C1', kind: 'capacitor', params: { farads: 10e-6 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'vcc_net', terminals: [
          { part: 'VCC', terminal: 'vcc' },
          { part: 'R1', terminal: 'a' },
        ]},
        { id: 'rc_mid', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'C1', terminal: 'a' },
        ]},
        { id: 'gnd_net', terminals: [
          { part: 'GND', terminal: 'gnd' },
          { part: 'C1', terminal: 'b' },
        ]},
      ],
    );

    // At 5τ = 500 ms, cap should be >99% charged
    board.advanceTo(500_000_000n);
    const vMid = board.nodeVoltage('rc_mid');
    assert.ok(vMid > 4.9, `at 5τ, should be >99% (>4.9V), got ${vMid.toFixed(3)}V`);
  });
});
