/**
 * E5.9 — DIP oscillator can. A powered clock module (OE/GND/OUT/VCC),
 * square at params.freq, high-Z when disabled or unpowered. Roadmap
 * oracle: a '93 divider chain off a 1 MHz can reads f/16 at QD.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerRetroDips } from '../src/devices/retro-dips.js';
import { registerLogicChips, CHIPS } from '../src/devices/chip-composer.js';
import { unregisterDevice } from '../src/devices.js';

function setup() { registerRetroDips(); registerLogicChips(); }
function teardown() {
  for (const c of CHIPS) { try { unregisterDevice(c.kind); } catch {} }
  for (const k of ['osc_can', 'crystal', 'w65c02', 'w65c22', 'w65c51',
    'z80', 'mc6850', 'tms9918', '74hc93']) {
    try { unregisterDevice(k); } catch {}
  }
}

describe('DIP oscillator can', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('a 1 MHz can through a mod-16 ripple counter puts f/16 on QD', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'X1', kind: 'osc_can', params: { freq: 1e6 },
        terminals: ['oe', 'gnd', 'out', 'vcc'] },
      { id: 'U1', kind: '74hc93', params: {},
        terminals: ['clk_a', 'clk_b', 'r0_1', 'r0_2', 'qa', 'qb', 'qc', 'qd', 'vcc', 'gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [
        { part: 'VCC', terminal: 'vcc' }, { part: 'X1', terminal: 'vcc' },
        { part: 'U1', terminal: 'vcc' }] },
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' }, { part: 'X1', terminal: 'gnd' },
        { part: 'U1', terminal: 'gnd' }, { part: 'R1', terminal: 'b' },
        { part: 'U1', terminal: 'r0_1' }, { part: 'U1', terminal: 'r0_2' }] },
      // OE deliberately unwired: a real can runs with OE floating (internal pullup).
      { id: 'net_clk', terminals: [{ part: 'X1', terminal: 'out' }, { part: 'U1', terminal: 'clk_a' }] },
      { id: 'net_ripple', terminals: [{ part: 'U1', terminal: 'qa' }, { part: 'U1', terminal: 'clk_b' }] },
      { id: 'net_qd', terminals: [{ part: 'U1', terminal: 'qd' }, { part: 'R1', terminal: 'a' }] },
    ];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);

    // March 200 µs in 1 µs ticks, counting QD rising edges after a
    // 40 µs settling head. f/16 = 62.5 kHz → period 16 µs.
    let last = b.nodeVoltage('net_qd') > 2.5;
    const rises = [];
    for (let us = 1; us <= 200; us++) {
      b.advanceTo(BigInt(us) * 1000n);
      const hi = b.nodeVoltage('net_qd') > 2.5;
      if (hi && !last && us > 40) rises.push(us);
      last = hi;
    }
    assert.ok(rises.length >= 5,
      `QD must toggle: ${rises.length} rising edges in 160 µs`);
    const period = (rises[rises.length - 1] - rises[0]) / (rises.length - 1);
    assert.ok(Math.abs(period - 16) <= 1.5,
      `QD period must be 16 µs (f/16 of 1 MHz), measured ${period.toFixed(1)} µs`);
  });

  it('OE wired low tri-states the output; high re-enables it', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'X1', kind: 'osc_can', params: { freq: 1e6 },
        terminals: ['oe', 'gnd', 'out', 'vcc'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'X1', terminal: 'vcc' }] },
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' }, { part: 'X1', terminal: 'gnd' },
        { part: 'R1', terminal: 'b' }] },
      { id: 'net_oe', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'X1', terminal: 'oe' }] },
      // Pull the output UP-ish via nothing: the 10k to gnd means high-Z reads low,
      // while a running can drives 0/5 alternately.
      { id: 'net_out', terminals: [{ part: 'X1', terminal: 'out' }, { part: 'R1', terminal: 'a' }] },
    ];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    b.setPin('P1.0', 'pushpull', false); // OE low: disabled

    // Disabled: across a full period the output never rises above the
    // pulldown's ground level.
    let sawHigh = false;
    for (let ns = 100; ns <= 2000; ns += 100) {
      b.advanceTo(BigInt(ns));
      if (b.nodeVoltage('net_out') > 1.0) sawHigh = true;
    }
    assert.equal(sawHigh, false, 'OE low: the can is high-Z, pulldown owns the net');

    // Enabled: within one period the output visits HIGH.
    b.setPin('P1.0', 'pushpull', true);
    sawHigh = false;
    for (let ns = 2100; ns <= 4100; ns += 100) {
      b.advanceTo(BigInt(ns));
      if (b.nodeVoltage('net_out') > 4.0) sawHigh = true;
    }
    assert.equal(sawHigh, true, 'OE high: the square wave is back');
  });
});
