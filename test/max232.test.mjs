/**
 * E5.10 — MAX232 level shifter. Roadmap oracle: TTL 5 V in → RS-232
 * ≈ −8 V out, and back through a receiver to TTL.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerMax232 } from '../src/devices/max232.js';
import { unregisterDevice } from '../src/devices.js';

const TERMS = ['c1p', 'vp', 'c1m', 'c2p', 'c2m', 'vm',
  't2out', 'r2in', 'r2out', 't2in', 't1in', 'r1out', 'r1in', 't1out',
  'gnd', 'vcc'];

function bench() {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'max232', params: {}, terminals: [...TERMS] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    { id: 'RL', kind: 'resistor', params: { ohms: 100000 }, terminals: ['a', 'b'] },
    { id: 'RO', kind: 'resistor', params: { ohms: 100000 }, terminals: ['a', 'b'] },
  ];
  const nets = [
    { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'U1', terminal: 'vcc' }] },
    { id: 'net_gnd', terminals: [
      { part: 'GND', terminal: 'gnd' }, { part: 'U1', terminal: 'gnd' },
      { part: 'RL', terminal: 'b' }, { part: 'RO', terminal: 'b' }] },
    { id: 'net_ttl_in', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'U1', terminal: 't1in' }] },
    // The classic loopback: T1OUT wired straight into R1IN.
    { id: 'net_line', terminals: [
      { part: 'U1', terminal: 't1out' }, { part: 'U1', terminal: 'r1in' },
      { part: 'RL', terminal: 'a' }] },
    { id: 'net_ttl_out', terminals: [{ part: 'U1', terminal: 'r1out' }, { part: 'RO', terminal: 'a' }] },
  ];
  const b = new BoardImpl(5.0);
  b.setNetlist(parts, nets);
  return b;
}

describe('MAX232 level shifting', () => {
  beforeEach(() => registerMax232());
  afterEach(() => { try { unregisterDevice('max232'); } catch {} });

  it('TTL high → about −8 V on the line; the loopback receiver re-inverts to TTL high', () => {
    const b = bench();
    b.setPin('P1.0', 'pushpull', true);
    const line = b.nodeVoltage('net_line');
    assert.ok(line < -6, `driver inverts TTL high to negative RS-232: ${line.toFixed(2)} V`);
    // Line is below the receiver threshold → receiver output HIGH:
    // two inversions cancel, which is why the loopback echoes.
    assert.ok(b.nodeVoltage('net_ttl_out') > 4.0, 'R1OUT re-inverts back to TTL high');
  });

  it('TTL low → about +8 V on the line; receiver output goes low', () => {
    const b = bench();
    b.setPin('P1.0', 'pushpull', false);
    const line = b.nodeVoltage('net_line');
    assert.ok(line > 6, `driver inverts TTL low to positive RS-232: ${line.toFixed(2)} V`);
    assert.ok(b.nodeVoltage('net_ttl_out') < 1.0, 'R1OUT low');
  });

  it('the pump rails read ±8 V; an open receiver fails safe high', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'U1', kind: 'max232', params: {}, terminals: [...TERMS] },
      { id: 'R2', kind: 'resistor', params: { ohms: 100000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'U1', terminal: 'vcc' }] },
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' }, { part: 'U1', terminal: 'gnd' },
        { part: 'R2', terminal: 'b' }] },
      { id: 'net_vp', terminals: [{ part: 'U1', terminal: 'vp' }] },
      { id: 'net_vm', terminals: [{ part: 'U1', terminal: 'vm' }] },
      // r1in left unwired entirely: the 5 k input load idles it at 0 V.
      { id: 'net_r1out', terminals: [{ part: 'U1', terminal: 'r1out' }, { part: 'R2', terminal: 'a' }] },
    ];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    assert.ok(b.nodeVoltage('net_vp') > 7, 'V+ pump rail visible');
    assert.ok(b.nodeVoltage('net_vm') < -7, 'V− pump rail visible');
    assert.ok(b.nodeVoltage('net_r1out') > 4.0,
      'open RS-232 input reads below threshold through its own 5 k → fail-safe high');
  });
});
