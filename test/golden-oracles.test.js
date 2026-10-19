/**
 * Golden oracle tests: compare bw-board solver output against
 * independently computed reference values from compute_oracles.py.
 *
 * The oracle values are NOT derived from bw-board — they are computed
 * from first principles in Python (Ohm's law, KCL, KVL, exponential RC).
 * This makes them a true oracle, not a snapshot of our own output.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BoardImpl } from '../src/board.js';
import { NetlistBuilder } from '../src/builder.js';
import { pinThevenin } from '../src/pin-model.js';

const oracleFile = JSON.parse(
  readFileSync(new URL('./golden/oracles.json', import.meta.url), 'utf-8')
);
const oracles = oracleFile.oracles;

function findOracle(name) {
  return oracles.find(o => o.name === name);
}

// ─── Voltage dividers ─────────────────────────────────────────────────────

describe('golden: voltage dividers', () => {
  const dividerOracles = oracles.filter(o => o.circuit.type === 'voltage_divider');

  for (const oracle of dividerOracles) {
    const { r1, r2, vcc } = oracle.circuit;
    it(`${r1}Ω / ${r2}Ω → ${oracle.expected.v_mid}V`, () => {
      const { parts, nets } = new NetlistBuilder()
        .vcc('VCC').gnd('GND')
        .resistor('R1', r1).resistor('R2', r2)
        .wire('VCC.vcc', 'R1.a')
        .wire('R1.b', 'R2.a')
        .wire('R2.b', 'GND.gnd')
        .build();

      const board = new BoardImpl(vcc);
      board.setNetlist(parts, nets);

      const v = board.nodeVoltage(nets.find(n =>
        n.terminals.some(t => t.part === 'R1' && t.terminal === 'b')
      ).id);

      assert.ok(Math.abs(v - oracle.expected.v_mid) < 0.01,
        `V_mid: ${v} vs oracle ${oracle.expected.v_mid}`);
    });
  }
});

// ─── LED circuits ─────────────────────────────────────────────────────────

describe('golden: LED circuits', () => {
  const ledOracles = oracles.filter(o => o.circuit.type === 'led_circuit');

  for (const oracle of ledOracles) {
    const { r, vf, vcc, rd, r_pin } = oracle.circuit;
    it(`LED Vf=${vf}V, R=${r}Ω → ${oracle.expected.current_mA.toFixed(2)} mA`, () => {
      const { parts, nets } = new NetlistBuilder()
        .vcc('VCC').gnd('GND')
        .resistor('R1', r)
        .led('LED1', vf)
        .mcu('MCU', ['P1.0'])
        .wire('VCC.vcc', 'R1.a')
        .wire('R1.b', 'LED1.anode')
        .wire('LED1.cathode', 'MCU.P1.0')
        .build();

      const board = new BoardImpl(vcc);
      board.setNetlist(parts, nets);
      board.setPin('P1.0', 'pushpull', false);
      board.advanceTo(25_000_000n);

      const brightness = board.ledBrightness('LED1');
      assert.ok(Math.abs(brightness - oracle.expected.brightness) < 0.02,
        `brightness: ${brightness} vs oracle ${oracle.expected.brightness}`);
    });
  }
});

// ─── Active-low lesson ────────────────────────────────────────────────────

describe('golden: active-low LED lesson', () => {
  it('quasi sink: LED bright (the correct wiring)', () => {
    const oracle = findOracle('active_low_quasi_sink');
    const { parts, nets } = new NetlistBuilder()
      .vcc('VCC').gnd('GND')
      .resistor('R1', 1000).led('LED1', 2.0)
      .mcu('MCU', ['P1.0'])
      .wire('VCC.vcc', 'R1.a')
      .wire('R1.b', 'LED1.anode')
      .wire('LED1.cathode', 'MCU.P1.0')
      .build();

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', false);
    board.advanceTo(25_000_000n);

    assert.ok(Math.abs(board.ledBrightness('LED1') - oracle.expected.brightness) < 0.02);
  });

  it('quasi source: LED off (both sides at VCC)', () => {
    const oracle = findOracle('active_low_quasi_source');
    const { parts, nets } = new NetlistBuilder()
      .vcc('VCC').gnd('GND')
      .resistor('R1', 1000).led('LED1', 2.0)
      .mcu('MCU', ['P1.0'])
      .wire('VCC.vcc', 'R1.a')
      .wire('R1.b', 'LED1.anode')
      .wire('LED1.cathode', 'MCU.P1.0')
      .build();

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', true);
    board.advanceTo(25_000_000n);

    assert.ok(board.ledBrightness('LED1') < 0.01,
      `quasi source: brightness ${board.ledBrightness('LED1')} ≈ 0`);
  });

  it('naive wiring + quasi high: barely visible', () => {
    const oracle = findOracle('naive_wiring_quasi_high');
    const { parts, nets } = new NetlistBuilder()
      .vcc('VCC').gnd('GND')
      .resistor('R1', 1000).led('LED1', 2.0)
      .mcu('MCU', ['P1.0'])
      .wire('MCU.P1.0', 'R1.a')
      .wire('R1.b', 'LED1.anode')
      .wire('LED1.cathode', 'GND.gnd')
      .build();

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', true);
    board.advanceTo(25_000_000n);

    const b = board.ledBrightness('LED1');
    assert.ok(Math.abs(b - oracle.expected.brightness) < 0.005,
      `naive quasi: ${b} vs oracle ${oracle.expected.brightness}`);
  });
});

// ─── RC charge curves ─────────────────────────────────────────────────────

describe('golden: RC charge curves', () => {
  const rcOracles = oracles.filter(o => o.circuit.type === 'rc_charge');

  for (const oracle of rcOracles) {
    const { r, c, vcc, t_seconds, t_rc_multiples } = oracle.circuit;
    it(`R=${r}Ω C=${c}F at ${t_rc_multiples}RC → ${oracle.expected.voltage.toFixed(3)}V`, () => {
      const { parts, nets } = new NetlistBuilder()
        .vcc('VCC').gnd('GND')
        .resistor('R1', r).capacitor('C1', c)
        .wire('VCC.vcc', 'R1.a')
        .wire('R1.b', 'C1.a')
        .wire('C1.b', 'GND.gnd')
        .build();

      const board = new BoardImpl(vcc);
      board.setNetlist(parts, nets);

      const tNs = BigInt(Math.round(t_seconds * 1e9));
      board.advanceTo(tNs);

      const rcNet = nets.find(n =>
        n.terminals.some(t => t.part === 'R1' && t.terminal === 'b')
      );
      const v = board.nodeVoltage(rcNet.id);

      assert.ok(Math.abs(v - oracle.expected.voltage) < 0.1,
        `RC at ${t_rc_multiples}RC: ${v} vs oracle ${oracle.expected.voltage}`);
    });
  }
});

// ─── Wheatstone bridge ────────────────────────────────────────────────────

describe('golden: Wheatstone bridge', () => {
  const bridgeOracles = oracles.filter(o => o.circuit.type === 'wheatstone');

  for (const oracle of bridgeOracles) {
    const { r1, r2, r3, r4, vcc } = oracle.circuit;
    it(`${r1}/${r2}/${r3}/${r4} → V_bridge=${oracle.expected.v_bridge.toFixed(3)}V`, () => {
      const { parts, nets } = new NetlistBuilder()
        .vcc('VCC').gnd('GND')
        .resistor('R1', r1).resistor('R2', r2)
        .resistor('R3', r3).resistor('R4', r4)
        .wire('VCC.vcc', 'R1.a')
        .wire('VCC.vcc', 'R2.a')
        .wire('R1.b', 'R3.a')
        .wire('R2.b', 'R4.a')
        .wire('R3.b', 'GND.gnd')
        .wire('R4.b', 'GND.gnd')
        .build();

      const board = new BoardImpl(vcc);
      board.setNetlist(parts, nets);

      const netA = nets.find(n =>
        n.terminals.some(t => t.part === 'R1' && t.terminal === 'b')
      );
      const netB = nets.find(n =>
        n.terminals.some(t => t.part === 'R2' && t.terminal === 'b')
      );

      const vA = board.nodeVoltage(netA.id);
      const vB = board.nodeVoltage(netB.id);

      assert.ok(Math.abs(vA - oracle.expected.v_a) < 0.02,
        `VA: ${vA} vs oracle ${oracle.expected.v_a}`);
      assert.ok(Math.abs(vB - oracle.expected.v_b) < 0.02,
        `VB: ${vB} vs oracle ${oracle.expected.v_b}`);
    });
  }
});

// ─── Potentiometer ────────────────────────────────────────────────────────

describe('golden: potentiometer', () => {
  const potOracles = oracles.filter(o => o.circuit.type === 'potentiometer');

  for (const oracle of potOracles) {
    it(`position ${oracle.circuit.position} → ${oracle.expected.v_wiper}V`, () => {
      const { parts, nets } = new NetlistBuilder()
        .vcc('VCC').gnd('GND')
        .potentiometer('POT', 10000)
        .mcu('MCU', ['P1.3'])
        .wire('VCC.vcc', 'POT.a')
        .wire('POT.b', 'GND.gnd')
        .wire('POT.wiper', 'MCU.P1.3')
        .build();

      const board = new BoardImpl(oracle.circuit.vcc);
      board.setNetlist(parts, nets);
      board.setPin('P1.3', 'input', false);
      board.setControl('POT', oracle.circuit.position);

      const v = board.readAnalog('P1.3');
      assert.ok(Math.abs(v - oracle.expected.v_wiper) < 0.01,
        `pot ${oracle.circuit.position}: ${v} vs oracle ${oracle.expected.v_wiper}`);
    });
  }
});

// ─── PWM brightness ──────────────────────────────────────────────────────

describe('golden: PWM brightness', () => {
  const pwmOracles = oracles.filter(o => o.circuit.type === 'pwm_brightness');

  for (const oracle of pwmOracles) {
    it(`${oracle.circuit.duty * 100}% duty → brightness ${oracle.expected.brightness.toFixed(4)}`, () => {
      const { parts, nets } = new NetlistBuilder()
        .vcc('VCC')
        .resistor('R1', oracle.circuit.r)
        .led('LED1', oracle.circuit.vf)
        .mcu('MCU', ['P1.0'])
        .wire('VCC.vcc', 'R1.a')
        .wire('R1.b', 'LED1.anode')
        .wire('LED1.cathode', 'MCU.P1.0')
        .build();

      const board = new BoardImpl(oracle.circuit.vcc);
      board.setNetlist(parts, nets);

      const duty = oracle.circuit.duty;
      const periodNs = 1_000_000n;
      const onNs = BigInt(Math.round(1_000_000 * duty));

      for (let i = 0; i < 30; i++) {
        const t = BigInt(i) * periodNs;
        board.advanceTo(t);
        board.setPin('P1.0', 'pushpull', false); // on
        board.advanceTo(t + onNs);
        board.setPin('P1.0', 'pushpull', true);  // off
      }
      board.advanceTo(30n * periodNs);

      const b = board.ledBrightness('LED1');
      assert.ok(Math.abs(b - oracle.expected.brightness) < 0.02,
        `PWM ${duty * 100}%: ${b} vs oracle ${oracle.expected.brightness}`);
    });
  }
});

// ─── Thévenin pin model ──────────────────────────────────────────────────

describe('golden: Thévenin pin model', () => {
  const thevOracles = oracles.filter(o => o.circuit.type === 'pin_thevenin');

  for (const oracle of thevOracles) {
    it(`${oracle.circuit.mode} ${oracle.circuit.drive} → Vth=${oracle.expected.vth}, Rth=${oracle.expected.rth}`, () => {
      // pinThevenin imported at top level
      const driveHigh = oracle.circuit.drive === 'high';
      const t = pinThevenin(oracle.circuit.mode, driveHigh, oracle.circuit.vcc);

      if (oracle.expected.rth === 0 && oracle.expected.vth === 0) {
        // high-Z
        assert.equal(t, 'high-z');
      } else {
        assert.notEqual(t, 'high-z');
        assert.equal(t.vTh, oracle.expected.vth);
        assert.equal(t.rTh, oracle.expected.rth);
      }
    });
  }
});

// ─── Summary ─────────────────────────────────────────────────────────────

describe('golden: oracle count', () => {
  it(`loaded ${oracles.length} oracle values`, () => {
    assert.ok(oracles.length >= 50, `should have ≥50 oracles, got ${oracles.length}`);
  });
});
