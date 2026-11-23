// Device timing: devices are stepped at their own event times and at the
// transient step, not on a 1 ms grid, and a long single advance completes.
//
// Before: a params-frequency 555 toggled only on the 1 ms device grid (440 Hz
// read 250 Hz, 2 kHz and 7 kHz both read 500 Hz); a wired 6.9 kHz astable ran
// 8 % slow with 18 % period jitter because a comparator flip was noticed only
// at the END of the transient step that crossed the threshold; and one 2 s
// advance of a slow astable hit the flat 200-sub-step cap and poisoned every
// later measurement ("device sub-step budget exhausted").
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerTimer555 } from '../src/devices/timer-555.js';
import { registerDevice, unregisterDevice } from '../src/devices.js';

registerTimer555();
const net = (id, ...pins) => ({ id, terminals: pins.map(([part, terminal]) => ({ part, terminal })) });
const T555 = ['vcc', 'gnd', 'trigger', 'threshold', 'control', 'discharge', 'output', 'reset'];

function astable(R1, R2, C) {
  const b = new BoardImpl(5);
  b.setNetlist([
    { id: 'V', kind: 'vcc', params: {}, terminals: ['vcc'] }, { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U', kind: 'timer_555', params: { rOut: 50 }, terminals: T555 },
    { id: 'R1', kind: 'resistor', params: { ohms: R1 }, terminals: ['a', 'b'] },
    { id: 'R2', kind: 'resistor', params: { ohms: R2 }, terminals: ['a', 'b'] },
    { id: 'C', kind: 'capacitor', params: { farads: C }, terminals: ['a', 'b'] },
    { id: 'RL', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
  ], [net('vcc', ['V', 'vcc'], ['U', 'vcc'], ['R1', 'a'], ['U', 'reset']),
    net('gnd', ['G', 'gnd'], ['U', 'gnd'], ['C', 'b'], ['RL', 'b']),
    net('dis', ['R1', 'b'], ['U', 'discharge'], ['R2', 'a']),
    net('cap', ['R2', 'b'], ['U', 'threshold'], ['U', 'trigger'], ['C', 'a']),
    net('ctl', ['U', 'control']), net('out', ['U', 'output'], ['RL', 'a'])]);
  b.setPower(true);
  return b;
}

function freeRunning(hz) {
  const b = new BoardImpl(5);
  b.setNetlist([
    { id: 'V', kind: 'vcc', params: {}, terminals: ['vcc'] }, { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U', kind: 'timer_555', params: { rOut: 50, frequency: hz }, terminals: T555 },
    { id: 'RL', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
  ], [net('vcc', ['V', 'vcc'], ['U', 'vcc'], ['U', 'reset']), net('gnd', ['G', 'gnd'], ['U', 'gnd'], ['RL', 'b']),
    net('thr', ['U', 'threshold']), net('trg', ['U', 'trigger']), net('ctl', ['U', 'control']),
    net('out', ['U', 'output'], ['RL', 'a'])]);
  b.setPower(true);
  return b;
}

/** Rising-edge times of `out` from a logic-analyzer channel, after `skipNs`. */
function rises(b, handle, skipNs) {
  const d = b.getScopeData(handle);
  const out = [];
  for (let i = 0; i < Math.min(d.count, d.depth); i++) {
    if (d.transitions[2 * i + 1] === 1 && d.transitions[2 * i] > skipNs) out.push(d.transitions[2 * i]);
  }
  return out;
}
const freqOf = r => (r.length - 1) / ((r.at(-1) - r[0]) / 1e9);

for (const hz of [440, 2000, 7000]) {
  test(`a params-frequency 555 toggles at its own times: ${hz} Hz in one 50 ms advance`, () => {
    const b = freeRunning(hz);
    const h = b.addScopeChannel({ type: 'digital', netId: 'out', depth: 4096 });
    b.advanceTo(50_000_000n);
    const r = rises(b, h, 5e6);
    assert.ok(Math.abs(freqOf(r) - hz) / hz < 1e-3, `measured ${freqOf(r)} Hz`);
  });
}

test('wired 555 astable at audio rate: period within 2 % of 0.693(R1+2R2)C, no step jitter', () => {
  const [R1, R2, C] = [1000, 10000, 10e-9];
  const theory = 1 / (Math.LN2 * (R1 + 2 * R2) * C); // 6870 Hz
  const b = astable(R1, R2, C);
  const h = b.addScopeChannel({ type: 'digital', netId: 'out', depth: 4096 });
  b.advanceTo(20_000_000n); // ONE advance
  const r = rises(b, h, 4e6);
  const f = freqOf(r);
  assert.ok(Math.abs(f - theory) / theory < 0.02, `measured ${f.toFixed(1)} Hz vs ${theory.toFixed(1)} Hz`);
  const periods = r.slice(1).map((t, i) => t - r[i]);
  const spread = (Math.max(...periods) - Math.min(...periods)) / Math.min(...periods);
  assert.ok(spread < 0.01, `period spread ${(100 * spread).toFixed(2)} % (was 18 % before event localization)`);
});

test('one long advance and many short ones give the same astable edges', () => {
  const one = astable(1000, 10000, 10e-9), many = astable(1000, 10000, 10e-9);
  const h1 = one.addScopeChannel({ type: 'digital', netId: 'out', depth: 4096 });
  const h2 = many.addScopeChannel({ type: 'digital', netId: 'out', depth: 4096 });
  one.advanceTo(10_000_000n);
  for (let t = 1_000_000n; t <= 10_000_000n; t += 1_000_000n) many.advanceTo(t);
  const a = rises(one, h1, 0), c = rises(many, h2, 0);
  assert.equal(a.length, c.length);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - c[i]) < 200, `edge ${i}: ${a[i]} vs ${c[i]}`);
});

test('a 2 s single advance of a 4.8 Hz astable completes: no sub-step overflow, measurements stay valid', () => {
  const b = astable(10000, 10000, 10e-6);
  b.meterVoltage('cap');
  b.advanceTo(2_000_000_000n);
  assert.equal(b.getTime(), 2_000_000_000n);
  assert.equal(b._deviceSubstepOverflow, false);
  assert.equal(b.getWarnings().some(w => /sub-step limit/.test(w.message)), false);
  const v = b.meterVoltage('cap');
  assert.ok(v > 1.5 && v < 3.5, `cap mean ${v}`);
});

test('the sub-step budget is a runaway backstop: a 1 ns self-waking device makes the advance throw, never over-report time', () => {
  registerDevice('test_ring_1ns', {
    terminals: ['out'],
    init: () => ({ drives: { out: { vTh: 0, rTh: 100 } }, _wakeNs: 1n, level: 0 }),
    update(part, state, read, tNs) {
      if (state._wakeNs && BigInt(tNs) < state._wakeNs) return false;
      state.level ^= 1;
      state.drives.out = { vTh: state.level ? 5 : 0, rTh: 100 };
      state._wakeNs = BigInt(tNs) + 1n;
      return true;
    },
  });
  try {
    const b = new BoardImpl(5);
    b.setNetlist([{ id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'X', kind: 'test_ring_1ns', params: {}, terminals: ['out'] },
      { id: 'R', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] }],
    [net('o', ['X', 'out'], ['R', 'a']), net('g', ['G', 'gnd'], ['R', 'b'])]);
    b.setPower(true);
    // 100 us = 100,000 events; budget 200 + 100. The ADVANCE throws, and the
    // clock reports only the time that was actually simulated.
    assert.throws(() => b.advanceTo(100_000n), e => e.code === 'DEVICE_SUBSTEP_BUDGET_EXHAUSTED');
    assert.equal(b.getTime(), 300n, '300 one-nanosecond events, not the requested 100 us');
    assert.equal(b._deviceSubstepOverflow, true);
    assert.ok(b.getWarnings().some(w => /sub-step limit/.test(w.message)));
    assert.throws(() => b.meterVoltage('o'), /device sub-step budget exhausted/);
  } finally {
    unregisterDevice('test_ring_1ns');
  }
});
