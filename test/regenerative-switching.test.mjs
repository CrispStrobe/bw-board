// Discrete regenerative circuits on the DEFAULT transistor models: astables,
// a monostable, latches and a toggle flip-flop. Every one of these used to
// freeze with "transient Newton solve failed at minimum step" (or, for a
// static latch, fall back to its unstable half-on point), because
//  - the default BJT switched between two collector laws through a
//    hysteretic region FSM whose entry and exit tests disagreed,
//  - every solve restarted Newton from zero,
//  - and a model with no device capacitance has no solution at all past the
//    point where a regenerative loop's gain passes one.
// See `bjtForcedBeta`, `PARASITIC_DEFAULTS` and `newtonSeed` in src/mna.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';

function build(spec, vcc = 9) {
  const parts = [], nets = new Map();
  for (const [id, kind, params, conn] of spec) {
    parts.push({id, kind, params, terminals: Object.keys(conn)});
    for (const [t, n] of Object.entries(conn)) {
      if (!nets.has(n)) nets.set(n, []);
      nets.get(n).push({part: id, terminal: t});
    }
  }
  const b = new BoardImpl(vcc);
  b.setNetlist(parts, [...nets].map(([id, terminals]) => ({id, terminals})));
  return b;
}
const G = ['G', 'gnd', {}, {gnd: 'g'}];
const R = (id, ohms, a, b) => [id, 'resistor', {ohms}, {a, b}];
const C = (id, farads, a, b) => [id, 'capacitor', {farads}, {a, b}];
const V = (id, volts, pos, extra = {}) => [id, 'vsource', {volts, ...extra}, {pos, neg: 'g'}];
const Q = (id, kind, b, c, e, params = {}) => [id, kind, params, {base: b, collector: c, emitter: e}];
const BTN = (id, a, b) => [id, 'button', {}, {a, b}];

const VT = 0.02585;
// Ebers-Moll forced beta Ic/Ib at a given Vce (NF = NR = 1), written out
// independently of the engine: Vce = Vt*ln((1 + (1+f)/BR) / (1 - f/BF)).
const forcedBeta = (vce, bf = 100, br = 1) => {
  const x = Math.exp(vce / VT);
  return (x - 1 - 1 / br) / (1 / br + x / bf);
};

function astable({ca = 10e-6, cb = 4.7e-6, q = {}} = {}) {
  return build([G, V('V', 9, 'vcc'),
    R('RC1', 1000, 'vcc', 'c1'), R('RC2', 1000, 'vcc', 'c2'),
    R('RB1', 47000, 'vcc', 'b1'), R('RB2', 47000, 'vcc', 'b2'),
    C('CA', ca, 'c1', 'b2'), C('CB', cb, 'c2', 'b1'),
    Q('Q1', 'npn', 'b1', 'c1', 'g', q), Q('Q2', 'npn', 'b2', 'c2', 'g', q)]);
}

/** Advance in `stepMs` chunks, recording when c1 > c2 flips and the base range. */
function trace(b, endMs, stepMs) {
  const edges = [];
  let last = null, bMin = Infinity, bMax = -Infinity;
  for (let t = stepMs; t <= endMs + 1e-9; t += stepMs) {
    b.advanceTo(BigInt(Math.round(t * 1e6)));
    const status = b.transientAnalysisStatus();
    assert.equal(status.failure, null, `solve failed at ${t} ms: ${JSON.stringify(status.failure)}`);
    const high = b.nodeVoltage('c1') > b.nodeVoltage('c2');
    if (last !== null && high !== last) edges.push(t);
    last = high;
    for (const n of ['b1', 'b2']) {
      bMin = Math.min(bMin, b.nodeVoltage(n));
      bMax = Math.max(bMax, b.nodeVoltage(n));
    }
  }
  return {edges, bMin, bMax};
}

