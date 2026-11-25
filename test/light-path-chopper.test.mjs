/**
 * A slotted disc on a motor's shaft chops a light path (optics.js,
 * chopperTransmission): the light at the receiver pulses `slots` times per
 * revolution of the motor, at the angle the motor's own mechanical model
 * reaches, so the pulse rate follows the motor's speed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { chopperTransmission } from '../src/optics.js';

registerAllDevices();
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} +-${tol}`);

describe('chopperTransmission', () => {
  it('open at the opening centre, shut half a pitch away, a ramp over the beam width', () => {
    const P = { slots: 4, openFraction: 0.5, beamFraction: 0.2 };
    const pitch = 2 * Math.PI / 4;
    close(chopperTransmission(P, 0), 1, 1e-12, 'centre of an opening');
    close(chopperTransmission(P, pitch / 2), 0, 1e-12, 'centre of a bar');
    close(chopperTransmission(P, pitch / 4), 0.5, 1e-12, 'beam half over the edge');
    close(chopperTransmission(P, pitch / 4 - 0.1 * pitch), 1, 1e-12, 'beam just inside the opening');
    close(chopperTransmission(P, pitch / 4 - 0.05 * pitch), 0.75, 1e-12, 'a quarter of the beam on the bar');
    close(chopperTransmission(P, -pitch / 4), 0.5, 1e-12, 'other edge');
    close(chopperTransmission(P, 3 * pitch), 1, 1e-12, 'periodic');
    // The average over a turn is the open fraction.
    let sum = 0; const n = 4000;
    for (let i = 0; i < n; i++) sum += chopperTransmission(P, 2 * Math.PI * i / n);
    close(sum / n, 0.5, 1e-3, 'mean transmission');
  });
});

/** A motor on `volts` through its own switch-less supply; an LED (DC) shines
 * through `slots` slots of a disc on its shaft onto a phototransistor. */
function bench(volts, slots) {
  const b = new BoardImpl(9);
  b.setNetlist([
    { id: 'V', kind: 'vsource', params: { volts: 9 }, terminals: ['pos', 'neg'] },
    { id: 'VM', kind: 'vsource', params: { volts }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'M', kind: 'dc_motor', params: { kV: 0.01, windingR: 10, J: 5e-8 }, terminals: ['a', 'b'] },
    { id: 'RL', kind: 'resistor', params: { ohms: 470 }, terminals: ['a', 'b'] },
    { id: 'LED', kind: 'led', params: { color: 'red' }, terminals: ['anode', 'cathode'] },
    { id: 'PT', kind: 'phototransistor', params: {}, terminals: ['collector', 'emitter'] },
    { id: 'RE', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
    { id: 'DISC', kind: 'light_path', params: { from: 'LED', to: 'PT', medium: 'air', distanceCm: 1,
      chopper: 'M', slots, openFraction: 0.5, beamFraction: 0.2 }, terminals: [] },
  ], [
    net('vp', ['V', 'pos'], ['RL', 'a'], ['PT', 'collector']),
    net('vm', ['VM', 'pos'], ['M', 'a']),
    net('l', ['RL', 'b'], ['LED', 'anode']),
    net('e', ['PT', 'emitter'], ['RE', 'a']),
    net('g', ['G', 'gnd'], ['V', 'neg'], ['VM', 'neg'], ['M', 'b'], ['LED', 'cathode'], ['RE', 'b']),
  ]);
  b.setPower(true);
  return b;
}

/** Rising crossings per second of the phototransistor's emitter over `ms`. */
function pulseRate(b, fromMs, ms, stepUs = 20) {
  let hi = -Infinity, lo = Infinity;
  const samples = [];
  for (let t = fromMs * 1000; t <= (fromMs + ms) * 1000; t += stepUs) {
    b.advanceTo(BigInt(Math.round(t * 1000)));
    const v = b.nodeVoltage('e');
    samples.push(v); hi = Math.max(hi, v); lo = Math.min(lo, v);
  }
  // Rising crossings of the mid level, interpolated; the rate from the first
  // to the last one (no counting quantization).
  const mid = (hi + lo) / 2;
  const times = [];
  for (let i = 1; i < samples.length; i++) {
    if (samples[i - 1] < mid && samples[i] >= mid) {
      times.push((i - 1 + (mid - samples[i - 1]) / (samples[i] - samples[i - 1])) * stepUs * 1e-6);
    }
  }
  const hz = times.length < 2 ? 0 : (times.length - 1) / (times[times.length - 1] - times[0]);
  return { hz, lo, hi };
}

describe('a slotted disc on a dc_motor chops a light path', () => {
  it('pulses slots x revolutions per second, from the motor\'s own speed', () => {
    const b = bench(3, 4);
    b.advanceTo(40_000_000n);
    assert.equal(b.transientAnalysisStatus().failure, null);
    const { hz, lo, hi } = pulseRate(b, 40, 20);
    const w = b.getDeviceState('M').velocity;
    assert.ok(w > 250, `motor at speed: ${w} rad/s`);
    close(hz, 4 * w / (2 * Math.PI), 0.06 * 4 * w / (2 * Math.PI), 'pulse rate (Hz)');
    assert.ok(hi - lo > 0.3 * hi, `the light is chopped: ${lo.toFixed(3)}..${hi.toFixed(3)} V`);
    assert.ok(lo < 0.05 * hi, `a bar blocks the beam: ${lo.toFixed(4)} V`);
  });

  it('a faster motor, a faster pulse; a stopped one, steady light', () => {
    const slow = bench(2, 4); slow.advanceTo(40_000_000n);
    const fast = bench(4, 4); fast.advanceTo(40_000_000n);
    const a = pulseRate(slow, 40, 20).hz, c = pulseRate(fast, 40, 20).hz;
    assert.ok(c > 1.7 * a, `4 V: ${c} Hz against 2 V: ${a} Hz`);
    const stopped = bench(0, 4); stopped.advanceTo(10_000_000n);
    const s = pulseRate(stopped, 10, 10);
    assert.equal(s.hz, 0, 'no pulses with the motor stopped');
  });
});
