// SPDX-License-Identifier: MIT
/**
 * Device models for the sensing transducers (src/sensing-transducers.js) and
 * the voice coil that lets a speaker or earphone listen (src/acoustics.js).
 *
 * Every model is a Thevenin source between two of its own pins, so it is
 * solved in the same Newton system as the rest of the circuit; the readouts
 * (EMF, field, compass angle, electrolysis current, taste) are published on
 * the device state (board.getDeviceState(id)).
 *
 * @module
 */

import { registerDevice } from '../devices.js';
import { VOICE_COIL_KIND } from '../acoustics.js';
import {
    thermocoupleCard, airCoilCard, dropEmf, coilRun, coilInductorParams, magnetFall, fluxLinkage,
    electrolysisCard, FARADAY, INNER_PIN, combHumidityPct, combOhms,
} from '../sensing-transducers.js';
import { ptcResistanceAt } from '../thermal.js';
import { rulerCard, hallOutput } from '../bending-ruler.js';

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

export function registerSensingParts() {
    // ─── Voice coil with a sound EMF (solver-only) ──────────────────────
    // Replaces a listening transducer's series resistance: Re in series with
    // e(t) = S·p(t) (src/acoustics.js), between `a` and the coil node.
    registerDevice(VOICE_COIL_KIND, {
        terminals: ['a', 'coil'],
        eventLocalization: false,
        init() { return { drives: {} }; },
        stamp(ctx, part) {
            const ac = part.acoustic;
            const ohms = Number(part.params?.ohms) > 0 ? Number(part.params.ohms) : 8;
            const e = ac ? ac.env.emf(ac.part, ctx.tSeconds ?? 0) : 0;
            ctx.theveninBetween('a', 'coil', e, ohms);
        },
    });

    // ─── Silicon PTC temperature sensor ────────────────────────────────
    // A resistor whose value follows its own temperature (src/thermal.js):
    // the thermal model's when it takes part (surroundC, heatedBy, rth),
    // else the bench temperature.
    registerDevice('ptc_sensor', {
        terminals: ['a', 'b'],
        eventLocalization: false,
        init() { return { drives: {}, ohms: 2000, celsius: 25 }; },
        stamp(ctx, part, state) {
            const celsius = num(ctx.partTemperatureC, num(ctx.temperatureC, 25));
            const ohms = ptcResistanceAt(part, celsius);
            ctx.conductance('a', 'b', 1 / ohms);
            if (state) { state.ohms = ohms; state.celsius = celsius; }
        },
    });

    // ─── Bending ruler with a magnet over a linear Hall sensor ──────────
    // src/bending-ruler.js: load -> deflection -> magnet distance -> field
    // -> ratiometric output on ao (50 Ohm). Its knob is params.loadG.
    registerDevice('bending_ruler', {
        terminals: ['vcc', 'gnd', 'ao'],
        eventLocalization: false,
        init() { return { drives: {}, loadG: 0, deflectionMm: 0, distanceMm: 15, fieldMt: 0 }; },
        stamp(ctx, part) {
            // The sensor's own supply current, about 6 mA at 5 V: ~830 Ohm.
            ctx.conductance('vcc', 'gnd', 1 / 830);
        },
        update(part, state, read) {
            const card = rulerCard(part);
            const vcc = read('vcc') - read('gnd');
            const vTh = read('gnd') + (vcc > 0.5 ? hallOutput(part, vcc, card.fieldMt) : 0);
            state.loadG = card.loadG;
            state.deflectionMm = card.deflectionMm;
            state.distanceMm = card.distanceMm;
            state.fieldMt = card.fieldMt;
            state.touching = card.touching;
            const d = state.drives.ao;
            if (d && Math.abs(d.vTh - vTh) < 1e-6) return false;
            state.drives.ao = { vTh, rTh: 50 };
            return true;
        },
    });

    // ─── Thermocouple ──────────────────────────────────────────────────
    registerDevice('thermocouple', {
        terminals: ['pos', 'neg'],
        eventLocalization: false,
        init() { return { drives: {}, emfV: 0, hotC: 25, coldC: 25 }; },
        stamp(ctx, part, state) {
            const card = thermocoupleCard(part, num(ctx.temperatureC, 25));
            ctx.theveninBetween('pos', 'neg', card.emf, card.ohms);
            if (state) { state.emfV = card.emf; state.hotC = card.hotC; state.coldC = card.coldC; state.type = card.type; }
        },
        update(part, state, read) {
            state.volts = read('pos') - read('neg');
            return false;
        },
    });

    // ─── Hand-wound air coil ───────────────────────────────────────────
    // Wire resistance plus the induced EMF between `a` and the inner node;
    // the inductance is a solver inductor from there to `b`.
    registerDevice('air_coil', {
        terminals: ['a', 'b'],
        eventLocalization: false,
        init() { return { drives: {}, amps: 0, fieldT: 0, compassDeg: 0, emfV: 0 }; },
        stamp(ctx, part) {
            const card = airCoilCard(part);
            const run = coilRun(part);
            const e = run.t0 === null ? 0 : dropEmf(card, (ctx.tSeconds ?? 0) - run.t0);
            ctx.theveninBetween('a', INNER_PIN, e, card.ohms);
        },
        control(part, state, verb) {
            if (verb !== 'drop') return false;
            coilRun(part).armed = true;
            return true;
        },
        update(part, state, read, tNs) {
            const card = airCoilCard(part);
            const run = coilRun(part);
            const t = Number(tNs) / 1e9;
            run.lastT = t;
            // A drop asked for by control or by bumping params.drops starts now.
            const drops = num(part.params?.drops, 0);
            if (drops > run.seen) { run.seen = drops; run.armed = true; }
            if (run.armed) { run.armed = false; run.t0 = t; }
            const tau = run.t0 === null ? 0 : t - run.t0;
            const e = run.t0 === null ? 0 : dropEmf(card, tau);
            const amps = (read('a') - read(INNER_PIN) - e) / card.ohms;
            // The metal moves L: the solver inductor reads its params live.
            const lp = coilInductorParams(part);
            if (lp && lp.henrys !== card.henrys) lp.henrys = card.henrys;
            state.amps = amps;
            state.emfV = e;
            state.ohms = card.ohms;
            state.henrys = card.henrys;
            state.metalShift = card.metalShift;
            state.fieldT = card.teslaPerAmp * amps;
            state.compassFieldT = card.compassTeslaPerAmp * amps;
            state.compassDeg = Math.atan2(state.compassFieldT, card.earthT) * 180 / Math.PI;
            if (run.t0 !== null) {
                const { z, v } = magnetFall(card, tau);
                state.magnetZ = z; state.magnetV = v; state.fluxLinkage = fluxLinkage(card, z);
            }
            return false;
        },
    });

    // ─── Electrolysis cell ─────────────────────────────────────────────
    // Bulk resistance between `a` and the interface node; the double layer
    // and the two Faradaic diodes from there to `b` are solver parts.
    registerDevice('electrolysis_cell', {
        terminals: ['a', 'b'],
        eventLocalization: false,
        init() { return { drives: {}, amps: 0, faradaicAmps: 0, chargeC: 0, hydrogenMol: 0, tasteLevel: 0, taste: 'none', _t: null }; },
        stamp(ctx, part) {
            const card = electrolysisCard(part);
            ctx.theveninBetween('a', INNER_PIN, 0, card.ohms);
        },
        update(part, state, read, tNs) {
            const card = electrolysisCard(part);
            const t = Number(tNs) / 1e9;
            const vi = read(INNER_PIN) - read('b');
            const amps = (read('a') - read(INNER_PIN)) / card.ohms;
            // KCL at the interface: what does not charge the double layer
            // is electrolysis (the solver's own diodes carry it).
            const dt = state._t !== null ? t - state._t : 0;
            const iF = dt > 0 ? amps - card.farads * (vi - state._vi) / dt : amps;
            state._vi = vi;
            if (dt > 0) {
                const q = Math.abs(iF) * (t - state._t);
                state.chargeC += q;
                state.hydrogenMol += q / (2 * FARADAY);
            }
            state._t = t;
            state.amps = amps;
            state.polarisationV = vi;
            state.faradaicAmps = iF;
            state.tasteLevel = Math.abs(iF) / card.tasteAmps;
            state.taste = state.tasteLevel < 1 ? 'none' : state.tasteLevel < 10 ? 'faint' : 'strong';
            // Oxidation at the electrode the current enters by: acid (H⁺) there, a sour/metallic taste.
            state.sourAt = iF > 0 ? 'a' : iF < 0 ? 'b' : null;
            return false;
        },
    });

    // ─── Humidity comb ─────────────────────────────────────────────────
    // A resistance between `a` and `b` that falls steeply with the relative
    // humidity at the film (the learner's control, else the world).
    registerDevice('humidity_comb', {
        terminals: ['a', 'b'],
        eventLocalization: false,
        init() { return { drives: {}, humidityPct: 50, ohms: 0, amps: 0 }; },
        stamp(ctx, part, state) {
            const rh = combHumidityPct(part, ctx.control);
            const ohms = combOhms(part, rh);
            ctx.theveninBetween('a', 'b', 0, ohms);
            if (state) { state.humidityPct = rh; state.ohms = ohms; }
        },
        update(part, state, read) {
            if (state.ohms > 0) state.amps = (read('a') - read('b')) / state.ohms;
            return false;
        },
    });
}
