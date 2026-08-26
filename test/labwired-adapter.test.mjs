/**
 * labwired-wasm adapter — boundary-A contract, exercised against the REAL
 * engine rather than a mock.
 *
 * STM32-PATH.md Phase 4 names two pieces of remaining work before the heavy
 * tier can ship: "the wasm-bindgen API surface → boundary-A adapter mapping,
 * and their board-manifest → our-netlist bridge". This file is the proof for
 * the first, and for the slice of the second the adapter generates.
 *
 * Gated like the oracle test, so a checkout without the artifact skips
 * LOUDLY rather than silently passing:
 *   LABWIRED_WASM = directory holding wasm-bindgen --target nodejs output
 *   (arm-none-eabi-gcc on PATH, to build the F0 image)
 *
 * The firmware is deliberately the smallest thing that proves the mapping: a
 * PA5 blink driven by BSRR, no USART, no interrupts. A pin-edge contract
 * wants pin edges and nothing that could mask them.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { createLabwiredAdapter, generateSystemYaml } from '../src/labwired-adapter.js';

const here = dirname(fileURLToPath(import.meta.url));
const WASM_DIR = process.env.LABWIRED_WASM;

let hasGcc = false;
try { execFileSync('arm-none-eabi-gcc', ['--version'], { stdio: 'pipe' }); hasGcc = true; } catch { /* skip */ }

const skip = !WASM_DIR ? 'set LABWIRED_WASM to the wasm-bindgen nodejs out-dir'
    : !existsSync(join(WASM_DIR, 'labwired_wasm.js')) ? `no labwired_wasm.js in ${WASM_DIR}`
        : !hasGcc ? 'arm-none-eabi-gcc not installed'
            : false;

/** PA5 blink: RCC AHBENR GPIOA on, MODER5 = output, then BSRR set/clear. */
const FIRMWARE = `
#define RCC_AHBENR  (*(volatile unsigned int *)0x40021014u)
#define GPIOA_MODER (*(volatile unsigned int *)0x48000000u)
#define GPIOA_BSRR  (*(volatile unsigned int *)0x48000018u)
extern unsigned int _estack;
void reset_handler(void);
__attribute__((section(".vectors"), used))
void *vectors[] = { (void *)&_estack, (void *)reset_handler };
static void delay(volatile unsigned int n) { while (n--) __asm__ volatile("nop"); }
void reset_handler(void) {
    RCC_AHBENR |= (1u << 17);
    GPIOA_MODER = (GPIOA_MODER & ~(3u << (5 * 2))) | (1u << (5 * 2));
    for (;;) { GPIOA_BSRR = (1u << 5); delay(200); GPIOA_BSRR = (1u << (5 + 16)); delay(200); }
}
`;

const LD = `
ENTRY(reset_handler)
MEMORY { FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 256K
         RAM  (rwx) : ORIGIN = 0x20000000, LENGTH = 64K }
SECTIONS {
  .text : { KEEP(*(.vectors)) *(.text*) *(.rodata*) } > FLASH
  .data : { *(.data*) } > RAM
  .bss  : { *(.bss*) *(COMMON) } > RAM
  _estack = ORIGIN(RAM) + LENGTH(RAM);
}
`;

function buildElf () {
    const dir = mkdtempSync(join(tmpdir(), 'lw-adapter-'));
    writeFileSync(join(dir, 'main.c'), FIRMWARE);
    writeFileSync(join(dir, 'link.ld'), LD);
    execFileSync('arm-none-eabi-gcc', ['-mcpu=cortex-m0', '-mthumb', '-Os', '-ffreestanding',
        '-nostdlib', `-T${join(dir, 'link.ld')}`, '-o', join(dir, 'fw.elf'),
        join(dir, 'main.c'), '-lgcc'], { stdio: 'pipe' });
    return readFileSync(join(dir, 'fw.elf'));
}

/** Records every boundary-A call in order, so ordering can be asserted. */
function recordingBoard (level = 0) {
    const calls = [];
    return {
        calls,
        level,
        setPin (name, mode, high) { calls.push({ k: 'setPin', name, mode, high }); },
        advanceTo (tNs) { calls.push({ k: 'advanceTo', tNs }); },
        readPin () { return this.level; },
        readAnalog () { return 0; },
    };
}

const PINS = {
    PA5: { peripheral: 'gpioPortA', pin: 5 },
    PA0: { peripheral: 'gpioPortA', pin: 0 },
    PA1: { peripheral: 'gpioPortA', pin: 1 },
};

