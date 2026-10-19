/**
 * Infer → board → verify roundtrip: inferNetlist produces circuits that
 * work correctly end-to-end for every pin type and combination.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inferNetlist, checkWiring } from '../src/infer-netlist.js';
import { BoardImpl } from '../src/board.js';

describe('infer roundtrip: single output active-low', () => {
  it('LED lights when pin drives low', () => {
    const { parts, nets } = inferNetlist({
      pins: [{ name: 'led', port: 1, bit: 0, direction: 'output', activeLow: true }],
    });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', false);
    board.advanceTo(25_000_000n);
    assert.ok(board.ledBrightness('LED_led') > 0.10);
  });

  it('LED off when pin drives high', () => {
    const { parts, nets } = inferNetlist({
      pins: [{ name: 'led', port: 1, bit: 0, direction: 'output', activeLow: true }],
    });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', true);
    board.advanceTo(25_000_000n);
    assert.ok(board.ledBrightness('LED_led') < 0.01);
  });
});

describe('infer roundtrip: single output active-high', () => {
  it('LED lights when pin drives high (push-pull)', () => {
    const { parts, nets } = inferNetlist({
      pins: [{ name: 'led', port: 1, bit: 0, direction: 'output', activeLow: false }],
    });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', true);
    board.advanceTo(25_000_000n);
    assert.ok(board.ledBrightness('LED_led') > 0.10);
  });

  it('LED dim when quasi high (weak source)', () => {
    const { parts, nets } = inferNetlist({
      pins: [{ name: 'led', port: 1, bit: 0, direction: 'output', activeLow: false }],
    });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', true);
    board.advanceTo(25_000_000n);
    const b = board.ledBrightness('LED_led');
    // quasi high: Rth=21700, I=(5-2)/(21700+1000+10)≈0.132mA, brightness≈0.0066
    assert.ok(b < 0.02, `quasi high active-high: ${b} should be very dim`);
    assert.ok(b > 0, `quasi high active-high: ${b} should be > 0 (some tiny current)`);
  });
});

describe('infer roundtrip: analog input', () => {
  it('pot sweep produces correct ADC voltages', () => {
    const { parts, nets } = inferNetlist({
      pins: [{ name: 'adc', port: 1, bit: 3, direction: 'analog', activeLow: false }],
    });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);

    for (const pos of [0, 0.25, 0.5, 0.75, 1.0]) {
      board.setControl('POT_adc', pos);
      const v = board.readAnalog('P1.3');
      assert.ok(Math.abs(v - 5.0 * pos) < 0.01, `pos=${pos}: ${v} ≈ ${5.0 * pos}`);
    }
  });
});

describe('infer roundtrip: input with button', () => {
  it('button open → 1, pressed → 0', () => {
    const { parts, nets } = inferNetlist({
      pins: [{ name: 'sw', port: 3, bit: 2, direction: 'input', activeLow: false }],
    });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P3.2', 'input', false);

    board.setControl('BTN_sw', 0);
    assert.equal(board.readPin('P3.2'), 1);
    board.setControl('BTN_sw', 1);
    assert.equal(board.readPin('P3.2'), 0);
  });
});

describe('infer roundtrip: full 4-pin project', () => {
  it('all pin types work simultaneously', () => {
    const pins = [
      { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
      { name: 'led2', port: 1, bit: 1, direction: 'output', activeLow: false },
      { name: 'pot', port: 1, bit: 3, direction: 'analog', activeLow: false },
      { name: 'btn', port: 3, bit: 2, direction: 'input', activeLow: false },
    ];
    const { parts, nets, notes } = inferNetlist({ pins });
    assert.equal(notes.length, 0, `no warnings: ${notes.join(', ')}`);

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Setup all pins
    board.setPin('P1.0', 'quasi', false);   // led1 on (active-low)
    board.setPin('P1.1', 'pushpull', true); // led2 on (active-high)
    board.setPin('P1.3', 'input', false);   // ADC input
    board.setPin('P3.2', 'input', false);   // button input
    board.setControl('POT_pot', 0.6);

    board.advanceTo(25_000_000n);

    // Verify all
    assert.ok(board.ledBrightness('LED_led1') > 0.10, 'led1 on');
    assert.ok(board.ledBrightness('LED_led2') > 0.10, 'led2 on');
    assert.ok(Math.abs(board.readAnalog('P1.3') - 3.0) < 0.1, 'pot at 60%');
    assert.equal(board.readPin('P3.2'), 1, 'button not pressed');

    board.setControl('BTN_btn', 1);
    assert.equal(board.readPin('P3.2'), 0, 'button pressed');

    // Wiring check: all pins accounted for
    const warnings = checkWiring(pins, parts, nets);
    assert.equal(warnings.length, 0, `no wiring warnings: ${warnings.join(', ')}`);
  });

  it('duplicate pin names on different ports', () => {
    const { parts, nets, notes } = inferNetlist({
      pins: [
        { name: 'io', port: 1, bit: 0, direction: 'output', activeLow: true },
        { name: 'io', port: 1, bit: 1, direction: 'output', activeLow: true },
      ],
    });
    // Should still work — IDs are name-based but PinIds are port.bit
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', false);
    board.setPin('P1.1', 'quasi', true);
    board.advanceTo(25_000_000n);
    // Both LEDs should exist (may have same name in ID — that's the user's problem)
  });
});

describe('infer + checkWiring: missing and extra pins', () => {
  it('warns about 3 unwired pins', () => {
    const declared = [
      { name: 'a', port: 1, bit: 0, direction: 'output', activeLow: true },
      { name: 'b', port: 1, bit: 1, direction: 'output', activeLow: true },
      { name: 'c', port: 1, bit: 2, direction: 'output', activeLow: true },
      { name: 'd', port: 1, bit: 3, direction: 'analog', activeLow: false },
    ];
    // Only wire pin 'a'
    const { parts, nets } = inferNetlist({ pins: [declared[0]] });
    const warnings = checkWiring(declared, parts, nets);
    const unwired = warnings.filter(w => w.includes('nothing wired'));
    assert.equal(unwired.length, 3, `should warn about 3 unwired: ${warnings.join('; ')}`);
  });

  it('warns about 2 extra wired pins', () => {
    const declared = [
      { name: 'a', port: 1, bit: 0, direction: 'output', activeLow: true },
    ];
    const { parts, nets } = inferNetlist({
      pins: [
        ...declared,
        { name: 'x', port: 2, bit: 0, direction: 'output', activeLow: false },
        { name: 'y', port: 2, bit: 1, direction: 'input', activeLow: false },
      ],
    });
    const warnings = checkWiring(declared, parts, nets);
    const extra = warnings.filter(w => w.includes('not declared'));
    assert.ok(extra.length >= 2, `should warn about extra: ${warnings.join('; ')}`);
  });
});
