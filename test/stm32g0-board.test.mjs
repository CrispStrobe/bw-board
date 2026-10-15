// STM32G030 board contract test: real -mcpu=cortex-m0plus firmware
// running on CortexM0Machine (64 MHz, 8K SRAM, 64K Flash) with RCC_IOPENR,
// RCC_APBENR1, GPIOA/B/C, TIM3 ms timebase, USART1, ADC, and TIM14.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CortexM0Machine } from '../src/cortex-m0-machine.js';
import {
  Stm32Rcc,
  Stm32Gpio,
  Stm32Tim3,
  Stm32Tim14,
  Stm32Adc,
  Stm32Usart1,
  attachStm32F0,
  attachStm32G0,
} from '../src/stm32f0-board.js';
import { createStm32G0Adapter, STM32G0_PINS } from '../src/stm32-adapter.js';

let hasGcc = false;
try { execFileSync('arm-none-eabi-gcc', ['--version'], { stdio: 'pipe' }); hasGcc = true; } catch { /* skip */ }

const LD = `ENTRY(main)
MEMORY { FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 64K
         RAM  (rwx): ORIGIN = 0x20000000, LENGTH = 8K }
SECTIONS {
  .text : { KEEP(*(.vectors)) *(.text*) *(.rodata*) } > FLASH
  .bss  : { *(.bss*) *(COMMON) } > RAM
}
`;

function compileG0Firmware (cSource) {
  const dir = mkdtempSync(join(tmpdir(), 'bw-g0fw-'));
  writeFileSync(join(dir, 'main.c'), cSource);
  writeFileSync(join(dir, 'link.ld'), LD);
  execFileSync('arm-none-eabi-gcc', [
    '-mcpu=cortex-m0plus', '-mthumb', '-Os', '-ffreestanding',
    '-nostdlib', `-T${join(dir, 'link.ld')}`, '-o', join(dir, 'fw.elf'),
    join(dir, 'main.c'), '-lgcc',
  ], { stdio: 'pipe' });
  execFileSync('arm-none-eabi-objcopy', ['-O', 'binary', join(dir, 'fw.elf'), join(dir, 'fw.bin')], { stdio: 'pipe' });
  return readFileSync(join(dir, 'fw.bin'));
}

const BLINK_FIRMWARE = `
#include <stdint.h>
#define BW_MMIO(a) (*(volatile uint32_t *)(a))
#define RCC_IOPENR   BW_MMIO(0x40021034u)
#define RCC_APBENR1  BW_MMIO(0x4002103cu)
#define RCC_APB2ENR  BW_MMIO(0x40021018u)
#define GPIOA_MODER  BW_MMIO(0x48000000u)
#define GPIOA_PUPDR  BW_MMIO(0x4800000cu)
#define GPIOA_IDR    BW_MMIO(0x48000010u)
#define GPIOA_BSRR   BW_MMIO(0x48000018u)
#define GPIOC_MODER  BW_MMIO(0x48000800u)
#define GPIOC_BSRR   BW_MMIO(0x48000818u)
#define TIM3_CR1     BW_MMIO(0x40000400u)
#define TIM3_DIER    BW_MMIO(0x4000040cu)
#define TIM3_SR      BW_MMIO(0x40000410u)
#define TIM3_PSC     BW_MMIO(0x40000428u)
#define TIM3_ARR     BW_MMIO(0x4000042cu)
#define USART1_CR1   BW_MMIO(0x40013800u)
#define USART1_TDR   BW_MMIO(0x40013828u)
#define NVIC_ISER    BW_MMIO(0xe000e100u)

static volatile uint32_t bw_ms;
void tim3_irq(void) { TIM3_SR = 0; bw_ms++; }

int main(void)
{
    RCC_IOPENR  = (1u << 0) | (1u << 2);   /* GPIOA + GPIOC clock */
    RCC_APBENR1 = (1u << 1);               /* TIM3 clock */
    RCC_APB2ENR = (1u << 14);              /* USART1 clock */
    GPIOA_MODER = (1u << 0);               /* PA0 output; PA1 input */
    GPIOA_PUPDR = (1u << 2);               /* PA1 pull-up */
    GPIOC_MODER = (1u << 28);              /* PC14 output */
    TIM3_PSC = 64000000u / 1000000u - 1u;  /* 1 MHz count from 64 MHz */
    TIM3_ARR = 999u;                      /* update every 1 ms */
    TIM3_DIER = 1u;                       /* UIE: interrupt enable */
    TIM3_CR1 = 1u;                        /* CEN */
    NVIC_ISER = (1u << 16);               /* TIM3 = IRQ16 on Cortex-M0+ */
    USART1_CR1 = 1u;                      /* UE */
    USART1_TDR = 'G'; USART1_TDR = '0';
    uint32_t last = 0;
    for (;;) {
        if (bw_ms != last && (bw_ms % 500u) == 0u) {
            last = bw_ms;
            if ((bw_ms / 500u) & 1u) {
                GPIOA_BSRR = 1u;                   /* PA0 set */
                GPIOC_BSRR = (1u << 14);           /* PC14 set */
            } else {
                GPIOA_BSRR = (1u << 16);          /* PA0 reset */
                GPIOC_BSRR = (1u << (14 + 16));   /* PC14 reset */
            }
            if (!(GPIOA_IDR & (1u << 1))) USART1_TDR = 'B';
        }
        __asm__ volatile ("wfi");
    }
}
__attribute__((section(".vectors"), used))
const void *bw_vectors[48] = {
    (void *)0x20002000,                    /* SP = top of 8K SRAM */
    (void *)main,
    [16 + 16] = (void *)tim3_irq,          /* TIM3 = IRQ16 */
};
`;

let blinkBinCache = null;
function getBlinkBin () {
  if (!blinkBinCache) blinkBinCache = compileG0Firmware(BLINK_FIRMWARE);
  return blinkBinCache;
}

