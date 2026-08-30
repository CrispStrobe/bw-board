/**
 * PAD-DRIVE PARITY: is 0.06 the light tier's answer too, and is it right?
 *
 * fab-lwlite's live browser proof of the heavy (labwired) tier reported
 * `LED_led1` brightness swinging 0 → **0.06** on the bench lite improvises for
 * a one-LED STM32F030 blink program, and left one question open: does the
 * LIGHT tier (`CortexM0Machine` + `stm32f0-board.js`) agree, and if it does,
 * is 0.06 physically right for that bench at all — or is it a duty artifact?
 *
 * Both halves are answered here, and they are answered in the two places the
 * question actually lives:
 *
 *   1. THE ORACLE (ungated, runs in ordinary CI). The bench is solved by hand
 *      from `pin-model.js` and `board.js`'s LED chain, and the board is asked
 *      to reproduce the hand number. No emulator, no firmware, no toolchain —
 *      so the arithmetic below is a gate on every push, not only on the manual
 *      wasm workflow.
 *   2. THE PARITY RUN (gated on LABWIRED_WASM + arm-none-eabi-gcc, exactly like
 *      `labwired-roundtrip.test.mjs`). The SAME firmware on BOTH tiers against
 *      the SAME bench, brightness compared within a stated tolerance.
 *
 * THE HAND ARITHMETIC — the whole answer, written out
 * ---------------------------------------------------
 * `inferNetlist` improvises this for one active-high output pin, and lite's
 * STM32 runners (light AND heavy) build the board with `new BoardImpl(3.3)`:
 *
 *     PA0 ──[ R_led1 = 1000 Ω ]──▶|── LED_led1 (Vf 2.0 V, Rd 10 Ω) ── GND
 *
 * The pad, driven high in `pushpull` (`pin-model.js`):
 *
 *     Vth = VCC   = 3.3 V
 *     Rth = R_STRONG = 25 Ω
 *
 * The chain, solved exactly as `board.js::_solveLedChain` solves it:
 *
 *     I = (Vth_anode − Vth_cathode − Vf) / (Rth_anode + Rd + Rth_cathode)
 *       = (3.3 − 0 − 2.0) / (25 + 1000 + 10 + 0)
 *       = 1.3 / 1035
 *       = 1.256 038 647 3 mA
 *
 *     V_pad = 3.3 − I·25 = 3.3 − 0.031 401 = 3.268 599 0 V
 *
 * `ledBrightness` integrates that current over a 20 ms perception window and
 * normalises by the 20 mA rating:
 *
 *     brightness = I / 0.020 = 1.256 038 647 3e−3 / 0.020 = 0.062 801 932 4
 *
 * **0.0628 is the DC ON-STATE value, not a duty artifact.** The distinction is
 * the point of the question, so it is asserted rather than asserted-in-prose:
 * a blink whose half-period is much longer than 20 ms puts the whole window
 * inside one phase, so the PEAK of a blinking bench equals the DC value. A
 * brightness capped by DUTY ALONE — an LED that reached its 20 mA rating when
 * on, blinking at 33 % — would read 0.333. What actually caps this bench is the
 * 1 kΩ series resistor on a 3.3 V rail: it holds the on-current to 6.28 % of
 * the rating, a limit 5.3× tighter than any duty in the trace. The two caps are
 * independent and the resistor's wins.
 *
 * Sanity against silicon: a real red LED at ~1.3 mA sits near Vf ≈ 1.75 V, so a
 * real bench would pass (3.3 − 1.75)/1025 ≈ 1.5 mA. The model's 1.26 mA is the
 * same order and within ~20 % — this is a dim LED on the bench too, and the
 * engine is not lying about it. `brightness` is normalised average CURRENT, not
 * perceived luminance (`LED_I_RATED`), which is why a plainly-visible LED reads
 * 0.06: the eye is roughly logarithmic and this number deliberately is not.
 *
 * THE VERDICT: the two tiers AGREE, to 0 on the DC peak and 2.4e−6 across a
 * 200 ms blink. They agree BY CONSTRUCTION and the construction is worth
 * naming — boundary A is `setPin(name, mode, driveHigh)`, so both tiers hand
 * the board a MODE and the Thévenin comes from the ONE shared `pin-model.js`.
 * Neither engine owns a drive strength of its own. A divergence could therefore
 * only come from the two tiers publishing DIFFERENT MODES for the same register
 * state, which is what the mode assertions below actually test.
 *
 * LEDGERED, found while measuring: **neither tier carries OTYPER.** A pad
 * configured open-drain and driven high is published as `pushpull` by
 * `stm32f0-board.js` and by `labwired-adapter.js` alike, so the LED lights on
 * both where silicon would leave it dark. That is a shared fidelity cap, not a
 * parity gap, and it is asserted as an agreement below so that a one-sided fix
 * cannot land silently. Our codegen never emits OTYPER, so the corpus impact
 * today is zero; a foreign binary would see it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';

import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { inferNetlist } from '../src/infer-netlist.js';
import { R_STRONG } from '../src/pin-model.js';
import { createStm32F0Adapter } from '../src/stm32-adapter.js';
import { createLabwiredAdapter } from '../src/labwired-adapter.js';
import { labwiredAdapterOptionsFor } from '../src/labwired-bridge.js';

registerAllDevices();

/** The bench lite improvises for a one-LED STM32F030 blink program. */
const BENCH = inferNetlist({
    device: 'STM32F030',
    clock: 48_000_000,
    pins: [{ name: 'led1', where: 'PA0', port: 0, bit: 0, direction: 'output', activeLow: false }],
});

