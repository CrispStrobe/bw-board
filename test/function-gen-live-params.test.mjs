// A function generator's knobs are live: every waveform param set through
// setPartParam after the netlist is loaded reaches the solver.
//
// Gap (2026-11-23, round 2): setPartParam('function_gen_5', 'freq', 500) on
// lab-push-pull still produced 50 Hz. The generator is expanded into a hidden
// waveform vsource in the SOLVER view (BoardImpl._expandFunctionGenerators),
// and that hidden part had copied the params once, at setNetlist; a later
// param edit only changed the drawn part.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();
const net = (id, ...pins) => ({ id, terminals: pins.map(([part, terminal]) => ({ part, terminal })) });

function bench(params) {
  const b = new BoardImpl(5);
  b.setNetlist([{ id: 'F', kind: 'function_gen', params: { rOut: 0, ...params }, terminals: ['out', 'gnd'] },
    { id: 'R', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] }],
  [net('o', ['F', 'out'], ['R', 'a']), net('g', ['F', 'gnd'], ['R', 'b'], ['G', 'gnd'])]);
  b.setPower(true);
  return b;
}
const at = (b, ns) => { b.advanceTo(BigInt(ns)); return b.nodeVoltage('o'); };
const close = (a, e, tol, what) => assert.ok(Math.abs(a - e) < tol, `${what}: ${a} vs ${e}`);

test('freq change after load moves the output frequency (50 Hz -> 500 Hz)', () => {
  const b = bench({ wave: 'sine', freq: 50, amplitude: 4 });
  // 50 Hz: at 5 ms (quarter period) the sine is at its +4 V peak.
  close(at(b, 5_000_000), 4, 1e-3, '50 Hz peak');
  b.setPartParam('F', 'freq', 500);
  // 500 Hz: phase is t*f, so at t = 20.5 ms the cycle fraction is 0.25 -> +4 V;
  // at 50 Hz the same instant would read 4*sin(2*pi*1.025) = +0.63 V.
  close(at(b, 20_500_000), 4, 1e-2, '500 Hz peak');
  close(at(b, 21_500_000), -4, 1e-2, '500 Hz trough');
});

test('the `frequency` alias is live too, even when `freq` was authored', () => {
  const b = bench({ wave: 'sine', freq: 50, amplitude: 1 });
  at(b, 1_000_000);
  b.setPartParam('F', 'frequency', 1000);
  close(at(b, 10_250_000), 1, 1e-2, '1 kHz peak at 10.25 ms');
  assert.equal(b.getPartParam('F', 'frequency'), 1000);
});

test('amplitude, offset, waveform and duty are live', () => {
  const b = bench({ wave: 'square', freq: 1000, amplitude: 1, duty: 0.5 });
  close(at(b, 250_000), 1, 1e-3, 'square high');
  b.setPartParam('F', 'amplitude', 3);
  close(at(b, 1_250_000), 3, 1e-3, 'amplitude 3');
  b.setPartParam('F', 'offset', 1);
  close(at(b, 2_250_000), 4, 1e-3, 'offset 1');
  close(at(b, 2_750_000), -2, 1e-3, 'offset 1, low half');
  b.setPartParam('F', 'duty', 0.9);
  // duty 0.9: 0.8 into the cycle is still the high part
  close(at(b, 3_800_000), 4, 1e-3, 'duty 0.9 high at 0.8 of cycle');
  b.setPartParam('F', 'waveform', 'dc');
  // The vsource vocabulary: 'dc' outputs `volts` (the amplitude unless set)
  close(at(b, 4_300_000), 3, 1e-3, 'waveform dc');
  b.setPartParam('F', 'wave', 'triangle');
  // triangle at cycle fraction 0.5 is the +amplitude peak, plus offset
  close(at(b, 5_500_000), 4, 1e-2, 'triangle peak');
});

test('rOut is live', () => {
  const b = bench({ wave: 'dc', volts: 2, rOut: 1000 });
  close(at(b, 1_000_000), 1, 1e-3, '2 V through 1k into 1k');
  b.setPartParam('F', 'rOut', 3000);
  close(at(b, 2_000_000), 0.5, 1e-3, '2 V through 3k into 1k');
});
