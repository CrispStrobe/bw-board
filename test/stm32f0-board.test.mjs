// STM32-PATH Phase 1: the F030 board runs real -mcpu=cortex-m0 firmware
// written in the exact register style sb3-creator's DEVICE STM32F030
// emission follows — this test IS that contract, proven before the
// codegen exists. Blink on TIM3's 1 ms tick with WFI idling, a button
// read through IDR with the pull-up honesty, serial out USART1, and the
// two honesty ledgers empty (unmapped accesses; RCC-gated accesses).
//
// Deterministic throughout; skips loudly without arm-none-eabi-gcc.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CortexM0Machine } from '../src/cortex-m0-machine.js';
import { attachStm32F0 } from '../src/stm32f0-board.js';

let hasGcc = false;
try { execFileSync('arm-none-eabi-gcc', ['--version'], { stdio: 'pipe' }); hasGcc = true; } catch { /* skip */ }

const FIRMWARE = `
#include <stdint.h>
#define BW_MMIO(a) (*(volatile uint32_t *)(a))
#define RCC_AHBENR   BW_MMIO(0x40021014u)
#define RCC_APB1ENR  BW_MMIO(0x4002101cu)
#define RCC_APB2ENR  BW_MMIO(0x40021018u)
#define GPIOA_MODER  BW_MMIO(0x48000000u)
#define GPIOA_PUPDR  BW_MMIO(0x4800000cu)
#define GPIOA_IDR    BW_MMIO(0x48000010u)
#define GPIOA_BSRR   BW_MMIO(0x48000018u)
#define TIM3_CR1     BW_MMIO(0x40000400u)
#define TIM3_DIER    BW_MMIO(0x4000040cu)
#define TIM3_SR      BW_MMIO(0x40000410u)
#define TIM3_PSC     BW_MMIO(0x40000428u)
#define TIM3_ARR     BW_MMIO(0x4000042cu)
#define USART1_CR1   BW_MMIO(0x40013800u)
#define USART1_ISR   BW_MMIO(0x4001381cu)
#define USART1_TDR   BW_MMIO(0x40013828u)
#define NVIC_ISER    BW_MMIO(0xe000e100u)

static volatile uint32_t bw_ms;
void tim3_irq(void) { TIM3_SR = 0; bw_ms++; }   /* rc_w0: write 0 clears UIF */

int main(void)
{
    RCC_AHBENR  = (1u << 17);          /* GPIOA clock */
    RCC_APB1ENR = (1u << 1);           /* TIM3 clock */
    RCC_APB2ENR = (1u << 14);          /* USART1 clock */
    GPIOA_MODER = (1u << 0);           /* PA0 output; PA1 stays input */
    GPIOA_PUPDR = (1u << 2);           /* PA1 pull-up */
    TIM3_PSC = 48000000u / 1000000u - 1u;   /* 1 MHz count */
    TIM3_ARR = 999u;                   /* update every 1 ms */
    TIM3_DIER = 1u;                    /* UIE: the WFI wake */
    TIM3_CR1 = 1u;                     /* CEN */
    NVIC_ISER = (1u << 16);            /* TIM3 = IRQ16 on the F0 */
    USART1_CR1 = 1u;                   /* UE */
    USART1_TDR = 'h'; USART1_TDR = 'i';
    uint32_t last = 0;
    for (;;) {
        if (bw_ms != last && (bw_ms % 500u) == 0u) {
            last = bw_ms;
            if ((bw_ms / 500u) & 1u) GPIOA_BSRR = 1u;         /* PA0 set */
            else                     GPIOA_BSRR = (1u << 16); /* PA0 reset */
            /* the button honesty: PA1 pulled up, reported through IDR */
            if (!(GPIOA_IDR & (1u << 1))) USART1_TDR = 'B';
        }
        __asm__ volatile ("wfi");
    }
}
__attribute__((section(".vectors"), used))
const void *vectors[48] = {
    (void *)0x20003ff0,
    (void *)main,
    [16 + 16] = (void *)tim3_irq       /* exception 32 = IRQ16 */
};
`;