describe('STM32G030 board live firmware execution', { skip: !hasGcc }, () => {
  it('blinks PA0 and PC14 on the 500 ms grid at 64 MHz, WFI-parked between ticks', () => {
    const bin = getBlinkBin();
    const machine = new CortexM0Machine({ clockHz: 64_000_000, sramBytes: 8192, flashBytes: 64 * 1024 });
    const pa0Edges = [];
    const pc14Edges = [];
    attachStm32G0(machine, {
      onPinChange: (pin, mode, high) => {
        if (pin === 'PA0') pa0Edges.push({ high, tMs: Number(machine.timeNs()) / 1e6 });
        if (pin === 'PC14') pc14Edges.push({ high, tMs: Number(machine.timeNs()) / 1e6 });
      },
    });
    machine.loadFirmware(bin);

    // Advance 1.6 seconds
    machine.advanceNs(1_600_000_000n);

    // Filter toggles occurring during the blink loop (ignoring initial setup at t=0)
    const pa0Toggles = pa0Edges.filter(e => e.tMs >= 100);
    const pc14Toggles = pc14Edges.filter(e => e.tMs >= 100);

    assert.ok(pa0Toggles.length >= 3, `counted ${pa0Toggles.length} PA0 blink toggles`);
    assert.equal(pa0Toggles[0].high, true);
    assert.equal(Math.round(pa0Toggles[0].tMs), 500);
    assert.equal(pa0Toggles[1].high, false);
    assert.equal(Math.round(pa0Toggles[1].tMs), 1000);
    assert.equal(pa0Toggles[2].high, true);
    assert.equal(Math.round(pa0Toggles[2].tMs), 1500);

    assert.ok(pc14Toggles.length >= 3, `counted ${pc14Toggles.length} PC14 blink toggles`);
    assert.equal(pc14Toggles[0].high, true);
    assert.equal(Math.round(pc14Toggles[0].tMs), 500);

    assert.ok(Number(machine.stats.sleptNs) / 1.6e9 > 0.9,
      `parked between ticks (${(Number(machine.stats.sleptNs) / 1.6e7).toFixed(1)}% slept)`);
  });

  it('serial says G0, and button stays quiet until pressed', () => {
    const bin = getBlinkBin();
    const machine = new CortexM0Machine({ clockHz: 64_000_000, sramBytes: 8192, flashBytes: 64 * 1024 });
    const serial = [];
    const { gpioA } = attachStm32G0(machine, {
      onSerialByte: (b) => serial.push(String.fromCharCode(b)),
    });
    machine.loadFirmware(bin);

    // Initial 400 ms: boots, says 'G0'
    machine.advanceNs(400_000_000n);
    assert.equal(serial.join(''), 'G0');

    // Button pressed (active low: PA1 = 0) at 600 ms
    gpioA.setInput(1, false);
    machine.advanceNs(700_000_000n); // reaches 1.1s (advances past 1000ms check)
    assert.ok(serial.includes('B'), 'button echo received');
  });

  it('the two honesty ledgers are empty for clean STM32G0 firmware', () => {
    const bin = getBlinkBin();
    const machine = new CortexM0Machine({ clockHz: 64_000_000, sramBytes: 8192, flashBytes: 64 * 1024 });
    const { rcc } = attachStm32G0(machine);
    machine.loadFirmware(bin);
    machine.advanceNs(100_000_000n);

    assert.deepEqual(machine.unmapped, [], 'zero unmapped accesses');
    assert.deepEqual(rcc.gatedAccesses, [], 'zero clock-gated accesses');
  });

  it('the classroom bug is caught: without RCC_IOPENR, ledger records the violation', () => {
    const BAD_FIRMWARE = BLINK_FIRMWARE.replace('RCC_IOPENR  = (1u << 0) | (1u << 2);', '/* no clock */');
    const bin = compileG0Firmware(BAD_FIRMWARE);
    const machine = new CortexM0Machine({ clockHz: 64_000_000, sramBytes: 8192, flashBytes: 64 * 1024 });
    const { rcc } = attachStm32G0(machine);
    machine.loadFirmware(bin);
    machine.advanceNs(10_000_000n);

    assert.ok(rcc.gatedAccesses.some(a => /GPIOA accessed with its RCC clock off/.test(a)),
      'ledger caught unclocked GPIOA access');
  });

  it('multi-pin chase on PA0, PA1, PA4, PC14, PC15 via BSRR atomic writes', () => {
    const CHASE_SRC = `
#include <stdint.h>
#define BW_MMIO(a) (*(volatile uint32_t *)(a))
#define RCC_IOPENR   BW_MMIO(0x40021034u)
#define RCC_APBENR1  BW_MMIO(0x4002103cu)
#define GPIOA_MODER  BW_MMIO(0x48000000u)
#define GPIOA_BSRR   BW_MMIO(0x48000018u)
#define GPIOC_MODER  BW_MMIO(0x48000800u)
#define GPIOC_BSRR   BW_MMIO(0x48000818u)
#define TIM3_CR1     BW_MMIO(0x40000400u)
#define TIM3_DIER    BW_MMIO(0x4000040cu)
#define TIM3_SR      BW_MMIO(0x40000410u)
#define TIM3_PSC     BW_MMIO(0x40000428u)
#define TIM3_ARR     BW_MMIO(0x4000042cu)
#define NVIC_ISER    BW_MMIO(0xe000e100u)

static volatile uint32_t step;
void tim3_irq(void) { TIM3_SR = 0; step++; }

int main(void) {
    RCC_IOPENR = (1u << 0) | (1u << 2); /* GPIOA + GPIOC */
    RCC_APBENR1 = (1u << 1);            /* TIM3 */
    /* PA0, PA1, PA4 as outputs: bits 0, 2, 8 */
    GPIOA_MODER = (1u << 0) | (1u << 2) | (1u << 8);
    /* PC14, PC15 as outputs: bits 28, 30 */
    GPIOC_MODER = (1u << 28) | (1u << 30);
    TIM3_PSC = 63u; /* 1 MHz count from 64 MHz */
    TIM3_ARR = 9999u; /* 10 ms update */
    TIM3_DIER = 1u;
    TIM3_CR1 = 1u;
    NVIC_ISER = (1u << 16);

    uint32_t last = 0;
    for (;;) {
        if (step != last) {
            last = step;
            switch (step % 5u) {
                case 1: GPIOA_BSRR = (1u << 0) | (1u << (1+16)) | (1u << (4+16)); break;
                case 2: GPIOA_BSRR = (1u << 1) | (1u << (0+16)); break;
                case 3: GPIOA_BSRR = (1u << 4) | (1u << (1+16)); break;
                case 4: GPIOC_BSRR = (1u << 14); GPIOA_BSRR = (1u << (4+16)); break;
                case 0: GPIOC_BSRR = (1u << 15) | (1u << (14+16)); break;
            }
        }
        __asm__ volatile ("wfi");
    }
}
__attribute__((section(".vectors"), used))
const void *bw_vectors[48] = {
    (void *)0x20002000,
    (void *)main,
    [16 + 16] = (void *)tim3_irq,
};
`;
    const bin = compileG0Firmware(CHASE_SRC);
    const machine = new CortexM0Machine({ clockHz: 64_000_000, sramBytes: 8192, flashBytes: 64 * 1024 });
    const transitions = [];
    const lastLevels = {};
    attachStm32G0(machine, {
      onPinChange: (pin, mode, high) => {
        if (lastLevels[pin] !== high) {
          lastLevels[pin] = high;
          transitions.push({ pin, high, tMs: Number(machine.timeNs()) / 1e6 });
        }
      },
    });
    machine.loadFirmware(bin);
    machine.advanceNs(60_000_000n); // 60 ms: spans 5 chase steps

    const pa0 = transitions.filter(e => e.pin === 'PA0' && e.tMs >= 5);
    const pa1 = transitions.filter(e => e.pin === 'PA1' && e.tMs >= 5);
    const pa4 = transitions.filter(e => e.pin === 'PA4' && e.tMs >= 5);
    const pc14 = transitions.filter(e => e.pin === 'PC14' && e.tMs >= 5);
    const pc15 = transitions.filter(e => e.pin === 'PC15' && e.tMs >= 5);

    assert.ok(pa0.length >= 2, 'PA0 toggled');
    assert.ok(pa1.length >= 2, 'PA1 toggled');
    assert.ok(pa4.length >= 2, 'PA4 toggled');
    assert.ok(pc14.length >= 2, 'PC14 toggled');
    assert.ok(pc15.length >= 1, 'PC15 toggled');

    assert.equal(pa0[0].high, true, 'PA0 high at step 1');
    assert.equal(Math.round(pa0[0].tMs), 10);
    assert.equal(pa1[0].high, true, 'PA1 high at step 2');
    assert.equal(Math.round(pa1[0].tMs), 20);
    assert.equal(pa4[0].high, true, 'PA4 high at step 3');
    assert.equal(Math.round(pa4[0].tMs), 30);
    assert.equal(pc14[0].high, true, 'PC14 high at step 4');
    assert.equal(Math.round(pc14[0].tMs), 40);
    assert.equal(pc15[0].high, true, 'PC15 high at step 5');
    assert.equal(Math.round(pc15[0].tMs), 50);
  });

  it('bidirectional UART echo and character transformation in live firmware', () => {
    const ECHO_SRC = `
#include <stdint.h>
#define BW_MMIO(a) (*(volatile uint32_t *)(a))
#define RCC_APB2ENR  BW_MMIO(0x40021018u)
#define USART1_CR1   BW_MMIO(0x40013800u)
#define USART1_ISR   BW_MMIO(0x4001381cu)
#define USART1_RDR   BW_MMIO(0x40013824u)
#define USART1_TDR   BW_MMIO(0x40013828u)

int main(void) {
    RCC_APB2ENR = (1u << 14); /* USART1 clock */
    USART1_CR1 = 1u;          /* UE: USART enable */
    for (;;) {
        /* Poll RXNE (bit 5) */
        if (USART1_ISR & (1u << 5)) {
            uint32_t b = USART1_RDR;
            /* Convert lowercase to uppercase */
            if (b >= 'a' && b <= 'z') b -= 32;
            USART1_TDR = b;
        }
    }
}
__attribute__((section(".vectors"), used))
const void *bw_vectors[48] = {
    (void *)0x20002000,
    (void *)main,
};
`;
    const bin = compileG0Firmware(ECHO_SRC);
    const machine = new CortexM0Machine({ clockHz: 64_000_000, sramBytes: 8192, flashBytes: 64 * 1024 });
    const output = [];
    const { usart1 } = attachStm32G0(machine, {
      onSerialByte: (b) => output.push(String.fromCharCode(b)),
    });
    machine.loadFirmware(bin);

    // Feed 'hello world!'
    for (const ch of 'hello world!') {
      usart1.feed(ch.charCodeAt(0));
      machine.advanceNs(10_000_000n);
    }
    assert.equal(output.join(''), 'HELLO WORLD!');
  });

  it('recursive Fibonacci computation testing ARMv6-M stack in SRAM and serial report', () => {
    const FIB_SRC = `
#include <stdint.h>
#define BW_MMIO(a) (*(volatile uint32_t *)(a))
#define RCC_APB2ENR  BW_MMIO(0x40021018u)
#define USART1_CR1   BW_MMIO(0x40013800u)
#define USART1_TDR   BW_MMIO(0x40013828u)

__attribute__((noinline))
static uint32_t fib(uint32_t n) {
    if (n <= 1) return n;
    return fib(n - 1) + fib(n - 2);
}

int main(void) {
    RCC_APB2ENR = (1u << 14); /* USART1 clock */
    USART1_CR1 = 1u;          /* UE */
    /* fib(10) = 55. 55 is ASCII '7' */
    uint32_t result = fib(10);
    USART1_TDR = (uint8_t)result;
    for (;;) { __asm__ volatile ("wfi"); }
}
__attribute__((section(".vectors"), used))
const void *bw_vectors[48] = {
    (void *)0x20002000,
    (void *)main,
};
`;
    const bin = compileG0Firmware(FIB_SRC);
    const machine = new CortexM0Machine({ clockHz: 64_000_000, sramBytes: 8192, flashBytes: 64 * 1024 });
    const serial = [];
    attachStm32G0(machine, {
      onSerialByte: (b) => serial.push(b),
    });
    machine.loadFirmware(bin);
    machine.advanceNs(5_000_000n);

    assert.deepEqual(serial, [55], 'recursive fib(10) = 55 returned via USART1');
    assert.deepEqual(machine.unmapped, [], 'zero unmapped accesses during stack recursion');
  });

  it('TIM3 PWM mode 1 output on PA6 (CH1) and PA7 (CH2) at 64 MHz', () => {
    const PWM_SRC = `
#include <stdint.h>
#define BW_MMIO(a) (*(volatile uint32_t *)(a))
#define RCC_IOPENR   BW_MMIO(0x40021034u)
#define RCC_APBENR1  BW_MMIO(0x4002103cu)
#define GPIOA_MODER  BW_MMIO(0x48000000u)
#define TIM3_CR1     BW_MMIO(0x40000400u)
#define TIM3_PSC     BW_MMIO(0x40000428u)
#define TIM3_ARR     BW_MMIO(0x4000042cu)
#define TIM3_CCMR1   BW_MMIO(0x40000418u)
#define TIM3_CCER    BW_MMIO(0x40000420u)
#define TIM3_CCR1    BW_MMIO(0x40000434u)
#define TIM3_CCR2    BW_MMIO(0x40000438u)

int main(void) {
    RCC_IOPENR = (1u << 0);   /* GPIOA */
    RCC_APBENR1 = (1u << 1);  /* TIM3 */
    /* PA6 and PA7 in alternate function mode (AF): bits 13:12=10, 15:14=10 */
    GPIOA_MODER = (2u << 12) | (2u << 14);
    TIM3_PSC = 63u;           /* 1 MHz tick rate from 64 MHz */
    TIM3_ARR = 999u;          /* 1 kHz period (1000 µs) */
    /* PWM mode 1 on CH1 (bits 6:4 = 110b = 6) and CH2 (bits 14:12 = 110b = 6) */
    TIM3_CCMR1 = (6u << 4) | (6u << 12);
    TIM3_CCR1 = 250u;         /* 25% duty cycle (250 µs high) */
    TIM3_CCR2 = 750u;         /* 75% duty cycle (750 µs high) */
    TIM3_CCER = (1u << 0) | (1u << 4); /* CC1E | CC2E: enable compare outputs */
    TIM3_CR1 = 1u;            /* CEN: enable counter */
    for (;;) { __asm__ volatile ("wfi"); }
}
__attribute__((section(".vectors"), used))
const void *bw_vectors[48] = {
    (void *)0x20002000,
    (void *)main,
};
`;
    const bin = compileG0Firmware(PWM_SRC);
    const machine = new CortexM0Machine({ clockHz: 64_000_000, sramBytes: 8192, flashBytes: 64 * 1024 });
    const pa6Edges = [];
    const pa7Edges = [];
    attachStm32G0(machine, {
      onPinChange: (pin, mode, high) => {
        if (pin === 'PA6') pa6Edges.push({ high, tUs: Number(machine.timeNs()) / 1000 });
        if (pin === 'PA7') pa7Edges.push({ high, tUs: Number(machine.timeNs()) / 1000 });
      },
    });
    machine.loadFirmware(bin);
    machine.advanceNs(3_000_000n); // 3 ms: spans 3 complete PWM cycles

    assert.ok(pa6Edges.length >= 4, `PA6 edges count: ${pa6Edges.length}`);
    assert.ok(pa7Edges.length >= 4, `PA7 edges count: ${pa7Edges.length}`);
    // Check that PA6 drops low at ~250 µs and re-raises at ~1000 µs
    const pa6Low = pa6Edges.find(e => !e.high && e.tUs >= 200 && e.tUs <= 300);
    assert.ok(pa6Low, 'PA6 transitions low at ~250 us');
    assert.ok(Math.abs((pa6Low.tUs % 1000) - 250) <= 2, `PA6 low at expected duty threshold (${pa6Low.tUs % 1000} us)`);

    // Check that PA7 drops low at ~750 µs
    const pa7Low = pa7Edges.find(e => !e.high && e.tUs >= 700 && e.tUs <= 800);
    assert.ok(pa7Low, 'PA7 transitions low at ~750 us');
    assert.ok(Math.abs((pa7Low.tUs % 1000) - 750) <= 2, `PA7 low at expected duty threshold (${pa7Low.tUs % 1000} us)`);
  });

  it('ADC analog conversion with EOC polling and serial output', () => {
    const ADC_SRC = `
#include <stdint.h>
#define BW_MMIO(a) (*(volatile uint32_t *)(a))
#define RCC_APB2ENR  BW_MMIO(0x40021018u)
#define USART1_CR1   BW_MMIO(0x40013800u)
#define USART1_TDR   BW_MMIO(0x40013828u)
#define ADC_ISR      BW_MMIO(0x40012400u)
#define ADC_CR       BW_MMIO(0x40012408u)
#define ADC_CHSELR   BW_MMIO(0x40012428u)
#define ADC_DR       BW_MMIO(0x40012440u)

int main(void) {
    RCC_APB2ENR = (1u << 14) | (1u << 9); /* USART1 + ADC clock */
    USART1_CR1 = 1u;                      /* UE */
    ADC_CR = 1u;                          /* ADEN */
    ADC_CHSELR = (1u << 0);               /* Channel 0 (PA0) */
    for (;;) {
        ADC_CR = (1u << 2);               /* ADSTART */
        while (!(ADC_ISR & (1u << 2)));  /* wait EOC */
        uint32_t val = ADC_DR;            /* clears EOC */
        if (val >= 2048u) USART1_TDR = 'H';
        else USART1_TDR = 'L';
        for (volatile int i = 0; i < 5000; i++);
    }
}
__attribute__((section(".vectors"), used))
const void *bw_vectors[48] = {
    (void *)0x20002000,
    (void *)main,
};
`;
    const bin = compileG0Firmware(ADC_SRC);
    const machine = new CortexM0Machine({ clockHz: 64_000_000, sramBytes: 8192, flashBytes: 64 * 1024 });
    const serial = [];
    let analogVolts = 3.0; // Initial 3.0V -> counts ~3723 >= 2048 -> 'H'
    attachStm32G0(machine, {
      onSerialByte: (b) => serial.push(String.fromCharCode(b)),
      onAnalogRead: (ch) => (ch === 0 ? analogVolts : 0),
    });
    machine.loadFirmware(bin);

    machine.advanceNs(10_000_000n);
    assert.ok(serial.length > 0, 'samples produced');
    assert.ok(serial.every(ch => ch === 'H'), 'all samples high voltage');

    // Switch input voltage to 0.5V -> counts ~620 < 2048 -> 'L'
    analogVolts = 0.5;
    serial.length = 0;
    machine.advanceNs(10_000_000n);
    assert.ok(serial.length > 0, 'low samples produced');
    assert.ok(serial.every(ch => ch === 'L'), 'all samples low voltage');
  });

  it('unmapped flash and sram accesses are honestly recorded in machine.unmapped', () => {
    const UNMAPPED_SRC = `
#include <stdint.h>
#define BW_MMIO(a) (*(volatile uint32_t *)(a))
int main(void) {
    /* Read unmapped flash at 0x08020000 (G030 has 64K flash ending at 0x0800ffff) */
    volatile uint32_t x = BW_MMIO(0x08020000u);
    /* Write unmapped SRAM at 0x20003000 (G030 has 8K SRAM ending at 0x20001fff) */
    BW_MMIO(0x20003000u) = x + 1u;
    /* Read unmapped peripheral range */
    volatile uint32_t y = BW_MMIO(0x40030000u);
    (void)y;
    for (;;) { __asm__ volatile ("wfi"); }
}
__attribute__((section(".vectors"), used))
const void *bw_vectors[48] = {
    (void *)0x20002000,
    (void *)main,
};
`;
    const bin = compileG0Firmware(UNMAPPED_SRC);
    const machine = new CortexM0Machine({ clockHz: 64_000_000, sramBytes: 8192, flashBytes: 64 * 1024 });
    attachStm32G0(machine);
    machine.loadFirmware(bin);
    machine.advanceNs(1_000_000n);

    assert.ok(machine.unmapped.some(u => u.addr === 0x08020000), 'unmapped flash access recorded');
    assert.ok(machine.unmapped.some(u => u.addr === 0x20003000), 'unmapped sram access recorded');
    assert.ok(machine.unmapped.some(u => u.addr === 0x40030000), 'unmapped peripheral access recorded');
  });

  it('missing clock enables for GPIOB, GPIOC, TIM3, and USART1 caught in rcc.gatedAccesses', () => {
    const GATED_SRC = `
#include <stdint.h>
#define BW_MMIO(a) (*(volatile uint32_t *)(a))
#define GPIOB_MODER BW_MMIO(0x48000400u)
#define GPIOC_MODER BW_MMIO(0x48000800u)
#define TIM3_CR1    BW_MMIO(0x40000400u)
#define USART1_CR1  BW_MMIO(0x40013800u)

int main(void) {
    /* Touch peripherals without setting RCC clocks */
    GPIOB_MODER = 1u;
    GPIOC_MODER = 1u;
    TIM3_CR1 = 1u;
    USART1_CR1 = 1u;
    for (;;) { __asm__ volatile ("wfi"); }
}
__attribute__((section(".vectors"), used))
const void *bw_vectors[48] = {
    (void *)0x20002000,
    (void *)main,
};
`;
    const bin = compileG0Firmware(GATED_SRC);
    const machine = new CortexM0Machine({ clockHz: 64_000_000, sramBytes: 8192, flashBytes: 64 * 1024 });
    const { rcc } = attachStm32G0(machine);
    machine.loadFirmware(bin);
    machine.advanceNs(1_000_000n);

    assert.ok(rcc.gatedAccesses.some(a => /GPIOB/.test(a)), 'GPIOB gated access caught');
    assert.ok(rcc.gatedAccesses.some(a => /GPIOC/.test(a)), 'GPIOC gated access caught');
    assert.ok(rcc.gatedAccesses.some(a => /TIM3/.test(a)), 'TIM3 gated access caught');
    assert.ok(rcc.gatedAccesses.some(a => /USART1/.test(a)), 'USART1 gated access caught');
  });
});

