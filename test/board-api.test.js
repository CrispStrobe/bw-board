/**
 * Board public API surface tests: every method is callable,
 * returns the documented type, and handles edge cases.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function makeMinimalCircuit() {
  return {
    parts: [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'BUZZ', kind: 'buzzer', params: {}, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.5'] },
    ],
    nets: [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
      { id: 'nb', terminals: [{ part: 'MCU', terminal: 'P1.5' }, { part: 'BUZZ', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'BUZZ', terminal: 'b' }] },
    ],
  };
}

describe('Board API: return types', () => {
  it('nodeVoltage returns number', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeMinimalCircuit();
    board.setNetlist(parts, nets);
    assert.equal(typeof board.nodeVoltage('nv'), 'number');
    assert.equal(typeof board.nodeVoltage('nonexistent'), 'number');
  });

  it('readPin returns 0 or 1', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeMinimalCircuit();
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', false);
    const v = board.readPin('P1.0');
    assert.ok(v === 0 || v === 1, `readPin returns 0 or 1, got ${v}`);
  });

  it('readAnalog returns number in [0, VCC]', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeMinimalCircuit();
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', false);
    const v = board.readAnalog('P1.0');
    assert.equal(typeof v, 'number');
    assert.ok(v >= 0 && v <= 5.0, `readAnalog in [0, VCC]: ${v}`);
  });

  it('ledBrightness returns number in [0, 1]', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeMinimalCircuit();
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(25_000_000n);
    const b = board.ledBrightness('LED1');
    assert.equal(typeof b, 'number');
    assert.ok(b >= 0 && b <= 1, `ledBrightness in [0,1]: ${b}`);
  });

  it('buzzerTone returns {hz: number, on: boolean}', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeMinimalCircuit();
    board.setNetlist(parts, nets);
    const tone = board.buzzerTone('BUZZ');
    assert.equal(typeof tone.hz, 'number');
    assert.equal(typeof tone.on, 'boolean');
  });

  it('resistance returns number | string', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeMinimalCircuit();
    board.setNetlist(parts, nets);

    const rPowered = board.resistance('nv', 'ng');
    assert.equal(rPowered, 'requires-power-off');

    board.setPower(false);
    const rOff = board.resistance('nv', 'ng');
    assert.equal(typeof rOff, 'number');
  });

  it('branchCurrent returns number', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeMinimalCircuit();
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', false);
    const i = board.branchCurrent('R1', 'b');
    assert.equal(typeof i, 'number');
    assert.ok(!Number.isNaN(i));
  });
});

describe('Board API: constructor VCC parameter', () => {
  for (const vcc of [1.8, 2.5, 3.3, 5.0, 12.0]) {
    it(`VCC = ${vcc}V`, () => {
      const board = new BoardImpl(vcc);
      board.setNetlist(
        [
          { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
          { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        ],
        [
          { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
          { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
        ],
      );
      assert.equal(board.nodeVoltage('nv'), vcc);
      assert.equal(board.nodeVoltage('ng'), 0);
    });
  }
});

describe('Board API: method chaining behavior', () => {
  it('setPin → advanceTo → readPin works', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeMinimalCircuit();
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', true);
    board.advanceTo(1_000_000n);
    const v = board.readPin('P1.0');
    assert.ok(v === 0 || v === 1);
  });

  it('multiple setControl calls accumulate', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'POT', kind: 'potentiometer', params: { ohms: 10000 }, terminals: ['a', 'b', 'wiper'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'POT', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'POT', terminal: 'b' }] },
        { id: 'nw', terminals: [{ part: 'POT', terminal: 'wiper' }, { part: 'MCU', terminal: 'P1.3' }] },
      ],
    );
    board.setPin('P1.3', 'input', false);

    board.setControl('POT', 0.1);
    board.setControl('POT', 0.5);
    board.setControl('POT', 0.9);
    // Last one wins
    assert.ok(Math.abs(board.readAnalog('P1.3') - 4.5) < 0.01);
  });
});

describe('Board API: powered state', () => {
  it('default is powered on', () => {
    const board = new BoardImpl(5.0);
    assert.equal(board.powered, true);
  });

  it('setPower(false) then setPower(true) restores voltages', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );

    assert.equal(board.nodeVoltage('nv'), 5.0);
    board.setPower(false);
    assert.equal(board.nodeVoltage('nv'), 0);
    board.setPower(true);
    assert.equal(board.nodeVoltage('nv'), 5.0);
  });
});
