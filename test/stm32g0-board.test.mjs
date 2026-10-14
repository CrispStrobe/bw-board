// STM32G030 board contract test: real -mcpu=cortex-m0plus firmware
// running on CortexM0Machine (64 MHz, 8K SRAM, 64K Flash) with RCC_IOPENR,
// RCC_APBENR1, GPIOA/B/C and TIM3 ms timebase.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CortexM0Machine } from '../src/cortex-m0-machine.js';
import { attachStm32F0 } from '../src/stm32f0-board.js';
import { createStm32G0Adapter, STM32G0_PINS } from '../src/stm32-adapter.js';

let hasGcc = false;
try { execFileSync('arm-none-eabi-gcc', ['--version'], { stdio: 'pipe' }); hasGcc = true; } catch { /* skip */ }

const FIRMWARE = `
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

const LD = `ENTRY(main)
MEMORY { FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 64K
         RAM  (rwx): ORIGIN = 0x20000000, LENGTH = 8K }
SECTIONS {
  .text : { KEEP(*(.vectors)) *(.text*) *(.rodata*) } > FLASH
  .bss  : { *(.bss*) *(COMMON) } > RAM
}
`;

function buildFirmware () {
  const dir = mkdtempSync(join(tmpdir(), 'bw-g0board-'));
  writeFileSync(join(dir, 'main.c'), FIRMWARE);
  writeFileSync(join(dir, 'link.ld'), LD);
  execFileSync('arm-none-eabi-gcc', [
    '-mcpu=cortex-m0plus', '-mthumb', '-Os', '-ffreestanding',
    '-nostdlib', `-T${join(dir, 'link.ld')}`, '-o', join(dir, 'fw.elf'),
    join(dir, 'main.c'), '-lgcc',
  ], { stdio: 'pipe' });
  execFileSync('arm-none-eabi-objcopy', ['-O', 'binary', join(dir, 'fw.elf'), join(dir, 'fw.bin')], { stdio: 'pipe' });
  return readFileSync(join(dir, 'fw.bin'));
}

describe('STM32G030 board', () => {
  it('blinks PA0 and PC14 on the 500 ms grid at 64 MHz, WFI-parked between ticks', { skip: !hasGcc }, () => {
    const bin = buildFirmware();
    const machine = new CortexM0Machine({ clockHz: 64_000_000, sramBytes: 8192, flashBytes: 64 * 1024 });
    const pa0Edges = [];
    const pc14Edges = [];
    attachStm32F0(machine, {
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

  it('serial says G0, and button stays quiet until pressed', { skip: !hasGcc }, () => {
    const bin = buildFirmware();
    const machine = new CortexM0Machine({ clockHz: 64_000_000, sramBytes: 8192, flashBytes: 64 * 1024 });
    const serial = [];
    const { gpioA } = attachStm32F0(machine, {
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

  it('the two honesty ledgers are empty for clean STM32G0 firmware', { skip: !hasGcc }, () => {
    const bin = buildFirmware();
    const machine = new CortexM0Machine({ clockHz: 64_000_000, sramBytes: 8192, flashBytes: 64 * 1024 });
    const { rcc } = attachStm32F0(machine);
    machine.loadFirmware(bin);
    machine.advanceNs(100_000_000n);

    assert.deepEqual(machine.unmapped, [], 'zero unmapped accesses');
    assert.deepEqual(rcc.gatedAccesses, [], 'zero clock-gated accesses');
  });

  it('the classroom bug is caught: without RCC_IOPENR, ledger records the violation', { skip: !hasGcc }, () => {
    const BAD_FIRMWARE = FIRMWARE.replace('RCC_IOPENR  = (1u << 0) | (1u << 2);', '/* no clock */');
    const dir = mkdtempSync(join(tmpdir(), 'bw-g0bad-'));
    writeFileSync(join(dir, 'main.c'), BAD_FIRMWARE);
    writeFileSync(join(dir, 'link.ld'), LD);
    execFileSync('arm-none-eabi-gcc', [
      '-mcpu=cortex-m0plus', '-mthumb', '-Os', '-ffreestanding',
      '-nostdlib', `-T${join(dir, 'link.ld')}`, '-o', join(dir, 'fw.elf'),
      join(dir, 'main.c'), '-lgcc',
    ], { stdio: 'pipe' });
    execFileSync('arm-none-eabi-objcopy', ['-O', 'binary', join(dir, 'fw.elf'), join(dir, 'fw.bin')], { stdio: 'pipe' });
    const bin = readFileSync(join(dir, 'fw.bin'));

    const machine = new CortexM0Machine({ clockHz: 64_000_000, sramBytes: 8192, flashBytes: 64 * 1024 });
    const { rcc } = attachStm32F0(machine);
    machine.loadFirmware(bin);
    machine.advanceNs(10_000_000n);

    assert.ok(rcc.gatedAccesses.some(a => /GPIOA accessed with its RCC clock off/.test(a)),
      'ledger caught unclocked GPIOA access');
  });

  it('createStm32G0Adapter provides boundary-A adapter with STM32G0_PINS', () => {
    assert.ok('PC14' in STM32G0_PINS);
    assert.ok('PC15' in STM32G0_PINS);
    assert.ok('PA15' in STM32G0_PINS);
    assert.ok('PB9' in STM32G0_PINS);
    const adapter = createStm32G0Adapter();
    assert.equal(adapter.clockHz, 64_000_000);
    assert.equal(adapter.machine.sram.length, 8192);
    assert.equal(adapter.machine.flash.length, 64 * 1024);
  });
});
