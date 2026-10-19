/**
 * NetlistBuilder editing tests: removePart, unwire, isWired.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NetlistBuilder } from '../src/builder.js';

describe('builder: removePart', () => {
  it('removes part and its wiring', () => {
    const b = new NetlistBuilder()
      .vcc('VCC').gnd('GND')
      .resistor('R1', 1000)
      .led('LED1')
      .wire('VCC.vcc', 'R1.a')
      .wire('R1.b', 'LED1.anode');

    b.removePart('LED1');
    const { parts, nets } = b.build();

    assert.ok(!parts.some(p => p.id === 'LED1'), 'LED1 removed');
    assert.ok(!nets.some(n => n.terminals.some(t => t.part === 'LED1')), 'LED1 wiring removed');
    // R1 should still exist
    assert.ok(parts.some(p => p.id === 'R1'));
  });

  it('removing nonexistent part is a no-op', () => {
    const b = new NetlistBuilder().vcc('VCC').gnd('GND');
    b.removePart('NOPE'); // should not throw
    assert.equal(b.build().parts.length, 2);
  });
});

describe('builder: unwire', () => {
  it('disconnects a terminal', () => {
    const b = new NetlistBuilder()
      .vcc('VCC').gnd('GND')
      .resistor('R1', 1000)
      .wire('VCC.vcc', 'R1.a');

    assert.ok(b.isWired('R1.a'));
    b.unwire('R1.a');
    assert.ok(!b.isWired('R1.a'));
  });

  it('removing last member deletes the net', () => {
    const b = new NetlistBuilder()
      .vcc('VCC').gnd('GND')
      .resistor('R1', 1000)
      .wire('VCC.vcc', 'R1.a');

    b.unwire('VCC.vcc'); // net now has only R1.a → deleted (<=1 member)
    const { nets } = b.build();
    assert.equal(nets.length, 0, 'net should be deleted');
  });
});

describe('builder: isWired', () => {
  it('returns false for unwired terminal', () => {
    const b = new NetlistBuilder().resistor('R1', 1000);
    assert.equal(b.isWired('R1.a'), false);
  });

  it('returns true after wiring', () => {
    const b = new NetlistBuilder().vcc('VCC').resistor('R1', 1000).wire('VCC.vcc', 'R1.a');
    assert.equal(b.isWired('R1.a'), true);
    assert.equal(b.isWired('VCC.vcc'), true);
  });
});

describe('builder: edit then build', () => {
  it('add → remove → add → build works', () => {
    const b = new NetlistBuilder()
      .vcc('VCC').gnd('GND')
      .resistor('R1', 1000)
      .wire('VCC.vcc', 'R1.a');

    b.removePart('R1');
    b.resistor('R2', 2000);
    b.wire('VCC.vcc', 'R2.a');

    const { parts } = b.build();
    assert.ok(!parts.some(p => p.id === 'R1'), 'R1 gone');
    assert.ok(parts.some(p => p.id === 'R2'), 'R2 present');
  });
});
