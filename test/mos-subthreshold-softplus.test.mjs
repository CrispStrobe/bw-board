/**
 * SUBTHRESHOLD CONDUCTION, FOR A CARD THAT DECLARES IT.
 *
 * LTspice's power MOSFETs are `VDMOS` models and ngspice gives those real
 * subthreshold conduction, governed by `Ksubthres`. Our level-1 stamp cuts off
 * exactly — and that is RIGHT for a level-1 card: measured, ngspice's own
 * level-1 MOS sits flat at 5e-12 A right up to threshold. So this is opt-in on
 * the declared parameter, and the identity test below is what says a card
 * without one is untouched.
 *
 * THE SHAPE WAS CHARACTERISED AGAINST ngspice, NOT COPIED FROM IT. A DC sweep of
 * `.model VD VDMOS(Vto=1 Kp=0.12 Ksubthres=0.1)`, Vgs 0.2 → 1.4 V at Vds = 2 V,
 * fitted:
 *
 *     Vov_eff = Ksub * ln(1 + exp(Vov / Ksub))       the SOFT-PLUS
 *     Id      = the ordinary square law on Vov_eff
 *
 * That form agrees with ngspice to 0.000 % over the whole usable range. Two
 * independent consequences of it were confirmed separately, which is why the
 * fit is believed rather than merely observed:
 *
 *   - deep subthreshold, Vov_eff → Ksub·exp(Vov/Ksub), so Id ∝ exp(2Vov/Ksub)
 *     and the slope is Ksub·ln(10)/2 V/decade. Measured at Ksub = 0.1, 0.2, 0.3
 *     and 0.5, each in its own deep-subthreshold window: all within 0.2 %.
 *   - above threshold Vov_eff → Vov EXACTLY, so the square law is untouched —
 *     which is why ngspice's VDMOS and our level-1 already agreed to five
 *     significant figures for Vgs ≥ 1.75 V.
 *
 * WHAT IT IS WORTH ON THE CORPUS: nothing, today, and that is stated rather
 * than hidden. 182 Si7li no-aug decks have a MOS device that actually carries
 * `ksubthres`, and NOT ONE of them reaches a comparison — every one is blocked
 * upstream by element coverage. (An earlier census of mine said "80 of 84 decks
 * with a VDMOS in play agree", which counted decks whose LIBRARY TEXT contains
 * a VDMOS card, not decks whose DEVICE uses one. The corrected number is the
 * one above.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

/** One NMOS, gate driven, 1 Ω in the drain — the bench ngspice was run on. */
function drainCurrent({ vg, ksubthres }) {
  const b = new BoardImpl(5);
  b.setNetlist([
    { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'VD', kind: 'vsource', params: { volts: 2 }, terminals: ['pos', 'neg'] },
    { id: 'VG', kind: 'vsource', params: { volts: vg }, terminals: ['pos', 'neg'] },
    { id: 'RD', kind: 'resistor', params: { ohms: 1 }, terminals: ['a', 'b'] },
    { id: 'M1', kind: 'nmos', params: { vth: 1, kp: 0.12, w: 1, l: 1, ...(ksubthres ? { ksubthres } : {}) },
      terminals: ['drain', 'gate', 'source'] },
  ], [
    { id: 'n_dd', terminals: [{ part: 'VD', terminal: 'pos' }, { part: 'RD', terminal: 'a' }] },
    { id: 'n_d', terminals: [{ part: 'RD', terminal: 'b' }, { part: 'M1', terminal: 'drain' }] },
    { id: 'n_g', terminals: [{ part: 'VG', terminal: 'pos' }, { part: 'M1', terminal: 'gate' }] },
    { id: 'n_0', terminals: [
      { part: 'GND1', terminal: 'gnd' }, { part: 'M1', terminal: 'source' },
      { part: 'VD', terminal: 'neg' }, { part: 'VG', terminal: 'neg' },
    ] },
  ]);
  return Math.abs(b.branchCurrent('RD', 'a'));
}

/** ngspice 42's own readings for `VDMOS(Vto=1 Kp=0.12 Ksubthres=0.1)`. */
const NGSPICE_VDMOS = [
  [0.50, 2.7060e-8], [0.75, 3.7342e-6], [1.00, 2.8827e-4],
  [1.25, 3.9904e-3], [1.50, 1.50403e-2], [2.00, 6.00005e-2],
];

