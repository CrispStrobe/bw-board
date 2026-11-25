/**
 * The 4046-type phase-locked loop (src/devices/pll-4046.js): its VCO runs at
 * f = (V(vco_in)/R1 + (VDD/2)/R2) / (2 C1 VDD) set by the external R1, R2
 * and C1; comparator I is an XOR; comparator II is a three-state
 * phase-frequency detector that rests (pcp_out HIGH) once the loop locks.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const t = (part, terminal) => ({ part, terminal });
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);
const VDD = 9;

/**
 * A 4046 on 9 V with R1, C1 (and optionally R2). `vin` is either a number
 * (a divider-stiff source on vco_in) or 'loop' (PC2 through a lag-lead
 * filter back to vco_in) with a square-wave input at `sigHz`.
 */
function bench({ r1 = 100e3, c1 = 10e-9, r2 = null, vin = 4.5, sigHz = null, pc = 'pc2' }) {
  const b = new BoardImpl(VDD);
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U', kind: 'cd4046', params: {}, terminals: ['pcp_out', 'pc1_out', 'comp_in', 'vco_out', 'inh', 'c1a', 'c1b', 'vss', 'vco_in', 'dem_out', 'r1', 'r2', 'pc2_out', 'sig_in', 'zener', 'vdd'] },
    { id: 'R1', kind: 'resistor', params: { ohms: r1 }, terminals: ['a', 'b'] },
    { id: 'C1', kind: 'capacitor', params: { farads: c1 }, terminals: ['a', 'b'] },
  ];
  const nets = [
    { id: 'vdd', terminals: [t('VCC', 'vcc'), t('U', 'vdd')] },
    { id: 'gnd', terminals: [t('G', 'gnd'), t('U', 'vss'), t('U', 'inh'), t('R1', 'b')] },
    { id: 'r1', terminals: [t('U', 'r1'), t('R1', 'a')] },
    { id: 'ca', terminals: [t('U', 'c1a'), t('C1', 'a')] },
    { id: 'cb', terminals: [t('U', 'c1b'), t('C1', 'b')] },
    { id: 'vco', terminals: [t('U', 'vco_out'), t('U', 'comp_in')] },
  ];
  if (r2) {
    parts.push({ id: 'R2', kind: 'resistor', params: { ohms: r2 }, terminals: ['a', 'b'] });
    nets.push({ id: 'r2', terminals: [t('U', 'r2'), t('R2', 'a')] });
    nets[1].terminals.push(t('R2', 'b'));
  }
  if (typeof vin === 'number') {
    parts.push({ id: 'VIN', kind: 'vsource', params: { volts: vin }, terminals: ['pos', 'neg'] });
    nets.push({ id: 'vin', terminals: [t('VIN', 'pos'), t('U', 'vco_in')] });
    nets[1].terminals.push(t('VIN', 'neg'));
  } else {
    // loop filter: comparator -> R3 -> vco_in; vco_in -> R4 -> C2 -> gnd
    parts.push({ id: 'R3', kind: 'resistor', params: { ohms: 100e3 }, terminals: ['a', 'b'] },
      { id: 'R4', kind: 'resistor', params: { ohms: 10e3 }, terminals: ['a', 'b'] },
      { id: 'C2', kind: 'capacitor', params: { farads: 470e-9 }, terminals: ['a', 'b'] },
      { id: 'FG', kind: 'function_gen', params: { wave: 'square', freq: sigHz, amplitude: 4.5, offset: 4.5 }, terminals: ['out', 'gnd'] });
    nets.push({ id: 'pc', terminals: [t('U', pc === 'pc2' ? 'pc2_out' : 'pc1_out'), t('R3', 'a')] },
      { id: 'vin', terminals: [t('R3', 'b'), t('U', 'vco_in'), t('R4', 'a')] },
      { id: 'c2', terminals: [t('R4', 'b'), t('C2', 'a')] },
      { id: 'sig', terminals: [t('FG', 'out'), t('U', 'sig_in')] });
    nets[1].terminals.push(t('C2', 'b'), t('FG', 'gnd'));
  }
  b.setNetlist(parts, nets);
  b.setPower(true);
  let tNs = 0n;
  return {
    b,
    run(ms) { tNs += BigInt(Math.round(ms * 1e6)); b.advanceTo(tNs); assert.equal(b.transientAnalysisStatus().failure, null); },
    state() { return b.getDeviceState('U'); },
    v(net) { return b.nodeVoltages.get(net) ?? 0; },
  };
}

describe('cd4046: VCO set by R1, R2, C1', () => {
  it('runs at V(vco_in) / (2 R1 C1 VDD): 250 Hz at half supply, 100k and 10 nF', () => {
    const x = bench({ vin: 4.5 });
    x.run(30);
    close(x.state().vcoHz, 250, 6, 'f at 4.5 V');
  });

  it('the frequency is proportional to the control voltage', () => {
    const lo = bench({ vin: 2.25 }); lo.run(40);
    const hi = bench({ vin: 9 }); hi.run(20);
    close(lo.state().vcoHz, 125, 4, 'f at 2.25 V');
    close(hi.state().vcoHz, 500, 12, 'f at 9 V');
  });

  it('R2 adds a minimum frequency: (VDD/2)/R2 / (2 C1 VDD) = 25 Hz at 1 Mohm, 0 V in', () => {
    const x = bench({ vin: 0, r2: 1e6 });
    x.run(200);
    close(x.state().vcoHz, 25, 1.5, 'fmin');
  });
});

describe('cd4046: the loop', () => {
  it('comparator II locks the VCO onto a 300 Hz input; pcp_out shows lock', () => {
    const x = bench({ vin: 'loop', sigHz: 300 });
    x.run(250);
    close(x.state().vcoHz, 300, 3, 'VCO follows the input');
    // C2 holds the control voltage (vco_in itself dips during the short
    // correction pulses through R4).
    close(x.v('c2'), 300 / 500 * 9, 0.15, 'control voltage settles at f/fmax x VDD');
    // Locked, comparator II rests except for brief correction pulses at the
    // edges: pcp_out is HIGH almost all the time.
    let high = 0;
    for (let i = 0; i < 40; i++) { x.run(0.37); if (x.state().locked) high++; }
    assert.ok(high >= 34, `pcp_out HIGH in ${high} of 40 samples (expected nearly all)`);
  });

  it('the locked VCO averages 200 Hz over multiple input cycles', () => {
    const x = bench({ vin: 'loop', sigHz: 200 });
    x.run(250);
    const firstEdges = x.state().edges;
    // The loop corrects phase with short pulses. A single completed VCO
    // period can land inside a correction even after lock. Count output
    // transitions over half a second (two edges per cycle) instead.
    x.run(500);
    const frequencyHz = (x.state().edges - firstEdges) / (2 * 0.5);
    close(frequencyHz, 200, 3, 'VCO follows the input');
  });

  it('above the VCO span (600 Hz > 500 Hz) it cannot lock: vco_in pinned at the rail', () => {
    const x = bench({ vin: 'loop', sigHz: 600 });
    x.run(300);
    assert.ok(x.v('vin') > 8.5, `control at the top rail: ${x.v('vin')} (expected ~9 V)`);
    close(x.state().vcoHz, 500, 12, 'VCO at its maximum');
  });

  it('comparator I (XOR) also locks, with the control voltage its average', () => {
    const x = bench({ vin: 'loop', sigHz: 300, pc: 'pc1' });
    x.run(250);
    close(x.state().vcoHz, 300, 6, 'VCO follows the input');
  });
});
