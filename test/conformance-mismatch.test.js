/**
 * Conformance kit: verify it catches the SPECIFIC mismatches found
 * in the real emu8051-stc fork. These are the bugs the contract
 * existed to prevent.
 *
 * From the review:
 *   1. No pin-change callback (board would have to poll)
 *   2. Does not expose (mode, driveHigh) as a pair
 *   3. Takes ADC input in COUNTS rather than volts
 *   4. Advances in CPU cycles rather than nanoseconds
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runConformance } from '../src/conformance.js';

describe('conformance catches: bare level instead of (mode, driveHigh)', () => {
  it('adapter that sends 0/1 instead of mode string', () => {
    const adapter = {
      reset() {},
      setFosc() {},
      attachBoard(b) { this._b = b; },
      writePort(port, val) {
        if (!this._b) return;
        for (let i = 0; i < 8; i++) {
          const level = (val >> i) & 1;
          // BUG: mode is 0 or 1 (a number), not a string
          this._b.setPin(`P${port}.${i}`, level, !!level);
        }
      },
      setPortMode() {},
      readPort() { return 0xFF; },
      runNs(ns) { if (this._b) this._b.advanceTo(BigInt(ns)); },
    };

    const results = runConformance(adapter);
    const shapeTest = results.find(r => r.name.includes('setPin called'));
    assert.ok(shapeTest);
    assert.equal(shapeTest.pass, false,
      'should fail: mode is a number, not a PinMode string');
  });
});

describe('conformance catches: ADC in counts instead of volts', () => {
  it('adapter where readAnalog is never called', () => {
    // An adapter that reads ADC directly from SFR counts and never
    // asks the board for voltage — exactly the mismatch found.
    const adapter = {
      reset() {},
      setFosc() {},
      attachBoard(b) { this._b = b; },
      writePort(port, val) {
        if (!this._b) return;
        for (let i = 0; i < 8; i++) {
          this._b.setPin(`P${port}.${i}`, 'quasi', !!((val >> i) & 1));
        }
      },
      setPortMode(port, m1, m0) {
        if (!this._b) return;
        for (let i = 0; i < 8; i++) {
          const modes = ['quasi', 'pushpull', 'input', 'opendrain'];
          const mode = modes[((m1 >> i) & 1) << 1 | ((m0 >> i) & 1)];
          this._b.setPin(`P${port}.${i}`, mode, true);
        }
      },
      readPort() { return 0xFF; },
      runNs(ns) { if (this._b) this._b.advanceTo(BigInt(ns)); },

      // ADC that does NOT call readAnalog — takes counts directly
      startAdc(ch) { this._adcCh = ch; },
      adcReady() { return true; },
      readAdc() { return 512; }, // hardcoded counts, never asked the board
    };

    const results = runConformance(adapter);
    const adcTest = results.find(r => r.name.includes('readAnalog'));
    assert.ok(adcTest);
    assert.equal(adcTest.pass, false,
      'should fail: MCU never called board.readAnalog');
  });
});

describe('conformance catches: cycles instead of nanoseconds', () => {
  it('adapter using Number cycles', () => {
    let cycles = 0;
    const adapter = {
      reset() { cycles = 0; },
      setFosc() {},
      attachBoard(b) { this._b = b; },
      writePort(port, val) {
        if (!this._b) return;
        for (let i = 0; i < 8; i++) {
          this._b.setPin(`P${port}.${i}`, 'quasi', !!((val >> i) & 1));
        }
      },
      setPortMode(port, m1, m0) {
        if (!this._b) return;
        for (let i = 0; i < 8; i++) {
          const modes = ['quasi', 'pushpull', 'input', 'opendrain'];
          const mode = modes[((m1 >> i) & 1) << 1 | ((m0 >> i) & 1)];
          this._b.setPin(`P${port}.${i}`, mode, true);
        }
      },
      readPort() { return 0xFF; },
      runNs(ns) {
        // BUG: advances in cycles (Number), not nanoseconds (bigint)
        cycles += Math.round(ns / 90);
        if (this._b) this._b.advanceTo(cycles); // Number, not bigint!
      },
    };

    const results = runConformance(adapter);
    const nsTest = results.find(r => r.name.includes('nanoseconds'));
    assert.ok(nsTest);
    assert.equal(nsTest.pass, false,
      'should fail: advanceTo receives Number, not bigint');
  });
});

describe('conformance catches: mode changes are silent', () => {
  it('adapter that ignores PxM0/PxM1 writes', () => {
    const adapter = {
      reset() {},
      setFosc() {},
      attachBoard(b) { this._b = b; },
      writePort(port, val) {
        if (!this._b) return;
        for (let i = 0; i < 8; i++) {
          this._b.setPin(`P${port}.${i}`, 'quasi', !!((val >> i) & 1));
        }
      },
      // BUG: setPortMode does NOT emit setPin calls
      setPortMode() {},
      readPort() { return 0xFF; },
      runNs(ns) { if (this._b) this._b.advanceTo(BigInt(ns)); },
    };

    const results = runConformance(adapter);

    const modeEvent = results.find(r => r.name.includes('PxM0/PxM1'));
    assert.ok(modeEvent);
    assert.equal(modeEvent.pass, false,
      'should fail: mode register writes produce no setPin calls');

    const fourModes = results.find(r => r.name.includes('four port modes'));
    assert.ok(fourModes);
    assert.equal(fourModes.pass, false,
      'should fail: only quasi is ever seen');
  });
});

describe('conformance catches: quasi and pushpull indistinguishable', () => {
  it('adapter that always reports pushpull', () => {
    const adapter = {
      reset() {},
      setFosc() {},
      attachBoard(b) { this._b = b; },
      writePort(port, val) {
        if (!this._b) return;
        for (let i = 0; i < 8; i++) {
          // BUG: always says pushpull regardless of actual mode
          this._b.setPin(`P${port}.${i}`, 'pushpull', !!((val >> i) & 1));
        }
      },
      setPortMode(port, m1, m0) {
        if (!this._b) return;
        for (let i = 0; i < 8; i++) {
          this._b.setPin(`P${port}.${i}`, 'pushpull', true);
        }
      },
      readPort() { return 0xFF; },
      runNs(ns) { if (this._b) this._b.advanceTo(BigInt(ns)); },
    };

    const results = runConformance(adapter);

    const quasiVsPP = results.find(r => r.name.includes('quasi-bidir'));
    assert.ok(quasiVsPP);
    assert.equal(quasiVsPP.pass, false,
      'should fail: quasi and pushpull are indistinguishable');

    const fourModes = results.find(r => r.name.includes('four port modes'));
    assert.ok(fourModes);
    assert.equal(fourModes.pass, false,
      'should fail: only pushpull is ever reported');
  });
});
