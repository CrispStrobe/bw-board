/**
 * AVR chip definitions for the avr8js adapter.
 *
 * Each chip definition provides the pin map, port configs, timer configs,
 * ADC config, and USART config that differ between ATmega328P (Nano/Uno),
 * ATmega2560 (Mega), and ATtiny85. The adapter reads these to instantiate
 * the right peripherals and map Arduino-style pin names to port/bit pairs.
 *
 * Register addresses and interrupt vectors are from the respective datasheets;
 * the defaultTimerBits for TIFR/TIMSK bit assignments vary per chip and per
 * timer — they are NOT the same between 328P Timer0 and ATtiny85 Timer0.
 *
 * @module
 */

import {
  portAConfig, portBConfig, portCConfig, portDConfig,
  portEConfig, portFConfig, portGConfig, portHConfig,
  portJConfig, portKConfig, portLConfig,
  PCINT0,
} from 'avr8js';

// ─── Shared divider tables ─────────────────────────────────────────────────

const timer01Dividers = { 0:0, 1:1, 2:8, 3:64, 4:256, 5:1024, 6:0, 7:0 };
const timer2Dividers  = { 0:0, 1:1, 2:8, 3:32, 4:64, 5:128, 6:256, 7:1024 };

// ─── ATmega328P (Arduino Nano / Uno) ────────────────────────────────────────

/** @type {Record<string, {port?: string, bit?: number, analogOnly?: boolean, adcChannel?: number}>} */
export const ATMEGA328P_PINS = {
  D0: { port: 'D', bit: 0 }, D1: { port: 'D', bit: 1 },
  D2: { port: 'D', bit: 2 }, D3: { port: 'D', bit: 3 },
  D4: { port: 'D', bit: 4 }, D5: { port: 'D', bit: 5 },
  D6: { port: 'D', bit: 6 }, D7: { port: 'D', bit: 7 },
  D8: { port: 'B', bit: 0 }, D9: { port: 'B', bit: 1 },
  D10: { port: 'B', bit: 2 }, D11: { port: 'B', bit: 3 },
  D12: { port: 'B', bit: 4 }, D13: { port: 'B', bit: 5 },
  A0: { port: 'C', bit: 0 }, A1: { port: 'C', bit: 1 },
  A2: { port: 'C', bit: 2 }, A3: { port: 'C', bit: 3 },
  A4: { port: 'C', bit: 4 }, A5: { port: 'C', bit: 5 },
  A6: { analogOnly: true, adcChannel: 6 },
  A7: { analogOnly: true, adcChannel: 7 },
};

const ATMEGA328P_PORTS = { B: portBConfig, C: portCConfig, D: portDConfig };

// 328P defaultTimerBits: TOV=1, OCFA=2, OCFB=4, TOIE=1, OCIEA=2, OCIEB=4
const tb328 = { TOV: 1, OCFA: 2, OCFB: 4, OCFC: 0, TOIE: 1, OCIEA: 2, OCIEB: 4, OCIEC: 0 };

const ATMEGA328P_TIMERS = [
  { bits: 8,  captureInterrupt: 0, compAInterrupt: 0x1c, compBInterrupt: 0x1e, compCInterrupt: 0, ovfInterrupt: 0x20, TIFR: 0x35, OCRA: 0x47, OCRB: 0x48, OCRC: 0, ICR: 0, TCNT: 0x46, TCCRA: 0x44, TCCRB: 0x45, TCCRC: 0, TIMSK: 0x6e, dividers: timer01Dividers, compPortA: portDConfig.PORT, compPinA: 6, compPortB: portDConfig.PORT, compPinB: 5, compPortC: 0, compPinC: 0, externalClockPort: portDConfig.PORT, externalClockPin: 4, ...tb328 },
  { bits: 16, captureInterrupt: 0x14, compAInterrupt: 0x16, compBInterrupt: 0x18, compCInterrupt: 0, ovfInterrupt: 0x1a, TIFR: 0x36, OCRA: 0x88, OCRB: 0x8a, OCRC: 0, ICR: 0x86, TCNT: 0x84, TCCRA: 0x80, TCCRB: 0x81, TCCRC: 0x82, TIMSK: 0x6f, dividers: timer01Dividers, compPortA: portBConfig.PORT, compPinA: 1, compPortB: portBConfig.PORT, compPinB: 2, compPortC: 0, compPinC: 0, externalClockPort: portDConfig.PORT, externalClockPin: 5, ...tb328 },
  { bits: 8,  captureInterrupt: 0, compAInterrupt: 0x0e, compBInterrupt: 0x10, compCInterrupt: 0, ovfInterrupt: 0x12, TIFR: 0x37, OCRA: 0xb3, OCRB: 0xb4, OCRC: 0, ICR: 0, TCNT: 0xb2, TCCRA: 0xb0, TCCRB: 0xb1, TCCRC: 0, TIMSK: 0x70, dividers: timer2Dividers, compPortA: portBConfig.PORT, compPinA: 3, compPortB: portDConfig.PORT, compPinB: 3, compPortC: 0, compPinC: 0, externalClockPort: 0, externalClockPin: 0, ...tb328 },
];

/** @type {import('avr8js').ADCConfig} */
const ATMEGA328P_ADC = {
  ADMUX: 0x7c, ADCSRA: 0x7a, ADCSRB: 0x7b, ADCL: 0x78, ADCH: 0x79,
  DIDR0: 0x7e, adcInterrupt: 0x2a, numChannels: 8, muxInputMask: 0xf,
  adcReferences: [1/*AREF*/, 0/*AVCC*/, 4/*Reserved*/, 2/*Internal1V1*/],
  muxChannels: Object.fromEntries(
    [...Array(8)].map((_, i) => [i, { type: 0/*SingleEnded*/, channel: i }])
  ),
};

/** ADC channel → pin name for analog reads from the board. */
const ATMEGA328P_ADC_MAP = Object.fromEntries(
  [...Array(8)].map((_, i) => [i, `A${i}`])
);

