// One receive surface on every MCU adapter: `sendSerial(byteOrBytes)`, the
// bytes a serial monitor's "send" puts on the chip's RX line.
//
// The avr8js adapter had it; the RP2040, STM32F030 and 8051 adapters did not
// (the STM32 had a one-byte feedSerial), so a program that asks for input
// could be answered on one family only. An `ask ... and wait` in sb3-creator's
// device C route needs all four; its chain test is the end-to-end holder.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStm32F0Adapter } from '../src/stm32-adapter.js';
import { createRp2040jsAdapter } from '../src/rp2040js-adapter.js';
import { createAvr8jsAdapter } from '../src/avr8js-adapter.js';
import { createEmu8051Adapter } from '../src/emu8051-adapter.js';

describe('adapter sendSerial', () => {
  it('STM32F030: a line lands in USART1 receive, in order', () => {
    const a = createStm32F0Adapter({});
    assert.equal(a.sendSerial([0x34, 0x32, 0x0d]), true);
    assert.deepEqual(a.peripherals.usart1.rx, [0x34, 0x32, 0x0d]);
    a.sendSerial(0x41);
    assert.equal(a.peripherals.usart1.rx.at(-1), 0x41, 'a single byte is accepted too');
  });

  it('RP2040: a line goes into UART0\'s receive FIFO', () => {
    const a = createRp2040jsAdapter({});
    const uart = a.rp2040.uart[0];
    assert.equal(a.sendSerial([0x34, 0x32, 0x0d]), true);
    const got = [];
    while (!uart.rxFIFO.empty) got.push(uart.rxFIFO.pull());
    assert.deepEqual(got, [0x34, 0x32, 0x0d]);
  });

  it('the AVR adapter keeps the same surface', () => {
    const a = createAvr8jsAdapter({});
    assert.equal(typeof a.sendSerial, 'function');
  });

  it('8051: bytes go to the emulator one at a time, and TX reaches onSerial', () => {
    const written = [];
    let txCb = null;
    const wasm = {
      _emu_init() {}, _emu_reset() {}, _emu_set_fosc() {}, _emu_set_vcc() {},
      _emu_serial_write: (b) => written.push(b),
      _emu_set_serial_callback: (ptr) => { txCb = ptr; },
      addFunction: (fn) => fn, removeFunction() {},
      _emu_get_time_ns_lo: () => 0, _emu_get_time_ns_hi: () => 0,
      _emu_get_pin_mode: () => 0, _emu_get_pin_drive: () => 1,
    };
    const a = createEmu8051Adapter(wasm, { part: 'stc12c5a60s2', fosc: 11059200 });
    assert.equal(a.sendSerial('42\r'.split('').map((c) => c.charCodeAt(0))), true);
    assert.deepEqual(written, [0x34, 0x32, 0x0d]);
    const out = [];
    assert.equal(a.onSerial((b) => out.push(b)), true);
    txCb(0x4f);
    assert.deepEqual(out, [0x4f]);
  });
});
