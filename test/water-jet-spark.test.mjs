/**
 * Static electricity as circuits can see it.
 *
 * WATER JET (light_path medium 'jet', src/optics.js): a thin stream of tap
 * water crosses a light beam between an LED and a phototransistor. A charged
 * comb brought near pulls it sideways, by an amount that goes as the comb's
 * potential squared (both signs attract) and as 1/d^2; the stream leaves the
 * beam and the receiver sees more light.
 *
 * SPARKS (spark_gap, src/devices/spark-gap.js): a small capacitance charged
 * by a tiny current (a comb being run through hair) climbs to the gap's
 * breakdown voltage, Vb = 3 kV/mm x gap + 1.35 kV, then empties in a spark;
 * the sparks repeat at I / (C Vb), and a wider gap makes fewer, bigger ones.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { waterJetDeflectionMm, waterJetShadow } from '../src/optics.js';
import { sparkBreakdownVolts } from '../src/devices/spark-gap.js';

registerAllDevices();

const t = (part, terminal) => ({ part, terminal });
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

describe('water jet bent by a charged comb', () => {
  it('bends as V^2 / d^2, the same for either sign, up to sticking', () => {
    close(waterJetDeflectionMm({ combKv: 10, combCm: 2 }), 10, 1e-9);
    close(waterJetDeflectionMm({ combKv: -10, combCm: 2 }), 10, 1e-9, 'negative comb attracts too');
    close(waterJetDeflectionMm({ combKv: 5, combCm: 2 }), 2.5, 1e-9, 'half the voltage, a quarter of the bend');
    close(waterJetDeflectionMm({ combKv: 10, combCm: 4 }), 2.5, 1e-9, 'twice as far, a quarter');
    assert.equal(waterJetDeflectionMm({ combKv: 10, combCm: 0.5 }), 25, 'sticks to the comb');
    close(waterJetShadow({ combKv: 0 }), 0.9 * 3 / 4, 1e-9, 'uncharged: centred 3 mm stream shades 3/4 of a 4 mm beam');
    assert.equal(waterJetShadow({ combKv: 10, combCm: 2 }), 0, 'bent 10 mm: out of the beam');
  });

  it('on a board, bringing the comb close lifts the receiver', () => {
    const b = new BoardImpl(9);
    b.setNetlist([
      { id: 'V', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'RL', kind: 'resistor', params: { ohms: 470 }, terminals: ['a', 'b'] },
      { id: 'L', kind: 'led', params: { color: 'red' }, terminals: ['anode', 'cathode'] },
      { id: 'Q', kind: 'phototransistor', params: {}, terminals: ['collector', 'emitter'] },
      { id: 'RE', kind: 'resistor', params: { ohms: 2200 }, terminals: ['a', 'b'] },
      { id: 'P', kind: 'light_path', params: { from: 'L', to: 'Q', medium: 'jet', distanceCm: 3, combKv: 10, combCm: 20 }, terminals: [] },
    ], [
      { id: 'top', terminals: [t('V', 'vcc'), t('RL', 'a'), t('Q', 'collector')] },
      { id: 'la', terminals: [t('RL', 'b'), t('L', 'anode')] },
      { id: 'out', terminals: [t('Q', 'emitter'), t('RE', 'a')] },
      { id: 'gnd', terminals: [t('G', 'gnd'), t('L', 'cathode'), t('RE', 'b')] },
    ]);
    b.setPower(true);
    b.advanceTo(2_000_000n);
    const far = b.nodeVoltages.get('out');
    b.setPartParam('P', 'combCm', 2);
    b.advanceTo(4_000_000n);
    const near = b.nodeVoltages.get('out');
    // far: the stream shades 0.9 x 3/4 of the beam (bent 0.1 mm); near: none.
    assert.ok(near > 2 * far, `comb near: ${near} V against ${far} V far (expected ~3.3x)`);
  });
});

describe('spark gap', () => {
  it('breakdown voltage', () => {
    close(sparkBreakdownVolts({ params: { gapMm: 1 } }), 4350, 1e-9);
    close(sparkBreakdownVolts({ params: { gapMm: 3 } }), 10350, 1e-9);
  });

  /** 100 nA into 10 pF (the comb), the gap and 1 kOhm to earth. */
  function comb(gapMm) {
    const b = new BoardImpl(9);
    b.setNetlist([
      { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'I', kind: 'isource', params: { amps: 100e-9 }, terminals: ['pos', 'neg'] },
      { id: 'C', kind: 'capacitor', params: { farads: 10e-12 }, terminals: ['a', 'b'] },
      { id: 'S', kind: 'spark_gap', params: { gapMm }, terminals: ['a', 'b'] },
      { id: 'R', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    ], [
      { id: 'comb', terminals: [t('I', 'pos'), t('C', 'a'), t('S', 'a')] },
      { id: 'k', terminals: [t('S', 'b'), t('R', 'a')] },
      { id: 'gnd', terminals: [t('G', 'gnd'), t('I', 'neg'), t('C', 'b'), t('R', 'b')] },
    ]);
    b.setPower(true);
    return b;
  }

  it('the comb charges to breakdown and sparks at I/(C Vb); a wider gap sparks less often', () => {
    const b = comb(1);
    let peak = 0;
    for (let ms = 10; ms <= 1000; ms += 10) {
      b.advanceTo(BigInt(ms) * 1_000_000n);
      peak = Math.max(peak, b.nodeVoltages.get('comb'));
      assert.equal(b.transientAnalysisStatus().failure, null);
    }
    const s = b.getDeviceState('S');
    // 10 pF x 4.35 kV / 100 nA = 0.435 s per spark: 2 in the first second.
    assert.equal(s.sparks, 2);
    assert.ok(peak < 4400 && peak > 4000, `comb peaked at ${peak} V (expected just under 4.35 kV)`);
    close(s.lastCoulombs, 10e-12 * (4350 - 30), 5e-9, 'each spark carries C x (Vb - arc)');
    assert.ok(b.nodeVoltages.get('comb') < 4350);
    const wide = comb(3);
    wide.advanceTo(1_000_000_000n);
    assert.equal(wide.getDeviceState('S').sparks, 0, '3 mm needs 10.35 kV: no spark within 1 s');
  });
});