const ATMEGA328P_USART = {
  rxCompleteInterrupt: 0x24, dataRegisterEmptyInterrupt: 0x26,
  txCompleteInterrupt: 0x28, UCSRA: 0xc0, UCSRB: 0xc1, UCSRC: 0xc2,
  UBRRL: 0xc4, UBRRH: 0xc5, UDR: 0xc6,
};

// TWI register addresses (same as twiConfig from avr8js).
const ATMEGA328P_TWI = {
  twiInterrupt: 0x30,   // vector 25, word address (25-1)*2
  TWBR: 0xb8, TWSR: 0xb9, TWAR: 0xba,
  TWDR: 0xbb, TWCR: 0xbc, TWAMR: 0xbd,
};

// SPI register addresses (same as spiConfig from avr8js).
const ATMEGA328P_SPI = {
  spiInterrupt: 0x22,   // vector 18, word address (18-1)*2
  SPCR: 0x4c, SPSR: 0x4d, SPDR: 0x4e,
};

export const ATMEGA328P = {
  name: 'ATmega328P',
  flashWords: 0x4000,   // 32 KB = 16K words
  sramBytes: 2048,
  clockHz: 16_000_000,
  vcc: 5.0,
  pins: ATMEGA328P_PINS,
  ports: ATMEGA328P_PORTS,
  timers: ATMEGA328P_TIMERS,
  adc: ATMEGA328P_ADC,
  adcChannelToPin: ATMEGA328P_ADC_MAP,
  usart: ATMEGA328P_USART,
  twi: ATMEGA328P_TWI,
  spi: ATMEGA328P_SPI,
};

// ─── ATmega2560 (Arduino Mega) ─────────────────────────────────────────────
// Pin map from the official Arduino Mega schematic.
// Ports C (D30-37) and L (D42-49) count DESCENDING: PC7=D30, PL7=D42.

const ATMEGA2560_PINS = {};

// Port E: PE0=D0(RX0), PE1=D1(TX0), PE3=D5, PE4=D2, PE5=D3
Object.assign(ATMEGA2560_PINS, {
  D0: { port: 'E', bit: 0 }, D1: { port: 'E', bit: 1 },
  D2: { port: 'E', bit: 4 }, D3: { port: 'E', bit: 5 },
  D5: { port: 'E', bit: 3 },
});
// Port G: PG5=D4, PG0=D41, PG1=D40, PG2=D39
Object.assign(ATMEGA2560_PINS, {
  D4: { port: 'G', bit: 5 },
  D39: { port: 'G', bit: 2 }, D40: { port: 'G', bit: 1 }, D41: { port: 'G', bit: 0 },
});
// Port H: PH3=D6, PH4=D7, PH5=D8, PH6=D9, PH0=D17(RX2), PH1=D16(TX2)
Object.assign(ATMEGA2560_PINS, {
  D6: { port: 'H', bit: 3 }, D7: { port: 'H', bit: 4 },
  D8: { port: 'H', bit: 5 }, D9: { port: 'H', bit: 6 },
  D16: { port: 'H', bit: 1 }, D17: { port: 'H', bit: 0 },
});
// Port B: PB4=D10, PB5=D11, PB6=D12, PB7=D13, PB0=D53(SS), PB1=D52(SCK), PB2=D51(MOSI), PB3=D50(MISO)
Object.assign(ATMEGA2560_PINS, {
  D10: { port: 'B', bit: 4 }, D11: { port: 'B', bit: 5 },
  D12: { port: 'B', bit: 6 }, D13: { port: 'B', bit: 7 },
  D50: { port: 'B', bit: 3 }, D51: { port: 'B', bit: 2 },
  D52: { port: 'B', bit: 1 }, D53: { port: 'B', bit: 0 },
});
// Port J: PJ1=D14(TX3), PJ0=D15(RX3)
Object.assign(ATMEGA2560_PINS, {
  D14: { port: 'J', bit: 1 }, D15: { port: 'J', bit: 0 },
});
// Port D: PD3=D18(TX1), PD2=D19(RX1), PD1=D20(SDA), PD0=D21(SCL), PD7=D38
Object.assign(ATMEGA2560_PINS, {
  D18: { port: 'D', bit: 3 }, D19: { port: 'D', bit: 2 },
  D20: { port: 'D', bit: 1 }, D21: { port: 'D', bit: 0 },
  D38: { port: 'D', bit: 7 },
});
// Port A: PA0=D22 .. PA7=D29 (ascending)
for (let i = 0; i < 8; i++) ATMEGA2560_PINS[`D${22 + i}`] = { port: 'A', bit: i };
// Port C: PC7=D30, PC6=D31, ..., PC0=D37 (DESCENDING)
for (let i = 0; i < 8; i++) ATMEGA2560_PINS[`D${30 + i}`] = { port: 'C', bit: 7 - i };
// Port L: PL7=D42, PL6=D43, ..., PL0=D49 (DESCENDING)
for (let i = 0; i < 8; i++) ATMEGA2560_PINS[`D${42 + i}`] = { port: 'L', bit: 7 - i };
// Port F: PF0=A0 .. PF7=A7
for (let i = 0; i < 8; i++) ATMEGA2560_PINS[`A${i}`] = { port: 'F', bit: i };
// Port K: PK0=A8 .. PK7=A15
for (let i = 0; i < 8; i++) ATMEGA2560_PINS[`A${8 + i}`] = { port: 'K', bit: i };

const ATMEGA2560_PORTS = {
  A: portAConfig, B: portBConfig, C: portCConfig, D: portDConfig,
  E: portEConfig, F: portFConfig, G: portGConfig, H: portHConfig,
  J: portJConfig, K: portKConfig, L: portLConfig,
};

