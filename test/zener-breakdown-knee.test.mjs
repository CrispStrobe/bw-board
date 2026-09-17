/**
 * A ZENER'S BREAKDOWN IS AN EXPONENTIAL THROUGH (BV, IBV), NOT A CORNER.
 *
 * SPICE's diode model takes BV **and IBV**, and those two numbers together pin
 * one point on an exponential: ngspice places the junction so the current is
 * exactly IBV when |Vj| = BV. Inverted — the form that needs no solver —
 *
 *     |V| = BV + nVt*ln(I/IBV) + I*RS
 *
 * Measured against ngspice over the whole breakdown region of the ADI2005 card
 * `D(BV=3.3 IBV=5m RS=5)`, five decades of current from 2.2 µA to 162 mA:
 * **worst voltage error 0.186 mV**.
 *
 * WHAT THE PIECEWISE MODEL COST. `1/rz` from a corner at vz is a straight line
 * through (vz, 0), so it reads vz + I·rz however far below the knee the current
 * sits. On ADI2005 v2's zener regulator — 7.4 V through 8.2 kΩ into that card,
 * about 0.5 mA — that is 3.302498 V against ngspice's 3.243334 V. The corpus
 * reported it as 5.92e-2 V on **12 decks**, and four more sit in the gallery.
 * The exponential is BELOW BV at currents below IBV, which is the whole of it.
 *
 * THE DEFAULT IS UNCHANGED. A card stating no IBV keeps the piecewise corner,
 * which is what 2,163 corpus circuits and this suite are written against — the
 * shipped 1N4733A card states `vz` and no knee current, so nothing in the
 * gallery moves. The identity test below is what says so.
 *
 * THE RESIDUAL IS THERMAL, NOT MODEL. 0.033 mV remains at every RS, and it is
 * constant: our fixed thermal voltage is 0.025852 V (26.83 °C) where ngspice's
 * default is 27 °C. That offset is a named evidence class in the oracle harness
 * rather than an error in this model, which is why the tolerances below are
 * 0.2 mV and not 1 µV.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { zenerBreakdown, JUNCTION_THERMAL_VOLTAGE, JUNCTION_GMIN } from '../src/mna.js';

registerAllDevices();

/** The ADI2005 regulator: 7.4 V through 8.2 kΩ into one zener. */
function regulator(params) {
  const b = new BoardImpl(5);
  b.setNetlist([
    { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'V1', kind: 'vsource', params: { volts: 7.4 }, terminals: ['pos', 'neg'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 8200 }, terminals: ['a', 'b'] },
    { id: 'DZ1', kind: 'zener', params, terminals: ['anode', 'cathode'] },
  ], [
    { id: 'n_in', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
    { id: 'n_out', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'DZ1', terminal: 'cathode' }] },
    { id: 'n_0', terminals: [
      { part: 'GND1', terminal: 'gnd' }, { part: 'V1', terminal: 'neg' },
      { part: 'DZ1', terminal: 'anode' },
    ] },
  ]);
  return {
    v: b.nodeVoltage('n_out'),
    i: b.branchCurrent('DZ1', 'cathode'),
    converged: b._lastSolveConverged,
  };
}

/** ngspice's `.op` on that deck, one RS per row. */
const NGSPICE_BY_RS = [[0, 3.240815], [2, 3.241823], [5, 3.243334], [20, 3.250873], [50, 3.266091]];

test('the knee current puts the regulator where ngspice puts it', () => {
  const r = regulator({ vz: 3.3, ibv: 5e-3, rs: 5 });
  assert.equal(r.converged, true, 'the solve did not converge, so nothing here is a reading');
  assert.ok(Math.abs(r.v - 3.243334) < 2e-4,
    `V(OUT) ${r.v} against ngspice 3.243334`);
  // And the gap it closes is real: the piecewise model is 59 mV away.
  const piecewise = regulator({ vz: 3.3, rz: 5 }).v;
  assert.ok(Math.abs(piecewise - 3.243334) > 5e-2,
    `the piecewise model must be far off, was ${piecewise}`);
});

test('the series resistance is the card RS, at every value ngspice was run at', () => {
  // `rz` and `rs` are different quantities that happen to share a default of
  // 5 Ω, so reading the wrong one matched ngspice BY COINCIDENCE on exactly the
  // deck that motivated this work. These five rows are what separate them.
  for (const [rs, expected] of NGSPICE_BY_RS) {
    const r = regulator({ vz: 3.3, ibv: 5e-3, rs });
    assert.equal(r.converged, true, `RS=${rs} did not converge`);
    assert.ok(Math.abs(r.v - expected) < 2.5e-4,
      `RS=${rs}: V(OUT) ${r.v.toFixed(6)} against ngspice ${expected}`);
  }
});

test('a card stating no IBV keeps the piecewise corner exactly', () => {
  // THE IDENTITY TEST, and the shipped 1N4733A card is this case: `vz` and no
  // knee current. A straight line through (vz, 0) reads vz + I*rz, and at
  // (7.4 - 3.3)/8200 = 0.5 mA through 5 Ω that is 3.3025 V.
  const r = regulator({ vz: 3.3, rz: 5 });
  assert.equal(r.converged, true);
  assert.ok(Math.abs(r.v - 3.302498) < 1e-6, `V(OUT) ${r.v}, expected the piecewise 3.302498`);
  // A zero or negative knee current means "no knee stated", not a division.
  for (const ibv of [0, -1e-3]) {
    assert.ok(Math.abs(regulator({ vz: 3.3, rz: 5, ibv }).v - 3.302498) < 1e-6,
      `ibv=${ibv} must behave as absent`);
  }
});

