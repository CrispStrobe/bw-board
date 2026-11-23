/**
 * Placeable bench instruments — voltmeter, ammeter, logic probe, and the
 * moving-coil analog meter as a parameter face. These are PARTS, not
 * panel widgets: drop a voltmeter across a net, wire an ammeter in
 * series, clip a probe to a pin — bench practice as circuit topology.
 * The UI reads each part's state (reading, level, pulsing) via
 * getDeviceState and renders it on the artwork.
 *
 * The electrical honesty is the point:
 *   - The voltmeter LOADS the circuit through its 10 MΩ input impedance
 *     (a real DMM's spec) — measure a 1 MΩ divider and the needle dips,
 *     here as on the bench.
 *   - The ammeter is a 0.1 Ω shunt IN SERIES; its burden voltage exists.
 *     Wiring it in parallel shorts the circuit — also as on the bench,
 *     and worth a DRC warning upstream someday.
 *   - The logic probe classifies against TTL-ish thresholds derived
 *     from its own power pins (0.3/0.7 × VCC) and reports FLOAT for the
 *     forbidden zone; PULSING latches when the level keeps flipping,
 *     with machine time deciding "keeps".
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_VOLTMETER = 10e6;    // DMM-class input impedance
const R_SHUNT = 0.1;         // ammeter burden
const R_PROBE = 1e6;         // logic probe input

const METER_COIL_OHMS = 100;  // moving-coil defaults: a 1 mA / 100 Ohm movement
const METER_IFS = 1e-3;

const positive = (x, fallback) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : fallback);
const analogMeterMode = (part) => (part.params?.mode === 'current' ? 'current' : 'voltage');
const analogMeterFullScale = (part) => positive(part.params?.fullScale, 5);

/**
 * The analog meter's terminal resistance: coil plus multiplier (voltage
 * mode, total fullScale / ifs, never below the coil itself) or coil in
 * parallel with its shunt (current mode, coilOhms * ifs / fullScale, never
 * above the coil). Exported so exporters and the UI read one definition.
 */
export function analogMeterOhms(part) {
    const coil = positive(part.params?.coilOhms, METER_COIL_OHMS);
    const ifs = positive(part.params?.ifs, METER_IFS);
    const fs = analogMeterFullScale(part);
    if (analogMeterMode(part) === 'current') return fs > ifs ? coil * ifs / fs : coil;
    return Math.max(coil, fs / ifs);
}

function invalidateMeasurement(state, reason) {
    if (!state) return;
    state.available = false;
    state.measurementError = reason;
    state.reading = null;
    if ('deflection' in state) state.deflection = null;
}

function measurementAvailable(state, read) {
    if (read.measurementError) {
        invalidateMeasurement(state, read.measurementError);
        return false;
    }
    state.available = true;
    state.measurementError = null;
    return true;
}