// ATmega2560 interrupt vectors (word addresses = (vectorNum - 1) * 2):
// Timer0: COMPA=V22→0x2A, COMPB=V23→0x2C, OVF=V24→0x2E
// Timer1: CAPT=V17→0x20, COMPA=V18→0x22, COMPB=V19→0x24, COMPC=V20→0x26, OVF=V21→0x28
// Timer2: COMPA=V14→0x1A, COMPB=V15→0x1C, OVF=V16→0x1E
// Timer3: CAPT=V32→0x3E, COMPA=V33→0x40, COMPB=V34→0x42, COMPC=V35→0x44, OVF=V36→0x46
// Timer4: CAPT=V42→0x52, COMPA=V43→0x54, COMPB=V44→0x56, COMPC=V45→0x58, OVF=V46→0x5A
// Timer5: CAPT=V47→0x5C, COMPA=V48→0x5E, COMPB=V49→0x60, COMPC=V50→0x62, OVF=V51→0x64
// USART0: RX=V26→0x32, UDRE=V27→0x34, TX=V28→0x36
// ADC: V29→0x38

// Timer bit assignments are the SAME as 328P (per-timer TIFRn/TIMSKn registers)
const tb2560 = tb328;

// OC pin assignments differ from 328P:
// Timer0: OC0A=PB7(D13), OC0B=PG5(D4)
// Timer1: OC1A=PB5(D11), OC1B=PB6(D12), OC1C=PB7(D13)
// Timer2: OC2A=PB4(D10), OC2B=PH6(D9)
// Timer3: OC3A=PE3(D5), OC3B=PE4(D2), OC3C=PE5(D3)
// Timer4: OC4A=PH3(D6), OC4B=PH4(D7), OC4C=PH5(D8)
// Timer5: OC5A=PL3(D46), OC5B=PL4(D45), OC5C=PL5(D44)
const tbC = { TOV: 1, OCFA: 2, OCFB: 4, OCFC: 8, TOIE: 1, OCIEA: 2, OCIEB: 4, OCIEC: 8 };

const ATMEGA2560_TIMERS = [
  // Timer0 (8-bit): same register addresses, different OC pins and interrupt vectors
  { bits: 8, captureInterrupt: 0, compAInterrupt: 0x2A, compBInterrupt: 0x2C, compCInterrupt: 0, ovfInterrupt: 0x2E, TIFR: 0x35, OCRA: 0x47, OCRB: 0x48, OCRC: 0, ICR: 0, TCNT: 0x46, TCCRA: 0x44, TCCRB: 0x45, TCCRC: 0, TIMSK: 0x6e, dividers: timer01Dividers, compPortA: portBConfig.PORT, compPinA: 7, compPortB: portGConfig.PORT, compPinB: 5, compPortC: 0, compPinC: 0, externalClockPort: portDConfig.PORT, externalClockPin: 7, ...tb2560 },
  // Timer1 (16-bit) with OC1C
  { bits: 16, captureInterrupt: 0x20, compAInterrupt: 0x22, compBInterrupt: 0x24, compCInterrupt: 0x26, ovfInterrupt: 0x28, TIFR: 0x36, OCRA: 0x88, OCRB: 0x8a, OCRC: 0x8c, ICR: 0x86, TCNT: 0x84, TCCRA: 0x80, TCCRB: 0x81, TCCRC: 0x82, TIMSK: 0x6f, dividers: timer01Dividers, compPortA: portBConfig.PORT, compPinA: 5, compPortB: portBConfig.PORT, compPinB: 6, compPortC: portBConfig.PORT, compPinC: 7, externalClockPort: portDConfig.PORT, externalClockPin: 6, ...tbC },
  // Timer2 (8-bit)
  { bits: 8, captureInterrupt: 0, compAInterrupt: 0x1A, compBInterrupt: 0x1C, compCInterrupt: 0, ovfInterrupt: 0x1E, TIFR: 0x37, OCRA: 0xb3, OCRB: 0xb4, OCRC: 0, ICR: 0, TCNT: 0xb2, TCCRA: 0xb0, TCCRB: 0xb1, TCCRC: 0, TIMSK: 0x70, dividers: timer2Dividers, compPortA: portBConfig.PORT, compPinA: 4, compPortB: portHConfig.PORT, compPinB: 6, compPortC: 0, compPinC: 0, externalClockPort: 0, externalClockPin: 0, ...tb2560 },
  // Timer3 (16-bit)
  { bits: 16, captureInterrupt: 0x3E, compAInterrupt: 0x40, compBInterrupt: 0x42, compCInterrupt: 0x44, ovfInterrupt: 0x46, TIFR: 0x38, OCRA: 0x98, OCRB: 0x9a, OCRC: 0x9c, ICR: 0x96, TCNT: 0x94, TCCRA: 0x90, TCCRB: 0x91, TCCRC: 0x92, TIMSK: 0x71, dividers: timer01Dividers, compPortA: portEConfig.PORT, compPinA: 3, compPortB: portEConfig.PORT, compPinB: 4, compPortC: portEConfig.PORT, compPinC: 5, externalClockPort: 0, externalClockPin: 0, ...tbC },
  // Timer4 (16-bit)
  { bits: 16, captureInterrupt: 0x52, compAInterrupt: 0x54, compBInterrupt: 0x56, compCInterrupt: 0x58, ovfInterrupt: 0x5A, TIFR: 0x39, OCRA: 0xa8, OCRB: 0xaa, OCRC: 0xac, ICR: 0xa6, TCNT: 0xa4, TCCRA: 0xa0, TCCRB: 0xa1, TCCRC: 0xa2, TIMSK: 0x72, dividers: timer01Dividers, compPortA: portHConfig.PORT, compPinA: 3, compPortB: portHConfig.PORT, compPinB: 4, compPortC: portHConfig.PORT, compPinC: 5, externalClockPort: 0, externalClockPin: 0, ...tbC },
  // Timer5 (16-bit)
  { bits: 16, captureInterrupt: 0x5C, compAInterrupt: 0x5E, compBInterrupt: 0x60, compCInterrupt: 0x62, ovfInterrupt: 0x64, TIFR: 0x3A, OCRA: 0x128, OCRB: 0x12a, OCRC: 0x12c, ICR: 0x126, TCNT: 0x124, TCCRA: 0x120, TCCRB: 0x121, TCCRC: 0x122, TIMSK: 0x73, dividers: timer01Dividers, compPortA: portLConfig.PORT, compPinA: 3, compPortB: portLConfig.PORT, compPinB: 4, compPortC: portLConfig.PORT, compPinC: 5, externalClockPort: 0, externalClockPin: 0, ...tbC },
];

