// The F0 adapter at boundary A: generated-shape firmware drives a REAL
// BoardImpl — the LED sees the blink, the board's button reaches the
// firmware, serial flows — and the shared rp2040js debug target runs
// unchanged over the adapter's facade (run, pause-by-budget, insn-step,
// write watch on the tick counter). Skips loudly without
// arm-none-eabi-gcc, same policy as the F0 board contract test.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStm32F0Adapter, STM32F0_PINS } from '../src/stm32-adapter.js';
import { createRp2040jsDebugTarget } from '../src/rp2040js-debug.js';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

let hasGcc = false;
try { execFileSync('arm-none-eabi-gcc', ['--version'], { stdio: 'pipe' }); hasGcc = true; } catch { /* skip */ }

// The same emission-contract shape the board test proves: blink PA0 on
// the TIM3 ms grid, button on PA1 (pull-up) echoes 'B' on the serial,
// WFI between passes. bw_ms lives in .bss — the write-watch subject.
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
#define USART1_TDR   BW_MMIO(0x40013828u)
#define NVIC_ISER    BW_MMIO(0xe000e100u)
static volatile uint32_t bw_ms;
void tim3_irq(void) { TIM3_SR = 0; bw_ms++; }
int main(void)
{
    RCC_AHBENR = (1u << 17); RCC_APB1ENR = (1u << 1); RCC_APB2ENR = (1u << 14);
    GPIOA_MODER = 1u;               /* PA0 output, PA1 stays input */
    GPIOA_PUPDR = (1u << 2);        /* PA1 pull-up */
    TIM3_PSC = 47u; TIM3_ARR = 999u; TIM3_DIER = 1u; TIM3_CR1 = 1u;
    NVIC_ISER = (1u << 16);
    USART1_CR1 = 1u;
    uint32_t last = 0;
    for (;;) {
        if (bw_ms != last && (bw_ms % 250u) == 0u) {
            last = bw_ms;
            if ((bw_ms / 250u) & 1u) GPIOA_BSRR = 1u; else GPIOA_BSRR = (1u << 16);
            if (!(GPIOA_IDR & 2u)) USART1_TDR = 'B';
        }
        __asm__ volatile ("wfi");
    }
}
__attribute__((section(".vectors"), used))
const void *vectors[48] = {
    (void *)0x20001000, (void *)main, [16 + 16] = (void *)tim3_irq
};
`;

const LD = `ENTRY(main)
MEMORY { FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 16K
         RAM  (rwx): ORIGIN = 0x20000000, LENGTH = 4K }
SECTIONS { .text : { KEEP(*(.vectors)) *(.text*) *(.rodata*) } > FLASH
           .bss  : { *(.bss*) *(COMMON) } > RAM }
