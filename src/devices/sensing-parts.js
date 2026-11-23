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
    electrolysisCard, FARADAY, INNER_PIN,
} from '../sensing-transducers.js';

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
}