/** The rail lite's STM32 runners build the board on (`new BoardImpl(3.3)`). */
const VCC = 3.3;

/** Every number in the header, recomputed from the same terms rather than
 *  pasted, so a moved constant moves the expectation with it and the test
 *  keeps meaning what its prose says. */
const R_SERIES = 1000;   // infer-netlist's series resistor for an inferred LED
const LED_VF = 2.0;      // the inferred LED's vf param
const LED_RD = 10;       // board.js LED_RD
const I_RATED = 0.020;   // board.js LED_I_RATED
const I_ON = (VCC - LED_VF) / (R_STRONG + R_SERIES + LED_RD);
const BRIGHT_ON = I_ON / I_RATED;
const V_PAD_ON = VCC - I_ON * R_STRONG;

function bench (vcc = VCC) {
    const b = new BoardImpl(vcc);
    b.setNetlist(BENCH.parts, BENCH.nets);
    return b;
}

describe('pad drive: the inferred blink bench, solved by hand', () => {
    it('the improvised bench is the one the arithmetic describes', () => {
        const r = BENCH.parts.find((p) => p.id === 'R_led1');
        const led = BENCH.parts.find((p) => p.id === 'LED_led1');
        assert.equal(r.kind, 'resistor');
        assert.equal(r.params.ohms, R_SERIES,
            'the hand arithmetic in this file is written for the inferred series resistor');
        assert.equal(led.kind, 'led');
        assert.equal(led.params.vf, LED_VF);
        // Cathode on the ground net, anode through the resistor to the pad —
        // if this flipped, the hand loop equation would be the wrong loop.
        const gnd = BENCH.nets.find((n) =>
            n.terminals.some((t) => t.part === 'GND' && t.terminal === 'gnd'));
        assert.ok(gnd.terminals.some((t) => t.part === 'LED_led1' && t.terminal === 'cathode'));
    });

    it('0.0628, not 0.33: the board reproduces the hand-computed on-state', () => {
        // 1.3 / 1035 A through the chain; 3.3 − I·25 at the pad.
        assert.equal(I_ON.toPrecision(10), '0.001256038647');
        assert.equal(BRIGHT_ON.toPrecision(10), '0.06280193237');

        const b = bench();
        b.setPin('PA0', 'pushpull', true);
        b.advanceTo(b.timeNs + 1_000_000n);

        assert.ok(Math.abs(b.ledCurrents.get('LED_led1') - I_ON) < 1e-12,
            `solved ${b.ledCurrents.get('LED_led1')} A, hand ${I_ON} A`);
        assert.ok(Math.abs(b.readAnalog('PA0') - V_PAD_ON) < 1e-9,
            `pad ${b.readAnalog('PA0')} V, hand ${V_PAD_ON} V`);

        // Hold it for a full perception window so the integrator is saturated:
        // this is the number a browser reads off a lit LED, and it is 0.0628.
        b.advanceTo(b.timeNs + 25_000_000n);
        assert.ok(Math.abs(b.ledBrightness('LED_led1') - BRIGHT_ON) < 1e-9,
            `brightness ${b.ledBrightness('LED_led1')}, hand ${BRIGHT_ON}`);

        // The claim that makes 0.06 an ANSWER rather than a coincidence: the
        // cap is the resistor, not the duty. A duty-capped 33 % blink of a
        // rated-current LED reads 0.333 — 5.3x brighter than this bench can be
        // even when it is on continuously.
        assert.ok(BRIGHT_ON < 0.333 / 5,
            'the series resistor must be the binding cap, not the blink duty');
    });

    it('the same bench on a 5 V rail reads 0.1449 — the rail is why it is dim', () => {
        // The gallery's seated F030 bench carries vcc 5 in the fixture while
        // lite improvises at 3.3; the difference is entirely the rail, and
        // stating it here is what stops "0.06 vs 0.14" being read as a tier
        // disagreement later.
        const i5 = (5 - LED_VF) / (R_STRONG + R_SERIES + LED_RD);
        assert.equal((i5 / I_RATED).toPrecision(10), '0.1449275362');
        const b = bench(5);
        b.setPin('PA0', 'pushpull', true);
        b.advanceTo(b.timeNs + 25_000_000n);
        assert.ok(Math.abs(b.ledBrightness('LED_led1') - i5 / I_RATED) < 1e-9,
            `5 V brightness ${b.ledBrightness('LED_led1')}`);
    });

    it('a 50 % blink far slower than the window PEAKS at the on-state value', () => {
        // The mechanism behind "peak 0.06 on a blinking bench": the 20 ms
        // window sits wholly inside one phase, so the peak is the DC value and
        // the MEAN is the duty-weighted one. Both are asserted, because it is
        // the pair that rules out a duty artifact.
        const b = bench();
        const samples = [];
        for (let phase = 0; phase < 8; phase++) {
            b.setPin('PA0', 'pushpull', phase % 2 === 0);
            for (let i = 0; i < 200; i++) {          // 200 ms per phase
                b.advanceTo(b.timeNs + 1_000_000n);
                samples.push(b.ledBrightness('LED_led1'));
            }
        }
        const peak = Math.max(...samples);
        const mean = samples.reduce((a, x) => a + x, 0) / samples.length;
        assert.ok(Math.abs(peak - BRIGHT_ON) < 1e-9, `blink peak ${peak}, on-state ${BRIGHT_ON}`);
        assert.ok(Math.abs(mean - BRIGHT_ON / 2) < BRIGHT_ON * 0.02,
            `50 % duty mean ${mean}, expected ~${BRIGHT_ON / 2}`);
    });

    it('a blink FASTER than the window reads a steady duty-weighted 0.0314', () => {
        // The other side of the same mechanism, and the one that pins the
        // window LENGTH rather than only its existence: a 2 ms half-period puts
        // exactly five whole periods inside the 20 ms window, so the reading is
        // exactly half the on-state at every sample and does not ripple. Shrink
        // BRIGHTNESS_WINDOW_NS and the window no longer spans whole periods —
        // the reading starts swinging between the phases, which is what this
        // asserts it must not do. (Without this the 20 ms could be any value
        // shorter than a blink phase and nothing here would notice.)
        const b = bench();
        const samples = [];
        for (let phase = 0; phase < 100; phase++) {
            b.setPin('PA0', 'pushpull', phase % 2 === 0);
            for (let i = 0; i < 2; i++) {            // 2 ms per phase
                b.advanceTo(b.timeNs + 1_000_000n);
                samples.push(b.ledBrightness('LED_led1'));
            }
        }
        const settled = samples.slice(20);           // past the first full window
        const spread = Math.max(...settled) - Math.min(...settled);
        assert.ok(spread < BRIGHT_ON * 0.02,
            `a 4 ms square wave should read flat inside a 20 ms window; spread ${spread}`);
        const m = settled.reduce((a, x) => a + x, 0) / settled.length;
        assert.ok(Math.abs(m - BRIGHT_ON / 2) < BRIGHT_ON * 0.02,
            `fast-blink reading ${m}, expected ~${BRIGHT_ON / 2}`);
    });
});

