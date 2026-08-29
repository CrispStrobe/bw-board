/**
 * THE ROUND TRIP: a designer's bench, bridged, run on both tiers, compared.
 *
 *   gallery circuit.stm32f030.json
 *     → (bw-circuit-ui's canonical loader, once, offline)
 *     → netlist {parts, nets}
 *     → buildLabwiredSystem()  → labwired system manifest
 *     → labwired-wasm          → pad edges + UART
 *     ⟂ the same firmware on the light tier's CortexM0Machine + F0 board
 *
 * Both tiers drive a `BoardImpl` built from the SAME netlist, which is the
 * whole point: one board, one truth, two engines. If the bridge dropped a pad,
 * mislabelled a binding, or wired the wrong port, the two boards disagree here
 * and nowhere else — the adapter test cannot see it, because it uses a
 * hand-written pin map and a recording stub instead of a circuit.
 *
 * WHAT IS COMPARED, AND WHAT DELIBERATELY IS NOT
 * ---------------------------------------------
 * Compared byte for byte and edge for edge: the UART stream, the pad-edge
 * SEQUENCE, the pad MODE each edge carried, and the LED current the board
 * solved at each level. Those are claims about the circuit and the bridge.
 *
 * NOT compared: absolute wall-clock edge times. The oracle already measured
 * that the two simulators keep different time under WFI fast-forward
 * (`labwired-oracle.test.mjs`: content agrees, timebases differ), and asserting
 * equality there would be asserting a thing we know to be false. What IS
 * asserted about time is that both tiers produce a MONOTONIC, evenly-spaced
 * timeline, and the measured ratio between them is printed so a change in it is
 * visible rather than silent.
 *
 * Gated exactly like the adapter suite:
 *   LABWIRED_WASM = the wasm-bindgen NODEJS out-dir
 *   arm-none-eabi-gcc + arm-none-eabi-objcopy on PATH
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { createStm32F0Adapter } from '../src/stm32-adapter.js';
import { createLabwiredAdapter } from '../src/labwired-adapter.js';
import { labwiredAdapterOptionsFor } from '../src/labwired-bridge.js';
import { createDebugTarget } from '../src/debug-target-factory.js';

registerAllDevices();

const here = dirname(fileURLToPath(import.meta.url));
const WASM_DIR = process.env.LABWIRED_WASM;

let hasGcc = false;
try {
    execFileSync('arm-none-eabi-gcc', ['--version'], { stdio: 'pipe' });
    execFileSync('arm-none-eabi-objcopy', ['--version'], { stdio: 'pipe' });
    hasGcc = true;
} catch { /* skip */ }

const skip = !WASM_DIR ? 'set LABWIRED_WASM to the wasm-bindgen NODEJS out-dir'
    : !existsSync(join(WASM_DIR, 'labwired_wasm.js')) ? `no labwired_wasm.js in ${WASM_DIR}`
        : !hasGcc ? 'arm-none-eabi-gcc / objcopy not installed'
            : false;

const CORPUS = JSON.parse(readFileSync(join(here, 'fixtures/labwired/f030-bench-netlists.json'), 'utf8'));
const benchNetlist = (name) => {
    const row = CORPUS.benches.find((b) => b.bench === name);
    assert.ok(row, `${name} is not in the bench fixture`);
    return row.netlist;
};

/** Half-period, in TIM3 milliseconds. Short because the heavy tier runs real
 *  cycles: 240 ms of simulated time is ten edges and a few seconds of wall. */
const HALF_MS = 20;
const RUN_MS = 240;

/**
 * The firmware corpus. All three drive PA0 on the SAME bench; what differs is
 * how the millisecond grid reaches the pad, which is exactly what separates the
 * things the two tiers agree about from the one thing they do not.
 *
 * Register vocabulary is deliberately sb3-creator's `DEVICE STM32F030` emission
 * (RM0360 offsets, real vector table, TIM3 1 ms tick, WFI idle), so what this
 * proves about the bridge is what a generated program would meet.
 *
 * SP = top of the 4 KB the LIGHT tier's machine actually has: `stm32-adapter.js`
 * builds an F030F4 (sramBytes 4096, flashBytes 16 K) while the labwired chip
 * descriptor declares 64 K / 256 K, so a stack pointer valid on the heavy tier
 * runs off the end of the light one — which is not a fault anyone sees, it is a
 * firmware that stops ticking. Sized for the smaller of the two.
 */
