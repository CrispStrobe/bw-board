// LM386 audio power amplifier macromodel (src/lm386.js).
//
// Gap (2026-11-23, round 2): there was no LM386-class part, so the gallery's
// "amp IC drives a speaker" circuit could not be built. Oracles are the
// datasheet (TI SNAS545) and the model note's network arithmetic:
//   vout = Vs/2 + (1 + 2·RF/Z(1–8)) · (v+ − v−),
//   RF = 14.18 kΩ, RE = 142.5 Ω, RG = 1.35 kΩ  ->  ×20 open, ×200 bypassed.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { evaluateLm386Stage, LM386_STAGE_TERMINALS } from '../src/lm386.js';
import { perfHint } from './helpers/perf-hint.mjs';

registerAllDevices();
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });
const Cap = (id, farads) => ({ id, kind: 'capacitor', params: { farads }, terminals: ['a', 'b'] });
const V = (id, volts, extra = {}) => ({ id, kind: 'vsource', params: { volts, ...extra }, terminals: ['pos', 'neg'] });
const G = { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] };
const U = { id: 'U1', kind: 'lm386', params: {}, terminals: ['gain1', 'inn', 'inp', 'gnd', 'vout', 'vs', 'bypass', 'gain8'] };
const close = (a, e, tol, what) => assert.ok(Math.abs(a - e) <= tol, `${what}: ${a} vs ${e}`);

/**
 * The datasheet's minimum-parts amplifier: input into +IN, −IN to GND, output
 * through a 250 µF coupling capacitor into an 8 Ω speaker. `opts.gainCap`
 * puts 10 µF across pins 1–8; `opts.bypassCap` 10 µF from pin 7 to GND.
 */
function amp({ vs = 9, input = { volts: 0 }, gainCap = false, bypassCap = false, load = 8 } = {}) {
  const b = new BoardImpl(5);
  const parts = [V('VS', vs), G, V('SIG', 0, input), U, Cap('CO', 250e-6), R('SPK', load)];
  const nets = [
    net('vs', ['VS', 'pos'], ['U1', 'vs']),
    net('g', ['G', 'gnd'], ['VS', 'neg'], ['SIG', 'neg'], ['U1', 'gnd'], ['U1', 'inn'], ['SPK', 'b']),
    net('in', ['SIG', 'pos'], ['U1', 'inp']),
    net('out', ['U1', 'vout'], ['CO', 'a']),
    net('spk', ['CO', 'b'], ['SPK', 'a']),
  ];
  if (gainCap) {
    parts.push(Cap('CG', 10e-6));
    nets.push(net('p1', ['U1', 'gain1'], ['CG', 'a']), net('p8', ['U1', 'gain8'], ['CG', 'b']));
  }
  if (bypassCap) {
    parts.push(Cap('CB', 10e-6));
    nets.push(net('p7', ['U1', 'bypass'], ['CB', 'a']));
    nets[1].terminals.push({ part: 'CB', terminal: 'b' });
  }
  b.setNetlist(parts, nets);
  b.setPower(true);
  return b;
}

/** Peak-to-peak/2 of a net over one window, sampled every `stepUs`. */
function amplitude(b, netId, fromNs, toNs, stepUs = 10) {
  let lo = Infinity, hi = -Infinity;
  for (let t = fromNs; t <= toNs; t += BigInt(stepUs * 1000)) {
    b.advanceTo(t);
    const v = b.nodeVoltage(netId);
    lo = Math.min(lo, v); hi = Math.max(hi, v);
  }
  return { amp: (hi - lo) / 2, lo, hi };
}

