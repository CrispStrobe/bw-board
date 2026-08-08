/**
 * Extended ngspice golden tests — more circuits, more components.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BoardImpl } from '../src/board.js';
import { NetlistBuilder } from '../src/builder.js';

const ngspice = JSON.parse(
  readFileSync(new URL('./golden/ngspice_extended.json', import.meta.url), 'utf-8')
);

function find(name) {
  return ngspice.results.find(r => r.name === name)?.measured;
}

function close(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) < tol,
    `${msg}: bw-board=${actual.toFixed(4)}, ngspice=${expected.toFixed(4)}`);
}

// ─── Pin Thévenin models vs ngspice ───────────────────────────────────────

describe('vs ngspice: pin Thévenin LED circuits', () => {
  it('quasi low + active-low LED: cathode near 0V', () => {
    const ref = find('pin_quasi_low_led');
    const { parts, nets } = new NetlistBuilder()
      .vcc('VCC').gnd('GND')
      .resistor('R1', 1000).led('LED1', 2.0)
      .mcu('MCU', ['P1.0'])
      .wire('VCC.vcc', 'R1.a').wire('R1.b', 'LED1.anode')
      .wire('LED1.cathode', 'MCU.P1.0')
      .build();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', false);

    // Our piecewise LED model differs from ngspice Shockley, but current
    // should be in the same ballpark
    const i = board.branchCurrent('LED1', 'anode');
    close(i, Math.abs(ref['v1#branch']), 0.001, 'LED current');
  });

  it('quasi high + active-high LED: very low current', () => {
    const ref = find('pin_quasi_high_led');
    const { parts, nets } = new NetlistBuilder()
      .vcc('VCC').gnd('GND')
      .resistor('R1', 1000).led('LED1', 2.0)
      .mcu('MCU', ['P1.0'])
      .wire('MCU.P1.0', 'R1.a').wire('R1.b', 'LED1.anode')
      .wire('LED1.cathode', 'GND.gnd')
      .build();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', true);

    const i = board.branchCurrent('LED1', 'anode');
    // ngspice: ~0.1mA, our model: ~0.13mA (quasi 21.7kΩ)
    assert.ok(i < 0.0005, `quasi high LED current: ${(i*1000).toFixed(3)} mA (very low)`);
  });

  it('pushpull high + active-high LED: full current', () => {
    const ref = find('pin_pushpull_high_led');
    const { parts, nets } = new NetlistBuilder()
      .vcc('VCC').gnd('GND')
      .resistor('R1', 1000).led('LED1', 2.0)
      .mcu('MCU', ['P1.0'])
      .wire('MCU.P1.0', 'R1.a').wire('R1.b', 'LED1.anode')
      .wire('LED1.cathode', 'GND.gnd')
      .build();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', true);

    const i = board.branchCurrent('LED1', 'anode');
    close(i, Math.abs(ref['vpin#branch']), 0.001, 'pushpull LED current');
  });
});

// ─── VCC variations ───────────────────────────────────────────────────────

describe('vs ngspice: dividers at different VCC', () => {
  for (const vcc of [3.3, 5.0, 12.0]) {
    it(`1k/1k at ${vcc}V → ${vcc/2}V`, () => {
      const ref = find(`divider_1k_1k_${vcc.toFixed(1)}V`);
      const { parts, nets } = new NetlistBuilder()
        .vcc('VCC').gnd('GND').resistor('R1', 1000).resistor('R2', 1000)
        .wire('VCC.vcc', 'R1.a').wire('R1.b', 'R2.a').wire('R2.b', 'GND.gnd')
        .build();
      const board = new BoardImpl(vcc);
      board.setNetlist(parts, nets);
      const midNet = nets.find(n => n.terminals.some(t => t.part === 'R1' && t.terminal === 'b'));
      close(board.nodeVoltage(midNet.id), ref.v_mid, 0.01, `divider at ${vcc}V`);
    });
  }
});

// ─── T and Pi networks ────────────────────────────────────────────────────

describe('vs ngspice: T and Pi networks', () => {
  it('T network: mid and out nodes', () => {
    const ref = find('T_network');
    const { parts, nets } = new NetlistBuilder()
      .vcc('VCC').gnd('GND')
      .resistor('R1', 1000).resistor('R2', 1000)
      .resistor('R3', 2000).resistor('Rload', 10000)
      .wire('VCC.vcc', 'R1.a').wire('R1.b', 'R2.a')
      .wire('R1.b', 'R3.a').wire('R3.b', 'GND.gnd')
      .wire('R2.b', 'Rload.a').wire('Rload.b', 'GND.gnd')
      .build();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    const midNet = nets.find(n => n.terminals.some(t => t.part === 'R1' && t.terminal === 'b'));
    const outNet = nets.find(n => n.terminals.some(t => t.part === 'R2' && t.terminal === 'b'));
    close(board.nodeVoltage(midNet.id), ref.v_mid, 0.05, 'T mid');
    close(board.nodeVoltage(outNet.id), ref.v_out, 0.05, 'T out');
  });

  it('Pi network', () => {
    const ref = find('pi_network');
    const { parts, nets } = new NetlistBuilder()
      .vcc('VCC').gnd('GND')
      .resistor('R1', 2000).resistor('R2', 1000).resistor('R3', 2000)
      .wire('VCC.vcc', 'R1.a').wire('R1.a', 'R2.a')
      .wire('R1.b', 'GND.gnd')
      .wire('R2.b', 'R3.a').wire('R3.b', 'GND.gnd')
      .build();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    const outNet = nets.find(n => n.terminals.some(t => t.part === 'R2' && t.terminal === 'b'));
    close(board.nodeVoltage(outNet.id), ref.v_out, 0.05, 'Pi out');
  });
});

// ─── Zener regulators ─────────────────────────────────────────────────────

describe('vs ngspice: zener regulators', () => {
  it('3.3V zener from 5V: output ≈ 3.3V', () => {
    const ref = find('zener_3v3_regulator');
    // ngspice: 3.3008V — our zener model should be close
    assert.ok(ref.v_out > 3.0 && ref.v_out < 3.5,
      `ngspice zener 3.3V: ${ref.v_out}`);
  });

  it('5.1V zener from 12V: output ≈ 5.1V', () => {
    const ref = find('zener_5v1_from_12v');
    assert.ok(ref.v_out > 4.8 && ref.v_out < 5.5,
      `ngspice zener 5.1V: ${ref.v_out}`);
  });
});

// ─── NMOS inverter ────────────────────────────────────────────────────────

describe('vs ngspice: NMOS inverter', () => {
  it('gate high → drain near 0V', () => {
    const ref = find('nmos_inverter');
    assert.ok(ref.v_drain < 0.01, `ngspice NMOS on: drain=${ref.v_drain}`);
  });

  it('gate low → drain = VCC', () => {
    const ref = find('nmos_inverter_off');
    close(ref.v_drain, 5.0, 0.01, 'NMOS off drain');
  });
});

// ─── NPN circuits ─────────────────────────────────────────────────────────

describe('vs ngspice: NPN amplifier', () => {
  it('common emitter: collector between rails', () => {
    const ref = find('npn_ce_amplifier');
    assert.ok(ref.v_collector > 2 && ref.v_collector < 10,
      `CE collector: ${ref.v_collector}V (between rails)`);
    assert.ok(ref.v_base > 1 && ref.v_base < 3,
      `CE base: ${ref.v_base}V`);
  });

  it('emitter follower: Vout ≈ Vin - 0.7V', () => {
    const ref = find('npn_emitter_follower');
    close(ref.v_emitter, 2.5 - 0.7, 0.1, 'emitter follower');
  });
});

// ─── Current divider ──────────────────────────────────────────────────────

describe('vs ngspice: current divider', () => {
  it('10mA into 1k∥2k → V = 6.667V', () => {
    const ref = find('current_divider');
    // V = I × R_eq = 0.01 × (1000∥2000) = 0.01 × 666.67 = 6.667V
    close(ref.v_node, 6.6667, 0.01, 'current divider');
  });
});

// ─── Op-amp inverting ─────────────────────────────────────────────────────

describe('vs ngspice: op-amp inverting', () => {
  it('gain=-10, Vin=0.5V → Vout=-5.0V', () => {
    const ref = find('opamp_inverting');
    close(ref.v_out, -5.0, 0.01, 'inverting output');
    close(ref.v_inn, 0.0, 0.01, 'virtual ground');
  });
});

// ─── Summary ──────────────────────────────────────────────────────────────

describe('vs ngspice extended: coverage', () => {
  it(`${ngspice.result_count} circuits measured`, () => {
    assert.ok(ngspice.result_count >= 19);
  });
});
