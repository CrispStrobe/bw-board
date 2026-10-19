/**
 * Test the conformance kit itself — using a compliant mock adapter
 * and a deliberately broken one.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runConformance, formatReport } from '../src/conformance.js';

/**
 * A fully compliant mock MCU adapter — it does everything the contract requires.
 */
function makeCompliantAdapter() {
  let board = null;
  let portData = [0xFF, 0xFF, 0xFF, 0xFF]; // P0-P3, reset default = 0xFF
  let portM1 = [0, 0, 0, 0];
  let portM0 = [0, 0, 0, 0];
  let tNs = 0n;

  function modeForBit(port, bit) {
    const m1 = (portM1[port] >> bit) & 1;
    const m0 = (portM0[port] >> bit) & 1;
    if (m1 === 0 && m0 === 0) return 'quasi';
    if (m1 === 0 && m0 === 1) return 'pushpull';
    if (m1 === 1 && m0 === 0) return 'input';
    return 'opendrain';
  }

  function emitPinEvents(port) {
    if (!board) return;
    for (let bit = 0; bit < 8; bit++) {
      const pin = `P${port}.${bit}`;
      const mode = modeForBit(port, bit);
      const driveHigh = !!((portData[port] >> bit) & 1);
      board.setPin(pin, mode, driveHigh);
    }
  }

  return {
    reset() {
      portData = [0xFF, 0xFF, 0xFF, 0xFF];
      portM1 = [0, 0, 0, 0];
      portM0 = [0, 0, 0, 0];
      tNs = 0n;
    },

    setFosc(hz) { /* stored for cycle→ns conversion */ },

    attachBoard(b) {
      board = b;
    },

    writePort(port, value) {
      portData[port] = value & 0xFF;
      emitPinEvents(port);
    },

    setPortMode(port, m1, m0) {
      portM1[port] = m1 & 0xFF;
      portM0[port] = m0 & 0xFF;
      emitPinEvents(port);
    },

    readPort(port) {
      // For input pins, read from board; for output, return latch
      let result = 0;
      for (let bit = 0; bit < 8; bit++) {
        const mode = modeForBit(port, bit);
        if (mode === 'input' && board) {
          result |= (board.readPin(`P${port}.${bit}`) << bit);
        } else {
          result |= ((portData[port] >> bit) & 1) << bit;
        }
      }
      return result;
    },

    runNs(ns) {
      tNs += BigInt(ns);
      if (board) board.advanceTo(tNs);
    },

    startAdc(channel) {
      // simplified: just trigger a readAnalog on next runNs
      this._adcChannel = channel;
      this._adcReady = false;
      this._adcResult = 0;
    },

    adcReady() {
      return this._adcReady ?? false;
    },

    readAdc() {
      return this._adcResult ?? 0;
    },

    // Hook into runNs to do the ADC conversion
    _doAdc() {
      if (this._adcChannel !== undefined && board && !this._adcReady) {
        const v = board.readAnalog(`P1.${this._adcChannel}`);
        this._adcResult = Math.round(v / 5.0 * 1023);
        this._adcReady = true;
      }
    },
  };
}

// Patch runNs to also do ADC
function patchAdcIntoRunNs(adapter) {
  const origRunNs = adapter.runNs.bind(adapter);
  adapter.runNs = function(ns) {
    origRunNs(ns);
    adapter._doAdc();
  };
  return adapter;
}

/**
 * A deliberately broken adapter — misses key contract requirements.
 */
function makeBrokenAdapter() {
  let board = null;
  let tCycles = 0; // uses cycles, not ns — wrong

  return {
    reset() { tCycles = 0; },
    setFosc() {},
    attachBoard(b) { board = b; },

    writePort(port, value) {
      // BROKEN: sends bare level, not (mode, driveHigh)
      if (board) {
        for (let bit = 0; bit < 8; bit++) {
          const level = (value >> bit) & 1;
          // Wrong: sends level as number, not mode+driveHigh
          board.setPin(`P${port}.${bit}`, level ? 'high' : 'low', level);
        }
      }
    },

    setPortMode() {
      // BROKEN: does not trigger setPin on mode changes
    },

    readPort() { return 0xFF; },

    runNs(ns) {
      tCycles += ns / 90; // wrong: not nanoseconds, not bigint
      if (board) board.advanceTo(tCycles); // wrong: sends number, not bigint
    },
  };
}

describe('conformance kit: compliant adapter', () => {
  it('all checks pass for a compliant mock', () => {
    const adapter = patchAdcIntoRunNs(makeCompliantAdapter());
    const results = runConformance(adapter);

    const failures = results.filter(r => !r.pass);
    if (failures.length > 0) {
      console.log(formatReport(results));
    }
    assert.equal(failures.length, 0,
      `compliant adapter should pass all checks: ${failures.map(f => f.name).join(', ')}`);
  });

  it('report format is readable', () => {
    const adapter = patchAdcIntoRunNs(makeCompliantAdapter());
    const results = runConformance(adapter);
    const report = formatReport(results);
    assert.ok(report.includes('Boundary-A Conformance Report'));
    assert.ok(report.includes('passed'));
  });
});

describe('conformance kit: broken adapter', () => {
  it('broken adapter fails required checks', () => {
    const adapter = makeBrokenAdapter();
    const results = runConformance(adapter);

    const failures = results.filter(r => !r.pass && r.severity === 'required');
    assert.ok(failures.length >= 3,
      `broken adapter should fail multiple required checks, got ${failures.length}: ${failures.map(f => f.name).join(', ')}`);
  });

  it('mode change test fails on broken adapter', () => {
    const adapter = makeBrokenAdapter();
    const results = runConformance(adapter);

    const modeTest = results.find(r => r.name.includes('PxM0/PxM1'));
    assert.ok(modeTest, 'should have mode change test');
    assert.equal(modeTest.pass, false, 'broken adapter should fail mode change test');
  });

  it('nanosecond test fails on broken adapter', () => {
    const adapter = makeBrokenAdapter();
    const results = runConformance(adapter);

    const nsTest = results.find(r => r.name.includes('nanoseconds'));
    assert.ok(nsTest, 'should have nanoseconds test');
    assert.equal(nsTest.pass, false, 'broken adapter using Number should fail');
  });
});