const ATMEGA2560_ADC = {
  ADMUX: 0x7c, ADCSRA: 0x7a, ADCSRB: 0x7b, ADCL: 0x78, ADCH: 0x79,
  DIDR0: 0x7e, adcInterrupt: 0x38, numChannels: 16, muxInputMask: 0x1f,
  adcReferences: [1, 0, 4, 2],
  muxChannels: Object.fromEntries(
    [...Array(16)].map((_, i) => [i, { type: 0/*SingleEnded*/, channel: i }])
  ),
};

const ATMEGA2560_ADC_MAP = Object.fromEntries(
  [...Array(16)].map((_, i) => [i, `A${i}`])
);

// USART0 register addresses are the same; interrupt vectors differ.
const ATMEGA2560_USART = {
  rxCompleteInterrupt: 0x32, dataRegisterEmptyInterrupt: 0x34,
  txCompleteInterrupt: 0x36, UCSRA: 0xc0, UCSRB: 0xc1, UCSRC: 0xc2,
  UBRRL: 0xc4, UBRRH: 0xc5, UDR: 0xc6,
};

// ATmega2560 TWI: same register addresses, different interrupt vector.
const ATMEGA2560_TWI = {
  twiInterrupt: 0x4c,   // vector 39, word address (39-1)*2
  TWBR: 0xb8, TWSR: 0xb9, TWAR: 0xba,
  TWDR: 0xbb, TWCR: 0xbc, TWAMR: 0xbd,
};

// ATmega2560 SPI: same register addresses, different interrupt vector.
const ATMEGA2560_SPI = {
  spiInterrupt: 0x26,   // vector 20, word address (20-1)*2
  SPCR: 0x4c, SPSR: 0x4d, SPDR: 0x4e,
};

export const ATMEGA2560 = {
  name: 'ATmega2560',
  flashWords: 0x20000,  // 256 KB = 128K words
  sramBytes: 8192,
  clockHz: 16_000_000,
  vcc: 5.0,
  pins: ATMEGA2560_PINS,
  ports: ATMEGA2560_PORTS,
  timers: ATMEGA2560_TIMERS,
  adc: ATMEGA2560_ADC,
  adcChannelToPin: ATMEGA2560_ADC_MAP,
  usart: ATMEGA2560_USART,
  twi: ATMEGA2560_TWI,
  spi: ATMEGA2560_SPI,
};

// ─── ATtiny85 ───────────────────────────────────────────────────────────────
// Single port B at ATtiny85-specific addresses. 6 pins: PB0-PB5.
// Interrupt vectors are 1-word (flash < 8 KB), so address = vectorNum - 1.

const ATTINY85_PINS = {
  P0: { port: 'B', bit: 0 }, // PB0: MOSI/OC0A
  P1: { port: 'B', bit: 1 }, // PB1: MISO/OC0B/OC1A
  P2: { port: 'B', bit: 2 }, // PB2: SCK/ADC1/T0/INT0
  P3: { port: 'B', bit: 3 }, // PB3: ADC3/OC1B
  P4: { port: 'B', bit: 4 }, // PB4: ADC2
  P5: { port: 'B', bit: 5 }, // PB5: RESET/ADC0 (usually reset)
};

// ATtiny85 PORTB at different addresses than ATmega328P
const attiny85PortBConfig = {
  PIN: 0x36, DDR: 0x37, PORT: 0x38,
  externalInterrupts: [],
};

const ATTINY85_PORTS = { B: attiny85PortBConfig };

// ATtiny85 Timer0 (8-bit, AVRTimer-compatible)
// TIFR/TIMSK bit assignments for Timer0 (shared register with Timer1):
//   TIFR(0x58): bit1=TOV0, bit3=OCF0A, bit4=OCF0B
//   TIMSK(0x59): bit1=TOIE0, bit3=OCIE0A, bit4=OCIE0B
// Interrupt vectors (1-word, word address = vectorNum - 1):
//   Timer0 OVF=V6→0x05, Timer0 COMPA=V11→0x0A, Timer0 COMPB=V12→0x0B
const attiny85Timer0 = {
  bits: 8, captureInterrupt: 0, compAInterrupt: 0x0A, compBInterrupt: 0x0B,
  compCInterrupt: 0, ovfInterrupt: 0x05,
  TIFR: 0x58, OCRA: 0x49, OCRB: 0x48, OCRC: 0, ICR: 0,
  TCNT: 0x52, TCCRA: 0x4A, TCCRB: 0x53, TCCRC: 0,
  TIMSK: 0x59, dividers: timer01Dividers,
  compPortA: attiny85PortBConfig.PORT, compPinA: 0,  // OC0A = PB0
  compPortB: attiny85PortBConfig.PORT, compPinB: 1,  // OC0B = PB1
  compPortC: 0, compPinC: 0,
  externalClockPort: attiny85PortBConfig.PORT, externalClockPin: 2,
  TOV: 1 << 1, OCFA: 1 << 3, OCFB: 1 << 4, OCFC: 0,
  TOIE: 1 << 1, OCIEA: 1 << 3, OCIEB: 1 << 4, OCIEC: 0,
};

// ATtiny85 Timer1 uses ATtinyTimer1 (separate class in avr8js), not AVRTimer.
// Config is imported from avr8js as attinyTimer1Config. The adapter handles
// instantiation separately.

