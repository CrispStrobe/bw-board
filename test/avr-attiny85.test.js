// ATtiny85 adapter tests — hand-assembled programs, no toolchain.
//
// The ATtiny85 has a single PORTB (PB0-PB5) at different data-space
// addresses (PINB=0x36, DDRB=0x37, PORTB=0x38) and runs at 8 MHz.
//
// Hand-assembled ATtiny85 blink on P0 (PB0):
//   word 0: SBI DDRB,0   1001 1010 0001 1000 = 0x9A18
//   word 1: SBI PINB,0   1001 1010 0001 0000 = 0x9A10  (toggle PB0)
//   word 2: LDI r24,0xFF 1110 1111 1000 1111 = 0xEF8F
//   word 3: DEC r24      1001 0101 1000 1010 = 0x958A
//   word 4: BRNE .-2     1111 0111 1111 0001 = 0xF7F1
//   word 5: RJMP .-5     1100 1111 1111 1011 = 0xCFFB
//
// SBI encoding: 1001_1010_AAAA_Abbb where A=IO address, b=bit
// ATtiny85 DDRB IO addr = 0x17 (data space 0x37): A=10111, b=000
//   → 1001_1010_1011_1000 = 0x9AB8
//
// WAIT — IO address for SBI/CBI is bits [7:3]=A, [2:0]=b.
// DDRB data space = 0x37. IO address = 0x37 - 0x20 = 0x17.
// A (5 bits) = 0x17 = 10111. b = 000.
// Encoding: 1001_1010 | A4A3A2A1A0 | b2b1b0
//         = 1001_1010 | 10111 | 000
//         = 1001_1010_1011_1000 = 0x9AB8
//
// ATtiny85 PINB IO addr = 0x16 (data space 0x36): A=10110, b=000
//   → 1001_1010_1011_0000 = 0x9AB0

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvr8jsAdapter, CHIPS } from '../src/avr8js-adapter.js';

const TINY = CHIPS.attiny85;

const BLINK_P0_TINY = new Uint16Array([
  0x9AB8, // SBI DDRB, 0 (IO 0x17)
  0x9AB0, // SBI PINB, 0 (IO 0x16, toggles PB0)
  0xEF8F, // LDI r24, 0xFF
  0x958A, // DEC r24
  0xF7F1, // BRNE .-2
  0xCFFB, // RJMP .-5
]);

const NOP_LOOP = new Uint16Array([0x0000, 0xCFFE]);

function stubBoard() {
  const calls = [];
  return {
    calls,
    setPin: (name, mode, high) => calls.push({ name, mode, high }),
    advanceTo: (tNs) => calls.push({ advanceTo: tNs }),
    readAnalog: () => 0,
    readPin: () => 0,
  };
}

// ── Pin map ─────────────────────────────────────────────────────────────────

test('ATtiny85 pin map: 6 pins P0-P5, all port B', () => {
  assert.deepEqual(TINY.pins.P0, { port: 'B', bit: 0 });
  assert.deepEqual(TINY.pins.P1, { port: 'B', bit: 1 });
  assert.deepEqual(TINY.pins.P2, { port: 'B', bit: 2 });
  assert.deepEqual(TINY.pins.P3, { port: 'B', bit: 3 });
  assert.deepEqual(TINY.pins.P4, { port: 'B', bit: 4 });
  assert.deepEqual(TINY.pins.P5, { port: 'B', bit: 5 });
  assert.equal(Object.keys(TINY.pins).length, 6);
});

test('ATtiny85: no USART', () => {
  assert.equal(TINY.usart, null);
});

test('ATtiny85: 8 MHz default clock', () => {
  const a = createAvr8jsAdapter({ chip: 'attiny85' });
  assert.equal(a.clockHz, 8_000_000);
  assert.equal(a.chip.name, 'ATtiny85');
});

// ── Blink ───────────────────────────────────────────────────────────────────

test('ATtiny85 blink: P0 (PB0) toggles push-pull at 8 MHz', () => {
  const a = createAvr8jsAdapter({ chip: 'attiny85', program: BLINK_P0_TINY });
  const b = stubBoard();
  a.attachBoard(b);
  // At 8 MHz, 2 ms = 16000 cycles.
  // Inner loop: 255 × 3 + SBI(2) + LDI(1) + RJMP(2) ≈ 770 cycles per toggle.
  // 16000 / 770 ≈ 20.8 toggles. Allow margin.
  a.advanceNs(2_000_000);

  const p0 = b.calls.filter(c => c.name === 'P0' && c.mode === 'pushpull');
  assert.ok(p0.length > 0, 'P0 driven push-pull');
  let toggles = 0;
  for (let i = 1; i < p0.length; i++) if (p0[i].high !== p0[i - 1].high) toggles++;
  // At 8 MHz: 2 ms / (770 / 8e6) ≈ 20.8 toggles (half the 328P rate)
  assert.ok(toggles >= 14 && toggles <= 30,
    `~20 toggles expected at 8 MHz, saw ${toggles}`);
});

test('ATtiny85: board time tracks CPU cycles at 8 MHz', () => {
  const a = createAvr8jsAdapter({ chip: 'attiny85', program: BLINK_P0_TINY });
  const b = stubBoard();
  a.attachBoard(b);
  a.advanceNs(1_000_000);
  const t = a.timeNs();
  // 1 ms ± overshoot
  assert.ok(t >= 1_000_000n && t <= 1_000_800n, `timeNs=${t}`);
});

// ── Timer0 PWM on ATtiny85 ──────────────────────────────────────────────────
// ATtiny85 Timer0 registers at different addresses:
//   TCCR0A: 0x4A, TCCR0B: 0x53, OCR0A: 0x49, OCR0B: 0x48
//   DDRB: 0x37
// OC0A = PB0 (P0), OC0B = PB1 (P1)
// Fast PWM mode 3, prescaler 64: f_PWM = 8MHz/(64×256) = 488.28 Hz
// Period = 2048 µs. In 25 ms: ~12 full cycles.

test('ATtiny85 Timer0 PWM on P0 (OC0A): edges propagate', () => {
  const a = createAvr8jsAdapter({ chip: 'attiny85', program: NOP_LOOP });
  const b = stubBoard();

  // DDRB bit 0 (P0) output
  a.cpu.writeData(0x37, 0x01);
  a.attachBoard(b);

  // TCCR0A = COM0A1|WGM01|WGM00 = 0x83, TCCR0B = CS01|CS00 = 0x03
  a.cpu.writeData(0x4A, 0x83);
  a.cpu.writeData(0x53, 0x03);
  a.cpu.writeData(0x49, 128); // OCR0A

  a.advanceNs(25_000_000);

  const p0 = b.calls.filter(c => c.name === 'P0');
  let toggles = 0;
  for (let i = 1; i < p0.length; i++) if (p0[i].high !== p0[i - 1].high) toggles++;
  // ~12 PWM periods × 2 transitions = ~24
  assert.ok(toggles >= 10, `expected ≥10 PWM toggles on P0, got ${toggles}`);
});

// ── ADC channel mapping ─────────────────────────────────────────────────────

test('ATtiny85 ADC: channel 0 → P5, channel 1 → P2', () => {
  const map = TINY.adcChannelToPin;
  assert.equal(map[0], 'P5');
  assert.equal(map[1], 'P2');
  assert.equal(map[2], 'P4');
  assert.equal(map[3], 'P3');
});

// ── Unknown chip rejects ────────────────────────────────────────────────────

test('unknown chip throws', () => {
  assert.throws(() => createAvr8jsAdapter({ chip: 'atmega_nope' }),
    /Unknown AVR chip/);
});
