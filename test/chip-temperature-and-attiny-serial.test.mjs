// The chips' own temperature sensors read the bench temperature, and the
// ATtinys -- no USART -- print and read typed lines over a software UART the
// adapter decodes from the TX pin and drives on the RX pin.
//
// The AVR halves run real avr-gcc builds (skipped by name without avr-gcc,
// as test/avr-sleep-fastforward.test.mjs does); the STM32F030 and RP2040
// sensors are driven at the peripheral, where the conversion happens.
import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAvr8jsAdapter } from '../src/avr8js-adapter.js';
import { createRp2040jsAdapter } from '../src/rp2040js-adapter.js';
import { Stm32Adc } from '../src/stm32f0-board.js';
import {
    avrTemperatureCounts, rp2040TemperatureVolts, stm32f0TemperatureVolts,
} from '../src/chip-temperature.js';

let hasAvrGcc = false;
try { execFileSync('avr-gcc', ['--version'], { stdio: 'pipe' }); hasAvrGcc = true; } catch { /* skip below */ }
const skipAvr = hasAvrGcc ? false : 'avr-gcc not installed (CI installs it)';

function build(src, mcu, fcpu) {
    const dir = mkdtempSync(join(tmpdir(), 'bw-chiptemp-'));
    writeFileSync(join(dir, 'main.c'), src);
    execFileSync('avr-gcc', [`-mmcu=${mcu}`, `-DF_CPU=${fcpu}UL`, '-Os',
        '-o', join(dir, 'main.elf'), join(dir, 'main.c')], { stdio: 'pipe' });
    execFileSync('avr-objcopy', ['-O', 'binary', join(dir, 'main.elf'), join(dir, 'main.bin')], { stdio: 'pipe' });
    const bin = readFileSync(join(dir, 'main.bin'));
    const padded = new Uint8Array(bin.length + (bin.length & 1));
    padded.set(bin);
    return new Uint16Array(padded.buffer, 0, padded.length / 2);
}

/** A board that only answers what these programs ask: inputs high, except `low`. */
const stubBoard = (temperatureC, low = []) => ({
    temperatureC,
    setPin() {}, advanceTo() {}, readPin: (name) => (low.includes(name) ? 0 : 1), readAnalog: () => 0,
});

test('the sensor models follow the datasheet typical figures', () => {
    // ATmega328P: 314 mV at 25 C against 1.1 V; 242 / 380 mV at -45 / 85 C.
    assert.equal(avrTemperatureCounts('atmega', 25), Math.round(314 / 1100 * 1024));
    assert.equal(avrTemperatureCounts('atmega', 85), Math.round(380 / 1100 * 1024));
    assert.equal(avrTemperatureCounts('atmega', -45), Math.round(242 / 1100 * 1024));
    // ATtiny85: 230 / 300 / 370 LSB at -40 / 25 / 85 C.
    assert.deepEqual([-40, 25, 85].map((t) => avrTemperatureCounts('attiny85', t)), [230, 300, 370]);
    assert.equal(avrTemperatureCounts('none', 25), null);
    assert.ok(Math.abs(rp2040TemperatureVolts(27) - 0.706) < 1e-9);
    assert.ok(Math.abs(stm32f0TemperatureVolts(30) - 1.43) < 1e-9);
    assert.ok(stm32f0TemperatureVolts(60) < stm32f0TemperatureVolts(30), 'the F0 sensor falls as it warms');
});

test('STM32F030: channel 16 reads the sensor once ADC_CCR.TSEN powers it', () => {
    const rcc = { adcEnabled: () => 1, noteGated() {} };
    let celsius = 30;
    const adc = new Stm32Adc({ rcc, onAnalogRead: () => 1, onTemperature: () => stm32f0TemperatureVolts(celsius) });
    const convert = () => { adc.write(0x08, 1 | (1 << 2)); return adc.read(0x40); };
    adc.write(0x28, 1 << 16);                       // CHSELR: channel 16
    assert.equal(convert(), 0, 'TSEN off: the sensor is unpowered');
    adc.write(0x308, 1 << 23);                      // ADC_CCR.TSEN
    assert.equal(adc.read(0x308), 1 << 23);
    assert.equal(convert(), Math.round(1.43 / 3.3 * 4095));
    celsius = 70;
    assert.equal(convert(), Math.round((1.43 - 0.0043 * 40) / 3.3 * 4095));
    adc.write(0x28, 1 << 0);
    assert.equal(convert(), Math.round(1 / 3.3 * 4095), 'an ordinary channel is unchanged');
});

test('RP2040: ADC input 4 reads the bench temperature', () => {
    const a = createRp2040jsAdapter();
    a.attachBoard(stubBoard(27));
    let got = null;
    const done = a.rp2040.adc.completeADCRead.bind(a.rp2040.adc);
    a.rp2040.adc.completeADCRead = (value, error) => { got = value; done(value, error); };
    a.rp2040.adc.onADCRead(4);
    assert.equal(a.rp2040.adc.channelValues[4], Math.round(0.706 / 3.3 * 4095));
    a.attachBoard(stubBoard(57));
    a.rp2040.adc.onADCRead(4);
    assert.equal(a.rp2040.adc.channelValues[4], Math.round((0.706 - 0.001721 * 30) / 3.3 * 4095));
    void got;
});