const ATTINY85_TIMERS = [attiny85Timer0];
// Marker: Timer1 uses ATtinyTimer1 class, instantiated separately.
const ATTINY85_TIMER1_CLASS = 'ATtinyTimer1';

// ATtiny85 ADC: different register addresses, 4 single-ended channels.
// Channels: ADC0=PB5, ADC1=PB2, ADC2=PB4, ADC3=PB3
const ATTINY85_ADC = {
  ADMUX: 0x27, ADCSRA: 0x26, ADCSRB: 0x23, ADCL: 0x24, ADCH: 0x25,
  DIDR0: 0x34, adcInterrupt: 0x08, numChannels: 4, muxInputMask: 0x3f,
  adcReferences: [1/*AREF/VCC*/, 0/*AVCC*/, 4/*Reserved*/, 3/*Internal2V56*/],
  muxChannels: Object.fromEntries(
    [...Array(4)].map((_, i) => [i, { type: 0/*SingleEnded*/, channel: i }])
  ),
};

// ADC channel → pin name (non-trivial mapping on ATtiny85)
const ATTINY85_ADC_MAP = { 0: 'P5', 1: 'P2', 2: 'P4', 3: 'P3' };

// USI register addresses (ATtiny85 datasheet §15.11)
// Data-space addresses: USIDR=0x2F, USISR=0x2E, USICR=0x2D
// Interrupt vectors (1-word, address = vectorNum - 1):
//   USI START = vector 7 → 0x06, USI OVERFLOW = vector 8 → 0x07
const ATTINY85_USI = {
  USIDR: 0x2F,
  USISR: 0x2E,
  USICR: 0x2D,
  usiOverflowInterrupt: 0x07,
  usiStartInterrupt: 0x06,
};

export const ATTINY85 = {
  name: 'ATtiny85',
  flashWords: 4096,     // 8 KB = 4K words
  sramBytes: 512,
  clockHz: 8_000_000,   // 8 MHz internal RC (default)
  vcc: 5.0,
  pins: ATTINY85_PINS,
  ports: ATTINY85_PORTS,
  timers: ATTINY85_TIMERS,
  attinyTimer1: ATTINY85_TIMER1_CLASS,  // marker for special Timer1 handling
  adc: ATTINY85_ADC,
  adcChannelToPin: ATTINY85_ADC_MAP,
  usart: null,  // no USART on ATtiny85
  usi: ATTINY85_USI,    // USI peripheral for software I2C (TinyWireM)
};

// ─── ATtiny88 (Blinkenrocket congress badge) ──────────────────────────────
// 28-pin, 8 KB flash, 512 B SRAM, 64 B internal EEPROM, 8 MHz internal RC.
// Ports B/C/D at standard ATmega addresses; Port A at 0x2C–0x2E.
// Timer0 is a simplified 8-bit counter (CS bits in a single TCCR0A register,
// no separate TCCR0B).  We map TCCRB → 0x45 (the firmware's TCCR0A) so
// avr8js reads the prescaler bits correctly, and point TCCRA at an unused
// address (0x62) the firmware never touches.
// Interrupt vectors are 1-word: address = vectorNum − 1.

/** @type {Record<string, {port?: string, bit?: number, analogOnly?: boolean, adcChannel?: number}>} */
export const ATTINY88_PINS = {
  // Port B: PB0–PB7 (display columns on blinkenrocket)
  PB0: { port: 'B', bit: 0 }, PB1: { port: 'B', bit: 1 },
  PB2: { port: 'B', bit: 2 }, PB3: { port: 'B', bit: 3 },
  PB4: { port: 'B', bit: 4 }, PB5: { port: 'B', bit: 5 },
  PB6: { port: 'B', bit: 6 }, PB7: { port: 'B', bit: 7 },
  // Port C: PC0–PC7 (ADC0–5 on PC0–5; PC3=BTN_RIGHT, PC7=BTN_LEFT)
  PC0: { port: 'C', bit: 0 }, PC1: { port: 'C', bit: 1 },
  PC2: { port: 'C', bit: 2 }, PC3: { port: 'C', bit: 3 },
  PC4: { port: 'C', bit: 4 }, PC5: { port: 'C', bit: 5 },
  PC6: { port: 'C', bit: 6 }, PC7: { port: 'C', bit: 7 },
  // Port D: PD0–PD7 (display rows on blinkenrocket)
  PD0: { port: 'D', bit: 0 }, PD1: { port: 'D', bit: 1 },
  PD2: { port: 'D', bit: 2 }, PD3: { port: 'D', bit: 3 },
  PD4: { port: 'D', bit: 4 }, PD5: { port: 'D', bit: 5 },
  PD6: { port: 'D', bit: 6 }, PD7: { port: 'D', bit: 7 },
  // Port A: PA0–PA3 (PA0=modem input on blinkenrocket)
  PA0: { port: 'A', bit: 0 }, PA1: { port: 'A', bit: 1 },
  PA2: { port: 'A', bit: 2 }, PA3: { port: 'A', bit: 3 },
  // Analog-only channels
  A6: { analogOnly: true, adcChannel: 6 },
  A7: { analogOnly: true, adcChannel: 7 },
};

// Port A at ATtiny88-specific addresses (not the ATmega2560 portAConfig)
const attiny88PortAConfig = {
  PIN: 0x2C, DDR: 0x2D, PORT: 0x2E,
  externalInterrupts: [],
};

const ATTINY88_PORTS = {
  A: attiny88PortAConfig,
  B: portBConfig,  // same addresses as ATmega328P
  C: portCConfig,
  D: portDConfig,
};

