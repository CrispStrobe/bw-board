/**
 * Short-circuit warning tests: pin driving into VCC/GND directly.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('warnings: pin-to-VCC short', () => {
  it('pushpull LOW into VCC → danger', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nshort', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'MCU', terminal: 'P1.0' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    board.setPin('P1.0', 'pushpull', false); // LOW into VCC = short

    const w = board.getWarnings();
    assert.ok(w.some(w => w.severity === 'danger' && w.message.includes('VCC')),
      `should warn about VCC short: ${w.map(w => w.message).join('; ')}`);
  });

  it('pushpull HIGH into VCC → no warning (same direction)', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'n', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'MCU', terminal: 'P1.0' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    board.setPin('P1.0', 'pushpull', true); // HIGH into VCC = ok

    const w = board.getWarnings().filter(w => w.message.includes('VCC'));
    assert.equal(w.length, 0, 'same direction → no short');
  });
});

describe('warnings: pin-to-GND short', () => {
  it('pushpull HIGH into GND → danger', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'nshort', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'MCU', terminal: 'P1.0' }] },
      ],
    );
    board.setPin('P1.0', 'pushpull', true); // HIGH into GND = short

    const w = board.getWarnings();
    assert.ok(w.some(w => w.severity === 'danger' && w.message.includes('GND')),
      `should warn about GND short: ${w.map(w => w.message).join('; ')}`);
  });

  it('pushpull LOW into GND → no warning', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'n', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'MCU', terminal: 'P1.0' }] },
      ],
    );
    board.setPin('P1.0', 'pushpull', false); // LOW into GND = ok

    const w = board.getWarnings().filter(w => w.message.includes('GND'));
    assert.equal(w.length, 0, 'same direction → no short');
  });

  it('input mode into GND → no warning', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'n', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'MCU', terminal: 'P1.0' }] },
      ],
    );
    board.setPin('P1.0', 'input', false); // input = high-Z, no short

    const w = board.getWarnings().filter(w => w.severity === 'danger');
    assert.equal(w.length, 0, 'input mode cannot short');
  });
});
