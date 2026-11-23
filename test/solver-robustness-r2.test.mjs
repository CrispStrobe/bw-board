// Solver robustness, round 2 of the lab-bench engine gaps. Each test is the
// smallest circuit a lab builder ran into (sb3-creator `examples/lab-*`), and
// each failed on master before the fix it names:
//
//  1. a thyristor pair (NPN + PNP latch) whose only load is an LED did not
//     converge when gated, and the failure was forgotten one event later;
//  2. a node held only by a dark LED and an off transistor stopped a PNP+NPN
//     relaxation oscillator (`smoothLawBaseDrive`);
//  3. an inductor with one end on no net acted as if that end were grounded;
//  4. a transformer lead on no net acted as if grounded;
//  5. a cross-coupled 74HC132 latch raced itself into the attempt cap;
//  6. a capacitor-free two-transistor flip-flop powered up balanced;
//  7. one long advance over a 3 kHz sine hit the per-call attempt cap;
//  9. a comparator lagged one advance behind a temperature change.
import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';
import {registerAllDevices} from '../src/register-all.js';

registerAllDevices();

function build(spec, vcc = 9) {
  const parts = [], nets = new Map();
  for (const [id, kind, params, conn] of spec) {
    parts.push({id, kind, params, terminals: Object.keys(conn)});
    for (const [t, n] of Object.entries(conn)) {
      if (n === null) continue; // a terminal on no net at all
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
const LED = (id, a, k, color = 'red') => [id, 'led', {color}, {anode: a, cathode: k}];
const mA = (b, id, t = 'anode') => Math.abs(b.branchCurrent(id, t)) * 1e3;
const codes = b => b.getWarnings().map(w => w.code).filter(Boolean);
const ms = n => BigInt(Math.round(n * 1e6));

// ─── 1. Thyristor pair, LED only ──────────────────────────────────────────

function thyristor() {
  return build([G, V('V', 9, 'vcc'), R('RL', 1000, 'vcc', 'la'), LED('L', 'la', 'an'),
    Q('QP', 'pnp', 'pb', 'nb', 'an'), Q('QN', 'npn', 'nb', 'pb', 'g'),
    R('RPB', 22000, 'pb', 'an'), R('RNB', 10000, 'nb', 'g'),
    BTN('GATE', 'vcc', 'gt'), R('RG', 10000, 'gt', 'nb')]);
}

test('a thyristor pair whose only load is an LED latches on a gate pulse and holds', () => {
  const b = thyristor();
  b.advanceTo(ms(1));
  assert.ok(mA(b, 'L') < 0.01, 'off at power-on');
  b.setControl('GATE', 1); b.advanceTo(ms(2));
  assert.ok(Math.abs(mA(b, 'L') - 6.5) < 0.5, `gated: LED ${mA(b, 'L')} mA`);
  assert.ok(b.nodeVoltage('an') < 1, `gated: anode ${b.nodeVoltage('an')} V`);
  b.setControl('GATE', 0); b.advanceTo(ms(5));
  assert.ok(Math.abs(mA(b, 'L') - 6.5) < 0.5, `released: still latched, LED ${mA(b, 'L')} mA`);
  const bad = codes(b).filter(c => c.startsWith('solve-not-converged'));
  assert.deepEqual(bad, [], 'every solve converged');
});

test('a solve that failed stays reported after later solves converge, until power is cycled', () => {
  const b = thyristor();
  b.advanceTo(ms(1));
  // A failed operating point, as the solver returns it.
  b._adoptSolution({...b._mnaCache, converged: false});
  assert.ok(codes(b).includes('solve-not-converged'));
  b.setControl('GATE', 1); b.advanceTo(ms(2));
  assert.ok(codes(b).includes('solve-not-converged-earlier'),
    `a latch may have lost its state there: ${JSON.stringify(codes(b))}`);
  b.setPower(false); b.setPower(true);
  assert.ok(!codes(b).includes('solve-not-converged-earlier'), 'power cycled: the circuit starts clean');
});

test('a transient that failed outright is a warning, not only a status field', () => {
  // A charge-free exponential card cannot cross an astable's edge (see
  // regenerative-switching.test.mjs); getWarnings must say so too.
  const q = {model: 'shockley', is: 1e-14, beta: 100};
  const b = build([G, V('V', 9, 'vcc'), R('RC1', 1000, 'vcc', 'c1'), R('RC2', 1000, 'vcc', 'c2'),
    R('RB1', 47000, 'vcc', 'b1'), R('RB2', 47000, 'vcc', 'b2'),
    C('CA', 10e-6, 'c1', 'b2'), C('CB', 10e-6, 'c2', 'b1'),
    Q('Q1', 'npn', 'b1', 'c1', 'g', q), Q('Q2', 'npn', 'b2', 'c2', 'g', q)]);
  for (let t = 10; t <= 500 && !b.transientAnalysisStatus().failure; t += 10) b.advanceTo(ms(t));
  assert.ok(b.transientAnalysisStatus().failure);
  const w = b.getWarnings().find(x => x.code === 'transient-solve-failed');
  assert.ok(w, JSON.stringify(b.getWarnings()));
  assert.equal(w.severity, 'danger');
  assert.match(w.message, /declare no junction charge/);
});

// ─── 2. A node held only by a dark LED ────────────────────────────────────

test('a PNP+NPN relaxation pair whose emitter node only a dark LED holds keeps running', () => {
  // lab-pnp-npn-relax without the 1 k the builder added "to keep that node
  // defined while the LED is dark". It failed at 130 ms after 70 s of work.
  const b = build([G, V('V', 9, 'vcc'), R('RT', 132000, 'vcc', 'ct'), C('CT', 4.7e-6, 'ct', 'g'),
    R('RD1', 1000, 'vcc', 'pb'), R('RD2', 2200, 'pb', 'g'),
    Q('QP', 'pnp', 'pb', 'nb', 'ct'), Q('QN', 'npn', 'nb', 'pb', 'e'), R('RBE', 100000, 'nb', 'e'),
    LED('L', 'e', 'k'), R('RS', 47, 'k', 'g')]);
  const t0 = process.cpuUsage().user;
  let prev = 0, drops = 0, hi = 0;
  for (let t = 2; t <= 1600; t += 2) {
    b.advanceTo(ms(t));
    assert.equal(b.transientAnalysisStatus().failure, null, `failed at ${t} ms`);
    const v = b.nodeVoltage('ct');
    if (v < prev - 0.3) drops++;
    prev = v;
    hi = Math.max(hi, v);
  }
  assert.ok(drops >= 2, `${drops} discharges in 1.6 s`);
  assert.ok(Math.abs(hi - 6.86) < 0.15, `fires at ${hi} V`);
  assert.ok((process.cpuUsage().user - t0) / 1e6 < 20, 'without grinding');
});

test('a cut-off transistor does not amplify its reverse base leak into its collector', () => {
  // PNP base 4.5 V above its emitter; nothing else on the collector node but
  // a dark LED. The 1 nS off conductance of the base junction is a numerical
  // regulariser; times beta it used to push 450 nA backwards through the
  // collector and drag the node up to the LED's knee.
  const b = build([G, V('V', 9, 'vcc'), R('RB', 1000, 'vcc', 'b'), C('CE', 1e-6, 'e', 'g'),
    R('RE', 1e6, 'e', 'g'), Q('QP', 'pnp', 'b', 'c', 'e'), LED('L', 'c', 'g')]);
  b.advanceTo(ms(5));
  assert.ok(Math.abs(b.branchCurrent('QP', 'collector')) < 1e-8,
    `collector ${b.branchCurrent('QP', 'collector')} A`);
});

// ─── 3, 4. Winding ends on no net ─────────────────────────────────────────

test('an inductor with one end on no net carries nothing and does not ground the other end', () => {
  const b = build([G, V('V', 9, 'vcc'), R('R1', 1000, 'vcc', 'a'),
    ['L1', 'inductor', {henrys: 0.01}, {a: 'a', b: null}]]);
  b.advanceTo(ms(1)); b.advanceTo(ms(5));
  assert.equal(b.transientAnalysisStatus().failure, null);
  assert.ok(Math.abs(b.nodeVoltage('a') - 9) < 1e-6, `open coil end: a = ${b.nodeVoltage('a')} V`);
  assert.ok(Math.abs(b.branchCurrent('R1', 'a')) < 1e-9);
});

test('a transformer lead on no net floats: no secondary current flows', () => {
  const xfmr = (s2) => {
    const b = build([G, ['VS', 'vsource', {wave: 'sine', amplitude: 5, freq: 1000, volts: 0}, {pos: 'in', neg: 'g'}],
      R('R1', 100, 'in', 'p'), ['T1', 'transformer', {l1: 0.01, l2: 0.04, k: 0.9}, {p1: 'p', p2: 'g', s1: 's', s2}],
      R('R2', 1000, 's', 'g')]);
    let peak = 0;
    for (let t = 1; t <= 10; t++) {
      b.advanceTo(ms(t));
      peak = Math.max(peak, mA(b, 'R2', 'a'));
    }
    assert.equal(b.transientAnalysisStatus().failure, null);
    return peak;
  };
  assert.ok(xfmr('g') > 2, 'grounded secondary carries current');
  assert.ok(xfmr(null) < 1e-6, `open lead: ${xfmr(null)} mA`);
});

// ─── 5. 74HC132 latch ─────────────────────────────────────────────────────

test('a cross-coupled 74HC132 latch powers up into one state and sets and resets', () => {
  const b = build([G, V('V', 5, 'vcc'), C('CS', 100e-9, 'vcc', 'g'),
    ['U', '74hc132', {}, {vcc: 'vcc', gnd: 'g', '1a': 's', '1b': 'qn', '1y': 'q', '2a': 'q', '2b': 'r', '2y': 'qn',
      '3a': 'g', '3b': 'g', '4a': 'g', '4b': 'g'}],
    R('RS', 10000, 'vcc', 's'), R('RR', 10000, 'vcc', 'r'), BTN('SET', 's', 'g'), BTN('RESET', 'r', 'g'),
    R('RL1', 470, 'q', 'l1'), LED('L1', 'l1', 'g'), R('RL2', 470, 'qn', 'l2'), LED('L2', 'l2', 'g', 'green')], 5);
  const complementary = (what) => {
    const s = b.transientAnalysisStatus();
    assert.equal(s.failure, null, `${what}: ${JSON.stringify(s.failure)}`);
    const q = b.nodeVoltage('q'), qn = b.nodeVoltage('qn');
    assert.ok((q > 4) !== (qn > 4) && Math.min(q, qn) < 0.5, `${what}: q ${q} V, qn ${qn} V`);
    return q > 4;
  };
  b.advanceTo(ms(1));
  complementary('power-on');
  assert.ok(b.transientAnalysisStatus().work.attempts < 500, `${b.transientAnalysisStatus().work.attempts} attempts`);
  b.setControl('RESET', 1); b.advanceTo(ms(2)); assert.equal(complementary('reset'), false);
  b.setControl('RESET', 0); b.advanceTo(ms(3)); assert.equal(complementary('released'), false);
  b.setControl('SET', 1); b.advanceTo(ms(4)); assert.equal(complementary('set'), true);
  b.setControl('SET', 0); b.advanceTo(ms(5)); assert.equal(complementary('released'), true);
});

test('the same latch without any capacitor settles consistently on every event', () => {
  const b = build([G, V('V', 5, 'vcc'),
    ['U', '74hc132', {}, {vcc: 'vcc', gnd: 'g', '1a': 's', '1b': 'qn', '1y': 'q', '2a': 'q', '2b': 'r', '2y': 'qn',
      '3a': 'g', '3b': 'g', '4a': 'g', '4b': 'g'}],
    R('RS', 10000, 'vcc', 's'), R('RR', 10000, 'vcc', 'r'), BTN('SET', 's', 'g'), BTN('RESET', 'r', 'g')], 5);
  b.advanceTo(ms(1));
  // Both outputs high is no state of a NAND latch with both inputs high.
  assert.ok((b.nodeVoltage('q') > 4) !== (b.nodeVoltage('qn') > 4),
    `q ${b.nodeVoltage('q')} V, qn ${b.nodeVoltage('qn')} V`);
});

// ─── 6. A balanced bistable at power-on ───────────────────────────────────

function flipFlop(x1, x2) {
  return build([G, V('V', 9, 'vcc'),
    R('R1', 1000, 'vcc', 'a1'), LED('L1', 'a1', 'c1'), R('R2', 1000, 'vcc', 'a2'), LED('L2', 'a2', 'c2', 'green'),
    R('X1', x1, 'c1', 'b2'), R('X2', x2, 'c2', 'b1'),
    Q('Q1', 'npn', 'b1', 'c1', 'g'), Q('Q2', 'npn', 'b2', 'c2', 'g'),
    BTN('SET', 'b1', 'g'), BTN('RESET', 'b2', 'g')]);
}

test('a capacitor-free flip-flop powers up in one state, not balanced', () => {
  for (const [x1, x2, winner] of [[22000, 27000, 'L2'], [27000, 22000, 'L1'], [22000, 22000, null]]) {
    const b = flipFlop(x1, x2);
    b.advanceTo(ms(1));
    const on = ['L1', 'L2'].filter(id => mA(b, id) > 5), off = ['L1', 'L2'].filter(id => mA(b, id) < 1);
    assert.equal(on.length, 1, `${x1}/${x2}: L1 ${mA(b, 'L1')} mA, L2 ${mA(b, 'L2')} mA`);
    assert.equal(off.length, 1);
    // The stronger base feed wins the race, as with the bench's base caps.
    if (winner) assert.equal(on[0], winner, `${x1}/${x2}`);
  }
});

test('the flip-flop still sets and resets after its power-on fall, and the fall is repeatable', () => {
  const a = flipFlop(22000, 22000), b = flipFlop(22000, 22000);
  a.advanceTo(ms(1)); b.advanceTo(ms(1));
  assert.equal(mA(a, 'L1') > 5, mA(b, 'L1') > 5, 'the same netlist falls the same way');
  // SET grounds Q1's base: Q1 off (L1 dark), Q2 on (L2 lit); RESET the reverse.
  a.setControl('SET', 1); a.advanceTo(ms(2)); a.setControl('SET', 0); a.advanceTo(ms(3));
  assert.ok(mA(a, 'L2') > 5 && mA(a, 'L1') < 1, `SET: L1 ${mA(a, 'L1')} mA, L2 ${mA(a, 'L2')} mA`);
  a.setControl('RESET', 1); a.advanceTo(ms(4)); a.setControl('RESET', 0); a.advanceTo(ms(5));
  assert.ok(mA(a, 'L1') > 5 && mA(a, 'L2') < 1, `RESET: L1 ${mA(a, 'L1')} mA, L2 ${mA(a, 'L2')} mA`);
});

// ─── 7. A long advance over a fast sine ───────────────────────────────────

test('one 60 ms advance over a 3 kHz sine completes like twelve 5 ms advances', () => {
  // lab-two-band-light-organ at 3 kHz: ~25,000 attempts for 60 ms.
  const organ = () => build([G, V('V', 9, 'vcc'),
    ['SIG', 'vsource', {wave: 'sine', freq: 3000, amplitude: 4, offset: 0}, {pos: 'sig', neg: 'g'}],
    C('CH', 22e-9, 'sig', 'h'), R('RH', 10000, 'h', 'g'), R('BH', 47000, 'h', 'bh'), Q('QH', 'npn', 'bh', 'kh', 'g'),
    R('R1', 470, 'vcc', 'ah'), LED('L1', 'ah', 'kh', 'blue'),
    R('RLP', 4700, 'sig', 'l'), C('CL', 1e-6, 'l', 'g'), R('BL', 47000, 'l', 'bl'), Q('QL', 'npn', 'bl', 'kl', 'g'),
    R('R2', 470, 'vcc', 'al'), LED('L2', 'al', 'kl')]);
  const one = organ();
  one.advanceTo(ms(60));
  assert.equal(one.transientAnalysisStatus().failure, null, JSON.stringify(one.transientAnalysisStatus().failure));
  const chunked = organ();
  for (let t = 5; t <= 60; t += 5) chunked.advanceTo(ms(t));
  for (const n of ['h', 'l', 'kh', 'kl']) {
    assert.ok(Math.abs(one.nodeVoltage(n) - chunked.nodeVoltage(n)) < 0.05,
      `${n}: ${one.nodeVoltage(n)} vs ${chunked.nodeVoltage(n)}`);
  }
});

// ─── 9. Temperature reaches a comparator in the same advance ─────────────

test('a comparator follows a temperature change within the advance that carries it', () => {
  // A self-heated NTC divider against a fixed reference on an LM358. Warm the
  // room and advance once: by the end of THAT advance the output must agree
  // with its inputs (it used to lag until the next advance).
  const b = build([G, V('V', 9, 'vcc'),
    ['NTC', 'ntc', {r25: 10000, beta: 3950, rth: 500, thermalTau: 0.5}, {a: 'vcc', b: 's'}], R('RN', 6800, 's', 'g'),
    R('RA', 10000, 'vcc', 'ref'), R('RB', 10000, 'ref', 'g'),
    ['U', 'lm358', {}, {vcc: 'vcc', gnd: 'g', '1_pos': 's', '1_neg': 'ref', '1_out': 'o',
      '2_pos': 'g', '2_neg': 'g', '2_out': 'o2'}],
    R('RL', 10000, 'o', 'g')]);
  const agrees = (what) => {
    const high = b.nodeVoltage('s') > b.nodeVoltage('ref');
    assert.equal(b.nodeVoltage('o') > 4, high,
      `${what}: s ${b.nodeVoltage('s')} V, ref ${b.nodeVoltage('ref')} V, out ${b.nodeVoltage('o')} V`);
  };
  let t = 0;
  for (; t < 3000; t += 200) b.advanceTo(ms(t + 200));
  agrees('25 C');
  b.world.set('temperatureC', 45);
  let crossed = false;
  for (let i = 0; i < 20; i++) {
    t += 200; b.advanceTo(ms(t));
    agrees(`45 C, t = ${t} ms`);
    if (b.nodeVoltage('s') > b.nodeVoltage('ref')) crossed = true;
  }
  assert.ok(crossed, 'the warm NTC pulls the input over the reference');
});

// ─── 8. A Darlington inside a regulating loop ─────────────────────────────

test('an LM358 holding a TIP120 emitter follower at a set point regulates instead of chattering', () => {
  // lab-motor-speed with its NPN swapped for a TIP120: the switch model
  // flipped at every solve and the first millisecond never finished.
  const b = build([G, V('V', 9, 'vcc'), R('RA', 10000, 'vcc', 'set'), R('RB', 10000, 'set', 'g'),
    ['U', 'lm358', {}, {vcc: 'vcc', gnd: 'g', '1_pos': 'set', '1_neg': 'e', '1_out': 'o',
      '2_pos': 'g', '2_neg': 'g', '2_out': 'o2'}],
    R('RBASE', 1000, 'o', 'b'), Q('Q', 'tip120', 'b', 'vcc', 'e'), R('RL', 100, 'e', 'g'), C('CL', 10e-6, 'e', 'g')]);
  const t0 = process.cpuUsage().user;
  for (let t = 10; t <= 100; t += 10) {
    b.advanceTo(ms(t));
    assert.equal(b.transientAnalysisStatus().failure, null, `failed by ${t} ms`);
  }
  assert.ok(Math.abs(b.nodeVoltage('e') - 4.5) < 0.05, `emitter ${b.nodeVoltage('e')} V`);
  assert.ok(Math.abs(mA(b, 'RL', 'a') - 45) < 1, `load ${mA(b, 'RL', 'a')} mA`);
  assert.ok((process.cpuUsage().user - t0) / 1e6 < 10, 'in bounded work');
});

test('a TIP120 still switches a load hard on and off', () => {
  for (const [vin, on] of [[5, true], [0, false]]) {
    const b = build([G, V('V', 9, 'vcc'), V('VIN', vin, 'in'), R('RBASE', 1000, 'in', 'b'),
      Q('Q', 'tip120', 'b', 'c', 'g'), R('RL', 100, 'vcc', 'c')]);
    b.advanceTo(ms(1));
    const vc = b.nodeVoltage('c');
    if (on) assert.ok(vc < 1.0, `on: collector ${vc} V`);
    else assert.ok(vc > 8.9, `off: collector ${vc} V`);
  }
});
