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

/**
 * ADC READS THROUGH DIFFERENT PORT MODES.
 *
 * THIS SUITE USED TO ASSERT THE DEFECT, and its own comments said so:
 *
 *   "the closed-form pot model is an ideal divider (zero output impedance), so
 *    the weak pull-up can't load it. THE MNA SOLVER WOULD SHOW LOADING."
 *   "even push-pull can't override it ... THE MNA SOLVER WOULD SHOW THE PIN
 *    DOMINATING."
 *
 * Both notes are correct about the mechanism and wrong about what to expect:
 * they pinned which internal SOLVER PATH ran, at a value they knew to be
 * physically wrong. A test whose comment names the right answer and then
 * asserts a different one cannot fail when the bug is fixed -- it fails when
 * the FIX is.
 *
 * The routing defect is fixed (`board.js`, the wiper-load test asks
 * `pinThevenin` about the pin's MODE instead of exempting the whole `mcu`
 * KIND), so the engine now answers the physics. Every expectation below is
 * ngspice's, on the same divider with the pin's Thévenin resistance as a third
 * leg -- `.options temp=26.8267934421 tnom=26.8267934421`:
 *
 *   mode            pin Thevenin        ngspice wiper
 *   input           high-z              2.500000  (unloaded midpoint)
 *   quasi high      5 V via 21.7 k      2.758264
 *   input-pullup    5 V via 35 k        2.666667
 *   pushpull high   5 V via 25          4.975248
 *   pushpull low    0 V via 25          0.024752
 *
 * and the engine matches each to better than 1e-6.
 */
describe('ADC reads through different port modes', () => {
  const rig = () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'POT', kind: 'potentiometer', params: { ohms: 10000 }, terminals: ['a', 'b', 'wiper'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] },
    ], [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'POT', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'POT', terminal: 'b' }] },
      { id: 'nw', terminals: [{ part: 'POT', terminal: 'wiper' }, { part: 'MCU', terminal: 'P1.3' }] },
    ]);
    board.setControl('POT', 0.5);
    return board;
  };

  // [mode, driveHigh, ngspice's wiper voltage]
  const CASES = [
    ['input', false, 2.500000],
    ['quasi', true, 2.758264],
    ['input-pullup', false, 2.666667],
    ['pushpull', true, 4.975248],
    ['pushpull', false, 0.024752],
  ];

  for (const [mode, driveHigh, expected] of CASES) {
    it(`${mode}${mode.startsWith('push') || mode === 'quasi' ? (driveHigh ? ' high' : ' low') : ''} reads ${expected} V, as ngspice does`, () => {
      const board = rig();
      board.setPin('P1.3', mode, driveHigh);
      const v = board.readAnalog('P1.3');
      assert.ok(Math.abs(v - expected) < 1e-5,
        `${mode} driveHigh=${driveHigh}: read ${v} V, ngspice ${expected} V`);
    });
  }

  it('a high-Z input is the ONLY mode that leaves the divider alone', () => {
    // The claim the old suite was reaching for, stated so it can fail: every
    // other mode must move the wiper off the bare midpoint, because every
    // other mode presents a finite Thevenin resistance to it.
    const unloaded = 2.5;
    for (const [mode, driveHigh] of CASES) {
      const board = rig();
      board.setPin('P1.3', mode, driveHigh);
      const v = board.readAnalog('P1.3');
      if (mode === 'input') {
        assert.ok(Math.abs(v - unloaded) < 1e-6, `input must not load: ${v}`);
      } else {
        assert.ok(Math.abs(v - unloaded) > 1e-3,
          `${mode} (driveHigh=${driveHigh}) presents a finite resistance and must `
          + `load the wiper, but it read the bare midpoint ${v}`);
      }
    }
  });
});