const LD = `ENTRY(main)
MEMORY { FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 64K
         RAM  (rwx): ORIGIN = 0x20000000, LENGTH = 16K }
SECTIONS {
  .text : { KEEP(*(.vectors)) *(.text*) *(.rodata*) } > FLASH
  .bss  : { *(.bss*) *(COMMON) } > RAM
}
`;

const build = () => {
    const dir = mkdtempSync(join(tmpdir(), 'bw-f0-'));
    writeFileSync(join(dir, 'main.c'), FIRMWARE);
    writeFileSync(join(dir, 'link.ld'), LD);
    execFileSync('arm-none-eabi-gcc', ['-mcpu=cortex-m0', '-mthumb', '-Os', '-ffreestanding',
        '-nostdlib', `-T${join(dir, 'link.ld')}`, '-o', join(dir, 'fw.elf'), join(dir, 'main.c'), '-lgcc'], { stdio: 'pipe' });
    execFileSync('arm-none-eabi-objcopy', ['-O', 'binary', join(dir, 'fw.elf'), join(dir, 'fw.bin')], { stdio: 'pipe' });
    return readFileSync(join(dir, 'fw.bin'));
};

describe('STM32F030 board', { skip: hasGcc ? false : 'arm-none-eabi-gcc not installed' }, () => {
    const boot = () => {
        const m = new CortexM0Machine({ clockHz: 48_000_000, sramBytes: 16 * 1024 });
        const pins = new Map();
        const serial = [];
        const board = attachStm32F0(m, {
            onPinChange: (pin, mode, high) => {
                const prev = pins.get(pin);
                if (!prev || prev.mode !== mode || prev.high !== high) {
                    pins.set(pin, { mode, high, changes: (prev?.changes ?? 0) + 1 });
                }
            },
            onSerialByte: (b) => serial.push(b),
        });
        m.loadFirmware(build());
        return { m, board, pins, serial };
    };

    it('blinks PA0 on the 500 ms grid, WFI-parked between ticks', () => {
        const { m, pins } = boot();
        m.advanceNs(3_000_000_000); // 3 s
        const pa0 = pins.get('PA0');
        assert.ok(pa0 && pa0.mode === 'pushpull', 'PA0 is an output');
        // toggles at 500/1000/1500/2000/2500 ms -> 5-6 level changes
        assert.ok(pa0.changes >= 5 && pa0.changes <= 8, `PA0 blinked (${pa0.changes} changes)`);
        assert.ok(Number(m.stats.sleptNs) / 3e9 > 0.9,
            `parked between ticks (${(Number(m.stats.sleptNs) / 3e7).toFixed(1)}% slept)`);
    });

    it('serial says hi, and the pulled-up button stays quiet until pressed', () => {
        const { m, board, serial } = boot();
        m.advanceNs(1_100_000_000);
        assert.equal(String.fromCharCode(...serial.slice(0, 2)), 'hi');
        assert.ok(!serial.includes(66), 'no B while the pull-up holds PA1 high');
        board.gpioA.setInput(1, false);   // press: drive PA1 low
        m.advanceNs(1_000_000_000);
        assert.ok(serial.includes(66), 'pressing the button reaches the serial port');
    });

    it('the two honesty ledgers are empty for this firmware', () => {
        const { m, board } = boot();
        m.advanceNs(500_000_000);
        assert.deepEqual(m.unmapped, [], 'no unmapped accesses');
        assert.deepEqual(board.rcc.gatedAccesses, [], 'no clock-gated accesses');
    });

    it('the classroom bug is caught: no RCC enable, no blink, and the ledger says why', () => {
        const m = new CortexM0Machine({ clockHz: 48_000_000 });
        const board = attachStm32F0(m);
        // firmware minus the RCC lines: poke registers directly, gated
        m._write(0x48000000, 1, 4);       // GPIOA MODER with clock off
        assert.ok(board.rcc.gatedAccesses.length > 0, 'the ledger names the gated access');
        assert.match(board.rcc.gatedAccesses[0], /GPIOA .*clock off/);
    });
});