// ATtiny85 at 8 MHz: bit-banged 9600 8N1 on PB0 (TX) / PB1 (RX), interrupts
// off for each frame; prints the temperature channel's counts, then echoes
// each typed line once it has all of it (a bit-banged receiver cannot listen
// while it transmits, on silicon either).
const TINY85 = `
#include <avr/io.h>
#include <avr/interrupt.h>
#include <stdint.h>
#define BIT_CYCLES (F_CPU / 9600)
static void tx(uint8_t c) {
    uint8_t i, s = SREG; cli();
    PORTB &= ~_BV(0); __builtin_avr_delay_cycles(BIT_CYCLES - 8);
    for (i = 0; i < 8; i++) {
        if (c & 1) PORTB |= _BV(0); else PORTB &= ~_BV(0);
        c >>= 1; __builtin_avr_delay_cycles(BIT_CYCLES - 12);
    }
    PORTB |= _BV(0); __builtin_avr_delay_cycles(BIT_CYCLES);
    SREG = s;
}
static uint8_t rx(void) {
    uint8_t i, c = 0;
    while (PINB & _BV(1)) ;
    __builtin_avr_delay_cycles(BIT_CYCLES + BIT_CYCLES / 2 - 10);
    for (i = 0; i < 8; i++) {
        c >>= 1; if (PINB & _BV(1)) c |= 0x80;
        __builtin_avr_delay_cycles(BIT_CYCLES - 10);
    }
    return c;
}
static void num(uint16_t n) { char b[6]; uint8_t i = 0; do { b[i++] = '0' + n % 10; n /= 10; } while (n); while (i) tx(b[--i]); tx('\\r'); tx('\\n'); }
int main(void) {
    PORTB |= _BV(0) | _BV(1); DDRB |= _BV(0);      /* TX high BEFORE it drives: no start-bit glitch */
    ADMUX = _BV(REFS1) | 0x0F;                      /* 1.1 V, MUX 1111: ADC4 */
    ADCSRA = _BV(ADEN) | _BV(ADPS2) | _BV(ADPS1);
    ADCSRA |= _BV(ADSC); while (ADCSRA & _BV(ADSC)) ;
    num(ADC);
    for (;;) {                                     /* a line in, then the line back */
        char line[32]; uint8_t n = 0, i;
        do { line[n] = rx(); } while (line[n++] != '\\r' && n < sizeof line);
        for (i = 0; i < n; i++) tx(line[i]);
    }
}
`;

describe('ATtiny85: temperature and a software UART', { skip: skipAvr }, () => {
    it('prints its sensor reading and echoes a typed line, byte for byte', () => {
        const program = build(TINY85, 'attiny85', 8_000_000);
        for (const [celsius, counts] of [[25, 300], [85, 370]]) {
            const a = createAvr8jsAdapter({ program, chip: 'attiny85' });
            a.attachBoard(stubBoard(celsius));
            let out = '';
            a.onSerial((b) => { out += String.fromCharCode(b); });
            a.advanceNs(20_000_000);
            assert.equal(out, `${counts}\r\n`, `${celsius} C`);
            out = '';
            assert.equal(a.sendSerial(Array.from('Hi there\r', (c) => c.charCodeAt(0))), true);
            a.advanceNs(40_000_000);                  // nine frames in, nine back: ~19 ms
            assert.equal(out, 'Hi there\r');
        }
    });

    it('a blinking TX pin is not mistaken for serial text', () => {
        const blink = `
#include <avr/io.h>
int main(void) { DDRB |= _BV(0); for (;;) { PORTB ^= _BV(0); __builtin_avr_delay_cycles(F_CPU / 1000); } }
`;
        const a = createAvr8jsAdapter({ program: build(blink, 'attiny85', 8_000_000), chip: 'attiny85' });
        a.attachBoard(stubBoard(25));
        let out = '';
        a.onSerial((b) => { out += String.fromCharCode(b); });
        a.advanceNs(100_000_000);
        assert.equal(out, '', 'a 500 Hz square wave has no valid frames');
    });
});

// ATmega328P: the same channel through MUX 1000, printed over the USART.
const MEGA = `
#include <avr/io.h>
#include <stdint.h>
static void tx(uint8_t c) { while (!(UCSR0A & _BV(UDRE0))) ; UDR0 = c; }
int main(void) {
    char b[6]; uint8_t i = 0; uint16_t n;
    UBRR0 = F_CPU / 16 / 9600 - 1; UCSR0B = _BV(TXEN0);
    ADMUX = _BV(REFS1) | _BV(REFS0) | 0x08;          /* 1.1 V, MUX 1000 */
    ADCSRA = _BV(ADEN) | _BV(ADPS2) | _BV(ADPS1) | _BV(ADPS0);
    ADCSRA |= _BV(ADSC); while (ADCSRA & _BV(ADSC)) ;
    n = ADC;
    do { b[i++] = '0' + n % 10; n /= 10; } while (n);
    while (i) tx(b[--i]);
    tx('\\n');
    for (;;) ;
}
`;

