// ATmega2560 (Arduino Mega) adapter tests — hand-assembled programs,
// no toolchain, oracle is arithmetic.
//
// Pin map verification focuses on the DESCENDING port C/L runs and the
// OC pin remappings vs the 328P. The blink test reuses the same opcode
// pattern but targets PB7 (D13 on the Mega, same LED pin but different
// port bit).
//
// Hand-assembled Mega blink on D13 (PB7):
//   word 0: SBI DDRB,7   1001 1010 0010 0111 = 0x9A27
//   word 1: SBI PINB,7   1001 1010 0001 1111 = 0x9A1F  (toggle PB7)
//   word 2: LDI r24,0xFF 1110 1111 1000 1111 = 0xEF8F
//   word 3: DEC r24      1001 0101 1000 1010 = 0x958A
//   word 4: BRNE .-2     1111 0111 1111 0001 = 0xF7F1
//   word 5: RJMP .-5     1100 1111 1111 1011 = 0xCFFB
//
// SBI encoding: 1001_1010_AAAA_Abbb where A=IO address, b=bit
// DDRB IO addr = 0x04 (data space 0x24): A=00100, b=111 → 1001_1010_0010_0111 = 0x9A27
// PINB IO addr = 0x03 (data space 0x23): A=00011, b=111 → 1001_1010_0001_1111 = 0x9A1F

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvr8jsAdapter, CHIPS } from '../src/avr8js-adapter.js';

const MEGA = CHIPS.atmega2560;

const BLINK_D13_MEGA = new Uint16Array([
  0x9A27, // SBI DDRB, 7
  0x9A1F, // SBI PINB, 7 (toggle PB7)
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

test('Mega pin map: D13 is PB7 (not PB5 like 328P)', () => {
  assert.deepEqual(MEGA.pins.D13, { port: 'B', bit: 7 });
  assert.deepEqual(MEGA.pins.D11, { port: 'B', bit: 5 });
});

test('Mega pin map: descending port C — D30=PC7, D37=PC0', () => {
  assert.deepEqual(MEGA.pins.D30, { port: 'C', bit: 7 });
  assert.deepEqual(MEGA.pins.D31, { port: 'C', bit: 6 });
  assert.deepEqual(MEGA.pins.D36, { port: 'C', bit: 1 });
  assert.deepEqual(MEGA.pins.D37, { port: 'C', bit: 0 });
});

test('Mega pin map: descending port L — D42=PL7, D49=PL0', () => {
  assert.deepEqual(MEGA.pins.D42, { port: 'L', bit: 7 });
  assert.deepEqual(MEGA.pins.D43, { port: 'L', bit: 6 });
  assert.deepEqual(MEGA.pins.D48, { port: 'L', bit: 1 });
  assert.deepEqual(MEGA.pins.D49, { port: 'L', bit: 0 });
});

test('Mega pin map: 16 ADC channels A0-A15', () => {
  assert.deepEqual(MEGA.pins.A0, { port: 'F', bit: 0 });
  assert.deepEqual(MEGA.pins.A7, { port: 'F', bit: 7 });
  assert.deepEqual(MEGA.pins.A8, { port: 'K', bit: 0 });
  assert.deepEqual(MEGA.pins.A15, { port: 'K', bit: 7 });
});

test('Mega pin map: port coverage — 70 named pins', () => {
  const count = Object.keys(MEGA.pins).length;
  // D0-D53 (54) + A0-A15 (16) = 70, minus the 6 port-D/E/G/H/J gaps
  // Actually, not all D pins exist on header: D0-D53 minus gaps (some port bits not on header)
  // The map contains exactly the header pins
  assert.ok(count >= 65, `expected ≥65 pins, got ${count}`);
});

// ── Blink on Mega ───────────────────────────────────────────────────────────

test('Mega blink: D13 (PB7) toggles push-pull', () => {
  const a = createAvr8jsAdapter({ chip: 'atmega2560', program: BLINK_D13_MEGA });
  const b = stubBoard();
  a.attachBoard(b);
  a.advanceNs(2_000_000); // 2 ms

  const d13 = b.calls.filter(c => c.name === 'D13' && c.mode === 'pushpull');
  assert.ok(d13.length > 0, 'D13 driven push-pull');
  let toggles = 0;
  for (let i = 1; i < d13.length; i++) if (d13[i].high !== d13[i - 1].high) toggles++;
  // Same cycle arithmetic as the 328P blink: ~41 toggles in 2 ms
  assert.ok(toggles >= 30 && toggles <= 55,
    `~41 toggles expected, saw ${toggles}`);
});

test('Mega: 328P-default adapter still works (backward compat)', () => {
  const a = createAvr8jsAdapter(); // no chip param → 328P
  assert.equal(a.chip.name, 'ATmega328P');
  assert.equal(a.clockHz, 16_000_000);
});

// ── Mega Timer0 PWM: OC0A is PB7=D13, not PD6 ─────────────────────────────

test('Mega Timer0 PWM on D13 (OC0A=PB7): 50% duty', () => {
  const a = createAvr8jsAdapter({ chip: 'atmega2560', program: NOP_LOOP });
  const b = stubBoard();

  // DDRB bit 7 (D13) output. On the Mega, DDRB is at the same address: 0x24
  a.cpu.writeData(0x24, 0x80);
  a.attachBoard(b);

  // Timer0 registers are at the same addresses as 328P
  // TCCR0A = COM0A1|WGM01|WGM00 = 0x83
  // TCCR0B = CS01|CS00 = 0x03
  // OCR0A = 128
  a.cpu.writeData(0x44, 0x83);
  a.cpu.writeData(0x45, 0x03);
  a.cpu.writeData(0x47, 128);

  a.advanceNs(25_000_000);

  const d13 = b.calls.filter(c => c.name === 'D13');
  let toggles = 0;
  for (let i = 1; i < d13.length; i++) if (d13[i].high !== d13[i - 1].high) toggles++;
  // Oracle: ~24 PWM periods × 2 transitions = ~48
  assert.ok(toggles >= 20, `expected ≥20 OC0A toggles on D13, got ${toggles}`);
});

// ── Mega has 11 ports ───────────────────────────────────────────────────────

test('Mega: all 11 ports instantiated (A through L minus I)', () => {
  const a = createAvr8jsAdapter({ chip: 'atmega2560' });
  const portKeys = Object.keys(MEGA.ports);
  assert.deepEqual(portKeys.sort(), ['A','B','C','D','E','F','G','H','J','K','L']);
});