// Timer0 — simplified 8-bit counter.
// TCCRA → 0x62 (unused address; firmware never writes here, so WGM/COM stay 0).
// TCCRB → 0x45 (ATtiny88's TCCR0A, which contains CS00/CS01/CS02).
// Overflow rate is identical in normal and fast-PWM modes (both overflow at
// 0xFF), so if something else writes 0x62 by accident the timer still works.
// No OC0A/OC0B output compare pins on ATtiny88.
const attiny88Timer0 = {
  bits: 8, captureInterrupt: 0,
  compAInterrupt: 0x0C,  // TIMER0_COMPA, vect_num 12
  compBInterrupt: 0x0D,  // TIMER0_COMPB, vect_num 13
  compCInterrupt: 0,
  ovfInterrupt: 0x0E,    // TIMER0_OVF, vect_num 14
  TIFR: 0x35, OCRA: 0x47, OCRB: 0x48, OCRC: 0, ICR: 0,
  TCNT: 0x46,
  TCCRA: 0x62,  // unused data address — keeps WGM/COM at 0
  TCCRB: 0x45,  // ATtiny88's TCCR0A (contains CS bits)
  TCCRC: 0,
  TIMSK: 0x6E,
  dividers: timer01Dividers,
  compPortA: 0, compPinA: 0,  // no OC0A output
  compPortB: 0, compPinB: 0,  // no OC0B output
  compPortC: 0, compPinC: 0,
  externalClockPort: 0, externalClockPin: 0,
  TOV: 1, OCFA: 2, OCFB: 4, OCFC: 0,
  TOIE: 1, OCIEA: 2, OCIEB: 4, OCIEC: 0,
};

// Timer1 — standard 16-bit timer, same register addresses as ATmega328P.
const attiny88Timer1 = {
  bits: 16,
  captureInterrupt: 0x08,  // TIMER1_CAPT, vect_num 8
  compAInterrupt: 0x09,    // TIMER1_COMPA, vect_num 9
  compBInterrupt: 0x0A,    // TIMER1_COMPB, vect_num 10
  compCInterrupt: 0,       // no OC1C
  ovfInterrupt: 0x0B,      // TIMER1_OVF, vect_num 11
  TIFR: 0x36, OCRA: 0x88, OCRB: 0x8A, OCRC: 0, ICR: 0x86,
  TCNT: 0x84, TCCRA: 0x80, TCCRB: 0x81, TCCRC: 0x82,
  TIMSK: 0x6F,
  dividers: timer01Dividers,
  compPortA: 0, compPinA: 0,
  compPortB: 0, compPinB: 0,
  compPortC: 0, compPinC: 0,
  externalClockPort: 0, externalClockPin: 0,
  TOV: 1, OCFA: 2, OCFB: 4, OCFC: 0,
  TOIE: 1, OCIEA: 2, OCIEB: 4, OCIEC: 0,
};

const ATTINY88_TIMERS = [attiny88Timer0, attiny88Timer1];

// ADC: 8 channels, same register addresses as ATmega328P.
const ATTINY88_ADC = {
  ADMUX: 0x7C, ADCSRA: 0x7A, ADCSRB: 0x7B, ADCL: 0x78, ADCH: 0x79,
  DIDR0: 0x7E, adcInterrupt: 0x10,  // ADC, vect_num 16
  numChannels: 8, muxInputMask: 0x0F,
  adcReferences: [1/*AREF*/, 0/*AVCC*/, 4/*Reserved*/, 2/*Internal1V1*/],
  muxChannels: Object.fromEntries(
    [...Array(8)].map((_, i) => [i, { type: 0, channel: i }])
  ),
};

// ADC channel → pin name (ADC0–5 = PC0–5, ADC6–7 = analog only)
const ATTINY88_ADC_MAP = {
  0: 'PC0', 1: 'PC1', 2: 'PC2', 3: 'PC3',
  4: 'PC4', 5: 'PC5', 6: 'A6', 7: 'A7',
};

// Internal EEPROM: 64 bytes, same register addresses as avr8js defaults
// except the EE_READY interrupt vector and timing at 8 MHz.
export const ATTINY88_EEPROM = {
  eepromReadyInterrupt: 0x11,  // EE_READY, vect_num 17
  EECR: 0x3F, EEDR: 0x40, EEARL: 0x41, EEARH: 0x42,
  eraseCycles: 14400,   // 1.8 ms at 8 MHz
  writeCycles: 14400,
};

// TWI register addresses for the stub peripheral.
export const ATTINY88_TWI = {
  TWBR: 0xB8, TWSR: 0xB9, TWAR: 0xBA,
  TWDR: 0xBB, TWCR: 0xBC, TWAMR: 0xBD,
};

export const ATTINY88 = {
  name: 'ATtiny88',
  flashWords: 4096,     // 8 KB = 4K words
  sramBytes: 512,
  eepromBytes: 64,
  clockHz: 8_000_000,   // 8 MHz internal RC
  vcc: 5.0,
  pins: ATTINY88_PINS,
  ports: ATTINY88_PORTS,
  timers: ATTINY88_TIMERS,
  adc: ATTINY88_ADC,
  adcChannelToPin: ATTINY88_ADC_MAP,
  usart: null,  // no USART
  eeprom: ATTINY88_EEPROM,
  twi: ATTINY88_TWI,
};

// ─── ATtiny2313 ────────────────────────────────────────────────────────────
// 20-pin DIP, 2 KB flash (1K words), 128 B SRAM, 128 B EEPROM.
// Ports: A (PA0-PA2, 3 pins), B (PB0-PB7, 8 pins), D (PD0-PD6, 7 pins).
// Has a real USART (not USI), Timer0 (8-bit), Timer1 (16-bit). NO ADC.
// Register addresses from ATtiny2313 datasheet (doc2543).
// Port register addresses same as ATmega328P: A=0x20-22, B=0x23-25, D=0x29-2B.
// Interrupt vectors are 1-word (flash < 8 KB): address = vectorNum - 1.

