/**
 * Preview tests for PWM duty cycle → ledBrightness and buzzerTone.
 *
 * These simulate what a real PCA-driven firmware would produce,
 * using the real example bundle circuits. When the emitter adds PCA
 * support, these become integration tests instead of simulations.
 *
 * Currently: ledBrightness and buzzerTone have never been exercised
 * by a real program (blocked on PCA blocks in stc_pseudocode.py).
 * These tests prove the transducers work with realistic pin patterns.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { BoardImpl } from '../src/board.js';
import { inferNetlist } from '../src/infer-netlist.js';

const EXAMPLES_DIR = '/mnt/volume1/code/stc/examples';

function loadPins(name) {
  const path = `${EXAMPLES_DIR}/${name}/pins.json`;
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// ─── PWM on 04-brightness circuit ─────────────────────────────────────────

describe('PWM preview: 04-brightness with duty cycle', () => {
  const stc = loadPins('04-brightness');
  if (!stc) { it.skip('pins.json not found'); return; }

  it('50% PWM on active-low LED → 50% of steady brightness', () => {
    const { parts, nets } = inferNetlist(stc);
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // PWM at 1kHz, 50% duty on active-low LED (P1.0)
    // Pin LOW = LED on (active-low), pin HIGH = LED off
    const PERIOD = 1_000_000n;
    for (let i = 0; i < 30; i++) {
      const t = BigInt(i) * PERIOD;
      board.advanceTo(t);
      board.setPin('P1.0', 'quasi', false); // on
      board.advanceTo(t + PERIOD / 2n);
      board.setPin('P1.0', 'quasi', true);  // off
    }
    board.advanceTo(30n * PERIOD);

    const b = board.ledBrightness('LED_low_side');
    // Steady: ~0.145, 50% duty → ~0.0725
    assert.ok(b > 0.05, `50% PWM: ${b} > 0.05`);
    assert.ok(b < 0.10, `50% PWM: ${b} < 0.10`);
  });

  it('25% PWM → 25% brightness, 75% PWM → 75% brightness', () => {
    const { parts, nets } = inferNetlist(stc);
    const PERIOD = 1_000_000n;
    const steadyB = 0.145; // approximate

    for (const duty of [0.25, 0.75]) {
      const board = new BoardImpl(5.0);
      board.setNetlist(parts, nets);

      const onNs = BigInt(Math.round(Number(PERIOD) * duty));
      for (let i = 0; i < 30; i++) {
        const t = BigInt(i) * PERIOD;
        board.advanceTo(t);
        board.setPin('P1.0', 'quasi', false);
        board.advanceTo(t + onNs);
        board.setPin('P1.0', 'quasi', true);
      }
      board.advanceTo(30n * PERIOD);

      const b = board.ledBrightness('LED_low_side');
      const expected = duty * steadyB;
      assert.ok(Math.abs(b - expected) < 0.03,
        `${duty * 100}% duty: brightness ${b.toFixed(4)} ≈ ${expected.toFixed(4)}`);
    }
  });

  it('asymmetry visible under PWM: active-low bright, active-high dim at same duty', () => {
    const { parts, nets } = inferNetlist(stc);
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Both LEDs at 50% PWM, quasi mode
    const PERIOD = 1_000_000n;
    for (let i = 0; i < 30; i++) {
      const t = BigInt(i) * PERIOD;
      board.advanceTo(t);
      board.setPin('P1.0', 'quasi', false); // low_side on
      board.setPin('P1.1', 'quasi', true);  // high_side on (active-high)
      board.advanceTo(t + PERIOD / 2n);
      board.setPin('P1.0', 'quasi', true);  // low_side off
      board.setPin('P1.1', 'quasi', false); // high_side off
    }
    board.advanceTo(30n * PERIOD);

    const bLow = board.ledBrightness('LED_low_side');
    const bHigh = board.ledBrightness('LED_high_side');

    // Active-low with sink: ~50% of 0.145 = ~0.0725
    // Active-high with quasi source: ~50% of 0.007 = ~0.0035
    assert.ok(bLow > bHigh * 5,
      `PWM asymmetry: low_side (${bLow}) >> high_side (${bHigh})`);
  });
});

// ─── Buzzer simulation on 01-blink circuit ────────────────────────────────

describe('PWM preview: buzzer on blink circuit', () => {
  it('simulated buzzer: pin toggle at 1kHz → buzzerTone detects 1kHz', () => {
    // Use the blink circuit but add a buzzer manually
    // (inferNetlist doesn't create buzzers from OUTPUT pins unless named "buzzer")
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'BUZZ', kind: 'buzzer', params: {}, terminals: ['a', 'b'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.5'] },
      ],
      [
        { id: 'nb', terminals: [{ part: 'MCU', terminal: 'P1.5' }, { part: 'BUZZ', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'BUZZ', terminal: 'b' }] },
      ],
    );

    // Simulate PCA PWM output: toggle every 500µs = 1kHz
    for (let i = 0; i < 40; i++) {
      board.advanceTo(BigInt(i) * 500_000n);
      board.setPin('P1.5', 'pushpull', i % 2 === 0);
    }

    const tone = board.buzzerTone('BUZZ');
    assert.ok(tone.on, 'buzzer should detect signal');
    assert.ok(Math.abs(tone.hz - 1000) < 50, `freq ${tone.hz} ≈ 1000 Hz`);
  });

  it('pot controls buzzer frequency (simulated firmware loop)', () => {
    const stc = loadPins('03-potentiometer');
    if (!stc) { return; }

    // Build circuit with pot + buzzer
    const { parts: potParts, nets: potNets } = inferNetlist(stc);

    // Add buzzer to the circuit
    const board = new BoardImpl(5.0);
    const allParts = [
      ...potParts,
      { id: 'BUZZ', kind: 'buzzer', params: {}, terminals: ['a', 'b'] },
    ];
    // Extend MCU terminals
    const mcu = allParts.find(p => p.kind === 'mcu');
    if (!mcu.terminals.includes('P1.5')) mcu.terminals.push('P1.5');

    const allNets = [
      ...potNets,
      { id: 'nb', terminals: [{ part: 'MCU', terminal: 'P1.5' }, { part: 'BUZZ', terminal: 'a' }] },
    ];
    // Add buzzer GND to existing GND net
    const gndNet = allNets.find(n => n.id === 'net_gnd');
    if (gndNet) gndNet.terminals.push({ part: 'BUZZ', terminal: 'b' });

    board.setNetlist(allParts, allNets);
    board.setPin('P1.2', 'input', false);
    board.setPin('P1.5', 'pushpull', false);

    // Pot at 50% → read ADC → map to frequency → toggle buzzer
    board.setControl('POT_pot', 0.5);
    const adcV = board.readAnalog('P1.2');
    // Map 0-5V to 200-2000 Hz
    const targetHz = 200 + (adcV / 5.0) * 1800;
    const halfPeriodNs = BigInt(Math.round(1e9 / (2 * targetHz)));

    for (let i = 0; i < 40; i++) {
      board.advanceTo(BigInt(i) * halfPeriodNs);
      board.setPin('P1.5', 'pushpull', i % 2 === 0);
    }

    const tone = board.buzzerTone('BUZZ');
    assert.ok(tone.on, 'buzzer on');
    assert.ok(Math.abs(tone.hz - targetHz) < targetHz * 0.1,
      `freq ${tone.hz} ≈ ${targetHz.toFixed(0)} Hz`);
  });
});

// ─── Probe on example circuits ────────────────────────────────────────────

describe('PWM preview: oscilloscope capture', () => {
  it('probe captures PWM waveform on 04-brightness circuit', () => {
    const stc = loadPins('04-brightness');
    if (!stc) return;

    const { parts, nets } = inferNetlist(stc);
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Probe the active-low LED's cathode net
    const ledNet = nets.find(n => n.terminals.some(
      t => t.part === 'MCU' && t.terminal === 'P1.0'
    ));
    if (!ledNet) return;

    board.addProbe(ledNet.id);

    // 50% PWM at 1kHz
    const PERIOD = 1_000_000n;
    for (let i = 0; i < 20; i++) {
      const t = BigInt(i) * PERIOD;
      board.advanceTo(t);
      board.setPin('P1.0', 'quasi', false);
      board.advanceTo(t + PERIOD / 2n);
      board.setPin('P1.0', 'quasi', true);
    }

    const data = board.getProbeData(ledNet.id);
    assert.ok(data.length >= 20, `captured ${data.length} samples`);

    // Should see alternating low and high voltages
    let lows = 0, highs = 0;
    for (const s of data) {
      if (s.v < 0.5) lows++;
      else if (s.v > 2.0) highs++;
    }
    assert.ok(lows > 0 && highs > 0,
      `PWM visible in probe: ${lows} lows, ${highs} highs`);
  });
});
