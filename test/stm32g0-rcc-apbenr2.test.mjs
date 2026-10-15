// STM32G030 RCC_APBENR2 (offset 0x40, RM0444): USART1EN bit 14, TIM14EN
// bit 15, ADCEN bit 20. Register-level pokes through the machine bus — no
// compiler. F0 gating via APB2ENR/APB1ENR must be exactly as before.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CortexM0Machine } from '../src/cortex-m0-machine.js';
import { attachStm32F0, attachStm32G0 } from '../src/stm32f0-board.js';

const RCC = 0x40021000;
const APB2ENR = RCC + 0x18; // F0
const APB1ENR = RCC + 0x1c; // F0
const APBENR2 = RCC + 0x40; // G0
const USART1 = 0x40013800;
const TIM14 = 0x40002000;
const ADC = 0x40012400;

function board (attach) {
  const m = new CortexM0Machine({ clockHz: 64_000_000, sramBytes: 8192, flashBytes: 64 * 1024 });
  const bytes = [];
  const b = attach(m, { onSerialByte: (x) => bytes.push(x) });
  const w = (a, v) => m._write(a, v, 4);
  const r = (a) => m._read(a, 4);
  const sendHi = () => { w(USART1 + 0x00, 1 | (1 << 3)); w(USART1 + 0x28, 0x48); w(USART1 + 0x28, 0x69); };
  return { m, b, bytes, w, r, sendHi };
}

describe('STM32G0 RCC_APBENR2', () => {
  it('reads back what firmware wrote at 0x40', () => {
    const { w, r } = board(attachStm32G0);
    assert.equal(r(APBENR2), 0);
    w(APBENR2, (1 << 14) | (1 << 20));
    assert.equal(r(APBENR2) >>> 0, (1 << 14) | (1 << 20));
  });

  it('USART1 enabled via APBENR2 bit 14 transmits', () => {
    const { b, bytes, w, sendHi } = board(attachStm32G0);
    w(APBENR2, 1 << 14);
    sendHi();
    assert.deepEqual(bytes, [0x48, 0x69]);
    assert.deepEqual(b.rcc.gatedAccesses, []);
  });

  it('USART1 without APBENR2 bit 14 is gated and noted', () => {
    const { b, bytes, w, sendHi } = board(attachStm32G0);
    w(APBENR2, (1 << 20) | (1 << 15)); // other bits only
    sendHi();
    assert.deepEqual(bytes, []);
    assert.ok(b.rcc.gatedAccesses.some((a) => /USART1 accessed with its RCC clock off/.test(a)));
  });

  it('ADC enabled via APBENR2 bit 20; gated without it', () => {
    const on = board(attachStm32G0);
    on.w(APBENR2, 1 << 20);
    on.w(ADC + 0x28, 1 << 3);
    assert.equal(on.r(ADC + 0x28), 1 << 3);
    assert.deepEqual(on.b.rcc.gatedAccesses, []);
    const off = board(attachStm32G0);
    off.w(APBENR2, 1 << 14);
    off.w(ADC + 0x28, 1 << 3);
    assert.equal(off.r(ADC + 0x28), 0);
    assert.ok(off.b.rcc.gatedAccesses.some((a) => /ADC accessed with its RCC clock off/.test(a)));
  });

  it('TIM14 enabled via APBENR2 bit 15; gated without it', () => {
    const on = board(attachStm32G0);
    on.w(APBENR2, 1 << 15);
    on.w(TIM14 + 0x2c, 1234);
    assert.equal(on.r(TIM14 + 0x2c), 1234);
    assert.deepEqual(on.b.rcc.gatedAccesses, []);
    const off = board(attachStm32G0);
    off.w(APBENR2, 1 << 14);
    off.w(TIM14 + 0x2c, 1234);
    assert.notEqual(off.r(TIM14 + 0x2c), 1234);
    assert.ok(off.b.rcc.gatedAccesses.some((a) => /TIM14 accessed with its RCC clock off/.test(a)));
  });
});

describe('STM32F0 RCC unchanged', () => {
  it('reads 0 at 0x40 when unwritten', () => {
    assert.equal(board(attachStm32F0).r(APBENR2), 0);
  });
  it('USART1 via APB2ENR bit 14 transmits; without it gated', () => {
    const on = board(attachStm32F0);
    on.w(APB2ENR, 1 << 14);
    on.sendHi();
    assert.deepEqual(on.bytes, [0x48, 0x69]);
    assert.deepEqual(on.b.rcc.gatedAccesses, []);
    const off = board(attachStm32F0);
    off.sendHi();
    assert.deepEqual(off.bytes, []);
    assert.ok(off.b.rcc.gatedAccesses.some((a) => /USART1 accessed with its RCC clock off/.test(a)));
  });
  it('ADC via APB2ENR bit 9 and TIM14 via APB1ENR bit 8', () => {
    const t = board(attachStm32F0);
    t.w(APB2ENR, 1 << 9); t.w(APB1ENR, 1 << 8);
    t.w(ADC + 0x28, 1 << 3); t.w(TIM14 + 0x2c, 77);
    assert.equal(t.r(ADC + 0x28), 1 << 3);
    assert.equal(t.r(TIM14 + 0x2c), 77);
    assert.deepEqual(t.b.rcc.gatedAccesses, []);
  });
});
