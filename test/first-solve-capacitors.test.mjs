/**
 * The first solve's capacitor semantics — defect D23.
 *
 * `docs/WAVE-OPEN-DEFECTS.md` D23: "the first solve of a fresh board is a
 * DC operating point, in which a capacitor is an open circuit — so the
 * meter reads 5.0000 V on a capacitor the engine's own `getCapVoltage`
 * holds at 0". Reproduced on `43-rc-timing` through the app's own
 * `Circuit.fromJSON`.
 *
 * The cause was not that the operating point is a DC one. The MNA path has
 * always stamped a capacitor as a voltage source at its stored value, and
 * answered ~0 V on that bench. It was the CLOSED-FORM WALKER — which has no
 * capacitor in its vocabulary, so it solves the network as if the part were
 * absent (the t = ∞ answer) and then overrides the cap's node. That override
 * skipped any capacitor with no entry in `capVoltages`, and the designer
 * produces exactly such a board on every edit: `Circuit._syncNetlist`
 * snapshots, rebuilds, and restores, so a capacitor added since the snapshot
 * came back unseeded.
 *
 * The semantics now: **the operating point honours stored capacitor state,
 * and an unseeded capacitor is uncharged — except where an ideal source pins
 * both plates, in which case the network wins and the capacitor charges in
 * τ = 0.** Both halves are what the MNA path already answered, and the
 * second is the rule `_integrateCapacitors` already applied at every LATER
 * step.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

const VCC = { id: 'vcc1', kind: 'vcc', params: {}, terminals: ['vcc'] };
const GND = { id: 'gnd1', kind: 'gnd', params: {}, terminals: ['gnd'] };
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });
const C = (id, farads) => ({ id, kind: 'capacitor', params: { farads }, terminals: ['a', 'b'] });
const MS = 1000n * 1000n;

/** `43-rc-timing`'s topology: 10 kΩ from the rail into a 100 µF to ground,
 *  plus its discharge switch. τ = 1 s. */
function rcTiming() {
  const board = new BoardImpl(5.0);
  board.setNetlist(
    [VCC, GND, R('r1', 10000), C('c1', 0.0001),
      { id: 'sw_discharge', kind: 'switch', params: {}, terminals: ['a', 'b'] },
      R('r_discharge', 1000)],
    [net('n_cap', ['c1', 'a'], ['r1', 'b'], ['sw_discharge', 'a']),
      net('n_gnd', ['c1', 'b'], ['gnd1', 'gnd'], ['r_discharge', 'b']),
      net('n_rail', ['r1', 'a'], ['vcc1', 'vcc']),
      net('n_sw', ['r_discharge', 'a'], ['sw_discharge', 'b'])]);
  return board;
}

