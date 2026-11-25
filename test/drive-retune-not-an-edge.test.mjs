/**
 * A logic output that only FOLLOWS ITS SUPPLY is not an edge.
 *
 * A gate drives its output to the voltage it reads on its own vcc pin, so on
 * a supply that moves (a battery's internal resistance under a changing
 * load) its drive level changes on every accepted step -- often only in the
 * last bit (9 vs 9.000000000000002). The integrator treated every such
 * update as a device flip: trapezoidal history restarted, a backward-Euler
 * seed, the step cut to a quarter. A Schmitt NAND window beside an LM386
 * blinker (whose current moves the rail) spent ~1,000 attempts per 100 us of
 * a circuit in which nothing switched, and exhausted the step budget.
 *
 * A device update counts as a discontinuity when its discrete state changes
 * or a drive changes by more than the integrator's own tolerance
 * (absoluteVoltage + relativeTolerance x level); a drive that merely tracks a
 * moving rail is restamped without restarting the history.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });
const Cap = (id, farads) => ({ id, kind: 'capacitor', params: { farads }, terminals: ['a', 'b'] });
const G4093 = ['1a', '1b', '1y', '2a', '2b', '2y', 'gnd', '3y', '3a', '3b', '4y', '4a', '4b', 'vcc'];

/** A CD4093 whose gates hold steady on a 9 V supply behind `rSupply`, while
 * an RC from the same rail draws a slowly falling current. */
function bench(rSupply) {
  const b = new BoardImpl(9);
  b.setNetlist([
    { id: 'V', kind: 'vsource', params: { volts: 9 }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    R('RS', rSupply), R('RL', 100), Cap('CL', 100e-6),
    { id: 'U', kind: 'cd4093', params: {}, terminals: G4093 },
    R('RO', 1000), { id: 'D', kind: 'led', params: { color: 'green' }, terminals: ['anode', 'cathode'] },
  ], [
    net('src', ['V', 'pos'], ['RS', 'a']),
    net('rail', ['RS', 'b'], ['U', 'vcc'], ['U', '1a'], ['U', '1b'], ['RL', 'a']),
    net('rc', ['RL', 'b'], ['CL', 'a']),
    net('y1', ['U', '1y'], ['U', '2a'], ['U', '2b']),
    net('y2', ['U', '2y'], ['RO', 'a']),
    net('led', ['RO', 'b'], ['D', 'anode']),
    net('g', ['G', 'gnd'], ['V', 'neg'], ['CL', 'b'], ['U', 'gnd'], ['D', 'cathode'],
      ['U', '3a'], ['U', '3b'], ['U', '4a'], ['U', '4b']),
  ]);
  b.setPower(true);
  return b;
}

describe('a drive that only tracks its moving supply is not a device edge', () => {
  it('a NAND pair on a sagging 9 V rail: no restarts, few steps', () => {
    const b = bench(2);
    b.advanceTo(1_000_000n);
    const before = b.transientAnalysisStatus().work.attempts;
    for (let k = 2; k <= 30; k++) b.advanceTo(BigInt(k) * 1_000_000n);
    const st = b.transientAnalysisStatus();
    assert.equal(st.failure, null);
    const attempts = st.work.attempts - before;
    // The rail moves by millivolts as CL charges (tau 10 ms): the gates' output
    // levels follow it, nothing switches.
    assert.ok(b.nodeVoltage('rail') > 8.8 && b.nodeVoltage('rail') < 9, `rail ${b.nodeVoltage('rail')}`);
    assert.ok(b.nodeVoltage('y2') > 8, `inverter output high: ${b.nodeVoltage('y2')}`);
    assert.ok(attempts < 400, `${attempts} attempts for 29 ms with nothing switching`);
  });

  it('a real edge still restarts: the gate output switches when its input does', () => {
    const b = bench(2);
    b.advanceTo(2_000_000n);
    assert.ok(b.nodeVoltage('y1') < 0.5, 'NAND of two highs is low');
  });
});
