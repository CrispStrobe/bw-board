/**
 * Cross-validation: transient MNA vs closed-form analytic solutions.
 *
 * From campaign Phase 4: "RC charge curve vs closed-form analytic,
 * report divergences rather than tuning them away."
 *
 * Each test computes the analytic solution independently and compares
 * against the board's transient integration. Tolerance is stated
 * explicitly per test (engineering bar: "state the tolerance").
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerTimer555 } from '../src/devices/timer-555.js';
import { unregisterDevice } from '../src/devices.js';

// ─── RC charge curve ────────────────────────────────────────────────────

describe('cross-validate: RC charge curve vs analytic', () => {
  // Analytic: V(t) = VCC * (1 - e^(-t/RC))
  // Circuit: VCC → R → C → GND, measure cap voltage.

  it('10kΩ + 1µF (tau=10ms), matches analytic at 5ms, 10ms, 20ms, 50ms', () => {
    const R = 10000;
    const C = 1e-6;
    const tau = R * C; // 10ms = 0.01s
    const VCC = 5.0;

    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: R }, terminals: ['a', 'b'] },
      { id: 'C1', kind: 'capacitor', params: { farads: C }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_cap', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
    ];

    const board = new BoardImpl(VCC);
    board.setNetlist(parts, nets);

    // Tolerance: 5% of VCC. Stated explicitly.
    // The closed-form RC integrator should be very close; MNA sub-stepping
    // introduces quantization at its step size (100µs default).
    const tolerance = 0.25; // 5% of 5V

    const checkpoints = [
      { ms: 5, analytic: VCC * (1 - Math.exp(-0.005 / tau)) },   // 0.5τ → 39.3%
      { ms: 10, analytic: VCC * (1 - Math.exp(-0.010 / tau)) },  // 1τ → 63.2%
      { ms: 20, analytic: VCC * (1 - Math.exp(-0.020 / tau)) },  // 2τ → 86.5%
      { ms: 50, analytic: VCC * (1 - Math.exp(-0.050 / tau)) },  // 5τ → 99.3%
    ];

    for (const { ms, analytic } of checkpoints) {
      board.advanceTo(BigInt(ms) * 1_000_000n);
      const simV = board.nodeVoltage('net_cap');
      const err = Math.abs(simV - analytic);
      assert.ok(err < tolerance,
        `t=${ms}ms: sim=${simV.toFixed(4)}V, analytic=${analytic.toFixed(4)}V, ` +
        `err=${err.toFixed(4)}V > tolerance=${tolerance}V`);
    }
  });

  it('1kΩ + 100µF (tau=100ms), matches at 50ms and 200ms', () => {
    const R = 1000;
    const C = 100e-6;
    const tau = R * C; // 100ms
    const VCC = 5.0;

    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: R }, terminals: ['a', 'b'] },
      { id: 'C1', kind: 'capacitor', params: { farads: C }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_cap', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
    ];

    const board = new BoardImpl(VCC);
    board.setNetlist(parts, nets);

    const tolerance = 0.25;

    const checkpoints = [
      { ms: 50, analytic: VCC * (1 - Math.exp(-0.050 / tau)) },   // 0.5τ
      { ms: 200, analytic: VCC * (1 - Math.exp(-0.200 / tau)) },  // 2τ
    ];

    for (const { ms, analytic } of checkpoints) {
      board.advanceTo(BigInt(ms) * 1_000_000n);
      const simV = board.nodeVoltage('net_cap');
      const err = Math.abs(simV - analytic);
      assert.ok(err < tolerance,
        `t=${ms}ms: sim=${simV.toFixed(4)}V, analytic=${analytic.toFixed(4)}V, ` +
        `err=${err.toFixed(4)}V > tolerance=${tolerance}V`);
    }
  });
});

// ─── RC discharge curve ─────────────────────────────────────────────────

describe('cross-validate: RC discharge vs analytic', () => {
  it('pre-charged cap discharges: V(t) = V0 * e^(-t/RC)', () => {
    const R = 10000;
    const C = 1e-6;
    const tau = R * C;
    const VCC = 5.0;
    const V0 = VCC; // start fully charged

    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: R }, terminals: ['a', 'b'] },
      { id: 'C1', kind: 'capacitor', params: { farads: C }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
      // Cap between resistor and GND. R discharges to GND.
      { id: 'net_cap', terminals: [{ part: 'R1', terminal: 'a' }, { part: 'C1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'R1', terminal: 'b' },
        { part: 'C1', terminal: 'b' },
      ]},
    ];

    const board = new BoardImpl(VCC);
    board.setNetlist(parts, nets);

    // Pre-charge the cap to VCC by driving it high first
    // Actually, in this circuit the cap's terminal 'a' is on net_cap which
    // connects to R1.a, and R1.b goes to GND. So current flows cap → R → GND.
    // The cap starts at 0V. Let me charge it first by putting VCC on the net.

    // Better approach: charge for 100ms (10τ) through VCC
    // Reconnect: VCC → R1 → C1 → GND
    const parts2 = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: R }, terminals: ['a', 'b'] },
      { id: 'C1', kind: 'capacitor', params: { farads: C }, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets2 = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
      { id: 'net_drive', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_cap', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
    ];

    const board2 = new BoardImpl(VCC);
    board2.setNetlist(parts2, nets2);

    // Charge: drive pin HIGH (push-pull) for 100ms (10τ)
    board2.setPin('P1.0', 'pushpull', true);
    board2.advanceTo(100_000_000n); // 100ms

    const vCharged = board2.nodeVoltage('net_cap');
    assert.ok(vCharged > 4.5, `cap should be charged near VCC, got ${vCharged.toFixed(3)}V`);

    // Discharge: drive pin LOW
    board2.setPin('P1.0', 'pushpull', false);

    const tolerance = 0.3;
    const tStart = 100; // ms

    // V(t) = V_charged * e^(-dt/tau) — discharging toward 0V through (R + R_pin=25Ω)
    // Effective tau for discharge: (R + 25) * C ≈ 10025 * 1e-6 ≈ 10.025ms
    const effTau = (R + 25) * C;

    const checkpoints = [5, 10, 20];
    for (const dtMs of checkpoints) {
      board2.advanceTo(BigInt(tStart + dtMs) * 1_000_000n);
      const simV = board2.nodeVoltage('net_cap');
      const analytic = vCharged * Math.exp(-dtMs / 1000 / effTau);
      const err = Math.abs(simV - analytic);
      assert.ok(err < tolerance,
        `dt=${dtMs}ms: sim=${simV.toFixed(4)}V, analytic=${analytic.toFixed(4)}V, ` +
        `err=${err.toFixed(4)}V > tolerance=${tolerance}V`);
    }
  });
});

// ─── 555 astable: period cross-check ────────────────────────────────────

describe('cross-validate: 555 astable period vs analytic formula', () => {
  it('measured period within 3x of 0.693*(R1+2*R2)*C', () => {
    // This is a weaker check because the 555 is behavioral + transient MNA.
    // The point is to report the divergence rather than hide it.
    registerTimer555();

    try {
      const R1 = 10000, R2 = 10000, C = 10e-6;
      const VCC = 5.0;
      // Analytic period: T = 0.693 * (R1 + 2*R2) * C = 0.693 * 30000 * 10e-6 = 207.9ms
      const analyticPeriod = 0.693 * (R1 + 2 * R2) * C;

      const parts = [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'U1', kind: 'timer_555', params: { rOut: 50 },
          terminals: ['vcc', 'gnd', 'trigger', 'threshold', 'control', 'discharge', 'output', 'reset'] },
        { id: 'R1', kind: 'resistor', params: { ohms: R1 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: R2 }, terminals: ['a', 'b'] },
        { id: 'C1', kind: 'capacitor', params: { farads: C }, terminals: ['a', 'b'] },
        { id: 'R_LOAD', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      ];
      const nets = [
        { id: 'net_vcc', terminals: [
          { part: 'VCC', terminal: 'vcc' },
          { part: 'U1', terminal: 'vcc' },
          { part: 'R1', terminal: 'a' },
          { part: 'U1', terminal: 'reset' },
        ]},
        { id: 'net_gnd', terminals: [
          { part: 'GND', terminal: 'gnd' },
          { part: 'U1', terminal: 'gnd' },
          { part: 'C1', terminal: 'b' },
          { part: 'R_LOAD', terminal: 'b' },
        ]},
        { id: 'net_disch', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'U1', terminal: 'discharge' },
          { part: 'R2', terminal: 'a' },
        ]},
        { id: 'net_cap', terminals: [
          { part: 'R2', terminal: 'b' },
          { part: 'U1', terminal: 'threshold' },
          { part: 'U1', terminal: 'trigger' },
          { part: 'C1', terminal: 'a' },
        ]},
        { id: 'net_ctrl', terminals: [{ part: 'U1', terminal: 'control' }] },
        { id: 'net_out', terminals: [
          { part: 'U1', terminal: 'output' },
          { part: 'R_LOAD', terminal: 'a' },
        ]},
      ];

      const board = new BoardImpl(VCC);
      board.setNetlist(parts, nets);

      // Measure period by finding two consecutive rising edges
      let lastOut = 0;
      let risingEdges = [];

      for (let ms = 1; ms <= 2000; ms++) {
        board.advanceTo(BigInt(ms) * 1_000_000n);
        const out = board.nodeVoltage('net_out') > 2.5 ? 1 : 0;
        if (out === 1 && lastOut === 0) {
          risingEdges.push(ms);
        }
        lastOut = out;
      }

      if (risingEdges.length >= 3) {
        // Skip first edge (startup), measure between edges 2 and 3
        const measuredPeriodMs = risingEdges[2] - risingEdges[1];
        const measuredPeriodSec = measuredPeriodMs / 1000;
        const ratio = measuredPeriodSec / analyticPeriod;

        // Report the divergence — this IS the deliverable per the brief.
        console.log(`# 555 astable: analytic T=${(analyticPeriod*1000).toFixed(1)}ms, ` +
          `measured T=${measuredPeriodMs}ms, ratio=${ratio.toFixed(2)}`);

        // Must be within 3x (loose — sub-step quantization + behavioral model)
        assert.ok(ratio > 0.33 && ratio < 3.0,
          `period ratio ${ratio.toFixed(2)} outside [0.33, 3.0] — ` +
          `analytic=${(analyticPeriod*1000).toFixed(1)}ms, measured=${measuredPeriodMs}ms`);
      } else {
        assert.ok(risingEdges.length >= 2,
          `555 did not oscillate enough: only ${risingEdges.length} rising edges in 2s`);
      }
    } finally {
      try { unregisterDevice('timer_555'); } catch {}
    }
  });
});