// Half-period of a saturated-switch astable: the off transistor's base starts
// at -(Vcc - Vbe - Vce(sat)) below Vbe and charges toward Vcc through R:
//   T = R*C*ln((2*Vcc - Vbe - Vcesat) / (Vcc - Vbe))     (~0.73 RC at 9 V)
const halfPeriod = (r, c) => r * c * Math.log((18 - 0.7 - 0.05) / (9 - 0.7)) * 1000;

test('default-npn astable oscillates with the textbook half-periods', () => {
  const {edges, bMin, bMax} = trace(astable(), 1400, 2);
  assert.ok(edges.length >= 5, `only ${edges.length} edges: ${edges}`);
  const halves = edges.slice(2).map((t, i) => t - edges[i + 1]);
  const want = [halfPeriod(47000, 4.7e-6), halfPeriod(47000, 10e-6)];
  for (const h of halves) {
    assert.ok(want.some(w => Math.abs(h - w) < 0.07 * w),
      `half-period ${h} ms is neither ${want[0].toFixed(1)} nor ${want[1].toFixed(1)} ms (edges ${edges})`);
  }
  // A coupled base swings to about -(Vcc - 0.75) and is clamped near Vbe on top.
  assert.ok(bMax < 1.0, `base reached ${bMax} V`);
  assert.ok(bMin > -9 && bMin < -7, `base low ${bMin} V`);
});

test('a perfectly symmetric astable still starts', () => {
  const {edges} = trace(astable({cb: 10e-6}), 1200, 5);
  assert.ok(edges.length >= 4, `edges ${edges}`);
});

test('an exponential card with junction charge runs the astable and keeps its bases physical', () => {
  // The exponential path carries exactly the charge its card states; with
  // CJE/CJC stated (as every real SPICE card does) the edge is resolvable.
  const {edges, bMax} = trace(astable({cb: 10e-6,
    q: {model: 'shockley', is: 1e-14, beta: 100, cje: 5e-12, cjc: 2e-12}}), 1200, 5);
  assert.ok(edges.length >= 4, `edges ${edges}`);
  const halves = edges.slice(2).map((t, i) => t - edges[i + 1]);
  for (const h of halves.slice(1)) assert.ok(Math.abs(h - halfPeriod(47000, 10e-6)) < 0.07 * halfPeriod(47000, 10e-6), `${h} ms`);
  assert.ok(bMax < 1.0, `base reached ${bMax} V on a 9 V rail`);
});

test('a discrete monostable produces one pulse of about 0.73 RC', () => {
  const b = build([G, V('V', 9, 'vcc'), R('RC1', 1000, 'vcc', 'c1'), R('RC2', 1000, 'vcc', 'c2'),
    R('RB2', 47000, 'vcc', 'b2'), C('CT', 10e-6, 'c1', 'b2'), R('RF', 10000, 'c2', 'b1'), R('RBO', 47000, 'b1', 'g'),
    Q('Q1', 'npn', 'b1', 'c1', 'g'), Q('Q2', 'npn', 'b2', 'c2', 'g'),
    R('RT', 10000, 'trig', 'b1'),
    V('VT', 0, 'trig', {wave: 'spice-pulse', v1: 0, v2: 5, td: 0.1, tr: 1e-6, tf: 1e-6, pw: 0.005, per: 10})]);
  let start = null, end = null;
  for (let t = 2; t <= 800; t += 2) {
    b.advanceTo(BigInt(t * 1e6));
    assert.equal(b.transientAnalysisStatus().failure, null);
    const high = b.nodeVoltage('c2') > 4.5;
    if (high && start === null) start = t;
    if (!high && start !== null && end === null) end = t;
  }
  assert.ok(start !== null && end !== null, 'one pulse');
  assert.ok(Math.abs(start - 100) <= 4, `pulse starts at ${start} ms`);
  const want = halfPeriod(47000, 10e-6);
  assert.ok(Math.abs(end - start - want) < 0.07 * want, `width ${end - start} ms, want ${want.toFixed(1)}`);
  assert.ok(b.nodeVoltage('c2') < 0.3, 'returns to its stable state');
});