const PROLOGUE = `
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
#define HALF ${HALF_MS}u
static void bw_clocks(void) {
    RCC_AHBENR  = (1u << 17);
    RCC_APB1ENR = (1u << 1);
    RCC_APB2ENR = (1u << 14);
    TIM3_PSC = 48000000u / 1000000u - 1u;   /* 1 MHz count */
    TIM3_ARR = 999u;                        /* update every 1 ms */
}
`;

const VECTORS_WITH_IRQ = `
__attribute__((section(".vectors"), used))
const void *vectors[48] = {
    (void *)0x20000ff0, (void *)main, [16 + 16] = (void *)tim3_irq
};
`;

/** Interrupt-driven, WFI-idled: the shape the codegen emits. */
const FW_IRQ = `${PROLOGUE}
static volatile uint32_t bw_ms;
void tim3_irq(void) { TIM3_SR = 0; bw_ms++; }   /* rc_w0: write 0 clears UIF */
int main(void)
{
    bw_clocks();
    GPIOA_MODER = (1u << 0);           /* PA0 output */
    TIM3_DIER = 1u;
    TIM3_CR1 = 1u;
    NVIC_ISER = (1u << 16);            /* TIM3 = IRQ16 on the F0 */
    USART1_CR1 = 1u;
    USART1_TDR = 'h'; USART1_TDR = 'i';
    uint32_t last = 0;
    for (;;) {
        if (bw_ms != last && (bw_ms % HALF) == 0u) {
            last = bw_ms;
            if ((bw_ms / HALF) & 1u) GPIOA_BSRR = 1u;
            else                     GPIOA_BSRR = (1u << 16);
        }
        __asm__ volatile ("wfi");
    }
}
${VECTORS_WITH_IRQ}`;

/**
 * The same millisecond grid, POLLED off UIF — no NVIC anywhere.
 *
 * This is the control that turns "the two tiers keep different time" from a
 * shrug into a diagnosis: it isolates the counter from the interrupt path.
 */
const FW_POLL = `${PROLOGUE}
int main(void)
{
    bw_clocks();
    GPIOA_MODER = (1u << 0);
    TIM3_CR1 = 1u;
    USART1_CR1 = 1u;
    USART1_TDR = 'h'; USART1_TDR = 'i';
    uint32_t ms = 0;
    for (;;) {
        if (TIM3_SR & 1u) {
            TIM3_SR = 0;
            ms++;
            if ((ms % HALF) == 0u) {
                if ((ms / HALF) & 1u) GPIOA_BSRR = 1u;
                else                  GPIOA_BSRR = (1u << 16);
            }
        }
    }
}
__attribute__((section(".vectors"), used))
const void *vectors[2] = { (void *)0x20000ff0, (void *)main };
`;

/**
 * One PA0 toggle per ISR ENTRY. Over N ms of TIM3 there are N update events, so
 * a correct NVIC produces exactly N edges — which makes the edge count a direct
 * count of interrupt entries per update event.
 */
const FW_IRQ_TOGGLE = `${PROLOGUE}
static volatile uint32_t bw_lvl;
void tim3_irq(void) {
    TIM3_SR = 0;
    bw_lvl ^= 1u;
    if (bw_lvl) GPIOA_BSRR = 1u; else GPIOA_BSRR = (1u << 16);
}
int main(void)
{
    bw_clocks();
    GPIOA_MODER = (1u << 0);
    TIM3_DIER = 1u;
    TIM3_CR1 = 1u;
    NVIC_ISER = (1u << 16);
    for (;;) { __asm__ volatile ("wfi"); }
}
${VECTORS_WITH_IRQ}`;

/**
 * Reads PA1 (pulled up, on the chip AND by the bench's own resistor) and prints
 * 'B' whenever it is low. The board→firmware direction of the boundary.
 */