// ─── The parity run: the same firmware on both tiers ────────────────────────

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

const HALF_MS = 20;
const PROLOGUE = `
#include <stdint.h>
#define BW_MMIO(a) (*(volatile uint32_t *)(a))
#define RCC_AHBENR   BW_MMIO(0x40021014u)
#define RCC_APB1ENR  BW_MMIO(0x4002101cu)
#define RCC_APB2ENR  BW_MMIO(0x40021018u)
#define GPIOA_MODER  BW_MMIO(0x48000000u)
#define GPIOA_OTYPER BW_MMIO(0x48000004u)
#define GPIOA_BSRR   BW_MMIO(0x48000018u)
#define TIM3_CR1     BW_MMIO(0x40000400u)
#define TIM3_SR      BW_MMIO(0x40000410u)
#define TIM3_PSC     BW_MMIO(0x40000428u)
#define TIM3_ARR     BW_MMIO(0x4000042cu)
#define HALF ${HALF_MS}u
static void bw_clocks(void) {
    RCC_AHBENR  = (1u << 17);
    RCC_APB1ENR = (1u << 1);
    RCC_APB2ENR = (1u << 14);
    TIM3_PSC = 48000000u / 1000000u - 1u;   /* 1 MHz count */
    TIM3_ARR = 999u;                        /* update every 1 ms */
}
`;
const VECTORS = `
__attribute__((section(".vectors"), used))
const void *vectors[2] = { (void *)0x20000ff0, (void *)main };
`;

