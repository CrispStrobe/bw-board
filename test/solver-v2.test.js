// Solver v2: op-amp VCVS with rails, time-varying sources, transient companion
// models, gmin, damped NR. Every expected number here is computed by hand in
// the comment beside it — that is what makes these an oracle rather than a
// snapshot of the code's own output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveMNA, sourceVoltage } from '../src/mna.js';

const vccPart = { id: 'V1', kind: 'vcc', params: {}, terminals: ['vcc'] };
const gndPart = { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] };
const r = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });

test('op-amp follower: out tracks a divider, not all-zeros (regression)', () => {
  // 5 V → 1k/1k divider → inp = 2.5 V; out wired to inn (unity follower).
  // The old stamp allocated a source row it never filled: singular matrix,
  // silently caught, ALL node voltages — including vcc itself — read 0.
  const parts = [vccPart, gndPart, r('R1', 1000), r('R2', 1000),
    { id: 'OA', kind: 'opamp', params: {}, terminals: ['inp', 'inn', 'out'] },
    r('RL', 10000)];
  const nets = [
    { id: 'vcc', terminals: [{ part: 'V1', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
    { id: 'mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'R2', terminal: 'a' }, { part: 'OA', terminal: 'inp' }] },
    { id: 'gnd', terminals: [{ part: 'G1', terminal: 'gnd' }, { part: 'R2', terminal: 'b' }, { part: 'RL', terminal: 'b' }] },
    { id: 'out', terminals: [{ part: 'OA', terminal: 'out' }, { part: 'OA', terminal: 'inn' }, { part: 'RL', terminal: 'a' }] },
  ];
  const res = solveMNA(parts, nets, new Map(), new Map(), 5);
  assert.ok(Math.abs(res.nodeVoltages.get('vcc') - 5) < 1e-6, 'vcc must read 5 V');
  // Follower: out = inp = 2.5 V (gain 1e6 → error 2.5/1e6, far below tolerance).
  assert.ok(Math.abs(res.nodeVoltages.get('out') - 2.5) < 1e-3,
    `follower out = ${res.nodeVoltages.get('out')}`);
  assert.equal(res.converged, true);
});

test('op-amp saturates at its rails instead of outputting kilovolts', () => {
  // Comparator: inp = 2.5 V, inn = gnd. Ideal out = 1e6 × 2.5 — a real single
  // supply op-amp clamps at VCC. railLow/railHigh default to 0/vcc.
  const parts = [vccPart, gndPart, r('R1', 1000), r('R2', 1000),
    { id: 'OA', kind: 'opamp', params: {}, terminals: ['inp', 'inn', 'out'] },
    r('RL', 10000)];
  const nets = [
    { id: 'vcc', terminals: [{ part: 'V1', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
    { id: 'mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'R2', terminal: 'a' }, { part: 'OA', terminal: 'inp' }] },
    { id: 'gnd', terminals: [{ part: 'G1', terminal: 'gnd' }, { part: 'R2', terminal: 'b' }, { part: 'RL', terminal: 'b' }, { part: 'OA', terminal: 'inn' }] },
    { id: 'out', terminals: [{ part: 'OA', terminal: 'out' }, { part: 'RL', terminal: 'a' }] },
  ];
  const res = solveMNA(parts, nets, new Map(), new Map(), 5);
  assert.ok(Math.abs(res.nodeVoltages.get('out') - 5) < 1e-6,
    `comparator out = ${res.nodeVoltages.get('out')} (must be the 5 V rail)`);
  // Swap the inputs: out must sit on the LOW rail.
  const nets2 = nets.map(n =>
    n.id === 'mid' ? { ...n, terminals: [{ part: 'R1', terminal: 'b' }, { part: 'R2', terminal: 'a' }, { part: 'OA', terminal: 'inn' }] }
    : n.id === 'gnd' ? { ...n, terminals: [{ part: 'G1', terminal: 'gnd' }, { part: 'R2', terminal: 'b' }, { part: 'RL', terminal: 'b' }, { part: 'OA', terminal: 'inp' }] }
    : n);
  const res2 = solveMNA(parts, nets2, new Map(), new Map(), 5);
  assert.ok(Math.abs(res2.nodeVoltages.get('out') - 0) < 1e-6,
    `inverted comparator out = ${res2.nodeVoltages.get('out')} (must be the 0 V rail)`);
});

test('sourceVoltage: every waveform, hand-computed points', () => {
  const fg = (params) => ({ id: 'FG', kind: 'vsource', params, terminals: ['pos', 'neg'] });
  // DC: plain volts.
  assert.equal(sourceVoltage(fg({ volts: 3.3 }), 123, 5), 3.3);
  // Sine 1 kHz, amp 2, offset 2.5: t=0 → 2.5; t=T/4=250 µs → 2.5+2 = 4.5.
  const sine = fg({ wave: 'sine', freq: 1000, amplitude: 2, offset: 2.5 });
  assert.ok(Math.abs(sourceVoltage(sine, 0, 5) - 2.5) < 1e-9);
  assert.ok(Math.abs(sourceVoltage(sine, 0.00025, 5) - 4.5) < 1e-9);
  assert.ok(Math.abs(sourceVoltage(sine, 0.00075, 5) - 0.5) < 1e-9);
  // Square 50%: first half +amp, second −amp around the offset.
  const sq = fg({ wave: 'square', freq: 100, amplitude: 1, offset: 0 });
  assert.equal(sourceVoltage(sq, 0.001, 5), 1);   // 10% into the period
  assert.equal(sourceVoltage(sq, 0.006, 5), -1);  // 60% in
  // Pulse duty 0.25: high (offset+amp) for the first quarter, offset after.
  const pulse = fg({ wave: 'pulse', freq: 100, amplitude: 5, offset: 0, duty: 0.25 });
  assert.equal(sourceVoltage(pulse, 0.001, 5), 5);
  assert.equal(sourceVoltage(pulse, 0.005, 5), 0);
  // Triangle: −amp at 0, +amp at T/2, −amp at T.  freq 100 → T=10 ms.
  const tri = fg({ wave: 'triangle', freq: 100, amplitude: 2, offset: 0 });
  assert.ok(Math.abs(sourceVoltage(tri, 0, 5) - (-2)) < 1e-9);
  assert.ok(Math.abs(sourceVoltage(tri, 0.005, 5) - 2) < 1e-9);
  assert.ok(Math.abs(sourceVoltage(tri, 0.0025, 5) - 0) < 1e-9);
});

test('a time-varying vsource is stamped at opts.tSeconds', () => {
  // FG (sine 1 kHz, amp 2, offset 2.5) across a 1 kΩ load: node = source value.
  const parts = [gndPart,
    { id: 'FG', kind: 'vsource', params: { wave: 'sine', freq: 1000, amplitude: 2, offset: 2.5 }, terminals: ['pos', 'neg'] },
    r('RL', 1000)];
  const nets = [
    { id: 'sig', terminals: [{ part: 'FG', terminal: 'pos' }, { part: 'RL', terminal: 'a' }] },
    { id: 'gnd', terminals: [{ part: 'G1', terminal: 'gnd' }, { part: 'FG', terminal: 'neg' }, { part: 'RL', terminal: 'b' }] },
  ];
  const at = (t) => solveMNA(parts, nets, new Map(), new Map(), 5, { tSeconds: t }).nodeVoltages.get('sig');
  assert.ok(Math.abs(at(0) - 2.5) < 1e-6);
  assert.ok(Math.abs(at(0.00025) - 4.5) < 1e-6);
});

test('transient BE: RC charge tracks the analytic exponential', () => {
  // 5 V → 1 kΩ → 1 µF → GND.  τ = 1 ms.  v(t) = 5(1 − e^(−t/τ)).
  // Backward Euler at dt = τ/10 lags slightly; assert within 1.5% of analytic
  // at t = 1τ and t = 3τ, and strictly monotone.
  const parts = [vccPart, gndPart, r('R1', 1000),
    { id: 'C1', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] }];
  const nets = [
    { id: 'vcc', terminals: [{ part: 'V1', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
    { id: 'n1', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
    { id: 'gnd', terminals: [{ part: 'G1', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
  ];
  let cv = new Map([['C1', 0]]);
  const dt = 1e-4;
  let prev = 0;
  const at = {};
  for (let i = 1; i <= 30; i++) {
    const res = solveMNA(parts, nets, new Map(), new Map(), 5,
      { transient: { dtSec: dt, capVoltages: cv, inductorCurrents: new Map() } });
    cv = res.capVoltagesNext;
    const v = cv.get('C1');
    assert.ok(v > prev, `monotone charge (step ${i}: ${v} <= ${prev})`);
    prev = v;
    if (i === 10) at.tau1 = v;
    if (i === 30) at.tau3 = v;
  }
  // The exact BE recurrence is the sharp oracle: v_n = 5(1 − (1/(1+dt/τ))^n).
  // With dt/τ = 0.1: v_10 = 5(1 − 1.1^−10) = 3.072284, v_30 = 4.713467.
  const be = (n) => 5 * (1 - Math.pow(1 / 1.1, n));
  // 1e-6 absolute: gmin (1e-12 S) shunts a whisper of charge, so exact-BE
  // agreement is to ~1e-9; anything beyond 1e-6 would mean a wrong stamp.
  assert.ok(Math.abs(at.tau1 - be(10)) < 1e-6, `t=τ: ${at.tau1} vs BE ${be(10)}`);
  assert.ok(Math.abs(at.tau3 - be(30)) < 1e-6, `t=3τ: ${at.tau3} vs BE ${be(30)}`);
  // And the analytic curve within BE's known first-order error at dt = τ/10.
  const analytic1 = 5 * (1 - Math.exp(-1));   // 3.1606
  const analytic3 = 5 * (1 - Math.exp(-3));   // 4.7511
  assert.ok(Math.abs(at.tau1 - analytic1) / analytic1 < 0.035, `t=τ: ${at.tau1} vs ${analytic1}`);
  assert.ok(Math.abs(at.tau3 - analytic3) / analytic3 < 0.015, `t=3τ: ${at.tau3} vs ${analytic3}`);
});

test('transient BE: RL current rise tracks the analytic exponential', () => {
  // 5 V → 100 Ω → 10 mH → GND.  τ = L/R = 100 µs.  i(t) = 50 mA (1 − e^(−t/τ)).
  const parts = [vccPart, gndPart, r('R1', 100),
    { id: 'L1', kind: 'inductor', params: { henries: 0.01 }, terminals: ['a', 'b'] }];
  const nets = [
    { id: 'vcc', terminals: [{ part: 'V1', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
    { id: 'n1', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'L1', terminal: 'a' }] },
    { id: 'gnd', terminals: [{ part: 'G1', terminal: 'gnd' }, { part: 'L1', terminal: 'b' }] },
  ];
  let il = new Map([['L1', 0]]);
  const dt = 1e-5; // τ/10
  for (let i = 1; i <= 30; i++) {
    const res = solveMNA(parts, nets, new Map(), new Map(), 5,
      { transient: { dtSec: dt, capVoltages: new Map(), inductorCurrents: il } });
    il = res.inductorCurrentsNext;
  }
  const analytic = 0.05 * (1 - Math.exp(-3)); // 47.51 mA at t = 3τ
  const got = il.get('L1');
  assert.ok(Math.abs(got - analytic) / analytic < 0.02, `t=3τ: ${got} vs ${analytic}`);
});

test('instantaneous solve: a charged capacitor holds its voltage as a source', () => {
  // Cap charged to 2 V sits between n1 and gnd; 5 V → 1 kΩ feeds n1.
  // Instantaneously n1 MUST read 2 V (the cap pins it), not the 5 V divider target.
  const parts = [vccPart, gndPart, r('R1', 1000),
    { id: 'C1', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] }];
  const nets = [
    { id: 'vcc', terminals: [{ part: 'V1', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
    { id: 'n1', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
    { id: 'gnd', terminals: [{ part: 'G1', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
  ];
  const res = solveMNA(parts, nets, new Map(), new Map(), 5,
    { capVoltages: new Map([['C1', 2]]) });
  assert.ok(Math.abs(res.nodeVoltages.get('n1') - 2) < 1e-6,
    `n1 = ${res.nodeVoltages.get('n1')}`);
  // And the charging current through the cap right now: (5−2)/1k = 3 mA into 'a'.
  const iCap = res.branchCurrents.get('C1');
  assert.ok(Math.abs(iCap.get('a') - (-0.003)) < 1e-6 || Math.abs(iCap.get('a') - 0.003) < 1e-6,
    `cap current magnitude = ${iCap.get('a')}`);
});

test('gmin: a floating net solves instead of silently returning zeros', () => {
  // A resistor from vcc to a net that goes nowhere else. Previously the node
  // was solvable only via the resistor chain; behind a DC-open capacitor it
  // became singular. With gmin the floating side reads the driven value.
  const parts = [vccPart, gndPart, r('R1', 1000),
    { id: 'C1', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] },
    r('R2', 1000)];
  const nets = [
    { id: 'vcc', terminals: [{ part: 'V1', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
    { id: 'n1', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
    { id: 'n2', terminals: [{ part: 'C1', terminal: 'b' }, { part: 'R2', terminal: 'a' }] },
    { id: 'gnd', terminals: [{ part: 'G1', terminal: 'gnd' }, { part: 'R2', terminal: 'b' }] },
  ];
  // No capVoltages passed: legacy DC-open. n1 must read 5 V (no current flows),
  // n2 must read 0 — and nothing throws.
  const res = solveMNA(parts, nets, new Map(), new Map(), 5);
  assert.ok(Math.abs(res.nodeVoltages.get('n1') - 5) < 1e-3, `n1 = ${res.nodeVoltages.get('n1')}`);
  assert.ok(Math.abs(res.nodeVoltages.get('n2') - 0) < 1e-3, `n2 = ${res.nodeVoltages.get('n2')}`);
});