export function registerBenchMeters() {

    // ─── Voltmeter (digital face) ──────────────────────────────────────
    registerDevice('voltmeter', {
        terminals: ['a', 'b'],
        measurement: true,
        invalidateMeasurement,

        init() {
            return { drives: {}, reading: null, available: false, measurementError: 'No solved measurement yet' };
        },

        stamp(ctx) {
            ctx.conductance('a', 'b', 1 / R_VOLTMETER);
        },

        update(part, state, read) {
            if (!measurementAvailable(state, read)) return false;
            const v = read('a') - read('b');
            if (Number.isFinite(state.reading) && Math.abs(v - state.reading) < 0.0005) return false;
            state.reading = v;
            return false;                 // reading changed; no drives did
        },
    });

    // The moving-coil analog meter: a d'Arsonval movement, built the way the
    // instrument is. The needle follows the COIL CURRENT; the coil has a
    // resistance (params.coilOhms, default 100 Ohm) and a full-scale current
    // (params.ifs, default 1 mA). Ranging is done the way it is on the bench:
    //
    //   mode 'voltage' (default): a series multiplier brings the total to
    //     fullScale / ifs -- 5 kOhm for a 1 mA movement on a 5 V range, the
    //     "1000 Ohm/V" printed on the dial. THIS is the load the meter puts on
    //     the circuit: across the bottom of a 10k/10k divider it reads 1.25 V,
    //     not 2.5 V. A more sensitive movement (ifs 50 uA = 20 kOhm/V) loads
    //     it less. (Until 2026-11 the meter was a flat 10 MOhm, so loading
    //     could not be shown at all.)
    //   mode 'current': a shunt in parallel with the coil carries the rest
    //     of fullScale (amps); the burden is coilOhms * ifs / fullScale. With
    //     fullScale <= ifs there is no shunt -- a bare movement, so an external
    //     shunt resistor can be wired across it and its effect seen.
    //
    // params.fullScale (volts or amps, default 5) is where the needle pegs;
    // state.reading is the measured quantity (volts or amps), state.deflection
    // 0..1 (clamped, sign preserved in reading -- a backwards needle slam is a
    // real bench event), state.ohms the instrument's terminal resistance.
    registerDevice('analog_meter', {
        terminals: ['a', 'b'],
        measurement: true,
        invalidateMeasurement,

        init(part) {
            return { drives: {}, reading: null, deflection: null, ohms: analogMeterOhms(part),
                available: false, measurementError: 'No solved measurement yet' };
        },

        stamp(ctx, part) {
            ctx.conductance('a', 'b', 1 / analogMeterOhms(part));
        },

        update(part, state, read) {
            if (!measurementAvailable(state, read)) return false;
            const ohms = analogMeterOhms(part);
            state.ohms = ohms;
            const v = read('a') - read('b');
            const current = analogMeterMode(part) === 'current';
            const reading = current ? v / ohms : v;
            const eps = current ? 1e-9 : 0.0005;
            if (Number.isFinite(state.reading) && Math.abs(reading - state.reading) < eps) return false;
            state.reading = reading;
            const fs = analogMeterFullScale(part);
            state.deflection = Math.max(-0.1, Math.min(1.1, reading / fs));
            return false;
        },
    });

    // ─── Ammeter ───────────────────────────────────────────────────────
    registerDevice('ammeter', {
        terminals: ['a', 'b'],
        measurement: true,
        invalidateMeasurement,

        init() {
            return { drives: {}, reading: null, available: false, measurementError: 'No solved measurement yet' }; // amps, a→b positive
        },

        stamp(ctx) {
            ctx.conductance('a', 'b', 1 / R_SHUNT);
        },

        update(part, state, read) {
            if (!measurementAvailable(state, read)) return false;
            const i = (read('a') - read('b')) / R_SHUNT;
            if (Number.isFinite(state.reading) && Math.abs(i - state.reading) < 1e-6) return false;
            state.reading = i;
            return false;
        },
    });

    // ─── Logic probe ───────────────────────────────────────────────────
    registerDevice('logic_probe', {
        terminals: ['vcc', 'gnd', 'tip'],

        init() {
            return {
                drives: {},
                level: 'float',              // 'high' | 'low' | 'float'
                pulsing: false,
                _lastLevel: 'float',
                _edges: [],                  // recent transition times (ns)
            };
        },

        stamp(ctx) {
            // The instrument's real trick: the tip is biased MID-RAIL through
            // high impedance (1 MΩ to each rail), so a floating node sits in
            // the forbidden zone and reads FLOAT — a plain pulldown would
            // report every unconnected pin as a confident LOW.
            ctx.conductance('tip', 'vcc', 1 / R_PROBE);
            ctx.conductance('tip', 'gnd', 1 / R_PROBE);
        },

        update(part, state, read, tNs) {
            const vcc = read('vcc') || 5.0;
            const v = read('tip') - read('gnd');
            const level = v > vcc * 0.7 ? 'high' : v < vcc * 0.3 ? 'low' : 'float';

            if (level !== state._lastLevel && level !== 'float' && state._lastLevel !== 'float') {
                state._edges.push(tNs);
            }
            state._lastLevel = level;
            // Pulsing: two or more real transitions inside the last 100 ms
            // of machine time — a blinking LED pin reads PULSE, a held
            // button reads a level.
            const cutoff = tNs - 100_000_000n;
            state._edges = state._edges.filter((t) => t >= cutoff);
            const pulsing = state._edges.length >= 2;

            if (level === state.level && pulsing === state.pulsing) return false;
            state.level = level;
            state.pulsing = pulsing;
            return false;
        },
    });
}

export default registerBenchMeters;
