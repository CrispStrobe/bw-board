// ledBrightness right after a user action reports the new state, not 20 ms of
// the old one; ledBrightnessNow is the instantaneous reading.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

const net = (id, ...pins) => ({ id, terminals: pins.map(([part, terminal]) => ({ part, terminal })) });
function bench() {
  const b = new BoardImpl(5);
  b.setNetlist([{ id: 'V', kind: 'vcc', params: {}, terminals: ['vcc'] }, { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'S', kind: 'button', params: {}, terminals: ['a', 'b'] },
    { id: 'R', kind: 'resistor', params: { ohms: 150 }, terminals: ['a', 'b'] },
    { id: 'L', kind: 'led', params: { vf: 2.0, color: 'red' }, terminals: ['anode', 'cathode'] }],
  [net('vcc', ['V', 'vcc'], ['S', 'a']), net('m', ['S', 'b'], ['R', 'a']), net('k', ['R', 'b'], ['L', 'anode']),
    net('gnd', ['G', 'gnd'], ['L', 'cathode'])]);
  b.setPower(true);
  return b;
}

test('a button press lights the LED at once and the reading does not average in the dark past', () => {
  const b = bench();
  b.advanceTo(50_000_000n);
  assert.ok(b.ledBrightness('L') < 1e-6);
  b.setControl('S', 1);
  const now = b.ledBrightnessNow('L');
  assert.ok(now > 0.5, `instantaneous ${now}`);
  assert.ok(Math.abs(b.ledBrightness('L') - now) < 1e-9, 'at the press instant');
  b.advanceTo(52_000_000n); // 2 ms later: was 10 % of full (2 of 20 ms)
  assert.ok(Math.abs(b.ledBrightness('L') - now) < 1e-3, `2 ms after: ${b.ledBrightness('L')}`);
  b.setControl('S', 0);
  assert.ok(b.ledBrightness('L') < 1e-6, 'release darkens it at once');
  b.advanceTo(53_000_000n);
  assert.ok(b.ledBrightness('L') < 1e-6);
});

test('a PWM-driven LED keeps its windowed mean (the action did not step it)', () => {
  const b = new BoardImpl(5);
  b.setNetlist([{ id: 'M', kind: 'mcu', params: { pins: ['P1.0'] }, terminals: ['P1.0'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] }, { id: 'V', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'R', kind: 'resistor', params: { ohms: 150 }, terminals: ['a', 'b'] },
    { id: 'L', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
    { id: 'S', kind: 'switch', params: {}, terminals: ['a', 'b'] },
    { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] }],
  [net('p', ['M', 'P1.0'], ['R', 'a']), net('k', ['R', 'b'], ['L', 'anode']), net('g', ['G', 'gnd'], ['L', 'cathode'], ['R2', 'b']),
    net('v', ['V', 'vcc'], ['S', 'a']), net('s', ['S', 'b'], ['R2', 'a'])]);
  b.setPower(true);
  b.setPwm('P1.0', 50);
  b.advanceTo(100_000_000n);
  const before = b.ledBrightness('L');
  b.setControl('S', 1); // an unrelated switch
  assert.ok(Math.abs(b.ledBrightness('L') - before) < 1e-9, 'unchanged by an unrelated action');
  assert.ok(before > 0.2 && before < 0.8, `PWM mean ${before}`);
});
