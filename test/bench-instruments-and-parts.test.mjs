// function_gen and oscilloscope are engine devices; no-connect package pins
// are accepted; a piezo is capacitive and still sounds; a bench with stacked
// sources and no gnd part gets a deterministic, announced reference.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();
const net = (id, ...pins) => ({ id, terminals: pins.map(([part, terminal]) => ({ part, terminal })) });

test('function_gen is a waveform source: square 1 kHz, 2 V peak, through its 50 ohm output', () => {
  const b = new BoardImpl(5);
  b.setNetlist([{ id: 'F', kind: 'function_gen', params: { wave: 'square', freq: 1000, amplitude: 2 }, terminals: ['out', 'gnd'] },
    { id: 'R', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] }],
  [net('o', ['F', 'out'], ['R', 'a']), net('g', ['F', 'gnd'], ['R', 'b'], ['G', 'gnd'])]);
  b.setPower(true);
  const loaded = 2 * 1000 / 1050;
  const at = t => { b.advanceTo(t); return b.nodeVoltage('o'); };
  assert.ok(Math.abs(at(250_000n) - loaded) < 1e-3, 'first half-cycle high');
  assert.ok(Math.abs(at(750_000n) + loaded) < 1e-3, 'second half-cycle low');
  assert.ok(Math.abs(at(1_250_000n) - loaded) < 1e-3);
  // Public topology unchanged: the hidden source lives in the solver view only.
  assert.deepEqual(b.parts.map(p => p.id).sort(), ['F', 'G', 'R']);
});

test('function_gen defaults: 1 kHz sine, 1 V peak; its gnd is the reference when there is no gnd part', () => {
  const b = new BoardImpl(5);
  b.setNetlist([{ id: 'F', kind: 'function_gen', params: { rOut: 0 }, terminals: ['out', 'gnd'] },
    { id: 'R', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] }],
  [net('o', ['F', 'out'], ['R', 'a']), net('g', ['F', 'gnd'], ['R', 'b'])]);
  b.setPower(true);
  b.advanceTo(250_000n); // quarter period of 1 kHz
  assert.ok(Math.abs(b.nodeVoltage('o') - 1) < 1e-3, `${b.nodeVoltage('o')}`);
  assert.equal(b.nodeVoltage('g'), 0);
});

test('oscilloscope is accepted and loads each channel with 1 MOhm to its gnd', () => {
  const b = new BoardImpl(5);
  b.setNetlist([{ id: 'V', kind: 'vcc', params: {}, terminals: ['vcc'] }, { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'R', kind: 'resistor', params: { ohms: 1e6 }, terminals: ['a', 'b'] },
    { id: 'S', kind: 'oscilloscope', params: {}, terminals: ['ch1', 'ch2', 'gnd'] }],
  [net('vcc', ['V', 'vcc'], ['R', 'a']), net('m', ['R', 'b'], ['S', 'ch1']), net('g', ['G', 'gnd'], ['S', 'gnd'])]);
  b.setPower(true);
  assert.ok(Math.abs(b.nodeVoltage('m') - 2.5) < 1e-3, `divider against the 1 MOhm input: ${b.nodeVoltage('m')}`);
});