describe('D23: the first solve agrees with getCapVoltage', () => {
  it('a fresh RC bench reads 0 V on an uncharged capacitor, not the supply', () => {
    const board = rcTiming();
    assert.equal(board.getCapVoltage('c1'), 0);
    assert.equal(board.nodeVoltage('n_cap'), 0,
      'the open-circuit operating point (5 V) is the t = ∞ answer, not the t = 0 one');
    assert.equal(board.nodeVoltage('n_rail'), 5, 'and the rail is still the rail');
  });

  it('survives the designer\'s edit path: rebuild + restore a stale snapshot', () => {
    // What `Circuit._syncNetlist` does on every edit — snapshot the OLD
    // board (which had no capacitor yet), rebuild, restore. This is the
    // exact sequence that produced the 5.0000 V reading in the app while
    // a hand-built board read 0.
    const before = new BoardImpl(5.0);
    before.setNetlist([VCC, GND],
      [net('n_rail', ['vcc1', 'vcc']), net('n_gnd', ['gnd1', 'gnd'])]);
    const stale = before.snapshot();
    assert.equal(stale.capVoltages.size, 0, 'the snapshot predates the capacitor');

    const board = rcTiming();
    board.restore(stale);
    assert.equal(board.getCapVoltage('c1'), 0, 'a part the snapshot never saw starts at rest');
    assert.equal(board.nodeVoltage('n_cap'), 0);
  });

  it('the walker and the MNA path answer the same operating point', () => {
    // Same topology, but a `vsource` instead of the `vcc` symbol routes the
    // solve through MNA (MNA_ONLY_KINDS). The two engines inside this one
    // engine must not disagree about t = 0.
    const mna = new BoardImpl(5.0);
    mna.setNetlist(
      [GND, { id: 'v1', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
        R('r1', 10000), C('c1', 0.0001)],
      [net('n_rail', ['v1', 'pos'], ['r1', 'a']),
        net('n_cap', ['r1', 'b'], ['c1', 'a']),
        net('n_gnd', ['gnd1', 'gnd'], ['v1', 'neg'], ['c1', 'b'])]);
    assert.ok(Math.abs(mna.nodeVoltage('n_cap')) < 1e-6,
      `MNA says ${mna.nodeVoltage('n_cap')}`);
    assert.ok(Math.abs(rcTiming().nodeVoltage('n_cap') - mna.nodeVoltage('n_cap')) < 1e-6,
      'walker and MNA must agree');
  });

  it('a decoupling capacitor no longer pulls the rail it decouples to 0 V', () => {
    // The same defect, the other way round and worse: an ideal source on
    // BOTH plates means τ = RC = 0, so the capacitor takes the rail's
    // voltage — it does not impose its own on the rail. The old blind
    // override set the VCC NET to the cap's 0 V while every net resolved
    // from that rail kept 5 V.
    const board = new BoardImpl(5.0);
    board.setNetlist([VCC, GND, C('c1', 1e-7), R('r1', 1000)],
      [net('n_rail', ['vcc1', 'vcc'], ['c1', 'a'], ['r1', 'a']),
        net('n_gnd', ['gnd1', 'gnd'], ['c1', 'b'], ['r1', 'b'])]);
    assert.equal(board.nodeVoltage('n_rail'), 5);
    assert.equal(board.getCapVoltage('c1'), 5, 'charged in τ = 0, as _integrateCapacitors says');
  });

  it('the charging law is untouched — 5(1 − e^(−t/τ)) at τ = 1 s', () => {
    // The numbers lite's Wave 6 gate pins on this bench, to four decimals:
    // 1.9673, 3.1606, 4.3233, 4.7511. They are the closed form, and this
    // fix must not have moved them.
    const board = rcTiming();
    for (const [ms, tau] of [[500, 0.5], [1000, 1], [2000, 2], [3000, 3]]) {
      board.advanceTo(BigInt(ms) * MS);
      const expected = 5 * (1 - Math.exp(-tau));
      assert.ok(Math.abs(board.nodeVoltage('n_cap') - expected) < 1e-3,
        `at ${ms} ms: ${expected.toFixed(4)} V, got ${board.nodeVoltage('n_cap').toFixed(4)}`);
    }
  });

  it('hidden reactive parts keep the seed setNetlist gives them', () => {
    // The seeding pass ran BEFORE `capVoltages.clear()`, so it was undone
    // every time and only the public parts were re-seeded afterwards. A
    // macromodel op-amp's internal pole capacitor is hidden, and the
    // fea58ed commit that added the seeding said in its own message why it
    // is needed: an unseeded macro cap lets the DC solve teleport the
    // output past the slew limit.
    const board = new BoardImpl(5.0);
    board.setNetlist([GND,
      { id: 'FG', kind: 'vsource', params: { volts: 2.5 }, terminals: ['pos', 'neg'] },
      { id: 'U1', kind: 'opamp', params: { model: 'macro', railLow: -10, railHigh: 10 },
        terminals: ['inp', 'inn', 'out'] },
      R('RL', 10000)],
    [net('n_in', ['FG', 'pos'], ['U1', 'inp']),
      net('n_out', ['U1', 'out'], ['U1', 'inn'], ['RL', 'a']),
      net('n_gnd', ['gnd1', 'gnd'], ['FG', 'neg'], ['RL', 'b'])]);
    assert.ok(board.capVoltages.has('U1_c1'),
      `the macro pole capacitor must be seeded; have ${[...board.capVoltages.keys()]}`);
    assert.equal(board.capVoltages.get('U1_c1'), 0);
  });

  it('two identical fresh boards agree bit-for-bit', () => {
    assert.equal(rcTiming().nodeVoltage('n_cap'), rcTiming().nodeVoltage('n_cap'));
  });
});
