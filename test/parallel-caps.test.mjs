// Six decoupling capacitors across one rail pair — every real bus board.
// As ideal stored-voltage sources they were six identical branch rows:
// singular matrix, silent bail, 0 V everywhere. As ESR companions the
// bench solves and the rail stands.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('parallel rail capacitors', () => {
  it('six caps across the rails leave the rail at VCC', () => {
    const parts = [
      { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'r1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      ...Array.from({ length: 6 }, (_, i) => (
        { id: `c${i}`, kind: 'capacitor', params: { farads: 1e-7 }, terminals: ['a', 'b'] })),
      // The diode forces the MNA path — the singularity under test lives in
      // solveMNA's cap-as-source rows, which the walker never reaches.
      { id: 'd1', kind: 'diode', params: {}, terminals: ['anode', 'cathode'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 'r1', terminal: 'a' },
        ...Array.from({ length: 6 }, (_, i) => ({ part: `c${i}`, terminal: 'a' }))] },
      { id: 'ng', terminals: [{ part: 'g1', terminal: 'gnd' }, { part: 'r1', terminal: 'b' },
        ...Array.from({ length: 6 }, (_, i) => ({ part: `c${i}`, terminal: 'b' }))] },
      { id: 'nd1', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 'd1', terminal: 'anode' }] },
      { id: 'nd2', terminals: [{ part: 'g1', terminal: 'gnd' }, { part: 'd1', terminal: 'cathode' }] },
    ];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    b.setPower(true);
    // At the instant of power-on a discharged ideal cap across an ideal
    // rail is a genuine contradiction (infinite inrush); the transient
    // resolves it. What the singularity bug did instead was kill the
    // bench FOREVER — so the claim under test is recovery, not t=0.
    let t = 0n;
    for (let i = 0; i < 50; i++) { t += 1_000_000n; b.advanceTo(t); }
    const vAfter = b.nodeVoltage('nv');
    assert.ok(vAfter > 4.5, `rail at VCC once caps charged, got ${vAfter}`);
  });

  it('duplicate net ids are rejected, never silently singular', () => {
    const parts = [
      { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'r1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'r2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'dup', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 'r1', terminal: 'a' }] },
      { id: 'dup', terminals: [{ part: 'r2', terminal: 'a' }] },
    ];
    const b = new BoardImpl(5.0);
    assert.throws(() => b.setNetlist(parts, nets), /Duplicate net id/);
  });
});