test('no-connect pins (nc1..nc4 of the 74HC93 DIP-14) are accepted and inert; the counter still counts', () => {
  const b = new BoardImpl(5);
  const T = ['clk_a', 'nc1', 'nc2', 'nc3', 'vcc', 'r0_1', 'r0_2', 'qd', 'qc', 'gnd', 'qb', 'qa', 'nc4', 'clk_b'];
  b.setNetlist([{ id: 'V', kind: 'vcc', params: {}, terminals: ['vcc'] }, { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U', kind: '74hc93', params: {}, terminals: T },
    { id: 'CLK', kind: 'vsource', params: { volts: 0 }, terminals: ['pos', 'neg'] }],
  [net('vcc', ['V', 'vcc'], ['U', 'vcc']), net('gnd', ['G', 'gnd'], ['U', 'gnd'], ['U', 'r0_1'], ['U', 'r0_2'], ['CLK', 'neg'], ['U', 'nc1']),
    net('clk', ['CLK', 'pos'], ['U', 'clk_a']), net('qa', ['U', 'qa']), net('nc2', ['U', 'nc2'])]);
  b.setPower(true);
  const qa0 = b.nodeVoltage('qa') > 2.5;
  b.setControl('CLK', 5); b.setControl('CLK', 0); // one falling edge
  assert.notEqual(b.nodeVoltage('qa') > 2.5, qa0, 'QA toggled');
});

test('piezo is a capacitor (20 nF behind 100 ohm) with a high leak: RC charging, not an instant 1 MOhm divider', () => {
  const b = new BoardImpl(5);
  b.setNetlist([{ id: 'V', kind: 'vcc', params: {}, terminals: ['vcc'] }, { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'R', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    { id: 'P', kind: 'piezo', params: {}, terminals: ['a', 'b'] }],
  [net('vcc', ['V', 'vcc'], ['R', 'a']), net('p', ['R', 'b'], ['P', 'a']), net('g', ['G', 'gnd'], ['P', 'b'])]);
  b.setPower(true);
  b.advanceTo(200_000n); // about one tau = (10k || 1M + 100 ohm ESR) * 20 nF
  const vInf = 5 * 1e6 / (1e6 + 1e4);
  const rTh = 1e4 * 1e6 / (1e6 + 1e4), esr = 100;
  const tau = (rTh + esr) * 20e-9;
  const vC = vInf * (1 - Math.exp(-200e-6 / tau));
  const expect = vC + (vInf - vC) / (rTh + esr) * esr; // the pin sits one ESR drop above the plate
  assert.ok(Math.abs(b.nodeVoltage('p') - expect) < 0.01, `${b.nodeVoltage('p')} vs ${expect}`);
  b.advanceTo(5_000_000n);
  assert.ok(Math.abs(b.nodeVoltage('p') - vInf) < 1e-3, 'settles on the leak divider');
});

test('a piezo driven by a 555 at 2 kHz still sounds at 2 kHz (buzzerTone)', () => {
  const b = new BoardImpl(5);
  b.setNetlist([{ id: 'V', kind: 'vcc', params: {}, terminals: ['vcc'] }, { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U', kind: 'timer_555', params: { frequency: 2000 }, terminals: ['vcc', 'gnd', 'trigger', 'threshold', 'control', 'discharge', 'output', 'reset'] },
    { id: 'P', kind: 'piezo', params: {}, terminals: ['a', 'b'] }],
  [net('vcc', ['V', 'vcc'], ['U', 'vcc'], ['U', 'reset']), net('g', ['G', 'gnd'], ['U', 'gnd'], ['P', 'b']),
    net('thr', ['U', 'threshold']), net('trg', ['U', 'trigger']), net('ctl', ['U', 'control']), net('o', ['U', 'output'], ['P', 'a'])]);
  b.setPower(true);
  b.advanceTo(20_000_000n);
  const tone = b.buzzerTone('P');
  assert.equal(tone.on, true);
  assert.ok(Math.abs(tone.hz - 2000) < 20, `${tone.hz} Hz`);
});

test('stacked sources and no gnd part: the reference is the bottom of the stack, whatever the net order, and it is announced', () => {
  // B1 (bottom, 3 V) and B2 (on top, 6 V) in series: 0 / 3 / 9 V from the
  // bottom. The old rule took the first vsource neg in NET order — the middle
  // node when the nets are listed this way round.
  const parts = [{ id: 'B2', kind: 'vsource', params: { volts: 6 }, terminals: ['pos', 'neg'] },
    { id: 'B1', kind: 'vsource', params: { volts: 3 }, terminals: ['pos', 'neg'] },
    { id: 'R', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] }];
  const nets = [net('mid', ['B1', 'pos'], ['B2', 'neg']), net('top', ['B2', 'pos'], ['R', 'a']), net('bot', ['B1', 'neg'], ['R', 'b'])];
  for (const order of [nets, [...nets].reverse()]) {
    const b = new BoardImpl(5);
    b.setNetlist(parts, order);
    b.setPower(true);
    assert.equal(b.nodeVoltage('bot'), 0);
    assert.ok(Math.abs(b.nodeVoltage('mid') - 3) < 1e-6);
    assert.ok(Math.abs(b.nodeVoltage('top') - 9) < 1e-6);
    const w = b.getWarnings().find(x => x.code === 'implicit-ground-reference');
    assert.ok(w && w.netId === 'bot' && w.partId === 'B1', JSON.stringify(w));
  }
});

test('an explicit gnd part is never second-guessed and raises no reference warning', () => {
  const b = new BoardImpl(5);
  b.setNetlist([{ id: 'B', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] }, { id: 'R', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] }],
  [net('p', ['B', 'pos'], ['R', 'a'], ['G', 'gnd']), net('n', ['B', 'neg'], ['R', 'b'])]);
  b.setPower(true);
  assert.equal(b.nodeVoltage('p'), 0);
  assert.ok(Math.abs(b.nodeVoltage('n') + 5) < 1e-6);
  assert.equal(b.getWarnings().some(x => x.code === 'implicit-ground-reference'), false);
});