test('the branch current agrees with the node voltage', () => {
  // The stamp and the branch-current reader are twins with separate copies of
  // the region logic, and a node voltage that agrees while the current does not
  // is the exact signature of one moving without the other.
  const r = regulator({ vz: 3.3, ibv: 5e-3, rs: 5 });
  // The zener carries the whole resistor current at this bias.
  const throughR = (7.4 - r.v) / 8200;
  assert.ok(Math.abs(Math.abs(r.i) - throughR) < throughR * 1e-6,
    `zener current ${r.i} against the resistor's ${throughR}`);
  // ngspice's own current for this deck, from the same .op.
  assert.ok(Math.abs(Math.abs(r.i) - 5.0691e-4) < 5.0691e-4 * 1e-3, `${r.i}`);
});

test('the exponential is continuous into the off region', () => {
  // There is no corner to cross: at a reverse bias well below BV the
  // exponential is e^(-BV/nVt) of IBV, indistinguishable from the off region it
  // replaces. A model with a region TEST there would show a step.
  const b = (volts) => {
    const board = new BoardImpl(5);
    board.setNetlist([
      { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'V1', kind: 'vsource', params: { volts }, terminals: ['pos', 'neg'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'DZ1', kind: 'zener', params: { vz: 3.3, ibv: 5e-3, rs: 5 }, terminals: ['anode', 'cathode'] },
    ], [
      { id: 'n_in', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
      { id: 'n_out', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'DZ1', terminal: 'cathode' }] },
      { id: 'n_0', terminals: [
        { part: 'GND1', terminal: 'gnd' }, { part: 'V1', terminal: 'neg' },
        { part: 'DZ1', terminal: 'anode' },
      ] },
    ]);
    return { v: board.nodeVoltage('n_out'), converged: board._lastSolveConverged };
  };
  // Well below breakdown the zener is effectively an open, so the node follows
  // the source through the resistor.
  for (const volts of [0.5, 1, 2]) {
    const r = b(volts);
    assert.equal(r.converged, true, `${volts} V did not converge`);
    assert.ok(Math.abs(r.v - volts) < 1e-3, `at ${volts} V the node reads ${r.v}, expected ~${volts}`);
  }
});

test('the stamped conductance is the derivative of the stamped current', () => {
  // THE ONLY INSTRUMENT THAT CAN SEE THIS. The conductance enters the Newton
  // matrix alone: `iEq = i(V0) - g*V0` makes the branch carry exactly `i(V0)`
  // at convergence for any `g`, so a wrong slope costs iterations and not
  // accuracy. A mutation dropping RS from `1/(nVt/I + RS)` passed every voltage
  // assertion above, and only this test reds on it.
  const nVt = JUNCTION_THERMAL_VOLTAGE;
  const h = 1e-7;
  for (const [bv, ibv, rs] of [[3.3, 5e-3, 5], [3.3, 5e-3, 0], [5.1, 1e-3, 20], [12, 250e-6, 2]]) {
    for (const vRev of [bv - 0.2, bv - 0.05, bv, bv + 0.1, bv + 0.4]) {
      const [, g] = zenerBreakdown(vRev, bv, ibv, rs, nVt);
      const up = zenerBreakdown(vRev + h, bv, ibv, rs, nVt)[0];
      const down = zenerBreakdown(vRev - h, bv, ibv, rs, nVt)[0];
      const fd = (up - down) / (2 * h);
      assert.ok(Math.abs(g - fd) <= Math.abs(fd) * 1e-4 + 1e-15,
        `BV=${bv} IBV=${ibv} RS=${rs} at |V|=${vRev.toFixed(2)}: `
        + `stamped ${g.toExponential(6)}, finite difference ${fd.toExponential(6)}`);
    }
  }
});

test('GMIN holds the floor a volt into the off region', () => {
  // The separate case JUNCTION_GMIN is there for, and the bias points above
  // cannot see it: at any current near the knee the exponential's own
  // conductance is orders above 1e-12, so a mutation deleting GMIN passes all
  // of them. A volt below breakdown the current is ~1e-19 A and its slope
  // ~1e-18 S, so GMIN is the only thing keeping a node that has nothing else on
  // it tied to the reference -- which is the claim the code makes there.
  const [i, g] = zenerBreakdown(3.3 - 1.0, 3.3, 5e-3, 5, JUNCTION_THERMAL_VOLTAGE);
  assert.ok(i < 1e-15, `a volt into the off region must carry ~nothing: ${i.toExponential(3)}`);
  // The breakdown's OWN slope down here is ~1e-18, far under GMIN. GMIN is not
  // in this return value -- it is added in the stamp, as a parallel
  // conductance, because putting it in the slope cancels out of the Norton
  // source term for term and holds nothing. See zenerBreakdown's note.
  assert.ok(g < JUNCTION_GMIN,
    `the breakdown slope alone must be below GMIN here, was ${g.toExponential(6)}`);
});

test('the solve holds across five decades of knee current and breakdown voltage', () => {
  // The inversion is Newton in LOG space precisely so it converges at any
  // current; a linear Newton on I overshoots into the negative down here.
  for (const [bv, ibv, rs] of [[3.3, 5e-3, 5], [5.1, 1e-3, 20], [12, 250e-6, 2], [200, 5e-6, 0]]) {
    for (const decade of [-4, -3, -2, -1, 0, 1]) {
      const target = ibv * 10 ** decade;
      const vRev = bv + JUNCTION_THERMAL_VOLTAGE * Math.log(target / ibv) + target * rs;
      const [i] = zenerBreakdown(vRev, bv, ibv, rs, JUNCTION_THERMAL_VOLTAGE);
      assert.ok(Math.abs(i - target) <= target * 1e-6,
        `BV=${bv} IBV=${ibv} RS=${rs}, target ${target.toExponential(2)} A: solved ${i.toExponential(6)}`);
    }
  }
});
