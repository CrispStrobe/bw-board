// AVR hardware-PWM observation tests — prove that the timer's OC pin
// overrides propagate through the adapter to the board as real edges,
// so ledBrightness reflects duty cycle, not just on/off.
//
// Oracle arithmetic (all hand-computed, no toolchain):
//
//   Timer0 fast PWM mode 3 (WGM = 0b011):
//     TOP = 0xFF = 255
//     Prescaler 64 (CS = 0b011): f_timer = 16 MHz / 64 = 250 kHz
//     f_PWM = 250 kHz / (TOP+1) = 250000 / 256 = 976.5625 Hz
//     Period = 1024 µs
//
//   Non-inverting mode (COM = 0b10):
//     Set at BOTTOM (TCNT=0), clear at COMPARE MATCH (TCNT=OCR)
//     Duty = OCR / (TOP+1) = OCR / 256
//
//   LED circuit: pin → 1 kΩ → LED(Vf=2V) → GND, supply 5V
//     Pin HIGH (push-pull 5V): I = (5−2)/1000 = 3 mA
//     Pin LOW (push-pull 0V):  I = 0 mA
//     Brightness = avg_I / 20 mA = 0.15 × duty
//
//   OCR=128 → duty=128/256=0.500 → brightness=0.0750
//   OCR=64  → duty= 64/256=0.250 → brightness=0.0375
//   OCR=192 → duty=192/256=0.750 → brightness=0.1125
//
// NOP loop: the CPU must run for the timer to count.
//   word 0: NOP        0x0000  (1 cycle)
//   word 1: RJMP .-2   0xCFFE  (2 cycles, back to word 0)
//   3 cycles per iteration. Runs indefinitely while timer PWMs.
//
// Register addresses (from timer0Config, portDConfig):
//   DDRD  = 0x2A        PORTD = 0x2B
//   TCCR0A = 0x44       TCCR0B = 0x45
//   OCR0A  = 0x47       OCR0B  = 0x48
//
// Timer0 OC pins on ATmega328P:
//   OC0A = PD6 = Arduino D6    OC0B = PD5 = Arduino D5
//
// Timer2 register addresses (from timer2Config):
//   TCCR2A = 0xB0       TCCR2B = 0xB1
//   OCR2A  = 0xB3       OCR2B  = 0xB4
//   DDRB   = 0x24
//
// Timer2 OC pins:
//   OC2A = PB3 = Arduino D11   OC2B = PD3 = Arduino D3

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvr8jsAdapter } from '../src/avr8js-adapter.js';
import { BoardImpl } from '../src/board.js';

const NOP_LOOP = new Uint16Array([0x0000, 0xCFFE]);

