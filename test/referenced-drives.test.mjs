/**
 * Referenced device drives — hand-computed oracles.
 * spec-updates/referenced-device-drives.md
 *
 * Covers: the battery double-stamp fix (one Thévenin, not two Nortons in
 * parallel), floating sources between a device's own pins (series cells),
 * a lifted battery driving no current, and the dc-motor back-EMF sign
 * (free-running motor behind a series resistor).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerPowerDevices } from '../src/devices/power.js';
import { registerDCMotor } from '../src/devices/dc-motor.js';
import { unregisterDevice } from '../src/devices.js';

function setup() {
  registerPowerDevices();
  registerDCMotor();
}
function teardown() {
  for (const k of ['battery', 'vreg', 'fuse', 'dc_motor']) {
    try { unregisterDevice(k); } catch {}
  }
}

describe('battery: single stamp, correct internal resistance', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('9 V, rInternal 0.5 Ω across 1 Ω: I = 6.000 A', () => {
    // Hand oracle: I = 9 / (0.5 + 1) = 6.000 A; V(load) = 6.000 V.
    // The old double-stamp (drives + ctx.thevenin in parallel) halved the
    // internal resistance: I = 9 / 1.25 = 7.2 A, V = 7.2 V.
    const parts = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'B1', kind: 'battery', params: { volts: 9, rInternal: 0.5 },
        terminals: ['pos', 'neg'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_pos', terminals: [{ part: 'B1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'B1', terminal: 'neg' },
        { part: 'R1', terminal: 'b' },
      ] },
    ];
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    const v = board.nodeVoltage('net_pos');
    assert.ok(Math.abs(v - 6.0) < 0.01,
      `V(load) must be 6.000 V (9 through 0.5+1), got ${v.toFixed(4)} V` +
      ' — 7.2 V means the internal resistance is double-stamped again');
    const i = board.branchCurrent('R1', 'b');
    assert.ok(Math.abs(Math.abs(i) - 6.0) < 0.01,
      `|I| must be 6.000 A, got ${Math.abs(i).toFixed(4)} A`);
  });

  it('two cells in series: the floating middle node is real', () => {
    // Two 1.5 V cells, rInternal 0.01 Ω each, across 10 Ω.
    // Hand oracle: I = 3 / 10.02 = 0.29940 A.
    // Middle node (bottom cell pos = top cell neg), bottom neg at ground:
    //   V(mid) = 1.5 − I·0.01 = 1.49701 V.
    //   V(top) = V(mid) + 1.5 − I·0.01 = 2.99401 V.
    // A ground-referenced stamp cannot represent the top cell at all — its
    // EMF would appear between top-pos and GROUND, not across the cell.
    const parts = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'B_BOT', kind: 'battery', params: { volts: 1.5, rInternal: 0.01 },
        terminals: ['pos', 'neg'] },
      { id: 'B_TOP', kind: 'battery', params: { volts: 1.5, rInternal: 0.01 },
        terminals: ['pos', 'neg'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_top', terminals: [{ part: 'B_TOP', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_mid', terminals: [{ part: 'B_TOP', terminal: 'neg' }, { part: 'B_BOT', terminal: 'pos' }] },
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'B_BOT', terminal: 'neg' },
        { part: 'R1', terminal: 'b' },
      ] },
    ];
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    const vMid = board.nodeVoltage('net_mid');
    const vTop = board.nodeVoltage('net_top');
    assert.ok(Math.abs(vMid - 1.49701) < 0.005,
      `V(mid) must be 1.497 V, got ${vMid.toFixed(4)} V`);
    assert.ok(Math.abs(vTop - 2.99401) < 0.005,
      `V(top) must be 2.994 V, got ${vTop.toFixed(4)} V`);
    const i = board.branchCurrent('R1', 'b');
    assert.ok(Math.abs(Math.abs(i) - 0.29940) < 0.002,
      `|I| must be 0.2994 A, got ${Math.abs(i).toFixed(5)} A`);
  });

  it('lifted battery: no loop, no current, full EMF across the pins', () => {
    // neg reaches ground only through 1 kΩ; pos is open. No closed loop,
    // so I = 0, the resistor drops nothing, and V(pos) − V(neg) = 9.000 V.
    // The old ground-referenced stamp drove pos to 9 V ABOVE GROUND
    // regardless of where neg sat, and pushed current through the 1 kΩ.
    const parts = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'B1', kind: 'battery', params: { volts: 9, rInternal: 0.5 },
        terminals: ['pos', 'neg'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_pos', terminals: [{ part: 'B1', terminal: 'pos' }] },
      { id: 'net_neg', terminals: [{ part: 'B1', terminal: 'neg' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
    ];
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    const i = board.branchCurrent('R1', 'a');
    assert.ok(Math.abs(i) < 1e-6,
      `no closed loop: |I| must be ~0, got ${i} A`);
    const vDiff = board.nodeVoltage('net_pos') - board.nodeVoltage('net_neg');
    assert.ok(Math.abs(vDiff - 9.0) < 0.01,
      `V(pos)−V(neg) must be 9.000 V, got ${vDiff.toFixed(4)} V`);
  });
});

describe('dc_motor: back-EMF sign (free-running behind a series resistor)', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('no-load steady state: motor terminal rises to the supply', () => {
    // 5 V rail → 10 Ω series resistor → motor (R=10, kV=0.1, J=1e-6) → GND.
    // Mechanical steady state with no load: torque = kT·I = 0 → I = 0,
    // so the series resistor drops nothing and V(mid) → 5.000 V, with
    // e = kV·omega → 5 V (omega → 50 rad/s).
    // With the old inverted EMF stamp (I_stamped = (V+e)/R), the electrical
    // and mechanical equations settle at V(mid) = e = 5/3 ≈ 1.667 V — a
    // motor that draws MORE current the faster it spins.
    // Spin-up time constant: tau = J·(R_series+R)/ (kV·kT) = 1e-6·20/0.01
    // = 2 ms; 50 ms is 25 tau.
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'RS', kind: 'resistor', params: { ohms: 10 }, terminals: ['a', 'b'] },
      { id: 'M1', kind: 'dc_motor',
        params: { windingR: 10, kV: 0.1, J: 1e-6, loadTorque: 0, windingH: 0 },
        terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'RS', terminal: 'a' }] },
      { id: 'net_mid', terminals: [{ part: 'RS', terminal: 'b' }, { part: 'M1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'M1', terminal: 'b' }] },
    ];
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    for (let ms = 1; ms <= 50; ms++) {
      board.advanceTo(BigInt(ms) * 1_000_000n);
    }

    const vMid = board.nodeVoltage('net_mid');
    assert.ok(vMid > 4.5,
      `free-running motor terminal must approach 5 V (I→0), got ${vMid.toFixed(3)} V` +
      ' — ~1.67 V means the back-EMF sign is inverted again');
  });
});
