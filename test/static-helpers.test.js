/**
 * Static helper method tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('BoardImpl.getTerminalsForKind', () => {
  it('resistor → [a, b]', () => {
    assert.deepEqual(BoardImpl.getTerminalsForKind('resistor'), ['a', 'b']);
  });

  it('led → [anode, cathode]', () => {
    assert.deepEqual(BoardImpl.getTerminalsForKind('led'), ['anode', 'cathode']);
  });

  it('npn → [base, collector, emitter]', () => {
    assert.deepEqual(BoardImpl.getTerminalsForKind('npn'), ['base', 'collector', 'emitter']);
  });

  it('potentiometer → [a, b, wiper]', () => {
    assert.deepEqual(BoardImpl.getTerminalsForKind('potentiometer'), ['a', 'b', 'wiper']);
  });

  it('mcu → null (dynamic terminals)', () => {
    assert.equal(BoardImpl.getTerminalsForKind('mcu'), null);
  });

  it('unknown → null', () => {
    assert.equal(BoardImpl.getTerminalsForKind('transformer'), null);
  });
});

describe('BoardImpl.getPartKinds', () => {
  it('returns all 19 kinds', () => {
    const kinds = BoardImpl.getPartKinds();
    assert.ok(kinds.length >= 19);
    assert.ok(kinds.includes('resistor'));
    assert.ok(kinds.includes('led'));
    assert.ok(kinds.includes('npn'));
    assert.ok(kinds.includes('mcu'));
    assert.ok(kinds.includes('seven_segment'));
  });
});
