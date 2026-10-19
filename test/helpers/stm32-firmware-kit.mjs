// What a correct STM32F030 / STM32G030 bare-metal image does before main()
// is allowed to assume anything, shared by the live-firmware tests.
//
// The light tier models silicon reset: the core runs on HSI (8 / 16 MHz)
// until firmware switches to the PLL, SRAM holds garbage until startup code
// clears .bss and copies .data, and USART1 only reaches PA9 in AF1 with a
// baud set. Test firmware that skipped those steps passed only because the
// old model was lenient; these snippets are the steps, per RM0360 / RM0444.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/** Reset handler: copy .data, zero .bss, then main(). Point the vector table's
 *  word 1 at `bw_reset`, not at main. */
export const STARTUP_C = `
#include <stdint.h>
extern uint32_t _sbss, _ebss, _sdata, _edata, _sidata;
int main(void);
void bw_reset(void)
{
    uint32_t *src = &_sidata;
    for (uint32_t *p = &_sdata; p < &_edata; ) *p++ = *src++;
    for (uint32_t *p = &_sbss; p < &_ebss; ) *p++ = 0u;
    main();
    for (;;) { }
}
`;

/** F030: HSI/2 x12 = 48 MHz with one flash wait state (RM0360 §6.2.3, §3.5.1). */
export const F0_CLOCK_48_C = `
static void bw_clock_48mhz(void)
{
    volatile uint32_t *flash_acr = (volatile uint32_t *)0x40022000u;
    volatile uint32_t *rcc_cr    = (volatile uint32_t *)0x40021000u;
    volatile uint32_t *rcc_cfgr  = (volatile uint32_t *)0x40021004u;
    *flash_acr = 0x11u;                          /* PRFTBE | LATENCY=1 */
    *rcc_cfgr = (10u << 18);                     /* PLLMUL x12, PLLSRC HSI/2 */
    *rcc_cr |= (1u << 24);                       /* PLLON */
    while (!(*rcc_cr & (1u << 25))) { }          /* PLLRDY */
    *rcc_cfgr = (*rcc_cfgr & ~3u) | 2u;          /* SW = PLL */
    while (((*rcc_cfgr >> 2) & 3u) != 2u) { }    /* SWS = PLL */
}
`;

/** G030: HSI16 /1 x8 /2 = 64 MHz with two flash wait states (RM0444 §5.2.4, §3.3.4). */
export const G0_CLOCK_64_C = `
static void bw_clock_64mhz(void)
{
    volatile uint32_t *flash_acr   = (volatile uint32_t *)0x40022000u;
    volatile uint32_t *rcc_cr      = (volatile uint32_t *)0x40021000u;
    volatile uint32_t *rcc_cfgr    = (volatile uint32_t *)0x40021008u;
    volatile uint32_t *rcc_pllcfgr = (volatile uint32_t *)0x4002100cu;
    *flash_acr = (*flash_acr & ~7u) | 2u;        /* LATENCY = 2 */
    while ((*flash_acr & 7u) != 2u) { }
    *rcc_pllcfgr = 2u | (0u << 4) | (8u << 8) | (1u << 28) | (1u << 29); /* HSI16, M=1, N=8, R=2, REN */
    *rcc_cr |= (1u << 24);                       /* PLLON */
    while (!(*rcc_cr & (1u << 25))) { }          /* PLLRDY */
    *rcc_cfgr = (*rcc_cfgr & ~7u) | 2u;          /* SW = PLLRCLK */
    while (((*rcc_cfgr >> 3) & 7u) != 2u) { }    /* SWS */
}
`;

/** USART1 on PA9 (AF1), 115200 8N1, TE+RE+UE, with a TXE-waiting putc.
 *  The USART1 clock must already be on; the GPIOA clock is switched on here
 *  (read-modify-write). `gpioBase` is the family's GPIOA (F0 0x48000000,
 *  G0 0x50000000); `pclkHz` the APB clock. */
export function usart1C ({ gpioBase, pclkHz }) {
  const hex = (n) => `0x${n.toString(16)}u`;
  const gpioClock = gpioBase === 0x50000000
    ? '*(volatile uint32_t *)0x40021034u |= 1u;           /* RCC_IOPENR GPIOAEN */'
    : '*(volatile uint32_t *)0x40021014u |= (1u << 17);   /* RCC_AHBENR IOPAEN */';
  return `
static void bw_usart1_init(void)
{
    ${gpioClock}
    volatile uint32_t *moder = (volatile uint32_t *)${hex(gpioBase)};
    volatile uint32_t *afrh  = (volatile uint32_t *)${hex(gpioBase + 0x24)};
    volatile uint32_t *brr   = (volatile uint32_t *)0x4001380cu;
    volatile uint32_t *cr1   = (volatile uint32_t *)0x40013800u;
    *moder = (*moder & ~(3u << 18)) | (2u << 18);  /* PA9 alternate function */
    *afrh  = (*afrh & ~(0xfu << 4)) | (1u << 4);   /* AF1 = USART1_TX */
    *brr = ${Math.round(pclkHz / 115200)}u;        /* 115200 baud */
    *cr1 = (1u << 3) | (1u << 2) | 1u;             /* TE | RE | UE */
}
static void bw_putc(uint32_t c)
{
    volatile uint32_t *isr = (volatile uint32_t *)0x4001381cu;
    volatile uint32_t *tdr = (volatile uint32_t *)0x40013828u;
    while (!(*isr & (1u << 7))) { }                /* TXE */
    *tdr = c;
}
`;
}

/** Linker script with .bss first in RAM (so a watch on its first word is stable),
 *  .data loaded from flash, and the startup symbols. */
export function linkerScript ({ flashK, ramK }) {
  return `ENTRY(bw_reset)
MEMORY { FLASH (rx) : ORIGIN = 0x08000000, LENGTH = ${flashK}K
         RAM  (rwx): ORIGIN = 0x20000000, LENGTH = ${ramK}K }
SECTIONS {
  .text : { KEEP(*(.vectors)) *(.text*) *(.rodata*) . = ALIGN(4); } > FLASH
  .bss (NOLOAD) : { . = ALIGN(4); _sbss = .; *(.bss*) *(COMMON) . = ALIGN(4); _ebss = .; } > RAM
  .data : { . = ALIGN(4); _sdata = .; *(.data*) . = ALIGN(4); _edata = .; } > RAM AT > FLASH
  _sidata = LOADADDR(.data);
}
`;
}

/** Compile a C source (with STARTUP_C included) to a flat flash image. */
export function compileStm32 (cSource, { cpu = 'cortex-m0', flashK = 16, ramK = 4 } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'bw-stm32fw-'));
  writeFileSync(join(dir, 'main.c'), cSource);
  writeFileSync(join(dir, 'link.ld'), linkerScript({ flashK, ramK }));
  execFileSync('arm-none-eabi-gcc', [`-mcpu=${cpu}`, '-mthumb', '-Os', '-ffreestanding',
    '-nostdlib', `-T${join(dir, 'link.ld')}`, '-o', join(dir, 'fw.elf'), join(dir, 'main.c'), '-lgcc'], { stdio: 'pipe' });
  execFileSync('arm-none-eabi-objcopy', ['-O', 'binary', join(dir, 'fw.elf'), join(dir, 'fw.bin')], { stdio: 'pipe' });
  return readFileSync(join(dir, 'fw.bin'));
}