describe('STM32 peripheral unit tests', () => {
  it('Stm32Rcc: register reads/writes and peripheral gating queries', () => {
    const rcc = new Stm32Rcc();
    assert.equal(rcc.read(0x00), 0x0200_0002 | 0x0100_0000, 'CR reports HSI+PLL ready');
    assert.equal(rcc.read(0x04), 0, 'CFGR reset value 0');

    // Test G0 IOPENR (0x34) and APBENR1 (0x3C)
    assert.equal(rcc.gpioEnabled(0), false);
    assert.equal(rcc.gpioEnabled(1), false);
    assert.equal(rcc.gpioEnabled(2), false);
    assert.equal(rcc.tim3Enabled(), false);

    rcc.write(0x34, (1 << 0) | (1 << 2)); // GPIOA and GPIOC
    assert.equal(rcc.read(0x34), 5);
    assert.equal(rcc.gpioEnabled(0), true);
    assert.equal(rcc.gpioEnabled(1), false);
    assert.equal(rcc.gpioEnabled(2), true);

    rcc.write(0x3c, (1 << 1)); // TIM3 on APBENR1
    assert.equal(rcc.read(0x3c), 2);
    assert.equal(rcc.tim3Enabled(), true);

    // Test F0 compatibility: AHBENR (0x14) and APB1ENR (0x1C)
    rcc.write(0x14, (1 << 18)); // GPIOB
    assert.equal(rcc.gpioEnabled(1), true);

    // APB2ENR (0x18): USART1 bit 14, ADC bit 9
    assert.equal(rcc.usart1Enabled(), 0);
    assert.equal(rcc.adcEnabled(), 0);
    rcc.write(0x18, (1 << 14) | (1 << 9));
    assert.equal(rcc.usart1Enabled(), 1);
    assert.equal(rcc.adcEnabled(), 1);

    rcc.noteGated('test violation');
    assert.deepEqual(rcc.gatedAccesses, ['test violation']);
  });

  it('Stm32Gpio: MODER, OTYPER, PUPDR, IDR, ODR, and BSRR atomic manipulation', () => {
    const rcc = new Stm32Rcc();
    rcc.write(0x34, 1); // enable GPIOA
    const published = [];
    const gpio = new Stm32Gpio({
      base: 0x48000000,
      portIndex: 0,
      portLetter: 'A',
      rcc,
      onPinChange: (pin, mode, high) => published.push({ pin, mode, high }),
    });

    // Initial state: input floating
    assert.equal(gpio.read(0x00), 0, 'MODER=0');
    assert.equal(gpio.read(0x14), 0, 'ODR=0');

    // Configure PA0 and PA1 as outputs (MODER bits 1:0 = 1, bits 3:2 = 1)
    gpio.write(0x00, 1 | (1 << 2));
    assert.equal(gpio.read(0x00), 5);
    assert.ok(published.some(p => p.pin === 'PA0' && p.mode === 'pushpull' && p.high === false));

    // Atomic set PA0 via BSRR low half
    published.length = 0;
    gpio.write(0x18, 1); // set PA0
    assert.equal(gpio.read(0x14) & 1, 1, 'ODR bit 0 set');
    assert.equal(gpio.read(0x10) & 1, 1, 'IDR reads back ODR bit 0');
    assert.ok(published.some(p => p.pin === 'PA0' && p.high === true));

    // Atomic reset PA0 via BSRR high half
    published.length = 0;
    gpio.write(0x18, 1 << 16); // reset PA0
    assert.equal(gpio.read(0x14) & 1, 0, 'ODR bit 0 reset');
    assert.ok(published.some(p => p.pin === 'PA0' && p.high === false));

    // Simultaneous set bit 0 and reset bit 1
    gpio.write(0x14, 2); // set bit 1 in ODR first
    assert.equal(gpio.read(0x14) & 3, 2);
    gpio.write(0x18, 1 | (1 << (1 + 16))); // set bit 0, reset bit 1
    assert.equal(gpio.read(0x14) & 1, 1, 'bit 0 set');
    assert.equal(gpio.read(0x14) & 2, 0, 'bit 1 reset');

    // Open-drain mode via OTYPER
    published.length = 0;
    gpio.write(0x04, 1); // PA0 open-drain
    assert.ok(published.some(p => p.pin === 'PA0' && p.mode === 'opendrain'));

    // Open-drain with internal pull-up -> quasi mode
    published.length = 0;
    gpio.write(0x0c, 1); // PUPDR PA0 pull-up
    assert.ok(published.some(p => p.pin === 'PA0' && p.mode === 'quasi'));

    // PA2 as input with pull-up
    published.length = 0;
    gpio.write(0x00, 1); // PA2 returns to input mode
    gpio.write(0x0c, 1 | (1 << 4)); // PA2 pull-up
    assert.ok(published.some(p => p.pin === 'PA2' && p.mode === 'input-pullup'));
    // Undriven input with pull-up reads 1 in IDR
    assert.equal((gpio.read(0x10) >>> 2) & 1, 1, 'undriven pull-up reads 1 in IDR');

    // External driver asserts 0 on PA2
    gpio.setInput(2, false);
    assert.equal((gpio.read(0x10) >>> 2) & 1, 0, 'driven low reads 0 in IDR');

    // External driver releases PA2 -> returns to pull-up level 1
    gpio.releaseInput(2);
    assert.equal((gpio.read(0x10) >>> 2) & 1, 1, 'released returns to pull-up');
  });

  it('Stm32Tim3: prescaler, auto-reload, UIF flag, and PWM calculation', () => {
    const rcc = new Stm32Rcc();
    rcc.write(0x3c, 2); // enable TIM3 on APBENR1
    let irqRaised = false;
    const fakeMachine = {
      setIrq: (irq, active) => { if (irq === 16) irqRaised = active; },
    };
    const pwmChanges = [];
    const tim3 = new Stm32Tim3({
      rcc,
      clockHz: 64_000_000,
      onPinChange: (pin, mode, high) => pwmChanges.push({ pin, mode, high }),
    });

    tim3.write(0x28, 63);  // PSC = 63 (1 MHz tick rate from 64 MHz)
    tim3.write(0x2c, 999); // ARR = 999 (1000 ticks = 1 ms period)
    tim3.write(0x0c, 1);   // DIER.UIE = 1
    tim3.write(0x00, 1);   // CR1.CEN = 1

    assert.equal(tim3.read(0x28), 63);
    assert.equal(tim3.read(0x2c), 999);
    assert.equal(tim3.read(0x00), 1);
    assert.equal(tim3.read(0x10), 0, 'SR initially 0');

    // Advance 500 µs: CNT reaches 500, no UIF yet
    tim3.advanceNs(500_000, fakeMachine);
    assert.equal(tim3.read(0x24), 500, 'CNT is 500');
    assert.equal(tim3.read(0x10) & 1, 0, 'UIF not set');
    assert.equal(irqRaised, false);

    // Advance another 500 µs: CNT reaches 999 then wraps to 0, UIF sets, IRQ raised
    tim3.advanceNs(500_000, fakeMachine);
    assert.equal(tim3.read(0x24), 0, 'CNT wrapped to 0');
    assert.equal(tim3.read(0x10) & 1, 1, 'UIF set in SR');
    assert.equal(irqRaised, true, 'IRQ16 raised');

    // rc_w0: writing 0 clears UIF
    tim3.write(0x10, 0);
    assert.equal(tim3.read(0x10) & 1, 0, 'UIF cleared');
    tim3.advanceNs(0, fakeMachine); // refresh IRQ line
    assert.equal(irqRaised, false, 'IRQ16 cleared');

    // EGR.UG resets CNT to 0
    tim3.advanceNs(300_000, fakeMachine);
    assert.equal(tim3.read(0x24), 300);
    tim3.write(0x14, 1); // EGR.UG
    assert.equal(tim3.read(0x24), 0, 'CNT reset by UG');
  });

  it('Stm32Adc: sequence, ADRDY, ADSTART, EOC, DR read clear, and clamping', () => {
    const rcc = new Stm32Rcc();
    rcc.write(0x18, (1 << 9)); // enable ADC
    let currentVolts = 1.65;
    const adc = new Stm32Adc({
      rcc,
      onAnalogRead: () => currentVolts,
      onTemperature: () => 1.43,
      vref: 3.3,
    });

    // ADEN -> ADRDY
    adc.write(0x08, 1); // CR.ADEN
    assert.equal(adc.read(0x00) & 1, 1, 'ISR.ADRDY set');

    // Select channel 0 and trigger conversion
    adc.write(0x28, 1); // CHSELR = ch0
    adc.write(0x08, 1 | (1 << 2)); // CR.ADSTART
    assert.equal((adc.read(0x00) >>> 2) & 1, 1, 'ISR.EOC set');

    // Read DR: 1.65V / 3.3V * 4095 = 2048
    const counts = adc.read(0x40);
    assert.equal(counts, 2048, 'half-scale counts');
    assert.equal((adc.read(0x00) >>> 2) & 1, 0, 'reading DR clears EOC');

    // Clamping: voltage above vref (4.0V) clamps to 4095
    currentVolts = 4.0;
    adc.write(0x08, 1 | (1 << 2));
    assert.equal(adc.read(0x40), 4095, 'clamped to 4095');

    // Clamping: negative voltage (-1.0V) clamps to 0
    currentVolts = -1.0;
    adc.write(0x08, 1 | (1 << 2));
    assert.equal(adc.read(0x40), 0, 'clamped to 0');

    // Channel 16: temperature sensor enabled via ADC_CCR.TSEN (bit 23)
    adc.write(0x28, 1 << 16); // CHSELR = ch16
    // Without TSEN, reads 0
    adc.write(0x08, 1 | (1 << 2));
    assert.equal(adc.read(0x40), 0, 'TSEN=0 reads 0V');

    // With TSEN (CCR bit 23 = 1)
    adc.write(0x308, 1 << 23);
    adc.write(0x08, 1 | (1 << 2));
    const tempCounts = adc.read(0x40);
    const expectedTempCounts = Math.round((1.43 / 3.3) * 4095);
    assert.equal(tempCounts, expectedTempCounts, 'TSEN=1 reads sensor volts');
  });

  it('Stm32Usart1: CR1.UE gating, TXE/TC/RXNE flags, and FIFO queueing', () => {
    const rcc = new Stm32Rcc();
    rcc.write(0x18, (1 << 14)); // enable USART1
    const bytesOut = [];
    const usart = new Stm32Usart1({
      rcc,
      onByte: (b) => bytesOut.push(b),
    });

    // Write TDR without UE: dropped
    usart.write(0x28, 0x41);
    assert.equal(bytesOut.length, 0, 'TDR write dropped while UE=0');

    // Enable UE (CR1 bit 0)
    usart.write(0x00, 1);
    usart.write(0x28, 0x42);
    assert.deepEqual(bytesOut, [0x42], 'TDR byte dispatched when UE=1');

    // ISR flags: TXE (bit 7) and TC (bit 6) set; RXNE (bit 5) 0
    assert.equal(usart.read(0x1c) & 0xc0, 0xc0, 'TXE and TC set');
    assert.equal(usart.read(0x1c) & 0x20, 0x00, 'RXNE initially 0');

    // Feed bytes into RX FIFO
    usart.feed(0x58);
    usart.feed(0x59);
    assert.equal(usart.read(0x1c) & 0x20, 0x20, 'RXNE set when FIFO has bytes');
    assert.equal(usart.read(0x24), 0x58, 'first byte from RDR');
    assert.equal(usart.read(0x1c) & 0x20, 0x20, 'RXNE still set');
    assert.equal(usart.read(0x24), 0x59, 'second byte from RDR');
    assert.equal(usart.read(0x1c) & 0x20, 0x00, 'RXNE cleared when FIFO empty');
  });
});

