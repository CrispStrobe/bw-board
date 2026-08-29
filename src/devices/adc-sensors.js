/**
 * ADC-class sensor parts — MCP3008, HX711, TCS3200. Clean-room from the
 * Microchip, Avia Semiconductor and TAOS datasheets; the three most-wired
 * "analog world → digital protocol" hobby parts after the XPT2046.
 *
 * MCP3008: 8-channel 10-bit SPI ADC, the canonical analog bridge. CS
 * active low; MOSI carries start bit, SGL/DIFF, three channel bits; the
 * conversion streams back as a null bit + 10 bits MSB-first. Channels
 * read the ch0-ch7 terminal voltages against the vref terminal (tie it
 * to VCC on the breadboard, exactly as the boards do). Differential
 * pairs are modeled as the plain difference, clamped at zero (the real
 * part cannot go negative either). Implementation is bit-position
 * arithmetic on a 17-clock window, so drivers that clock 3×8 bits and
 * shift, and drivers that clock exactly 17 bits, both decode.
 *
 * HX711: 24-bit load-cell ADC. No commands — DOUT falls when a
 * conversion is ready, the master clocks 25/26/27 pulses: 24 data bits
 * MSB-first (two's complement) then 1-3 extra pulses selecting the NEXT
 * conversion's input/gain (25 → A×128, 26 → B×32, 27 → A×64). Input
 * values come from params.valueA / params.valueB (raw signed counts —
 * load cells live at microvolts, which is below MNA's honest range, so
 * the counts ARE the simulator-level input, like the ultrasonic's
 * distance). Conversion pacing per params.rateHz (10 default, 80 with
 * the RATE strap). Holding SCK high >60 µs powers down; waking resets
 * to channel A gain 128 — both datasheet behaviors, both modeled.
 *
 * TCS3200: color → square wave. S2/S3 select the photodiode bank
 * (00 red, 01 blue, 10 clear, 11 green), S0/S1 scale the output
 * frequency (00 power down, 01 2%, 10 20%, 11 100%); OUT toggles at
 * fullScaleHz × scale × channel intensity, with intensities from
 * params.red/green/blue/clear (0..1). fullScaleHz defaults to 600 kHz
 * (datasheet typical at 100%). The wave is generated from machine time,
 * so pulse-counting and period-timing firmware both measure it.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_OUT = 50;
const R_OFF = 1e9;
// Input pins draw nothing here, on purpose. These models used to declare
// `ctx.conductance(pin, null, 1 / R_INPUT)` with R_INPUT = 1e6 — a call that
// names no second terminal, which stampTwoTerminal's air-leg guard declines,
// so it never stamped. 1 MOhm is not a CMOS input either (a 74HC draws 1 uA
// max). The ideal high-Z input IS the model, and GMIN keeps every pin a real
// node. See spec-updates/ideal-high-z-inputs.md.

export function registerAdcSensors() {

    // ─── MCP3008 ───────────────────────────────────────────────────────
    registerDevice('mcp3008', {
        terminals: ['vcc', 'gnd', 'vref', 'csb', 'clk', 'din', 'dout',
            'ch0', 'ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'ch7'],

        init() {
            return {
                drives: { dout: { vTh: 0, rTh: R_OFF } },
                _cs: true, _clk: false,
                _pos: 0,        // clock position within the transaction
                _cfg: 0, _cfgBits: 0, _haveCfg: false,
                _result: 0,
            };
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            const cs = read('csb') > th;
            const clk = read('clk') > th;
            let changed = false;

            if (cs) {
                if (!state._cs) {
                    state._pos = 0; state._cfg = 0; state._cfgBits = 0;
                    state._haveCfg = false;
                    state.drives.dout = { vTh: 0, rTh: R_OFF };
                    changed = true;
                }
                state._cs = cs; state._clk = clk;
                return changed;
            }
            state._cs = cs;

            if (clk && !state._clk) {                  // rising: sample DIN
                const din = read('din') > th ? 1 : 0;
                if (!state._haveCfg) {
                    if (state._cfgBits === 0 && din === 0) {
                        // still hunting for the start bit; position idles
                    } else {
                        state._cfg = ((state._cfg << 1) | din) & 0x1f;
                        state._cfgBits++;
                        if (state._cfgBits === 5) {    // start+SGL/DIFF+D2..D0
                            state._haveCfg = true;
                            state._pos = 0;
                            state._result = sample(part, state._cfg, read, vcc);
                        }
                    }
                }
            }
            if (!clk && state._clk && state._haveCfg) { // falling: drive DOUT
                // Datasheet timing: after D0 come 1.5 clocks of sample
                // period (positions 0-1), the null bit (2), then the ten
                // result bits MSB-first (3-12) — which is what makes the
                // canonical 17-clock / 3-byte drivers decode.
                let bit = 0;
                if (state._pos >= 3 && state._pos <= 12) {
                    bit = (state._result >> (12 - state._pos)) & 1;
                }
                state._pos++;
                const want = { vTh: bit ? vcc : 0, rTh: R_OUT };
                if (state.drives.dout.vTh !== want.vTh || state.drives.dout.rTh !== R_OUT) {
                    state.drives.dout = want;
                    changed = true;
                }
            }
            state._clk = clk;
            return changed;
        },
    });

    // ─── HX711 ─────────────────────────────────────────────────────────
    registerDevice('hx711', {
        terminals: ['vcc', 'gnd', 'dout', 'sck'],

        init() {
            return {
                drives: { dout: { vTh: 5, rTh: R_OUT } },   // high = busy
                _sck: false, _sckHighNs: -1n,
                _ready: false, _nextReadyNs: -1n,   // set on first update: the
                // first conversion still takes a full period after power-up
                _bits: 0, _word: 0,
                _mode: 'a128',                              // next conversion's input
                _powered: true,
            };
        },

        update(part, state, read, tNs) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            const sck = read('sck') > th;
            let changed = false;

            // Power-down: SCK held high longer than 60 µs.
            if (sck && state._sckHighNs >= 0n && tNs - state._sckHighNs > 60_000n && state._powered) {
                state._powered = false;
                state._ready = false;
                state._mode = 'a128';                       // datasheet: reset on wake
            }
            if (sck && !state._sck) state._sckHighNs = tNs;
            if (!sck && state._sck) {
                if (!state._powered) {                      // waking up
                    state._powered = true;
                    state._nextReadyNs = tNs + periodNs(part);
                }
                state._sckHighNs = -1n;
            }

            if (state._nextReadyNs < 0n) state._nextReadyNs = tNs + periodNs(part);
            // Conversion pacing: DOUT falls when a result is ready. The
            // frame flag clears here too — by the time the next conversion
            // lands, any 26th/27th pulse has long been counted.
            if (state._powered && !state._ready && tNs >= state._nextReadyNs) {
                state._ready = true; state._inFrame = false; state._bits = 0;
                state._word = currentCounts(part, state._mode);
                state.drives.dout = { vTh: 0, rTh: R_OUT };
                changed = true;
            }

            // Data clocking: bit appears on DOUT after each SCK rising edge.
            // The frame stays open past pulse 25 so the mode-select pulses
            // (26 → B×32, 27 → A×64) still count — resetting at pulse 25
            // made 26-pulse drivers silently stay on channel A.
            if (sck && !state._sck && state._powered && (state._ready || state._inFrame)) {
                state._inFrame = true;
                state._bits++;
                let level;
                if (state._bits <= 24) {
                    level = (state._word >> (24 - state._bits)) & 1;
                } else {
                    level = 1;                              // DOUT returns high (busy)
                    if (state._bits === 25) state._mode = 'a128';
                    if (state._bits === 26) state._mode = 'b32';
                    if (state._bits === 27) state._mode = 'a64';
                    // Each frame-closing pulse re-arms the next conversion.
                    state._ready = false;
                    state._nextReadyNs = tNs + periodNs(part);
                }
                state.drives.dout = { vTh: level ? vcc : 0, rTh: R_OUT };
                changed = true;
            }
            state._sck = sck;
            return changed;
        },
    });

    // ─── TCS3200 ───────────────────────────────────────────────────────
    registerDevice('tcs3200', {
        terminals: ['vcc', 'gnd', 's0', 's1', 's2', 's3', 'oe', 'out'],

        init() {
            return {
                drives: { out: { vTh: 0, rTh: R_OUT } },
                _level: 0,
            };
        },

        update(part, state, read, tNs) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            if (read('oe') > th) {                          // /OE high: three-state
                if (state.drives.out.rTh !== R_OFF) {
                    state.drives.out = { vTh: 0, rTh: R_OFF };
                    return true;
                }
                return false;
            }
            const s0 = read('s0') > th ? 1 : 0;
            const s1 = read('s1') > th ? 1 : 0;
            const scale = [0, 0.02, 0.2, 1.0][(s0 << 1) | s1];
            if (scale === 0) {                              // power down: park low
                if (state._level !== 0 || state.drives.out.rTh === R_OFF) {
                    state._level = 0;
                    state.drives.out = { vTh: 0, rTh: R_OUT };
                    return true;
                }
                return false;
            }
            const s2 = read('s2') > th ? 1 : 0;
            const s3 = read('s3') > th ? 1 : 0;
            const chan = ['red', 'blue', 'clear', 'green'][(s2 << 1) | s3];
            const intensity = Math.max(0, Math.min(1, part.params?.[chan] ?? 0));
            const full = part.params?.fullScaleHz ?? 600_000;
            const f = full * scale * intensity;
            if (f <= 0) {
                if (state._level !== 0) { state._level = 0; state.drives.out = { vTh: 0, rTh: R_OUT }; return true; }
                return false;
            }
            // Square wave from machine time: level flips every half period.
            const halfNs = 0.5e9 / f;
            const level = Math.floor(Number(tNs) / halfNs) % 2;
            if (level !== state._level) {
                state._level = level;
                state.drives.out = { vTh: level ? vcc : 0, rTh: R_OUT };
                return true;
            }
            return false;
        },
    });
}

function sample(part, cfg, read, vcc) {
    const sgl = (cfg >> 3) & 1;
    const ch = cfg & 0x07;
    const vref = read('vref') || vcc;
    let v;
    if (sgl) {
        v = read(`ch${ch}`);
    } else {
        // Differential pairs per datasheet: IN+ alternates within the pair.
        const base = ch & 0x06;
        const plus = read(`ch${base + (ch & 1)}`);
        const minus = read(`ch${base + 1 - (ch & 1)}`);
        v = plus - minus;
    }
    return Math.max(0, Math.min(1023, Math.round((v / vref) * 1023)));
}

function periodNs(part) {
    const rate = part.params?.rateHz ?? 10;
    return BigInt(Math.round(1e9 / rate));
}

function currentCounts(part, mode) {
    const raw = mode === 'b32' ? (part.params?.valueB ?? 0) : (part.params?.valueA ?? 0);
    let w = Math.max(-0x800000, Math.min(0x7fffff, Math.trunc(raw)));
    if (w < 0) w += 0x1000000;                              // two's complement
    return w;
}

export default registerAdcSensors;