const ATTINY2313_PINS = {
  // Port A: PA0=XTAL1, PA1=XTAL2, PA2=RESET — only PA0-PA2 usable as GPIO
  PA0: { port: 'A', bit: 0 },  // also XTAL1 (not usable if ext crystal)
  PA1: { port: 'A', bit: 1 },  // also XTAL2
  PA2: { port: 'A', bit: 2 },  // also RESET (usually not GPIO)
  // Port B: PB0-PB7 all available
  PB0: { port: 'B', bit: 0 },  // AIN0/PCINT0
  PB1: { port: 'B', bit: 1 },  // AIN1/PCINT1
  PB2: { port: 'B', bit: 2 },  // OC0A/PCINT2
  PB3: { port: 'B', bit: 3 },  // OC1A/PCINT3
  PB4: { port: 'B', bit: 4 },  // OC1B/PCINT4
  PB5: { port: 'B', bit: 5 },  // MOSI/DI/PCINT5
  PB6: { port: 'B', bit: 6 },  // MISO/DO/PCINT6
  PB7: { port: 'B', bit: 7 },  // USCK/SCL/PCINT7
  // Port D: PD0-PD6 (7 pins)
  PD0: { port: 'D', bit: 0 },  // RXD
  PD1: { port: 'D', bit: 1 },  // TXD
  PD2: { port: 'D', bit: 2 },  // INT0/XCK
  PD3: { port: 'D', bit: 3 },  // INT1
  PD4: { port: 'D', bit: 4 },  // T0
  PD5: { port: 'D', bit: 5 },  // OC0B/T1
  PD6: { port: 'D', bit: 6 },  // ICP1
};

// ATtiny2313 port addresses match ATmega328P (portAConfig, portBConfig, portDConfig)
const ATTINY2313_PORTS = {
  A: portAConfig,  // PIN=0x20, DDR=0x21, PORT=0x22
  B: portBConfig,  // PIN=0x23, DDR=0x24, PORT=0x25
  D: portDConfig,  // PIN=0x29, DDR=0x2A, PORT=0x2B
};

// ATtiny2313 vector table (doc2543 Table 9-1, 1-word vectors: addr = vectorNum - 1):
//   V4:TIMER1_CAPT=0x03, V5:TIMER1_COMPA=0x04, V6:TIMER1_OVF=0x05,
//   V7:TIMER0_OVF=0x06, V8:USART0_RX=0x07, V9:USART0_UDRE=0x08,
//   V10:USART0_TX=0x09, V13:TIMER1_COMPB=0x0C,
//   V14:TIMER0_COMPA=0x0D, V15:TIMER0_COMPB=0x0E

// Timer0 (8-bit): TCCR0A=0x30, TCCR0B=0x33, TCNT0=0x32, OCR0A=0x36, OCR0B=0x3C
// TIFR=0x58, TIMSK=0x59, same bit layout as ATtiny85 Timer0
const attiny2313Timer0Fixed = {
  bits: 8, captureInterrupt: 0,
  compAInterrupt: 0x0D,  // vector 14
  compBInterrupt: 0x0E,  // vector 15
  compCInterrupt: 0,
  ovfInterrupt: 0x06,    // vector 7
  TIFR: 0x58, OCRA: 0x36, OCRB: 0x3C, OCRC: 0, ICR: 0,
  TCNT: 0x32, TCCRA: 0x30, TCCRB: 0x33, TCCRC: 0,
  TIMSK: 0x59,
  dividers: timer01Dividers,
  compPortA: portBConfig.PORT, compPinA: 2,  // OC0A = PB2
  compPortB: portDConfig.PORT, compPinB: 5,  // OC0B = PD5
  compPortC: 0, compPinC: 0,
  externalClockPort: portDConfig.PORT, externalClockPin: 4,
  TOV: 1 << 1, OCFA: 1 << 3, OCFB: 1 << 4, OCFC: 0,
  TOIE: 1 << 1, OCIEA: 1 << 3, OCIEB: 1 << 4, OCIEC: 0,
};

const attiny2313Timer1Fixed = {
  bits: 16,
  captureInterrupt: 0x03,  // vector 4: TIMER1_CAPT
  compAInterrupt: 0x04,    // vector 5: TIMER1_COMPA
  compBInterrupt: 0x0C,    // vector 13: TIMER1_COMPB
  compCInterrupt: 0,
  ovfInterrupt: 0x05,      // vector 6: TIMER1_OVF
  TIFR: 0x58, OCRA: 0x4A, OCRB: 0x48, OCRC: 0, ICR: 0x44,
  TCNT: 0x4C, TCCRA: 0x4F, TCCRB: 0x4E, TCCRC: 0x42,
  TIMSK: 0x59,
  dividers: timer01Dividers,
  compPortA: portBConfig.PORT, compPinA: 3,
  compPortB: portBConfig.PORT, compPinB: 4,
  compPortC: 0, compPinC: 0,
  externalClockPort: portDConfig.PORT, externalClockPin: 5,
  TOV: 1 << 7, OCFA: 1 << 6, OCFB: 1 << 5, OCFC: 0,
  TOIE: 1 << 7, OCIEA: 1 << 6, OCIEB: 1 << 5, OCIEC: 0,
};

const ATTINY2313_TIMERS_FIXED = [attiny2313Timer0Fixed, attiny2313Timer1Fixed];

// USART registers (data-space addresses, datasheet §14.10):
//   UDR=0x2C, UCSRA=0x2B, UCSRB=0x2A, UCSRC=0x23, UBRRH=0x22, UBRRL=0x29
// Vectors: RXC=vector 8→0x07, UDRE=vector 9→0x08, TXC=vector 10→0x09
const ATTINY2313_USART = {
  rxCompleteInterrupt: 0x07,
  dataRegisterEmptyInterrupt: 0x08,
  txCompleteInterrupt: 0x09,
  UCSRA: 0x2B, UCSRB: 0x2A, UCSRC: 0x23,
  UBRRL: 0x29, UBRRH: 0x22, UDR: 0x2C,
};

