/**
 * MSGEQ7 seven-band graphic-equalizer chip + a generic LED spectrum
 * display face — the documented citizens behind the WD-marked
 * music-spectrum DIY kits (132-SMD-LED class). The kit's own ASIC is a
 * black box with no datasheet; the MSGEQ7 is the real, documented part
 * every maker spectrum build uses, and the display half is column
 * state for the artwork.
 *
 * MSGEQ7 (MSI datasheet): RESET high pulse returns the multiplexor to
 * band 1; each STROBE falling edge presents the NEXT band's peak level
 * on OUT (63 Hz, 160, 400, 1k, 2.5k, 6.25k, 16 kHz), held while strobe
 * is low, cycling after seven. Band levels are world-facing:
 * params.bands = seven 0..1 values, settable from the designer, the
 * environment blocks, or controller widgets — the audio front-end is
 * the stimulus system's business, stated.
 *
 * spectrum_display: N columns × M rows of LEDs as pure display state —
 * params.levels (0..1 per column) becomes state.columns (lit rows per
 * column) for the artwork; defaults 12×11 = the 132-LED kit shape.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_OUT = 100;
const R_INPUT = 1e6;

export function registerMsgeq7() {

    registerDevice('msgeq7', {
        terminals: ['vcc', 'gnd', 'strobe', 'reset', 'out'],

        init() {
            return {
                drives: { out: { vTh: 0, rTh: R_OUT } },
                band: 0,
                _strobe: false, _reset: false,
            };
        },

        stamp(ctx) {
            ctx.conductance('strobe', null, 1 / R_INPUT);
            ctx.conductance('reset', null, 1 / R_INPUT);
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            const strobe = read('strobe') > th;
            const reset = read('reset') > th;
            let changed = false;

            if (reset && !state._reset) state.band = 0;
            if (!strobe && state._strobe && !reset) {
                // Strobe falling edge: present the next band.
                const bands = part.params?.bands || [];
                const level = Math.max(0, Math.min(1, Number(bands[state.band % 7]) || 0));
                // Datasheet: out spans ~0 to near VCC at full band energy.
                const want = { vTh: level * (vcc - 0.8), rTh: R_OUT };
                if (Math.abs(state.drives.out.vTh - want.vTh) > 0.005) {
                    state.drives.out = want;
                    changed = true;
                }
                state.band = (state.band + 1) % 7;
            }
            state._strobe = strobe; state._reset = reset;
            return changed;
        },
    });

    registerDevice('spectrum_display', {
        terminals: ['vcc', 'gnd'],

        init(part) {
            const cols = part.params?.cols ?? 12;
            return {
                drives: {},
                columns: new Array(cols).fill(0),
                rows: part.params?.rows ?? 11,
            };
        },

        stamp() { },

        update(part, state) {
            const levels = part.params?.levels || [];
            const rows = state.rows;
            let changed = false;
            for (let i = 0; i < state.columns.length; i++) {
                const lit = Math.round(Math.max(0, Math.min(1, Number(levels[i]) || 0)) * rows);
                if (lit !== state.columns[i]) { state.columns[i] = lit; changed = true; }
            }
            return changed;
        },
    });
}

export default registerMsgeq7;
