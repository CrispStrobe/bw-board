/**
 * Netlist validation tests — catch the exact misuse found in integration.
 *
 * The integration harness got it wrong three ways:
 *   1. Used {a,b} for LED instead of {anode,cathode}
 *   2. Gave VCC a `volts` param and a `p` terminal
 *   3. Omitted GND entirely
 * The board silently returned brightness 0 and V=5V — plausible, wrong.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { validateNetlist, assertValidNetlist } from '../src/validate.js';

describe('validate: catches the real integration mistakes', () => {
  it('LED with {a,b} instead of {anode,cathode}', () => {
    const errors = validateNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['a', 'b'] }, // WRONG
      ],
      [
        { id: 'n1', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'n2', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'a' }] },
        { id: 'n3', terminals: [{ part: 'LED1', terminal: 'b' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );

    const ledErrors = errors.filter(e => e.partId === 'LED1' && e.severity === 'error');
    assert.ok(ledErrors.length > 0,
      `should flag LED1's {a,b} terminals: ${errors.map(e => e.message).join('; ')}`);
    assert.ok(ledErrors.some(e => e.message.includes('anode')),
      `should mention anode: ${ledErrors.map(e => e.message).join('; ')}`);
  });

  it('VCC with wrong terminal name', () => {
    const errors = validateNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: { volts: 5 }, terminals: ['p'] }, // WRONG
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [
        { id: 'n1', terminals: [{ part: 'VCC', terminal: 'p' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );

    const vccErrors = errors.filter(e => e.partId === 'VCC' && e.severity === 'error');
    assert.ok(vccErrors.length > 0,
      `should flag VCC's 'p' terminal: ${errors.map(e => e.message).join('; ')}`);
  });

  it('missing GND entirely', () => {
    const errors = validateNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        // NO GND
      ],
      [
        { id: 'n1', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'n2', terminals: [{ part: 'R1', terminal: 'b' }] },
      ],
    );

    const gndErrors = errors.filter(e => e.severity === 'error' && e.message.includes('GND'));
    assert.ok(gndErrors.length > 0,
      `should flag missing GND: ${errors.map(e => e.message).join('; ')}`);
  });

  it('all three mistakes together → assertValidNetlist throws', () => {
    assert.throws(() => {
      assertValidNetlist(
        [
          { id: 'VCC', kind: 'vcc', params: {}, terminals: ['p'] },
          { id: 'LED1', kind: 'led', params: {}, terminals: ['a', 'b'] },
        ],
        [
          { id: 'n1', terminals: [{ part: 'VCC', terminal: 'p' }, { part: 'LED1', terminal: 'a' }] },
          { id: 'n2', terminals: [{ part: 'LED1', terminal: 'b' }] },
        ],
      );
    }, /Invalid netlist/);
  });
});

describe('validate: unknown part kind', () => {
  it('flags unknown kind', () => {
    const errors = validateNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'X1', kind: 'transformer', params: {}, terminals: ['a', 'b'] },
      ],
      [
        { id: 'n1', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );

    assert.ok(errors.some(e => e.severity === 'error' && e.message.includes('transformer')));
  });
});

describe('validate: net references unknown part', () => {
  it('flags dangling reference', () => {
    const errors = validateNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [
        { id: 'n1', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'MISSING', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );

    assert.ok(errors.some(e => e.severity === 'error' && e.message.includes('MISSING')));
  });
});

describe('validate: valid netlist passes', () => {
  it('correct LED circuit has no errors', () => {
    const errors = validateNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
        { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );

    const fatal = errors.filter(e => e.severity === 'error');
    assert.equal(fatal.length, 0, `no errors: ${errors.map(e => e.message).join('; ')}`);
  });

  it('assertValidNetlist does not throw for valid netlist', () => {
    assert.doesNotThrow(() => {
      assertValidNetlist(
        [
          { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
          { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        ],
        [
          { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
          { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
        ],
      );
    });
  });
});

describe('validate: warnings vs errors', () => {
  it('duplicate part id is warning, not error', () => {
    const errors = validateNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );

    const dups = errors.filter(e => e.message.includes('Duplicate'));
    assert.ok(dups.length > 0);
    assert.equal(dups[0].severity, 'warning');
  });

  it('unconnected part is warning', () => {
    const errors = validateNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
        // R1 not in any net
      ],
    );

    const unconnected = errors.filter(e => e.message.includes('not connected'));
    assert.ok(unconnected.length > 0);
    assert.equal(unconnected[0].severity, 'warning');
  });

  it('NaN ohms is error', () => {
    const errors = validateNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: NaN }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );

    assert.ok(errors.some(e => e.severity === 'error' && e.message.includes('ohms')));
  });
});

describe('validate: all new component types', () => {
  for (const [kind, terminals] of [
    ['ldr', ['a', 'b']],
    ['ntc', ['a', 'b']],
    ['npn', ['base', 'collector', 'emitter']],
    ['pnp', ['base', 'collector', 'emitter']],
    ['zener', ['anode', 'cathode']],
    ['inductor', ['a', 'b']],
  ]) {
    it(`${kind} with correct terminals passes`, () => {
      const errors = validateNetlist(
        [
          { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
          { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
          { id: 'X1', kind, params: {}, terminals },
        ],
        [
          { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
          { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
        ],
      );
      const fatal = errors.filter(e => e.severity === 'error');
      assert.equal(fatal.length, 0, `${kind} should pass: ${errors.map(e => e.message).join('; ')}`);
    });

    it(`${kind} with wrong terminals flags error`, () => {
      const errors = validateNetlist(
        [
          { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
          { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
          { id: 'X1', kind, params: {}, terminals: ['x', 'y', 'z'] },
        ],
        [
          { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
          { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
        ],
      );
      const termErrors = errors.filter(e => e.severity === 'error' && e.partId === 'X1');
      assert.ok(termErrors.length > 0, `${kind} with wrong terminals should error`);
    });
  }
});
