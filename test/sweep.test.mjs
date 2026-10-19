// The sweep instrument against analytic ground truth.
//
// The whole value of runDcSweep/runAcSweep is that a lesson can trust the
// curve. So the tests are oracles with closed-form answers:
//   - a resistor's V/I line has slope 1/R and passes through the origin
//   - a diode-in-series curve has a knee at Vf and slope 1/(R+rd) above it
//   - an RC low-pass measures -3 dB and -45 degrees at fc = 1/(2*pi*R*C),
//     and follows the analytic magnitude/phase everywhere else sampled
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { runDcSweep, runAcSweep, logSpace, correlateAt } from '../src/sweep.js';

function rcLowPassBoard(R, C) {
  const parts = [
    { id: 'vs', kind: 'vsource', params: { wave: 'sine', amplitude: 1, offset: 0, freq: 100 }, terminals: ['pos', 'neg'] },
    { id: 'r1', kind: 'resistor', params: { ohms: R }, terminals: ['a', 'b'] },
    { id: 'c1', kind: 'capacitor', params: { farads: C }, terminals: ['a', 'b'] },
    { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ];
  const nets = [
    { id: 'n_in', terminals: [{ part: 'vs', terminal: 'pos' }, { part: 'r1', terminal: 'a' }] },
    { id: 'n_out', terminals: [{ part: 'r1', terminal: 'b' }, { part: 'c1', terminal: 'a' }] },
    { id: 'n_g', terminals: [{ part: 'vs', terminal: 'neg' }, { part: 'c1', terminal: 'b' }, { part: 'g1', terminal: 'gnd' }] },
  ];
  const b = new BoardImpl(5.0);
  b.setNetlist(parts, nets);
  b.setPower(true);
  return b;
}

describe('runDcSweep — the curve tracer core', () => {
  it('a resistor draws its V/I line: slope 1/R through the origin', () => {
    const R = 1000;
    const parts = [
      { id: 'vs', kind: 'vsource', params: { volts: 0 }, terminals: ['pos', 'neg'] },
      { id: 'r1', kind: 'resistor', params: { ohms: R }, terminals: ['a', 'b'] },
      { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ];
    const nets = [
      { id: 'n_a', terminals: [{ part: 'vs', terminal: 'pos' }, { part: 'r1', terminal: 'a' }] },
      { id: 'n_g', terminals: [{ part: 'vs', terminal: 'neg' }, { part: 'r1', terminal: 'b' }, { part: 'g1', terminal: 'gnd' }] },
    ];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    b.setPower(true);
    const rows = runDcSweep(b, { sourceId: 'vs', from: 0, to: 5, steps: 11 });
    assert.equal(rows.length, 11);
    for (const { v, i } of rows) {
      const expect = v / R;
      assert.ok(Math.abs(i - expect) < 0.02 * Math.max(Math.abs(expect), 1e-4),
        `at ${v} V a ${R} ohm resistor draws ${expect * 1000} mA, measured ${i * 1000} mA`);
    }
    // Sign convention: positive sweep voltage, positive delivered current.
    assert.ok(rows.at(-1).i > 0, 'curve-tracer convention: current out of pos is positive');
  });

  it('a diode in series shows the knee at Vf and ohmic slope above it', () => {
    const R = 1000;
    const parts = [
      { id: 'vs', kind: 'vsource', params: { volts: 0 }, terminals: ['pos', 'neg'] },
      { id: 'r1', kind: 'resistor', params: { ohms: R }, terminals: ['a', 'b'] },
      { id: 'd1', kind: 'diode', params: {}, terminals: ['anode', 'cathode'] },
      { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ];
    const nets = [
      { id: 'n_a', terminals: [{ part: 'vs', terminal: 'pos' }, { part: 'r1', terminal: 'a' }] },
      { id: 'n_k', terminals: [{ part: 'r1', terminal: 'b' }, { part: 'd1', terminal: 'anode' }] },
      { id: 'n_g', terminals: [{ part: 'vs', terminal: 'neg' }, { part: 'd1', terminal: 'cathode' }, { part: 'g1', terminal: 'gnd' }] },
    ];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    b.setPower(true);
    const rows = runDcSweep(b, { sourceId: 'vs', from: 0, to: 3, steps: 61, nets: ['n_k'] });

    // Below the knee: essentially no current.
    const below = rows.filter((r) => r.v < 0.4);
    for (const r of below) {
      assert.ok(Math.abs(r.i) < 1e-4, `at ${r.v} V (below Vf) current must be ~0, got ${r.i}`);
    }
    // The knee sits where a silicon diode's knee sits.
    const knee = rows.find((r) => r.i > 0.5e-3);
    assert.ok(knee, 'the curve must turn on within the sweep');
    assert.ok(knee.v > 0.4 && knee.v < 1.3,
      `knee at ${knee.v} V — expected a silicon-diode region`);
    // Above the knee the incremental slope is ~1/(R + rd): finite, ohmic.
    const hi = rows.filter((r) => r.v > 2.0);
    const dI = hi.at(-1).i - hi[0].i;
    const dV = hi.at(-1).v - hi[0].v;
    const rTotal = dV / dI;
    assert.ok(rTotal > R * 0.9 && rTotal < R * 1.6,
      `incremental resistance above the knee ${rTotal} — expected ~${R} + rd`);
  });
});

describe('correlateAt — the lock-in detector', () => {
  it('recovers amplitude and phase of a clean sinusoid, ignoring DC', () => {
    const f = 1234;
    const A = 0.7;
    const phi = 37 * (Math.PI / 180);
    const N = 256;
    const cycles = 4;
    const samples = [];
    for (let k = 0; k < N; k++) {
      const t = (cycles * k) / (N * f);
      samples.push({ t, v: 2.5 + A * Math.sin(2 * Math.PI * f * t + phi) });
    }
    const { amp, phaseDeg } = correlateAt(samples, f);
    assert.ok(Math.abs(amp - A) < 0.01, `amplitude ${amp} vs ${A}`);
    assert.ok(Math.abs(phaseDeg - 37) < 1, `phase ${phaseDeg} vs 37`);
  });
});

describe('runAcSweep — the Bode core against the analytic RC low-pass', () => {
  it('measures -3 dB and -45 deg at fc, and tracks |H| and phase across two decades', () => {
    const R = 1000;
    const C = 100e-9;
    const fc = 1 / (2 * Math.PI * R * C); // 1591.5 Hz
    const b = rcLowPassBoard(R, C);
    const freqs = [fc / 10, fc / 3, fc, fc * 3, fc * 10];
    const rows = runAcSweep(b, {
      sourceId: 'vs', freqs, inNet: 'n_in', outNet: 'n_out',
      settleCycles: 8, measureCycles: 4, samplesPerCycle: 64,
    });
    assert.equal(rows.length, freqs.length);
    for (const { f, magDb, phaseDeg, ain } of rows) {
      assert.ok(ain > 0.5, `input amplitude visible at ${f} Hz, got ${ain}`);
      const w = f / fc;
      const expectDb = -10 * Math.log10(1 + w * w);
      const expectPhase = (-Math.atan(w) * 180) / Math.PI;
      assert.ok(Math.abs(magDb - expectDb) < 1.0,
        `|H| at ${f.toFixed(0)} Hz: measured ${magDb.toFixed(2)} dB, analytic ${expectDb.toFixed(2)} dB`);
      assert.ok(Math.abs(phaseDeg - expectPhase) < 6,
        `phase at ${f.toFixed(0)} Hz: measured ${phaseDeg.toFixed(1)}, analytic ${expectPhase.toFixed(1)}`);
    }
    const atFc = rows[2];
    assert.ok(Math.abs(atFc.magDb - -3.01) < 1.0, `-3 dB point: ${atFc.magDb}`);
    assert.ok(Math.abs(atFc.phaseDeg - -45) < 6, `-45 deg point: ${atFc.phaseDeg}`);
  });

  it('logSpace spans the decades inclusively', () => {
    const f = logSpace(100, 10000, 5);
    assert.ok(Math.abs(f[0] - 100) < 1e-9 && Math.abs(f.at(-1) - 10000) < 1e-6);
    assert.ok(f.length >= 11);
  });
});
