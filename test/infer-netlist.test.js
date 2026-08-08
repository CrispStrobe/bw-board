/**
 * Test: inferNetlist — boundary C.
 *
 * Verifies that project.stc.pins are correctly converted into a netlist
 * with the expected default wiring, and that the reverse check catches
 * common mistakes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inferNetlist, checkWiring } from '../src/infer-netlist.js';
import { BoardImpl } from '../src/board.js';

describe('inferNetlist', () => {
  it('output active-low → VCC → 1kΩ → LED → pin', () => {
    const result = inferNetlist({
      pins: [
        { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
      ],
    });

    // Should have: VCC, GND, MCU, R_led1, LED_led1
    assert.equal(result.parts.length, 5);
    assert.ok(result.parts.some(p => p.id === 'R_led1' && p.kind === 'resistor'));
    assert.ok(result.parts.some(p => p.id === 'LED_led1' && p.kind === 'led'));

    // MCU should have P1.0 terminal
    const mcu = result.parts.find(p => p.kind === 'mcu');
    assert.ok(mcu.terminals.includes('P1.0'));

    // VCC net should include R_led1.a
    const vccNet = result.nets.find(n => n.id === 'net_vcc');
    assert.ok(vccNet.terminals.some(t => t.part === 'R_led1' && t.terminal === 'a'));

    // LED cathode should connect to MCU P1.0
    const pinNet = result.nets.find(n => n.id === 'net_led1_pin');
    assert.ok(pinNet);
    assert.ok(pinNet.terminals.some(t => t.part === 'LED_led1' && t.terminal === 'cathode'));
    assert.ok(pinNet.terminals.some(t => t.part === 'MCU' && t.terminal === 'P1.0'));
  });

  it('output active-high → pin → 1kΩ → LED → GND', () => {
    const result = inferNetlist({
      pins: [
        { name: 'led2', port: 1, bit: 1, direction: 'output', activeLow: false },
      ],
    });

    // LED cathode should connect to GND
    const gndNet = result.nets.find(n => n.id === 'net_gnd');
    assert.ok(gndNet.terminals.some(t => t.part === 'LED_led2' && t.terminal === 'cathode'));

    // MCU pin should connect to R.a
    const pinNet = result.nets.find(n => n.id === 'net_led2_pin_r');
    assert.ok(pinNet);
    assert.ok(pinNet.terminals.some(t => t.part === 'MCU' && t.terminal === 'P1.1'));
    assert.ok(pinNet.terminals.some(t => t.part === 'R_led2' && t.terminal === 'a'));
  });

  it('analog → potentiometer VCC/GND, wiper → pin', () => {
    const result = inferNetlist({
      pins: [
        { name: 'pot', port: 1, bit: 3, direction: 'analog', activeLow: false },
      ],
    });

    assert.ok(result.parts.some(p => p.id === 'POT_pot' && p.kind === 'potentiometer'));

    const vccNet = result.nets.find(n => n.id === 'net_vcc');
    assert.ok(vccNet.terminals.some(t => t.part === 'POT_pot' && t.terminal === 'a'));

    const gndNet = result.nets.find(n => n.id === 'net_gnd');
    assert.ok(gndNet.terminals.some(t => t.part === 'POT_pot' && t.terminal === 'b'));

    const wiperNet = result.nets.find(n => n.id === 'net_pot_wiper');
    assert.ok(wiperNet);
    assert.ok(wiperNet.terminals.some(t => t.part === 'POT_pot' && t.terminal === 'wiper'));
    assert.ok(wiperNet.terminals.some(t => t.part === 'MCU' && t.terminal === 'P1.3'));
  });

  it('input → button to GND with pull-up', () => {
    const result = inferNetlist({
      pins: [
        { name: 'button', port: 3, bit: 2, direction: 'input', activeLow: false },
      ],
    });

    assert.ok(result.parts.some(p => p.id === 'R_PU_button' && p.kind === 'resistor'));
    assert.ok(result.parts.some(p => p.id === 'BTN_button' && p.kind === 'button'));

    // Pull-up to VCC
    const vccNet = result.nets.find(n => n.id === 'net_vcc');
    assert.ok(vccNet.terminals.some(t => t.part === 'R_PU_button' && t.terminal === 'a'));

    // Button to GND
    const gndNet = result.nets.find(n => n.id === 'net_gnd');
    assert.ok(gndNet.terminals.some(t => t.part === 'BTN_button' && t.terminal === 'b'));

    // Pin net has pull-up, button, and MCU
    const pinNet = result.nets.find(n => n.id === 'net_button_pin');
    assert.ok(pinNet);
    assert.equal(pinNet.terminals.length, 3);
  });

  it('mixed pins produce correct part count', () => {
    const result = inferNetlist({
      pins: [
        { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
        { name: 'led2', port: 1, bit: 1, direction: 'output', activeLow: true },
        { name: 'pot', port: 1, bit: 3, direction: 'analog', activeLow: false },
        { name: 'button', port: 3, bit: 2, direction: 'input', activeLow: false },
      ],
    });

    // VCC + GND + MCU + 2*(R+LED) + POT + R_PU + BTN = 3 + 4 + 1 + 2 = 10
    assert.equal(result.parts.length, 10);
    assert.equal(result.notes.length, 0);
  });

  it('inferred netlist is functional with the board', () => {
    const result = inferNetlist({
      pins: [
        { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
        { name: 'pot', port: 1, bit: 3, direction: 'analog', activeLow: false },
        { name: 'button', port: 3, bit: 2, direction: 'input', activeLow: false },
      ],
    });

    const board = new BoardImpl(5.0);
    board.setNetlist(result.parts, result.nets);

    // Active-low LED: quasi-bidir driving 0 should light up
    board.setPin('P1.0', 'quasi', false);
    board.advanceTo(1_000_000n);
    const brightness = board.ledBrightness('LED_led1');
    assert.ok(brightness > 0.10, `LED brightness ${brightness} should be > 0.10`);

    // Pot: midpoint should read ~2.5V
    board.setPin('P1.3', 'input', false);
    board.setControl('POT_pot', 0.5);
    const v = board.readAnalog('P1.3');
    assert.ok(Math.abs(v - 2.5) < 0.1, `pot voltage ${v} should be ≈ 2.5V`);

    // Button: open → 1, pressed → 0
    board.setPin('P3.2', 'input', false);
    board.setControl('BTN_button', 0);
    assert.equal(board.readPin('P3.2'), 1, 'button open → 1');
    board.setControl('BTN_button', 1);
    assert.equal(board.readPin('P3.2'), 0, 'button pressed → 0');
  });
});

describe('checkWiring — reverse check', () => {
  it('detects pin driven with nothing attached', () => {
    const pins = [
      { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
      { name: 'unused', port: 1, bit: 5, direction: 'output', activeLow: false },
    ];

    // Only wire led1, not unused
    const { parts, nets } = inferNetlist({ pins: [pins[0]] });
    // But declare both pins
    const notes = checkWiring(pins, parts, nets);

    assert.ok(notes.some(n => n.includes('unused') && n.includes('P1.5')),
      `should warn about unused pin: ${notes.join('; ')}`);
  });

  it('detects wiring not declared in the project', () => {
    const pins = [
      { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
    ];

    // Infer netlist with led1 + an extra undeclared wiring
    const { parts, nets } = inferNetlist({
      pins: [
        ...pins,
        { name: 'mystery', port: 2, bit: 0, direction: 'output', activeLow: false },
      ],
    });

    // But the project only declares led1
    const notes = checkWiring(pins, parts, nets);
    assert.ok(notes.some(n => n.includes('P2.0')),
      `should warn about undeclared wiring: ${notes.join('; ')}`);
  });

  it('no warnings for correctly matched pins', () => {
    const pins = [
      { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
    ];
    const { parts, nets } = inferNetlist({ pins });
    const notes = checkWiring(pins, parts, nets);
    assert.equal(notes.length, 0, `should have no warnings: ${notes.join('; ')}`);
  });
});
