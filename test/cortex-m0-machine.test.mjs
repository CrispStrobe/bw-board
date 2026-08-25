// STM32-PATH.md Phase 0: the standalone ARMv6-M machine boots real
// gcc-compiled firmware from a real vector table, takes a bus-mapped
// NVIC-enabled interrupt, and parks on WFI with the wake-horizon jump —
// proving the "core's whole world is 8 bus methods" claim at runtime.
//
// Deterministic (instructions vs slept time), never wall-clock.
// Skips loudly without arm-none-eabi-gcc (CI installs it for the pico
// chain already).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CortexM0Machine } from '../src/cortex-m0-machine.js';

let hasGcc = false;
try { execFileSync('arm-none-eabi-gcc', ['--version'], { stdio: 'pipe' }); hasGcc = true; } catch { /* skip */ }

// A fake timer at 0x4000_0000: STATUS (w1c) at +0, CTRL at +4; raises
// IRQ0 every 1 ms of machine time while running. Its nextWakeNs is the
// wake horizon a parked core jumps by.
const makeTimer = () => ({
    base: 0x40000000,
    size: 0x100,
    status: 0, ctrl: 0, accNs: 0, fires: 0,
    read (off) { return off === 0 ? this.status : off === 4 ? this.ctrl : 0; },
    write (off, v) {
        if (off === 0) { this.status &= ~v; }           // w1c
        else if (off === 4) { this.ctrl = v; }
    },
    advanceNs (deltaNs, m) {
        if (!(this.ctrl & 1)) return;
        this.accNs += Number(deltaNs);
        while (this.accNs >= 1_000_000) {
            this.accNs -= 1_000_000;
            this.status |= 1;
            this.fires++;
        }
        m.setIrq(0, (this.status & 1) !== 0);
    },
    nextWakeNs () { return (this.ctrl & 1) ? Math.max(1, 1_000_000 - this.accNs) : Infinity; }
});

// Minimal PPB so firmware can talk to the NVIC THROUGH THE BUS — the
// register everybody forgets lives outside the core object.
const makePpb = (m) => ({
    base: 0xe000e000,
    size: 0x1000,
    read (off) {
        if (off === 0x100) return m.core.enabledInterrupts >>> 0;
        if (off === 0xd08) return m.core.VTOR >>> 0;
        return 0;
    },
    write (off, v) {
        if (off === 0x100) m.core.enabledInterrupts |= v;
        else if (off === 0x180) m.core.enabledInterrupts &= ~v;
        else if (off === 0x280) m.core.pendingInterrupts &= ~v;
        else if (off === 0xd08) m.core.VTOR = v >>> 0;
    }
});

const FIRMWARE = `
#define MMIO(a) (*(volatile unsigned int *)(a))
#define ODR    MMIO(0x48000014u)   /* stand-in GPIO output register */
#define TSTAT  MMIO(0x40000000u)
#define TCTRL  MMIO(0x40000004u)
#define ISER   MMIO(0xE000E100u)
void tick_irq(void) { TSTAT = 1; }  /* w1c: drop the line */
int main(void)
{
    TCTRL = 1;
    ISER = 1;                        /* IRQ0 may fire (and wake WFI) */
    for (;;) {
        ODR ^= 1u;
        __asm__ volatile ("wfi");
    }
}
__attribute__((section(".vectors"), used))
const void *vectors[48] = {
    (void *)0x20003ff0,              /* initial SP, top of 16K SRAM */
    (void *)main,                    /* reset */
    [16] = (void *)tick_irq          /* IRQ0 */
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
    const dir = mkdtempSync(join(tmpdir(), 'bw-m0-'));
    writeFileSync(join(dir, 'main.c'), FIRMWARE);
    writeFileSync(join(dir, 'link.ld'), LD);
    execFileSync('arm-none-eabi-gcc', ['-mcpu=cortex-m0', '-mthumb', '-Os', '-ffreestanding',
        '-nostdlib', `-T${join(dir, 'link.ld')}`, '-o', join(dir, 'fw.elf'), join(dir, 'main.c')], { stdio: 'pipe' });
    execFileSync('arm-none-eabi-objcopy', ['-O', 'binary', join(dir, 'fw.elf'), join(dir, 'fw.bin')], { stdio: 'pipe' });
    return readFileSync(join(dir, 'fw.bin'));
};

describe('Phase 0: standalone Cortex-M0 machine', { skip: hasGcc ? false : 'arm-none-eabi-gcc not installed' }, () => {
    const boot = () => {
        const m = new CortexM0Machine({ clockHz: 48_000_000, sramBytes: 16 * 1024 });
        const gpio = { base: 0x48000000, size: 0x400, odr: 0, writes: 0,
            read (off) { return off === 0x14 ? this.odr : 0; },
            write (off, v) { if (off === 0x14) { this.odr = v; this.writes++; } } };
        const timer = makeTimer();
        m.addPeripheral(gpio);
        m.addPeripheral(timer);
        m.addPeripheral(makePpb(m));
        m.loadFirmware(build());
        return { m, gpio, timer };
    };

    it('boots from the vector table and toggles once per timer interrupt', () => {
        const { m, gpio, timer } = boot();
        m.advanceNs(100_000_000); // 100 ms
        assert.ok(timer.fires >= 99 && timer.fires <= 101, `timer fired per ms (${timer.fires})`);
        // one ODR toggle per wake, plus the boot-time first pass
        assert.ok(Math.abs(gpio.writes - timer.fires) <= 2,
            `one toggle per wake (${gpio.writes} writes, ${timer.fires} fires)`);
    });

    it('WFI parks: slept time dominates, instructions stay per-wake', () => {
        const { m } = boot();
        m.advanceNs(100_000_000);
        const sleptMs = Number(m.stats.sleptNs) / 1e6;
        assert.ok(sleptMs > 90, `parked most of the time (${sleptMs.toFixed(1)} ms slept of 100)`);
        assert.ok(m.stats.instructions < 20_000,
            `per-wake work only (${m.stats.instructions} instructions; a spin would be millions)`);
    });

    it('the honesty ledger: no unmapped accesses from this firmware', () => {
        const { m } = boot();
        m.advanceNs(10_000_000);
        assert.deepEqual(m.unmapped, [], 'every access this firmware makes is claimed by a model');
    });
});