/** Build a board with a single LED on `pin` through 1 kΩ to GND. */
function ledBoard(pin) {
  const board = new BoardImpl(5);
  board.setNetlist(
    [
      { id: 'mcu', kind: 'mcu', params: { pins: [pin] }, terminals: [pin] },
      { id: 'r1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'led1', kind: 'led', params: { vf: 2.0, color: 'red' }, terminals: ['anode', 'cathode'] },
      { id: 'g', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ],
    [
      { id: 'n1', terminals: [{ part: 'mcu', terminal: pin }, { part: 'r1', terminal: 'a' }] },
      { id: 'n2', terminals: [{ part: 'r1', terminal: 'b' }, { part: 'led1', terminal: 'anode' }] },
      { id: 'n3', terminals: [{ part: 'led1', terminal: 'cathode' }, { part: 'g', terminal: 'gnd' }] },
    ]
  );
  board.setPower(true);
  return board;
}

// ── Timer0, OC0A (D6): 50 % duty → brightness ≈ 0.075 ─────────────────────

test('Timer0 fast PWM on D6 (OC0A): 50% duty → brightness 0.075', () => {
  const a = createAvr8jsAdapter({ program: NOP_LOOP });
  const board = ledBoard('D6');
  a.attachBoard(board);

  // Configure Timer0: fast PWM mode 3, non-inverting OC0A, prescaler 64
  //   TCCR0A = COM0A1|WGM01|WGM00 = 0b10000011 = 0x83
  //   TCCR0B = CS01|CS00           = 0b00000011 = 0x03
  //   OCR0A  = 128
  //   DDRD bit 6 set (output)      = 0x40
  const cpu = a.cpu;
  cpu.writeData(0x2A, 0x40);  // DDRD = 0b01000000 (PD6 output)
  cpu.writeData(0x44, 0x83);  // TCCR0A
  cpu.writeData(0x45, 0x03);  // TCCR0B
  cpu.writeData(0x47, 128);   // OCR0A

  // Run 25 ms — fills the 20 ms brightness window with ~24 PWM cycles
  a.advanceNs(25_000_000);

  const bright = board.ledBrightness('led1');
  // Oracle: 0.15 × 128/256 = 0.075. Allow ±20% for edge quantization.
  assert.ok(bright > 0.055 && bright < 0.095,
    `expected ~0.075 (50% duty), got ${bright.toFixed(5)}`);
});

// ── Timer0, OC0B (D5): 25 % duty → brightness ≈ 0.0375 ────────────────────

test('Timer0 fast PWM on D5 (OC0B): 25% duty → brightness 0.0375', () => {
  const a = createAvr8jsAdapter({ program: NOP_LOOP });
  const board = ledBoard('D5');
  a.attachBoard(board);

  //   TCCR0A = COM0B1|WGM01|WGM00 = 0b00100011 = 0x23
  //   TCCR0B = CS01|CS00           = 0x03
  //   OCR0B  = 64
  //   DDRD bit 5 set               = 0x20
  const cpu = a.cpu;
  cpu.writeData(0x2A, 0x20);  // DDRD = 0b00100000 (PD5 output)
  cpu.writeData(0x44, 0x23);  // TCCR0A
  cpu.writeData(0x45, 0x03);  // TCCR0B
  cpu.writeData(0x48, 64);    // OCR0B

  a.advanceNs(25_000_000);

  const bright = board.ledBrightness('led1');
  // Oracle: 0.15 × 64/256 = 0.0375
  assert.ok(bright > 0.025 && bright < 0.050,
    `expected ~0.0375 (25% duty), got ${bright.toFixed(5)}`);
});

// ── Timer0, OC0A (D6): 75 % duty → brightness ≈ 0.1125 ────────────────────

test('Timer0 fast PWM on D6 (OC0A): 75% duty → brightness 0.1125', () => {
  const a = createAvr8jsAdapter({ program: NOP_LOOP });
  const board = ledBoard('D6');
  a.attachBoard(board);

  const cpu = a.cpu;
  cpu.writeData(0x2A, 0x40);  // DDRD PD6 output
  cpu.writeData(0x44, 0x83);  // TCCR0A: non-inverting OC0A, fast PWM mode 3
  cpu.writeData(0x45, 0x03);  // TCCR0B: prescaler 64
  cpu.writeData(0x47, 192);   // OCR0A = 192

  a.advanceNs(25_000_000);

  const bright = board.ledBrightness('led1');
  // Oracle: 0.15 × 192/256 = 0.1125
  assert.ok(bright > 0.085 && bright < 0.140,
    `expected ~0.1125 (75% duty), got ${bright.toFixed(5)}`);
});

// ── Timer2, OC2B (D3): 50 % duty — different timer, same contract ──────────

test('Timer2 fast PWM on D3 (OC2B): 50% duty → brightness 0.075', () => {
  const a = createAvr8jsAdapter({ program: NOP_LOOP });
  const board = ledBoard('D3');
  a.attachBoard(board);

  //   TCCR2A = COM2B1|WGM21|WGM20 = 0b00100011 = 0x23
  //   TCCR2B = CS22                = 0b00000100 = 0x04  (timer2 prescaler 64)
  //   OCR2B  = 128
  //   DDRD bit 3                   = 0x08
  const cpu = a.cpu;
  cpu.writeData(0x2A, 0x08);  // DDRD = 0b00001000 (PD3 output)
  cpu.writeData(0xB0, 0x23);  // TCCR2A
  cpu.writeData(0xB1, 0x04);  // TCCR2B
  cpu.writeData(0xB4, 128);   // OCR2B

  a.advanceNs(25_000_000);

  const bright = board.ledBrightness('led1');
  assert.ok(bright > 0.055 && bright < 0.095,
    `expected ~0.075 (50% duty), got ${bright.toFixed(5)}`);
});

// ── Timer2, OC2A (D11): 50 % duty — OC2A is on port B ──────────────────────

test('Timer2 fast PWM on D11 (OC2A): 50% duty → brightness 0.075', () => {
  const a = createAvr8jsAdapter({ program: NOP_LOOP });
  const board = ledBoard('D11');
  a.attachBoard(board);

  //   TCCR2A = COM2A1|WGM21|WGM20 = 0b10000011 = 0x83
  //   TCCR2B = CS22                = 0x04 (prescaler 64)
  //   OCR2A  = 128
  //   DDRB bit 3                   = 0x08
  const cpu = a.cpu;
  cpu.writeData(0x24, 0x08);  // DDRB = 0b00001000 (PB3 output)
  cpu.writeData(0xB0, 0x83);  // TCCR2A
  cpu.writeData(0xB1, 0x04);  // TCCR2B
  cpu.writeData(0xB3, 128);   // OCR2A

  a.advanceNs(25_000_000);

  const bright = board.ledBrightness('led1');
  assert.ok(bright > 0.055 && bright < 0.095,
    `expected ~0.075 (50% duty), got ${bright.toFixed(5)}`);
});

// ── Edge-level verification: the pin actually toggles, not stuck ────────────

test('OC0A pin edges: at least 20 HIGH→LOW and LOW→HIGH transitions in 25 ms', () => {
  const a = createAvr8jsAdapter({ program: NOP_LOOP });
  const calls = [];
  const stubBrd = {
    setPin: (name, mode, high) => calls.push({ name, mode, high }),
    advanceTo: () => {},
  };

  // Set DDR BEFORE attachBoard so the initial publish sees PD6 as output.
  a.cpu.writeData(0x2A, 0x40);  // DDRD PD6 output
  a.attachBoard(stubBrd);

  a.cpu.writeData(0x44, 0x83);  // TCCR0A: non-inverting OC0A, fast PWM mode 3
  a.cpu.writeData(0x45, 0x03);  // TCCR0B: prescaler 64
  a.cpu.writeData(0x47, 128);   // OCR0A = 128

  a.advanceNs(25_000_000);

  // Filter D6 events and count actual level transitions
  const d6 = calls.filter(c => c.name === 'D6');
  assert.ok(d6.length > 0, 'D6 must be driven');

  let toggles = 0;
  for (let i = 1; i < d6.length; i++) {
    if (d6[i].high !== d6[i - 1].high) toggles++;
  }
  // Oracle: ~24 PWM periods × 2 transitions = ~48. Allow wide margin.
  assert.ok(toggles >= 20, `expected ≥20 toggles, got ${toggles}`);
  assert.ok(d6.some(c => c.high === true), 'must see HIGH');
  assert.ok(d6.some(c => c.high === false), 'must see LOW');
  // After DDR is set, every D6 event must be push-pull
  assert.ok(d6.every(c => c.mode === 'pushpull'), 'all D6 events push-pull');
});

// ── Duty monotonicity: higher OCR → brighter LED ───────────────────────────

test('duty monotonicity: OCR 64 < 128 < 192 maps to increasing brightness', () => {
  const results = [];
  for (const ocr of [64, 128, 192]) {
    const a = createAvr8jsAdapter({ program: NOP_LOOP });
    const board = ledBoard('D6');
    a.attachBoard(board);

    const cpu = a.cpu;
    cpu.writeData(0x2A, 0x40);
    cpu.writeData(0x44, 0x83);
    cpu.writeData(0x45, 0x03);
    cpu.writeData(0x47, ocr);

    a.advanceNs(25_000_000);
    results.push({ ocr, bright: board.ledBrightness('led1') });
  }

  assert.ok(results[0].bright < results[1].bright,
    `OCR 64 (${results[0].bright.toFixed(5)}) should be dimmer than 128 (${results[1].bright.toFixed(5)})`);
  assert.ok(results[1].bright < results[2].bright,
    `OCR 128 (${results[1].bright.toFixed(5)}) should be dimmer than 192 (${results[2].bright.toFixed(5)})`);
});

// ── Both OC0A and OC0B simultaneously (analogWrite on two pins) ─────────────

test('both OC0A (D6) and OC0B (D5) active: independent duties', () => {
  const a = createAvr8jsAdapter({ program: NOP_LOOP });
  // Two LEDs: one on D6, one on D5
  const board = new BoardImpl(5);
  board.setNetlist(
    [
      { id: 'mcu', kind: 'mcu', params: { pins: ['D5', 'D6'] }, terminals: ['D5', 'D6'] },
      { id: 'r1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'led1', kind: 'led', params: { vf: 2.0, color: 'red' }, terminals: ['anode', 'cathode'] },
      { id: 'r2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'led2', kind: 'led', params: { vf: 2.0, color: 'green' }, terminals: ['anode', 'cathode'] },
      { id: 'g', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ],
    [
      { id: 'n1', terminals: [{ part: 'mcu', terminal: 'D6' }, { part: 'r1', terminal: 'a' }] },
      { id: 'n2', terminals: [{ part: 'r1', terminal: 'b' }, { part: 'led1', terminal: 'anode' }] },
      { id: 'n3', terminals: [{ part: 'led1', terminal: 'cathode' }, { part: 'g', terminal: 'gnd' }] },
      { id: 'n4', terminals: [{ part: 'mcu', terminal: 'D5' }, { part: 'r2', terminal: 'a' }] },
      { id: 'n5', terminals: [{ part: 'r2', terminal: 'b' }, { part: 'led2', terminal: 'anode' }] },
      { id: 'n6', terminals: [{ part: 'led2', terminal: 'cathode' }, { part: 'g', terminal: 'gnd' }] },
    ]
  );
  board.setPower(true);
  a.attachBoard(board);

  //   TCCR0A = COM0A1|COM0B1|WGM01|WGM00 = 0b10100011 = 0xA3
  //   TCCR0B = CS01|CS00 = 0x03
  //   OCR0A = 192 (D6, 75 % duty)
  //   OCR0B = 64  (D5, 25 % duty)
  //   DDRD bits 5+6 = 0x60
  const cpu = a.cpu;
  cpu.writeData(0x2A, 0x60);
  cpu.writeData(0x44, 0xA3);
  cpu.writeData(0x45, 0x03);
  cpu.writeData(0x47, 192);   // OCR0A → D6
  cpu.writeData(0x48, 64);    // OCR0B → D5

  a.advanceNs(25_000_000);

  const b1 = board.ledBrightness('led1'); // D6, 75%
  const b2 = board.ledBrightness('led2'); // D5, 25%
  // Oracle: led1 = 0.15×0.75 = 0.1125, led2 = 0.15×0.25 = 0.0375
  assert.ok(b1 > 0.085 && b1 < 0.140,
    `led1 (D6, 75%): expected ~0.1125, got ${b1.toFixed(5)}`);
  assert.ok(b2 > 0.025 && b2 < 0.050,
    `led2 (D5, 25%): expected ~0.0375, got ${b2.toFixed(5)}`);
  assert.ok(b1 > b2 * 2, 'D6 at 75% must be >2× brighter than D5 at 25%');
});