describe('LM386 DC bias and supply', () => {
  it('output sits at Vs/2 with the input at 0 V', () => {
    // At power-on the 250 µF coupling capacitor is at rest, and charging it
    // through 8 Ω asks more than the 0.5 A limit: the thump. 100 ms later
    // (8 Ω x 250 µF = 2 ms) the output is at its bias.
    const b = amp({ vs: 9 });
    b.advanceTo(100_000_000n);
    close(b.nodeVoltage('out'), 4.5, 0.02, 'Vs/2 at 9 V');
    const b6 = amp({ vs: 6 });
    b6.advanceTo(100_000_000n);
    close(b6.nodeVoltage('out'), 3.0, 0.02, 'Vs/2 at 6 V');
    // With no load to charge, the bias is there at once.
    const bare = new BoardImpl(5);
    bare.setNetlist([V('VS', 12), G, U], [net('vs', ['VS', 'pos'], ['U1', 'vs']),
      net('g', ['G', 'gnd'], ['VS', 'neg'], ['U1', 'gnd'])]);
    bare.setPower(true);
    close(bare.nodeVoltage('@lm386:U1:vout'), 6, 0.02, 'Vs/2 at 12 V, unloaded, inputs unwired');
  });

  it('draws about 4 mA quiescent at 6 V', () => {
    const b = amp({ vs: 6 });
    b.advanceTo(200_000_000n);   // let the 250 µF output capacitor charge
    const iq = Math.abs(b.branchCurrent('VS', 'pos'));
    close(iq, 0.004, 0.0005, 'supply current');
  });

  it('is off below its minimum supply', () => {
    const b = amp({ vs: 3 });
    assert.ok(b.nodeVoltage('out') < 0.5, `unpowered output ${b.nodeVoltage('out')}`);
  });
});

describe('LM386 gain', () => {
  it('×20 with pins 1 and 8 open (26 dB)', () => {
    const b = amp({ input: { wave: 'sine', freq: 1000, amplitude: 0.02 } });
    b.advanceTo(20_000_000n);
    const { amp: a } = amplitude(b, 'spk', 20_000_000n, 22_000_000n);
    // 8 Ω behind 250 µF at 1 kHz: |8 / (8 − j0.64)| = 0.997
    close(a / 0.02, 20 * 0.997, 0.4, 'gain into 8 Ω');
  });

  it('×200 with 10 µF across pins 1 and 8 (46 dB)', () => {
    const b = amp({ input: { wave: 'sine', freq: 1000, amplitude: 0.005 }, gainCap: true });
    b.advanceTo(30_000_000n);
    const { amp: a } = amplitude(b, 'spk', 30_000_000n, 32_000_000n);
    // The 10 µF is 15.9 Ω at 1 kHz: Z = 142.5 + (1350 ‖ −j15.9) -> ×198.6
    close(a / 0.005, 198.6 * 0.997, 6, 'gain into 8 Ω');
  });

  it('a resistor in series with the gain capacitor sets a gain in between', () => {
    // Datasheet: 1.2 kΩ + 10 µF across 1–8 -> gain ≈ 50.
    const b = new BoardImpl(5);
    b.setNetlist([V('VS', 9), G, V('SIG', 0, { wave: 'sine', freq: 1000, amplitude: 0.01 }), U,
      R('RS', 1200), Cap('CG', 10e-6), Cap('CO', 250e-6), R('SPK', 8)], [
      net('vs', ['VS', 'pos'], ['U1', 'vs']),
      net('g', ['G', 'gnd'], ['VS', 'neg'], ['SIG', 'neg'], ['U1', 'gnd'], ['U1', 'inn'], ['SPK', 'b']),
      net('in', ['SIG', 'pos'], ['U1', 'inp']),
      net('p1', ['U1', 'gain1'], ['RS', 'a']), net('m', ['RS', 'b'], ['CG', 'a']), net('p8', ['U1', 'gain8'], ['CG', 'b']),
      net('out', ['U1', 'vout'], ['CO', 'a']), net('spk', ['CO', 'b'], ['SPK', 'a']),
    ]);
    b.setPower(true);
    b.advanceTo(30_000_000n);
    const { amp: a } = amplitude(b, 'spk', 30_000_000n, 32_000_000n);
    const z = 142.5 + 1 / (1 / 1350 + 1 / 1200);   // the capacitor is ~16 Ω, small beside 1.2 kΩ
    close(a / 0.01, (1 + 2 * 14178.75 / z) * 0.997, 3, 'gain ≈ 50');
  });

  it('−IN inverts', () => {
    const b = new BoardImpl(5);
    b.setNetlist([V('VS', 9), G, V('SIG', 0, { volts: 0.02 }), U, R('RL', 1000)], [
      net('vs', ['VS', 'pos'], ['U1', 'vs']),
      net('g', ['G', 'gnd'], ['VS', 'neg'], ['SIG', 'neg'], ['U1', 'gnd'], ['U1', 'inp'], ['RL', 'b']),
      net('in', ['SIG', 'pos'], ['U1', 'inn']),
      net('out', ['U1', 'vout'], ['RL', 'a']),
    ]);
    b.setPower(true);
    close(b.nodeVoltage('out'), 4.5 - 20 * 0.02, 0.05, 'DC-coupled inverting gain');
  });
});