test('potato_battery / lemon_battery are weak cells, not the board 5 V: EMF under a volt, kilo-ohms inside', () => {
  for (const [kind, emf, rInt] of [['potato_battery', 0.85, 5000], ['lemon_battery', 0.9, 2000]]) {
    const b = new BoardImpl(5);
    b.setNetlist([{ id: 'P', kind, params: {}, terminals: ['pos', 'neg'] },
      { id: 'R', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] }],
    [net('p', ['P', 'pos'], ['R', 'a']), net('n', ['P', 'neg'], ['R', 'b'])]);
    b.setPower(true);
    assert.equal(b.nodeVoltage('n'), 0, `${kind}: its neg terminal is the reference`);
    assert.ok(Math.abs(b.nodeVoltage('p') - emf * 10000 / (10000 + rInt)) < 1e-6, `${kind}: ${b.nodeVoltage('p')}`);
  }
});

test('a piezo straight on an op-amp output does not pin it (lab-attenuator-gain shape)', () => {
  // A bare capacitor across an op-amp output is held at its stored voltage by
  // an instantaneous solve and dragged the amplifier to a rail; the piezo's
  // capacitance sits behind its series resistance.
  const b = new BoardImpl(5);
  b.setNetlist([{ id: 'VP', kind: 'vsource', params: { volts: 9 }, terminals: ['pos', 'neg'] },
    { id: 'VN', kind: 'vsource', params: { volts: 9 }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'IN', kind: 'vsource', params: { volts: 0.01 }, terminals: ['pos', 'neg'] },
    { id: 'U', kind: 'opamp', params: {}, terminals: ['inp', 'inn', 'out'] },
    { id: 'P', kind: 'piezo', params: {}, terminals: ['a', 'b'] }],
  [net('g', ['G', 'gnd'], ['VP', 'neg'], ['VN', 'pos'], ['IN', 'neg'], ['P', 'b']),
    net('i', ['IN', 'pos'], ['U', 'inp']), net('o', ['U', 'out'], ['U', 'inn'], ['P', 'a'])]);
  b.setPower(true);
  b.setControl('IN', 0.5);
  assert.ok(Math.abs(b.nodeVoltage('o') - 0.5) < 0.01, `follower output ${b.nodeVoltage('o')}`);
});

// buzzerTone() read a piezo's pitch from its last two crossings, i.e. ONE
// half-period, and doubled it. That is the period only at 50 % duty: a 555 or
// a Schmitt-gate oscillator is not symmetric, and through a series resistor
// the piezo's own voltage is a lopsided RC wave (lab-nand-pips: 526 Hz for a
// 567 Hz gate). The crossings were also stamped at the solver's step times,
// not where the voltage crossed. The pitch is the same-direction crossing
// interval, with each crossing interpolated inside its step.
for (const [duty, through] of [[0.25, 0], [0.3, 10000], [0.7, 10000]]) {
  test(`a piezo reads its true pitch at ${duty * 100} % duty${through ? ` through ${through / 1000} k` : ''}`, () => {
    const hz = 567;
    const b = new BoardImpl(5);
    const parts = [{ id: 'F', kind: 'function_gen', params: { wave: 'square', freq: hz, amplitude: 2.5, offset: 2.5, duty }, terminals: ['out', 'gnd'] },
      { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'P', kind: 'piezo', params: {}, terminals: ['a', 'b'] }];
    const nets = [net('g', ['G', 'gnd'], ['F', 'gnd'], ['P', 'b'])];
    if (through) {
      parts.push({ id: 'R', kind: 'resistor', params: { ohms: through }, terminals: ['a', 'b'] });
      nets.push(net('o', ['F', 'out'], ['R', 'a']), net('p', ['R', 'b'], ['P', 'a']));
    } else {
      nets.push(net('o', ['F', 'out'], ['P', 'a']));
    }
    b.setNetlist(parts, nets);
    b.setPower(true);
    for (let ms = 1; ms <= 40; ms++) b.advanceTo(BigInt(ms) * 1_000_000n);
    const tone = b.buzzerTone('P');
    assert.equal(tone.on, true);
    assert.ok(Math.abs(tone.hz - hz) < 0.5, `${tone.hz} Hz for ${hz} Hz`);
  });
}
