/**
 * The 37-in-1 kit's small faces — the modules that are one comparator,
 * one element and a pot on a red PCB. All clean-room from module
 * schematics/datasheets; every stimulus is a part param (world-facing:
 * settable from the designer, the environment blocks, and controller
 * widgets alike). The module convention is kept where the boards have
 * it: AO = raw analog, DO = LM393 comparator against the on-board pot
 * (threshold as params.threshold where meaningful).
 *
 *   hall_analog     field -1..1 → AO centered at VCC/2 (49E-style
 *                   ratiometric); DO active LOW past |threshold|.
 *   hall_digital    unipolar switch: DO LOW while field ≥ threshold.
 *   reed_switch     contacts a-b close while params.magnet — a switch,
 *                   wire it like one.
 *   touch_ttp223    DO HIGH while touched (momentary strap; the toggle
 *                   pad is unmodeled, stated).
 *   photo_interrupter DO HIGH while params.blocked (slot beam cut).
 *   flame_sensor    AO RISES with flame 0..1; DO LOW past threshold
 *                   (the common board wiring — active-low alarm).
 *   ir_reflect      line-tracking and obstacle boards are the same
 *                   electronics: DO LOW while params.detect.
 *   sound_module    AO = level×VCC; DO HIGH past threshold.
 *   heartbeat       AO is a real waveform: a pulse bump per beat at
 *                   params.bpm riding a VCC/2 baseline, generated from
 *                   machine time — peak-counting sketches count beats.
 *   led_7color      auto-cycling flash LED: powered above ~2 V it
 *                   advances state.colorIndex (0-6) at params.cycleHz
 *                   for the artwork; unpowered it holds.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_OUT = 50;
const R_INPUT = 1e6;

const digital = (state, term, high, vcc) => {
    const want = { vTh: high ? vcc : 0, rTh: R_OUT };
    const cur = state.drives[term];
    if (cur && cur.vTh === want.vTh) return false;
    state.drives[term] = want;
    return true;
};

export function registerThirtySeven() {

    registerDevice('hall_analog', {
        terminals: ['vcc', 'gnd', 'ao', 'do'],
        init() { return { drives: {} }; },
        stamp() { },
        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const f = Math.max(-1, Math.min(1, part.params?.field ?? 0));
            const th = part.params?.threshold ?? 0.5;
            let changed = false;
            const ao = { vTh: vcc / 2 + f * (vcc / 2) * 0.8, rTh: R_OUT };
            if (!state.drives.ao || Math.abs(state.drives.ao.vTh - ao.vTh) > 0.005) {
                state.drives.ao = ao; changed = true;
            }
            changed = digital(state, 'do', !(Math.abs(f) >= th), vcc) || changed;
            return changed;
        },
    });

    registerDevice('hall_digital', {
        terminals: ['vcc', 'gnd', 'do'],
        init() { return { drives: {} }; },
        stamp() { },
        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const f = part.params?.field ?? 0;
            return digital(state, 'do', !(f >= (part.params?.threshold ?? 0.5)), vcc);
        },
    });

    registerDevice('reed_switch', {
        terminals: ['a', 'b'],
        init() { return { drives: {}, _on: null }; },
        stamp(ctx, part) {
            if (part.params?.magnet) ctx.conductance('a', 'b', 1 / 0.1);
        },
        update(part, state) {
            const on = !!part.params?.magnet;
            if (on === state._on) return false;
            state._on = on;
            return true;
        },
    });

    registerDevice('touch_ttp223', {
        terminals: ['vcc', 'gnd', 'do'],
        init() { return { drives: {} }; },
        stamp() { },
        update(part, state, read) {
            return digital(state, 'do', !!part.params?.touched, read('vcc') || 5.0);
        },
    });

    registerDevice('photo_interrupter', {
        terminals: ['vcc', 'gnd', 'do'],
        init() { return { drives: {} }; },
        stamp() { },
        update(part, state, read) {
            return digital(state, 'do', !!part.params?.blocked, read('vcc') || 5.0);
        },
    });

    registerDevice('flame_sensor', {
        terminals: ['vcc', 'gnd', 'ao', 'do'],
        init() { return { drives: {} }; },
        stamp() { },
        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const f = Math.max(0, Math.min(1, part.params?.flame ?? 0));
            let changed = false;
            const ao = { vTh: f * vcc, rTh: R_OUT };
            if (!state.drives.ao || Math.abs(state.drives.ao.vTh - ao.vTh) > 0.005) {
                state.drives.ao = ao; changed = true;
            }
            changed = digital(state, 'do', !(f >= (part.params?.threshold ?? 0.5)), vcc) || changed;
            return changed;
        },
    });

    registerDevice('ir_reflect', {
        terminals: ['vcc', 'gnd', 'do'],
        init() { return { drives: {} }; },
        stamp() { },
        update(part, state, read) {
            return digital(state, 'do', !part.params?.detect, read('vcc') || 5.0);
        },
    });

    registerDevice('sound_module', {
        terminals: ['vcc', 'gnd', 'ao', 'do'],
        init() { return { drives: {} }; },
        stamp() { },
        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const lvl = Math.max(0, Math.min(1, part.params?.level ?? 0));
            let changed = false;
            const ao = { vTh: lvl * vcc, rTh: R_OUT };
            if (!state.drives.ao || Math.abs(state.drives.ao.vTh - ao.vTh) > 0.005) {
                state.drives.ao = ao; changed = true;
            }
            changed = digital(state, 'do', lvl >= (part.params?.threshold ?? 0.5), vcc) || changed;
            return changed;
        },
    });

    registerDevice('heartbeat', {
        terminals: ['vcc', 'gnd', 'ao'],
        init() { return { drives: {} }; },
        stamp() { },
        update(part, state, read, tNs) {
            const vcc = read('vcc') || 5.0;
            const bpm = Math.max(20, Math.min(240, part.params?.bpm ?? 70));
            const periodNs = 60e9 / bpm;
            const phase = Number(tNs % BigInt(Math.round(periodNs))) / periodNs;
            // A narrow raised-cosine bump in the first 15% of each period —
            // enough shape for threshold- and peak-detecting sketches.
            const bump = phase < 0.15 ? (1 - Math.cos((phase / 0.15) * 2 * Math.PI)) / 2 : 0;
            const v = vcc * (0.5 + 0.35 * bump);
            if (state.drives.ao && Math.abs(state.drives.ao.vTh - v) < 0.01) return false;
            state.drives.ao = { vTh: v, rTh: R_OUT };
            return true;
        },
    });

    registerDevice('led_7color', {
        terminals: ['a', 'k'],
        init() { return { drives: {}, colorIndex: 0, _nextNs: -1n }; },
        stamp(ctx) {
            ctx.conductance('a', 'k', 1 / 10000);   // the die's own drive circuit
        },
        update(part, state, read, tNs) {
            const powered = (read('a') - read('k')) > 2.0;
            if (!powered) { state._nextNs = -1n; return false; }
            const hz = part.params?.cycleHz ?? 2;
            if (state._nextNs < 0n) state._nextNs = tNs + BigInt(Math.round(1e9 / hz));
            if (tNs < state._nextNs) return false;
            state._nextNs = tNs + BigInt(Math.round(1e9 / hz));
            state.colorIndex = (state.colorIndex + 1) % 7;
            return true;
        },
    });
}

export default registerThirtySeven;
