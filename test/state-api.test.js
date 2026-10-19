/**
 * Tests for state getters, part queries, onChange, warnings,
 * reset, and snapshot/restore.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { inferNetlist } from '../src/infer-netlist.js';

// ─── State getters ────────────────────────────────────────────────────────

describe('state: getTime', () => {
  it('starts at 0', () => {
    const board = new BoardImpl(5.0);
    assert.equal(board.getTime(), 0n);
  });

  it('tracks advanceTo', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    board.advanceTo(12345n);
    assert.equal(board.getTime(), 12345n);
  });
});

describe('state: isPowered', () => {
  it('default is true', () => {
    assert.equal(new BoardImpl(5.0).isPowered(), true);
  });

  it('tracks setPower', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    board.setPower(false);
    assert.equal(board.isPowered(), false);
    board.setPower(true);
    assert.equal(board.isPowered(), true);
  });
});

describe('state: getVcc', () => {
  it('returns constructor value', () => {
    assert.equal(new BoardImpl(3.3).getVcc(), 3.3);
    assert.equal(new BoardImpl(5.0).getVcc(), 5.0);
    assert.equal(new BoardImpl(12.0).getVcc(), 12.0);
  });
});

describe('state: getPinState', () => {
  it('null for unset pin', () => {
    assert.equal(new BoardImpl(5.0).getPinState('P1.0'), null);
  });

  it('returns mode and driveHigh', () => {
    const board = new BoardImpl(5.0);
    board.setPin('P1.0', 'quasi', false);
    const s = board.getPinState('P1.0');
    assert.deepEqual(s, { mode: 'quasi', driveHigh: false });
  });

  it('tracks changes', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    board.setPin('P1.0', 'pushpull', true);
    assert.deepEqual(board.getPinState('P1.0'), { mode: 'pushpull', driveHigh: true });
    board.setPin('P1.0', 'opendrain', false);
    assert.deepEqual(board.getPinState('P1.0'), { mode: 'opendrain', driveHigh: false });
  });
});

describe('state: getControl', () => {
  it('undefined for unset control', () => {
    assert.equal(new BoardImpl(5.0).getControl('POT1'), undefined);
  });

  it('returns set value', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    board.setControl('POT1', 0.73);
    assert.equal(board.getControl('POT1'), 0.73);
  });
});

describe('state: getCapVoltage', () => {
  it('0 for unknown cap', () => {
    assert.equal(new BoardImpl(5.0).getCapVoltage('C1'), 0);
  });

  it('tracks charging', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'C1', kind: 'capacitor', params: { farads: 0.001 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nrc', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
      ],
    );
    assert.equal(board.getCapVoltage('C1'), 0);
    board.advanceTo(5_000_000_000n);
    assert.ok(board.getCapVoltage('C1') > 4.5);
  });
});

// ─── Part queries ─────────────────────────────────────────────────────────

describe('queries: getParts/getNets', () => {
  it('returns the current netlist', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = inferNetlist({
      pins: [{ name: 'led', port: 1, bit: 0, direction: 'output', activeLow: true }],
    });
    board.setNetlist(parts, nets);
    assert.equal(board.getParts().length, parts.length);
    assert.equal(board.getNets().length, nets.length);
  });
});

describe('queries: getLeds/getBuzzers', () => {
  it('returns LED and buzzer IDs', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'LED_A', kind: 'led', params: {}, terminals: ['anode', 'cathode'] },
        { id: 'LED_B', kind: 'led', params: {}, terminals: ['anode', 'cathode'] },
        { id: 'BUZZ', kind: 'buzzer', params: {}, terminals: ['a', 'b'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [{ id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] }],
    );
    assert.deepEqual(board.getLeds(), ['LED_A', 'LED_B']);
    assert.deepEqual(board.getBuzzers(), ['BUZZ']);
  });
});

describe('queries: getControls', () => {
  it('lists controllable parts with current values', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'POT', kind: 'potentiometer', params: { ohms: 10000 }, terminals: ['a', 'b', 'wiper'] },
        { id: 'BTN', kind: 'button', params: {}, terminals: ['a', 'b'] },
        { id: 'LDR', kind: 'ldr', params: {}, terminals: ['a', 'b'] },
      ],
      [{ id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] }],
    );
    board.setControl('POT', 0.5);
    board.setControl('BTN', 1);

    const ctrls = board.getControls();
    assert.equal(ctrls.length, 3);
    assert.ok(ctrls.find(c => c.id === 'POT' && c.value === 0.5));
    assert.ok(ctrls.find(c => c.id === 'BTN' && c.value === 1));
    assert.ok(ctrls.find(c => c.id === 'LDR' && c.value === 0));
  });
});

describe('queries: getPinStates', () => {
  it('lists all tracked pins', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    board.setPin('P1.0', 'quasi', false);
    board.setPin('P1.3', 'input', true);

    const pins = board.getPinStates();
    assert.equal(pins.length, 2);
    assert.ok(pins.find(p => p.pin === 'P1.0' && p.mode === 'quasi' && !p.driveHigh));
    assert.ok(pins.find(p => p.pin === 'P1.3' && p.mode === 'input' && p.driveHigh));
  });
});

// ─── onChange callback ────────────────────────────────────────────────────

describe('onChange callback', () => {
  it('fires on setPin', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    const events = [];
    board.onChange(e => events.push(e));
    board.setPin('P1.0', 'quasi', false);
    assert.ok(events.some(e => e.type === 'pin'));
  });

  it('fires on advanceTo', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    const events = [];
    board.onChange(e => events.push(e));
    board.advanceTo(1000n);
    assert.ok(events.some(e => e.type === 'time'));
  });

  it('fires on setControl', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    const events = [];
    board.onChange(e => events.push(e));
    board.setControl('POT', 0.5);
    assert.ok(events.some(e => e.type === 'control'));
  });

  it('fires on setPower', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    const events = [];
    board.onChange(e => events.push(e));
    board.setPower(false);
    assert.ok(events.some(e => e.type === 'power'));
  });

  it('fires on setNetlist', () => {
    const board = new BoardImpl(5.0);
    const events = [];
    board.onChange(e => events.push(e));
    board.setNetlist([], []);
    assert.ok(events.some(e => e.type === 'netlist'));
  });

  it('offChange removes listener', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    const events = [];
    const fn = e => events.push(e);
    board.onChange(fn);
    board.setPin('P1.0', 'quasi', false);
    assert.ok(events.length > 0);
    const before = events.length;
    board.offChange(fn);
    board.setPin('P1.0', 'quasi', true);
    assert.equal(events.length, before, 'no new events after offChange');
  });
});

// ─── Warnings ─────────────────────────────────────────────────────────────

describe('getWarnings', () => {
  it('no warnings for normal circuit', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = inferNetlist({
      pins: [{ name: 'led', port: 1, bit: 0, direction: 'output', activeLow: true }],
    });
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', false);
    const w = board.getWarnings();
    assert.equal(w.length, 0);
  });

  it('warns about overcurrent LED (no resistor)', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'LED1', terminal: 'anode' }] },
        { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    board.setPin('P1.0', 'pushpull', false);
    const w = board.getWarnings();
    assert.ok(w.some(w => w.severity === 'danger' && w.message.includes('20 mA')),
      `should warn about overcurrent: ${w.map(w => w.message).join('; ')}`);
  });

  it('no warnings when powered off', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    board.setPower(false);
    assert.equal(board.getWarnings().length, 0);
  });
});

// ─── Reset ────────────────────────────────────────────────────────────────

describe('reset', () => {
  it('clears pin states but keeps netlist', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = inferNetlist({
      pins: [{ name: 'led', port: 1, bit: 0, direction: 'output', activeLow: true }],
    });
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', false);
    board.advanceTo(25_000_000n);

    board.reset();

    assert.equal(board.getTime(), 0n);
    assert.equal(board.getPinState('P1.0'), null);
    assert.equal(board.getParts().length, parts.length); // netlist preserved
    assert.equal(board.ledBrightness('LED_led'), 0);
  });

  it('fires onChange with type=reset', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    const events = [];
    board.onChange(e => events.push(e));
    board.reset();
    assert.ok(events.some(e => e.type === 'reset'));
  });
});

// ─── Snapshot / Restore ───────────────────────────────────────────────────

describe('snapshot/restore', () => {
  it('restore returns to snapshotted state', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = inferNetlist({
      pins: [{ name: 'pot', port: 1, bit: 3, direction: 'analog', activeLow: false }],
    });
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);
    board.setControl('POT_pot', 0.3);
    board.advanceTo(1_000_000n);

    const snap = board.snapshot();

    // Change state
    board.setControl('POT_pot', 0.9);
    board.advanceTo(5_000_000n);
    assert.ok(Math.abs(board.readAnalog('P1.3') - 4.5) < 0.1);

    // Restore
    board.restore(snap);
    assert.equal(board.getTime(), 1_000_000n);
    assert.equal(board.getControl('POT_pot'), 0.3);
  });

  it('snapshot is independent copy', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    board.setPin('P1.0', 'quasi', true);

    const snap = board.snapshot();
    board.setPin('P1.0', 'pushpull', false);

    // Snapshot should still have the old state. Keys are canonical
    // lowercase (the case-blind pin join); spellings live in `.as`.
    assert.equal(snap.pinStates.get('p1.0').mode, 'quasi');
    assert.equal(snap.pinStates.get('p1.0').as, 'P1.0');
  });
});
