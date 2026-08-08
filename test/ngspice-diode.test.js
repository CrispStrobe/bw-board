/**
 * ngspice diode golden tests: LED I-V curves across resistor values,
 * VCC levels, LED colors, and RC transient time points.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BoardImpl } from '../src/board.js';
import { NetlistBuilder } from '../src/builder.js';

const ngspice = JSON.parse(
  readFileSync(new URL('./golden/ngspice_diode.json', import.meta.url), 'utf-8')
);

function find(name) {
  return ngspice.results.find(r => r.name === name)?.measured;
}

// ─── LED current at various resistors ─────────────────────────────────────

describe('vs ngspice: red LED I-V across resistor values', () => {
  for (const r of [100, 220, 330, 470, 680, 1000, 2200, 4700, 10000]) {
    it(`R=${r}Ω: current matches ngspice`, () => {
      const ref = find(`led_red_${r}`);
      if (!ref) { assert.ok(false, `no ngspice data for R=${r}`); return; }

      const { parts, nets } = new NetlistBuilder()
        .vcc('VCC').gnd('GND')
        .resistor('R1', r).led('LED1', 2.0)
        .wire('VCC.vcc', 'R1.a').wire('R1.b', 'LED1.anode')
        .wire('LED1.cathode', 'GND.gnd')
        .build();

      const board = new BoardImpl(5.0);
      board.setNetlist(parts, nets);

      const i = board.branchCurrent('LED1', 'anode');
      const iRef = Math.abs(ref['v1#branch']);

      // Our piecewise model uses Vf=2.0 + Rd=10Ω.
      // ngspice uses Shockley IS=1e-20, N=1.8, RS=10.
      // They should agree within ~30% for most resistor values.
      // At very low R (100Ω), the Vf difference matters more.
      const ratio = i / iRef;
      assert.ok(ratio > 0.5 && ratio < 2.0,
        `R=${r}: bw-board=${(i*1000).toFixed(2)}mA, ngspice=${(iRef*1000).toFixed(2)}mA, ratio=${ratio.toFixed(2)}`);
    });
  }
});

// ─── LED at 3.3V ──────────────────────────────────────────────────────────

describe('vs ngspice: red LED at 3.3V', () => {
  for (const r of [220, 470, 1000]) {
    it(`R=${r}Ω at 3.3V`, () => {
      const ref = find(`led_red_${r}_3v3`);
      if (!ref) return;

      const { parts, nets } = new NetlistBuilder()
        .vcc('VCC').gnd('GND')
        .resistor('R1', r).led('LED1', 2.0)
        .wire('VCC.vcc', 'R1.a').wire('R1.b', 'LED1.anode')
        .wire('LED1.cathode', 'GND.gnd')
        .build();

      const board = new BoardImpl(3.3);
      board.setNetlist(parts, nets);

      const i = board.branchCurrent('LED1', 'anode');
      const iRef = Math.abs(ref['v1#branch']);

      if (iRef > 0.0001) {
        const ratio = i / iRef;
        assert.ok(ratio > 0.3 && ratio < 3.0,
          `3.3V R=${r}: bw-board=${(i*1000).toFixed(2)}mA, ngspice=${(iRef*1000).toFixed(2)}mA`);
      }
    });
  }
});

// ─── Blue LED ─────────────────────────────────────────────────────────────

describe('vs ngspice: blue LED', () => {
  for (const r of [220, 470, 1000]) {
    it(`R=${r}Ω`, () => {
      const ref = find(`led_blue_${r}`);
      if (!ref) return;

      const { parts, nets } = new NetlistBuilder()
        .vcc('VCC').gnd('GND')
        .resistor('R1', r).led('LED1', 3.2)
        .wire('VCC.vcc', 'R1.a').wire('R1.b', 'LED1.anode')
        .wire('LED1.cathode', 'GND.gnd')
        .build();

      const board = new BoardImpl(5.0);
      board.setNetlist(parts, nets);

      const i = board.branchCurrent('LED1', 'anode');
      const iRef = Math.abs(ref['v1#branch']);

      if (iRef > 0.0001) {
        const ratio = i / iRef;
        assert.ok(ratio > 0.3 && ratio < 3.0,
          `blue R=${r}: bw-board=${(i*1000).toFixed(2)}mA, ngspice=${(iRef*1000).toFixed(2)}mA`);
      }
    });
  }
});

// ─── Silicon diode ────────────────────────────────────────────────────────

describe('vs ngspice: silicon diode (1N4148-like)', () => {
  for (const r of [100, 1000, 10000]) {
    it(`R=${r}Ω`, () => {
      const ref = find(`si_diode_${r}`);
      if (!ref) return;

      const { parts, nets } = new NetlistBuilder()
        .vcc('VCC').gnd('GND')
        .resistor('R1', r).diode('D1', 0.7)
        .wire('VCC.vcc', 'R1.a').wire('R1.b', 'D1.anode')
        .wire('D1.cathode', 'GND.gnd')
        .build();

      const board = new BoardImpl(5.0);
      board.setNetlist(parts, nets);

      const i = board.branchCurrent('D1', 'anode');
      const iRef = Math.abs(ref['v1#branch']);

      const ratio = i / iRef;
      assert.ok(ratio > 0.5 && ratio < 2.0,
        `Si diode R=${r}: bw-board=${(i*1000).toFixed(2)}mA, ngspice=${(iRef*1000).toFixed(2)}mA`);
    });
  }
});

// ─── Two LEDs in series ───────────────────────────────────────────────────

describe('vs ngspice: two LEDs in series at various VCC', () => {
  for (const vcc of [5.0, 3.3, 7.0]) {
    it(`VCC=${vcc}V`, () => {
      const ref = find(`two_leds_series_${vcc}V`);
      if (!ref) return;

      const { parts, nets } = new NetlistBuilder()
        .vcc('VCC').gnd('GND')
        .resistor('R1', 1000)
        .led('LED1', 2.0).led('LED2', 2.0)
        .wire('VCC.vcc', 'R1.a').wire('R1.b', 'LED1.anode')
        .wire('LED1.cathode', 'LED2.anode').wire('LED2.cathode', 'GND.gnd')
        .build();

      const board = new BoardImpl(vcc);
      board.setNetlist(parts, nets);

      const i = board.branchCurrent('LED1', 'anode');
      const iRef = Math.abs(ref['v1#branch'] ?? 0);

      if (vcc < 4.0) {
        // Below 2×Vf, LEDs may not conduct
        if (iRef < 0.0001) {
          assert.ok(i < 0.001, `${vcc}V: both off`);
        }
      } else if (iRef > 0.0001) {
        const ratio = i / iRef;
        assert.ok(ratio > 0.3 && ratio < 3.0,
          `${vcc}V series: bw-board=${(i*1000).toFixed(2)}mA, ngspice=${(iRef*1000).toFixed(2)}mA`);
      }
    });
  }
});

// ─── RC transient at fine time points ─────────────────────────────────────

describe('vs ngspice: RC charge at 9 time points', () => {
  for (const mult of [0.1, 0.2, 0.5, 0.7, 1.0, 1.5, 2.0, 3.0, 5.0]) {
    it(`${mult}RC`, () => {
      const ref = find(`rc_at_${mult}RC`);
      if (!ref) return;

      const { parts, nets } = new NetlistBuilder()
        .vcc('VCC').gnd('GND')
        .resistor('R1', 10000).capacitor('C1', 0.0001)
        .wire('VCC.vcc', 'R1.a').wire('R1.b', 'C1.a').wire('C1.b', 'GND.gnd')
        .build();

      const board = new BoardImpl(5.0);
      board.setNetlist(parts, nets);

      const tNs = BigInt(Math.round(ref.t * 1e9));
      board.advanceTo(tNs);

      const rcNet = nets.find(n => n.terminals.some(t => t.part === 'R1' && t.terminal === 'b'));
      const v = board.nodeVoltage(rcNet.id);

      assert.ok(Math.abs(v - ref.v_cap) < 0.15,
        `RC@${mult}RC: bw-board=${v.toFixed(3)}, ngspice=${ref.v_cap.toFixed(3)}`);
    });
  }
});

// ─── Summary ──────────────────────────────────────────────────────────────

describe('vs ngspice diode: count', () => {
  it(`${ngspice.result_count} oracles`, () => {
    assert.ok(ngspice.result_count >= 28);
  });
});