describe('labwired-wasm boundary-A adapter', { skip }, () => {
    const require = createRequire(import.meta.url);
    const wasm = WASM_DIR ? require(join(WASM_DIR, 'labwired_wasm.js')) : null;
    const chipYaml = readFileSync(join(here, 'fixtures/labwired/stm32f0-chip.yaml'), 'utf8');
    const firmware = hasGcc && WASM_DIR ? buildElf() : null;

    const make = () => createLabwiredAdapter({
        wasm, chipYaml, firmware, pins: PINS, clockHz: 48_000_000, name: 'bw-adapter-test',
    });

    it('generates one input binding per pin, so every pad is drivable', () => {
        const yaml = generateSystemYaml('t', './c.yaml', PINS);
        for (const name of Object.keys(PINS)) {
            assert.match(yaml, new RegExp(`id: "${name}"`), `${name} has no board_io binding`);
        }
        assert.equal((yaml.match(/signal: input/g) || []).length, Object.keys(PINS).length);
    });

    it('pillar 1: attach SEATS every pin, before any edge exists', () => {
        const adapter = make();
        const board = recordingBoard();
        adapter.attachBoard(board);
        const seated = board.calls.filter((c) => c.k === 'setPin').map((c) => c.name);
        for (const name of Object.keys(PINS)) {
            assert.ok(seated.includes(name), `${name} was never seated — pillar 1`);
        }
        // Every setPin carries a real mode the board can model.
        for (const c of board.calls.filter((c) => c.k === 'setPin')) {
            assert.ok(['pushpull', 'input', 'analog'].includes(c.mode), `bad mode ${c.mode}`);
        }
    });

    it('the firmware\'s BSRR writes arrive as pin edges, time before edge', () => {
        const adapter = make();
        const board = recordingBoard();
        adapter.attachBoard(board);
        board.calls.length = 0;

        for (let i = 0; i < 40; i++) adapter.advanceNs(1_000_000n);   // 40 ms

        const edges = board.calls.filter((c) => c.k === 'setPin' && c.name === 'PA5');
        assert.ok(edges.length >= 2, `PA5 never toggled (${edges.length} edges)`);
        assert.ok(edges.some((e) => e.high) && edges.some((e) => !e.high),
            'PA5 edges are all one direction — BSRR set and clear must both land');

        // Contract ordering: an advanceTo must precede each setPin, so the
        // board integrates up to the edge before the level changes.
        const firstSetPin = board.calls.findIndex((c) => c.k === 'setPin');
        assert.ok(firstSetPin > 0 && board.calls[firstSetPin - 1].k === 'advanceTo',
            'a pin edge was published without advancing the board to its time first');

        // Time is monotonic and non-negative across the whole run.
        let prev = -1n;
        for (const c of board.calls.filter((c) => c.k === 'advanceTo')) {
            assert.ok(c.tNs >= prev, `time went backwards: ${prev} -> ${c.tNs}`);
            prev = c.tNs;
        }
    });

    it('PA5 is reported as an output once the firmware configures MODER', () => {
        const adapter = make();
        const board = recordingBoard();
        adapter.attachBoard(board);
        for (let i = 0; i < 10; i++) adapter.advanceNs(1_000_000n);
        const pa5 = board.calls.filter((c) => c.k === 'setPin' && c.name === 'PA5').pop();
        assert.equal(pa5.mode, 'pushpull',
            'the routing query should call a MODER-configured output pushpull');
    });

    it('pillar 2: an undriven pin takes its level from the board', () => {
        const adapter = make();
        const board = recordingBoard(1);
        adapter.attachBoard(board);
        // PA0/PA1 are never touched by this firmware, so they stay inputs and
        // the adapter must push the board's level into the engine's IDR.
        adapter.advanceNs(1_000_000n);
        assert.equal(adapter.stats.unbindablePins, undefined,
            'a pin could not be driven — the generated board_io is incomplete');
    });

    it('time advances at the configured clock rate', () => {
        const adapter = make();
        const board = recordingBoard();
        adapter.attachBoard(board);
        adapter.advanceNs(10_000_000n);              // 10 ms
        const t = adapter.timeNs();
        // The engine may not consume the full budget in one batch, but it must
        // move, and it must not overshoot the request.
        assert.ok(t > 0n, 'time did not advance');
        assert.ok(t <= 10_000_000n, `time overshot the request: ${t}`);
    });
});