/** PA0 driven high and left there. No timer, no NVIC, no sleep — the purest
 *  form of the question, with every timing difference between the two tiers
 *  removed from it. */
const FW_DC = `${PROLOGUE}
int main(void) { bw_clocks(); GPIOA_MODER = (1u << 0); GPIOA_BSRR = 1u; for (;;) {} }
${VECTORS}`;

/** The same 20 ms grid, POLLED off UIF. Deliberately not the interrupt-driven
 *  shape: `labwired-roundtrip.test.mjs` measured and ledgered that labwired
 *  enters a level-pended handler ~1.95x per update event, so an
 *  interrupt-counted blink runs at double RATE on the heavy tier. Comparing a
 *  time-weighted brightness across that would be re-measuring a known clock
 *  difference and calling it a circuit disagreement. Polled, the two tiers'
 *  half-periods agree to five parts in 100 000 (same file), so brightness is
 *  once again a claim about the PAD. */
const FW_POLL = `${PROLOGUE}
int main(void)
{
    bw_clocks();
    GPIOA_MODER = (1u << 0);
    TIM3_CR1 = 1u;
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
${VECTORS}`;

/** OTYPER set before MODER: an open-drain output, driven high. */
const FW_OPENDRAIN = `${PROLOGUE}
int main(void)
{
    bw_clocks();
    GPIOA_OTYPER = 1u;
    GPIOA_MODER = (1u << 0);
    GPIOA_BSRR = 1u;
    for (;;) {}
}
${VECTORS}`;

const LD = `ENTRY(main)
MEMORY { FLASH (rx) : ORIGIN = 0x08000000, LENGTH = 16K
         RAM  (rwx): ORIGIN = 0x20000000, LENGTH = 4K }
SECTIONS {
  .text : { KEEP(*(.vectors)) *(.text*) *(.rodata*) } > FLASH
  .bss  : { *(.bss*) *(COMMON) } > RAM
}
`;

