/**
 * Test: LED active-low wiring — the lesson the simulator must teach.
 *
 * Circuit: VCC (5V) → 1kΩ resistor → LED (Vf=2V, Rd=10Ω) → MCU pin
 *
 * This is the correct wiring for a quasi-bidirectional 8051 pin.
 * Writing 0 (strong sink) lights the LED; writing 1 (weak source) does not.
 *
 * Hand-computed values (the oracle):
 *
 *   Push-pull driving 0 (Vth=0, Rth=25Ω):
 *     Loop: 5V across [1000Ω + 10Ω + 25Ω], minus 2V LED drop.
 *     I = (5 - 2) / (1000 + 10 + 25) = 3 / 1035 ≈ 2.899 mA
 *     Brightness = 2.899 / 20 ≈ 0.1449
 *
 *   Quasi-bidir driving 0 (Vth=0, Rth=25Ω):
 *     Same as push-pull driving 0 — strong sink is the same.
 *     I ≈ 2.899 mA, brightness ≈ 0.1449
 *
 *   Quasi-bidir driving 1 (Vth=5V, Rth=21700Ω):
 *     The pin side is now at ~5V through 21.7kΩ. VCC side is 5V through 1kΩ.
 *     Both sides are at ~5V, so almost no potential difference across the LED.
 *     More precisely: Vpin_thev=5V, Rpin=21700Ω vs Vvcc=5V, Rvcc_side=1000Ω.
 *     Net voltage difference = 0V. No current. LED off.
 *     I = 0, brightness = 0
 *
 *   Push-pull driving 1 (Vth=5V, Rth=25Ω):
 *     Pin at 5V through 25Ω, VCC at 5V through 1kΩ.
 *     Net voltage difference = 0V. No current. LED off.
 *     (Both are at VCC — current would need to flow from VCC through the LED
 *     to VCC, which requires a voltage difference. There is none.)
 *     I = 0, brightness = 0
 *
 * The NAIVE wiring test (pin → 1kΩ → LED → GND):
 *
 *   Quasi-bidir driving 1 (Vth=5V, Rth=21700Ω):
 *     I = (5 - 2) / (21700 + 1000 + 10) = 3 / 22710 ≈ 0.132 mA
 *     Brightness = 0.132 / 20 ≈ 0.0066  — barely visible!
 *
 *   Push-pull driving 1 (Vth=5V, Rth=25Ω):
 *     I = (5 - 2) / (25 + 1000 + 10) = 3 / 1035 ≈ 2.899 mA
 *     Brightness ≈ 0.1449 — bright, but only with push-pull.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { runTrace } from '../src/scripted-mcu.js';

/**
 * Build the active-low LED circuit:
 *   VCC → R1 (1kΩ) → LED1 (anode→cathode) → MCU pin P1.0
 *
 * Nets:
 *   net_vcc:      VCC.vcc, R1.a
 *   net_r_led:    R1.b, LED1.anode
 *   net_led_pin:  LED1.cathode, MCU.P1.0
 */
function makeActiveLowCircuit() {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'LED1', kind: 'led', params: { vf: 2.0, color: 'red' }, terminals: ['anode', 'cathode'] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
  ];
  const nets = [
    { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
    { id: 'net_r_led', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
    { id: 'net_led_pin', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
  ];
  return { parts, nets };
}

/**
 * Build the naive (wrong) LED circuit:
 *   MCU pin P1.0 → R1 (1kΩ) → LED1 (anode→cathode) → GND
 *
 * Nets:
 *   net_pin_r:    MCU.P1.0, R1.a
 *   net_r_led:    R1.b, LED1.anode
 *   net_led_gnd:  LED1.cathode, GND.gnd
 */
function makeNaiveCircuit() {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'LED1', kind: 'led', params: { vf: 2.0, color: 'red' }, terminals: ['anode', 'cathode'] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
  ];
  const nets = [
    { id: 'net_pin_r', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'R1', terminal: 'a' }] },
    { id: 'net_r_led', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
    { id: 'net_led_gnd', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'GND', terminal: 'gnd' }] },
  ];
  return { parts, nets };
}