describe('STM32G0 boundary-A adapter unit tests', () => {
  it('STM32G0_PINS defines all 28 header pins across GPIOA, GPIOB, and GPIOC', () => {
    const pins = Object.keys(STM32G0_PINS);
    assert.equal(pins.length, 28, 'total 28 G0 pins (16 PA + 10 PB + 2 PC)');

    // PA0-PA15: port 0
    for (let i = 0; i <= 15; i++) {
      const p = STM32G0_PINS[`PA${i}`];
      assert.ok(p, `PA${i} present`);
      assert.equal(p.port, 0);
      assert.equal(p.bit, i);
    }
    // PB0-PB9: port 1
    for (let i = 0; i <= 9; i++) {
      const p = STM32G0_PINS[`PB${i}`];
      assert.ok(p, `PB${i} present`);
      assert.equal(p.port, 1);
      assert.equal(p.bit, i);
    }
    // PC14-PC15: port 2
    assert.equal(STM32G0_PINS.PC14.port, 2);
    assert.equal(STM32G0_PINS.PC14.bit, 14);
    assert.equal(STM32G0_PINS.PC15.port, 2);
    assert.equal(STM32G0_PINS.PC15.bit, 15);
  });

  it('attachBoard seats all 28 pins as input mode at reset', () => {
    const adapter = createStm32G0Adapter();
    const seated = [];
    adapter.attachBoard({
      setPin: (name, mode, high) => seated.push({ name, mode, high }),
      advanceTo: () => {},
      readPin: () => 0,
    });

    assert.equal(seated.length, 28, 'seated all 28 pins');
    for (const p of seated) {
      assert.equal(p.mode, 'input', `${p.name} initialized as input`);
      assert.equal(p.high, false, `${p.name} initialized low`);
    }
  });

  it('output deduping prevents duplicate board setPin calls on identical BSRR writes', () => {
    const adapter = createStm32G0Adapter();
    const changes = [];
    adapter.attachBoard({
      setPin: (name, mode, high) => changes.push({ name, mode, high }),
      advanceTo: () => {},
      readPin: () => 0,
    });
    changes.length = 0; // Clear seating events

    // Enable GPIOA clock and set PA0 as output
    adapter.peripherals.rcc.write(0x34, 1);
    adapter.peripherals.gpioA.write(0x00, 1); // MODER = output
    assert.equal(changes.length, 1);
    assert.equal(changes[0].name, 'PA0');
    assert.equal(changes[0].high, false);

    // Set PA0 high
    changes.length = 0;
    adapter.peripherals.gpioA.write(0x18, 1); // BSRR set bit 0
    assert.equal(changes.length, 1);
    assert.equal(changes[0].name, 'PA0');
    assert.equal(changes[0].high, true);

    // Repeated write of BSRR set bit 0: state unchanged -> NO duplicate call to board.setPin
    changes.length = 0;
    adapter.peripherals.gpioA.write(0x18, 1);
    assert.equal(changes.length, 0, 'duplicate edge suppressed by published map');

    // Reset PA0: state changes -> board.setPin called
    adapter.peripherals.gpioA.write(0x18, 1 << 16);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].high, false);
  });

  it('advanceTo is monotonic and time-first before every pin change', () => {
    const adapter = createStm32G0Adapter();
    const log = [];
    adapter.attachBoard({
      setPin: (name, mode, high) => log.push({ kind: 'setPin', name, high }),
      advanceTo: (tNs) => log.push({ kind: 'advanceTo', tNs }),
      readPin: () => 0,
    });
    log.length = 0;

    adapter.peripherals.rcc.write(0x34, 1);
    adapter.peripherals.gpioA.write(0x00, 1);
    adapter.advanceNs(50_000_000n);
    adapter.peripherals.gpioA.write(0x18, 1); // set PA0
    adapter.advanceNs(50_000_000n);

    let lastTime = -1n;
    for (let i = 0; i < log.length; i++) {
      if (log[i].kind === 'advanceTo') {
        assert.equal(typeof log[i].tNs, 'bigint', 'advanceTo is bigint');
        assert.ok(log[i].tNs >= lastTime, 'advanceTo is monotonic');
        lastTime = log[i].tNs;
      } else if (log[i].kind === 'setPin') {
        assert.ok(i > 0 && log[i - 1].kind === 'advanceTo', 'advanceTo precedes setPin (time-first)');
      }
    }
  });

  it('serial helpers sendSerial, feedSerial, and onSerial integrate with USART1', () => {
    const adapter = createStm32G0Adapter();
    const received = [];
    adapter.onSerial((b) => received.push(b));

    // feedSerial pushes into USART1 RX queue
    adapter.peripherals.rcc.write(0x18, 1 << 14); // USART1 clock
    adapter.peripherals.usart1.write(0x00, 1);     // UE
    adapter.feedSerial(0x43);
    assert.equal(adapter.peripherals.usart1.read(0x24), 0x43);

    // sendSerial supports array and Uint8Array
    adapter.sendSerial([0x44, 0x45]);
    assert.equal(adapter.peripherals.usart1.read(0x24), 0x44);
    assert.equal(adapter.peripherals.usart1.read(0x24), 0x45);

    adapter.sendSerial(new Uint8Array([0x46]));
    assert.equal(adapter.peripherals.usart1.read(0x24), 0x46);
  });

  it('resetToProgram reinitializes SRAM to zeroes and reloads firmware', () => {
    const adapter = createStm32G0Adapter({ program: new Uint8Array([0x00, 0x20, 0x00, 0x20, 0x05, 0x00, 0x00, 0x08]) });
    // Dirty SRAM
    adapter.machine.sram[10] = 0xaa;
    adapter.machine.sram[20] = 0xbb;
    assert.equal(adapter.machine.sram[10], 0xaa);

    adapter.resetToProgram();
    assert.equal(adapter.machine.sram[10], 0x00, 'SRAM cleared');
    assert.equal(adapter.machine.sram[20], 0x00, 'SRAM cleared');
    assert.equal(adapter.machine.flash[0], 0x00, 'flash restored');
    assert.equal(adapter.machine.flash[4], 0x05, 'flash restored');
  });
});