const FW_BUTTON = `${PROLOGUE}
static volatile uint32_t bw_ms;
void tim3_irq(void) { TIM3_SR = 0; bw_ms++; }
int main(void)
{
    bw_clocks();
    GPIOA_MODER = (1u << 0);           /* PA0 output; PA1 stays input */
    GPIOA_PUPDR = (1u << 2);           /* PA1 pull-up */
    TIM3_DIER = 1u;
    TIM3_CR1 = 1u;
    NVIC_ISER = (1u << 16);
    USART1_CR1 = 1u;
    uint32_t last = 0;
    for (;;) {
        if (bw_ms != last && (bw_ms % HALF) == 0u) {
            last = bw_ms;
            if (!(GPIOA_IDR & (1u << 1))) USART1_TDR = 'B';
        }
        __asm__ volatile ("wfi");
    }
}
${VECTORS_WITH_IRQ}`;

const LD = `ENTRY(main)
MEMORY { FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 16K
         RAM  (rwx): ORIGIN = 0x20000000, LENGTH = 4K }
SECTIONS {
  .text : { KEEP(*(.vectors)) *(.text*) *(.rodata*) } > FLASH
  .bss  : { *(.bss*) *(COMMON) } > RAM
}
`;

/** Build one source in both forms: the ELF labwired loads, the raw image lite
 *  compiles. */
function buildFirmware (source) {
    const dir = mkdtempSync(join(tmpdir(), 'lw-rt-'));
    writeFileSync(join(dir, 'main.c'), source);
    writeFileSync(join(dir, 'link.ld'), LD);
    execFileSync('arm-none-eabi-gcc', ['-mcpu=cortex-m0', '-mthumb', '-Os', '-ffreestanding',
        '-nostdlib', `-T${join(dir, 'link.ld')}`, '-o', join(dir, 'fw.elf'),
        join(dir, 'main.c'), '-lgcc'], { stdio: 'pipe' });
    execFileSync('arm-none-eabi-objcopy', ['-O', 'binary', join(dir, 'fw.elf'),
        join(dir, 'fw.bin')], { stdio: 'pipe' });
    return {
        elf: new Uint8Array(readFileSync(join(dir, 'fw.elf'))),
        bin: new Uint8Array(readFileSync(join(dir, 'fw.bin'))),
    };
}

/** A real board from a real bench netlist, plus a tap on the pad it drives. */
function benchBoard (netlist, watchPin) {
    const board = new BoardImpl(netlist.vcc ?? 5);
    board.setNetlist(netlist.parts, netlist.nets);
    const edges = [];
    const inner = board.setPin.bind(board);
    board.setPin = (pin, mode, high) => {
        inner(pin, mode, high);
        if (String(pin).toLowerCase() === watchPin) edges.push({ tNs: board.timeNs, mode, high });
    };
    return { board, edges };
}

/**
 * Drive an adapter for `ms` simulated milliseconds, collecting the console.
 *
 * The slice is a BIGINT deliberately: every adapter here returns a bigint from
 * `timeNs()`, so computing the next slice from one and handing it back is the
 * natural thing for a host to write — and it used to work on the heavy tier and
 * throw on the light one. Driving both from the same call is how that was found,
 * and keeping the bigint here is what keeps it found.
 */
function drive (adapter, board, ms) {
    const uart = [];
    adapter.onSerial((b) => uart.push(b));
    adapter.attachBoard(board);
    for (let i = 0; i < ms; i++) adapter.advanceNs(1_000_000n);
    return uart;
}

