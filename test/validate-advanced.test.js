/**
 * Advanced validation tests: terminal mismatches for every component,
 * param type checking, net topology issues, and the builder helper.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateNetlist, assertValidNetlist } from '../src/validate.js';
import { BoardImpl } from '../src/board.js';
import { inferNetlist } from '../src/infer-netlist.js';

describe('validate: every component wrong terminal', () => {
  const wrongTerminals = [
    ['resistor', ['x', 'y'], 'should be a, b'],
    ['capacitor', ['plus', 'minus'], 'should be a, b'],
    ['led', ['a', 'b'], 'should be anode, cathode'],
    ['diode', ['a', 'b'], 'should be anode, cathode'],
    ['potentiometer', ['1', '2', '3'], 'should be a, b, wiper'],
    ['button', ['in', 'out'], 'should be a, b'],
    ['buzzer', ['pos', 'neg'], 'should be a, b'],
    ['ldr', ['in', 'out'], 'should be a, b'],
    ['ntc', ['in', 'out'], 'should be a, b'],
    ['npn', ['b', 'c', 'e'], 'should be base, collector, emitter'],
    ['pnp', ['b', 'c', 'e'], 'should be base, collector, emitter'],
    ['zener', ['a', 'k'], 'should be anode, cathode'],
    ['vcc', ['plus'], 'should be vcc'],
    ['gnd', ['minus'], 'should be gnd'],
  ];

  for (const [kind, terminals, hint] of wrongTerminals) {
    it(`${kind} with wrong terminals → error (${hint})`, () => {
      const errors = validateNetlist(
        [
          { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
          { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
          { id: 'X', kind, params: {}, terminals },
        ],
        [
          { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
          { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
        ],
      );
      const termErrors = errors.filter(e => e.partId === 'X' && e.severity === 'error');
      assert.ok(termErrors.length > 0,
        `${kind}: should flag wrong terminals: ${errors.map(e => e.message).join('; ')}`);
    });
  }
});

describe('validate: correct terminals pass', () => {
  const correctTerminals = [
    ['resistor', ['a', 'b']],
    ['capacitor', ['a', 'b']],
    ['led', ['anode', 'cathode']],
    ['diode', ['anode', 'cathode']],
    ['potentiometer', ['a', 'b', 'wiper']],
    ['button', ['a', 'b']],
    ['buzzer', ['a', 'b']],
    ['ldr', ['a', 'b']],
    ['ntc', ['a', 'b']],
    ['npn', ['base', 'collector', 'emitter']],
    ['pnp', ['base', 'collector', 'emitter']],
    ['zener', ['anode', 'cathode']],
    ['vcc', ['vcc']],
    ['gnd', ['gnd']],
  ];

  for (const [kind, terminals] of correctTerminals) {
    it(`${kind} with correct terminals → no terminal errors`, () => {
      const errors = validateNetlist(
        [
          { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
          { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
          { id: 'X', kind, params: {}, terminals },
        ],
        [
          { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
          { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
        ],
      );
      const termErrors = errors.filter(e => e.partId === 'X' && e.severity === 'error' && e.message.includes('terminal'));
      assert.equal(termErrors.length, 0,
        `${kind}: no terminal errors: ${termErrors.map(e => e.message).join('; ')}`);
    });
  }
});

describe('validate: param type checking', () => {
  it('string where number expected', () => {
    const errors = validateNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 'one thousand' }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    assert.ok(errors.some(e => e.severity === 'error' && e.message.includes('ohms')));
  });

  it('negative farads', () => {
    const errors = validateNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'C1', kind: 'capacitor', params: { farads: -0.001 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    assert.ok(errors.some(e => e.severity === 'error' && e.message.includes('farads')));
  });
});

describe('validate: inferred netlists always pass', () => {
  it('inferNetlist output is always valid', () => {
    const testCases = [
      { pins: [] },
      { pins: [{ name: 'led', port: 1, bit: 0, direction: 'output', activeLow: true }] },
      { pins: [{ name: 'pot', port: 1, bit: 3, direction: 'analog', activeLow: false }] },
      { pins: [{ name: 'btn', port: 3, bit: 2, direction: 'input', activeLow: false }] },
      {
        pins: [
          { name: 'a', port: 1, bit: 0, direction: 'output', activeLow: true },
          { name: 'b', port: 1, bit: 1, direction: 'output', activeLow: false },
          { name: 'c', port: 1, bit: 3, direction: 'analog', activeLow: false },
          { name: 'd', port: 3, bit: 2, direction: 'input', activeLow: false },
        ],
      },
    ];

    for (const tc of testCases) {
      const { parts, nets } = inferNetlist(tc);
      const errors = validateNetlist(parts, nets);
      const fatal = errors.filter(e => e.severity === 'error');
      assert.equal(fatal.length, 0,
        `inferNetlist(${tc.pins.length} pins) should be valid: ${fatal.map(e => e.message).join('; ')}`);
    }
  });
});