describe('LM386 output: swing and current limit', () => {
  it('clips about 0.9 V from each rail into 8 Ω (≈ 0.75 W at 9 V)', () => {
    const b = amp({ input: { wave: 'sine', freq: 1000, amplitude: 0.5 } });
    b.advanceTo(20_000_000n);
    const { lo, hi } = amplitude(b, 'out', 20_000_000n, 22_000_000n, 5);
    assert.ok(hi < 9 - 0.9 + 0.05 && hi > 9 - 1.3, `positive clip ${hi}`);
    assert.ok(lo > 0.9 - 0.05 && lo < 1.3, `negative clip ${lo}`);
    // The clipped (near-square) wave tilts through the 250 µF: the speaker
    // sees ±3.7 V peaks around a ±3.47 V output swing.
    const { amp: a } = amplitude(b, 'spk', 22_000_000n, 24_000_000n, 5);
    assert.ok(a > 3.3 && a < 3.9, `peak into 8 Ω ${a}`);
  });

  it('limits the output current at 0.5 A into a short', () => {
    const b = new BoardImpl(5);
    b.setNetlist([V('VS', 9), G, U, R('RS', 0.1)], [
      net('vs', ['VS', 'pos'], ['U1', 'vs']),
      net('g', ['G', 'gnd'], ['VS', 'neg'], ['U1', 'gnd'], ['U1', 'inn'], ['U1', 'inp'], ['RS', 'b']),
      net('out', ['U1', 'vout'], ['RS', 'a']),
    ]);
    b.setPower(true);
    close(b.nodeVoltage('out') / 0.1, 0.5, 0.02, 'short-circuit current');
  });
});

describe('LM386 bypass and speed', () => {
  it('a bypass capacitor on pin 7 brings the bias up softly instead of at once', () => {
    const b = amp({ bypassCap: true });
    // BYPASS starts at 0 V with the capacitor at rest and charges through
    // RB ‖ RB = 7.1 kΩ x 10 µF = 71 ms; the output follows it.
    b.advanceTo(10_000_000n);
    const early = b.nodeVoltage('out');
    b.advanceTo(600_000_000n);
    assert.ok(early < 3.5, `early bias ${early}`);
    close(b.nodeVoltage('out'), 4.5, 0.03, 'settled bias');
  });

  it('20 ms of a 1 kHz tone into a speaker solves quickly', () => {
    const b = amp({ input: { wave: 'sine', freq: 1000, amplitude: 0.02 }, gainCap: true, bypassCap: true });
    const t0 = performance.now();
    b.advanceTo(20_000_000n);
    const wall = performance.now() - t0;
    assert.ok(wall < 15000, `20 ms took ${wall.toFixed(0)} ms` + perfHint('LM386 20 ms audio'));
    assert.equal(b._transientAccuracyUnmet, null);
  });
});

describe('LM386 stage Jacobian', () => {
  it('matches finite differences', () => {
    const v = { inp: 0.01, inn: -0.002, e1: 0.009, x: -0.001, pole: 4.6, vout: 4.4, vs: 9, gnd: 0 };
    const base = evaluateLm386Stage(v, 1);
    for (const ctl of LM386_STAGE_TERMINALS) {
      const h = 1e-7;
      const up = evaluateLm386Stage({ ...v, [ctl]: v[ctl] + h }, 1);
      const dn = evaluateLm386Stage({ ...v, [ctl]: v[ctl] - h }, 1);
      for (const [term, i0] of base.currents) {
        void i0;
        const fd = (up.currents.get(term) - dn.currents.get(term)) / (2 * h);
        const an = base.jacobian.get(term).get(ctl) ?? 0;
        assert.ok(Math.abs(fd - an) <= 1e-6 + 1e-5 * Math.abs(fd), `d${term}/d${ctl}: fd ${fd} vs ${an}`);
      }
    }
  });
});