describe('ATmega328P: the temperature channel', { skip: skipAvr }, () => {
    it('reads 314 mV at 25 C and 380 mV at 85 C, against 1.1 V', () => {
        const program = build(MEGA, 'atmega328p', 16_000_000);
        for (const [celsius, mv] of [[25, 314], [85, 380]]) {
            const a = createAvr8jsAdapter({ program, chip: 'atmega328p' });
            a.attachBoard(stubBoard(celsius));
            let out = '';
            a.onSerial((b) => { out += String.fromCharCode(b); });
            a.advanceNs(20_000_000);
            assert.equal(out, `${Math.round(mv / 1100 * 1024)}\n`, `${celsius} C`);
        }
    });
});

// The receiver as a pin-change interrupt (what generated code does, so the
// scheduler keeps running while a person types): the ISR samples the whole
// frame and queues it; main() echoes each completed line. Exercises the
// pin-change vectors: the ATtiny85's GIMSK/PCMSK (vector 3) and the
// ATtiny88's one-word PCINT2 (vector 6), which the 328P table had at 10.
const PCINT_ECHO = ({ tx, rx, port, setup, vector, flag }) => `
#include <avr/io.h>
#include <avr/interrupt.h>
#include <stdint.h>
#define BIT_CYCLES (F_CPU / 9600)
static volatile uint8_t q[32], head, tail;
ISR(${vector}) {
    uint8_t i, c = 0;
    if (PIN${port} & _BV(${rx})) return;
    __builtin_avr_delay_cycles(BIT_CYCLES + BIT_CYCLES / 2 - 40);
    for (i = 0; i < 8; i++) {
        c >>= 1; if (PIN${port} & _BV(${rx})) c |= 0x80;
        __builtin_avr_delay_cycles(BIT_CYCLES - 12);
    }
    ${flag};
    q[head] = c; head = (head + 1) & 31;
}
static void tx(uint8_t c) {
    uint8_t i;
    PORT${port} &= ~_BV(${tx}); __builtin_avr_delay_cycles(BIT_CYCLES - 8);
    for (i = 0; i < 8; i++) {
        if (c & 1) PORT${port} |= _BV(${tx}); else PORT${port} &= ~_BV(${tx});
        c >>= 1; __builtin_avr_delay_cycles(BIT_CYCLES - 12);
    }
    PORT${port} |= _BV(${tx}); __builtin_avr_delay_cycles(BIT_CYCLES);
}
int main(void) {
    char line[32]; uint8_t n = 0, i;
    PORT${port} |= _BV(${tx}) | _BV(${rx}); DDR${port} |= _BV(${tx});
    ${setup};
    sei();
    for (;;) {
        if (head == tail) continue;
        line[n] = q[tail]; tail = (tail + 1) & 31;
        if (line[n++] == '\\r' || n == sizeof line) { for (i = 0; i < n; i++) tx(line[i]); n = 0; }
    }
}
`;

describe('ATtiny pin-change receivers', { skip: skipAvr }, () => {
    for (const [chip, cfg, rxName] of [
        ['attiny85', { tx: 0, rx: 1, port: 'B', setup: 'PCMSK |= _BV(PCINT1); GIMSK |= _BV(PCIE)',
            vector: 'PCINT0_vect', flag: 'GIFR = _BV(PCIF)' }, 'PB1'],
        ['attiny88', { tx: 6, rx: 7, port: 'D', setup: 'PCMSK2 |= _BV(PCINT23); PCICR |= _BV(PCIE2)',
            vector: 'PCINT2_vect', flag: 'PCIFR = _BV(PCIF2)' }, 'PD7'],
    ]) {
        it(`${chip}: a typed line arrives through the interrupt and comes back`, () => {
            const a = createAvr8jsAdapter({ program: build(PCINT_ECHO(cfg), chip, 8_000_000), chip });
            // The bench reads RX low (nothing drives it there): the monitor's
            // line, once attached, is what the pin sees instead.
            a.attachBoard(stubBoard(25, [rxName]));
            let out = '';
            a.onSerial((b) => { out += String.fromCharCode(b); });
            a.advanceNs(2_000_000);
            a.sendSerial(Array.from('Ada 42\r', (c) => c.charCodeAt(0)));
            a.advanceNs(30_000_000);
            assert.equal(out, 'Ada 42\r');
            // The monitor stays attached: its idle-high line must not fire the
            // receiver again (a bench reading low here put a 0x00 in the
            // queue and corrupted the next line printed -- found by
            // sb3-creator's ask chain on both chips).
            a.sendSerial(Array.from('ok\r', (c) => c.charCodeAt(0)));
            a.advanceNs(30_000_000);
            assert.equal(out, 'Ada 42\rok\r');
        });
    }
});
