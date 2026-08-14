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

export function registerBenchMeters() {

    // ─── Voltmeter (digital face) ──────────────────────────────────────
    registerDevice('voltmeter', {
        terminals: ['a', 'b'],

        init() {
            return { drives: {}, reading: 0 };
        },

        stamp(ctx) {
            ctx.conductance('a', 'b', 1 / R_VOLTMETER);
        },

        update(part, state, read) {
            const v = read('a') - read('b');
            if (Math.abs(v - state.reading) < 0.0005) return false;
            state.reading = v;
            return false;                 // reading changed; no drives did
        },
    });

    // The moving-coil analog meter is the same measurement with a needle:
    // params.fullScale (volts, default 5) tells the artwork where the
    // needle pegs; state.deflection is 0..1 (clamped, sign preserved in
    // reading — a backwards needle slam is a real bench event).
    registerDevice('analog_meter', {
        terminals: ['a', 'b'],

        init() {
            return { drives: {}, reading: 0, deflection: 0 };
        },

        stamp(ctx) {
            ctx.conductance('a', 'b', 1 / R_VOLTMETER);
        },

        update(part, state, read) {
            const v = read('a') - read('b');
            if (Math.abs(v - state.reading) < 0.0005) return false;
            state.reading = v;
            const fs = part.params?.fullScale ?? 5;
            state.deflection = Math.max(-0.1, Math.min(1.1, v / fs));
            return false;
        },
    });

    // ─── Ammeter ───────────────────────────────────────────────────────
    registerDevice('ammeter', {
        terminals: ['a', 'b'],

        init() {
            return { drives: {}, reading: 0 };   // amps, a→b positive
        },

        stamp(ctx) {
            ctx.conductance('a', 'b', 1 / R_SHUNT);
        },

        update(part, state, read) {
            const i = (read('a') - read('b')) / R_SHUNT;
            if (Math.abs(i - state.reading) < 1e-6) return false;
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