describe('LED active-low wiring (the correct way)', () => {
  it('quasi-bidir driving 0 → LED bright (~2.9 mA)', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeActiveLowCircuit();
    board.setNetlist(parts, nets);

    // Pin drives low — strong sink
    board.setPin('P1.0', 'quasi', false);
    board.advanceTo(1_000_000n); // 1 ms

    // Hand-computed: I = 3/1035 ≈ 0.002899 A → brightness ≈ 0.1449
    const brightness = board.ledBrightness('LED1');
    assert.ok(brightness > 0.13, `brightness ${brightness} should be > 0.13`);
    assert.ok(brightness < 0.16, `brightness ${brightness} should be < 0.16`);
  });

  it('quasi-bidir driving 1 → LED off (both sides at VCC)', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeActiveLowCircuit();
    board.setNetlist(parts, nets);

    // Pin drives high — weak pull-up at ~5V
    board.setPin('P1.0', 'quasi', true);
    board.advanceTo(1_000_000n);

    const brightness = board.ledBrightness('LED1');
    assert.ok(brightness < 0.01, `brightness ${brightness} should be ≈ 0 (both sides at VCC)`);
  });

  it('push-pull driving 0 → LED bright (same current as quasi sink)', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeActiveLowCircuit();
    board.setNetlist(parts, nets);

    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(1_000_000n);

    const brightness = board.ledBrightness('LED1');
    assert.ok(brightness > 0.13, `brightness ${brightness} should be > 0.13`);
    assert.ok(brightness < 0.16, `brightness ${brightness} should be < 0.16`);
  });

  it('push-pull driving 1 → LED off (both sides at VCC)', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeActiveLowCircuit();
    board.setNetlist(parts, nets);

    board.setPin('P1.0', 'pushpull', true);
    board.advanceTo(1_000_000n);

    const brightness = board.ledBrightness('LED1');
    assert.ok(brightness < 0.01, `brightness ${brightness} should be ≈ 0`);
  });
});

describe('LED naive wiring (pin → R → LED → GND) — the lesson', () => {
  it('quasi-bidir driving 1 → LED barely visible (~0.13 mA)', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeNaiveCircuit();
    board.setNetlist(parts, nets);

    // Quasi-bidir driving 1: weak pull-up, Rth=21700Ω
    board.setPin('P1.0', 'quasi', true);
    board.advanceTo(1_000_000n);

    // Hand-computed: I = 3/22710 ≈ 0.000132 A → brightness ≈ 0.0066
    const brightness = board.ledBrightness('LED1');
    assert.ok(brightness < 0.02, `brightness ${brightness} should be < 0.02 (barely visible)`);
    assert.ok(brightness > 0.001, `brightness ${brightness} should be > 0 (some tiny current)`);
  });

  it('push-pull driving 1 → LED bright (~2.9 mA)', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeNaiveCircuit();
    board.setNetlist(parts, nets);

    // Push-pull driving 1: strong source, Rth=25Ω
    board.setPin('P1.0', 'pushpull', true);
    board.advanceTo(1_000_000n);

    // Hand-computed: I = 3/1035 ≈ 0.002899 A → brightness ≈ 0.1449
    const brightness = board.ledBrightness('LED1');
    assert.ok(brightness > 0.13, `brightness ${brightness} should be > 0.13`);
    assert.ok(brightness < 0.16, `brightness ${brightness} should be < 0.16`);
  });

  it('quasi-bidir driving 0 → LED off (reverse biased)', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeNaiveCircuit();
    board.setNetlist(parts, nets);

    // Pin at 0V, GND at 0V — no potential difference through the LED
    board.setPin('P1.0', 'quasi', false);
    board.advanceTo(1_000_000n);

    const brightness = board.ledBrightness('LED1');
    assert.ok(brightness < 0.01, `brightness ${brightness} should be ≈ 0`);
  });
});

describe('scripted trace — the active-low demo', () => {
  it('replays pin events and checks brightness', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeActiveLowCircuit();
    board.setNetlist(parts, nets);

    const failures = runTrace(board, [
      // Drive low — LED should light
      { t: 0n, setPin: ['P1.0', 'quasi', false] },
      { t: 1_000_000n, expect: { ledBrightness: ['LED1', 0.145, 0.02] } },
      // Drive high — LED should go dark. Wait past the 20ms integration window.
      { t: 2_000_000n, setPin: ['P1.0', 'quasi', true] },
      { t: 25_000_000n, expect: { ledBrightness: ['LED1', 0, 0.01] } },
    ]);

    if (failures.length > 0) {
      for (const f of failures) {
        console.log(`FAIL: ${f.field} expected=${f.expected} actual=${f.actual}`);
      }
    }
    assert.equal(failures.length, 0, `${failures.length} assertion(s) failed`);
  });
});
