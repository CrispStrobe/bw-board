/**
 * Builder → Board → getRenderState end-to-end: the exact flow
 * the circuit designer UI will use.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NetlistBuilder } from '../src/builder.js';
import { BoardImpl } from '../src/board.js';

describe('builder → render: active-low LED circuit', () => {
  it('builds, simulates, and renders in one flow', () => {
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

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', false);
    board.advanceTo(25_000_000n);

    const state = board.getRenderState();
    const led = state.leds.find(l => l.id === 'LED1');
    assert.ok(led);
    assert.ok(led.brightness > 0.13, `LED brightness: ${led.brightness}`);
    assert.equal(led.color, 'red');
    assert.equal(state.warnings.length, 0);
  });
});

describe('builder → render: pot + button', () => {
  it('controls appear in render state', () => {
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
      .wire('BTN.a', 'MCU.P3.2')
      .build();

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);
    board.setPin('P3.2', 'input', false);
    board.setControl('POT', 0.6);

    const state = board.getRenderState();
    assert.ok(state.controls.find(c => c.id === 'POT' && c.value === 0.6));
    assert.ok(state.controls.find(c => c.id === 'BTN' && c.value === 0));
  });
});

describe('builder → render: edit circuit live', () => {
  it('add component → rebuild → setNetlist → state updates', () => {
    const b = new NetlistBuilder()
      .vcc('VCC')
      .gnd('GND')
      .resistor('R1', 1000)
      .led('LED1', 2.0)
      .mcu('MCU', ['P1.0', 'P1.1'])
      .wire('VCC.vcc', 'R1.a')
      .wire('R1.b', 'LED1.anode')
      .wire('LED1.cathode', 'MCU.P1.0');

    const board = new BoardImpl(5.0);

    // Initial: one LED
    let { parts, nets } = b.build();
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(25_000_000n);
    assert.equal(board.getLeds().length, 1);

    // User drags a second LED onto the board
    b.resistor('R2', 470)
     .led('LED2', 3.2, 'blue')
     .wire('VCC.vcc', 'R2.a')
     .wire('R2.b', 'LED2.anode')
     .wire('LED2.cathode', 'MCU.P1.1');

    ({ parts, nets } = b.build());
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', false);
    board.setPin('P1.1', 'pushpull', false);
    board.advanceTo(75_000_000n); // past the 20ms brightness window

    assert.equal(board.getLeds().length, 2);
    const state = board.getRenderState();
    assert.ok(state.leds.find(l => l.id === 'LED1' && l.brightness > 0.1));
    assert.ok(state.leds.find(l => l.id === 'LED2' && l.brightness > 0.05));
    // Both LEDs on — blue with 470Ω is actually brighter than red with 1kΩ
    // because the lower resistance more than compensates for the higher Vf
  });
});

describe('builder → render: onChange fires on builder rebuild', () => {
  it('setNetlist from builder triggers onChange', () => {
    const board = new BoardImpl(5.0);
    const events = [];
    board.onChange(e => events.push(e.type));

    const { parts, nets } = new NetlistBuilder()
      .vcc('VCC').gnd('GND')
      .build();

    board.setNetlist(parts, nets);
    assert.ok(events.includes('netlist'));
  });
});
