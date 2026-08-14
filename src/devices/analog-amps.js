/**
 * LM358 dual op-amp + LM3915 dot/bar display driver — the analog pair
 * behind every cheap VU meter, clean-room from the TI datasheets.
 *
 * The op-amp is the genuinely hard one: real feedback needs convergence
 * inside the board's bounded settle loop (ten device/solve rounds per
 * event). The model is a DAMPED INTEGRATOR rather than a naked
 * high-gain stage: each round the output moves G_STEP × (v+ − v−)
 * toward where the error pushes it, clamped to the LM358's real swing
 * (GND up to VCC − 1.5). Under negative feedback with attenuation β the
 * error contracts by |1 − G_STEP·β| per round — a follower (β = 1)
 * lands within millivolts in ten rounds, resistor-gain stages faster —
 * and open-loop (β = 0) it marches rail-ward like the comparator it
 * then is. A naked ×100k VCVS would ping-pong between rails forever;
 * the damping is what makes feedback SOLVABLE, and it is stated here
 * rather than hidden.
 *
 * LM3915: ten comparators on a 3 dB/step log ladder (datasheet's
 * defining feature — the equal-loudness VU law), reference from
 * params.fullScale (default 1.25, the internal reference), outputs
 * active-LOW current sinks (LEDs hang from VCC), MODE pin high = bar,
 * low/open = dot. state.level 0-10 for the artwork.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_OUT = 100;          // LM358 output stage, modest drive
const R_SINK = 50;
const R_OFF = 1e9;
const R_INPUT = 1e6;
const G_STEP = 1.5;         // damped-integrator gain per settle round

export function registerAnalogAmps() {

    registerDevice('lm358', {
        terminals: ['vcc', 'gnd',
            '1_pos', '1_neg', '1_out', '2_pos', '2_neg', '2_out'],

        init() {
            return {
                drives: {
                    '1_out': { vTh: 0, rTh: R_OUT },
                    '2_out': { vTh: 0, rTh: R_OUT },
                },
            };
        },

        stamp(ctx) {
            for (const t of ['1_pos', '1_neg', '2_pos', '2_neg']) {
                ctx.conductance(t, null, 1 / R_INPUT);
            }
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const gnd = read('gnd') || 0;
            const hi = vcc - 1.5;              // the LM358's real top swing
            const lo = gnd + 0.005;
            let changed = false;
            for (const ch of ['1', '2']) {
                const e = read(`${ch}_pos`) - read(`${ch}_neg`);
                const cur = state.drives[`${ch}_out`].vTh;
                const next = Math.max(lo, Math.min(hi, cur + G_STEP * e));
                if (Math.abs(next - cur) > 0.001) {
                    state.drives[`${ch}_out`] = { vTh: next, rTh: R_OUT };
                    changed = true;
                }
            }
            return changed;
        },
    });

    registerDevice('lm3915', {
        terminals: ['vcc', 'gnd', 'sig', 'mode',
            'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10'],

        init() {
            const drives = {};
            for (let i = 1; i <= 10; i++) drives[`l${i}`] = { vTh: 0, rTh: R_OFF };
            return { drives, level: 0, bar: false };
        },

        stamp(ctx) {
            // The SIG input is buffered on the real part — near-zero load.
            ctx.conductance('sig', null, 1 / 10e6);
            ctx.conductance('mode', null, 1 / R_INPUT);
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const full = part.params?.fullScale ?? 1.25;
            const v = read('sig') - (read('gnd') || 0);
            // 3 dB per step, top step at fullScale: thresholds
            // full × 10^(−3·(10−i)/20) for i = 1..10.
            let level = 0;
            for (let i = 1; i <= 10; i++) {
                const th = full * Math.pow(10, (-3 * (10 - i)) / 20);
                if (v >= th) level = i;
            }
            const bar = read('mode') > vcc * 0.5;
            if (level === state.level && bar === state.bar) return false;
            state.level = level;
            state.bar = bar;
            for (let i = 1; i <= 10; i++) {
                const on = bar ? i <= level : i === level && level > 0;
                state.drives[`l${i}`] = on
                    ? { vTh: 0, rTh: R_SINK }          // sink: LED from VCC lights
                    : { vTh: 0, rTh: R_OFF };
            }
            return true;
        },
    });
}

export default registerAnalogAmps;
