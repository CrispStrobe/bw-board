/**
 * MNA cache correctness: the cache in 44fc538 memoises branchCurrent's
 * MNA result and clears it in _solve(). These tests assert that every
 * state-changing path invalidates it.
 *
 * Shape: read → change state → read → assert value moved.
 *
 * Follow-on: nodeVoltage, resistance, and ledBrightness do NOT use the
 * MNA cache. The cache helps exactly one reporter (branchCurrent) and
 * the display-rate saving applies to that reporter only.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { NetlistBuilder } from '../src/builder.js';

// ─── Circuit where pot actually affects current ──────────────────────────
// VCC → R1(1k) → node → pot(wiper) → LED → pin → GND path
// Changing pot position changes the effective resistance, changing current.

function makePotLedCircuit() {
  return new NetlistBuilder()
    .vcc('VCC').gnd('GND')
    .resistor('R1', 1000).led('LED1', 2.0)
    .mcu('MCU', ['P1.0'])
    .wire('VCC.vcc', 'R1.a')
    .wire('R1.b', 'LED1.anode')
    .wire('LED1.cathode', 'MCU.P1.0')
    .build();
}

// ─── 1–4: Invalidation assertions ────────────────────────────────────────

describe('MNA cache invalidation', () => {
  it('setPin: LED current changes when pin toggles', () => {
    const { parts, nets } = makePotLedCircuit();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    board.setPin('P1.0', 'pushpull', false); // sink → LED on
    const iOn = board.branchCurrent('LED1', 'anode');

    board.setPin('P1.0', 'pushpull', true); // source → LED off
    const iOff = board.branchCurrent('LED1', 'anode');

    assert.ok(iOn > 0.002, `on: ${(iOn*1000).toFixed(2)} mA`);
    assert.ok(iOff < 0.0001, `off: ${(iOff*1000).toFixed(3)} mA`);
  });

  it('setControl: current changes when pot position changes', () => {
    // Circuit where pot IS in the current path:
    // VCC → pot.a, pot.wiper → R → LED → pin → GND
    const { parts, nets } = new NetlistBuilder()
      .vcc('VCC').gnd('GND')
      .potentiometer('POT', 10000)
      .resistor('R1', 1000).led('LED1', 2.0)
      .mcu('MCU', ['P1.0'])
      .wire('VCC.vcc', 'POT.a')
      .wire('POT.b', 'GND.gnd')
      .wire('POT.wiper', 'R1.a')
      .wire('R1.b', 'LED1.anode')
      .wire('LED1.cathode', 'MCU.P1.0')
      .build();

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', false);

    board.setControl('POT', 0.9); // wiper near VCC → high voltage → more current
    const iHigh = board.branchCurrent('LED1', 'anode');

    board.setControl('POT', 0.1); // wiper near GND → low voltage → less current
    const iLow = board.branchCurrent('LED1', 'anode');

    assert.ok(iHigh > iLow,
      `pot 0.9 (${(iHigh*1000).toFixed(2)} mA) > pot 0.1 (${(iLow*1000).toFixed(2)} mA)`);
  });

  it('setPower: current drops when powered off', () => {
    const { parts, nets } = makePotLedCircuit();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', false);

    const iOn = board.branchCurrent('LED1', 'anode');
    assert.ok(iOn > 0.002, `powered: ${(iOn*1000).toFixed(2)} mA`);

    board.setPower(false);
    const iOff = board.branchCurrent('LED1', 'anode');
    assert.ok(iOff < iOn, `off (${(iOff*1000).toFixed(3)} mA) < on (${(iOn*1000).toFixed(2)} mA)`);
  });

  it('setNetlist: new circuit gives new currents', () => {
    const board = new BoardImpl(5.0);

    const c1 = new NetlistBuilder()
      .vcc('VCC').gnd('GND').resistor('R1', 1000)
      .wire('VCC.vcc', 'R1.a').wire('R1.b', 'GND.gnd')
      .build();
    board.setNetlist(c1.parts, c1.nets);
    const i1 = board.branchCurrent('R1', 'b');

    const c2 = new NetlistBuilder()
      .vcc('VCC').gnd('GND').resistor('R1', 2000)
      .wire('VCC.vcc', 'R1.a').wire('R1.b', 'GND.gnd')
      .build();
    board.setNetlist(c2.parts, c2.nets);
    const i2 = board.branchCurrent('R1', 'b');

    assert.ok(Math.abs(i1 - 0.005) < 0.001, `1kΩ: ${(i1*1000).toFixed(2)} mA`);
    assert.ok(Math.abs(i2 - 0.0025) < 0.001, `2kΩ: ${(i2*1000).toFixed(2)} mA`);
  });
});

// ─── 5: Cache hit: two reads, one solve ──────────────────────────────────

describe('MNA cache: shared solve', () => {
  it('two branchCurrent calls with no state change → identical values, one solve', () => {
    const { parts, nets } = makePotLedCircuit();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', false);

    // Monkey-patch _solveMNA to count calls
    let solveCount = 0;
    const orig = board._solveMNA.bind(board);
    board._solveMNA = function (...args) {
      solveCount++;
      return orig(...args);
    };

    // Clear any existing cache
    board._mnaCache = null;

    const i1 = board.branchCurrent('LED1', 'anode');
    const i2 = board.branchCurrent('LED1', 'anode');
    const i3 = board.branchCurrent('R1', 'b');

    assert.equal(solveCount, 1, `should solve exactly once, solved ${solveCount} times`);
    assert.equal(i1, i2, 'same part: bit-identical from cache');
    assert.ok(Math.abs(i1 - i3) < 0.0001, 'series: R1 ≈ LED1');
  });

  it('setPin between reads → two solves', () => {
    const { parts, nets } = makePotLedCircuit();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    let solveCount = 0;
    const orig = board._solveMNA.bind(board);
    board._solveMNA = function (...args) {
      solveCount++;
      return orig(...args);
    };
    board._mnaCache = null;

    board.setPin('P1.0', 'pushpull', false);
    board.branchCurrent('LED1', 'anode'); // solve 1
    board.setPin('P1.0', 'pushpull', true); // invalidates
    board.branchCurrent('LED1', 'anode'); // solve 2

    assert.equal(solveCount, 2, `should solve twice, solved ${solveCount} times`);
  });
});

// ─── Follow-on: which reporters use the cache? ──────────────────────────

describe('MNA cache scope: which reporters benefit', () => {
  it('nodeVoltage does NOT use _mnaCache (reads closed-form)', () => {
    const { parts, nets } = makePotLedCircuit();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', false);

    // nodeVoltage reads this.nodeVoltages (closed-form), not _mnaCache
    const v = board.nodeVoltage(nets[0].id);
    assert.equal(typeof v, 'number');
    // The cache should still be null (nodeVoltage doesn't populate it)
    assert.equal(board._mnaCache, null,
      'nodeVoltage should not populate _mnaCache');
  });

  it('ledBrightness does NOT use _mnaCache (reads sample history)', () => {
    const { parts, nets } = makePotLedCircuit();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(25_000_000n);

    board._mnaCache = null;
    const b = board.ledBrightness('LED1');
    assert.ok(b > 0.1);
    assert.equal(board._mnaCache, null,
      'ledBrightness should not populate _mnaCache');
  });

  it('resistance does NOT use _mnaCache (solves with different params)', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = new NetlistBuilder()
      .vcc('VCC').gnd('GND').resistor('R1', 1000)
      .wire('VCC.vcc', 'R1.a').wire('R1.b', 'GND.gnd')
      .build();
    board.setNetlist(parts, nets);
    board.setPower(false);

    board._mnaCache = null;
    const r = board.resistance(nets[0].id, nets[1].id);
    assert.equal(typeof r, 'number');
    // resistance calls _solveMNA(true, ...) with different args — does not
    // populate or use _mnaCache (which is for powerOff=false only)
    assert.equal(board._mnaCache, null,
      'resistance should not populate _mnaCache');
  });

  it('branchCurrent IS the only reporter that uses _mnaCache', () => {
    const { parts, nets } = makePotLedCircuit();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', false);

    assert.equal(board._mnaCache, null, 'starts null');
    board.branchCurrent('LED1', 'anode');
    assert.notEqual(board._mnaCache, null, 'branchCurrent populates it');
  });
});
