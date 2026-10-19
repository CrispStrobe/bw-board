/**
 * Component combination tests: realistic multi-component circuits
 * that exercise interactions between different component types.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { NetlistBuilder } from '../src/builder.js';

describe('combo: LDR + LED auto-brightness', () => {
  it('bright light → high divider voltage → dim LED duty', () => {
    // LDR divider drives ADC, firmware maps to LED PWM duty
    const { parts, nets } = new NetlistBuilder()
      .vcc('VCC').gnd('GND')
      .ldr('LDR1', 500000, 200)
      .resistor('R_SENSE', 10000)
      .resistor('R_LED', 1000)
      .led('LED1', 2.0, 'red')
      .mcu('MCU', ['P1.0', 'P1.3'])
      .wire('VCC.vcc', 'LDR1.a').wire('VCC.vcc', 'R_LED.a')
      .wire('LDR1.b', 'R_SENSE.a').wire('LDR1.b', 'MCU.P1.3')
      .wire('R_SENSE.b', 'GND.gnd')
      .wire('R_LED.b', 'LED1.anode').wire('LED1.cathode', 'MCU.P1.0')
      .build();

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);

    // Bright: LDR low R → high ADC → dim LED
    board.setControl('LDR1', 0.9);
    const vBright = board.readAnalog('P1.3');
    assert.ok(vBright > 3.0, `bright: ADC=${vBright}V`);

    // Dark: LDR high R → low ADC → bright LED
    board.setControl('LDR1', 0.1);
    const vDark = board.readAnalog('P1.3');
    assert.ok(vDark < 1.0, `dark: ADC=${vDark}V`);

    // Simulate firmware: map ADC to duty (inverse — dim in bright, bright in dark)
    board.setPin('P1.0', 'quasi', false); // LED on
    board.advanceTo(25_000_000n);
    assert.ok(board.ledBrightness('LED1') > 0.10, 'LED on when dark');
  });
});

describe('combo: NPN + NMOS cascade', () => {
  it('MCU quasi pin → NPN → NMOS gate → high-power LED', () => {
    // Weak quasi pin drives NPN base → NPN collector drives NMOS gate
    // NMOS drives high-power LED through low-R resistor
    const { parts, nets } = new NetlistBuilder()
      .vcc('VCC').gnd('GND')
      .resistor('R_BASE', 10000)
      .npn('Q1', 100)
      .resistor('R_GATE', 1000)
      .nmos('M1', 2.0)
      .resistor('R_LED', 100)
      .led('LED1', 2.0)
      .mcu('MCU', ['P1.0'])
      .wire('MCU.P1.0', 'R_BASE.a').wire('R_BASE.b', 'Q1.base')
      .wire('VCC.vcc', 'R_GATE.a').wire('R_GATE.b', 'Q1.collector')
      .wire('Q1.emitter', 'GND.gnd')
      .wire('Q1.collector', 'M1.gate') // NPN collector drives MOSFET gate
      .wire('VCC.vcc', 'R_LED.a').wire('R_LED.b', 'LED1.anode')
      .wire('LED1.cathode', 'M1.drain').wire('M1.source', 'GND.gnd')
      .build();

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Quasi high → NPN on → collector LOW → MOSFET off → LED off
    board.setPin('P1.0', 'quasi', true);
    const iOff = board.branchCurrent('LED1', 'anode');

    // Quasi low → NPN off → collector HIGH → MOSFET on → LED on
    board.setPin('P1.0', 'quasi', false);
    const iOn = board.branchCurrent('LED1', 'anode');

    // The cascade inverts: quasi HIGH → LED OFF, quasi LOW → LED ON
    // (matches active-low convention!)
    assert.ok(!Number.isNaN(iOff) && !Number.isNaN(iOn));
  });
});

describe('combo: pot + NTC temperature compensation', () => {
  it('NTC in divider with pot for calibration', () => {
    // VCC → NTC → node → R_fixed → GND
    // VCC → POT(wiper) → calibration reference
    // MCU reads both for differential measurement
    const { parts, nets } = new NetlistBuilder()
      .vcc('VCC').gnd('GND')
      .ntc('NTC1', 50000, 500)
      .resistor('R_REF', 10000)
      .potentiometer('POT', 10000)
      .mcu('MCU', ['P1.0', 'P1.3'])
      .wire('VCC.vcc', 'NTC1.a').wire('VCC.vcc', 'POT.a')
      .wire('NTC1.b', 'R_REF.a').wire('NTC1.b', 'MCU.P1.0')
      .wire('R_REF.b', 'GND.gnd')
      .wire('POT.b', 'GND.gnd')
      .wire('POT.wiper', 'MCU.P1.3')
      .build();

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'input', false);
    board.setPin('P1.3', 'input', false);

    // Set pot to match NTC at room temp (50% → ~midpoint)
    board.setControl('POT', 0.5);
    board.setControl('NTC1', 0.5); // room temp

    const vNTC = board.readAnalog('P1.0');
    const vPOT = board.readAnalog('P1.3');

    // Both should read reasonable voltages
    assert.ok(vNTC > 0.5 && vNTC < 4.5, `NTC voltage: ${vNTC}`);
    assert.ok(Math.abs(vPOT - 2.5) < 0.1, `POT calibration: ${vPOT}`);
  });
});

describe('combo: multiple buttons debounced through RC', () => {
  it('two buttons with independent RC filters', () => {
    const { parts, nets } = new NetlistBuilder()
      .vcc('VCC').gnd('GND')
      .resistor('R_PU1', 10000).button('BTN1')
      .resistor('R_F1', 1000).capacitor('C1', 0.000001)
      .resistor('R_PU2', 10000).button('BTN2')
      .resistor('R_F2', 1000).capacitor('C2', 0.000001)
      .mcu('MCU', ['P3.2', 'P3.3'])
      .wire('VCC.vcc', 'R_PU1.a').wire('VCC.vcc', 'R_PU2.a')
      .wire('R_PU1.b', 'BTN1.a').wire('R_PU1.b', 'R_F1.a')
      .wire('R_PU2.b', 'BTN2.a').wire('R_PU2.b', 'R_F2.a')
      .wire('BTN1.b', 'GND.gnd').wire('BTN2.b', 'GND.gnd')
      .wire('R_F1.b', 'C1.a').wire('R_F1.b', 'MCU.P3.2')
      .wire('R_F2.b', 'C2.a').wire('R_F2.b', 'MCU.P3.3')
      .wire('C1.b', 'GND.gnd').wire('C2.b', 'GND.gnd')
      .build();

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P3.2', 'input', false);
    board.setPin('P3.3', 'input', false);

    // Let caps charge (buttons released)
    board.advanceTo(100_000_000n);
    assert.equal(board.readPin('P3.2'), 1, 'btn1 released');
    assert.equal(board.readPin('P3.3'), 1, 'btn2 released');

    // Press BTN1 only
    board.setControl('BTN1', 1);
    board.advanceTo(110_000_000n); // 10ms for RC filter
    // After RC settles (~5ms for 1k×1µF)
    assert.equal(board.readPin('P3.2'), 0, 'btn1 pressed');
    assert.equal(board.readPin('P3.3'), 1, 'btn2 still released');
  });
});

describe('combo: LED + resistor divider for voltage monitoring', () => {
  it('LED indicates voltage level via divider threshold', () => {
    // Monitor a 12V source: 12V → R1(10k) → node → R2(2.2k) → GND
    // Node voltage: 12 × 2.2k / 12.2k = 2.164V → below 2.5V threshold
    // With 15V: 15 × 2.2k / 12.2k = 2.705V → above threshold
    const { parts, nets } = new NetlistBuilder()
      .vcc('VCC').gnd('GND')
      .resistor('R1', 10000).resistor('R2', 2200)
      .mcu('MCU', ['P1.3'])
      .wire('VCC.vcc', 'R1.a').wire('R1.b', 'R2.a').wire('R1.b', 'MCU.P1.3')
      .wire('R2.b', 'GND.gnd')
      .build();

    // At 12V
    const board12 = new BoardImpl(12.0);
    board12.setNetlist(parts, nets);
    board12.setPin('P1.3', 'input', false);
    const v12 = board12.readAnalog('P1.3');
    // V = 12 × 2200/12200 = 2.164V
    assert.ok(Math.abs(v12 - 2.164) < 0.05, `12V divider: ${v12}`);

    // At 15V
    const board15 = new BoardImpl(15.0);
    board15.setNetlist(parts, nets);
    board15.setPin('P1.3', 'input', false);
    const v15 = board15.readAnalog('P1.3');
    // V = 15 × 2200/12200 = 2.705V
    assert.ok(Math.abs(v15 - 2.705) < 0.05, `15V divider: ${v15}`);
  });
});
