/**
 * NetlistBuilder tests: fluent API for constructing valid netlists.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NetlistBuilder } from '../src/builder.js';
import { BoardImpl } from '../src/board.js';
import { validateNetlist } from '../src/validate.js';

describe('builder: basic circuit construction', () => {
  it('builds the active-low LED circuit', () => {
    const { parts, nets } = new NetlistBuilder()
      .vcc('VCC')
      .gnd('GND')
      .resistor('R1', 1000)
      .led('LED1', 2.0, 'red')
      .mcu('MCU', ['P1.0'])
      .wire('VCC.vcc', 'R1.a')
      .wire('R1.b', 'LED1.anode')
      .wire('LED1.cathode', 'MCU.P1.0')
      .build();

    assert.equal(parts.length, 5);
    assert.equal(nets.length, 3);

    // Should pass validation
    const errors = validateNetlist(parts, nets).filter(e => e.severity === 'error');
    assert.equal(errors.length, 0, errors.map(e => e.message).join('; '));

    // Should work with the board
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(25_000_000n);
    assert.ok(board.ledBrightness('LED1') > 0.10);
  });

  it('builds pot + button circuit', () => {
    const { parts, nets } = new NetlistBuilder()
      .vcc('VCC')
      .gnd('GND')
      .potentiometer('POT', 10000)
      .resistor('R_PU', 10000)
      .button('BTN')
      .mcu('MCU', ['P1.3', 'P3.2'])
      .wire('VCC.vcc', 'POT.a')
      .wire('VCC.vcc', 'R_PU.a')
      .wire('GND.gnd', 'POT.b')
      .wire('GND.gnd', 'BTN.b')
      .wire('POT.wiper', 'MCU.P1.3')
      .wire('R_PU.b', 'BTN.a')
      .wire('R_PU.b', 'MCU.P3.2')
      .build();

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);
    board.setPin('P3.2', 'input', false);
    board.setControl('POT', 0.5);

    assert.ok(Math.abs(board.readAnalog('P1.3') - 2.5) < 0.1);
    assert.equal(board.readPin('P3.2'), 1, 'button not pressed');
  });
});

describe('builder: validation at wire time', () => {
  it('throws on unknown part', () => {
    const b = new NetlistBuilder().vcc('VCC');
    assert.throws(() => b.wire('VCC.vcc', 'NOPE.a'), /Unknown part/);
  });

  it('throws on wrong terminal name', () => {
    const b = new NetlistBuilder().vcc('VCC').led('LED1');
    assert.throws(() => b.wire('VCC.vcc', 'LED1.a'), /no terminal "a"/);
  });

  it('throws on missing dot', () => {
    const b = new NetlistBuilder().vcc('VCC');
    assert.throws(() => b.wire('VCC', 'something'), /Invalid terminal reference/);
  });

  it('throws on duplicate part id', () => {
    const b = new NetlistBuilder().vcc('X');
    assert.throws(() => b.gnd('X'), /Duplicate part id/);
  });
});

describe('builder: net merging', () => {
  it('three wires to same node create one net', () => {
    const { nets } = new NetlistBuilder()
      .vcc('VCC')
      .gnd('GND')
      .resistor('R1', 1000)
      .resistor('R2', 1000)
      .mcu('MCU', ['P1.0'])
      .wire('R1.b', 'R2.a')
      .wire('R2.a', 'MCU.P1.0') // should merge into same net as R1.b
      .build();

    // R1.b, R2.a, MCU.P1.0 should all be on the same net
    const jointNet = nets.find(n =>
      n.terminals.some(t => t.part === 'R1' && t.terminal === 'b') &&
      n.terminals.some(t => t.part === 'R2' && t.terminal === 'a') &&
      n.terminals.some(t => t.part === 'MCU' && t.terminal === 'P1.0')
    );
    assert.ok(jointNet, 'all three should be on one net');
  });

  it('wiring already-connected terminals is a no-op', () => {
    const { nets } = new NetlistBuilder()
      .vcc('VCC')
      .gnd('GND')
      .resistor('R1', 1000)
      .wire('VCC.vcc', 'R1.a')
      .wire('VCC.vcc', 'R1.a') // duplicate
      .build();

    assert.equal(nets.length, 1);
  });
});

describe('builder: all component types', () => {
  it('every component type can be added', () => {
    const b = new NetlistBuilder()
      .vcc('V').gnd('G')
      .resistor('R', 1000)
      .capacitor('C', 0.0001)
      .inductor('L', 0.01)
      .led('LED')
      .diode('D')
      .zener('Z', 0.7, 5.1)
      .potentiometer('POT')
      .button('BTN')
      .switch('SW')
      .buzzer('BUZ')
      .ldr('LDR')
      .ntc('NTC')
      .npn('Q1')
      .pnp('Q2')
      .mcu('MCU', ['P1.0']);

    const { parts } = b.build();
    assert.equal(parts.length, 17);
  });
});

describe('builder: end-to-end with board', () => {
  it('NPN LED driver built with builder', () => {
    const { parts, nets } = new NetlistBuilder()
      .vcc('VCC')
      .gnd('GND')
      .resistor('R_LED', 1000)
      .led('LED1', 2.0)
      .npn('Q1', 100)
      .resistor('R_BASE', 10000)
      .mcu('MCU', ['P1.0'])
      .wire('VCC.vcc', 'R_LED.a')
      .wire('R_LED.b', 'LED1.anode')
      .wire('LED1.cathode', 'Q1.collector')
      .wire('Q1.emitter', 'GND.gnd')
      .wire('MCU.P1.0', 'R_BASE.a')
      .wire('R_BASE.b', 'Q1.base')
      .build();

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    board.setPin('P1.0', 'pushpull', true); // base high → LED on
    const iOn = board.branchCurrent('LED1', 'anode');
    assert.ok(iOn > 0.001, `LED on through NPN: ${(iOn * 1000).toFixed(2)} mA`);

    board.setPin('P1.0', 'pushpull', false); // base low → LED off
    const iOff = board.branchCurrent('LED1', 'anode');
    assert.ok(iOff < 0.0001, `LED off: ${(iOff * 1000).toFixed(3)} mA`);
  });
});
