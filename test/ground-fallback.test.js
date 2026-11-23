// Ground fallback: with no gnd part, the first vsource's neg terminal is
// the reference (spec-updates/ground-fallback-vsource-neg.md).
//
// The bench this models: battery feeds the rails, pin sinks the LED chain,
// and NO abstract gnd symbol exists anywhere — the real-bench build the
// seated inference derives. Before the rule, pin current had no return
// path and the LED read 0 while the emulator toggled the pin: "Blink does
// not blink", engine layer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function bench() {
  const b = new BoardImpl(5);
  b.setNetlist(
    [
      { id: 'bat', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
      { id: 'r1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'led1', kind: 'led', params: { vf: 2.0, color: 'red' }, terminals: ['anode', 'cathode'] },
      { id: 'mcu1', kind: 'mcu', params: { pins: ['P1.0'] }, terminals: ['P1.0', 'VCC', 'GND'] },
    ],
    [
      { id: 'n_plus', terminals: [{ part: 'bat', terminal: 'pos' }, { part: 'r1', terminal: 'a' }, { part: 'mcu1', terminal: 'VCC' }] },
      { id: 'n_mid', terminals: [{ part: 'r1', terminal: 'b' }, { part: 'led1', terminal: 'anode' }] },
      { id: 'n_pin', terminals: [{ part: 'led1', terminal: 'cathode' }, { part: 'mcu1', terminal: 'P1.0' }] },
      { id: 'n_minus', terminals: [{ part: 'bat', terminal: 'neg' }, { part: 'mcu1', terminal: 'GND' }] },
    ]
  );
  b.setPower(true);
  return b;
}

// The exponential LED (the default since round 3) in series with `ohms`
// across `volts`: n*Vt*ln(I/Is + 1) + I*rs + I*ohms = volts, Is calibrated so
// the part drops vf at 20 mA through rs = 10 (n = 1.8). Bisection.
function ledLoopAmps(volts, ohms, vf = 2.0) {
  const nVt = 1.8 * 0.02585, rs = 10, is = 0.02 / (Math.exp((vf - 0.02 * rs) / nVt) - 1);
  let lo = 0, hi = volts / ohms;
  for (let k = 0; k < 200; k++) {
    const i = (lo + hi) / 2;
    if (nVt * Math.log(i / is + 1) + i * (rs + ohms) < volts) lo = i; else hi = i;
  }
  return lo;
}

test('pin sinking low lights the battery-fed LED: the exponential loop through 1000 + 25 ohm, brightness 0.1587', () => {
  const b = bench();
  b.setPin('P1.0', 'quasi', false);
  b.advanceTo(10n * 1000000n);
  const brightness = b.ledBrightness('led1');
  // Hand oracle: the knee's (5 - 2) / (1000 + 25) = 2.927 mA (0.1463) until
  // round 3; the exponential LED drops less than its rated 2.0 V at 3 mA:
  // 3.17 mA, 0.1587.
  const want = ledLoopAmps(5, 1025) / 0.02;
  assert.ok(Math.abs(brightness - want) < 0.01,
    `expected ~${want.toFixed(4)}, got ${brightness}`);
});

test('pin high (quasi): no sink, LED dark', () => {
  const b = bench();
  b.setPin('P1.0', 'quasi', true);
  b.advanceTo(10n * 1000000n);
  assert.ok(b.ledBrightness('led1') < 0.02,
    `expected dark, got ${b.ledBrightness('led1')}`);
});

test('an explicit gnd part still wins over the vsource fallback', () => {
  const b = new BoardImpl(5);
  b.setNetlist(
    [
      { id: 'g', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'bat', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
      { id: 'r1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    ],
    [
      { id: 'n1', terminals: [{ part: 'bat', terminal: 'pos' }, { part: 'r1', terminal: 'a' }] },
      { id: 'n2', terminals: [{ part: 'r1', terminal: 'b' }, { part: 'bat', terminal: 'neg' }, { part: 'g', terminal: 'gnd' }] },
    ]
  );
  b.setPower(true);
  b.advanceTo(1n * 1000000n);
  // n2 is ground BY THE OLD RULE; its node voltage must read 0.
  assert.ok(Math.abs(b.nodeVoltage('n2')) < 1e-9);
  assert.ok(Math.abs(b.nodeVoltage('n1') - 5) < 1e-6);
});

test('battery-only loop (no pins, no gnd) still solves as before', () => {
  const b = new BoardImpl(5);
  b.setNetlist(
    [
      { id: 'bat', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
      { id: 'r1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'led1', kind: 'led', params: { vf: 2.0, color: 'red' }, terminals: ['anode', 'cathode'] },
    ],
    [
      { id: 'n1', terminals: [{ part: 'bat', terminal: 'pos' }, { part: 'r1', terminal: 'a' }] },
      { id: 'n2', terminals: [{ part: 'r1', terminal: 'b' }, { part: 'led1', terminal: 'anode' }] },
      { id: 'n3', terminals: [{ part: 'led1', terminal: 'cathode' }, { part: 'bat', terminal: 'neg' }] },
    ]
  );
  b.setPower(true);
  b.advanceTo(1n * 1000000n);
  // (5 - 2) / 1000 = 3 mA → 0.15 with the knee; the exponential red LED
  // (vf 2.0 given explicitly) carries 3.25 mA → 0.1626.
  const want = ledLoopAmps(5, 1000) / 0.02;
  assert.ok(Math.abs(b.ledBrightness('led1') - want) < 0.01,
    `expected ~${want.toFixed(4)}, got ${b.ledBrightness('led1')}`);
});
