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
 * OTYPER — WAS a shared cap, REPAIRED 2026-08-30 on both tiers in one commit
 * ------------------------------------------------------------------------
 * The first revision of this file ledgered that NEITHER tier carried OTYPER: a
 * pad configured open-drain and driven high was published as `pushpull` by
 * `stm32f0-board.js` (which stored the register and never read it) and by
 * `labwired-adapter.js` (whose `pin_routing` answers only
 * input/output/af/analog) alike, so the LED lit on both where silicon leaves it
 * dark. It was asserted as an AGREEMENT precisely so that a one-sided repair
 * could not land silently. This is the repair, and it is on both tiers.
 *
 * THE PHYSICS, which is the whole of it: an open-drain output is HALF a
 * driver. Driving 0 it pulls the pad to ground through the same on-resistance
 * push-pull uses — `pin-model.js` gives `opendrain` low and `pushpull` low the
 * identical Thévenin (0 V, R_STRONG). Driving 1 it simply LETS GO: the pad is
 * high-Z and nothing on the chip decides its level. An LED to ground stays
 * dark; an external pull-up makes the pad high through THAT resistor. When
 * PUPDR also asks for the internal pull-up the released pad is weakly pulled
 * rather than floating, which is exactly what `quasi` already describes.
 *
 * The three hand-computed oracles, all on the 3.3 V rail lite builds:
 *
 *   od LOW, active-low bench (VCC —[1 kΩ]— LED —▶|— PA0), pad = (0 V, 25 Ω):
 *     I = (3.3 − 2.0) / (1000 + 10 + 25) = 1.3/1035 = 1.256 038 647 3 mA
 *     brightness = 0.062 801 932 4          — the SAME number push-pull high
 *     V_pad = I·25 = 0.031 401 0 V            reaches, because it is the same
 *                                             Thévenin. Open drain DRIVES low.
 *
 *   od HIGH, active-high bench (PA0 —[1 kΩ]— LED —▶|— GND), pad = high-Z:
 *     no source anywhere in the loop ⇒ I = 0, brightness 0, V_pad = 0 V,
 *     readPin = 0. THE LED IS DARK. This is the case both tiers got wrong.
 *
 *   od HIGH + an external 10 kΩ pull-up to the rail, same bench:
 *     I = (3.3 − 2.0) / (10000 + 1000 + 10) = 1.3/11010 = 118.074 477 7 µA
 *     brightness = 0.005 903 723 9  (10.6× dimmer than the driven pad)
 *     V_pad = 3.3 − I·10000 = 2.119 255 222 5 V ⇒ readPin = 1
 *     The EXTERNAL resistor sets the current; the chip only stopped pulling.
 *
 * Corpus impact: zero, and measured — our codegen never emits an OTYPER write,
 * so nothing in the shipped gallery changes value. A foreign binary loaded
 * through the ⚡/📂 path is exactly what this repairs.
 *
 * Still shared, still ledgered (LABWIRED-BRIDGE.md §6): the firmware's own
 * READBACK of a released open-drain pad. Both tiers return ODR from IDR rather
 * than the pad, and the heavy one cannot do better — labwired's `effective_idr`
 * does not consult OTYPER, so teaching only the light tier would re-open the
 * gap this commit closes. Same for an open-drain ALTERNATE-FUNCTION pad (I²C),
 * whose release state no accessor reports.
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
import { R_STRONG, R_QUASI_PULLUP } from '../src/pin-model.js';
import { createStm32F0Adapter } from '../src/stm32-adapter.js';
import { Stm32Rcc, Stm32Gpio } from '../src/stm32f0-board.js';
import { createLabwiredAdapter } from '../src/labwired-adapter.js';
import { labwiredAdapterOptionsFor } from '../src/labwired-bridge.js';

registerAllDevices();

/** The bench lite improvises for a one-LED STM32F030 blink program. */
const BENCH = inferNetlist({
    device: 'STM32F030',
    clock: 48_000_000,
    pins: [{ name: 'led1', where: 'PA0', port: 0, bit: 0, direction: 'output', activeLow: false }],
});