test('a declared Ksubthres reproduces ngspice VDMOS at every bias point', () => {
  for (const [vg, expected] of NGSPICE_VDMOS) {
    const got = drainCurrent({ vg, ksubthres: 0.1 });
    assert.ok(Math.abs(got - expected) <= expected * 2e-3,
      `Vgs ${vg}: ngspice ${expected.toExponential(5)}, we read ${got.toExponential(5)}`);
  }
});

test('a card WITHOUT Ksubthres keeps the exact level-1 cutoff', () => {
  // THE IDENTITY TEST. ngspice's own level-1 MOS reads 5.01e-12 A flat from
  // Vgs = 0 to Vgs = 1.0 and 3.750e-3 at 1.25 — a hard corner — and matching
  // THAT is what a level-1 card is entitled to. If these move, every level-1
  // deck in the corpus moves with them.
  for (const vg of [0, 0.5, 0.75, 1.0]) {
    assert.ok(drainCurrent({ vg }) < 1e-6,
      `Vgs ${vg} must be cut off, read ${drainCurrent({ vg }).toExponential(3)}`);
  }
  assert.ok(Math.abs(drainCurrent({ vg: 1.25 }) - 3.75e-3) < 1e-6, 'the square law exactly');
  assert.ok(Math.abs(drainCurrent({ vg: 2.0 }) - 6.0e-2) < 1e-6);
});

test('the subthreshold slope is Ksub*ln(10)/2 volts per decade', () => {
  // The law, not just one curve. Each Ksub is measured in ITS OWN deep
  // subthreshold window, the one the ngspice characterisation used: a single
  // fixed window lands in the BLEND for a large Ksub and in the leakage floor
  // for a small one, which is how my first attempt at this measurement produced
  // four different "slopes" for the same model.
  for (const [ksubthres, loV, hiV] of [[0.1, 0.35, 0.45], [0.2, -0.30, -0.10], [0.3, -0.80, -0.60]]) {
    const lo = drainCurrent({ vg: loV, ksubthres });
    const hi = drainCurrent({ vg: hiV, ksubthres });
    const perDecade = (hiV - loV) / Math.log10(hi / lo);
    const expected = ksubthres * Math.LN10 / 2;
    assert.ok(Math.abs(perDecade - expected) < expected * 0.02,
      `Ksub ${ksubthres}: ${perDecade.toFixed(5)} V/decade, expected ${expected.toFixed(5)}`);
  }
});

test('above threshold the soft-plus converges on the square law, as ngspice does', () => {
  // The other end of the same claim, and my first version of it asserted the
  // WRONG thing -- "identical to double precision". It is not: at Vgs = 2 the
  // soft-plus reads 6.000054e-2 against the square law's 6.000000e-2, a 9e-6
  // relative offset, because ln(1+exp(-10)) is not exactly zero.
  //
  // ngspice shows THE SAME OFFSET, which is the point: its VDMOS reads
  // 6.00005e-2 on this bench where its own level-1 reads 6.00000e-2. So the
  // assertion is that the offset shrinks with overdrive and stays at ngspice's
  // size -- reproducing the oracle, not an idealisation of it.
  const offsets = [2, 3, 5].map((vg) => {
    const withSub = drainCurrent({ vg, ksubthres: 0.1 });
    const plain = drainCurrent({ vg });
    return Math.abs(withSub - plain) / plain;
  });
  assert.ok(offsets[0] < 2e-5, `Vgs 2 offset ${offsets[0].toExponential(2)}, ngspice's is ~9e-6`);
  assert.ok(offsets[1] < offsets[0], 'the offset must shrink with overdrive');
  assert.ok(offsets[2] < offsets[1]);
  assert.ok(offsets[2] < 1e-12, `by Vgs 5 it must be gone: ${offsets[2].toExponential(2)}`);
});

test('a zero or negative Ksubthres means no subthreshold conduction', () => {
  // The parameter is read through one guard (`mosKsubthres`) precisely so this
  // is answerable in one place: an absent, zero or negative value all mean the
  // level-1 cutoff, and none of them may divide by zero on the way.
  for (const ksubthres of [0, -0.1]) {
    assert.equal(drainCurrent({ vg: 0.75, ksubthres }), drainCurrent({ vg: 0.75 }),
      `Ksubthres ${ksubthres} must behave as absent`);
  }
});
