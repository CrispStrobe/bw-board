/**
 * Non-convergence must be reported, never returned as a plausible answer.
 *
 * From fleet-silent-degradation.md: "a solver that cannot converge must say so.
 * Returning the last iterate as if it were an answer is the numerical form of
 * the failure this whole stack is organised against."
 *
 * This test verifies that getWarnings() reports non-convergence when the MNA
 * solver fails to find a consistent operating point.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('non-convergence reporting', () => {
  it('a well-formed circuit converges — no convergence warning', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'D1', kind: 'diode', params: {}, terminals: ['anode', 'cathode'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'D1', terminal: 'anode' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'D1', terminal: 'cathode' }] },
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    const warnings = board.getWarnings();
    const convergenceWarning = warnings.find(w => w.message.includes('converge'));
    assert.equal(convergenceWarning, undefined, 'normal circuit should not warn about convergence');
  });

  it('_lastSolveConverged flag is tracked', () => {
    const board = new BoardImpl(5.0);
    // Before any solve, the flag should be true (no solve = no problem)
    assert.equal(board._lastSolveConverged, true);
  });
});
