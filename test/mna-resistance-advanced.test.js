/**
 * Advanced resistance measurement tests — topology variations.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('resistance: various topologies', () => {
  it('single resistor', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'R1', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [
        { id: 'na', terminals: [{ part: 'R1', terminal: 'a' }] },
        { id: 'nb', terminals: [{ part: 'R1', terminal: 'b' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    board.setPower(false);
    const r = board.resistance('na', 'nb');
    assert.ok(Math.abs(/** @type {number} */(r) - 4700) < 10, `R=${r} ≈ 4700`);
  });

  it('two in series: 2.2k + 3.3k = 5.5k', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'R1', kind: 'resistor', params: { ohms: 2200 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 3300 }, terminals: ['a', 'b'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [
        { id: 'na', terminals: [{ part: 'R1', terminal: 'a' }] },
        { id: 'nm', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'R2', terminal: 'a' }] },
        { id: 'nb', terminals: [{ part: 'R2', terminal: 'b' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    board.setPower(false);
    const r = board.resistance('na', 'nb');
    assert.ok(Math.abs(/** @type {number} */(r) - 5500) < 20, `R=${r} ≈ 5500`);
  });

  it('two in parallel: 2k ∥ 3k = 1200', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'R1', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 3000 }, terminals: ['a', 'b'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [
        { id: 'na', terminals: [{ part: 'R1', terminal: 'a' }, { part: 'R2', terminal: 'a' }] },
        { id: 'nb', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'R2', terminal: 'b' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    board.setPower(false);
    const r = board.resistance('na', 'nb');
    assert.ok(Math.abs(/** @type {number} */(r) - 1200) < 10, `R=${r} ≈ 1200`);
  });

  it('pi network: 1k shunt, 2k series, 3k shunt', () => {
    // From A to B through 2k, with 1k from A to ground and 3k from B to ground
    // But power is off, so "ground" is just another net.
    // With testNodeB as reference: the 3k shunt is to a floating net.
    // Effective: 2kΩ series (since shunts go to floating nodes).
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
        { id: 'R3', kind: 'resistor', params: { ohms: 3000 }, terminals: ['a', 'b'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [
        { id: 'na', terminals: [
          { part: 'R1', terminal: 'a' },
          { part: 'R2', terminal: 'a' },
        ]},
        { id: 'nb', terminals: [
          { part: 'R2', terminal: 'b' },
          { part: 'R3', terminal: 'a' },
        ]},
        { id: 'ng1', terminals: [{ part: 'R1', terminal: 'b' }] },
        { id: 'ng2', terminals: [{ part: 'R3', terminal: 'b' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    board.setPower(false);

    // ng1 and ng2 are floating (not connected to testNodeB=nb).
    // So R1 and R3 are open-circuited. R_measured = R2 = 2000Ω.
    // But wait — ng1 is connected only to R1.b. Since it's floating, R1
    // still provides a path from na to ng1, but ng1 has no path to nb.
    // The MNA handles this: R1 conductance is stamped but ng1 is isolated
    // from nb (the reference). So effectively R1 is a dead end.
    // R_measured = R2 = 2000Ω.
    const r = board.resistance('na', 'nb');
    assert.ok(Math.abs(/** @type {number} */(r) - 2000) < 20, `pi network R=${r} ≈ 2000`);
  });

  it('bridge with meter across the bridge — measures Thevenin R', () => {
    // Wheatstone bridge: R1=1k, R2=1k, R3=1k, R4=2k
    // Meter across the bridge: nodes A and B
    // R_thevenin = (R1∥R3) + (R2∥R4) = 500 + 666.67 = 1166.67Ω
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R3', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R4', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [
        { id: 'ntop', terminals: [{ part: 'R1', terminal: 'a' }, { part: 'R2', terminal: 'a' }] },
        { id: 'nA', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'R3', terminal: 'a' }] },
        { id: 'nB', terminals: [{ part: 'R2', terminal: 'b' }, { part: 'R4', terminal: 'a' }] },
        { id: 'nbot', terminals: [{ part: 'R3', terminal: 'b' }, { part: 'R4', terminal: 'b' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    board.setPower(false);

    // With nB as reference (ground), inject current at nA.
    // The circuit from nA: R1 to ntop, R3 to nbot. From ntop: R2 to nB.
    // From nbot: R4 to nB.
    // R1 in series with R2: 1k+1k=2k (path through top)
    // R3 in series with R4: 1k+2k=3k (path through bottom)
    // 2k ∥ 3k = 1200Ω
    const r = board.resistance('nA', 'nB');
    assert.ok(Math.abs(/** @type {number} */(r) - 1200) < 20,
      `bridge Thevenin R=${r} ≈ 1200Ω`);
  });
});

describe('resistance: requires-power-off guard', () => {
  it('returns string when powered, number when off', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [
        { id: 'na', terminals: [{ part: 'R1', terminal: 'a' }] },
        { id: 'nb', terminals: [{ part: 'R1', terminal: 'b' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );

    // Powered: string
    const rPowered = board.resistance('na', 'nb');
    assert.equal(rPowered, 'requires-power-off');
    assert.equal(typeof rPowered, 'string');

    // Off: number
    board.setPower(false);
    const rOff = board.resistance('na', 'nb');
    assert.equal(typeof rOff, 'number');
    assert.ok(/** @type {number} */(rOff) > 900);
  });
});
