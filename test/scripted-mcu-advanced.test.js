/**
 * Advanced scripted-MCU trace tests — multi-channel, interleaved events,
 * and assertion types.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { runTrace } from '../src/scripted-mcu.js';

describe('scripted-MCU: multi-channel trace', () => {
  it('LED + pot + button in one trace', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'POT1', kind: 'potentiometer', params: { ohms: 10000 }, terminals: ['a', 'b', 'wiper'] },
      { id: 'R_PU', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'BTN1', kind: 'button', params: {}, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.3', 'P3.2'] },
    ];
    const nets = [
      { id: 'nv', terminals: [
        { part: 'VCC', terminal: 'vcc' },
        { part: 'R1', terminal: 'a' },
        { part: 'POT1', terminal: 'a' },
        { part: 'R_PU', terminal: 'a' },
      ]},
      { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'np0', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
      { id: 'ng', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'POT1', terminal: 'b' },
        { part: 'BTN1', terminal: 'b' },
      ]},
      { id: 'nw', terminals: [{ part: 'POT1', terminal: 'wiper' }, { part: 'MCU', terminal: 'P1.3' }] },
      { id: 'np2', terminals: [
        { part: 'R_PU', terminal: 'b' },
        { part: 'BTN1', terminal: 'a' },
        { part: 'MCU', terminal: 'P3.2' },
      ]},
    ];
    board.setNetlist(parts, nets);

    // Setup pins
    board.setPin('P1.0', 'quasi', true);
    board.setPin('P1.3', 'input', false);
    board.setPin('P3.2', 'input', false);
    board.setControl('POT1', 0.5);

    const failures = runTrace(board, [
      // LED off initially
      { t: 1_000_000n, expect: { ledBrightness: ['LED1', 0, 0.01] } },

      // Turn LED on
      { t: 2_000_000n, setPin: ['P1.0', 'quasi', false] },
      { t: 25_000_000n, expect: { ledBrightness: ['LED1', 0.145, 0.02] } },

      // Check pot reading
      { t: 26_000_000n, expect: { readAnalog: ['P1.3', 2.5, 0.1] } },

      // Check button (not pressed)
      { t: 27_000_000n, expect: { readPin: ['P3.2', 1] } },

      // Turn LED off
      { t: 28_000_000n, setPin: ['P1.0', 'quasi', true] },
      { t: 50_000_000n, expect: { ledBrightness: ['LED1', 0, 0.01] } },
    ]);

    assert.equal(failures.length, 0,
      `failures: ${failures.map(f => `${f.field}: expected=${f.expected} actual=${f.actual}`).join(', ')}`);
  });
});

describe('scripted-MCU: nodeVoltage assertions', () => {
  it('voltage divider node tracked through trace', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nm', terminals: [
        { part: 'R1', terminal: 'b' },
        { part: 'R2', terminal: 'a' },
        { part: 'MCU', terminal: 'P1.3' },
      ]},
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R2', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);

    const failures = runTrace(board, [
      // With input mode, divider gives 2.5V
      { t: 0n, expect: { nodeVoltage: ['nm', 2.5, 0.01] } },
      // Drive pushpull low → pin overrides divider
      // V = (VCC/R1) / (1/R1 + 1/R2 + 1/Rpin) = 0.005 / 0.042 ≈ 0.119V
      { t: 1_000_000n, setPin: ['P1.3', 'pushpull', false] },
      { t: 2_000_000n, expect: { nodeVoltage: ['nm', 0.119, 0.02] } },
      // Back to input → divider returns
      { t: 3_000_000n, setPin: ['P1.3', 'input', false] },
      { t: 4_000_000n, expect: { nodeVoltage: ['nm', 2.5, 0.01] } },
    ]);

    assert.equal(failures.length, 0,
      `failures: ${failures.map(f => `${f.field}: expected=${f.expected} actual=${f.actual}`).join(', ')}`);
  });
});

describe('scripted-MCU: empty and trivial traces', () => {
  it('empty trace produces no failures', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    const failures = runTrace(board, []);
    assert.equal(failures.length, 0);
  });

  it('trace with only time advances', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    const failures = runTrace(board, [
      { t: 0n },
      { t: 1_000_000n },
      { t: 2_000_000n },
    ]);
    assert.equal(failures.length, 0);
  });

  it('trace with only setPin (no assertions)', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [{ id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] }],
      [{ id: 'np', terminals: [{ part: 'MCU', terminal: 'P1.0' }] }],
    );
    const failures = runTrace(board, [
      { t: 0n, setPin: ['P1.0', 'pushpull', false] },
      { t: 1_000_000n, setPin: ['P1.0', 'pushpull', true] },
    ]);
    assert.equal(failures.length, 0);
  });

  it('intentionally failing assertion is reported', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    // This SHOULD fail — nodeVoltage('nv') is 5V, not 0V
    const failures = runTrace(board, [
      { t: 0n, expect: { nodeVoltage: ['nv', 0, 0.01] } },
    ]);
    assert.equal(failures.length, 1, 'should report one failure');
    assert.ok(failures[0].field.includes('nodeVoltage'));
    assert.equal(failures[0].expected, 0);
    assert.equal(failures[0].actual, 5);
  });
});
