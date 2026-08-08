/**
 * Advanced inferNetlist and checkWiring tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inferNetlist, checkWiring } from '../src/infer-netlist.js';
import { BoardImpl } from '../src/board.js';

describe('inferNetlist edge cases', () => {
  it('empty pins array → just VCC, GND, MCU', () => {
    const result = inferNetlist({ pins: [] });
    assert.equal(result.parts.length, 3); // VCC, GND, MCU
    assert.equal(result.nets.length, 2); // net_vcc, net_gnd
    assert.equal(result.notes.length, 0);
  });

  it('pin name with special chars is sanitized', () => {
    const result = inferNetlist({
      pins: [{ name: 'my-led.1', port: 1, bit: 0, direction: 'output', activeLow: true }],
    });
    const led = result.parts.find(p => p.kind === 'led');
    assert.ok(led, 'should create an LED');
    // Sanitized name should have underscores
    assert.ok(led.id.includes('my_led_1'), `id "${led.id}" should contain sanitized name`);
  });

  it('unknown direction produces a note', () => {
    const result = inferNetlist({
      pins: [{ name: 'mystery', port: 2, bit: 0, direction: 'serial', activeLow: false }],
    });
    assert.ok(result.notes.length > 0, 'should produce a warning note');
    assert.ok(result.notes[0].includes('serial'), `note should mention the direction: ${result.notes[0]}`);
  });

  it('pwm direction is handled as output', () => {
    const result = inferNetlist({
      pins: [{ name: 'lamp', port: 1, bit: 3, direction: 'pwm', activeLow: true }],
    });
    assert.equal(result.notes.length, 0, 'pwm is a valid direction');
    assert.ok(result.parts.some(p => p.kind === 'led'), 'pwm creates an LED');
  });

  it('multiple analog pins each get their own pot', () => {
    const result = inferNetlist({
      pins: [
        { name: 'pot1', port: 1, bit: 0, direction: 'analog', activeLow: false },
        { name: 'pot2', port: 1, bit: 1, direction: 'analog', activeLow: false },
        { name: 'pot3', port: 1, bit: 3, direction: 'analog', activeLow: false },
      ],
    });
    const pots = result.parts.filter(p => p.kind === 'potentiometer');
    assert.equal(pots.length, 3, 'should create 3 potentiometers');
    // Each should have unique id
    const ids = new Set(pots.map(p => p.id));
    assert.equal(ids.size, 3, 'pot ids should be unique');
  });

  it('all inferred pots work independently', () => {
    const { parts, nets } = inferNetlist({
      pins: [
        { name: 'pot1', port: 1, bit: 0, direction: 'analog', activeLow: false },
        { name: 'pot2', port: 1, bit: 1, direction: 'analog', activeLow: false },
      ],
    });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    board.setPin('P1.0', 'input', false);
    board.setPin('P1.1', 'input', false);

    board.setControl('POT_pot1', 0.2); // 1.0V
    board.setControl('POT_pot2', 0.8); // 4.0V

    const v1 = board.readAnalog('P1.0');
    const v2 = board.readAnalog('P1.1');
    assert.ok(Math.abs(v1 - 1.0) < 0.1, `pot1 at 0.2: ${v1} should be ~1.0V`);
    assert.ok(Math.abs(v2 - 4.0) < 0.1, `pot2 at 0.8: ${v2} should be ~4.0V`);
  });
});

describe('checkWiring advanced', () => {
  it('detects multiple undeclared pins', () => {
    const declared = [
      { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
    ];
    const { parts, nets } = inferNetlist({
      pins: [
        ...declared,
        { name: 'extra1', port: 2, bit: 0, direction: 'output', activeLow: false },
        { name: 'extra2', port: 2, bit: 1, direction: 'input', activeLow: false },
      ],
    });
    const notes = checkWiring(declared, parts, nets);
    assert.ok(notes.filter(n => n.includes('P2.0') || n.includes('P2.1')).length >= 2,
      `should warn about both undeclared pins: ${notes.join('; ')}`);
  });

  it('detects multiple unwired pins', () => {
    const declared = [
      { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
      { name: 'led2', port: 1, bit: 1, direction: 'output', activeLow: true },
      { name: 'led3', port: 1, bit: 2, direction: 'output', activeLow: true },
    ];
    // Only wire led1
    const { parts, nets } = inferNetlist({ pins: [declared[0]] });
    const notes = checkWiring(declared, parts, nets);
    const unwired = notes.filter(n => n.includes('nothing wired'));
    assert.ok(unwired.length >= 2, `should detect 2 unwired pins: ${notes.join('; ')}`);
  });
});