test('a resistor-coupled set/reset latch keeps its state after the button is released', () => {
  const b = build([G, V('V', 9, 'vcc'), R('RC1', 1000, 'vcc', 'c1'), R('RC2', 1000, 'vcc', 'c2'),
    R('RF1', 10000, 'c1', 'b2'), R('RF2', 10000, 'c2', 'b1'), R('RB1', 47000, 'b1', 'g'), R('RB2', 47000, 'b2', 'g'),
    Q('Q1', 'npn', 'b1', 'c1', 'g'), Q('Q2', 'npn', 'b2', 'c2', 'g'), BTN('SET', 'b2', 'g'), BTN('RESET', 'b1', 'g')]);
  const state = () => [b.nodeVoltage('c1'), b.nodeVoltage('c2')];
  b.setControl('SET', 1); b.advanceTo(10_000_000n);
  b.setControl('SET', 0); b.advanceTo(20_000_000n);
  let [c1, c2] = state();
  assert.ok(c1 < 0.3 && c2 > 8, `after SET released: ${c1} / ${c2}`);
  b.setControl('RESET', 1); b.advanceTo(30_000_000n);
  b.setControl('RESET', 0); b.advanceTo(40_000_000n);
  [c1, c2] = state();
  assert.ok(c2 < 0.3 && c1 > 8, `after RESET released: ${c1} / ${c2}`);
});

test('a toggle flip-flop with steering capacitors changes state once per press', () => {
  const b = build([G, V('V', 9, 'vcc'), R('RC1', 1000, 'vcc', 'c1'), R('RC2', 1000, 'vcc', 'c2'),
    R('RF1', 10000, 'c1', 'b2'), R('RF2', 10000, 'c2', 'b1'), R('RB1', 47000, 'b1', 'g'), R('RB2', 47000, 'b2', 'g'),
    Q('Q1', 'npn', 'b1', 'c1', 'g'), Q('Q2', 'npn', 'b2', 'c2', 'g'),
    R('RT', 10000, 'vcc', 't'), BTN('TB', 't', 'g'),
    C('CS1', 10e-9, 't', 'k1'), C('CS2', 10e-9, 't', 'k2'), R('RS1', 22000, 'c1', 'k1'), R('RS2', 22000, 'c2', 'k2'),
    ['D1', 'diode', {}, {anode: 'b1', cathode: 'k1'}], ['D2', 'diode', {}, {anode: 'b2', cathode: 'k2'}]]);
  let t = 20;
  b.advanceTo(BigInt(t * 1e6));
  let q1On = b.nodeVoltage('c1') < b.nodeVoltage('c2');
  const t0 = process.cpuUsage().user;
  for (let press = 0; press < 4; press++) {
    b.setControl('TB', 1); b.advanceTo(BigInt((t += 10) * 1e6));
    b.setControl('TB', 0); b.advanceTo(BigInt((t += 20) * 1e6));
    assert.equal(b.transientAnalysisStatus().failure, null);
    const now = b.nodeVoltage('c1') < b.nodeVoltage('c2');
    assert.equal(now, !q1On, `press ${press + 1} did not toggle`);
    assert.ok(Math.min(b.nodeVoltage('c1'), b.nodeVoltage('c2')) < 0.3, 'a full state, not half-on');
    q1On = now;
  }
  assert.ok((process.cpuUsage().user - t0) / 1e6 < 20, 'four presses within seconds, not minutes');
});

