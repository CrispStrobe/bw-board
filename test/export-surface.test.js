/**
 * Module export surface tests: verify every public export exists and
 * has the expected type. Catches accidental renames or removals.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as mod from '../src/index.js';

describe('module exports', () => {
  it('BoardImpl is a constructor', () => {
    assert.equal(typeof mod.BoardImpl, 'function');
    const b = new mod.BoardImpl(5.0);
    assert.ok(b);
  });

  it('pinThevenin is a function', () => {
    assert.equal(typeof mod.pinThevenin, 'function');
    const t = mod.pinThevenin('quasi', false, 5.0);
    assert.notEqual(t, 'high-z');
    assert.equal(t.vTh, 0);
  });

  it('R_STRONG and R_QUASI_PULLUP are numbers', () => {
    assert.equal(typeof mod.R_STRONG, 'number');
    assert.equal(typeof mod.R_QUASI_PULLUP, 'number');
    assert.equal(mod.R_STRONG, 25);
    assert.equal(mod.R_QUASI_PULLUP, 21700);
  });

  it('solveMNA is a function', () => {
    assert.equal(typeof mod.solveMNA, 'function');
  });

  it('inferNetlist is a function', () => {
    assert.equal(typeof mod.inferNetlist, 'function');
    const result = mod.inferNetlist({ pins: [] });
    assert.ok(result.parts);
    assert.ok(result.nets);
    assert.ok(result.notes);
  });

  it('checkWiring is a function', () => {
    assert.equal(typeof mod.checkWiring, 'function');
  });

  it('runTrace is a function', () => {
    assert.equal(typeof mod.runTrace, 'function');
  });

  it('runConformance is a function', () => {
    assert.equal(typeof mod.runConformance, 'function');
  });

  it('formatReport is a function', () => {
    assert.equal(typeof mod.formatReport, 'function');
  });

  it('createEmu8051Adapter is a function', () => {
    assert.equal(typeof mod.createEmu8051Adapter, 'function');
  });

  it('formatPollingLossReport is a function', () => {
    assert.equal(typeof mod.formatPollingLossReport, 'function');
  });

  it('validateNetlist is a function', () => {
    assert.equal(typeof mod.validateNetlist, 'function');
  });

  it('assertValidNetlist is a function', () => {
    assert.equal(typeof mod.assertValidNetlist, 'function');
  });
});

describe('BoardImpl method surface', () => {
  const board = new BoardImpl(5.0);

  const expectedMethods = [
    // Boundary A
    'setPin', 'advanceTo', 'readPin', 'readAnalog',
    // Boundary B
    'setNetlist', 'nodeVoltage', 'branchCurrent', 'resistance',
    'ledBrightness', 'sevenSegmentBrightness', 'rgbLedBrightness',
    'buzzerTone', 'setControl', 'setPower',
    // State getters
    'getTime', 'isPowered', 'getVcc', 'getPinState', 'getControl', 'getCapVoltage',
    // Part queries
    'getParts', 'getNets', 'getLeds', 'getBuzzers', 'getControls', 'getPinStates',
    // Lifecycle
    'onChange', 'offChange', 'getWarnings', 'reset', 'snapshot', 'restore',
    // New getters
    'getInductorCurrent', 'getRenderState',
  ];

  for (const method of expectedMethods) {
    it(`has method: ${method}`, () => {
      assert.equal(typeof board[method], 'function', `${method} should be a function`);
    });
  }
});