`;

let binCache = null;
const build = () => {
    if (binCache) return binCache;
    const dir = mkdtempSync(join(tmpdir(), 'bw-f0adp-'));
    writeFileSync(join(dir, 'main.c'), FIRMWARE);
    writeFileSync(join(dir, 'link.ld'), LD);
    execFileSync('arm-none-eabi-gcc', ['-mcpu=cortex-m0', '-mthumb', '-Os', '-ffreestanding',
        '-nostdlib', `-T${join(dir, 'link.ld')}`, '-o', join(dir, 'fw.elf'), join(dir, 'main.c'), '-lgcc'], { stdio: 'pipe' });
    execFileSync('arm-none-eabi-objcopy', ['-O', 'binary', join(dir, 'fw.elf'), join(dir, 'fw.bin')], { stdio: 'pipe' });
    binCache = readFileSync(join(dir, 'fw.bin'));
    return binCache;
};

const t = (part, terminal) => ({ part, terminal });

describe('STM32F0 boundary-A adapter', { skip: hasGcc ? false : 'arm-none-eabi-gcc not installed' }, () => {
    // PA0 → 220Ω → LED → GND; PA1 → button → GND (pull-up in the chip)
    const rig = () => {
        const board = new BoardImpl(3.3);
        board.setNetlist([
            { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'MCU', kind: 'mcu', params: {}, terminals: Object.keys(STM32F0_PINS) },
            { id: 'R1', kind: 'resistor', params: { ohms: 220 }, terminals: ['a', 'b'] },
            { id: 'D1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
            { id: 'BTN', kind: 'button', params: {}, terminals: ['a', 'b'] },
        ], [
            { id: 'n1', terminals: [t('MCU', 'PA0'), t('R1', 'a')] },
            { id: 'n2', terminals: [t('R1', 'b'), t('D1', 'anode')] },
            { id: 'n3', terminals: [t('D1', 'cathode'), t('GND', 'gnd')] },
            { id: 'n4', terminals: [t('MCU', 'PA1'), t('BTN', 'a')] },
            { id: 'n5', terminals: [t('BTN', 'b'), t('GND', 'gnd')] },
        ]);
        const adapter = createStm32F0Adapter({ program: build() });
        adapter.attachBoard(board);
        return { board, adapter };
    };

    it('attachBoard seats every header pin before any firmware runs', () => {
        const pins = [];
        const adapter = createStm32F0Adapter({ program: build() });
        adapter.attachBoard({
            setPin: (name, mode, high) => pins.push({ name, mode, high }),
            advanceTo: () => {},
            readPin: () => 0,
        });
        const seated = new Set(pins.map(p => p.name));
        for (const name of Object.keys(STM32F0_PINS)) {
            assert.ok(seated.has(name), `${name} seated at attach`);
        }
        for (const p of pins) assert.equal(p.mode, 'input', `${p.name} is a plain input at reset`);
    });

    it('the LED on the real board follows the firmware blink', () => {
        const { board, adapter } = rig();
        const seen = [];
        for (let i = 0; i < 15; i++) {
            adapter.advanceNs(100_000_000);
            seen.push(board.ledBrightness('D1') > 0.05 ? 1 : 0);
        }
        assert.ok(seen.includes(1) && seen.includes(0),
            `the LED both lit and darkened over 1.5 s (${seen.join('')})`);
        assert.deepEqual(adapter.machine.unmapped, [], 'no unmapped accesses');
        assert.deepEqual(adapter.peripherals.rcc.gatedAccesses, [], 'no clock-gated accesses');
    });

    it('the board button reaches the firmware and comes back as serial', () => {
        const { board, adapter } = rig();
        const bytes = [];
        adapter.onSerial((b) => bytes.push(b));
        adapter.advanceNs(600_000_000);
        assert.ok(!bytes.includes(66), 'no B before the press');
        board.setControl('BTN', 1);   // press: PA1 to GND through the button
        adapter.advanceNs(600_000_000);
        assert.ok(bytes.includes(66), 'B after the press');
        board.setControl('BTN', 0);
        bytes.length = 0;
        adapter.advanceNs(600_000_000);
        assert.ok(!bytes.includes(66), 'quiet again after release');
    });

    it('advanceTo is bigint, monotonic, time-first before every edge', () => {
        const calls = [];
        const adapter = createStm32F0Adapter({ program: build() });
        adapter.attachBoard({
            setPin: (name, mode, high) => calls.push({ name, mode, high }),
            advanceTo: (tNs) => calls.push({ advanceTo: tNs }),
            readPin: () => 0,
        });
        adapter.advanceNs(300_000_000);
        let last = -1n;
        let prevWasAdvance = false;
        for (const c of calls) {
            if (c.advanceTo !== undefined) {
                assert.equal(typeof c.advanceTo, 'bigint', 'advanceTo carries bigint ns');
                assert.ok(c.advanceTo >= last, 'time never goes backwards');
                last = c.advanceTo;
                prevWasAdvance = true;
            } else {
                assert.ok(prevWasAdvance, `setPin(${c.name}) without a preceding advanceTo`);
                prevWasAdvance = false;
            }
        }
    });

    it('the shared rp2040js debug target drives the F0 unchanged', () => {
        const { adapter } = rig();
        const target = createRp2040jsDebugTarget(adapter);
        assert.deepEqual(target.capabilities().steps, ['insn', 'block', 'over', 'out']);

        target.run();
        assert.equal(target.runFor(50_000_000), 'budget', 'runs to budget');
        const pc0 = target.regs().pc >>> 0;
        assert.ok(pc0 >= 0x08000000 && pc0 < 0x08004000, `pc in flash (0x${pc0.toString(16)})`);

        target.step('insn');
        assert.equal(target.runFor(1_000_000), 'halted', 'insn step halts');
        assert.equal(target.state(), 'halted');

        // Write watch on bw_ms (.bss start): the tick ISR stores there
        // every simulated millisecond, so the watch fires within ~2 ms.
        const bp = target.setBreakpoint({ kind: 'write', addr: 0x20000000, len: 4 });
        assert.ok(!(bp && bp.unsupported), `write watch accepted (${bp && bp.unsupported})`);
        target.run();
        assert.equal(target.runFor(5_000_000), 'halted', 'watch fires on the ms tick');

        // While halted, program time is frozen (freeze-timers policy).
        const tHalt = target.timeNs();
        assert.equal(target.timeNs(), tHalt, 'no wall clock runs on');
    });
});
