/**
 * Shockley-by-default junctions, pnjlim, and the GMIN-stepping ladder.
 * spec-updates/shockley-junction-limiting.md.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

const VCC = { id: 'V1', kind: 'vcc', params: {}, terminals: ['vcc'] };
const GND = { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] };
const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });

describe('Shockley diode: closed-form Vf at spot currents', () => {
  // Drive exact currents with an isource. The model is junction + series
  // rs (default 2 Ω), Is calibrated so the TOTAL drop is exactly vf at
  // the rated 20 mA:
  //   v(i) = (vf − 0.02·rs) + nVt·ln(i/20 mA) + i·rs
  // n = 1, vf = 0.7, rs = 2 → vJrated = 0.66:
  //   1 mA:   0.66 − 25.85m·ln20 + 0.002 = 0.58455
  //   10 mA:  0.66 − 25.85m·ln2  + 0.02  = 0.66208
  //   20 mA:  vf exactly (the calibration anchor)
  //   100 mA: 0.66 + 25.85m·ln5  + 0.2   = 0.90161
  // PWL cannot produce these numbers at all (it answers vf + i·rd).
  for (const [iMa, hand] of [[1, 0.58455], [10, 0.66208], [20, 0.70000], [100, 0.90161]]) {
    it(`${iMa} mA → ${hand} V`, () => {
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
      assert.ok(Math.abs(v - hand) < 0.001,
        `Vf at ${iMa} mA must be ${hand} V (composite with rs=2), got ${v.toFixed(5)}`);
    });
  }
});

describe('canonical LED bench: the opt-in shift is measured and bounded', () => {
  it('5 V / 1 kΩ / LED (shockley): current within 6 % of the PWL value', () => {
    // PWL: i = (5−2)/1010 = 2.9703 mA (the knee has rd = 10 in series).
    // Shockley composite (n = 1.8, rs = 2, Is calibrated for 2 V total at
    // 20 mA): fixed point of (5−v)/1000 = i with
    // v = 1.96 + 46.53m·ln(i/20m) + 2i → i = 3.1202 mA, v = 1.8798 V —
    // a +5.0 % shift. Measured and stated, not hidden: this number is WHY
    // the default stays PWL until the corpus flip (ROADMAP E1.3b).
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
    assert.ok(Math.abs(i - 3.1202e-3) < 0.02e-3,
      `Shockley bench current must be 3.1202 mA (hand fixed point), got ${(i * 1e3).toFixed(4)} mA`);
    assert.ok(Math.abs(i - iPwl) / iPwl < 0.06,
      `shift vs PWL must stay under 6 %, got ${(100 * Math.abs(i - iPwl) / iPwl).toFixed(2)} %`);
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