test('an NPN-PNP thyristor latches on a gate pulse and stays on', () => {
  const b = build([G, V('V', 9, 'vcc'), R('RL', 470, 'vcc', 'a'),
    ['QP', 'pnp', {}, {base: 'k1', collector: 'gate', emitter: 'a'}], Q('QN', 'npn', 'gate', 'k1', 'g'),
    R('RGK', 10000, 'gate', 'g'), R('RAK', 10000, 'a', 'k1'), R('RG', 1000, 'gp', 'gate'),
    V('VG', 0, 'gp', {wave: 'spice-pulse', v1: 0, v2: 5, td: 0.01, tr: 1e-6, tf: 1e-6, pw: 0.001, per: 10})]);
  b.advanceTo(5_000_000n);
  assert.ok(b.nodeVoltage('a') > 8.9, 'off before the pulse');
  b.advanceTo(50_000_000n);
  assert.equal(b.transientAnalysisStatus().failure, null);
  assert.ok(b.nodeVoltage('a') < 1.5, `latched on after the pulse ended: ${b.nodeVoltage('a')} V`);
});

test('a two-MOSFET astable oscillates on the default nmos', () => {
  const M = (id, g, d) => [id, 'nmos', {}, {gate: g, drain: d, source: 'g'}];
  const b = build([G, V('V', 9, 'vcc'), R('RD1', 1000, 'vcc', 'd1'), R('RD2', 1000, 'vcc', 'd2'),
    R('RG1', 100000, 'vcc', 'g1'), R('RG2', 100000, 'vcc', 'g2'),
    C('C1', 1e-6, 'd1', 'g2'), C('C2', 2.2e-6, 'd2', 'g1'), M('M1', 'g1', 'd1'), M('M2', 'g2', 'd2')]);
  let last = null, edges = 0;
  for (let t = 10; t <= 2000; t += 10) {
    b.advanceTo(BigInt(t * 1e6));
    assert.equal(b.transientAnalysisStatus().failure, null);
    const high = b.nodeVoltage('d1') > b.nodeVoltage('d2');
    if (last !== null && high !== last) edges++;
    last = high;
  }
  assert.ok(edges >= 3, `${edges} edges`);
});

test('an npn whose collector is held at 0.1 V saturates at the Ebers-Moll forced beta', () => {
  const b = build([G, V('VC', 0.1, 'c'), V('VB', 5, 'vb'), R('RB', 10000, 'vb', 'b'), Q('Q', 'npn', 'b', 'c', 'g')], 5);
  b.advanceTo(1n);
  const ib = -b.branchCurrent('Q', 'base'), ic = -b.branchCurrent('Q', 'collector');
  assert.ok(ib > 4e-4, `base drive ${ib}`);
  const want = forcedBeta(0.1);
  assert.ok(want < 40, 'the bench really is deep in saturation');
  assert.ok(Math.abs(ic / ib - want) < 1e-6 * want, `Ic/Ib ${ic / ib}, Ebers-Moll ${want}`);
});

test('an LED in an off collector needs no pull-up to switch cleanly', () => {
  const b = build([G, V('V', 9, 'vcc'), R('RL', 470, 'vcc', 'a'), ['D', 'led', {}, {anode: 'a', cathode: 'c'}],
    Q('Q', 'npn', 'b', 'c', 'g'), R('RB', 10000, 's', 'b'),
    V('VS', 0, 's', {wave: 'spice-pulse', v1: 0, v2: 5, td: 0.001, tr: 1e-6, tf: 1e-6, pw: 0.005, per: 0.01})]);
  for (let t = 0.5; t <= 40; t += 0.5) {
    b.advanceTo(BigInt(Math.round(t * 1e6)));
    assert.equal(b.transientAnalysisStatus().failure, null, `at ${t} ms`);
    const phase = (t - 1) % 10;
    const on = t > 1 && phase > 0.2 && phase < 4.8;
    const off = t < 0.9 || (phase > 5.2 && phase < 9.8);
    const i = -b.branchCurrent('D', 'anode');
    if (on) assert.ok(i > 0.01, `LED dark while driven at ${t} ms: ${i}`);
    if (off) assert.ok(Math.abs(i) < 1e-6, `LED lit while off at ${t} ms: ${i}`);
  }
});