describe('labwired round trip: a gallery bench on both tiers', { skip }, () => {
    const require = createRequire(import.meta.url);
    const wasm = WASM_DIR ? require(join(WASM_DIR, 'labwired_wasm.js')) : null;
    const built = new Map();
    const fw = (source) => {
        if (!built.has(source)) built.set(source, buildFirmware(source));
        return built.get(source);
    };

    /**
     * Run one bench with one firmware on both tiers.
     * @param {string} name gallery bench directory name
     * @param {string} source the C to build
     * @param {number} [ms] simulated milliseconds
     */
    function bothTiers (name, source, ms = RUN_MS) {
        const image = fw(source);
        const netlist = benchNetlist(name);

        const light = benchBoard(netlist, 'pa0');
        const lightAdapter = createStm32F0Adapter({ program: image.bin, clockHz: 48_000_000 });
        const lightUart = drive(lightAdapter, light.board, ms);

        const opts = labwiredAdapterOptionsFor({ netlist, firmware: image.elf, name: `bw-${name}` });
        const heavy = benchBoard(netlist, 'pa0');
        const heavyAdapter = createLabwiredAdapter({ wasm, ...opts });
        const heavyUart = drive(heavyAdapter, heavy.board, ms);

        return { netlist, opts, light, heavy, lightUart, heavyUart, lightAdapter, heavyAdapter };
    }

    // Memoised: one bench on the heavy tier is ~15 s of real cycles, and more
    // than one test wants the same run.
    const runs = new Map();
    const cached = (name, source, ms) => {
        const key = `${name}|${source.length}|${ms}`;
        if (!runs.has(key)) runs.set(key, bothTiers(name, source, ms));
        return runs.get(key);
    };

    /**
     * Drop every record that did not CHANGE the pad's level.
     *
     * `setPin` fires on a MODE change as well as a level change — a pad seated
     * as `input` low and then reconfigured to `pushpull` low is two calls at the
     * same level — and how many of those a tier emits before the firmware's
     * first BSRR write is an artefact of when each engine publishes, not a claim
     * about the circuit. What IS a claim about the circuit is the sequence of
     * LEVELS the pad visited and when it visited them.
     */
    const collapse = (edges) => {
        const out = [];
        for (const e of edges) if (!out.length || out[out.length - 1].high !== e.high) out.push(e);
        return out;
    };
    /** Level sequence as a string: '0101…'. */
    const seq = (edges) => collapse(edges).map((e) => (e.high ? 1 : 0)).join('');
    /** How many times the pad actually changed level. */
    const transitions = (edges) => Math.max(0, collapse(edges).length - 1);
    /** Mean gap between level changes, in ms. */
    const meanGap = (edges) => {
        const t = collapse(edges).map((e) => Number(e.tNs) / 1e6);
        let sum = 0;
        for (let i = 1; i < t.length; i++) sum += t[i] - t[i - 1];
        return sum / (t.length - 1);
    };

    it('01-blink: the bridged manifest runs the bench, and both tiers agree', () => {
        const r = cached('01-blink', FW_IRQ, RUN_MS);

        // The manifest came from the netlist, not from a hand-written pin map.
        assert.match(r.opts.systemYaml, /- id: "PA0"/);
        assert.match(r.opts.systemYaml,
            /id: "LED_led1"\n {2}kind: led\n {2}peripheral: "gpioPortA"\n {2}pin: 0\n {2}signal: output/);
        assert.deepEqual(r.opts.refusals, [], '01-blink must bridge with an empty ledger');

        // 1. The console, byte for byte.
        assert.deepEqual(r.heavyUart, r.lightUart, 'the two tiers printed different bytes');
        assert.equal(String.fromCharCode(...r.lightUart), 'hi');

        // 2. The pad-edge sequence. The two tiers do not produce the same NUMBER
        //    of edges here — see the interrupt-entry test below, which is the
        //    reason — so what is compared is the common prefix. Both must
        //    alternate, and both must start on the same level, or the manifest
        //    bound the wrong pad polarity.
        const l = seq(r.light.edges);
        const h = seq(r.heavy.edges);
        assert.ok(l.length >= 4, `light tier produced ${l.length} PA0 level changes`);
        assert.ok(h.length >= 4, `heavy tier produced ${h.length} PA0 level changes`);
        const n = Math.min(l.length, h.length);
        assert.equal(h.slice(0, n), l.slice(0, n),
            'the bridged manifest produced a different PA0 level sequence');
        assert.match(l, /^(01|10)+$|^(01|10)+[01]$/, 'a collapsed timeline alternates by construction');

        // 3. The pad MODE. A bridge that bound the wrong port would leave the
        //    pad an input forever and the LED would never light — which is
        //    exactly the failure the stm32v2 profile trap produced, silently.
        const modes = r.heavy.edges.map((e) => e.mode);
        const firstDriven = modes.indexOf('pushpull');
        assert.notEqual(firstDriven, -1,
            'PA0 never became a push-pull output — with the wrong register map the '
            + 'routing reads back as input or analog forever, which is exactly what '
            + 'the stm32v2 profile trap produced, silently');
        // Everything BEFORE that is the reset state the firmware has not
        // configured yet (MODER = 0 = input), which is correct and is what the
        // light tier seats too. Everything after must stay driven.
        assert.deepEqual([...new Set(modes.slice(0, firstDriven))].sort(), firstDriven ? ['input'] : [],
            `pad modes before configuration: ${modes.slice(0, firstDriven).join(', ')}`);
        assert.deepEqual([...new Set(modes.slice(firstDriven))], ['pushpull'],
            'the pad stopped being a driven output mid-run');

        // 4. The CIRCUIT. Same netlist, same board model, so with the pad driven
        //    to the same level the MNA solver must reach the same node voltages —
        //    not close, identical.
        //
        //    Deliberately NOT `ledBrightness`: that is a time-weighted average
        //    over a perception window, so it depends on the blink RATE, and the
        //    two tiers' rates differ by the interrupt-entry finding below.
        //    Comparing it would be re-measuring that divergence and calling it a
        //    circuit disagreement. An instantaneous solved voltage is the claim
        //    about the circuit.
        const anodeNet = r.netlist.nets.find((n) =>
            n.terminals.some((t) => t.part === 'LED_led1' && t.terminal === 'anode')).id;
        const solved = [r.light, r.heavy].map((t) => {
            t.board.setPin('PA0', 'pushpull', true);
            t.board.advanceTo(t.board.timeNs + 1_000_000n);
            return { pad: t.board.readAnalog('PA0'), anode: t.board.nodeVoltage(anodeNet) };
        });
        assert.deepEqual(solved[1], solved[0],
            'the same netlist solved differently under the two tiers');
        assert.ok(solved[0].pad > 1 && solved[0].anode > 0,
            `the pad never drove the LED branch: ${JSON.stringify(solved[0])}`);
    });

    it('POLLED off UIF, the two timelines agree — so the COUNTER is not the difference', () => {
        // The control for the finding below. Identical grid, identical bench,
        // no NVIC anywhere: if the counters agreed only by luck this is where it
        // would show.
        // Shorter than the interrupt runs: this firmware never sleeps, so
        // neither tier can fast-forward and every one of the 48,000 cycles per
        // millisecond is executed on both.
        const r = cached('01-blink', FW_POLL, 100);
        assert.ok(transitions(r.light.edges) >= 4 && transitions(r.heavy.edges) >= 4,
            `polled run produced too few level changes: light ${transitions(r.light.edges)}, `
            + `heavy ${transitions(r.heavy.edges)}`);
        const lg = meanGap(r.light.edges);
        const hg = meanGap(r.heavy.edges);
        assert.ok(Math.abs(lg - HALF_MS) < 1, `light half-period ${lg.toFixed(3)} ms`);
        assert.ok(Math.abs(hg - lg) / lg < 0.08,
            `polled half-periods disagree: light ${lg.toFixed(3)} ms, heavy ${hg.toFixed(3)} ms`);
        console.log(`    [round trip] polled UIF: light ${lg.toFixed(3)} ms, heavy ${hg.toFixed(3)} ms`);
    });

    it('LEDGERED: labwired enters the TIM3 handler TWICE per update event', () => {
        // Measured 2026-08-29 against labwired-core 41119903c. The firmware
        // toggles PA0 once per ISR entry, so the edge count IS the entry count,
        // and TIM3 produces exactly one update event per millisecond.
        //
        // The light tier gives one edge per ms. labwired gives ~two. Its IRQ is
        // LEVEL-pended (`irq_level_held()` = SR & DIER & 0x1F), and the pending
        // latch is not cleared when the peripheral deasserts during the handler,
        // so the `TIM3_SR = 0` at the top of the ISR is followed by a second
        // entry anyway. On silicon the NVIC drops a level-triggered pending bit
        // once the source deasserts before the return.
        //
        // Consequence, and the reason the test above compares a PREFIX: any
        // interrupt-counted millisecond clock — which is what our codegen emits
        // — runs at DOUBLE speed on the heavy tier. Content agrees; rate does
        // not. The polled control above isolates it to the NVIC.
        //
        // The band is wide on purpose. It fails if the doubling gets worse, and
        // it fails if the light tier stops being exact — but an upstream fix
        // that brings labwired to 1.0 lands INSIDE it, so a repair does not
        // read as a regression. Tighten it to 1.0 when the fix ships.
        const ms = 40;
        const r = cached('01-blink', FW_IRQ_TOGGLE, ms);
        // +/- 1 because the update event on the window's last millisecond may
        // or may not be inside it; nothing else here is approximate.
        const lightPer = transitions(r.light.edges) / ms;
        const heavyPer = transitions(r.heavy.edges) / ms;
        console.log(`    [round trip] TIM3 handler entries per update event over ${ms} ms: `
            + `light ${lightPer.toFixed(2)}, heavy ${heavyPer.toFixed(2)}`);
        assert.ok(Math.abs(transitions(r.light.edges) - ms) <= 1,
            `the reference tier must enter the handler once per update event, got `
            + `${transitions(r.light.edges)} in ${ms} ms`);
        assert.ok(heavyPer >= 0.9 && heavyPer <= 2.2,
            `heavy tier entered the handler ${heavyPer.toFixed(2)}x per update event`);
    });

    it('11-toggle-button: the board drives the pad, and the firmware sees it', () => {
        // The other direction of the boundary. The bench wires a button to PA1
        // with a pull-up; the bridge must classify PA1 as a contact and give it
        // an injection binding, and the firmware must see the press through it.
        const netlist = benchNetlist('11-toggle-button');
        const opts = labwiredAdapterOptionsFor({ netlist, firmware: fw(FW_BUTTON).elf, name: 'bw-toggle' });
        assert.deepEqual(opts.refusals, []);
        assert.match(opts.systemYaml, /- id: "PA1"\n {2}kind: button/);

        const b = benchBoard(netlist, 'pa1');
        const adapter = createLabwiredAdapter({ wasm, ...opts });
        const uart = [];
        adapter.onSerial((x) => uart.push(x));
        adapter.attachBoard(b.board);

        // Released: the pull-up ladder holds PA1 high on OUR board, so no 'B'.
        for (let i = 0; i < RUN_MS / 2; i++) adapter.advanceNs(1_000_000n);
        const released = uart.filter((x) => x === 0x42).length;

        // Pressed: the button shorts PA1 to ground on OUR board, and the level
        // reaches the firmware only through the generated board_io binding.
        const btn = netlist.parts.find((p) => p.kind === 'button');
        b.board.setControl(btn.id, 1);
        for (let i = 0; i < RUN_MS / 2; i++) adapter.advanceNs(1_000_000n);
        const pressed = uart.filter((x) => x === 0x42).length;

        assert.equal(released, 0, 'the firmware saw a press that never happened');
        assert.ok(pressed > 0,
            'the press never reached the firmware — the generated board_io input '
            + 'binding is the only path it has, so this is the bridge failing');
    });

    it('the debug factory derives the manifest from the board it was given', async () => {
        // A host that already has the designer's board should not also have to
        // hand over a pin map — that second description is where the two
        // drawings of one bench diverge. `createDebugTarget('labwired', …)`
        // with no chipYaml/pins must produce a target that runs, and hand the
        // refusal ledger back so the host can explain a dead control.
        const netlist = benchNetlist('01-blink');
        const board = new BoardImpl(netlist.vcc ?? 5);
        board.setNetlist(netlist.parts, netlist.nets);
        const { target, adapter, refusals } = await createDebugTarget('labwired', {
            wasm, board, firmware: fw(FW_IRQ).elf, name: 'bw-derived',
        });
        assert.deepEqual(refusals, []);
        assert.match(adapter.systemYaml, /id: "LED_led1"/,
            'the manifest did not come from this board');
        assert.equal(target.state(), 'halted');
        target.step('insn', 1);
        target.runFor(1_000_000n);
        assert.ok(target.regs().pc >= 0x08000000, 'the derived target never ran');
    });

    it('a bench the bridge refuses does not quietly half-run', () => {
        // 02-dimmer's PA1 is a pot wiper. The bridge names the pad and refuses
        // its injection; `labwiredAdapterOptionsFor` lets that through (it is a
        // fidelity limit, not a broken board) and the reasons ride along, so a
        // host can say why the knob does nothing instead of showing a dead one.
        const netlist = benchNetlist('02-dimmer');
        const opts = labwiredAdapterOptionsFor({ netlist, firmware: fw(FW_IRQ).elf, name: 'bw-dimmer' });
        assert.equal(opts.refusals.length, 1);
        assert.equal(opts.refusals[0].code, 'analog-injection-unavailable');
        assert.equal(opts.refusals[0].subject, 'PA1');
        assert.match(opts.systemYaml, /kind: adc_input/,
            'the pad must still be NAMED — a silent drop is the bug we refuse');
    });
});
