/**
 * ESP32 LEDC duty reaches the circuit — the heavy tier's classic-ESP32 bench.
 *
 * Until labwired-core's B9 change the ESP32 LEDC was a register bank: an
 * `analogWrite` / `ledcWrite` programmed it and the pad read the idle GPIO
 * latch, so a dimmed LED on an ESP32 was dark (and this tier exposed no ESP32
 * bench at all). Now each LEDC channel is a real waveform routed through the
 * GPIO matrix, its edges arrive through the same `read_logic_edges` stream as
 * any GPIO write, and the board switches the LED on and off at those cycles —
 * the B1 model: one mechanism for LED, motor and servo, no averaged drive.
 *
 * The firmware is a REAL Arduino-ESP32 2.0.17 image
 * (test/fixtures/labwired/esp32-ledc-bench, provenance in its README):
 *
 *   GPIO19 digitalWrite(HIGH)        -> full on  (the reference)
 *   GPIO2  analogWrite(64)           -> 25 %     (1 kHz, 8 bit, LS channel 7)
 *   GPIO5  ledcWrite(0, 768 of 2^10) -> 75 %     (5 kHz, 10 bit, HS channel 0)
 *   GPIO18 analogWrite(0)            -> 0 %
 *
 * each pad -> 220 Ω -> red LED -> GND, on the classic DevKit board the bridge
 * now carries (`esp32_devkit`). The assertion is B1's: average LED current as a
 * fraction of the full-on LED, within 1 % of full-on.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { BoardImpl } from '../src/board.js';
import { createLabwiredAdapter } from '../src/labwired-adapter.js';
import { labwiredAdapterOptionsFor } from '../src/labwired-bridge.js';

const here = dirname(fileURLToPath(import.meta.url));
const WASM_DIR = process.env.LABWIRED_WASM;
const skip = !WASM_DIR ? 'set LABWIRED_WASM to the wasm-bindgen NODEJS out-dir'
    : !existsSync(join(WASM_DIR, 'labwired_wasm.js')) ? `no labwired_wasm.js in ${WASM_DIR}`
        : false;

const FIRMWARE = new Uint8Array(readFileSync(
    join(here, 'fixtures/labwired/esp32-ledc-bench/firmware.elf')));
const VCC = 3.3;
const LED_I_RATED = 0.02; // ledBrightness() is average current / 20 mA
const MS = 1_000_000n;
/** When the LEDs are read: comfortably after setup() (see the probe). */
const READ_AT_MS = 60n;

/** pin -> 220 Ω -> red LED -> GND, for each pin, around one generic `mcu`. */
function bench (pins) {
    const parts = [{ id: 'mcu', kind: 'mcu', params: { pins }, terminals: pins },
        { id: 'g', kind: 'gnd', params: {}, terminals: ['gnd'] }];
    const nets = [];
    const gnd = { id: 'ngnd', terminals: [{ part: 'g', terminal: 'gnd' }] };
    for (const pin of pins) {
        parts.push({ id: `r_${pin}`, kind: 'resistor', params: { ohms: 220 }, terminals: ['a', 'b'] });
        parts.push({ id: `led_${pin}`, kind: 'led', params: { vf: 2.0, color: 'red' },
            terminals: ['anode', 'cathode'] });
        nets.push({ id: `n_${pin}`, terminals: [{ part: 'mcu', terminal: pin }, { part: `r_${pin}`, terminal: 'a' }] });
        nets.push({ id: `m_${pin}`, terminals: [{ part: `r_${pin}`, terminal: 'b' }, { part: `led_${pin}`, terminal: 'anode' }] });
        gnd.terminals.push({ part: `led_${pin}`, terminal: 'cathode' });
    }
    nets.push(gnd);
    return { parts, nets };
}

describe('ESP32 LEDC duty reaches the circuit (heavy tier, classic ESP32 bench)', { skip }, () => {
    const require = createRequire(import.meta.url);
    const wasm = WASM_DIR ? require(join(WASM_DIR, 'labwired_wasm.js')) : null;
    const PINS = ['gpio19', 'gpio2', 'gpio5', 'gpio18'];

    let run = null;
    function measure () {
        if (run) return run;
        const netlist = bench(PINS);
        const opts = labwiredAdapterOptionsFor({ netlist, firmware: FIRMWARE, chipKind: 'esp32_devkit',
            name: 'esp32-ledc-bench' });
        const board = new BoardImpl(VCC);
        board.setNetlist(netlist.parts, netlist.nets);
        board.setPower(true);
        const adapter = createLabwiredAdapter({ wasm, ...opts });
        adapter.attachBoard(board);
        // The LED reads a 20 ms window, and both carriers (1 kHz, 5 kHz) divide
        // 20 ms, so ONE reading is exact over whole periods (B1). Read after
        // boot (FreeRTOS on both cores, then setup()): the probe below prints
        // the first instant the full-on reference (set first in setup()) is lit.
        let at = 0n;
        const runTo = (ns) => { if (ns > at) { adapter.advanceNs(ns - at); at = ns; } };
        let lit = null;
        for (let t = 1n; t <= READ_AT_MS; t++) {
            runTo(t * MS);
            if (lit === null && board.ledBrightness('led_gpio19') > 0) lit = t;
        }
        const ma = Object.fromEntries(PINS.map((p) => [p, board.ledBrightness(`led_${p}`) * LED_I_RATED * 1000]));
        assert.ok(lit !== null && lit + 21n <= READ_AT_MS,
            `the 20 ms window must lie after setup(): first lit at ${lit} ms, read at ${READ_AT_MS} ms`);
        run = { ma, opts };
        console.log(`    [esp32 ledc] first lit ${lit} ms; LED mA at ${READ_AT_MS} ms: `
            + PINS.map((p) => `${p} ${ma[p].toFixed(3)}`).join('  '));
        return run;
    }

    it('the DevKit bench carries to the heavy tier with an empty ledger', () => {
        assert.deepEqual(measure().opts.refusals, []);
        assert.equal(measure().opts.arduinoEsp32, true, 'the bench must ask for the Arduino boot');
    });

    it('the full-on reference lights the LED', () => {
        const full = measure().ma.gpio19;
        assert.ok(full > 3, `GPIO19 HIGH through 220 Ω should drive a few mA, got ${full} mA`);
    });

    for (const [pin, want, what] of [
        ['gpio2', 0.25, 'analogWrite(64) at 1 kHz'],
        ['gpio5', 0.75, 'ledcWrite(768 of 1024) at 5 kHz'],
        ['gpio18', 0, 'analogWrite(0)'],
    ]) {
        it(`${what} on ${pin} lights the LED at ${want * 100} % of full on`, () => {
            const { ma } = measure();
            const frac = ma[pin] / ma.gpio19;
            assert.ok(Math.abs(frac - want) < 0.01,
                `${pin}: ${ma[pin].toFixed(4)} mA = ${(frac * 100).toFixed(3)} % of full on, want ${want * 100} %`);
        });
    }
});
