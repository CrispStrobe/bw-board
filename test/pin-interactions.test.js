/**
 * Pin interaction tests — mode transitions, contention, and
 * realistic 8051 initialization sequences.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function makeActiveLowLED() {
  return {
    parts: [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ],
    nets: [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ],
  };
}

describe('8051 reset defaults', () => {
  it('quasi-bidir high is the reset default — LED glows dimly on active-low', () => {
    // After reset, all STC12 ports are quasi-bidir driving 1 (latch = 0xFF).
    // Active-low LED: VCC → 1k → LED → pin. Pin at ~VCC through 21.7kΩ.
    // Both sides near VCC → almost no current → LED off.
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeActiveLowLED();
    board.setNetlist(parts, nets);

    board.setPin('P1.0', 'quasi', true); // reset default
    board.advanceTo(1_000_000n);

    const b = board.ledBrightness('LED1');
    assert.ok(b < 0.01, `reset default: LED should be off, brightness=${b}`);
  });

  it('writing 0 to quasi-bidir turns on active-low LED', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeActiveLowLED();
    board.setNetlist(parts, nets);

    board.setPin('P1.0', 'quasi', true); // reset
    board.advanceTo(1_000_000n);

    board.setPin('P1.0', 'quasi', false); // write 0
    board.advanceTo(25_000_000n);

    const b = board.ledBrightness('LED1');
    assert.ok(b > 0.13, `writing 0: LED should be on, brightness=${b}`);
  });
});

describe('mode transition sequences', () => {
  it('quasi → pushpull transition is instantaneous', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeActiveLowLED();
    board.setNetlist(parts, nets);

    // Start quasi low (LED on, ~2.9 mA)
    board.setPin('P1.0', 'quasi', false);
    board.advanceTo(25_000_000n);
    const bQuasi = board.ledBrightness('LED1');

    // Switch to pushpull low (LED on, same current since Rth is same for low)
    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(50_000_000n);
    const bPP = board.ledBrightness('LED1');

    // Both should be about the same — strong sink in both modes
    assert.ok(Math.abs(bQuasi - bPP) < 0.01,
      `quasi low (${bQuasi}) ≈ pushpull low (${bPP})`);
  });

  it('input → quasi → pushpull → opendrain cycle', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R_PU', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R_PU', terminal: 'a' }] },
      { id: 'np', terminals: [{ part: 'R_PU', terminal: 'b' }, { part: 'MCU', terminal: 'P1.0' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    board.setNetlist(parts, nets);

    // input high-Z: pull-up wins → 1
    board.setPin('P1.0', 'input', false);
    assert.equal(board.readPin('P1.0'), 1, 'input: pulled up');

    // quasi driving 0: strong sink → 0
    board.setPin('P1.0', 'quasi', false);
    assert.equal(board.readPin('P1.0'), 0, 'quasi low: sinks');

    // pushpull driving 1: strong source → 1
    board.setPin('P1.0', 'pushpull', true);
    assert.equal(board.readPin('P1.0'), 1, 'pushpull high: drives');

    // opendrain driving 1: high-Z, pull-up wins → 1
    board.setPin('P1.0', 'opendrain', true);
    assert.equal(board.readPin('P1.0'), 1, 'opendrain high: released');

    // opendrain driving 0: strong sink → 0
    board.setPin('P1.0', 'opendrain', false);
    assert.equal(board.readPin('P1.0'), 0, 'opendrain low: sinks');
  });
});

describe('pin contention', () => {
  it('pushpull high vs pushpull low on same net — stronger one wins', () => {
    // Two pins driving opposite on the same net through the general resolver.
    // Both are 25Ω. Norton: I = VCC/25 from high, G_total = 2/25.
    // V = (VCC/25) / (2/25) = VCC/2 = 2.5V. Reads as 1 (>1.5V).
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
      { id: 'np', terminals: [
        { part: 'MCU', terminal: 'P1.0' },
        { part: 'MCU', terminal: 'P1.1' },
      ]},
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    board.setNetlist(parts, nets);

    board.setPin('P1.0', 'pushpull', true);  // 5V through 25Ω
    board.setPin('P1.1', 'pushpull', false); // 0V through 25Ω
    // Same Thévenin R → voltage = average = 2.5V
    const v = board.readAnalog('P1.0');
    assert.ok(Math.abs(v - 2.5) < 0.1,
      `contention: voltage ${v} should be ~2.5V (average)`);
  });

  it('pushpull vs quasi — pushpull dominates', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
      { id: 'np', terminals: [
        { part: 'MCU', terminal: 'P1.0' },
        { part: 'MCU', terminal: 'P1.1' },
      ]},
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    board.setNetlist(parts, nets);

    // PP drives high (25Ω), quasi drives low (25Ω) → tie → 2.5V
    board.setPin('P1.0', 'pushpull', true);
    board.setPin('P1.1', 'quasi', false);
    const v1 = board.readAnalog('P1.0');
    assert.ok(Math.abs(v1 - 2.5) < 0.1, `PP high vs quasi low: ${v1} ≈ 2.5V`);

    // PP drives low (25Ω), quasi drives high (21.7kΩ) → PP wins
    board.setPin('P1.0', 'pushpull', false);
    board.setPin('P1.1', 'quasi', true);
    const v2 = board.readAnalog('P1.0');
    assert.ok(v2 < 0.1, `PP low vs quasi high: ${v2} should be near 0V`);
  });
});

describe('multiple setPin before advanceTo', () => {
  it('only the final state matters for the solve', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeActiveLowLED();
    board.setNetlist(parts, nets);

    // Rapid mode changes — only the last one should determine the LED
    board.setPin('P1.0', 'pushpull', false); // on
    board.setPin('P1.0', 'pushpull', true);  // off
    board.setPin('P1.0', 'pushpull', false); // on
    board.setPin('P1.0', 'quasi', true);     // off (final)

    board.advanceTo(25_000_000n);

    const b = board.ledBrightness('LED1');
    assert.ok(b < 0.01, `final state is quasi high → LED off, brightness=${b}`);
  });
});

describe('ADC reads through different port modes', () => {
  it('input mode gives clean pot reading', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'POT', kind: 'potentiometer', params: { ohms: 10000 }, terminals: ['a', 'b', 'wiper'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'POT', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'POT', terminal: 'b' }] },
      { id: 'nw', terminals: [{ part: 'POT', terminal: 'wiper' }, { part: 'MCU', terminal: 'P1.3' }] },
    ];
    board.setNetlist(parts, nets);
    board.setControl('POT', 0.5);

    // Input mode: high-Z, no loading
    board.setPin('P1.3', 'input', false);
    const vInput = board.readAnalog('P1.3');
    assert.ok(Math.abs(vInput - 2.5) < 0.01, `input: ${vInput}`);

    // Quasi mode driving 1: the closed-form pot model is an ideal divider
    // (zero output impedance), so the weak pull-up can't load it.
    // The MNA solver would show loading. For the closed-form path,
    // the wiper voltage stays at exactly VCC*position.
    board.setPin('P1.3', 'quasi', true);
    const vQuasi = board.readAnalog('P1.3');
    assert.ok(Math.abs(vQuasi - 2.5) < 0.01,
      `quasi high: ideal pot not loaded by closed-form solver: ${vQuasi}`);

    // Push-pull driving 1: the closed-form pot is an ideal voltage source,
    // so even push-pull can't override it in the closed-form solver.
    // The MNA solver would show the pin dominating. For the closed-form path,
    // the pot sets the wiper voltage before net resolution, and the pin's
    // Thévenin source is not reflected back to the wiper.
    board.setPin('P1.3', 'pushpull', true);
    const vPP = board.readAnalog('P1.3');
    // In the MNA, this would be ~5V. In closed-form, pot wins.
    assert.ok(Math.abs(vPP - 2.5) < 0.01,
      `closed-form: ideal pot not overridden: ${vPP}`);
  });
});
