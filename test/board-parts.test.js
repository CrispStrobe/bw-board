/**
 * Board parts vs drivers: verify all new drawable part kinds are
 * accepted by validation, can be placed in a netlist, and don't
 * crash the solver.
 *
 * These parts are DRAWABLE (can be placed and wired) but not
 * necessarily DRIVABLE (controllable from code). The distinction
 * from PARTS-MODEL.md: board parts are gated on modelling effort,
 * drivers are gated on edge-order-not-duration.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { validateNetlist } from '../src/validate.js';

describe('drawable parts: validation accepts all new kinds', () => {
  const drawableParts = [
    { kind: 'shift_register', terminals: ['data', 'clock', 'latch', 'oe', 'q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'] },
    { kind: 'char_lcd', terminals: ['rs', 'rw', 'e', 'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'vcc', 'gnd', 'vo', 'bl_a', 'bl_k'] },
    { kind: 'ir_receiver', terminals: ['vcc', 'gnd', 'out'] },
    { kind: 'temp_sensor', terminals: ['vcc', 'gnd', 'dq'] },
    { kind: 'eeprom', terminals: ['sda', 'scl', 'vcc', 'gnd'] },
  ];

  for (const { kind, terminals } of drawableParts) {
    it(`${kind}: correct terminals pass validation`, () => {
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
      const fatal = errors.filter(e => e.severity === 'error');
      assert.equal(fatal.length, 0,
        `${kind}: ${fatal.map(e => e.message).join('; ')}`);
    });

    it(`${kind}: wrong terminals flagged`, () => {
      const errors = validateNetlist(
        [
          { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
          { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
          { id: 'X', kind, params: {}, terminals: ['x', 'y'] },
        ],
        [
          { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
          { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
        ],
      );
      const termErrors = errors.filter(e => e.severity === 'error' && e.partId === 'X');
      assert.ok(termErrors.length > 0, `${kind}: wrong terminals should error`);
    });
  }
});

describe('drawable parts: setNetlist accepts them', () => {
  it('char_lcd can be placed without crashing', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'LCD', kind: 'char_lcd', params: { cols: 16, rows: 2 },
          terminals: ['rs', 'rw', 'e', 'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'vcc', 'gnd', 'vo', 'bl_a', 'bl_k'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P2.0', 'P2.1', 'P2.2'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'LCD', terminal: 'vcc' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'LCD', terminal: 'gnd' }] },
        { id: 'nrs', terminals: [{ part: 'MCU', terminal: 'P2.0' }, { part: 'LCD', terminal: 'rs' }] },
        { id: 'ne', terminals: [{ part: 'MCU', terminal: 'P2.1' }, { part: 'LCD', terminal: 'e' }] },
      ],
    );
    // Should not throw
    const state = board.getRenderState();
    assert.ok(state.powered);
  });

  it('ir_receiver can be placed and pin read', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'IR', kind: 'ir_receiver', params: {},
          terminals: ['vcc', 'gnd', 'out'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P3.2'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'IR', terminal: 'vcc' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'IR', terminal: 'gnd' }] },
        { id: 'nout', terminals: [{ part: 'IR', terminal: 'out' }, { part: 'MCU', terminal: 'P3.2' }] },
      ],
    );
    board.setPin('P3.2', 'input', false);
    // IR receiver output is not simulated — just verify board doesn't crash
    const v = board.readPin('P3.2');
    assert.ok(v === 0 || v === 1);
  });
});

describe('drawable parts: getPartKinds includes all', () => {
  it('all new kinds are in the list', () => {
    const kinds = BoardImpl.getPartKinds();
    for (const k of ['shift_register', 'char_lcd', 'led_matrix',
                      'ir_receiver', 'temp_sensor', 'eeprom']) {
      assert.ok(kinds.includes(k), `${k} should be in getPartKinds()`);
    }
  });
});

describe('drawable parts: getTerminalsForKind', () => {
  it('char_lcd has 16 terminals', () => {
    const t = BoardImpl.getTerminalsForKind('char_lcd');
    assert.ok(t);
    assert.equal(t.length, 16);
    assert.ok(t.includes('rs'));
    assert.ok(t.includes('e'));
    assert.ok(t.includes('d7'));
  });

  it('ir_receiver has 3 terminals', () => {
    const t = BoardImpl.getTerminalsForKind('ir_receiver');
    assert.ok(t);
    assert.equal(t.length, 3);
  });

  it('shift_register has 12 terminals', () => {
    const t = BoardImpl.getTerminalsForKind('shift_register');
    assert.ok(t);
    assert.equal(t.length, 12);
    assert.ok(t.includes('data'));
    assert.ok(t.includes('q7'));
  });
});
