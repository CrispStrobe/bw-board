// ATmega88PA chip config (E5.8) — the BOM's 8 KB member of the 48..328
// family. Same registers as the 328P; ONE-word interrupt vectors (≤ 8 KB
// flash uses RJMP vectors, doc8271 table 11-6) and the smaller memories
// are the whole difference, so the tests pin exactly those.
//
// The blink program is the hand-assembled oracle from avr8js-adapter.test.js
// (opcodes computed from the instruction-set manual — arithmetic, not trust);
// the UART program is assembled the same way:
//
//   word  instr                encoding
//   0     LDI r24,0x08         0xE088   (TXEN0)
//   1-2   STS 0xC1,r24         0x9380 0x00C1   (UCSR0B)
//   3     LDI r24,103          0xE687   (UBRR0L: 9600 @ 16 MHz)
//   4-5   STS 0xC4,r24         0x9380 0x00C4
//   6     LDI r24,0x41         0xE481   ('A')          <- loop
//   7-8   STS 0xC6,r24         0x9380 0x00C6   (UDR0)
//   9-10  LDS r25,0xC0         0x9190 0x00C0   (UCSR0A) <- wait
//   11    SBRS r25,5           0xFF95   (skip when UDRE0 set)
//   12    RJMP .-4 → wait      0xCFFC
//   13    RJMP .-8 → loop      0xCFF8

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvr8jsAdapter, CHIPS } from '../src/avr8js-adapter.js';

const M88 = CHIPS.atmega88pa;
const M328 = CHIPS.atmega328p;

const BLINK = new Uint16Array([0x9A25, 0x9A1D, 0xEF8F, 0x958A, 0xF7F1, 0xCFFB]);
const UART_A = new Uint16Array([
  0xE088, 0x9380, 0x00C1,
  0xE687, 0x9380, 0x00C4,
  0xE481, 0x9380, 0x00C6,
  0x9190, 0x00C0,
  0xFF95, 0xCFFC, 0xCFF8,
]);

function stubBoard() {
  const calls = [];
  return {
    calls,
    setPin: (name, mode, high) => calls.push({ name, mode, high }),
    advanceTo: () => {},
    readAnalog: () => 0,
  };
}

test('ATmega88PA config: memory bounds and shared register file', () => {
  assert.equal(M88.flashWords, 4096, '8 KB flash');
  assert.equal(M88.sramBytes, 1024, '1 KB SRAM');
  // The family shares its I/O map: pins, ports, and every peripheral
  // REGISTER address are the 328P's.
  assert.equal(M88.pins, M328.pins);
  assert.equal(M88.ports, M328.ports);
  assert.equal(M88.usart.UDR, M328.usart.UDR);
  assert.equal(M88.timers[1].TCNT, M328.timers[1].TCNT);
});

test('ATmega88PA config: one-word vectors, exactly half the 328P addresses', () => {
  // Spot checks against doc8271 table 11-6 (1-based vector n at word n−1).
  assert.equal(M88.timers[1].captureInterrupt, 0x0A, 'TIMER1_CAPT, vector 11');
  assert.equal(M88.timers[0].ovfInterrupt, 0x10, 'TIMER0_OVF, vector 17');
  assert.equal(M88.usart.rxCompleteInterrupt, 0x12, 'USART_RX, vector 19');
  assert.equal(M88.adc.adcInterrupt, 0x15, 'ADC, vector 22');
  assert.equal(M88.twi.twiInterrupt, 0x18, 'TWI, vector 25');
  assert.equal(M88.spi.spiInterrupt, 0x11, 'SPI_STC, vector 18');
  // The structural relation that makes the table right by construction:
  for (const [t88, t328] of [[M88.timers[0], M328.timers[0]],
    [M88.timers[1], M328.timers[1]], [M88.timers[2], M328.timers[2]]]) {
    for (const k of ['captureInterrupt', 'compAInterrupt', 'compBInterrupt', 'ovfInterrupt']) {
      if (t328[k] === 0) { assert.equal(t88[k], 0); continue; }
      assert.equal(t88[k], t328[k] / 2, `${k}: one-word spacing is half the 328P's`);
    }
  }
});

test('the hand-assembled blink runs on the mega88PA config', () => {
  const a = createAvr8jsAdapter({ chip: 'atmega88pa', program: BLINK });
  const b = stubBoard();
  a.attachBoard(b);
  a.advanceNs(2_000_000);
  const d13 = b.calls.filter(c => c.name === 'D13' && c.mode === 'pushpull');
  let toggles = 0;
  for (let i = 1; i < d13.length; i++) if (d13[i].high !== d13[i - 1].high) toggles++;
  assert.ok(toggles >= 30 && toggles <= 55,
    `same cycle arithmetic as the 328P (~41 toggles): saw ${toggles}`);
});

test('the hand-assembled UART sender transmits on the mega88PA config', () => {
  const a = createAvr8jsAdapter({ chip: 'atmega88pa', program: UART_A });
  const bytes = [];
  a.onSerial((byte) => bytes.push(byte));
  a.attachBoard(stubBoard());
  a.advanceNs(5_000_000); // 5 ms: several 'A' frames at 9600-ish pacing
  assert.ok(bytes.length >= 1, `at least one byte transmitted: got ${bytes.length}`);
  assert.ok(bytes.every(x => x === 0x41), 'every byte is the programmed 0x41');
});

test('an image over 8 KB refuses with the size named', () => {
  const oversize = new Uint16Array(4097);
  assert.throws(() => createAvr8jsAdapter({ chip: 'atmega88pa', program: oversize }),
    /4097 words.*ATmega88PA.*4096 words \(8192 bytes\)/s,
    'the refusal names the image size and the chip bound');
  // The same image is fine on the 328P — the bound is per chip, not global.
  const a = createAvr8jsAdapter({ chip: 'atmega328p', program: oversize });
  assert.ok(a, 'the 328P takes it without complaint');
});