export const ATTINY2313 = {
  name: 'ATtiny2313',
  flashWords: 1024,     // 2 KB = 1K words
  sramBytes: 128,
  clockHz: 8_000_000,   // 8 MHz internal RC (default, CKDIV8 fuse may halve)
  vcc: 5.0,
  pins: ATTINY2313_PINS,
  ports: ATTINY2313_PORTS,
  timers: ATTINY2313_TIMERS_FIXED,
  adc: null,            // NO ADC on ATtiny2313
  adcChannelToPin: {},
  usart: ATTINY2313_USART,
};

// ─── ATtiny13 ──────────────────────────────────────────────────────────────
// 8-pin DIP, 1 KB flash (512 words), 64 B SRAM, 64 B EEPROM.
// Single Port B (PB0-PB5, 6 pins) at same addresses as ATtiny85.
// Timer0 only (8-bit). 4-channel ADC. NO USART, NO USI (unlike t85).
// Register addresses from ATtiny13 datasheet (doc2535).
// Interrupt vectors are 1-word: address = vectorNum - 1.
// Vector table: 1:RESET, 2:INT0(0x01), 3:PCINT0(0x02), 4:TIM0_OVF(0x03),
//   5:EE_RDY(0x04), 6:ANA_COMP(0x05), 7:TIM0_COMPA(0x06), 8:TIM0_COMPB(0x07),
//   9:WDT(0x08), 10:ADC(0x09)

const ATTINY13_PINS = {
  PB0: { port: 'B', bit: 0 },  // MOSI/OC0A/AIN0/PCINT0
  PB1: { port: 'B', bit: 1 },  // MISO/OC0B/AIN1/INT0/PCINT1
  PB2: { port: 'B', bit: 2 },  // SCK/ADC1/T0/PCINT2
  PB3: { port: 'B', bit: 3 },  // ADC3/CLKI/PCINT3
  PB4: { port: 'B', bit: 4 },  // ADC2/PCINT4
  PB5: { port: 'B', bit: 5 },  // ADC0/RESET/PCINT5
};

// Port B at ATtiny13/85 addresses (same as attiny85PortBConfig)
const attiny13PortBConfig = {
  PIN: 0x36, DDR: 0x37, PORT: 0x38,
  externalInterrupts: [],
};

const ATTINY13_PORTS = { B: attiny13PortBConfig };

// Timer0 (8-bit): same register addresses as ATtiny85 Timer0.
// TIFR0 at data 0x58, TIMSK0 at 0x59 (avr-libc iotn13a.h: _SFR_IO8(0x38) → data 0x58).
// Vectors: TIM0_OVF=V4→0x03, TIM0_COMPA=V7→0x06, TIM0_COMPB=V8→0x07

const attiny13Timer0 = {
  bits: 8, captureInterrupt: 0,
  compAInterrupt: 0x06,  // vector 7: TIM0_COMPA
  compBInterrupt: 0x07,  // vector 8: TIM0_COMPB
  compCInterrupt: 0,
  ovfInterrupt: 0x03,    // vector 4: TIM0_OVF
  TIFR: 0x58, OCRA: 0x49, OCRB: 0x48, OCRC: 0, ICR: 0,
  TCNT: 0x52, TCCRA: 0x4A, TCCRB: 0x53, TCCRC: 0,
  TIMSK: 0x59,
  dividers: timer01Dividers,
  compPortA: attiny13PortBConfig.PORT, compPinA: 0,  // OC0A = PB0
  compPortB: attiny13PortBConfig.PORT, compPinB: 1,  // OC0B = PB1
  compPortC: 0, compPinC: 0,
  externalClockPort: attiny13PortBConfig.PORT, externalClockPin: 2,  // T0 = PB2
  TOV: 1 << 1, OCFA: 1 << 3, OCFB: 1 << 4, OCFC: 0,
  TOIE: 1 << 1, OCIEA: 1 << 3, OCIEB: 1 << 4, OCIEC: 0,
};

const ATTINY13_TIMERS = [attiny13Timer0];

// ADC: 4 single-ended channels, different register addresses from t85
// From iotn13a.h / datasheet:
//   ADMUX=0x27, ADCSRA=0x26, ADCL=0x24, ADCH=0x25, ADCSRB=0x23, DIDR0=0x34
// Channels: ADC0=PB5, ADC1=PB2, ADC2=PB4, ADC3=PB3 (same mapping as t85!)
// ADC interrupt: vector 10→0x09
const ATTINY13_ADC = {
  ADMUX: 0x27, ADCSRA: 0x26, ADCSRB: 0x23, ADCL: 0x24, ADCH: 0x25,
  DIDR0: 0x34, adcInterrupt: 0x09, numChannels: 4, muxInputMask: 0x03,
  adcReferences: [1/*VCC*/, 0/*AREF*/, 4/*Reserved*/, 3/*Internal1V1*/],
  muxChannels: Object.fromEntries(
    [...Array(4)].map((_, i) => [i, { type: 0, channel: i }])
  ),
};

const ATTINY13_ADC_MAP = { 0: 'PB5', 1: 'PB2', 2: 'PB4', 3: 'PB3' };

export const ATTINY13 = {
  name: 'ATtiny13',
  flashWords: 512,      // 1 KB = 512 words
  sramBytes: 64,
  clockHz: 9_600_000,   // 9.6 MHz internal RC (default, CKDIV8 → 1.2 MHz)
  vcc: 5.0,
  pins: ATTINY13_PINS,
  ports: ATTINY13_PORTS,
  timers: ATTINY13_TIMERS,
  adc: ATTINY13_ADC,
  adcChannelToPin: ATTINY13_ADC_MAP,
  usart: null,  // no USART
};

/** Lookup by name string, case-insensitive. */
export const CHIPS = {
  atmega328p: ATMEGA328P,
  atmega2560: ATMEGA2560,
  attiny85: ATTINY85,
  attiny88: ATTINY88,
  attiny2313: ATTINY2313,
  attiny13: ATTINY13,
};