/** The same improvisation for an ACTIVE-LOW pin: VCC —[1 kΩ]— LED —▶|— PA0.
 *  This is the bench on which a pad SINKING current lights the LED, and it is
 *  therefore the only one that can show that open drain still drives low. */
const BENCH_AL = inferNetlist({
    device: 'STM32F030',
    clock: 48_000_000,
    pins: [{ name: 'led1', where: 'PA0', port: 0, bit: 0, direction: 'output', activeLow: true }],
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

/** The active-low bench, on the same rail. */
function benchAL (vcc = VCC) {
    const b = new BoardImpl(vcc);
    b.setNetlist(BENCH_AL.parts, BENCH_AL.nets);
    return b;
}

/** The active-high bench with an EXTERNAL pull-up hung on the pad node. This
 *  is the network a real open-drain design puts there, and the whole point of
 *  the mode: with the pad released, THIS resistor decides the pad. */
function benchWithPullup (ohms, vcc = VCC) {
    const padNet = BENCH.nets.find((n) => n.terminals.some((t) => t.part === 'MCU'));
    const vccNet = BENCH.nets.find((n) => n.terminals.some((t) => t.part === 'VCC'));
    assert.ok(padNet && vccNet, 'the improvised bench must expose a pad net and a rail net');
    const parts = [...BENCH.parts,
        { id: 'R_pu', kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] }];
    const nets = BENCH.nets.map((n) =>
        n.id === padNet.id ? { ...n, terminals: [...n.terminals, { part: 'R_pu', terminal: 'a' }] }
            : n.id === vccNet.id ? { ...n, terminals: [...n.terminals, { part: 'R_pu', terminal: 'b' }] }
                : n);
    const b = new BoardImpl(vcc);
    b.setNetlist(parts, nets);
    return b;
}

/** Settle a bench for a whole brightness window and report what it reads. */
function settled (b) {
    b.advanceTo(b.timeNs + 25_000_000n);
    return {
        i: b.ledCurrents.get('LED_led1'),
        brightness: b.ledBrightness('LED_led1'),
        vPad: b.readAnalog('PA0'),
        logic: b.readPin('PA0'),
    };
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

// ─── Open drain, hand-derived (ungated: this runs in ordinary CI) ───────────

describe('open drain: the pad that lets go', () => {
    // Every expectation below is recomputed from the same terms the prose
    // names, so a moved constant moves the number with it.
    const I_SINK = (VCC - LED_VF) / (R_SERIES + LED_RD + R_STRONG);
    const R_PU_EXT = 10_000;
    const I_PU_EXT = (VCC - LED_VF) / (R_PU_EXT + R_SERIES + LED_RD);
    const I_PU_INT = (VCC - LED_VF) / (R_QUASI_PULLUP + R_SERIES + LED_RD);

    it('od LOW is a real pull to ground — the SAME Thevenin as push-pull low', () => {
        // 1.3/1035 A again, and that is the claim: `opendrain` false and
        // `pushpull` false are the same (0 V, 25 Ω) source, so an open-drain
        // output sinks exactly as hard as a push-pull one. If a "fix" made
        // open drain high-Z in BOTH directions, this is what would catch it.
        assert.equal(I_SINK.toPrecision(10), '0.001256038647');
        assert.equal((I_SINK / I_RATED).toPrecision(10), '0.06280193237');

        const drive = (mode) => {
            const b = benchAL();
            b.setPin('PA0', mode, false);
            return settled(b);
        };
        const od = drive('opendrain');
        const pp = drive('pushpull');

        assert.ok(Math.abs(od.i - I_SINK) < 1e-12, `od sink ${od.i} A, hand ${I_SINK} A`);
        assert.ok(Math.abs(od.brightness - I_SINK / I_RATED) < 1e-9,
            `od-low brightness ${od.brightness}, hand ${I_SINK / I_RATED}`);
        assert.ok(Math.abs(od.vPad - I_SINK * R_STRONG) < 1e-9,
            `od-low pad ${od.vPad} V, hand ${I_SINK * R_STRONG} V`);
        assert.equal(od.logic, 0, 'a pad pulled to ground reads low');
        // Same source ⇒ same everything. Asserted, not asserted-in-prose.
        assert.equal(od.i, pp.i, 'open-drain low and push-pull low are one Thevenin');
        assert.equal(od.brightness, pp.brightness);
        assert.equal(od.vPad, pp.vPad);
    });

    it('od HIGH is high-Z: the LED is DARK and the pad is not a source', () => {
        // The bench the whole lane exists for. PA0 —[1 kΩ]— LED —▶|— GND with
        // ODR=1: on silicon the transistor is off, nothing sources current,
        // and the LED does not light. Push-pull on the same bench reads
        // 0.0628 — which is what BOTH tiers used to publish here.
        const b = bench();
        b.setPin('PA0', 'opendrain', true);
        const r = settled(b);
        assert.equal(r.i, 0, 'a released pad sources no current');
        assert.equal(r.brightness, 0, 'the LED on a released open-drain pad is DARK');
        assert.equal(r.vPad, 0, 'nothing holds the pad up, so the LED chain pulls it to GND');
        assert.equal(r.logic, 0);
        // The contrast, so "0" cannot be read as "the bench is broken".
        assert.ok(Math.abs(BRIGHT_ON - 0.06280193236714975) < 1e-15,
            'the push-pull value this is being contrasted with');
    });

    it('od HIGH + an external 10 kΩ pull-up: the RESISTOR sets the pad', () => {
        // 1.3/11010 A. The pad is high through the external network, at
        // 2.1193 V — above the 1.5 V logic threshold, so the pin reads 1 —
        // and the LED is lit but 10.6× dimmer than the driven pad, because
        // the pull-up, not the chip, is now the source impedance.
        assert.equal(I_PU_EXT.toPrecision(10), '0.0001180744777');
        assert.equal((I_PU_EXT / I_RATED).toPrecision(10), '0.005903723887');
        const vPad = VCC - I_PU_EXT * R_PU_EXT;
        assert.equal(vPad.toPrecision(10), '2.119255223');

        const b = benchWithPullup(R_PU_EXT);
        b.setPin('PA0', 'opendrain', true);
        const r = settled(b);
        assert.ok(Math.abs(r.i - I_PU_EXT) < 1e-12, `pulled-up od-high ${r.i} A, hand ${I_PU_EXT} A`);
        assert.ok(Math.abs(r.brightness - I_PU_EXT / I_RATED) < 1e-9,
            `brightness ${r.brightness}, hand ${I_PU_EXT / I_RATED}`);
        assert.ok(Math.abs(r.vPad - vPad) < 1e-9, `pad ${r.vPad} V, hand ${vPad} V`);
        assert.equal(r.logic, 1, 'an externally pulled-up released pad reads HIGH');
        assert.ok(r.brightness < BRIGHT_ON / 10,
            'the external resistor must dominate: a pulled-up pad is far dimmer than a driven one');

        // And the same pull-up on a DRIVEN pad is swamped by the 25 Ω driver —
        // which is why the pull-up only matters once the pad has let go.
        const driven = benchWithPullup(R_PU_EXT);
        driven.setPin('PA0', 'pushpull', true);
        assert.ok(Math.abs(settled(driven).brightness - BRIGHT_ON) < 1e-4,
            'a 10 kΩ pull-up beside a 25 Ω driver changes nothing measurable');
    });

    it('od HIGH with the INTERNAL pull-up is `quasi`, not floating', () => {
        // PUPDR=01 on an open-drain output is a weak pull-up on a released
        // pad, which is precisely `pin-model.js`'s `quasi` — so that mode is
        // reused rather than a seventh invented. 1.3/22710 A.
        assert.equal(I_PU_INT.toPrecision(10), '0.00005724350506');
        const b = bench();
        b.setPin('PA0', 'quasi', true);
        const r = settled(b);
        assert.ok(Math.abs(r.i - I_PU_INT) < 1e-12, `internal-pull od-high ${r.i} A`);
        assert.ok(Math.abs(r.vPad - (VCC - I_PU_INT * R_QUASI_PULLUP)) < 1e-9);
        assert.ok(r.brightness > 0 && r.brightness < BRIGHT_ON / 20,
            'a weakly pulled-up pad is lit, and barely');
    });
});

// ─── Both publishers read OTYPER (ungated: no wasm, no toolchain) ───────────

describe('open drain: the two publishers, at register level', () => {
    /** LIGHT TIER. The GPIO block alone, driven by register writes. */
    function lightPad ({ otyper = 0, pupdr = 0, moder = 1, odr = 1 }) {
        const rcc = new Stm32Rcc();
        rcc.write(0x14, 1 << 17);                   // AHBENR: GPIOA clock on
        const seen = [];
        const gpio = new Stm32Gpio({
            base: 0x48000000, portIndex: 0, portLetter: 'A', rcc,
            onPinChange: (pin, mode, high) => { if (pin === 'PA0') seen.push({ mode, high }); },
        });
        gpio.write(0x04, otyper);                   // OTYPER first, as the idiom does
        gpio.write(0x0c, pupdr);
        gpio.write(0x00, moder);
        gpio.write(0x14, odr);
        return seen;
    }

    it('OTYPER before MODER still reaches the board', () => {
        // OTYPER changes the DRIVE, not the level, so it produces no edge of
        // its own — and the F0 idiom writes it BEFORE MODER. Publishing only
        // on MODER/PUPDR/ODR would seat the pad push-pull and never correct
        // it, which is one half of how the original gap survived.
        const seen = lightPad({ otyper: 1 });
        assert.deepEqual(seen.at(-1), { mode: 'opendrain', high: true },
            `light tier published ${JSON.stringify(seen)}`);
        assert.ok(!seen.some((s) => s.mode === 'pushpull'),
            'an open-drain pad must never be described as push-pull');
    });

    it('the light tier maps the register combinations', () => {
        assert.equal(lightPad({ otyper: 0 }).at(-1).mode, 'pushpull');
        assert.equal(lightPad({ otyper: 1 }).at(-1).mode, 'opendrain');
        assert.equal(lightPad({ otyper: 1, pupdr: 1 }).at(-1).mode, 'quasi');
        // A push-pull output's pull is deliberately not published: a 40 kΩ
        // pull beside a 25 Ω driver moves nothing, and inventing a mode for it
        // would make the two tiers describe one pad differently.
        assert.equal(lightPad({ otyper: 0, pupdr: 1 }).at(-1).mode, 'pushpull');
        // Driving 0 is a real pull to ground in either drive.
        assert.deepEqual(lightPad({ otyper: 1, odr: 0 }).at(-1), { mode: 'opendrain', high: false });
    });

    /** HEAVY TIER. A fake engine — the derivation is ours, so it is testable
     *  without the 21 MB artifact, and it returns `Map`s the way
     *  serde-wasm-bindgen does so `plain()` is exercised too. */
    function heavyPad ({ otyper = 0, pupdr = 0, moder = 1, odr = 1, omitOtyper = false }) {
        const regs = { moder, otyper, pupdr, odr, idr: 0, afrl: 0, afrh: 0, ospeedr: 0, lckr: 0 };
        if (omitOtyper) delete regs.otyper;
        const routingOf = (p) => {
            const m = (moder >>> (2 * p)) & 3;
            return m === 1 ? 'output' : m === 2 ? 'af' : m === 3 ? 'analog' : 'input';
        };
        const levelOf = (p) => ((moder >>> (2 * p)) & 3) === 1 && ((odr >>> p) & 1) === 1;
        const sim = {
            watch_logic_signals: (rs) => rs.map((r, i) => new Map(Object.entries(
                { ch: i, kind: 'gpio', peripheral: r.peripheral, pin: r.pin, value: levelOf(r.pin) }))),
            sample_logic_signals: (rs) => rs.map((r) => new Map(Object.entries(
                { kind: 'gpio', peripheral: r.peripheral, pin: r.pin, value: levelOf(r.pin) }))),
            pin_routing: (rs) => rs.map((r) => new Map(Object.entries(
                { kind: 'gpio', peripheral: r.peripheral, pin: r.pin, mode: routingOf(r.pin) }))),
            get_peripheral_snapshot: () => new Map(Object.entries(regs)),
            read_logic_edges: () => new Map(Object.entries(
                { cursor: 0, dropped: 0, edges: [], nowCycle: 0 })),
            step_batch: () => {},
            set_board_io_input: () => {},
            drain_uart_output: () => new Uint8Array(0),
        };
        const seen = [];
        const board = {
            setPin: (pin, mode, high) => { if (pin === 'PA0') seen.push({ mode, high }); },
            advanceTo: () => {},
            readPin: () => 0,
            readAnalog: () => 0,
        };
        const adapter = createLabwiredAdapter({
            wasm: { WasmSimulator: { new_from_config: () => sim } },
            chipYaml: 'name: fake',
            pins: { PA0: { peripheral: 'gpioPortA', pin: 0 } },
        });
        adapter.attachBoard(board);
        return seen;
    }

    it('the heavy tier derives the same modes from the same registers', () => {
        assert.deepEqual(heavyPad({ otyper: 0 }).at(-1), { mode: 'pushpull', high: true });
        assert.deepEqual(heavyPad({ otyper: 1 }).at(-1), { mode: 'opendrain', high: true });
        assert.deepEqual(heavyPad({ otyper: 1, pupdr: 1 }).at(-1), { mode: 'quasi', high: true });
        assert.deepEqual(heavyPad({ otyper: 0, pupdr: 1 }).at(-1), { mode: 'pushpull', high: true });
        assert.deepEqual(heavyPad({ otyper: 1, odr: 0 }).at(-1), { mode: 'opendrain', high: false });
    });

    it('a family whose snapshot has no OTYPER stays push-pull, not invented', () => {
        // The F1 encodes drive in CRL/CRH and nRF52 in PIN_CNF; neither hands
        // back a numeric `otyper`. Same defensive shape as the pull.
        assert.deepEqual(heavyPad({ otyper: 1, omitOtyper: true }).at(-1),
            { mode: 'pushpull', high: true });
    });

    it('the two publishers agree on every combination, cell by cell', () => {
        // THE PARITY CLAIM, in the one place it can be checked without the
        // engine: same registers in, same mode out, for the whole truth table.
        // A one-sided repair fails here as well as in the gated run below.
        const cases = [
            { otyper: 0, pupdr: 0 }, { otyper: 1, pupdr: 0 },
            { otyper: 0, pupdr: 1 }, { otyper: 1, pupdr: 1 },
            { otyper: 1, pupdr: 2 }, { otyper: 1, pupdr: 0, odr: 0 },
            { otyper: 0, pupdr: 0, odr: 0 },
        ];
        for (const c of cases) {
            const light = lightPad(c).at(-1);
            const heavy = heavyPad(c).at(-1);
            assert.deepEqual(heavy, light,
                `tiers disagree for OTYPER=${c.otyper} PUPDR=${c.pupdr} ODR=${c.odr ?? 1}: `
                + `light ${JSON.stringify(light)}, heavy ${JSON.stringify(heavy)}`);
        }
        // The table must actually contain the repaired cell, or "they agree"
        // is the agreement of seven push-pull rows.
        assert.ok(cases.some((c) => lightPad(c).at(-1).mode === 'opendrain'));
        assert.ok(cases.some((c) => lightPad(c).at(-1).mode === 'quasi'));
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

/** OTYPER set before MODER: an open-drain output, driven high. The pad has
 *  LET GO — on the active-high bench the LED must be dark on both tiers. */
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

/** The same open-drain pad driving LOW. Run against the ACTIVE-LOW bench,
 *  where a sinking pad lights the LED: the control that stops "open drain is
 *  high-Z" from being implemented as high-Z in both directions. */
const FW_OPENDRAIN_LOW = `${PROLOGUE}
int main(void)
{
    bw_clocks();
    GPIOA_OTYPER = 1u;
    GPIOA_MODER = (1u << 0);
    GPIOA_BSRR = (1u << 16);
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
    function tapped (make = bench) {
        const b = make();
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
    function bothTiers (source, ms, netlist = BENCH, make = bench) {
        const key = `${source.length}|${ms}|${netlist === BENCH ? 'ah' : 'al'}`;
        if (runs.has(key)) return runs.get(key);
        const image = fw(source);

        const light = tapped(make);
        const lightSamples = sample(
            createStm32F0Adapter({ program: image.bin, clockHz: 48_000_000 }), light.board, ms);

        const opts = labwiredAdapterOptionsFor({
            netlist, firmware: image.elf, name: 'pad-drive-parity', chipKind: 'stm32f030',
        });
        const heavy = tapped(make);
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

    it('REPAIRED: an open-drain pad driving 1 is DARK on both tiers', () => {
        // This was the ledgered shared cap, and it is the repair. An
        // open-drain output driving 1 has let go of the pad; on the active-high
        // bench nothing else sources current, so the LED is dark and the pad
        // sits at 0 V. Before the repair BOTH tiers published `pushpull` here
        // and lit it at 0.0628.
        //
        // Each tier is asserted SEPARATELY against the correct answer, and the
        // two are then asserted equal. That is what keeps the one-sided
        // mutation control: reverting either publisher alone (light tier —
        // drop the OTYPER read in `_publishAll`; heavy tier — drop the
        // `openDrain` branch in `modeOf`) makes that tier read 0.0628, which
        // fails its own assertion AND the agreement.
        const r = bothTiers(FW_OPENDRAIN, 40);
        const l = peak(r.lightSamples), h = peak(r.heavySamples);
        console.log(`    [pad parity] open-drain high: light ${l.toFixed(6)}  heavy ${h.toFixed(6)}`);
        assert.ok(l < BRIGHT_ON / 1000, `light tier lit a released open-drain pad: ${l}`);
        assert.ok(h < BRIGHT_ON / 1000, `heavy tier lit a released open-drain pad: ${h}`);
        assert.ok(Math.abs(l - h) < 1e-9,
            `the tiers disagree about an open-drain pad: light ${l}, heavy ${h}`);

        // …and they say so in the same words, which is the channel a
        // disagreement would have to travel through: boundary A carries a MODE.
        for (const [name, t] of [['light', r.light], ['heavy', r.heavy]]) {
            const first = t.modes.indexOf('opendrain');
            assert.notEqual(first, -1, `${name} tier never published PA0 as open-drain`);
            assert.deepEqual([...new Set(t.modes.slice(0, first))].sort(), first ? ['input'] : [],
                `${name} pad modes before configuration: ${t.modes.slice(0, first).join(', ')}`);
            assert.deepEqual([...new Set(t.modes.slice(first))], ['opendrain'],
                `${name} tier stopped describing PA0 as open-drain mid-run`);
            assert.ok(!t.modes.includes('pushpull'),
                `${name} tier described an open-drain pad as push-pull`);
        }
    });

    it('REPAIRED: the same open-drain pad driving 0 still DRIVES, on both', () => {
        // The control on the repair. `opendrain` is high-Z in ONE direction
        // only: driving 0 it pulls to ground through the same 25 Ω push-pull
        // uses. On the active-low bench (VCC —[1 kΩ]— LED —▶|— PA0) that means
        // the LED lights at the hand-computed 1.3/1035 A ⇒ 0.0628 — the same
        // number the push-pull bench reaches, because it is the same Thevenin.
        // Without this, "open drain never sources" could be implemented as
        // "open drain never drives" and every assertion above would still pass.
        const r = bothTiers(FW_OPENDRAIN_LOW, 40, BENCH_AL, benchAL);
        const l = peak(r.lightSamples), h = peak(r.heavySamples);
        console.log(`    [pad parity] open-drain low (active-low bench): light ${l.toFixed(6)}`
            + `  heavy ${h.toFixed(6)}  hand ${BRIGHT_ON.toFixed(6)}`);
        assert.ok(Math.abs(l - BRIGHT_ON) < 1e-6, `light od-low peak ${l}, hand ${BRIGHT_ON}`);
        assert.ok(Math.abs(h - BRIGHT_ON) < 1e-6, `heavy od-low peak ${h}, hand ${BRIGHT_ON}`);
        assert.ok(Math.abs(l - h) < 1e-6,
            `the tiers sink differently through an open-drain pad: light ${l}, heavy ${h}`);
        for (const [name, t] of [['light', r.light], ['heavy', r.heavy]]) {
            assert.ok(t.modes.includes('opendrain'), `${name} tier never published open-drain`);
            assert.ok(!t.modes.includes('pushpull'), `${name} tier fell back to push-pull`);
        }
    });
});