function buildFirmware (source) {
    const dir = mkdtempSync(join(tmpdir(), 'pad-parity-'));
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

describe('pad drive: heavy and light tier, same firmware, same bench', { skip }, () => {
    const require = createRequire(import.meta.url);
    const wasm = WASM_DIR ? require(join(WASM_DIR, 'labwired_wasm.js')) : null;
    const built = new Map();
    const fw = (src) => {
        if (!built.has(src)) built.set(src, buildFirmware(src));
        return built.get(src);
    };

    /** One board per tier plus a tap on the modes PA0 was published under. */
    function tapped () {
        const b = bench();
        const modes = [];
        const inner = b.setPin.bind(b);
        b.setPin = (pin, mode, high) => {
            inner(pin, mode, high);
            if (String(pin).toLowerCase() === 'pa0') modes.push(mode);
        };
        return { board: b, modes };
    }

    /** Drive an adapter `ms` simulated milliseconds, sampling brightness per ms. */
    function sample (adapter, board, ms) {
        adapter.attachBoard(board);
        const out = [];
        for (let i = 0; i < ms; i++) {
            adapter.advanceNs(1_000_000n);
            out.push(board.ledBrightness('LED_led1'));
        }
        return out;
    }

    const runs = new Map();
    function bothTiers (source, ms) {
        const key = `${source.length}|${ms}`;
        if (runs.has(key)) return runs.get(key);
        const image = fw(source);

        const light = tapped();
        const lightSamples = sample(
            createStm32F0Adapter({ program: image.bin, clockHz: 48_000_000 }), light.board, ms);

        const opts = labwiredAdapterOptionsFor({
            netlist: BENCH, firmware: image.elf, name: 'pad-drive-parity', chipKind: 'stm32f030',
        });
        const heavy = tapped();
        const heavySamples = sample(createLabwiredAdapter({ wasm, ...opts }), heavy.board, ms);

        const r = { light, heavy, lightSamples, heavySamples, opts };
        runs.set(key, r);
        return r;
    }

    const peak = (s) => Math.max(...s);
    const mean = (s) => s.reduce((a, x) => a + x, 0) / s.length;

    it('the improvised bench bridges to the heavy tier with an empty ledger', () => {
        const r = bothTiers(FW_DC, 60);
        assert.deepEqual(r.opts.refusals, [],
            'a one-LED output bench must carry to the heavy tier with nothing refused');
    });

    it('DC high: both tiers land on the hand-computed 0.0628', () => {
        // Measured 2026-08-30 against labwired-core 41119903c: light peak
        // 0.062802, heavy peak 0.062802, |Δpeak| exactly 0. The tolerance is
        // 1e-6 — four orders of magnitude tighter than the 0.06-vs-0.33
        // question it answers, and still far looser than what was measured.
        const r = bothTiers(FW_DC, 60);
        const l = peak(r.lightSamples), h = peak(r.heavySamples);
        assert.ok(Math.abs(l - BRIGHT_ON) < 1e-6, `light peak ${l}, hand ${BRIGHT_ON}`);
        assert.ok(Math.abs(h - BRIGHT_ON) < 1e-6, `heavy peak ${h}, hand ${BRIGHT_ON}`);
        assert.ok(Math.abs(l - h) < 1e-6,
            `the two tiers drove the same pad to different brightness: light ${l}, heavy ${h}`);
        console.log(`    [pad parity] DC high: light ${l.toFixed(6)}  heavy ${h.toFixed(6)}  `
            + `hand ${BRIGHT_ON.toFixed(6)}`);
    });

    it('DC high: both tiers publish the pad as a driven push-pull output', () => {
        // The ONLY channel through which the two tiers could disagree about
        // brightness: boundary A carries a MODE, and pin-model.js turns the
        // mode into the Thévenin. Same modes ⇒ same drive ⇒ same current.
        const r = bothTiers(FW_DC, 60);
        for (const [name, t] of [['light', r.light], ['heavy', r.heavy]]) {
            const first = t.modes.indexOf('pushpull');
            assert.notEqual(first, -1, `${name} tier never drove PA0 push-pull`);
            assert.deepEqual([...new Set(t.modes.slice(0, first))].sort(), first ? ['input'] : [],
                `${name} pad modes before configuration: ${t.modes.slice(0, first).join(', ')}`);
            assert.deepEqual([...new Set(t.modes.slice(first))], ['pushpull'],
                `${name} tier stopped driving PA0 mid-run`);
        }
    });

    it('polled 20 ms blink: peaks and duty-weighted means agree', () => {
        // Measured 2026-08-30 over 200 ms: light peak 0.062801 / mean 0.028419,
        // heavy peak 0.062798 / mean 0.028418 — |Δpeak| 2.4e-6, |Δmean| 1.2e-6.
        // Tolerance 5e-5, ~20x the measured spread, so ordinary cycle-count
        // jitter on another machine does not read as a pad-drive change.
        const r = bothTiers(FW_POLL, 200);
        const lp = peak(r.lightSamples), hp = peak(r.heavySamples);
        const lm = mean(r.lightSamples), hm = mean(r.heavySamples);
        console.log(`    [pad parity] polled blink: light peak ${lp.toFixed(6)} mean ${lm.toFixed(6)}`
            + `  heavy peak ${hp.toFixed(6)} mean ${hm.toFixed(6)}`);
        assert.ok(Math.abs(lp - hp) < 5e-5, `blink peaks differ: light ${lp}, heavy ${hp}`);
        assert.ok(Math.abs(lm - hm) < 5e-5, `blink means differ: light ${lm}, heavy ${hm}`);

        // …and the peak is the DC on-state, which is the whole answer to
        // "is 0.06 a duty artifact?". It is not: the LED never gets brighter
        // than 0.0628 because the resistor will not let it, and a blink only
        // pulls the MEAN down from there.
        assert.ok(Math.abs(lp - BRIGHT_ON) < 5e-5, `blink peak ${lp} is not the on-state`);
        assert.ok(lm < lp * 0.75 && lm > lp * 0.25,
            `a 20 ms-half-period blink should land the mean between the phases: ${lm} vs peak ${lp}`);
        // Both tiers actually blinked — otherwise "the means agree" is the
        // agreement of two flat lines.
        assert.ok(Math.min(...r.lightSamples) < BRIGHT_ON / 10
            && Math.min(...r.heavySamples) < BRIGHT_ON / 10,
        'one of the tiers never turned the LED off');
    });

    it('LEDGERED: neither tier carries OTYPER, and they are wrong together', () => {
        // An open-drain pad driving 1 is high-Z on silicon and the LED stays
        // dark. Both tiers publish `pushpull` and light it at the same 0.0628.
        // This is asserted as an AGREEMENT, not as correctness: it is the shape
        // of a shared cap, and the assertion exists so that a one-sided repair
        // — labwired growing OTYPER upstream, or stm32f0-board.js growing it
        // here — cannot land without someone reading this comment. Our codegen
        // never writes OTYPER, so the shipped corpus is unaffected; a foreign
        // binary loaded through the ⚡/📂 path is not.
        //
        // When it is fixed, fix it on BOTH tiers in one commit and turn this
        // into: light 0, heavy 0, modes ['input', 'opendrain'].
        const r = bothTiers(FW_OPENDRAIN, 40);
        const l = peak(r.lightSamples), h = peak(r.heavySamples);
        assert.ok(Math.abs(l - h) < 1e-6,
            `the tiers disagree about an open-drain pad: light ${l}, heavy ${h}`);
        assert.ok(Math.abs(l - BRIGHT_ON) < 1e-6,
            `open-drain high reads ${l}; the ledgered behaviour is the push-pull value `
            + `${BRIGHT_ON} on both tiers`);
        assert.ok(r.light.modes.includes('pushpull') && r.heavy.modes.includes('pushpull'),
            'both tiers publish an open-drain output as push-pull — see the comment');
        assert.ok(!r.light.modes.includes('opendrain') && !r.heavy.modes.includes('opendrain'),
            'a tier grew OTYPER support: fix BOTH and rewrite this test');
    });
});
