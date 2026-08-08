/**
 * Full pipeline tests: inferNetlist → validate → setNetlist → simulate → getRenderState.
 * This is the exact sequence the integration and the UI agent use.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { inferNetlist, checkWiring } from '../src/infer-netlist.js';
import { validateNetlist } from '../src/validate.js';

describe('full pipeline: typical BrickWright project', () => {
  it('4-pin project: infer → validate → simulate → render', () => {
    const pins = [
      { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
      { name: 'led2', port: 1, bit: 1, direction: 'output', activeLow: true },
      { name: 'pot', port: 1, bit: 3, direction: 'analog', activeLow: false },
      { name: 'button', port: 3, bit: 2, direction: 'input', activeLow: false },
    ];

    // Step 1: infer
    const { parts, nets, notes } = inferNetlist({ pins });
    assert.equal(notes.length, 0, 'no inference warnings');

    // Step 2: validate
    const errors = validateNetlist(parts, nets);
    const fatal = errors.filter(e => e.severity === 'error');
    assert.equal(fatal.length, 0, `no validation errors: ${fatal.map(e => e.message).join('; ')}`);

    // Step 3: wiring check
    const warnings = checkWiring(pins, parts, nets);
    assert.equal(warnings.length, 0, 'no wiring warnings');

    // Step 4: setNetlist (will throw if invalid)
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Step 5: simulate
    board.setPin('P1.0', 'quasi', false); // LED1 on
    board.setPin('P1.1', 'quasi', true);  // LED2 off
    board.setPin('P1.3', 'input', false);
    board.setPin('P3.2', 'input', false);
    board.setControl('POT_pot', 0.6);
    board.advanceTo(25_000_000n);

    // Step 6: getRenderState
    const state = board.getRenderState();

    // Verify everything
    assert.equal(state.powered, true);
    assert.equal(state.vcc, 5.0);
    assert.ok(state.leds.length >= 2);

    const led1 = state.leds.find(l => l.id === 'LED_led1');
    const led2 = state.leds.find(l => l.id === 'LED_led2');
    assert.ok(led1 && led1.brightness > 0.10, 'LED1 on');
    assert.ok(led2 && led2.brightness < 0.01, 'LED2 off');

    const pot = state.controls.find(c => c.id === 'POT_pot');
    assert.ok(pot && pot.value === 0.6);

    assert.ok(state.nodeVoltages.length > 0);
    assert.equal(state.warnings.length, 0);
  });

  it('project with buzzer: infer → validate → simulate → tone', () => {
    const pins = [
      { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
      { name: 'buzzer', port: 1, bit: 5, direction: 'output', activeLow: false },
    ];

    const { parts, nets } = inferNetlist({ pins });
    const errors = validateNetlist(parts, nets).filter(e => e.severity === 'error');
    assert.equal(errors.length, 0);

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // LED on
    board.setPin('P1.0', 'quasi', false);

    // Buzzer toggling at 1kHz
    for (let i = 0; i < 20; i++) {
      board.advanceTo(BigInt(i) * 500_000n);
      board.setPin('P1.5', 'pushpull', i % 2 === 0);
    }

    const state = board.getRenderState();

    // LED should be on
    const led = state.leds.find(l => l.id === 'LED_led1');
    assert.ok(led && led.brightness > 0.10, 'LED on');

    // Buzzer should be detected
    const buzz = state.buzzers.find(b => b.id === 'BUZZ_buzzer');
    assert.ok(buzz, 'buzzer should be in render state');
    assert.ok(buzz.on, 'buzzer should be on');
    assert.ok(Math.abs(buzz.hz - 1000) < 100, `buzzer freq ${buzz.hz} ≈ 1kHz`);
  });

  it('empty project: infer → validate → setNetlist succeeds', () => {
    const { parts, nets } = inferNetlist({ pins: [] });
    const errors = validateNetlist(parts, nets).filter(e => e.severity === 'error');
    assert.equal(errors.length, 0);

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets); // should not throw
    const state = board.getRenderState();
    assert.equal(state.leds.length, 0);
    assert.equal(state.buzzers.length, 0);
  });

  it('onChange fires during pipeline', () => {
    const { parts, nets } = inferNetlist({
      pins: [{ name: 'led', port: 1, bit: 0, direction: 'output', activeLow: true }],
    });

    const board = new BoardImpl(5.0);
    const events = [];
    board.onChange(e => events.push(e.type));

    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', false);
    board.advanceTo(1_000_000n);
    board.setControl('BTN_nonexistent', 1); // unknown control is fine
    board.setPower(false);

    assert.ok(events.includes('netlist'));
    assert.ok(events.includes('pin'));
    assert.ok(events.includes('time'));
    assert.ok(events.includes('control'));
    assert.ok(events.includes('power'));
  });

  it('snapshot → modify → restore round-trip', () => {
    const { parts, nets } = inferNetlist({
      pins: [
        { name: 'led', port: 1, bit: 0, direction: 'output', activeLow: true },
        { name: 'pot', port: 1, bit: 3, direction: 'analog', activeLow: false },
      ],
    });

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', false);
    board.setPin('P1.3', 'input', false);
    board.setControl('POT_pot', 0.3);
    board.advanceTo(25_000_000n);

    // Snapshot
    const snap = board.snapshot();
    const bBefore = board.ledBrightness('LED_led');
    const vBefore = board.readAnalog('P1.3');

    // Modify
    board.setPin('P1.0', 'quasi', true); // LED off
    board.setControl('POT_pot', 0.9);
    board.advanceTo(50_000_000n);

    // Restore
    board.restore(snap);
    board.advanceTo(board.getTime() + 1n); // tiny step to re-record samples

    // Should be back to snapshot state
    assert.equal(board.getControl('POT_pot'), 0.3);
    assert.ok(Math.abs(board.readAnalog('P1.3') - 1.5) < 0.1, 'pot restored');
  });
});
