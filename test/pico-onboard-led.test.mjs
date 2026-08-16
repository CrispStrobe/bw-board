/**
 * Pi Pico onboard LED (GP25) — composite expansion tests.
 *
 * The Pico's GP25 is not a header pin; it drives an onboard LED through
 * a ~1 kΩ resistor to GND.  The pi_pico device model expands GP25 into
 * a synthetic resistor + LED so that:
 *   - Retargeted blink netlists that assign led1=GP25 are ACCEPTED
 *   - ledBrightness('<picoId>_onboard') reports the onboard LED state
 *   - External LEDs on header pins still work alongside the onboard one
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { BoardImpl } from '../src/board.js';
import { registerBoardKinds } from '../src/devices/board-kinds.js';

try { registerBoardKinds(); } catch {}

// ── helpers ──────────────────────────────────────────────────────────────

/** Minimal blink netlist: Pi Pico with GP25 wired (onboard LED only). */
function onboardOnlyNetlist(picoId = 'PICO') {
  return {
    parts: [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: picoId, kind: 'pi_pico', params: {}, terminals: [
        'gp25', 'gnd_1', '3v3', 'vbus',
      ]},
    ],
    nets: [
      { id: 'pwr', terminals: [
        { part: 'VCC', terminal: 'vcc' },
        { part: picoId, terminal: 'vbus' },
      ]},
      { id: 'gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: picoId, terminal: 'gnd_1' },
      ]},
      { id: 'gp25_net', terminals: [
        { part: picoId, terminal: 'gp25' },
      ]},
    ],
  };
}

/** Retargeted blink: external LED on GP0, PLUS onboard on GP25. */
function externalPlusOnboardNetlist(picoId = 'PICO') {
  return {
    parts: [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: picoId, kind: 'pi_pico', params: {}, terminals: [
        'gp0', 'gp25', 'gnd_1', '3v3', 'vbus',
      ]},
      { id: 'R1', kind: 'resistor', params: { resistance: 330 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: {}, terminals: ['anode', 'cathode'] },
    ],
    nets: [
      { id: 'pwr', terminals: [
        { part: 'VCC', terminal: 'vcc' },
        { part: picoId, terminal: 'vbus' },
      ]},
      { id: 'gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: picoId, terminal: 'gnd_1' },
      ]},
      { id: 'gp0_net', terminals: [
        { part: picoId, terminal: 'gp0' },
        { part: 'R1', terminal: 'a' },
      ]},
      { id: 'r_to_led', terminals: [
        { part: 'R1', terminal: 'b' },
        { part: 'LED1', terminal: 'anode' },
      ]},
      { id: 'led_gnd', terminals: [
        { part: 'LED1', terminal: 'cathode' },
        { part: 'GND', terminal: 'gnd' },
      ]},
      { id: 'gp25_net', terminals: [
        { part: picoId, terminal: 'gp25' },
      ]},
    ],
  };
}

// ── tests ────────────────────────────────────────────────────────────────

describe('Pi Pico onboard LED (GP25)', () => {

  it('pi_pico device has gp25 terminal', () => {
    // setNetlist should not throw — gp25 is a valid terminal
    const board = new BoardImpl(3.3);
    const nl = onboardOnlyNetlist();
    board.setNetlist(nl.parts, nl.nets);
    // Verify the synthetic parts were created
    const onboardLed = board.parts.find(p => p.id === 'PICO_onboard');
    assert.ok(onboardLed, 'synthetic onboard LED should exist');
    assert.strictEqual(onboardLed.kind, 'led');

    const onboardR = board.parts.find(p => p.id === 'PICO_onboard_r');
    assert.ok(onboardR, 'synthetic onboard resistor should exist');
    assert.strictEqual(onboardR.kind, 'resistor');
    assert.strictEqual(onboardR.params.resistance, 1000);
  });

  it('retargeted blink netlist with GP25 is accepted (not rejected)', () => {
    const board = new BoardImpl(3.3);
    const nl = externalPlusOnboardNetlist();
    // This must NOT throw — previously GP25 was rejected as unknown terminal
    assert.doesNotThrow(() => board.setNetlist(nl.parts, nl.nets));
  });

  it('setting gp25 HIGH lights onboard LED (brightness > 0)', () => {
    const board = new BoardImpl(3.3);
    const nl = onboardOnlyNetlist();
    board.setNetlist(nl.parts, nl.nets);

    // Drive GP25 high (3.3V push-pull, like the RP2040 adapter would)
    board.setPin('gp25', 'pushpull', true);
    // Advance time so the brightness window has data
    board.advanceTo(25_000_000n);  // 25 ms

    const brightness = board.ledBrightness('PICO_onboard');
    assert.ok(brightness > 0,
      `onboard LED should be lit when GP25=HIGH, got brightness=${brightness}`);
  });

  it('gp25 LOW → onboard LED dark (brightness ≈ 0)', () => {
    const board = new BoardImpl(3.3);
    const nl = onboardOnlyNetlist();
    board.setNetlist(nl.parts, nl.nets);

    // Drive GP25 low
    board.setPin('gp25', 'pushpull', false);
    board.advanceTo(25_000_000n);

    const brightness = board.ledBrightness('PICO_onboard');
    assert.ok(brightness < 0.01,
      `onboard LED should be dark when GP25=LOW, got brightness=${brightness}`);
  });

  it('external LED on GP0 + onboard LED on GP25 coexist', () => {
    const board = new BoardImpl(3.3);
    const nl = externalPlusOnboardNetlist();
    board.setNetlist(nl.parts, nl.nets);

    // Drive both high
    board.setPin('gp0', 'pushpull', true);
    board.setPin('gp25', 'pushpull', true);
    board.advanceTo(25_000_000n);

    const onboardB = board.ledBrightness('PICO_onboard');
    const externalB = board.ledBrightness('LED1');
    assert.ok(onboardB > 0, `onboard LED should be lit, got ${onboardB}`);
    assert.ok(externalB > 0, `external LED should be lit, got ${externalB}`);
  });

  it('onboard LED brightness scales with GP25 voltage (3.3V logic)', () => {
    const board = new BoardImpl(3.3);
    const nl = onboardOnlyNetlist();
    board.setNetlist(nl.parts, nl.nets);

    board.setPin('gp25', 'pushpull', true);
    board.advanceTo(25_000_000n);

    const brightness = board.ledBrightness('PICO_onboard');
    // With 3.3V through 1kΩ + LED (Vf≈2V), I ≈ 1.3 mA
    // Brightness = 1.3mA / 20mA = 0.065 — should be modest
    assert.ok(brightness > 0.01 && brightness < 0.5,
      `brightness should be modest (3.3V/1kΩ), got ${brightness}`);
  });
});
