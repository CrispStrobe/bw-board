/**
 * Conformance kit edge cases: partial implementations, adapters that
 * almost-but-not-quite satisfy the contract.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runConformance, formatReport } from '../src/conformance.js';

describe('conformance: adapter that uses cycles not nanoseconds', () => {
  it('detects Number instead of bigint in advanceTo', () => {
    const adapter = {
      reset() {},
      setFosc() {},
      attachBoard(b) { this._board = b; },
      writePort(port, val) {
        if (this._board) {
          for (let i = 0; i < 8; i++) {
            this._board.setPin(`P${port}.${i}`, 'quasi', !!((val >> i) & 1));
          }
        }
      },
      setPortMode(port, m1, m0) {
        if (this._board) {
          for (let i = 0; i < 8; i++) {
            const mode = ['quasi', 'pushpull', 'input', 'opendrain'][((m1 >> i) & 1) << 1 | ((m0 >> i) & 1)];
            this._board.setPin(`P${port}.${i}`, mode, true);
          }
        }
      },
      readPort() { return 0xFF; },
      runNs(ns) {
        // BUG: sends Number, not bigint
        if (this._board) this._board.advanceTo(ns);
      },
    };

    const results = runConformance(adapter);
    const nsTest = results.find(r => r.name.includes('nanoseconds'));
    assert.ok(nsTest, 'should have nanoseconds test');
    assert.equal(nsTest.pass, false, 'Number should fail the bigint check');
    assert.ok(nsTest.detail.includes('bigint'), `detail should mention bigint: ${nsTest.detail}`);
  });
});

describe('conformance: adapter missing mode distinction', () => {
  it('detects adapter that always says "quasi"', () => {
    const adapter = {
      reset() {},
      setFosc() {},
      attachBoard(b) { this._board = b; },
      writePort(port, val) {
        if (this._board) {
          for (let i = 0; i < 8; i++) {
            // BUG: always quasi, ignores actual mode
            this._board.setPin(`P${port}.${i}`, 'quasi', !!((val >> i) & 1));
          }
        }
      },
      setPortMode() {
        // BUG: does nothing — mode changes are silent
      },
      readPort() { return 0xFF; },
      runNs(ns) {
        if (this._board) this._board.advanceTo(BigInt(ns));
      },
    };

    const results = runConformance(adapter);

    // Should fail the four-modes test
    const fourModes = results.find(r => r.name.includes('four port modes'));
    assert.ok(fourModes);
    assert.equal(fourModes.pass, false, 'always-quasi should fail four modes');

    // Should fail the mode-change-is-event test
    const modeChange = results.find(r => r.name.includes('PxM0/PxM1'));
    assert.ok(modeChange);
    assert.equal(modeChange.pass, false, 'silent setPortMode should fail');
  });
});

describe('conformance: report format', () => {
  it('report includes all test names', () => {
    // Use a minimal passing adapter
    const adapter = {
      reset() {},
      setFosc() {},
      attachBoard(b) { this._board = b; },
      writePort(port, val) {
        if (this._board) {
          for (let i = 0; i < 8; i++) {
            this._board.setPin(`P${port}.${i}`, 'quasi', !!((val >> i) & 1));
          }
        }
      },
      setPortMode(port, m1, m0) {
        if (this._board) {
          for (let i = 0; i < 8; i++) {
            const modes = ['quasi', 'pushpull', 'input', 'opendrain'];
            const mode = modes[((m1 >> i) & 1) << 1 | ((m0 >> i) & 1)];
            this._board.setPin(`P${port}.${i}`, mode, true);
          }
        }
      },
      readPort() { return 0xFF; },
      runNs(ns) {
        if (this._board) this._board.advanceTo(BigInt(ns));
      },
    };

    const results = runConformance(adapter);
    const report = formatReport(results);

    assert.ok(report.includes('Conformance Report'));
    assert.ok(report.includes('passed'));
    assert.ok(report.includes('setPin'));
    assert.ok(results.length >= 10, `should have ≥10 checks, got ${results.length}`);
  });

  it('failed checks include actionable detail', () => {
    const brokenAdapter = {
      reset() {},
      setFosc() {},
      attachBoard() {},
      writePort() {}, // does nothing — no setPin calls
      setPortMode() {},
      readPort() { return 0xFF; },
      runNs() {}, // does nothing — no advanceTo calls
    };

    const results = runConformance(brokenAdapter);
    const failures = results.filter(r => !r.pass);

    for (const f of failures) {
      assert.ok(f.detail.length > 10,
        `failure "${f.name}" should have actionable detail, got: "${f.detail}"`);
    }
  });
});
