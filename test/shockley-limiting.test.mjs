/**
 * Shockley-by-default junctions, pnjlim, and the GMIN-stepping ladder.
 * spec-updates/shockley-junction-limiting.md.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { classDefaults } from '../src/parts-library.js';

const VCC = { id: 'V1', kind: 'vcc', params: {}, terminals: ['vcc'] };
const GND = { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] };
const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });

// The hand numbers below are closed-form values for ONE device. If the class
// default moves, they describe a device the solver no longer builds -- the
// failure mode that made mna-diode's series-LED golden compare IS=1e-20
// against a vf=2.0 part. Pin the device so a change here fails by name.
describe('the spot-current numbers name their device', () => {
  it('classDefaults(diode) is still the 1N4148-class part they were derived for', () => {
    const d = classDefaults('diode');
    assert.equal(d.rs, 0.568, 'rs moved: re-derive the spot currents, do not retune the tolerance');
    assert.equal(d.n, 1.752, 'n moved: re-derive the spot currents, do not retune the tolerance');
  });
});

describe('Shockley diode: closed-form Vf at spot currents', () => {
  // Drive exact currents with an isource. The model is junction + series rs,
  // Is calibrated so the TOTAL drop is exactly vf at the rated 20 mA:
  //   v(i) = (vf - 0.02*rs) + n*Vt*ln(i/20 mA) + i*rs
  // 1N4148 class: vf = 0.7, rs = 0.568, n = 1.752 -> vJrated = 0.68864,
  // n*Vt = 0.0452892 (Vt = 25.85 mV):
  //   1 mA:   0.68864 - 45.289m*ln20 + 0.000568 = 0.553534
  //   10 mA:  0.68864 - 45.289m*ln2  + 0.005680 = 0.662928
  //   20 mA:  vf exactly (the calibration anchor)
  //   100 mA: 0.68864 + 45.289m*ln5  + 0.056800 = 0.818330
  //
  // MEASURED against ngspice-44, not only against the formula. Deck:
  //   I1 0 na <i> / D1 na 0 DM
  //   .model DM D(IS=4.982102e-9 N=1.752 RS=0.568)
  // where IS is the one our 20 mA calibration implies. Agreement is 2e-7 V at
  // every one of the four currents -- four decades, no residual slope, so
  // neither n (would scale with ln i) nor rs (would scale with i) is off.
  //
  // The deck needs BOTH `.options temp=26.826800 tnom=26.826800`. temp alone
  // leaves a flat +0.686 mV: ngspice rescales IS from its TNOM=27 default to
  // the requested temperature via the bandgap law, so a 0.173 K gap becomes a
  // constant voltage offset at every current. I had previously recorded the
  // ngspice floor as "VT_25C vs 300.15 K"; that is the same root cause but the
  // fix is tnom, and with it the floor is not 0.04 % but zero.
  //
  // PWL cannot produce these numbers at all (it answers vf + i*rd).
  for (const [iMa, hand] of [[1, 0.553534], [10, 0.662928], [20, 0.700000], [100, 0.818330]]) {
    it(`${iMa} mA -> ${hand} V`, () => {
      const parts = [
        GND,
        { id: 'I1', kind: 'isource', params: { amps: iMa / 1000 }, terminals: ['pos', 'neg'] },
        { id: 'D1', kind: 'diode', params: { vf: 0.7, model: 'shockley' }, terminals: ['anode', 'cathode'] },
      ];
      const nets = [
        { id: 'n_a', terminals: [{ part: 'I1', terminal: 'pos' }, { part: 'D1', terminal: 'anode' }] },
        { id: 'n_gnd', terminals: [
          { part: 'G1', terminal: 'gnd' },
          { part: 'I1', terminal: 'neg' }, { part: 'D1', terminal: 'cathode' },
        ] },
      ];
      const board = new BoardImpl(5.0);
      board.setNetlist(parts, nets);
      const v = board.nodeVoltage('n_a');
      assert.ok(Math.abs(v - hand) < 1e-4,
        `Vf at ${iMa} mA must be ${hand} V (1N4148 class, rs=0.568 n=1.752, ngspice-anchored), got ${v.toFixed(6)}`);
    });
  }
});

describe('canonical LED bench: the opt-in shift is measured and bounded', () => {
  it('5 V / 1 kOhm / LED (shockley): 3.2520 mA, the ngspice value', () => {
    // PWL: i = (5-2)/1010 = 2.9703 mA (the knee has rd = 10 in series).
    // Shockley composite, LED class (n = 1.8, rs = 10, Is calibrated for 2 V
    // total at 20 mA -> vJrated = 1.8, Is = 3.1657e-19): fixed point of
    // (5-v)/1000 = i with v = 1.8 + 46.53m*ln(i/20m) + 10i
    //   -> i = 3.25200 mA, v = 1.748000 V.
    //
    // ngspice-44 on the same deck, same Is, temp=tnom=26.8268 C:
    //   i = 3.25200 mA, v = 1.748004 V  -- 0.0001 %.
    // This is the bench lego-38 runs in bw-circuit-ui PR #21; before rs had a
    // single definition our answer there was 1.879795 V, off by 130.8 mV.
    //
    // The +9.48 % gap to PWL is now attributable to ONE thing. It used to
    // conflate two: the shockley path ran rs = 2 while the PWL path ran
    // rd = 10, so the two paths described different devices and the residue
    // was uninterpretable. With rs == rd the series term is identical at every
    // current and the entire gap is the junction shape -- PWL holds the knee
    // flat at vf while the real junction drops LESS than vf below the rated
    // current, so PWL under-predicts current everywhere off-rated. At the
    // rated 20 mA the two paths agree exactly, by construction.
    //
    // 9.48 % is a RECORDED MEASUREMENT of that shape difference, not a
    // tolerance. It is why the default stays PWL until the corpus flip
    // (ROADMAP E1.3b) -- and it is bigger than the 5.0 % recorded when the
    // paths disagreed about rs, because that disagreement had been masking
    // part of the shape gap rather than adding to it.
    const parts = [VCC, GND, R('R1', 1000),
      { id: 'L1', kind: 'led', params: { vf: 2.0, model: 'shockley' }, terminals: ['anode', 'cathode'] }];
    const nets = [
      { id: 'n_vcc', terminals: [{ part: 'V1', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'n_led', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'L1', terminal: 'anode' }] },
      { id: 'n_gnd', terminals: [{ part: 'G1', terminal: 'gnd' }, { part: 'L1', terminal: 'cathode' }] },
    ];
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    const i = Math.abs(board.branchCurrent('L1', 'anode'));
    const iPwl = (5 - 2) / 1010;
    assert.ok(Math.abs(i - 3.25200e-3) < 0.001e-3,
      `Shockley bench current must be 3.2520 mA (ngspice-anchored), got ${(i * 1e3).toFixed(4)} mA`);
    assert.ok(Math.abs(board.nodeVoltage('n_led') - 1.748000) < 1e-4,
      `and 1.748000 V at the LED anode, got ${board.nodeVoltage('n_led').toFixed(6)}`);
    const shift = 100 * Math.abs(i - iPwl) / iPwl;
    assert.ok(Math.abs(shift - 9.484) < 0.02,
      `the recorded PWL shift is 9.484 %, got ${shift.toFixed(3)} % -- re-derive and update the note above, do not widen this`);
    // One truth on the bench: an opted-in junction routes past the walker,
    // so nodeVoltage and branchCurrent agree.
    const vLed = board.nodeVoltage('n_led');
    assert.ok(Math.abs((5 - vLed) / 1000 - i) < 1e-6,
      `nodeVoltage (${vLed.toFixed(4)}) and branchCurrent must tell one story`);
  });
});

describe('pnjlim: the classic series-opposition stress', () => {
  it('two diodes nose-to-nose across a source converge', () => {
    // D1 forward, D2 reversed, in series across 5 V through 1 kΩ. Nearly
    // all of the source drops across the reversed junction; a flat 0.5 V
    // clamp oscillates here, the logarithmic limiter settles it.
    const parts = [VCC, GND, R('R1', 1000),
      { id: 'D1', kind: 'diode', params: { vf: 0.7, model: 'shockley' }, terminals: ['anode', 'cathode'] },
      { id: 'D2', kind: 'diode', params: { vf: 0.7, model: 'shockley' }, terminals: ['anode', 'cathode'] }];
    const nets = [
      { id: 'n_vcc', terminals: [{ part: 'V1', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'n_1', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'D1', terminal: 'anode' }] },
      // D2 reversed: cathode faces D1's cathode... nose-to-nose means the
      // middle net joins the two cathodes.
      { id: 'n_mid', terminals: [{ part: 'D1', terminal: 'cathode' }, { part: 'D2', terminal: 'cathode' }] },
      { id: 'n_gnd', terminals: [{ part: 'G1', terminal: 'gnd' }, { part: 'D2', terminal: 'anode' }] },
    ];
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    const warnings = board.getWarnings().filter(w => w.severity === 'danger');
    assert.equal(warnings.length, 0,
      `must converge (danger warnings: ${warnings.map(w => w.message).join(' | ')})`);
    // Blocked pair: only reverse leakage flows; the top node sits at ~5 V.
    const v1 = board.nodeVoltage('n_1');
    assert.ok(v1 > 4.9, `blocked pair passes only leakage; n_1 = ${v1.toFixed(4)} V`);
    for (const net of ['n_1', 'n_mid']) {
      assert.ok(Number.isFinite(board.nodeVoltage(net)), `${net} finite`);
    }
  });
});

describe('GMIN stepping: a cross-coupled latch converges', () => {
  it('two cross-coupled NMOS inverters find an operating point', () => {
    const parts = [VCC, GND, R('RA', 10000), R('RB', 10000),
      { id: 'MA', kind: 'nmos', params: { vth: 2.0, k: 0.5 }, terminals: ['gate', 'drain', 'source'] },
      { id: 'MB', kind: 'nmos', params: { vth: 2.0, k: 0.5 }, terminals: ['gate', 'drain', 'source'] }];
    const nets = [
      { id: 'n_vcc', terminals: [
        { part: 'V1', terminal: 'vcc' },
        { part: 'RA', terminal: 'a' }, { part: 'RB', terminal: 'a' },
      ] },
      { id: 'n_qa', terminals: [
        { part: 'RA', terminal: 'b' }, { part: 'MA', terminal: 'drain' },
        { part: 'MB', terminal: 'gate' },
      ] },
      { id: 'n_qb', terminals: [
        { part: 'RB', terminal: 'b' }, { part: 'MB', terminal: 'drain' },
        { part: 'MA', terminal: 'gate' },
      ] },
      { id: 'n_gnd', terminals: [
        { part: 'G1', terminal: 'gnd' },
        { part: 'MA', terminal: 'source' }, { part: 'MB', terminal: 'source' },
      ] },
    ];
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    const danger = board.getWarnings().filter(w => w.severity === 'danger');
    assert.equal(danger.length, 0,
      `latch must converge (${danger.map(w => w.message).join(' | ')})`);
    const qa = board.nodeVoltage('n_qa');
    const qb = board.nodeVoltage('n_qb');
    assert.ok(Number.isFinite(qa) && Number.isFinite(qb), 'both outputs finite');
    assert.ok(qa >= -0.01 && qa <= 5.01 && qb >= -0.01 && qb <= 5.01,
      `outputs inside the rails: qa=${qa.toFixed(3)}, qb=${qb.toFixed(3)}`);
  });
});
