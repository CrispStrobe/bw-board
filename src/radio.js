// SPDX-License-Identifier: MIT
/**
 * Radio front end: long-wire antenna, earth, tuning capacitor, ferrite-rod
 * medium-wave coil, air-core VHF coil (vhf_coil), varicap diode, a broadcast
 * environment of AM, FM and Morse (CW) stations, and the RF behaviour of
 * every junction in the circuit: detection, amplification, regeneration,
 * oscillation, super-regeneration and mixing.
 *
 * WHY NOT SIMULATE THE CARRIER. A medium-wave carrier is ~1 MHz, VHF ~100
 * MHz. Resolving it in the transient integrator needs tens of steps per
 * cycle: measured on this engine, a 1 MHz tank with a diode detector costs
 * ~5 s of wall time per simulated millisecond and runs out of step attempts
 * after 0.23 ms. The programme is audio. So the carrier never enters the
 * time domain; its COMPLEX ENVELOPE does.
 *
 * THE SPLIT (envelope / dynamic-phasor analysis, as in harmonic-balance
 * envelope simulators; the numerics live in src/rf-bands.js):
 *
 *   1. BANDS. The RF network (the circuit linearised by the engine's AC
 *      assembler, src/ac.js, with every generic junction left out) is solved
 *      around a few centre frequencies. A band is centred on each RESONANCE
 *      of the circuit — found as a peak of the driving-point impedance of a
 *      coil winding, with the junctions at their present large-signal
 *      conductance, so a tank that regeneration has made sharp, or made
 *      unstable, is found where it now is — and takes in every station within
 *      ± max(10 kHz, f/1000) of it. Its envelope X obeys Y0·X + Y1·dX/dt = J
 *      (rf-bands.js) and is INTEGRATED IN TIME: the tank builds up and decays
 *      with its own bandwidth, two carriers in one band beat at their
 *      distance (adjacent-channel whistle, heterodyne), an FM carrier's
 *      frequency swing turns into amplitude on a tank's slope, and a band
 *      whose loop gain exceeds one GROWS — from the winding's thermal noise
 *      if nothing else drives it — until the junctions' large-signal
 *      compression and their rectified bias shift stop it. Stations near no
 *      resonance meet a flat response: each is solved quasi-statically at
 *      its own carrier (the phasor the earlier front end used for all).
 *
 *   2. JUNCTIONS by their describing function (rf-bands.js): diodes,
 *      bipolar B–E and B–C junctions (Bessel closed form), MOSFETs (square
 *      law with cut-off, by quadrature). Their RF conductance follows the
 *      transient solve's operating point every accepted step; their swing
 *      per band is the band's port voltage.
 *
 *   3. DETECTION / BIAS SHIFT is the cycle-averaged junction law at audio
 *      rate: a junction with swings A_b (all bands) carries
 *      Is·e^{v/nVt}·(Π_b I0(A_b/nVt) − 1) more DC than without, stamped by a
 *      solver-only companion (`rf_detect`, src/devices/radio-parts.js) in
 *      parallel with it — square-law for small swings, a peak detector for
 *      large ones, and for a transistor the self-bias that limits an
 *      oscillator and quenches a super-regenerative one. A MOSFET gets the
 *      square law's average instead.
 *
 *   4. COUPLING. The band integrator runs ahead of the transient solve on
 *      its own substeps, using the operating point of the last ACCEPTED step;
 *      when a step is accepted, band history beyond it is discarded and
 *      re-integrated with the new operating point. One step of lag, never
 *      a rollback of accepted state.
 *
 * DIRECTION AND NEAR FIELD. A ferrite rod is itself an antenna: its winding
 * picks up rodHeightM (effective height at 1 MHz, ∝ f) × field × cos(rod
 * angle − station bearing) — the figure-eight pattern with its sharp nulls
 * that radio direction finding uses. The rod angle is a control (0..1 =
 * 0..360°). Two ferrite coils on one bench couple magnetically when one names
 * the other in `linkTo`: k = cos(Δangle)·(rLink/distanceM)³, the near field
 * of a transmitter's rod a few metres from a receiver's.
 *
 * PRODUCTS BETWEEN BANDS (_planProducts): a junction swinging in two bands
 * makes their sum and difference, and a band's 2nd and 3rd harmonics; each
 * one that lands near another band's centre is a current source there (a
 * superhet's IF, a transmitter heard at twice its frequency, an image). The
 * mixer IC (src/mixer-ic.js) is such a junction with a tanh·tanh law, and
 * its RF and LO in ONE band beat straight to audio (direct conversion).
 *
 * IMPULSE RADIATION (_radiate): an untuned coil linked to another radiates
 * the RF content of its switched current into the other's bands.
 *
 * ALSO: a half-wave dipole (`dipole`, its turn a knob), a ceramic IF filter
 * (`ceramic_filter`, a two-pole band-pass in the RF view only), the FM IF IC's
 * input (src/fm-if-ic.js, read by fmDemod), a coupling winding slid along
 * its rod (`slideWinding`), links between any two RF coils.
 *
 * NOT MODELLED: products that land between bands (only those near a band's
 * centre are kept), products acting back on the bands that make them,
 * junction capacitance except a diode's `cjo` (varicaps) and a transistor's
 * cje/cjc/fT, detector series resistance, the field's far-zone geometry
 * (stations are plane waves).
 *
 * @module
 */

import { junctionVf } from './led-color.js';
import { resolveParams } from './parts-library.js';
import { chooseGroundReference, smoothVov, mosK } from './mna.js';
import {
    VT, lnI0, besselGain, expCapped, describeLaw, cluFactor, cluSolve, mulberry32, gaussPair,
    thermalCurrentPsd, BandIntegrator, H_UNIT, K_MAX, QUAD_COS,
} from './rf-bands.js';
import { DMath } from './det-math.js';
import { coilInductorParams } from './sensing-transducers.js';
import { MIXER_IC_KIND, LO_BIAS_RATIO, mixerCard, mixerTail, mixerOutputFade } from './mixer-ic.js';
import { FM_IF_KIND, fmIfCard, fmQuadHz, fmDetector } from './fm-if-ic.js';
import { i0e, i1e } from './rf-bands.js';

export { lnI0, besselGain };

// ─── Broadcast environment ──────────────────────────────────────────────

/** The default bench broadcast: three medium-wave stations. */
export const DEFAULT_STATIONS = Object.freeze([
    Object.freeze({ id: 'rf612', name: 'Ortssender 612 kHz', hz: 612e3, fieldVPerM: 0.02, depth: 0.5, bearingDeg: 0,
        audio: Object.freeze({ type: 'tone', hz: 400 }) }),
    Object.freeze({ id: 'rf810', name: 'Sender 810 kHz', hz: 810e3, fieldVPerM: 0.008, depth: 0.6, bearingDeg: 60,
        audio: Object.freeze({ type: 'two-tone', hz: Object.freeze([600, 900]), period: 0.4 }) }),
    Object.freeze({ id: 'rf1215', name: 'Fernsender 1215 kHz', hz: 1215e3, fieldVPerM: 0.003, depth: 0.5, bearingDeg: 135,
        audio: Object.freeze({ type: 'tone', hz: 1000 }) }),
]);

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

// International Morse, dots and dashes.
const MORSE = {
    A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....', I: '..', J: '.---',
    K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.', Q: '--.-', R: '.-.', S: '...', T: '-',
    U: '..-', V: '...-', W: '.--', X: '-..-', Y: '-.--', Z: '--..', 0: '-----', 1: '.----', 2: '..---',
    3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.',
};

/** Key-down intervals (in dot units) of a Morse text, and its length with the word gap. */
function morseSchedule(text) {
    const on = [];
    let u = 0;
    for (const word of String(text).toUpperCase().split(/\s+/).filter(Boolean)) {
        for (const ch of word) {
            const code = MORSE[ch];
            if (!code) continue;
            for (const s of code) { const d = s === '.' ? 1 : 3; on.push([u, u + d]); u += d + 1; }
            u += 2; // letter gap 3 (one already counted)
        }
        u += 4;     // word gap 7
    }
    return { on, units: Math.max(u, 7) };
}

function normalizeAudio(a) {
    if (!a || typeof a !== 'object') return { type: 'none' };
    const type = String(a.type ?? 'tone');
    if (type === 'none') return { type };
    if (type === 'tone') return { type, hz: Math.max(1, num(a.hz, 440)) };
    if (type === 'two-tone' || type === 'chord') {
        const hz = Array.isArray(a.hz) && a.hz.length >= 2 ? a.hz.slice(0, 2).map(h => Math.max(1, num(h, 440)))
            : [600, 900];
        return { type, hz, period: Math.max(1e-3, num(a.period, 0.5)) };
    }
    if (type === 'melody') {
        // A tune: [hz, seconds] notes played in turn and repeated, each a
        // phase-continuous tone (hz 0: a rest).
        const notes = (Array.isArray(a.notes) ? a.notes : []).map(n => [Math.max(0, num(n?.[0], 0)), Math.max(1e-3, num(n?.[1], 0.2))]);
        if (!notes.length) throw new Error('broadcast: a melody needs notes [[hz, seconds], …]');
        const starts = [];
        let t = 0, cyc = 0;
        for (const [hz, d] of notes) { starts.push([t, cyc]); t += d; cyc += hz * d; }
        return { type, notes, starts, period: t, cyclesPerPeriod: cyc };
    }
    if (type === 'morse') {
        const wpm = Math.max(1, num(a.wpm, 12));
        return { type, text: String(a.text ?? 'CQ'), wpm, unit: 1.2 / wpm, ...morseSchedule(a.text ?? 'CQ') };
    }
    throw new Error(`broadcast: unknown programme type "${type}" (tone, two-tone, chord, melody, morse, none)`);
}

const MODS = new Set(['am', 'fm', 'cw']);

/**
 * Validate and fill a station list. Each station: `hz` carrier (Hz),
 * `fieldVPerM` field strength (V/m, peak), `mod` 'am' (default) | 'fm' |
 * 'cw', `depth` AM modulation depth 0..1, `deviationHz` FM peak deviation
 * (default 75 kHz), `bearingDeg` direction it arrives from (for a ferrite
 * rod), `audio` programme ({type:'tone', hz} | {type:'two-tone', hz:[f1,f2],
 * period} alternating | {type:'chord', hz:[f1,f2]} both at once |
 * {type:'melody', notes:[[hz, s], …]} | {type:'morse', text, wpm} the key
 * (cw) | {type:'none'} carrier only). `skyFieldVPerM` (default 0): the
 * field its SKY WAVE adds after dark (stationField).
 */
export function normalizeStations(list) {
    if (!Array.isArray(list)) throw new Error('broadcast: expected an array of stations');
    return list.map((s, i) => {
        const hz = num(s?.hz, NaN);
        if (!(hz >= 10e3 && hz <= 300e6)) throw new Error(`broadcast: station ${i} needs a carrier hz between 10 kHz and 300 MHz`);
        const mod = String(s.mod ?? 'am');
        if (!MODS.has(mod)) throw new Error(`broadcast: station ${i} mod must be am, fm or cw`);
        const audio = normalizeAudio(s.audio);
        if (mod === 'fm' && audio.type === 'morse') throw new Error(`broadcast: station ${i}: an FM station cannot key Morse`);
        return {
            id: String(s.id ?? `station${i}`),
            name: String(s.name ?? s.id ?? `${Math.round(hz / 1e3)} kHz`),
            hz,
            fieldVPerM: Math.max(0, num(s.fieldVPerM, 0.01)),
            skyFieldVPerM: Math.max(0, num(s.skyFieldVPerM, 0)),
            mod,
            depth: Math.min(1, Math.max(0, num(s.depth, 0.5))),
            deviationHz: Math.max(0, num(s.deviationHz, 75e3)),
            bearingDeg: num(s.bearingDeg, 0),
            audio,
        };
    });
}

/**
 * Night share of the sky wave at hour h (0..24): 0 by day, 1 at night, a
 * smooth twilight between 17:00 and 19:00 (and 05:00–07:00). By day the
 * ionosphere's lowest layer, ionised by the sun, absorbs medium and long
 * waves on their way up; after sunset it fades within an hour or two and
 * the waves are reflected by the higher layers instead, coming down again
 * hundreds of kilometres away: distant stations appear in the evening.
 */
export function nightShare(h) {
    const x = Math.abs((((h % 24) + 24) % 24) - 12);   // hours from noon, 0..12
    const s = Math.min(1, Math.max(0, (x - 5) / 2));
    return s * s * (3 - 2 * s);
}

/**
 * A station's field at the receiver at hour h: its ground wave
 * (`fieldVPerM`, there day and night) plus its sky wave (`skyFieldVPerM`)
 * scaled by nightShare(h). NOT MODELLED: the sky wave's fading (two paths
 * beating), its dependence on frequency and distance (the station states
 * its own night field), seasons and latitude (sunset fixed at 18:00).
 */
export function stationField(s, h) {
    return s.fieldVPerM + (s.skyFieldVPerM > 0 ? s.skyFieldVPerM * nightShare(h) : 0);
}

function melodyAt(audio, t) {
    const n = Math.floor(t / audio.period);
    const w = t - n * audio.period;
    let i = audio.starts.length - 1;
    while (i > 0 && audio.starts[i][0] > w) i--;
    const [t0, c0] = audio.starts[i];
    return { hz: audio.notes[i][0], cycles: n * audio.cyclesPerPeriod + c0 + audio.notes[i][0] * (w - t0) };
}

/** Morse key: 1 while the key is down. Edges softened over 5 ms (a real keyer's shaping). */
function morseKey(audio, t) {
    const units = t / audio.unit;
    const w = units - Math.floor(units / audio.units) * audio.units;
    const edge = 0.005 / audio.unit;
    let k = 0;
    for (const [a, b] of audio.on) {
        if (w < a - edge || w > b + edge) continue;
        const up = Math.min(1, Math.max(0, (w - a) / edge + 0.5));
        const dn = Math.min(1, Math.max(0, (b - w) / edge + 0.5));
        k = Math.max(k, Math.min(up, dn));
    }
    return k;
}

/** The programme signal s(t) in [−1, 1] (phase-continuous); a Morse key 0..1. */
export function programmeValue(audio, t) {
    switch (audio.type) {
        case 'tone': return DMath.sin(2 * Math.PI * audio.hz * t);
        case 'chord': return 0.5 * (DMath.sin(2 * Math.PI * audio.hz[0] * t) + DMath.sin(2 * Math.PI * audio.hz[1] * t));
        case 'two-tone': {
            const half = audio.period / 2;
            const n = Math.floor(t / audio.period);
            const w = t - n * audio.period;
            const [f1, f2] = audio.hz;
            const cycles = (f1 + f2) * half * n + (w < half ? f1 * w : f1 * half + f2 * (w - half));
            return DMath.sin(2 * Math.PI * cycles);
        }
        case 'melody': { const m = melodyAt(audio, t); return m.hz > 0 ? DMath.sin(2 * Math.PI * m.cycles) : 0; }
        case 'morse': return morseKey(audio, t);
        default: return 0;
    }
}

/** ∫₀ᵗ s(τ) dτ, for frequency modulation. */
export function programmeIntegral(audio, t) {
    const sinInt = (f, c0, c1) => (DMath.cos(2 * Math.PI * c0) - DMath.cos(2 * Math.PI * c1)) / (2 * Math.PI * f);
    switch (audio.type) {
        case 'tone': return sinInt(audio.hz, 0, audio.hz * t);
        case 'chord': return 0.5 * (sinInt(audio.hz[0], 0, audio.hz[0] * t) + sinInt(audio.hz[1], 0, audio.hz[1] * t));
        case 'two-tone': {
            const half = audio.period / 2;
            const [f1, f2] = audio.hz;
            let acc = 0, c = 0, tt = 0, first = true;
            while (tt < t) {
                const f = first ? f1 : f2;
                const d = Math.min(half, t - tt);
                acc += sinInt(f, c, c + f * d);
                c += f * d; tt += d; first = !first;
            }
            return acc;
        }
        case 'melody': {
            let acc = 0, tt = 0;
            const n = audio.notes.length;
            let i = 0, c = 0;
            while (tt < t) {
                const [f, dur] = audio.notes[i % n];
                const d = Math.min(dur, t - tt);
                if (f > 0) acc += sinInt(f, c, c + f * d);
                c += f * d; tt += d; i++;
            }
            return acc;
        }
        default: return 0;
    }
}

/** Which tone of the programme is playing at t (for tests and readouts). */
export function programmeHz(audio, t) {
    if (audio.type === 'tone') return audio.hz;
    if (audio.type === 'two-tone') {
        const w = t - Math.floor(t / audio.period) * audio.period;
        return w < audio.period / 2 ? audio.hz[0] : audio.hz[1];
    }
    if (audio.type === 'chord') return audio.hz[0];
    if (audio.type === 'melody') return melodyAt(audio, t).hz;
    return 0;
}

function audioMaxHz(audio) {
    if (audio.type === 'tone') return audio.hz;
    if (audio.type === 'two-tone' || audio.type === 'chord') return Math.max(...audio.hz);
    if (audio.type === 'melody') return Math.max(...audio.notes.map(n => n[0]));
    if (audio.type === 'morse') return 1 / (0.005 * 4);
    return 0;
}

/**
 * A station's complex modulation c(t) relative to its unmodulated carrier:
 * AM 1 + m·s(t) (never below zero), FM e^{j·2π·Δf·∫s}, CW the key.
 */
export function stationModulation(s, t) {
    if (s.mod === 'fm') {
        const ph = 2 * Math.PI * s.deviationHz * programmeIntegral(s.audio, t);
        return [DMath.cos(ph), DMath.sin(ph)];
    }
    if (s.mod === 'cw') return [programmeValue(s.audio, t), 0];
    return [Math.max(0, 1 + s.depth * programmeValue(s.audio, t)), 0];
}

// ─── Averaged junction law ──────────────────────────────────────────────

/**
 * Rectification current of a junction carrying an RF swing of amplitude A:
 * Is·e^{v/nVt}·(I0(A/nVt) − 1), and its derivative in v.
 */
export function rectificationCurrent(v, amplitude, is, nVt) {
    if (!(amplitude > 0)) return [0, 0];
    return rectificationCurrentL(v, lnI0(amplitude / nVt), is, nVt);
}

/** The same with the swings of several bands: L = Σ_b ln I0(A_b/nVt). */
export function rectificationCurrentL(v, L, is, nVt) {
    if (!(L > 0)) return [0, 0];
    const u = v / nVt;
    const [f1, d1] = expCapped(u + L, is);
    const [f0, d0] = expCapped(u, is);
    return [f1 - f0, (d1 - d0) / nVt];
}

/** Shockley parameters of a junction for the averaged law. */
export function junctionCard(part) {
    const P = part.params ?? {};
    if (part.kind === 'npn' || part.kind === 'pnp') {
        return { is: num(P.is, 1e-14) > 0 ? num(P.is, 1e-14) : 1e-14, nVt: VT, beta: Math.max(1, num(P.beta, 100)) };
    }
    const n = num(P.n, 1) > 0 ? num(P.n, 1) : 1;
    const nVt = n * VT;
    if (num(P.is, 0) > 0) return { is: Number(P.is), nVt };
    // Calibrated as the engine does: the datasheet drop at 20 mA.
    const vf = num(junctionVf(part), 0.7);
    return { is: 0.02 / Math.max(DMath.exp(Math.min(vf / nVt, 80)) - 1, 1e-30), nVt };
}

/** A diode's junction capacitance at forward voltage v (SPICE law, linear above vj/2). */
export function junctionCapacitance(P, v) {
    const cjo = num(P?.cjo, 0);
    if (!(cjo > 0)) return 0;
    const vj = Math.max(0.05, num(P.vj, 0.7));
    const m = Math.min(0.99, Math.max(0.01, num(P.m, 0.5)));
    const fc = 0.5;
    if (v < fc * vj) return cjo / DMath.pow(1 - v / vj, m);
    const c0 = cjo / DMath.pow(1 - fc, m);
    return c0 * (1 + m * (v - fc * vj) / (vj * (1 - fc)));
}

/**
 * A MOSFET's threshold in the sense its overdrive is taken, as the DC model
 * (src/mna.js) takes it: an nmos's vth signed (a depletion device, vth < 0,
 * conducts at vgs = 0), a pmos's |vth| against vsg. (Was |vth| for both: a
 * depletion nmos — a dual-gate MOSFET's halves — was cut off at RF while its
 * DC bias carried milliamps.)
 */
export function mosThreshold(kind, P) {
    return kind === 'pmos' ? Math.abs(num(P?.vth, -2.0)) : num(P?.vth, 2.0);
}

/** Square law of a MOSFET in saturation (the engine's smoothed law). */
function mosLaw(P, kind = 'nmos') {
    const vth = mosThreshold(kind, P);
    const k = mosK(P);
    return (vgs) => { const [vov] = smoothVov(vgs - vth); return k * vov * vov; };
}

/**
 * A MOSFET's second-order coefficient (A/V²) under swings of total amplitude
 * A: the law's second difference over ±A (K for a square law in conduction,
 * less as the swing reaches cut-off), faded with its channel.
 */
function mosSecondOrder(b, A) {
    const a = Math.max(1e-2, A);
    const f = b.law;
    return (f(b.vgs + a) - 2 * f(b.vgs) + f(b.vgs - a)) / (2 * a * a) * mosChannelFade(b.vds);
}

/**
 * How much of a MOSFET's square-law current its channel can still carry as
 * the drain runs down towards the source (triode): 1 well above, → 0 at
 * vds → 0. Shared by the rectified drain current (rf_detect) and the band's
 * transconductance, so the two fade together.
 */
export function mosChannelFade(vds) { return vds > 0 ? Math.tanh(vds / 0.2) : 0; }

/** d(mosChannelFade)/dvds. */
export function mosChannelFadeSlope(vds) { if (!(vds > 0)) return 0; const t = Math.tanh(vds / 0.2); return (1 - t * t) / 0.2; }

/**
 * Extra DC (drain→source) a gate swing of amplitude A adds, and d/dvgs: the
 * cycle average of the square law and of its slope, in one pass over the
 * cycle (it runs inside every Newton iteration of the transient solve).
 */
export function mosRectification(part, vgs, A) {
    if (!(A > 1e-9)) return [0, 0];
    const P = part.params ?? {};
    const vth = mosThreshold(part.kind, P);
    const k = mosK(P);
    let avg = 0, slope = 0;
    for (const c of QUAD_COS) {
        const [vov, dv] = smoothVov(vgs + A * c - vth);
        avg += vov * vov; slope += vov * dv;
    }
    const [v0, d0] = smoothVov(vgs - vth);
    return [k * (avg / QUAD_COS.length - v0 * v0), 2 * k * (slope / QUAD_COS.length - v0 * d0)];
}

// ─── Solver-view expansion ──────────────────────────────────────────────

export const RF_DETECT_KIND = 'rf_detect';
export const COUPLED_INDUCTORS_KIND = 'coupled_inductors';
export const FERRITE_DEFAULTS = Object.freeze({ henrys: 250e-6, tap: 0.25, couplingRatio: 0.1, k: 0.98, couplingK: 0.9, q: 120,
    rodHeightM: 0.01, angleDeg: 0, distanceM: 1, linkRadiusM: 0.1, slide: 0 });
/** The near-field coupling radius of a link, by the naming coil's kind (a rod, a small VHF coil, a hand-wound search coil). */
const LINK_RADIUS_M = Object.freeze({ ferrite_coil: 0.1, vhf_coil: 0.02, air_coil: 0.05 });
/** Damping across an untuned radiating winding in the time domain (src/radio.js expandRadio). */
const RADIATOR_DAMPING_OHMS = 2200;
export const VHF_COIL_DEFAULTS = Object.freeze({ henrys: 0.15e-6, q: 80 });
/** Q of a hand-wound air coil at RF when its part gives none (copper and proximity losses). */
const AIR_COIL_RF_Q = 60;
export const ANTENNA_DEFAULTS = Object.freeze({ heightM: 5, ohms: 50, farads: 200e-12 });
export const CERAMIC_DEFAULTS = Object.freeze({ hz: 10.7e6, bandwidthHz: 280e3, ohms: 330, q: 1500, c0: 5e-12 });
export const DIPOLE_DEFAULTS = Object.freeze({ heightM: 0.95, ohms: 300, angleDeg: 0 });

/** A dipole's turn (degrees, its broadside direction) from its knob (0..1 = 0..360°) or its param. */
export function dipoleAngleDeg(part, control) {
    if (Number.isFinite(control)) return 360 * control;
    return num(part.params?.angleDeg, DIPOLE_DEFAULTS.angleDeg);
}
export const TUNING_CAP_DEFAULTS = Object.freeze({ minFarads: 10e-12, maxFarads: 500e-12, position: 0.5 });
export const VARICAP_DEFAULTS = Object.freeze({ cjo: 40e-12, vj: 0.7, m: 0.5, is: 1e-14, n: 1, vf: 0.7 });
const EARTH_OHMS = 30;
const COUNTERPOISE_FARADS = 50e-12;
const EARTH_NET = '@rf:earth';

/** Capacitance of a tuning capacitor at a knob position 0..1 (linear law). */
export function tuningCapFarads(part, position) {
    const P = part.params ?? {};
    const lo = num(P.minFarads, TUNING_CAP_DEFAULTS.minFarads);
    const hi = num(P.maxFarads, TUNING_CAP_DEFAULTS.maxFarads);
    const x = Math.min(1, Math.max(0, num(position, num(P.position, TUNING_CAP_DEFAULTS.position))));
    return lo + (hi - lo) * x;
}

/**
 * A rod with `slideWinding` set gives its knob to the coupling winding's
 * position along the rod (src/radio.js ferriteWindings) instead of its angle.
 */
export function rodControlIsSlide(part) { return !!part?.params?.slideWinding; }

/** A ferrite rod's angle (degrees) from its control (0..1 = 0..360°) or its param. */
export function rodAngleDeg(part, control) {
    if (Number.isFinite(control)) return 360 * control;
    return num(part.params?.angleDeg, FERRITE_DEFAULTS.angleDeg);
}

/**
 * A short winding slid from the middle of a rod (x = 0) to its end (x = 1)
 * has less ferrite inside it: its inductance falls to 40 % and its coupling
 * to the main winding to 30 % (the field of a rod is strongest at its middle
 * and spreads out of its ends).
 */
export function slideFactors(x) {
    const u = Math.min(1, Math.max(0, x));
    return { self: 1 - 0.6 * u * u, coupling: 1 - 0.7 * u };
}

/** Inductance matrix of a ferrite coil's connected windings (`slide`: the coupling winding's position, 0 middle … 1 end). */
function ferriteWindings(part, has, slide = 0) {
    const P = part.params ?? {};
    const L = num(P.henrys, FERRITE_DEFAULTS.henrys);
    const r = Math.min(0.95, Math.max(0.05, num(P.tap, FERRITE_DEFAULTS.tap)));
    // The coupling winding is a fraction of the main winding's turns
    // (couplingRatio ≤ 1; the board warns when a part asks for more).
    const n = Math.min(1, Math.max(1e-3, num(P.couplingRatio, FERRITE_DEFAULTS.couplingRatio)));
    const k = Math.min(0.999, Math.max(0, num(P.k, FERRITE_DEFAULTS.k)));
    const kc = Math.min(0.999, Math.max(0, num(P.couplingK, FERRITE_DEFAULTS.couplingK)));
    const w = [];
    if (has('tap') && has('a') && has('b')) {
        w.push({ a: 'a', b: 'tap', turns: r, main: true }, { a: 'tap', b: 'b', turns: 1 - r, main: true });
    } else if (has('a') && has('b')) {
        w.push({ a: 'a', b: 'b', turns: 1, main: true });
    } else if (has('a') && has('tap')) {
        w.push({ a: 'a', b: 'tap', turns: r, main: true });
    } else if (has('tap') && has('b')) {
        w.push({ a: 'tap', b: 'b', turns: 1 - r, main: true });
    }
    if (has('c1') && has('c2')) w.push({ a: 'c1', b: 'c2', turns: n, main: false });
    const sf = slideFactors(slide);
    const self = (x) => L * x.turns * x.turns * (x.main ? 1 : sf.self);
    const Lm = w.map((wi, i) => w.map((wj, j) => {
        const li = self(wi);
        const lj = self(wj);
        if (i === j) return li;
        return (wi.main && wj.main ? k : kc * sf.coupling) * Math.sqrt(li * lj);
    }));
    return { windings: w, L: Lm, q: Math.max(0, num(P.q, FERRITE_DEFAULTS.q)) };
}

/**
 * Solver-only expansion of the radio parts (see the module note). Returns
 * the new parts/nets and, when the circuit has a connected antenna or an RF
 * coil, the RadioFrontEnd that owns the broadcast and the junctions. The
 * caller's parts/nets are not mutated.
 *
 * @param {object[]} parts
 * @param {object[]} nets
 * @param {{controls: () => Map<string, number>}} opts
 */
export function expandRadio(parts, nets, opts) {
    const kinds = new Set(['antenna', 'earth', 'tuning_cap', 'ferrite_coil', 'vhf_coil', 'varicap', 'dipole', 'ceramic_filter']);
    if (!parts.some(p => kinds.has(p.kind))) return { parts, nets, radio: null };
    if (chooseFrontEnd(parts, nets) === 'phasor') return expandRadioPhasor(parts, nets, opts);
    let outParts = [...parts];
    const outNets = nets.map(n => ({ ...n, terminals: [...n.terminals] }));
    const netOf = (id, t) => outNets.find(n => n.terminals.some(x => x.part === id && x.terminal === t)) ?? null;
    const T = (part, terminal) => ({ part, terminal });
    const add = (part, ends) => {
        outParts.push(part);
        ends.forEach(([n, t]) => n.terminals.push(T(part.id, t)));
    };
    // Where a part the front end replaces carries its current in the solve
    // (board.branchCurrent): [part, terminal, solver part, its terminal].
    const aliases = [];
    const control = (id) => opts.controls?.()?.get(id);

    // Tuning capacitor: the solver's own capacitor, its farads read live
    // from the knob, so turning it needs no new netlist and keeps the
    // capacitor's stored voltage.
    outParts = outParts.map(p => {
        if (p.kind === 'tuning_cap') {
            const params = { ...p.params };
            Object.defineProperty(params, 'farads', {
                enumerable: true,
                get: () => tuningCapFarads(p, control(p.id)),
            });
            return { ...p, kind: 'capacitor', params };
        }
        // Varicap: a diode whose junction capacitance the RF network sees
        // (its few tens of pF are invisible at audio, where the transient
        // solve keeps it a plain diode).
        // Its part card first (the board resolves cards after this
        // expansion, and the defaults must not shadow the card's numbers).
        if (p.kind === 'varicap') return { ...p, kind: 'diode', params: { ...VARICAP_DEFAULTS, ...resolveParams(p.params ?? {}) }, varicap: true };
        return p;
    });

    // RF coils: the transient view uses the engine's inductor/transformer
    // with an RF damping resistor; the RF view swaps in the full coupled set.
    const coils = [];
    // A hand-wound air coil (src/sensing-transducers.js) in a circuit that
    // has an RF front end is an RF winding too: its inductance (moved by
    // metal near it, live) lives in the RF bands, its copper stays in the
    // time domain (the drawn coil's own branch a–m), and the hidden
    // inductor m–b becomes a short. A metal detector's 100 kHz search
    // oscillator then runs in a band, as an oscillator on a ferrite rod does.
    // Radiator test shared by every RF coil kind (see the ferrite coils below).
    const isLinked = (p) => !!p.params?.linkTo || parts.some(o => o.params?.linkTo === p.id);
    const acGroundNet = (n) => n.terminals.some(t => { const k = outParts.find(o => o.id === t.part)?.kind; return k === 'gnd' || k === 'vcc' || k === 'vsource' || k === 'battery'; });
    const isTuned = (p, nets) => {
        const own = new Set(nets.filter(n => n && !acGroundNet(n)));
        return outParts.some(o => (o.kind === 'capacitor' || o.kind === 'tuning_cap' || o.kind === 'polarized_cap')
            && (own.has(netOf(o.id, 'a')) || own.has(netOf(o.id, 'b'))));
    };
    for (const p of parts.filter(q => q.kind === 'air_coil')) {
        const lp = coilInductorParams(p);
        const inner = outParts.findIndex(q => q.id === `${p.id}_l` && q.kind === 'inductor');
        if (!lp || inner < 0 || !netOf(p.id, 'a') || !netOf(p.id, 'b') || netOf(p.id, 'a') === netOf(p.id, 'b')) continue;
        // Linked and untuned, an air coil is a radiator like an untuned
        // ferrite coil (below): a switched current must rise and fall with
        // its own L/R in the time domain. Shorting its inductance there let a
        // switch step the current in one solve, and the step radiated without
        // limit (an earphone coil 0.2 m from a VHF aerial coil rang the
        // receiver's 10.7 MHz IF band to 3.7 V and stopped its oscillator).
        const airRadiator = isLinked(p) && !isTuned(p, [netOf(p.id, 'a'), netOf(p.id, 'b')]);
        if (airRadiator) add({ id: `${p.id}_rd`, kind: 'resistor', params: { ohms: RADIATOR_DAMPING_OHMS }, terminals: ['a', 'b'] }, [[netOf(p.id, 'a'), 'a'], [netOf(p.id, 'b'), 'b']]);
        else outParts[inner] = { ...outParts[inner], kind: 'resistor', params: { ohms: 1e-3 } };
        const c = { part: p, kind: 'air_coil', windings: [{ a: 'a', b: 'b', turns: 1, main: true }],
            // The short m–b is time-domain only: in the RF view the drawn
            // coil's copper branch a–m would otherwise sit across the winding.
            q: Math.max(0, num(p.params?.q, AIR_COIL_RF_Q)), hidden: [`${p.id}_l`], nets: [[netOf(p.id, 'a').id, netOf(p.id, 'b').id]] };
        Object.defineProperty(c, 'L', { enumerable: true, get: () => [[lp.henrys]] });
        coils.push(c);
    }
    // Ceramic IF filter (in, gnd, out): two piezo resonators coupled through
    // a shunt capacitance — the two-pole band-pass a 10.7 MHz FM IF filter
    // is. Designed as a Butterworth pair for its centre `hz`, bandwidth
    // `bandwidthHz` and terminations `ohms` (series arms L = 1.414·R/(w·ω0),
    // the inverter Cc = 1/(ω0·K), K = w·ω0·L/1.414, w = B/f0, its series
    // −Cc absorbed into the arms' capacitors), each
    // resonator's Q `q` (1500). In the RF view only: at audio and DC it is
    // open (two 10 MΩ leaks keep its pins defined). Its motional inductors
    // are RF windings, so the band scan finds its passband like a tank.
    const ceramicRf = [];
    const rfNets = [];
    for (const p of parts.filter(q => q.kind === 'ceramic_filter')) {
        const nIn = netOf(p.id, 'in'), nOut = netOf(p.id, 'out'), nG = netOf(p.id, 'gnd');
        if (!nIn || !nOut || !nG || nIn === nOut) continue;
        const P = p.params ?? {};
        const f0 = Math.max(1e5, num(P.hz, CERAMIC_DEFAULTS.hz));
        const bw = Math.min(f0 / 4, Math.max(f0 / 1000, num(P.bandwidthHz, CERAMIC_DEFAULTS.bandwidthHz)));
        const R = Math.max(1, num(P.ohms, CERAMIC_DEFAULTS.ohms));
        const w0 = 2 * Math.PI * f0, fr = bw / f0;
        const Lm = Math.SQRT2 * R / (fr * w0);
        const Kinv = fr * w0 * Lm / Math.SQRT2;
        const Cc = 1 / (w0 * Kinv);
        // The inverter's series −Cc on each side, absorbed into the arms.
        const Cs = 1 / (w0 * w0 * Lm - 1 / Cc);
        const n1 = { id: `@rf:${p.id}:n1`, terminals: [] }, n2 = { id: `@rf:${p.id}:n2`, terminals: [] }, m = { id: `@rf:${p.id}:m`, terminals: [] };
        rfNets.push(n1.id, n2.id, m.id);
        const cap = (sfx, farads, a, b) => ceramicRf.push({ part: { id: `@rf:${p.id}:${sfx}`, kind: 'capacitor', params: { farads }, terminals: ['a', 'b'] },
            nets: [[a, 'a'], [b, 'b']] });
        cap('cs1', Cs, n1.id, m.id); cap('cs2', Cs, m.id, n2.id); cap('cc', Cc, m.id, nG.id);
        cap('c0i', CERAMIC_DEFAULTS.c0, nIn.id, nG.id); cap('c0o', CERAMIC_DEFAULTS.c0, nOut.id, nG.id);
        for (const [sfx, n] of [['leaki', nIn], ['leako', nOut]]) {
            add({ id: `${p.id}:${sfx}`, kind: 'resistor', params: { ohms: 10e6 }, terminals: ['a', 'b'] }, [[n, 'a'], [nG, 'b']]);
        }
        const q = Math.max(1, num(P.q, CERAMIC_DEFAULTS.q));
        coils.push({ part: p, kind: 'ceramic_filter', windings: [{ a: 'in', b: 'n1', turns: 1, main: true }, { a: 'n2', b: 'out', turns: 1, main: true }],
            L: [[Lm, 0], [0, Lm]], q, hidden: [], nets: [[nIn.id, n1.id], [n2.id, nOut.id]] });
    }
    for (const p of parts.filter(q => q.kind === 'ferrite_coil' || q.kind === 'vhf_coil')) {
        const has = (t) => !!netOf(p.id, t);
        let fw;
        if (p.kind === 'vhf_coil') {
            if (!has('a') || !has('b')) continue;
            const P = p.params ?? {};
            fw = { windings: [{ a: 'a', b: 'b', turns: 1, main: true }], L: [[num(P.henrys, VHF_COIL_DEFAULTS.henrys)]],
                q: Math.max(0, num(P.q, VHF_COIL_DEFAULTS.q)) };
        } else fw = ferriteWindings(p, has, num(p.params?.slide, 0));
        const wn = fw.windings.filter(w => netOf(p.id, w.a) !== netOf(p.id, w.b));
        if (wn.length !== fw.windings.length || !wn.length) continue;
        const hidden = [];
        const ends = (w) => [netOf(p.id, w.a), netOf(p.id, w.b)];
        // The TIME-domain view of a winding is its copper resistance only.
        // Everything a coil does at RF — resonance, coupling between windings,
        // feedback — lives in the RF bands; at audio a few hundred µH is a
        // fraction of an ohm. Coupling the windings here as well let the RF
        // feedback loop exist twice (a Meissner oscillator also ran as a
        // broadband blocking oscillator). A capacitor straight across a
        // winding is the tank's and moves to the RF view below.
        const copper = p.kind === 'vhf_coil' ? 0.05 : 2;
        // An UNTUNED coil linked to another one is a radiator (a button or a
        // transistor switching its current): its current must rise and fall
        // with its own L/R in the time domain, or a switched current would
        // step in no time and radiate without limit. Such a winding keeps its
        // self-inductance there, with its copper and a damping resistance
        // across it (the coil's own losses and stray capacitance, which in a
        // real coil take up the flyback when the current is broken). A tuned
        // coil keeps the copper-only view: its tank and any feedback loop
        // live in the RF bands alone. (A coil is a radiator only with no
        // capacitor on any of its windings' nets: driven straight from a
        // battery, a button, a transistor.)
        const linked = !!p.params?.linkTo || parts.some(o => o.params?.linkTo === p.id);
        // Any capacitor on a winding's net makes an LC with it that the RF
        // bands already carry (a tank across it, a bypass from one end to
        // ground, a coupling capacitor): giving that winding its inductance
        // in the time domain too would put the same resonance in both views,
        // and the time-domain copy, ringing, radiated into the band that
        // holds the original — a passive tank grew from noise.
        // (Not the reference nets: a bypass to ground elsewhere on the bench
        // shares the ground, not the winding.)
        const acGround = (n) => n.terminals.some(t => { const k = outParts.find(o => o.id === t.part)?.kind; return k === 'gnd' || k === 'vcc' || k === 'vsource' || k === 'battery'; });
        const windingNets = new Set(wn.flatMap(w => ends(w)).filter(n => !acGround(n)));
        const tuned = outParts.some(o => (o.kind === 'capacitor' || o.kind === 'tuning_cap' || o.kind === 'polarized_cap')
            && (windingNets.has(netOf(o.id, 'a')) || windingNets.has(netOf(o.id, 'b'))));
        const radiator = linked && !tuned;
        const currentIds = [];
        wn.forEach((w, i) => {
            const id = `${p.id}_w${i}`;
            const [na, nb] = ends(w);
            if (radiator) {
                aliases.push([p.id, w.a, id, 'a'], [p.id, w.a, `${id}d`, 'a'], [p.id, w.b, `${id}r`, 'b'], [p.id, w.b, `${id}d`, 'b']);
                const mid = { id: `n_${id}_mid`, terminals: [] };
                outNets.push(mid);
                add({ id, kind: 'inductor', params: { henrys: fw.L[i][i] }, terminals: ['a', 'b'] }, [[na, 'a'], [mid, 'b']]);
                add({ id: `${id}r`, kind: 'resistor', params: { ohms: Math.max(0.01, copper * w.turns) }, terminals: ['a', 'b'] }, [[mid, 'a'], [nb, 'b']]);
                add({ id: `${id}d`, kind: 'resistor', params: { ohms: RADIATOR_DAMPING_OHMS }, terminals: ['a', 'b'] }, [[na, 'a'], [nb, 'b']]);
                hidden.push(id, `${id}r`, `${id}d`);
            } else {
                add({ id, kind: 'resistor', params: { ohms: Math.max(0.01, copper * w.turns) }, terminals: ['a', 'b'] },
                    [[na, 'a'], [nb, 'b']]);
                hidden.push(id);
                aliases.push([p.id, w.a, id, 'a'], [p.id, w.b, id, 'b']);
            }
            currentIds.push(id);
        });
        const entry = { part: p, kind: p.kind, windings: wn, L: fw.L, q: fw.q, hidden, currentIds,
            nets: wn.map(w => [netOf(p.id, w.a).id, netOf(p.id, w.b).id]) };
        // A sliding coupling winding: its position is the rod's knob (live).
        if (p.kind === 'ferrite_coil' && rodControlIsSlide(p)) {
            Object.defineProperty(entry, 'L', { enumerable: true, get: () => {
                const c = control(p.id);
                return ferriteWindings(p, has, Number.isFinite(c) ? c : num(p.params?.slide, 0)).L;
            } });
        }
        coils.push(entry);
    }

    // Capacitors straight across a coil (a winding, or the whole main
    // winding) are tank capacitors: RF parts. In the time domain they would
    // sit across the winding's copper resistance — a sub-nanosecond mode
    // that every change of the rectified current rings and the transient
    // step control then has to chase (measured: 38 000 solves per simulated
    // ms on a Meissner transmitter). At audio the winding shorts them anyway,
    // so they move to the RF view only.
    const rfOnly = [];
    {
        const pairs = new Set();
        const key = (a, b) => [a, b].sort().join('|');
        for (const c of coils) {
            c.nets.forEach(([a, b]) => pairs.add(key(a, b)));
            const main = c.windings.map((w, i) => (w.main ? c.nets[i] : null)).filter(Boolean);
            if (main.length > 1) pairs.add(key(main[0][0], main[main.length - 1][1]));
        }
        outParts = outParts.filter(p => {
            if (p.kind !== 'capacitor') return true;
            const na = netOf(p.id, 'a'), nb = netOf(p.id, 'b');
            if (!na || !nb) return true;
            // Also every capacitor of RF size (Colpitts feedback, coupling
            // into a detector): at the ≤ 100 kHz the transient solve
            // resolves, 47 pF is above 34 kΩ, while across a junction whose
            // rectified current the bands keep changing it is the same
            // nanosecond mode. Larger ones (a grid-leak 100 pF, bypasses)
            // carry audio and quench and stay.
            const farads = Number(p.params?.farads);
            const rfSize = Number.isFinite(farads) && farads <= RF_ONLY_FARADS && !p.params?.position;
            if (!pairs.has(key(na.id, nb.id)) && !rfSize) return true;
            rfOnly.push({ part: p, nets: [[na.id, 'a'], [nb.id, 'b']] });
            na.terminals = na.terminals.filter(t => t.part !== p.id);
            nb.terminals = nb.terminals.filter(t => t.part !== p.id);
            return false;
        });
    }

    rfOnly.push(...ceramicRf);

    // Couple linked coils (near field) into one coupled set; every other
    // coil is a set of its own. Any RF coil may name another in `linkTo`: two
    // ferrite rods a few metres apart, a VHF transmitter's coil and a
    // receiver's, a search coil and a rod.
    const coupled = [];
    const used = new Set();
    const coilAngle = (g) => (g.kind === 'ferrite_coil' ? rodAngleDeg(g.part, rodControlIsSlide(g.part) ? undefined : control(g.part.id))
        : num(g.part.params?.angleDeg, 0));
    for (const c of coils) {
        if (used.has(c)) continue;
        const group = [c];
        used.add(c);
        const linkTo = c.part.params?.linkTo;
        // Either coil may name the other.
        const partner = coils.find(o => !used.has(o) && (o.part.id === linkTo || o.part.params?.linkTo === c.part.id)) ?? null;
        // The link's distance is the naming coil's.
        const namer = partner && partner.part.params?.linkTo === c.part.id ? partner : c;
        if (partner) { group.push(partner); used.add(partner); }
        const offsets = [];
        let K = 0;
        for (const g of group) { offsets.push(K); K += g.windings.length; }
        const linkK = () => {
            if (group.length < 2) return 0;
            const P = namer.part.params ?? {};
            const d = Math.max(1e-3, num(P.distanceM, FERRITE_DEFAULTS.distanceM));
            const r0 = Math.max(1e-4, num(P.linkRadiusM, LINK_RADIUS_M[namer.kind] ?? FERRITE_DEFAULTS.linkRadiusM));
            const da = (coilAngle(c) - coilAngle(partner)) * Math.PI / 180;
            return Math.min(0.5, DMath.pow(r0 / d, 3)) * DMath.cos(da);
        };
        const params = { q: c.q };
        Object.defineProperty(params, 'L', {
            enumerable: true,
            get: () => {
                const L = Array.from({ length: K }, () => new Array(K).fill(0));
                group.forEach((g, gi) => g.L.forEach((row, i) => row.forEach((v, j) => { L[offsets[gi] + i][offsets[gi] + j] = v; })));
                if (group.length > 1) {
                    const kl = linkK();
                    for (let i = 0; i < group[0].windings.length; i++) {
                        for (let j = 0; j < group[1].windings.length; j++) {
                            const a = i, b = offsets[1] + j;
                            const m = kl * Math.sqrt(L[a][a] * L[b][b]);
                            L[a][b] = m; L[b][a] = m;
                        }
                    }
                }
                return L;
            },
        });
        const terminals = [];
        const cnets = [];
        let w = 0;
        group.forEach((g) => g.nets.forEach(([a, b]) => {
            terminals.push(`w${w}a`, `w${w}b`);
            cnets.push([a, `w${w}a`], [b, `w${w}b`]);
            w++;
        }));
        // Rod pickup: the field induces in each winding an EMF ∝ its turns.
        const rods = group.map((g, gi) => g.kind !== 'ferrite_coil' ? null : {
            part: g.part,
            heightM: Math.max(0, num(g.part.params?.rodHeightM, FERRITE_DEFAULTS.rodHeightM)),
            offset: offsets[gi],
            turns: g.windings.map(x => x.turns),
            stations: Array.isArray(g.part.params?.stations) ? normalizeStations(g.part.params.stations) : null,
        }).filter(Boolean);
        const qs = group.flatMap(g => g.windings.map(() => g.q));
        params.q = c.q;
        params.qs = qs;
        coupled.push({
            remove: group.flatMap(g => g.hidden),
            part: { id: `${c.part.id}_rf`, kind: COUPLED_INDUCTORS_KIND, terminals, params },
            nets: cnets,
            rods,
            coilIds: group.map(g => g.part.id),
            // Per winding: the time-domain part carrying its current, and
            // which coil of the group it belongs to (impulse radiation).
            windingIds: group.flatMap(g => g.currentIds ?? g.hidden),
            owner: group.flatMap((g, gi) => g.windings.map(() => gi)),
        });
    }

    // Antennas and earth.
    const antennas = parts.filter(p => p.kind === 'antenna' && netOf(p.id, 'a'));
    const earths = parts.filter(p => p.kind === 'earth' && netOf(p.id, 'earth'));
    const dipoles = parts.filter(p => p.kind === 'dipole' && netOf(p.id, 'a') && netOf(p.id, 'b') && netOf(p.id, 'a') !== netOf(p.id, 'b'));
    // Without an antenna or an RF coil nothing carries RF: the parts are plain passives.
    if (!antennas.length && !coupled.length && !dipoles.length) return { parts: outParts, nets: outNets, radio: null, aliases };
    const antennaSpecs = [];
    // A half-wave dipole (folded: 300 Ω; plain: 75 Ω): balanced, no earth.
    // Its EMF is the field times its effective length (λ/π for a half-wave
    // dipole, ~1 m on the VHF broadcast band) times cos(turn − bearing): the
    // two-sided figure-eight a dipole turned on its mast shows. In the time
    // domain its two leads are joined through the radiation resistance.
    for (const d of dipoles) {
        const P = d.params ?? {};
        const emf = { id: `@rf:${d.id}:emf`, terminals: [] };
        outNets.push(emf);
        const srcId = `@rf:${d.id}:emf`;
        add({ id: srcId, kind: 'vsource', params: { volts: 0 }, terminals: ['pos', 'neg'] }, [[emf, 'pos'], [netOf(d.id, 'b'), 'neg']]);
        add({ id: `@rf:${d.id}:rrad`, kind: 'resistor', params: { ohms: Math.max(1, num(P.ohms, DIPOLE_DEFAULTS.ohms)) }, terminals: ['a', 'b'] },
            [[emf, 'a'], [netOf(d.id, 'a'), 'b']]);
        antennaSpecs.push({ id: d.id, sourceId: srcId, dipole: d, heightM: Math.max(0, num(P.heightM, DIPOLE_DEFAULTS.heightM)),
            stations: Array.isArray(P.stations) ? normalizeStations(P.stations) : null });
    }
    if (antennas.length) {
        const earthNet = { id: EARTH_NET, terminals: [] };
        outNets.push(earthNet);
        const R = (id, ohms, a, b) => add({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] }, [[a, 'a'], [b, 'b']]);
        const Cp = (id, farads, a, b) => add({ id, kind: 'capacitor', params: { farads }, terminals: ['a', 'b'] }, [[a, 'a'], [b, 'b']]);
        for (const e of earths) R(`@rf:${e.id}:earth`, Math.max(0.1, num(e.params?.ohms, EARTH_OHMS)), netOf(e.id, 'earth'), earthNet);
        if (!earths.length) {
            // No earth stake: the antenna's return is the circuit's own
            // capacitance to its surroundings (a counterpoise). Weak, as it is.
            const refId = chooseGroundReference(outParts, outNets)?.netId;
            const ref = outNets.find(n => n.id === refId) ?? netOf(antennas[0].id, 'a');
            Cp('@rf:counterpoise', COUNTERPOISE_FARADS, earthNet, ref);
            R('@rf:counterpoise_leak', 1e9, earthNet, ref);
        }
        for (const a of antennas) {
            const P = a.params ?? {};
            const emf = { id: `@rf:${a.id}:emf`, terminals: [] };
            const mid = { id: `@rf:${a.id}:r`, terminals: [] };
            outNets.push(emf, mid);
            const srcId = `@rf:${a.id}:emf`;
            add({ id: srcId, kind: 'vsource', params: { volts: 0 }, terminals: ['pos', 'neg'] }, [[emf, 'pos'], [earthNet, 'neg']]);
            R(`@rf:${a.id}:rant`, Math.max(0.1, num(P.ohms, ANTENNA_DEFAULTS.ohms)), emf, mid);
            Cp(`@rf:${a.id}:cant`, Math.max(1e-15, num(P.farads, ANTENNA_DEFAULTS.farads)), mid, netOf(a.id, 'a'));
            antennaSpecs.push({ id: a.id, sourceId: srcId, heightM: Math.max(0, num(P.heightM, ANTENNA_DEFAULTS.heightM)),
                stations: Array.isArray(P.stations) ? normalizeStations(P.stations) : null,
                clock: !!P.clock, hourOfDay: Math.min(24, Math.max(0, num(P.hourOfDay, 12))) });
        }
    }

    // A generic transistor's transient input capacitance (mna.js parasitics:
    // 5 pF B-E, a convergence aid for switching loops) is an RF-scale part.
    // The bands already carry the junction's capacitance at RF (Cπ from fT);
    // in the time domain, across a junction whose rectified current the
    // bands change continuously, it was a sub-nanosecond mode the step
    // control chased (a quenched VHF stage: the limiting state in 963 of
    // 1507 steps). Off for the transistors the bands stamp.
    outParts = outParts.map(p => {
        if ((p.kind === 'npn' || p.kind === 'pnp') && p.params?.model !== 'shockley' && p.params?.cpi === undefined) {
            return { ...p, params: { ...p.params, cpi: 0 } };
        }
        if ((p.kind === 'nmos' || p.kind === 'pmos') && p.params?.parasitics === undefined) {
            return { ...p, params: { ...p.params, parasitics: false } };
        }
        return p;
    });

    // Junctions: every diode, transistor and MOSFET can rectify and is
    // stamped into the RF bands by its describing function.
    const radio = new RadioFrontEnd({ antennas: antennaSpecs, detectors: [], coupled, controls: opts.controls });
    radio.rfOnly = rfOnly;
    radio.rfNets = rfNets;
    for (const p of outParts) {
        let terms, j, k2 = null;
        if (p.kind === 'lm386') {
            // An audio amplifier's inputs are the bases of PNP followers
            // (src/lm386.js). An RF swing there is rectified by that junction
            // like any other: the follower's emitter current is held, so its
            // mean base–emitter voltage drops by Vt·ln I0(A/Vt) and the stage
            // sees the input that much lower — an AM station's programme,
            // amplified (RF interference into an LM386). The whole input
            // swing is taken across the junction: an upper bound, as the
            // follower's emitter follows some of it.
            const gnd = netOf(p.id, 'gnd');
            if (!gnd || !netOf(p.id, 'vs')) continue;
            const inputs = {};
            for (const t of ['inp', 'inn']) {
                const n0 = netOf(p.id, t);
                if (!n0 || n0 === gnd) continue;
                const det = { id: `@rf:${p.id}:${t}`, partId: p.id, kind: 'amp-input', terminal: t, of: p,
                    index: radio.detectors.length, nets: [n0.id, gnd.id], wired: [], nets2: null, generic: false };
                Object.defineProperty(det, 'radio', { value: radio, enumerable: false });
                radio.detectors.push(det);
                inputs[t] = det;
            }
            Object.defineProperty(p, 'rfInputs', { value: inputs, enumerable: false, configurable: true, writable: true });
            continue;
        }
        if (p.kind === MIXER_IC_KIND) {
            // The mixer IC's Gilbert-cell core (src/mixer-ic.js): ports RF
            // input, LO, output pair. Its oscillator transistor is a hidden
            // npn and gets its own detector below.
            const pin = (t) => netOf(p.id, t);
            const ns = ['in_a', 'in_b', 'osc_b', 'gnd', 'out_a', 'out_b', 'vcc', 'gnd'].map(pin);
            if (ns.some(n => !n) || ns[0] === ns[1] || ns[4] === ns[5]) continue;
            const det = { id: `@rf:${p.id}:mix`, partId: p.id, kind: 'mixer', of: p, index: radio.detectors.length,
                nets: [ns[0].id, ns[1].id], netsLo: [ns[2].id, ns[3].id], netsOut: [ns[4].id, ns[5].id],
                netsSupply: [ns[6].id, ns[7].id], wired: [], nets2: null, generic: true };
            Object.defineProperty(det, 'radio', { value: radio, enumerable: false });
            Object.defineProperty(p, 'rfDetector', { value: det, enumerable: false, configurable: true, writable: true });
            radio.detectors.push(det);
            continue;
        }
        if (p.kind === FM_IF_KIND) {
            // The FM IF IC's input: a sensing port of the bands (src/fm-if-ic.js).
            const nIn = netOf(p.id, 'in'), nG = netOf(p.id, 'gnd');
            if (!nIn || !nG || nIn === nG) continue;
            const det = { id: `@rf:${p.id}:fmif`, partId: p.id, kind: 'fmif', of: p, index: radio.detectors.length,
                nets: [nIn.id, nG.id], wired: [], nets2: null, generic: true };
            Object.defineProperty(det, 'radio', { value: radio, enumerable: false });
            Object.defineProperty(p, 'rfDetector', { value: det, enumerable: false, configurable: true, writable: true });
            radio.detectors.push(det);
            continue;
        }
        if (p.kind === 'diode') { terms = ['anode', 'cathode']; j = ['anode', 'cathode']; }
        else if (p.kind === 'npn' || p.kind === 'pnp') { terms = ['base', 'collector', 'emitter']; j = ['base', 'emitter']; k2 = ['base', 'collector']; }
        else if (p.kind === 'nmos' || p.kind === 'pmos') { terms = ['gate', 'drain', 'source']; j = ['gate', 'source']; k2 = ['drain', 'source']; }
        else continue;
        const n0 = netOf(p.id, j[0]);
        const n1 = netOf(p.id, j[1]);
        if (!n0 || !n1 || n0 === n1) continue;
        const wired = terms.filter(t => netOf(p.id, t));
        const n2 = k2 ? netOf(p.id, k2[1] === 'collector' ? 'collector' : 'drain') : null;
        const id = `@rf:${p.id}:det`;
        const hidden = { id, kind: RF_DETECT_KIND, params: {}, terminals: wired };
        const det = {
            id, partId: p.id, kind: p.kind, of: p, index: radio.detectors.length,
            nets: [n0.id, n1.id], wired,
            // Second port: B–C of a bipolar (base, collector), D–S of a MOSFET (drain, source).
            nets2: n2 ? (p.kind === 'npn' || p.kind === 'pnp' ? [n0.id, n2.id] : [n2.id, n1.id]) : null,
            generic: !((p.kind === 'npn') && p.params?.model === 'shockley'),
        };
        Object.defineProperty(hidden, 'rfDetector', { value: det, enumerable: false });
        Object.defineProperty(det, 'radio', { value: radio, enumerable: false });
        radio.detectors.push(det);
        add(hidden, wired.map(t => [netOf(p.id, t), t]));
        // Its rectified current flows through the device's own leads.
        for (const t of wired) aliases.push([p.id, t, id, t]);
    }
    return { parts: outParts, nets: outNets, radio, aliases };
}

/**
 * Which front end a circuit gets. The envelope bands whenever the circuit
 * could do something a linear phasor cannot: an RF coil winding sharing a
 * (non-supply) net with a transistor's collector, emitter, drain or source
 * (a tickler, a tank in the collector: feedback), a MOSFET, an air-core coil
 * or a varicap (VHF work), FM or Morse stations, linked rods or a rod with
 * its own broadcast, or no long wire at all (the rod is the antenna).
 * Otherwise the round-3 phasor front end, whose numbers every round-3
 * receiver was measured on.
 */
export function chooseFrontEnd(parts, nets) {
    const byId = new Map(parts.map(p => [p.id, p]));
    const coilT = (p, t) => (p.kind === 'ferrite_coil' && ['a', 'tap', 'b', 'c1', 'c2'].includes(t)) || (p.kind === 'vhf_coil');
    const outT = (p, t) => ((p.kind === 'npn' || p.kind === 'pnp') && (t === 'collector' || t === 'emitter'))
        || ((p.kind === 'nmos' || p.kind === 'pmos') && (t === 'drain' || t === 'source'));
    if (parts.some(p => ['vhf_coil', 'varicap', 'nmos', 'pmos', MIXER_IC_KIND].includes(p.kind))) return 'envelope';
    if (parts.some(p => p.kind === 'ferrite_coil' && (p.params?.linkTo || p.params?.slideWinding || Array.isArray(p.params?.stations)))) return 'envelope';
    // An antenna with a clock (the sky wave by the hour) is heard through the bands.
    if (parts.some(p => p.kind === 'antenna' && p.params?.clock)) return 'envelope';
    if (parts.some(p => ['dipole', 'ceramic_filter', 'fm_if'].includes(p.kind) || (['air_coil', 'vhf_coil'].includes(p.kind) && p.params?.linkTo))) return 'envelope';
    const antennas = parts.filter(p => p.kind === 'antenna');
    if (!antennas.length) return 'envelope';
    // A wire straight on an audio amplifier's input: the amplifier's input
    // junction is the detector (RF interference into an LM386), which only
    // the envelope bands model (amplifier inputs as detectors).
    const ampIn = new Set();
    for (const n of nets) if (n.terminals.some(t => byId.get(t.part)?.kind === 'lm386' && (t.terminal === 'inp' || t.terminal === 'inn'))) ampIn.add(n);
    for (const n of ampIn) if (n.terminals.some(t => byId.get(t.part)?.kind === 'antenna')) return 'envelope';
    for (const a of antennas) for (const s of a.params?.stations ?? []) if (s?.mod && s.mod !== 'am') return 'envelope';
    for (const n of nets) {
        const ps = n.terminals.map(t => [byId.get(t.part), t.terminal]).filter(([p]) => p);
        if (ps.some(([p]) => p.kind === 'gnd' || p.kind === 'vcc' || p.kind === 'vsource' || p.kind === 'earth')) continue;
        if (ps.some(([p, t]) => coilT(p, t)) && ps.some(([p, t]) => outT(p, t))) return 'envelope';
    }
    return 'phasor';
}

function expandRadioPhasor(parts, nets, opts) {
    const kinds = new Set(['antenna', 'earth', 'tuning_cap', 'ferrite_coil']);
    if (!parts.some(p => kinds.has(p.kind))) return { parts, nets, radio: null };
    let outParts = [...parts];
    const outNets = nets.map(n => ({ ...n, terminals: [...n.terminals] }));
    const netOf = (id, t) => outNets.find(n => n.terminals.some(x => x.part === id && x.terminal === t)) ?? null;
    const T = (part, terminal) => ({ part, terminal });
    const add = (part, ends) => {
        outParts.push(part);
        ends.forEach(([n, t]) => n.terminals.push(T(part.id, t)));
    };
    const aliases = [];

    // Tuning capacitor: the solver's own capacitor, its farads read live
    // from the knob, so turning it needs no new netlist and keeps the
    // capacitor's stored voltage.
    outParts = outParts.map(p => {
        if (p.kind !== 'tuning_cap') return p;
        const params = { ...p.params };
        Object.defineProperty(params, 'farads', {
            enumerable: true,
            get: () => tuningCapFarads(p, opts.controls?.()?.get(p.id)),
        });
        return { ...p, kind: 'capacitor', params };
    });

    // Ferrite coil: transient view uses the engine's inductor/transformer;
    // the RF view swaps in the full coupled set.
    const coupled = [];
    for (const p of parts.filter(q => q.kind === 'ferrite_coil')) {
        const has = (t) => !!netOf(p.id, t);
        const fw = ferriteWindings(p, has);
        const wn = fw.windings.filter(w => netOf(p.id, w.a) !== netOf(p.id, w.b));
        if (wn.length !== fw.windings.length || !wn.length) continue;
        const hidden = [];
        const ends = (w) => [netOf(p.id, w.a), netOf(p.id, w.b)];
        if (wn.length === 1) {
            const [na, nb] = ends(wn[0]);
            const id = `${p.id}_L0`;
            add({ id, kind: 'inductor', params: { henrys: fw.L[0][0] }, terminals: ['a', 'b'] }, [[na, 'a'], [nb, 'b']]);
            hidden.push(id);
            aliases.push([p.id, wn[0].a, id, 'a'], [p.id, wn[0].b, id, 'b']);
        } else {
            const [p1, p2] = ends(wn[0]);
            const [s1, s2] = ends(wn[1]);
            const id = `${p.id}_T01`;
            add({ id, kind: 'transformer', terminals: ['p1', 'p2', 's1', 's2'],
                params: { l1: fw.L[0][0], l2: fw.L[1][1], k: fw.L[0][1] / Math.sqrt(fw.L[0][0] * fw.L[1][1]) } },
            [[p1, 'p1'], [p2, 'p2'], [s1, 's1'], [s2, 's2']]);
            hidden.push(id);
            aliases.push([p.id, wn[0].a, id, 'p1'], [p.id, wn[0].b, id, 'p2'], [p.id, wn[1].a, id, 's1'], [p.id, wn[1].b, id, 's2']);
            if (wn.length === 3) {
                const [na, nb] = ends(wn[2]);
                const lid = `${p.id}_L2`;
                add({ id: lid, kind: 'inductor', params: { henrys: fw.L[2][2] }, terminals: ['a', 'b'] }, [[na, 'a'], [nb, 'b']]);
                hidden.push(lid);
                aliases.push([p.id, wn[2].a, lid, 'a'], [p.id, wn[2].b, lid, 'b']);
            }
        }
        // RF damping in the TIME domain only. The tank's ~1 MHz natural mode
        // carries no information at audio rate (the RF solve owns it), but
        // an undamped LC in the transient integrator rings at every kick
        // the detector gives it and the step controller then resolves that
        // ringing. A resistor ωL (at 1 MHz) across each winding damps the
        // mode to Q ≈ 1 and is invisible at audio, where the winding is a
        // short (ωL ≈ 1.6 Ω at 1 kHz against ~1.6 kΩ). Removed in the RF view.
        wn.forEach((w, i) => {
            const id = `${p.id}_damp${i}`;
            const [na, nb] = ends(w);
            add({ id, kind: 'resistor', params: { ohms: 2 * Math.PI * 1e6 * fw.L[i][i] }, terminals: ['a', 'b'] },
                [[na, 'a'], [nb, 'b']]);
            hidden.push(id);
            aliases.push([p.id, w.a, id, 'a'], [p.id, w.b, id, 'b']);
        });
        const terminals = wn.flatMap((_, i) => [`w${i}a`, `w${i}b`]);
        coupled.push({
            remove: hidden,
            part: { id: `${p.id}_rf`, kind: COUPLED_INDUCTORS_KIND, terminals, params: { L: fw.L, q: fw.q } },
            nets: wn.flatMap((w, i) => [[netOf(p.id, w.a).id, `w${i}a`], [netOf(p.id, w.b).id, `w${i}b`]]),
        });
    }

    // Antennas and earth.
    const antennas = parts.filter(p => p.kind === 'antenna' && netOf(p.id, 'a'));
    const earths = parts.filter(p => p.kind === 'earth' && netOf(p.id, 'earth'));
    // Without an antenna nothing carries RF: the parts are plain passives.
    if (!antennas.length) return { parts: outParts, nets: outNets, radio: null, aliases };
    const earthNet = { id: EARTH_NET, terminals: [] };
    outNets.push(earthNet);
    const R = (id, ohms, a, b) => add({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] }, [[a, 'a'], [b, 'b']]);
    const Cp = (id, farads, a, b) => add({ id, kind: 'capacitor', params: { farads }, terminals: ['a', 'b'] }, [[a, 'a'], [b, 'b']]);
    for (const e of earths) R(`@rf:${e.id}:earth`, Math.max(0.1, num(e.params?.ohms, EARTH_OHMS)), netOf(e.id, 'earth'), earthNet);
    if (!earths.length) {
        // No earth stake: the antenna's return is the circuit's own
        // capacitance to its surroundings (a counterpoise). Weak, as it is.
        const refId = chooseGroundReference(outParts, outNets)?.netId;
        const ref = outNets.find(n => n.id === refId) ?? netOf(antennas[0].id, 'a');
        Cp('@rf:counterpoise', COUNTERPOISE_FARADS, earthNet, ref);
        R('@rf:counterpoise_leak', 1e9, earthNet, ref);
    }
    const antennaSpecs = [];
    for (const a of antennas) {
        const P = a.params ?? {};
        const emf = { id: `@rf:${a.id}:emf`, terminals: [] };
        const mid = { id: `@rf:${a.id}:r`, terminals: [] };
        outNets.push(emf, mid);
        const srcId = `@rf:${a.id}:emf`;
        add({ id: srcId, kind: 'vsource', params: { volts: 0 }, terminals: ['pos', 'neg'] }, [[emf, 'pos'], [earthNet, 'neg']]);
        R(`@rf:${a.id}:rant`, Math.max(0.1, num(P.ohms, ANTENNA_DEFAULTS.ohms)), emf, mid);
        Cp(`@rf:${a.id}:cant`, Math.max(1e-15, num(P.farads, ANTENNA_DEFAULTS.farads)), mid, netOf(a.id, 'a'));
        antennaSpecs.push({ id: a.id, sourceId: srcId, heightM: Math.max(0, num(P.heightM, ANTENNA_DEFAULTS.heightM)),
            stations: Array.isArray(P.stations) ? normalizeStations(P.stations) : null });
    }

    // Detectors: every diode and transistor junction can rectify.
    const radio = new PhasorFrontEnd({ antennas: antennaSpecs, detectors: [], coupled });
    for (const p of parts) {
        let terms;
        if (p.kind === 'diode') terms = ['anode', 'cathode'];
        else if (p.kind === 'npn' || p.kind === 'pnp') terms = ['base', 'collector', 'emitter'];
        else continue;
        const j = p.kind === 'diode' ? ['anode', 'cathode'] : ['base', 'emitter'];
        const n0 = netOf(p.id, j[0]);
        const n1 = netOf(p.id, j[1]);
        if (!n0 || !n1 || n0 === n1) continue;
        const wired = terms.filter(t => netOf(p.id, t));
        const id = `@rf:${p.id}:det`;
        const hidden = { id, kind: RF_DETECT_KIND, params: {}, terminals: wired };
        const det = { id, partId: p.id, kind: p.kind, of: p, index: radio.detectors.length,
            nets: [n0.id, n1.id], wired, testId: `@rf:${p.id}:itest` };
        Object.defineProperty(hidden, 'rfDetector', { value: det, enumerable: false });
        Object.defineProperty(det, 'radio', { value: radio, enumerable: false });
        radio.detectors.push(det);
        add(hidden, wired.map(t => [netOf(p.id, t), t]));
        // Its rectified current flows through the device's own leads.
        for (const t of wired) aliases.push([p.id, t, id, t]);
    }
    return { parts: outParts, nets: outNets, radio, aliases };
}

// ─── Products between bands: mixing and harmonics ───────────────────────

/**
 * I_k(x)/I0(x) for k = 1, 2, 3 (the k-th harmonic of e^{x·cos θ} is
 * 2·I_k(x)·cos kθ, its mean I0(x)). Series for small x, where the
 * recurrence I_{k+1} = I_{k−1} − (2k/x)·I_k cancels (below x = 3).
 */
export function besselRatio(k, x) {
    if (x < 3) {
        // Σ_m y^m/(m!(m+k)!), y = x²/4: sixteen terms reach 1e-15 below x = 3
        // (the A&S fits behind i0e/i1e are good to 2e-7, which the recurrence
        // amplifies for k = 3 at small x).
        const y = (x / 2) * (x / 2);
        let f = 1, p = 1;
        for (let i = 1; i <= k; i++) { f *= i; p *= x / 2; }
        let sk = 0, s0 = 0, tk = 1 / f, t0 = 1;
        for (let m = 0; m < 16; m++) {
            sk += tk; s0 += t0;
            tk *= y / ((m + 1) * (m + 1 + k)); t0 *= y / ((m + 1) * (m + 1));
        }
        return p * sk / s0;
    }
    const r1 = i1e(x) / i0e(x);
    if (k === 1) return r1;
    const r2 = 1 - 2 * r1 / x;
    if (k === 2) return r2;
    return r1 - 4 * r2 / x;
}

const tanhLo = (v) => DMath.tanh(v / (2 * VT));

/** The mixer core's RF transconductance under a swing A: fundamental/A of iT·tanh(gm·v/iT). */
export function mixerRfGain(gm, iT, A) {
    if (!(iT > 0)) return 0;
    if (!(A * gm / iT > 1e-4)) return gm;
    let f = 0;
    for (const c of QUAD_COS) f += iT * DMath.tanh(gm * A * c / iT) * c;
    return 2 * f / (QUAD_COS.length * A);
}

/** Mean of tanh(v_lo/2Vt) over an LO swing of amplitude A about v0. */
export function mixerLoMean(v0, A) {
    if (!(A > 1e-9)) return tanhLo(v0);
    let f = 0;
    for (const c of QUAD_COS) f += tanhLo(v0 + A * c);
    return f / QUAD_COS.length;
}

/** Fundamental of tanh(v_lo/2Vt) per volt of LO swing (→ 4/(πA) for a large LO). */
export function mixerLoGain(v0, A) {
    if (!(A > 1e-6)) { const t = tanhLo(v0); return (1 - t * t) / (2 * VT); }
    let f = 0;
    for (const c of QUAD_COS) f += tanhLo(v0 + A * c) * c;
    return 2 * f / (QUAD_COS.length * A);
}

const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const conj = (a) => [a[0], -a[1]];
const cabs = (a) => Math.hypot(a[0], a[1]);

// ─── The RF bands ───────────────────────────────────────────────────────

const REFRESH_SEC = 5e-3;
const RESCAN_SEC = 200e-3;
const SCAN_LO_HZ = 30e3;
const SCAN_HI_HZ = 300e6;
const SCAN_PER_DECADE = 20;
const SLOW_BEAT_HZ = 10e3;
const ENVELOPE_POINTS_PER_CYCLE = 10;
const ROTATION_STEPS = 16;
const H_TARGET_MAX = 20e-6;
const NOISE_SEED = 0x5eed1234;
const RF_ONLY_FARADS = 47e-12;
const SIGMA_FOLLOW = 2e5;
/**
 * A band whose swing passes this, or that needs more substeps than this
 * ahead of the circuit's last accepted step, is refused (RfBand._refuse):
 * no circuit on a bench swings kilovolts, and a band that cannot keep up
 * with its own growth at a nanosecond step would otherwise keep integrating
 * — and remembering — ahead of every trial step the transient solve rejects.
 */
const RF_RUNAWAY_VOLTS = 1e4;
const RF_HISTORY_LIMIT = 20000;
/** Substeps per envelope time constant while a band's swing drives its junctions (RfBand.advanceTo). */
const LOOP_STEPS = 32;
const LOOP_VOLTS = 2 * VT;
/** How long a band counts as able to oscillate after it was last seen unstable (a quench turns it on and off). */
const ACTIVE_HOLD_SEC = 20e-3;
/** Swing above which a band whose small-signal network is unstable counts as oscillating (RfBand._bound). */
const OSC_VOLTS = 0.05;
const IS_TAU_SEC = 2e-3;
const REBOUND_SEC = 0.1e-3;
const CURRENT_TAU_SEC = 5e-6;
const LOAD_TAU_SEC = 1e-3;
const RETUNE_SEC = 1e-3;
const DEFAULT_LOAD_OHMS = 47e3;

/** Half-width of a band around its centre: catches the 9/10 kHz MW neighbours and an FM station's swing. */
export const bandHalfWidthHz = (hz) => Math.max(SLOW_BEAT_HZ, hz * 1e-2);

const sq = (r, i) => r * r + i * i;

export class RadioFrontEnd {
    constructor({ antennas, detectors, coupled, controls }) {
        this.antennas = antennas;
        this.detectors = detectors;
        this.coupled = coupled;
        this._controls = controls;
        this.stations = normalizeStations(DEFAULT_STATIONS);
        this.reset();
    }

    reset() {
        this._sys = null;           // indexing of the RF system
        this._isLog = null;
        this._biasPrev = null;
        this._tAccept = undefined;
        this._bands = [];           // dynamic bands
        this._static = [];          // quasi-static stations: {k, H (port phasors), nets}
        this._stationNets = null;   // per station: Map net -> [re, im]
        this._resonances = [];
        this._tRefresh = -Infinity;
        this._tScan = -Infinity;
        this._dirty = true;
        this._controlsKey = '';
        this._bias = null;
        this._portCache = { t: NaN, L: null, A2: null };
        this._lastBandAmp = null;
        this._rand = mulberry32(NOISE_SEED);
        this._rad = null;
        this._events = null;
        this.error = null;
        this.refreshes = 0;
        this.scans = 0;
        this.substeps = 0;
    }

    /** Stations seen by the antennas and rods (union; each one's override wins for it). */
    allStations() {
        const out = [...this.stations];
        const extra = [...this.antennas.map(a => a.stations), ...this.coupled.flatMap(c => c.rods.map(r => r.stations))];
        for (const list of extra) for (const s of list ?? []) if (!out.some(o => o.id === s.id)) out.push(s);
        return out;
    }

    setStations(list) {
        this.stations = normalizeStations(list);
        this._dirty = true;
        this._tScan = -Infinity;
    }

    /** EMF (V peak) station `s` induces in antenna `a`. */
    emf(a, s) {
        const own = a.stations ? a.stations.find(x => x.id === s.id) : s;
        if (!own) return 0;
        if (a.dipole) {
            const turn = dipoleAngleDeg(a.dipole, this._controls?.()?.get(a.id));
            return stationField(own, this.hour()) * a.heightM * DMath.cos((turn - own.bearingDeg) * Math.PI / 180);
        }
        return stationField(own, this.hour()) * a.heightM;
    }

    /**
     * The hour of the day (0..24) the broadcast is heard at: an antenna with
     * `params.clock` carries it on its dial (0..1 = 00:00..24:00), else its
     * `params.hourOfDay`; noon otherwise (no sky wave).
     */
    hour() {
        const a = this.antennas.find(x => x.clock);
        if (!a) return 12;
        const v = this._controls?.()?.get(a.id);
        return Number.isFinite(v) ? 24 * Math.min(1, Math.max(0, v)) : a.hourOfDay;
    }

    /** EMF (V peak, signed) station `s` induces in the whole main winding of rod `r`. */
    rodEmf(r, s) {
        const own = r.stations ? r.stations.find(x => x.id === s.id) : s;
        if (!own || !(r.heightM > 0)) return 0;
        const angle = rodAngleDeg(r.part, rodControlIsSlide(r.part) ? undefined : this._controls?.()?.get(r.part.id));
        return stationField(own, this.hour()) * r.heightM * (own.hz / 1e6) * DMath.cos((angle - own.bearingDeg) * Math.PI / 180);
    }

    /**
     * Upper bound on the transient step that keeps the programme and the
     * audible beats resolved.
     */
    maxStepSec() {
        const st = this.allStations();
        let f = 0;
        for (const s of st) f = Math.max(f, audioMaxHz(s.audio));
        for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) {
            const d = Math.abs(st[i].hz - st[j].hz);
            if (d > 0 && d <= SLOW_BEAT_HZ) f = Math.max(f, d);
        }
        for (const b of this._bands) for (const k of b.members) {
            const d = Math.abs(st[k]?.hz - b.hz);
            if (d > 200 && d <= SLOW_BEAT_HZ) f = Math.max(f, d);
        }
        // A mixer IC turns an oscillation's offset from the band's station into audio.
        if (this.detectors.some(d => d.kind === 'mixer')) for (const b of this._bands) {
            const o = Math.abs(b.oscHz ?? 0);
            if (o > 0 && o <= SLOW_BEAT_HZ) f = Math.max(f, o);
        }
        return f > 0 ? 1 / (ENVELOPE_POINTS_PER_CYCLE * f) : null;
    }

    // ── Operating point ──────────────────────────────────────────────

    _snapshot(solution) {
        const nv = (id) => solution?.nodeVoltages?.get(id) ?? 0;
        return this.detectors.map(d => {
            const P = d.of.params ?? {};
            if (d.kind === 'amp-input') return { v: nv(d.nets[0]) - nv(d.nets[1]) };
            if (d.kind === 'fmif') return { fmif: true };
            if (d.kind === 'mixer') {
                const card = mixerCard(d.of);
                const g = nv(d.netsSupply[1]);
                const iT = mixerTail(card, nv(d.netsSupply[0]) - g);
                const fade = (mixerOutputFade(nv(d.netsOut[0]) - g) + mixerOutputFade(nv(d.netsOut[1]) - g)) / 2;
                // ic: the tail the outputs can carry (a resonance scan zeroes it, as a transistor's).
                return { mixer: true, card, iT, ic: iT * fade, fade, vlo: nv(d.netsLo[0]) - g - LO_BIAS_RATIO * (nv(d.netsSupply[0]) - g) };
            }
            if (d.kind === 'diode') {
                const v = nv(d.nets[0]) - nv(d.nets[1]);
                // The DC current through it (rectification included): raw
                // branch currents are OUT of the part at each terminal.
                // The rectified part flows in the rf_detect companion, a
                // separate part of the transient solve: add it back.
                const iDev = -(solution?.branchCurrents?.get(d.partId)?.get('anode') ?? NaN);
                const i = iDev - (solution?.branchCurrents?.get(d.id)?.get('anode') ?? 0);
                return { v, i, iDev, card: junctionCard(d.of), P };
            }
            if (d.kind === 'npn' || d.kind === 'pnp') {
                const s = d.kind === 'pnp' ? -1 : 1;
                const vbe = s * (nv(d.nets[0]) - nv(d.nets[1]));
                const vbc = d.nets2 ? s * (nv(d.nets2[0]) - nv(d.nets2[1])) : -10;
                const ic = Math.abs(solution?.branchCurrents?.get(d.partId)?.get('collector') ?? 0);
                const vce = vbe - vbc;
                const card = junctionCard(d.of);
                const beta = Math.max(1, num(P.beta, 100));
                const saturated = ic > 1e-9 && vbe > 0 && d.nets2 && vce < num(P.vceSat, 0.2) * 1.5;
                // The emitter junction's saturation current AS THE TRANSIENT
                // SOLVE SEES IT: the generic transistor's law is a piecewise
                // knee, not Shockley's, so a Shockley Is would rectify a
                // current the device does not carry. Calibrated at the
                // operating point: Is·e^{vbe/Vt} = the emitter current now.
                // Only while the device conducts (its piecewise law has no
                // exponential tail to calibrate against below the knee): a
                // transistor driven into class C by its own swing keeps the
                // law it had, as a real junction would.
                const conducting = ic > 1e-6 && vbe > 0.55;
                const isEff = !d.generic ? card.is
                    : conducting ? ic * (beta + 1) / beta * DMath.exp(-Math.min(vbe, 1.5) / VT) : NaN;
                return { vbe, vbc, ic, saturated, card, isEff, beta,
                    ft: Math.max(1e6, num(P.ft, 300e6)), cjc: num(P.cfb, num(P.cjc, 4e-12)), cje: num(P.cje, 0) };
            }
            const s = d.kind === 'pmos' ? -1 : 1;
            const vgs = s * (nv(d.nets[0]) - nv(d.nets[1]));
            const vds = d.nets2 ? s * (nv(d.nets2[0]) - nv(d.nets2[1])) : 0;
            const id = Math.abs(solution?.branchCurrents?.get(d.partId)?.get('drain') ?? 0);
            return { vgs, vds, id, law: mosLaw(P, d.kind), vth: mosThreshold(d.kind, P), lambda: num(P.lambda, 0), cgs: num(P.cgs, 0), cgd: num(P.cgd, 0) };
        });
    }

    /**
     * A diode's average current (+Is) under a swing x = A/nVt, for its RF
     * conductance (I + Is)·g(x)/nVt. A diode held in forward conduction by
     * its bias keeps the current the transient solve gives it. A DETECTOR
     * (reverse-biased by its own rectified current) is taken at the bias it
     * settles to on its DC load R, Is·(e^{v/nVt}·Π I0 − 1) = −v/R, with R
     * the load the transient solve shows it (smoothed): the conductance
     * then follows the swing at once, as the detector's charge does within
     * a few carrier cycles, instead of one step late through the transient
     * solve, which made the two solves chase each other.
     */
    _diodeIavg(b, x, Lother) {
        const { is, nVt } = b.card;
        const L = lnI0(x) + Lother;
        if (b.v > 0 && b.iDev > 0) return Math.max(0, b.i) + is;
        const R = b.rLoad ?? DEFAULT_LOAD_OHMS;
        const h = (v) => is * (DMath.exp(Math.min(700, v / nVt + L)) - 1) + v / R;
        let lo = -(x * nVt + 2), hi = 0.5;
        for (let k = 0; k < 50; k++) { const mid = (lo + hi) / 2; if (h(mid) > 0) hi = mid; else lo = mid; }
        return expCapped((lo + hi) / 2 / nVt + L, is)[0];
    }

    /** Junction admittance blocks at one band frequency: {S0r,S0i,S1r,S1i} (K×K). */
    _stamps(omega, vp, other) {
        const K = this._sys.K;
        const S0r = new Float64Array(K * K), S0i = new Float64Array(K * K);
        const S1r = new Float64Array(K * K), S1i = new Float64Array(K * K);
        const bias = this._bias;
        if (!bias) return { S0r, S0i, S1r, S1i };
        const amp = (a) => Math.hypot(vp[a][0], vp[a][1]);
        const put = (a, c, g, cap) => {
            const m = a * K + c;
            S0r[m] += g; S0i[m] += omega * cap; S1r[m] += cap;
        };
        for (const j of this._sys.junctions) {
            const b = bias[j.d.index];
            if (j.kind === 'diode') {
                const a = j.p[0];
                const x = amp(a) / b.card.nVt;
                // Fundamental conductance (I + Is)·g(x)/nVt at the DC current
                // the transient solve carries — smooth where e^{v/nVt} of a
                // lagging v would not be (it is the same quantity in steady
                // state: the DC current already holds Π I0).
                const iavg = this._diodeIavg(b, x, other.L[a]);
                put(a, a, iavg * besselGain(x) / b.card.nVt, junctionCapacitance(b.P, b.v));
            } else if (j.kind === 'bjt') {
                const [pbe, pbc] = j.p;
                const xbe = amp(pbe) / VT;
                // Large-signal transconductance: the collector current's
                // fundamental over the B-E swing.
                const gmLarge = b.ic * besselGain(xbe) / VT;
                // The diffusion charge is τF times the collector current, so its
                // fundamental — the input capacitance a swing sees — is τF times
                // the fundamental current: τF·gm at the same compression. (Was
                // τF·ic/VT, the small-signal value at the DC current: a stage
                // driven into class C by its own swing, whose DC current is
                // nearly all rectified peaks, hung tens of picofarads on its
                // tank that its junction does not have.)
                const gm = b.saturated ? 0 : gmLarge;
                const cpi = gmLarge / (2 * Math.PI * b.ft) + b.cje;
                let gbc = 0;
                if (pbc !== undefined) {
                    const xbc = amp(pbc) / VT;
                    const [ibc] = expCapped(b.vbc / VT + lnI0(xbc) + other.L[pbc], b.card.is);
                    gbc = ibc * besselGain(xbc) / VT;
                }
                // rows: base current (B−E pattern), collector current (C−E pattern);
                // cols: v_be, v_bc.
                put(pbe, pbe, gm / b.beta, cpi);
                if (pbc !== undefined) {
                    put(pbe, pbc, gbc, b.cjc);
                    put(pbc, pbe, gm, 0);
                    put(pbc, pbc, -gbc, -b.cjc);
                    if (b.saturated) { put(pbc, pbe, 10, 0); put(pbc, pbc, -10, 0); }
                }
            } else if (j.kind === 'mixer') {
                // In-band: a differential amplifier whose gain is the mean
                // of tanh(v_lo/2Vt) over the LO's swing (zero for a running
                // LO, whose products go to other bands and to audio).
                if (!(b.ic > 1e-9)) continue;
                const [prf, plo, pout] = j.p;
                const Arf = Math.sqrt(sq(vp[prf][0], vp[prf][1]) + other.A2[prf]);
                const Alo = Math.sqrt(sq(vp[plo][0], vp[plo][1]) + other.A2[plo]);
                const g = mixerRfGain(b.card.gm, b.ic, Arf) * mixerLoMean(b.vlo, Alo) / 2;
                if (g !== 0) put(pout, prf, g, 0);
            } else if (j.kind === 'mos') {
                const [pgs, pds] = j.p;
                const A = Math.sqrt(sq(vp[pgs][0], vp[pgs][1]) + other.A2[pgs]);
                // The channel fades as the drain runs down to the source
                // (triode) — by the same law as the rectified drain current
                // the transient solve carries (mosChannelFade). It was cut off
                // outright below 50 mV while the rectified current only faded:
                // an oscillator whose own rectified current bottomed its drain
                // then sat on that switch, gaining above it and not below, and
                // the transient solve chattered across it at ~20 000 steps per
                // simulated millisecond.
                const fade = mosChannelFade(b.vds);
                let gmEff = fade > 0 ? describeLaw(b.law, b.vgs, A)[1] * fade : 0;
                // The drain's own swing: past the headroom to the triode edge
                // (vds − vov) the channel stops being a current source for
                // part of each cycle and the fundamental it delivers levels
                // off. Without this a MOSFET oscillator's square law only
                // ever gained with its swing, and grew without bound.
                if (pds !== undefined && gmEff > 0) {
                    const Ad = Math.sqrt(sq(vp[pds][0], vp[pds][1]) + other.A2[pds]);
                    const head = Math.max(0.05, b.vds - Math.max(0, b.vgs - b.vth));
                    gmEff /= Math.sqrt(1 + (Ad / head) * (Ad / head));
                }
                const gds = 1e-6 + b.lambda * b.id;
                put(pgs, pgs, 0, b.cgs + b.cgd);
                if (pds !== undefined) {
                    put(pgs, pds, 0, -b.cgd);
                    put(pds, pgs, gmEff, -b.cgd);
                    put(pds, pds, gds, b.cgd);
                }
            }
        }
        return { S0r, S0i, S1r, S1i };
    }

    // ── The RF system ────────────────────────────────────────────────

    _buildSystem(board, solution) {
        const external = new Set(this.detectors.filter(d => d.generic).map(d => d.partId));
        const builder = board._radioSystem(this, solution, external);
        const { N, idxOf } = builder;
        const ports = [], inj = [], junctions = [];
        const pair = (a, b) => ({ pos: idxOf(a), neg: idxOf(b) });
        const portOwner = [];
        for (const d of this.detectors) {
            if (d.kind === 'fmif') {
                const a = ports.length;
                ports.push(pair(d.nets[0], d.nets[1])); inj.push({ pos: undefined, neg: undefined });
                portOwner.push({ d, nVt: VT });
                junctions.push({ d, kind: 'fmif', p: [a] });
                continue;
            }
            if (d.kind === 'mixer') {
                // RF input and LO: sensed only (the chip's own resistors are
                // in the linear network); output pair: the core's current.
                const a = ports.length;
                const none = { pos: undefined, neg: undefined };
                ports.push(pair(d.nets[0], d.nets[1])); inj.push(none);
                ports.push(pair(d.netsLo[0], d.netsLo[1])); inj.push(none);
                ports.push(pair(d.netsOut[0], d.netsOut[1])); inj.push(pair(d.netsOut[0], d.netsOut[1]));
                for (let i = 0; i < 3; i++) portOwner.push({ d, nVt: VT, mixer: true });
                junctions.push({ d, kind: 'mixer', p: [a, a + 1, a + 2] });
                continue;
            }
            if (!d.generic) {
                // Linear in the AC assembly; its swing still rectifies.
                const a = ports.length;
                ports.push(pair(d.nets[0], d.nets[1])); inj.push({ pos: undefined, neg: undefined });
                portOwner.push({ d, nVt: VT });
                junctions.push({ d, kind: 'linear', p: [a] });
                continue;
            }
            if (d.kind === 'diode') {
                const a = ports.length;
                ports.push(pair(d.nets[0], d.nets[1])); inj.push(pair(d.nets[0], d.nets[1]));
                portOwner.push({ d, nVt: junctionCard(d.of).nVt });
                junctions.push({ d, kind: 'diode', p: [a] });
            } else if (d.kind === 'npn' || d.kind === 'pnp') {
                const a = ports.length;
                // v_be, v_bc selectors; base and collector injections (return at the emitter).
                ports.push(pair(d.nets[0], d.nets[1])); inj.push(pair(d.nets[0], d.nets[1]));
                portOwner.push({ d, nVt: VT });
                const p = [a];
                if (d.nets2) {
                    ports.push(pair(d.nets2[0], d.nets2[1])); inj.push(pair(d.nets2[1], d.nets[1]));
                    portOwner.push({ d, nVt: VT });
                    p.push(a + 1);
                }
                junctions.push({ d, kind: 'bjt', p });
            } else {
                const a = ports.length;
                ports.push(pair(d.nets[0], d.nets[1])); inj.push(pair(d.nets[0], d.nets[1]));
                portOwner.push({ d, nVt: VT, mos: true });
                const p = [a];
                if (d.nets2) {
                    ports.push(pair(d.nets2[0], d.nets2[1])); inj.push(pair(d.nets2[0], d.nets2[1]));
                    portOwner.push({ d, nVt: VT, mos: true, out: true });
                    p.push(a + 1);
                }
                junctions.push({ d, kind: 'mos', p });
            }
        }
        // Linear (Ebers–Moll) junctions take no stamp: drop their port from the
        // Woodbury update by giving it a null injection.
        // Coil windings: resonance probes and noise sources.
        const windings = [];
        for (const c of this.coupled) {
            const L = c.part.params.L;
            const qs = c.part.params.qs;
            c.part.terminals.forEach((t, i) => {
                if (i % 2) return;
                const w = i / 2;
                const na = c.nets.find(([, tt]) => tt === `w${w}a`)?.[0];
                const nb = c.nets.find(([, tt]) => tt === `w${w}b`)?.[0];
                windings.push({ c, w, sel: pair(na, nb), henrys: L[w][w], q: qs?.[w] ?? c.part.params.q });
            });
        }
        // Antenna source rows.
        const srcRows = this.antennas.map(a => builder.nodeCount + builder.rowIndex.get(a.sourceId));
        this._sys = { builder, N, idxOf, ports, inj, junctions, K: ports.length, portOwner, windings, srcRows };
        this._mixerJ = new Map(junctions.filter(x => x.kind === 'mixer').map(x => [x.d.index, x]));
        this._fmJ = new Map(junctions.filter(x => x.kind === 'fmif').map(x => [x.d.index, x]));
    }

    /** The solver view the RF bands run on: the coils fully coupled, no transient-only parts. */
    rfView(parts, nets) {
        if (this._view && this._view.src === parts) return this._view;
        const drop = new Set(this.coupled.flatMap(c => c.remove));
        const outParts = parts.filter(p => p.kind !== RF_DETECT_KIND && !drop.has(p.id));
        const outNets = nets.map(n => ({ ...n, terminals: n.terminals.filter(t => !drop.has(t.part) && !t.part.endsWith(':det')) }));
        // Nets that exist only at RF (inside a ceramic filter).
        for (const id of this.rfNets ?? []) outNets.push({ id, terminals: [] });
        const byId = new Map(outNets.map(n => [n.id, n]));
        for (const c of [...this.coupled, ...(this.rfOnly ?? [])]) {
            outParts.push(c.part);
            for (const [netId, t] of c.nets) byId.get(netId)?.terminals.push({ part: c.part.id, terminal: t });
        }
        this._view = { src: parts, parts: outParts, nets: outNets };
        return this._view;
    }

    /** Linear RF matrix at ω (dense). */
    _Y(omega) {
        // Assembling the matrix stamps every registered device's small-signal
        // view, and an LM386's reads its input's RF drive (junctionDrive): it
        // gets the last drive, never a band advanced from inside a band's own
        // step (that recursed: advanceTo → _modes → _Y → junctionDrive → advanceTo).
        this._assembling = (this._assembling ?? 0) + 1;
        try { return this._sys.builder.matrix(omega); } finally { this._assembling--; }
    }

    /** Linear RF matrix plus the junction stamps at ω, factored. */
    _factorFull(omega, vp, other) {
        const { N } = this._sys;
        const Y = this._Y(omega);
        const S = this._stamps(omega, vp, other);
        this._addStamps(Y.re, Y.im, S.S0r, S.S0i);
        return cluFactor(Y.re, Y.im, N);
    }

    _addStamps(re, im, Sr, Si) {
        const { N, K, ports, inj } = this._sys;
        for (let a = 0; a < K; a++) {
            const pa = inj[a];
            for (let c = 0; c < K; c++) {
                const g = Sr[a * K + c], b = Si[a * K + c];
                if (g === 0 && b === 0) continue;
                const pc = ports[c];
                const addE = (r, col, s) => { if (r === undefined || col === undefined) return; re[r * N + col] += s * g; im[r * N + col] += s * b; };
                addE(pa.pos, pc.pos, 1); addE(pa.pos, pc.neg, -1);
                addE(pa.neg, pc.pos, -1); addE(pa.neg, pc.neg, 1);
            }
        }
    }

    /**
     * The unit source vector of station s in a band centred at ω: the antenna
     * EMFs in their source rows, each rod's EMF as the Norton current of its
     * windings (Y_w(ω)·E).
     */
    _unitSource(s, omega) {
        const { N, srcRows } = this._sys;
        const re = new Float64Array(N), im = new Float64Array(N);
        this.antennas.forEach((a, i) => { const e = this.emf(a, s); if (e && srcRows[i] !== undefined && !Number.isNaN(srcRows[i])) re[srcRows[i]] += e; });
        for (const c of this.coupled) {
            if (!c.rods.length) continue;
            const L = c.part.params.L;
            const K = L.length;
            const E = new Array(K).fill(0);
            let any = false;
            for (const r of c.rods) {
                const e = this.rodEmf(r, s);
                if (!e) continue;
                r.turns.forEach((tn, i) => { E[r.offset + i] += e * tn; any = true; });
            }
            if (!any) continue;
            // Y_w = Γ·(1/Q − j)/(ω(1 + 1/Q²)), Γ = L⁻¹ (as src/ac.js stamps it).
            const G = invertReal(L);
            const q = c.part.params.q > 0 ? c.part.params.q : Infinity;
            const den = omega * (1 + (Number.isFinite(q) ? 1 / (q * q) : 0));
            for (let i = 0; i < K; i++) {
                let ir = 0, ii = 0;
                for (let j = 0; j < K; j++) {
                    ir += (Number.isFinite(q) ? G[i][j] / (q * den) : 0) * E[j];
                    ii += (-G[i][j] / den) * E[j];
                }
                const w = this._sys.windings.find(x => x.c === c && x.w === i);
                if (!w) continue;
                if (w.sel.pos !== undefined) { re[w.sel.pos] += ir; im[w.sel.pos] += ii; }
                if (w.sel.neg !== undefined) { re[w.sel.neg] -= ir; im[w.sel.neg] -= ii; }
            }
        }
        return { re, im };
    }

    // ── Impulse radiation between linked coils ─────────────────────────

    /**
     * A coil's time-domain current radiates what it has at RF into the coil
     * it is linked to (the near field, M = k·√(L1·L2)): a button dumping a
     * capacitor through a rod, a transistor chopping its current. The EMF in
     * each winding of the OTHER coil is M·di/dt. The transient solve knows the
     * current as a piecewise-linear waveform; its Fourier content at a band's
     * ω is, summed by parts, Σ_k Δs_k·e^{−jωt_k}/(jω)² · jω over its CORNERS
     * (Δs_k the change of slope at t_k): a smooth audio current, whose slope
     * changes by s″·dt per step, radiates nothing worth counting, a step does
     * — and a step is broadband, so it rings every tuned band at once (the
     * spark transmitter heard at every setting of the dial). Each corner is an
     * impulse of envelope area 2·M·Δs·e^{−jωt_k}/(jω) on the receiving
     * windings, given to the band at its next substep (one accepted step
     * late at most, far inside a tank's envelope time 2Q/ω). A coil does not
     * radiate into itself here: its own tank sees its own current through the
     * network already.
     */
    _radiate(tSec, solution) {
        const links = this.coupled.filter(c => c.owner && new Set(c.owner).size > 1);
        if (!links.length) return;
        this._rad ??= new Map();
        for (const c of links) {
            const i = c.windingIds.map(id => solution?.branchCurrents?.get(id)?.get('a') ?? 0);
            const st = this._rad.get(c);
            if (!st) { this._rad.set(c, { t: tSec, i, s: null }); continue; }
            const dt = tSec - st.t;
            if (!(dt > 0)) continue;
            const sl = i.map((x, w) => (x - st.i[w]) / dt);
            if (st.s) {
                const ds = sl.map((x, w) => x - st.s[w]);
                if (ds.some(x => x !== 0)) {
                    // Kept on the front end, not on a band: a refresh may
                    // replace the bands between now and their next substep,
                    // and a corner lost from a pair that nearly cancels would
                    // leave the other one ringing alone.
                    (this._events ??= []).push({ c, ds, tc: st.t });
                    if (this._events.length > 64) this._events = this._events.filter(e => e.tc > tSec - 2e-3);
                }
            }
            st.t = tSec; st.i = i; st.s = sl;
        }
    }

    /** A radiated corner's impulse area as a Norton vector of `band` (A·s), or null. */
    _kickVector(band, e) {
        const { c, ds, tc } = e;
        if (!this._sys || !band.X) return null;
        const wins = this._sys.windings.filter(x => x.c === c);
        if (!wins.length) return null;
        const L = c.part.params.L;
        const K = L.length;
        const w = band.omega;
        // EMF area per winding: 2·Σ_m M·Δs_m/ω · (−j)·e^{−jωt_c}.
        const ph = -w * tc;
        const c0 = DMath.cos(ph), s0 = DMath.sin(ph);
        const Er = new Float64Array(K), Ei = new Float64Array(K);
        let any = false;
        for (let k = 0; k < K; k++) {
            let a = 0;
            for (let m = 0; m < K; m++) if (c.owner[k] !== c.owner[m] && ds[m]) a += L[k][m] * ds[m];
            if (!a) continue;
            a *= 2 / w;
            Er[k] = a * s0; Ei[k] = -a * c0;
            any = true;
        }
        if (!any) return null;
        const G = invertReal(L);
        const q = c.part.params.q > 0 ? c.part.params.q : Infinity;
        const den = w * (1 + (Number.isFinite(q) ? 1 / (q * q) : 0));
        const N = band.X.re.length;
        const out = { re: new Float64Array(N), im: new Float64Array(N) };
        for (const x of wins) {
            const r = x.w;
            // Norton: Y_w·E, Y_w = Γ·(1/Q − j)/den.
            let jr = 0, ji = 0;
            for (let m = 0; m < K; m++) {
                const yr = Number.isFinite(q) ? G[r][m] / (q * den) : 0, yi = -G[r][m] / den;
                jr += yr * Er[m] - yi * Ei[m];
                ji += yr * Ei[m] + yi * Er[m];
            }
            if (x.sel.pos !== undefined) { out.re[x.sel.pos] += jr; out.im[x.sel.pos] += ji; }
            if (x.sel.neg !== undefined) { out.re[x.sel.neg] -= jr; out.im[x.sel.neg] -= ji; }
        }
        return out;
    }

    // ── Resonances ───────────────────────────────────────────────────

    /** |Z| of every winding at ω (junctions at their present compression). */
    _windingZ(omega, vp, other) {
        return this._windingZc(omega, vp, other).map(([r, i]) => Math.hypot(r, i));
    }

    /**
     * The natural mode nearest the band centre seen from each winding,
     * λ = −Y_p/Y_p' (Y_p = 1/Z_p, Y_p' = dY_p/ds): its real part is the
     * envelope's growth rate (> 0: the circuit oscillates). |Z| alone cannot
     * tell a tank damped by G from one undamped by −G, and an implicit
     * integrator stepping far past 1/σ would damp a growing mode it never
     * resolved — so the band's substep is bounded by it.
     */
    _modes(omega, vp, other) {
        const d = omega * 1e-4;
        const z0 = this._windingZc(omega, vp, other), z1 = this._windingZc(omega + d, vp, other);
        return z0.map(([r0, i0], w) => {
            const [r1, i1] = z1[w];
            const m0 = r0 * r0 + i0 * i0, m1 = r1 * r1 + i1 * i1;
            if (!(m0 > 0) || !(m1 > 0)) return [0, 0];
            const y0 = [r0 / m0, -i0 / m0], y1 = [r1 / m1, -i1 / m1];
            // Y' = (y1 − y0)/(j·d)
            const dr = (y1[0] - y0[0]) / d, di = (y1[1] - y0[1]) / d;
            const ypr = di, ypi = -dr;
            const den = ypr * ypr + ypi * ypi;
            if (!(den > 0)) return [0, 0];
            // λ = −y0 / Y'
            return [-(y0[0] * ypr + y0[1] * ypi) / den, -(y0[1] * ypr - y0[0] * ypi) / den];
        });
    }

    _windingZc(omega, vp, other) {
        const lu = this._factorFull(omega, vp, other);
        const { N, windings } = this._sys;
        return windings.map(w => {
            const br = new Float64Array(N), bi = new Float64Array(N);
            if (w.sel.pos !== undefined) br[w.sel.pos] += 1;
            if (w.sel.neg !== undefined) br[w.sel.neg] -= 1;
            cluSolve(lu, br, bi);
            let r = 0, i = 0;
            if (w.sel.pos !== undefined) { r += br[w.sel.pos]; i += bi[w.sel.pos]; }
            if (w.sel.neg !== undefined) { r -= br[w.sel.neg]; i -= bi[w.sel.neg]; }
            return [r, i];
        });
    }

    _scan(vp, other) {
        const { windings } = this._sys;
        if (!windings.length) return [];
        // The tanks' own resonances: transistors without gain while looking
        // (their capacitances stay). With the gain of the moment a stage
        // that a quench has just driven hard, or cut off, shows its tank
        // pulled, damped or not at all, and a band could miss it.
        const bias = this._bias;
        const saved = bias?.map(b => b?.ic);
        bias?.forEach(b => { if (b && b.ic !== undefined) b.ic = 0; });
        try { return this._scanAt(vp, other); }
        finally { bias?.forEach((b, i) => { if (b && saved[i] !== undefined) b.ic = saved[i]; }); }
    }

    /** The peak of a winding's |Z| within ±8 % of hz (golden section), as _scanAt reports one; null if none. */
    _refine(hz, vp, other) {
        const bias = this._bias;
        const saved = bias?.map(b => b?.ic);
        bias?.forEach(b => { if (b && b.ic !== undefined) b.ic = 0; });
        try {
            let best = null;
            this._sys.windings.forEach((_, w) => {
                const zAt = (lf) => this._windingZ(2 * Math.PI * DMath.exp(lf), vp, other)[w];
                let a = DMath.log(hz * 0.92), b = DMath.log(hz * 1.08);
                const g = (Math.sqrt(5) - 1) / 2;
                let c = b - g * (b - a), d = a + g * (b - a);
                let zc = zAt(c), zd = zAt(d);
                for (let it = 0; it < 36 && b - a > 2e-6; it++) {
                    if (zc > zd) { b = d; d = c; zd = zc; c = b - g * (b - a); zc = zAt(c); }
                    else { a = c; c = d; zc = zd; d = a + g * (b - a); zd = zAt(d); }
                }
                const f = DMath.exp((a + b) / 2), z = Math.max(zc, zd);
                if (f < hz * 0.921 || f > hz * 1.079) return;
                const z2 = this._windingZ(2 * Math.PI * f * 1.02, vp, other)[w];
                const r2 = z / Math.max(z2, 1e-30);
                const q = r2 > 1 ? Math.sqrt(r2 * r2 - 1) / 0.04 : 0;
                if (q >= 5 && (!best || z > best.z)) best = { hz: f, z, q, halfWidth: Math.max(bandHalfWidthHz(f), 1.5 * f / (2 * q)) };
            });
            return best;
        } finally { bias?.forEach((b, i) => { if (b && saved[i] !== undefined) b.ic = saved[i]; }); }
    }

    _scanAt(vp, other) {
        const { windings } = this._sys;
        const n = Math.ceil(DMath.log10(SCAN_HI_HZ / SCAN_LO_HZ) * SCAN_PER_DECADE);
        const fs = Array.from({ length: n + 1 }, (_, i) => SCAN_LO_HZ * DMath.pow(10, i / SCAN_PER_DECADE));
        const Z = fs.map(f => this._windingZ(2 * Math.PI * f, vp, other));
        const found = [];
        const span = 4;
        for (let w = 0; w < windings.length; w++) {
            for (let i = 1; i < fs.length - 1; i++) {
                const z = Z[i][w];
                if (!(z > Z[i - 1][w] && z >= Z[i + 1][w])) continue;
                const lo = Z[Math.max(0, i - span)][w], hi = Z[Math.min(fs.length - 1, i + span)][w];
                if (!(z > 2 * Math.sqrt(lo * hi))) continue;
                // Golden-section refinement of the peak on [f_{i−1}, f_{i+1}].
                let a = DMath.log(fs[i - 1]), b = DMath.log(fs[i + 1]);
                const g = (Math.sqrt(5) - 1) / 2;
                const zAt = (lf) => this._windingZ(2 * Math.PI * DMath.exp(lf), vp, other)[w];
                let c = b - g * (b - a), d = a + g * (b - a);
                let zc = zAt(c), zd = zAt(d);
                for (let it = 0; it < 28 && b - a > 2e-6; it++) {
                    if (zc > zd) { b = d; d = c; zd = zc; c = b - g * (b - a); zc = zAt(c); }
                    else { a = c; c = d; zc = zd; d = a + g * (b - a); zd = zAt(d); }
                }
                const hz = DMath.exp((a + b) / 2), zPeak = Math.max(zc, zd);
                // Its loaded Q from the Lorentzian |Z| 2 % off the peak: a
                // band must hold every station on the tank's slopes (FM slope
                // detection), not just the ones near its top.
                const z2 = this._windingZ(2 * Math.PI * hz * 1.02, vp, other)[w];
                const r2 = zPeak / Math.max(z2, 1e-30);
                const q = r2 > 1 ? Math.sqrt(r2 * r2 - 1) / 0.04 : Infinity;
                found.push({ hz, z: zPeak, q, halfWidth: Math.max(bandHalfWidthHz(hz), Number.isFinite(q) ? 1.5 * hz / (2 * q) : 0) });
            }
        }
        // Merge resonances that would share a band (the windings of one coil, coupled tanks).
        // A peak broader than Q ≈ 5 is no tank a band could follow.
        for (let i = found.length - 1; i >= 0; i--) if (!(found[i].q >= 5)) found.splice(i, 1);
        found.sort((x, y) => y.z - x.z);
        const out = [];
        for (const r of found) if (!out.some(o => Math.abs(o.hz - r.hz) <= o.halfWidth)) out.push(r);
        this.scans++;
        return out.sort((x, y) => x.hz - y.hz);
    }

    // ── Refresh: linear systems, bands, quasi-static stations ─────────

    /** Called by the board after every accepted transient step. */
    onAccepted(board, tSec, solution) {
        this._radiate(tSec, solution);
        const L = this._sys ? this.detectors.map((d, i) => (d.kind === 'npn' || d.kind === 'pnp') ? (this.junctionDrive(i, tSec)?.[0]?.L ?? 0) : 0) : null;
        this._bias = this._snapshot(solution);
        // The calibrated emitter Is is the device's own law: take the
        // rectified part (e^L − 1 of it) back out of the measured current.

        // …smoothed over IS_TAU_SEC in the log domain: re-fitting it at every
        // step would hand the transient solve a slightly different law each
        // step, and its error control answers that with ever smaller steps.
        const dt = this._tAccept === undefined ? Infinity : Math.max(0, tSec - this._tAccept);
        this._tAccept = tSec;
        const w = Number.isFinite(dt) ? 1 - DMath.exp(-dt / IS_TAU_SEC) : 1;
        this._isLog ??= new Map();
        this._bias.forEach((b, i) => {
            if (b.isEff === undefined) return;
            const prev = this._isLog.get(i);
            // Not conducting and never calibrated: the generic law's knee,
            // 1 mA at 0.7 V.
            const lg = Number.isFinite(b.isEff) ? DMath.log(b.isEff) : (prev ?? DMath.log(1e-3) - 0.7 / VT);
            const next = prev === undefined ? lg : prev + (lg - prev) * w;
            this._isLog.set(i, next);
            b.isEff = DMath.exp(next);
            // The transistor's DC collector current is the device's own plus
            // what its rf_detect companion rectifies (they are separate parts
            // in the transient solve). The RF transconductance follows the
            // total: an oscillator biased into class C by its own swing keeps
            // its gain from the current it now draws at the peaks.
            const rect = solution?.branchCurrents?.get(this.detectors[i].id)?.get('collector');
            if (Number.isFinite(rect)) b.ic += Math.abs(rect);
        });
        // The DC currents the RF conductances are taken from, smoothed over
        // CURRENT_TAU_SEC: their rectified part answers the band's swing one
        // step late, and following it step by step makes the two solves chase
        // each other (a detector's own RC is slower than this anyway).
        const wc = Number.isFinite(dt) ? 1 - DMath.exp(-dt / CURRENT_TAU_SEC) : 1;
        const prevBias = this._biasPrev;
        if (prevBias && prevBias.length === this._bias.length) {
            this._bias.forEach((b, i) => {
                const p = prevBias[i];
                if (b.ic !== undefined && p.ic !== undefined) b.ic = p.ic + (b.ic - p.ic) * wc;
                if (Number.isFinite(b.i) && Number.isFinite(p.i)) b.i = p.i + (b.i - p.i) * wc;
            });
        }
        // A detector's DC load, R = −v/I, smoothed over LOAD_TAU_SEC.
        const wl = Number.isFinite(dt) ? 1 - DMath.exp(-dt / LOAD_TAU_SEC) : 1;
        this._bias.forEach((b, i) => {
            if (b.card === undefined || b.ic !== undefined || b.v === undefined) return;
            const r = (b.i > 1e-10 && b.v < -1e-5) ? Math.min(1e8, Math.max(10, -b.v / b.i)) : null;
            const p = prevBias?.[i]?.rLoad;
            b.rLoad = r === null ? (p ?? DEFAULT_LOAD_OHMS) : (p === undefined ? r : p + (r - p) * wl);
            const vs = prevBias?.[i]?.vSlow;
            b.vSlow = vs === undefined ? b.v : vs + (b.v - vs) * wl;
        });
        this._biasPrev = this._bias;
        this._lastSolution = solution;
        // Band history past this instant was integrated with the previous
        // operating point: discard it, so it is redone with this one.
        for (const b of this._bands) b.prune(tSec);
        // Products' homes follow where an oscillation really is
        // (_planProducts): re-plan when one has moved by a quarter of the
        // narrowest band's half-width since they were planned.
        if (!this._dirty && this._bands.length > 1) {
            const hw = Math.min(...this._bands.map(x => x.halfWidth ?? bandHalfWidthHz(x.hz)));
            for (const b of this._bands) {
                const rot = b.oscHz ? b.rotationHz() : 0;
                if (Math.abs(rot - (b._rotPlanned ?? 0)) > 0.25 * hw) { this._planProducts(); break; }
            }
        }
        this._portCache.t = NaN;
        const key = JSON.stringify([...(board.controls ?? new Map())]);
        if (key !== this._controlsKey) { this._controlsKey = key; this._dirty = true; this._tScan = -Infinity; this._controlsMoved = true; }
        // A varicap's bias moved (its tuning voltage settling after the pot
        // turned): the resonance moved with it; look again.
        if (!this._dirty && tSec - this._tScan >= RETUNE_SEC && this._varicapMoved()) {
            // As a turned control: a resonance the scan no longer finds has moved away with it.
            this._dirty = true; this._tScan = -Infinity; this._controlsMoved = true;
        }
        if (this._dirty || tSec - this._tRefresh >= REFRESH_SEC) this.refresh(board, tSec, solution);
        else if (this._biasMoved() && tSec - (this._tBound ?? -Infinity) >= REBOUND_SEC) {
            // The operating point moved (a bias network charging, a pot
            // turned): a band that was stable may not be any more. Re-check
            // its growth rate (cheap next to a refresh).
            this._tBound = tSec;
            this._biasAtBound = this._bias;
            for (const b of this._bands) b._bound();
        }
    }

    /** Has a varicap's reverse voltage moved by more than 50 mV since the last scan? */
    _varicapMoved() {
        const a = this._biasAtScan, b = this._bias;
        if (!a || !b || a.length !== b.length) { this._biasAtScan = b; return false; }
        for (let i = 0; i < b.length; i++) {
            if (!this.detectors[i].of.varicap) continue;
            // The varicap's bias over the last millisecond (vSlow): its
            // tuning voltage settling, not a quench or the programme riding
            // on the tank it tunes.
            if (Math.abs((b[i].vSlow ?? b[i].v ?? 0) - (a[i].vSlow ?? a[i].v ?? 0)) > 0.05) return true;
        }
        return false;
    }

    /** Has a junction's operating current moved by a fifth since the bands were last bounded? */
    _biasMoved() {
        const a = this._biasAtBound, b = this._bias;
        if (!a || !b || a.length !== b.length) { this._biasAtBound = b; return false; }
        for (let i = 0; i < b.length; i++) {
            const x = a[i].ic ?? a[i].i ?? a[i].id ?? 0, y = b[i].ic ?? b[i].i ?? b[i].id ?? 0;
            if (Math.abs(y - x) > 0.2 * Math.max(Math.abs(x), Math.abs(y)) && Math.max(Math.abs(x), Math.abs(y)) > 1e-7) return true;
        }
        return false;
    }

    refresh(board, tSec, solution) {
        this._dirty = false;
        const stations = this.allStations();
        this._stationList = stations;
        if (!solution?.nodeVoltages) { this._tRefresh = tSec; return; }
        if (!this._bias) this._bias = this._snapshot(solution);
        try {
            this._buildSystem(board, solution);
            const vpNow = this._portsAt(null);
            if (tSec - this._tScan >= RESCAN_SEC || !this._resonances) {
                const before = this._resonances ?? [];
                const controlsMoved = this._controlsMoved === true;
                this._controlsMoved = false;
                // At small signal: the swing of a band that oscillates (or
                // squegs) at the moment of the scan drives its stage's
                // junctions hard — a collector swinging volts forward-biases
                // its base–collector junction — and the network the scan saw
                // then had peaks where no tank is (a short-wave stage scanned
                // mid-burst showed one at 4.5 MHz for its 6.1 MHz tank).
                const small = { L: new Float64Array(this._sys.K), A2: new Float64Array(this._sys.K) };
                const fresh = this._scan(vpNow, small);
                // A coarse grid can step over a sharp VHF peak it found
                // before (12 % between points against a ~1 % wide tank):
                // look again closely around every resonance the bands are
                // following before letting it go.
                const near = (a, b) => Math.abs(a.hz - b.hz) <= Math.max(a.halfWidth ?? 0, b.halfWidth ?? 0);
                for (const old of before) {
                    if (fresh.some(r => near(r, old))) continue;
                    // Not found again, not even close by: a tank does not
                    // vanish while its controls stand still — keep following
                    // it (a quench can leave the stage cut off, or driven
                    // hard, at the instant of a scan).
                    const again = (!controlsMoved && this._refine(old.hz, vpNow, small)) || (controlsMoved ? null : old);
                    if (again && !fresh.some(r => near(r, again))) fresh.push(again);
                }
                this._resonances = fresh.sort((x, y) => x.hz - y.hz);
                this._tScan = tSec;
                this._biasAtScan = this._bias;
            }
            this._rebuildBands(stations, tSec);
            this._biasAtBound = this._bias;
            this._tBound = tSec;
            this._solveStations(stations, tSec);
            this._planProducts();
            this.error = this._bands.find(b => b.dead)?.dead ?? null;
        } catch (err) {
            this.error = String(err?.message ?? err);
        }
        this._tRefresh = tSec;
        this._portCache.t = NaN;
        this.refreshes++;
    }

    /** Present port voltages of band `b` (null: none) and the others' amplitudes. */
    _portsAt(band) {
        const K = this._sys.K;
        if (band) return band.portVoltages();
        return Array.from({ length: K }, () => [0, 0]);
    }

    /**
     * For each port, the swings of every band except `band`: Σ ln I0 and Σ A².
     * Dynamic bands from their present state, quasi-static stations at
     * their carrier level.
     */
    _otherAmplitudes(band) {
        const K = this._sys.K;
        const L = new Float64Array(K), A2 = new Float64Array(K);
        const addAmp = (a, A) => {
            const o = this._sys.portOwner[a];
            if (!(A > 0)) return;
            L[a] += lnI0(A / o.nVt);
            A2[a] += A * A;
        };
        for (const b of this._bands) {
            if (b === band) continue;
            const vp = b.portVoltages();
            for (let a = 0; a < K; a++) addAmp(a, Math.hypot(vp[a][0], vp[a][1]));
        }
        for (const s of this._static) for (let a = 0; a < K; a++) addAmp(a, Math.hypot(s.H[a][0], s.H[a][1]));
        return { L, A2 };
    }

    _rebuildBands(stations, tSec) {
        const old = this._bands;
        const res = this._resonances ?? [];
        const bands = [];
        const assigned = new Set();
        for (const r of res) {
            const members = [];
            stations.forEach((s, k) => {
                if (assigned.has(k)) return;
                if (Math.abs(s.hz - r.hz) <= (r.halfWidth ?? bandHalfWidthHz(r.hz))) { members.push(k); assigned.add(k); }
            });
            // Centred on its strongest station when it has one: a circuit that
            // only responds then has a still envelope (no rotation to resolve);
            // its own oscillation, if it has one, beats against it as it should.
            let hz = r.hz;
            if (members.length) hz = stations[members.reduce((a, k) => (stations[k].fieldVPerM > stations[a].fieldVPerM ? k : a), members[0])].hz;
            bands.push({ hz, members, q: r.q, halfWidth: r.halfWidth ?? bandHalfWidthHz(r.hz) });
        }
        // Keep each surviving band's envelope (re-centred onto the new
        // centre: the physical signal is unchanged).
        const next = [];
        for (const nb of bands) {
            let prev = null, best = Infinity;
            for (const ob of old) {
                const d = Math.abs(ob.hz - nb.hz);
                if (d <= bandHalfWidthHz(nb.hz) && d < best) { best = d; prev = ob; }
            }
            const band = prev && !next.includes(prev) ? prev : new RfBand(this, nb.hz, tSec);
            band.tankQ = nb.q;
            band.halfWidth = nb.halfWidth;
            band.configure(nb.hz, nb.members, stations, tSec);
            next.push(band);
        }
        this._bands = next;
        this._staticMembers = stations.map((_, k) => k).filter(k => !assigned.has(k));
    }

    /**
     * Each station solved at its own carrier with the junctions at their
     * present large-signal conductance: the per-station RF a probe reports,
     * and the whole RF response of a station that falls in no band.
     */
    _solveStations(stations, tSec) {
        const { N, K, ports } = this._sys;
        const nets = this._sys.builder.nodeIndex;
        this._stationNets = [];
        const statics = [];
        for (let k = 0; k < stations.length; k++) {
            const s = stations[k];
            const omega = 2 * Math.PI * s.hz;
            const inBand = this._bands.find(b => b.members.includes(k));
            let vp = inBand ? inBand.portVoltages() : null;
            let other = this._otherAmplitudes(inBand ?? null);
            let H = null, x = null;
            const passes = inBand ? 1 : 3;
            for (let pass = 0; pass < passes; pass++) {
                const lu = this._factorFull(omega, vp ?? this._portsAt(null), other);
                const u = this._unitSource(s, omega);
                x = { re: Float64Array.from(u.re), im: Float64Array.from(u.im) };
                cluSolve(lu, x.re, x.im);
                H = ports.map(p => {
                    let r = 0, i = 0;
                    if (p.pos !== undefined) { r += x.re[p.pos]; i += x.im[p.pos]; }
                    if (p.neg !== undefined) { r -= x.re[p.neg]; i -= x.im[p.neg]; }
                    return [r, i];
                });
                if (!inBand) {
                    // Its own swing compresses the junctions (fixed point on the carrier level).
                    vp = H;
                    other = this._otherAmplitudes(null);
                    for (const st of this._static) if (st.k === k) for (let a = 0; a < K; a++) {
                        const o = this._sys.portOwner[a];
                        const A = Math.hypot(st.H[a][0], st.H[a][1]);
                        if (A > 0) { other.L[a] -= lnI0(A / o.nVt); other.A2[a] -= A * A; }
                    }
                }
            }
            const m = new Map();
            for (const [netId, i] of nets) m.set(netId, [x.re[i], x.im[i]]);
            this._stationNets.push(m);
            if (!inBand) statics.push({ k, s, H });
        }
        this._static = statics;
    }

    // ── Products between bands ───────────────────────────────────────

    /**
     * Every product a junction makes of the swings it carries that lands in
     * another band: the difference and sum frequencies of two bands (a
     * superhet's station and local oscillator into its IF tank), a band and
     * a quasi-static station (an image), and the 2nd and 3rd harmonics of a
     * band (a transmitter heard at twice its frequency). The junction law
     * fixes each one's size and phase:
     *
     *   exponential (diode, B–E): i = Is·e^{v/nVt} = Is·e^{v0/nVt}·Π_b e^{x_b cos θ_b}
     *     and e^{x cos θ} = I0(x) + 2·Σ_k I_k(x)·cos kθ, so the current at
     *     θ_p ± θ_q is I·(x_p g_p/2)(x_q g_q/2)·2 (g = 2I1/(x I0), I the DC
     *     current), at kθ_p it is 2·I·I_k(x_p)/I0(x_p);
     *   square law (MOSFET): K·V_p·V̄_q, K·V_p²/2 (no third harmonic);
     *   mixer IC: (gm/2)·V_rf·T̄_lo with T the LO's fundamental through tanh.
     *
     * A product is a current source in the band it lands in, injected where
     * the device delivers it (a transistor's collector, a MOSFET's drain, the
     * mixer's outputs), rotating at its offset from that band's centre. It
     * does not act back on the bands that make it (their own compression
     * already holds the power they lose to it).
     */
    _planProducts() {
        const bands = this._bands;
        for (const b of bands) b.products = [];
        if (!this._sys || bands.length < 1) return;
        for (const b of bands) if (b.hRot0 !== undefined) b.hRot = b.hRot0;
        // A source's own rotation: its stations' offsets and modulation
        // (the band's substep before products bound it — a product's
        // rotation inherited through another product compounded, band to
        // band, into ~60 ns substeps); where it really is, `fe`, carries
        // an oscillation's offset.
        const rotOf = (b) => 1 / (ROTATION_STEPS * (b.hRot0 ?? b.hRot));
        // `fe`: where a source really is. An oscillating band's carrier sits
        // off its centre (the transistor's capacitances pull a running
        // oscillator off the tank the resonance scan sees) by the rotation
        // its envelope actually has: a VHF superhet's oscillator 290 kHz
        // below its band's centre put the difference into the wrong one of
        // the ceramic filter's two resonances. (Not oscHz, the mode
        // estimate's Im λ: for a hard-driven medium-wave oscillator it said
        // 253 kHz where the envelope turns at 4 kHz.) The product's
        // rotation in its band's frame still follows from the centres (the
        // band's own envelope carries the offset).
        const sources = [
            ...bands.map(b => { b._rotPlanned = b.oscHz ? b.rotationHz() : 0; return { band: b, hz: b.hz, fe: b.hz + b._rotPlanned, rot: rotOf(b) }; }),
            ...this._static.map(x => ({ s: x.s, H: x.H, hz: x.s.hz, fe: x.s.hz,
                rot: (x.s.mod === 'fm' ? x.s.deviationHz : 0) + audioMaxHz(x.s.audio) })),
        ];
        const juncs = this._sys.junctions.filter(j => ['bjt', 'diode', 'mos', 'mixer'].includes(j.kind));
        // Each product goes to ONE band: the nearest whose half-width holds
        // it (two close resonances of one network — a ceramic filter's two
        // poles — each took the same product and carried it twice).
        const hwOf = (c) => c.halfWidth ?? bandHalfWidthHz(c.hz);
        const home = (fe) => {
            let best = null;
            for (const c of bands) if (fe > 0 && Math.abs(fe - c.hz) <= hwOf(c) && (!best || Math.abs(fe - c.hz) < Math.abs(fe - best.hz))) best = c;
            return best;
        };
        for (const c of bands) {
            const near = (fe) => home(fe) === c;
            const terms = [];
            const srcs = sources.filter(x => x.band !== c);
            const add = (t, f, rot, fe) => { t.off = 2 * Math.PI * (f - c.hz); t.rot = Math.abs(fe - c.hz) + rot; terms.push(t); };
            for (const j of juncs) {
                if (j.kind === 'mixer') {
                    const port = j.p[2];
                    for (const p of srcs) for (const q of srcs) {
                        if (!p.band && !q.band) continue;
                        const rot = p.rot + q.rot;
                        if (near(p.fe - q.fe)) add({ type: 'mix', j, port, p, q, sign: -1 }, p.hz - q.hz, rot, p.fe - q.fe);
                        else if (near(q.fe - p.fe)) add({ type: 'mix', j, port, p, q, sign: -2 }, q.hz - p.hz, rot, q.fe - p.fe);
                        if (near(p.fe + q.fe)) add({ type: 'mix', j, port, p, q, sign: 1 }, p.hz + q.hz, rot, p.fe + q.fe);
                    }
                    continue;
                }
                const port = j.kind === 'diode' ? j.p[0] : j.p[1];
                if (port === undefined) continue;
                for (let i = 0; i < srcs.length; i++) {
                    const p = srcs[i];
                    if (p.band) for (const k of [2, 3]) {
                        if (j.kind === 'mos' && k === 3) continue;
                        if (near(k * p.fe)) add({ type: 'harm', j, port, p, k }, k * p.hz, k * p.rot, k * p.fe);
                    }
                    for (let m = i + 1; m < srcs.length; m++) {
                        const q = srcs[m];
                        if (!p.band && !q.band) continue;
                        const [hi, lo] = p.fe >= q.fe ? [p, q] : [q, p];
                        const rot = p.rot + q.rot;
                        if (near(hi.fe - lo.fe)) add({ type: 'mix', j, port, p: hi, q: lo, sign: -1 }, hi.hz - lo.hz, rot, hi.fe - lo.fe);
                        if (near(p.fe + q.fe)) add({ type: 'mix', j, port, p, q, sign: 1 }, p.hz + q.hz, rot, p.fe + q.fe);
                    }
                }
            }
            c.products = terms;
            if (terms.length) {
                // The substep resolves the rotations of products between
                // PRIMARY sources: stations, bands that carry stations and
                // oscillating bands. A product of a product (a VHF
                // superhet's IF mixed back up with a neighbouring station
                // into its aerial band) is carried, but its rotation does not
                // set the step (it bound the aerial band to 35 ns substeps).
                const primary = (x) => !x || !x.band || x.band.members.length > 0 || !!x.band.oscHz;
                const main = terms.filter(t => primary(t.p) && primary(t.q));
                const rot = Math.max(0, ...main.map(t => t.rot));
                const h = Math.min(H_TARGET_MAX, 1 / (ROTATION_STEPS * Math.max(200, rot)));
                if (h < c.hRot) { c.hRot = h; c._bound(); }
            }
        }
    }

    _sourcePhasor(src, a, t) {
        if (src.band) return src.band.phasorAt(a, t);
        const [mr, mi] = stationModulation(src.s, t);
        const h = src.H[a];
        return [h[0] * mr - h[1] * mi, h[0] * mi + h[1] * mr];
    }

    /** One product's current (complex; drawn from its port's injection pos, delivered at neg) at t, in its own frame. */
    _productCurrent(term, t) {
        const j = term.j;
        const b = this._bias?.[j.d.index];
        if (!b) return null;
        if (j.kind === 'mixer') {
            if (!(b.ic > 1e-9)) return null;
            const R = this._sourcePhasor(term.p, j.p[0], t), L = this._sourcePhasor(term.q, j.p[1], t);
            const tl = mixerLoGain(b.vlo, cabs(L));
            const T = [L[0] * tl, L[1] * tl];
            const prod = term.sign === -1 ? cmul(R, conj(T)) : term.sign === -2 ? cmul(conj(R), T) : cmul(R, T);
            // (i_a − i_b) carries gRf·prod/2; the output pair carries half of that.
            const g = mixerRfGain(b.card.gm, b.ic, cabs(R)) / 4;
            return [g * prod[0], g * prod[1]];
        }
        const a = j.p[0];
        const pnp = j.d.kind === 'pnp' || j.d.kind === 'pmos';
        const nVt = j.kind === 'diode' ? b.card.nVt : VT;
        if (term.type === 'harm') {
            const V = this._sourcePhasor(term.p, a, t);
            const A = cabs(V);
            if (!(A > 1e-9)) return null;
            const k = term.k;
            let amp;
            if (j.kind === 'bjt') amp = b.ic * 2 * besselRatio(k, A / VT) * (pnp && k % 2 === 0 ? -1 : 1);
            else if (j.kind === 'diode') { const x = A / nVt; amp = this._diodeIavg(b, x, 0) * 2 * besselRatio(k, x); }
            else amp = mosSecondOrder(b, A) * A * A / 2 * (pnp ? -1 : 1);
            let u = [V[0] / A, V[1] / A];
            const u1 = u;
            for (let i = 1; i < k; i++) u = cmul(u, u1);
            return [amp * u[0], amp * u[1]];
        }
        const Vp = this._sourcePhasor(term.p, a, t), Vq = this._sourcePhasor(term.q, a, t);
        const Ap = cabs(Vp), Aq = cabs(Vq);
        if (!(Ap > 1e-9) || !(Aq > 1e-9)) return null;
        let coef;
        if (j.kind === 'bjt') coef = (pnp ? -1 : 1) * b.ic * besselGain(Ap / VT) * besselGain(Aq / VT) / (2 * VT * VT);
        else if (j.kind === 'diode') {
            const xp = Ap / nVt, xq = Aq / nVt;
            coef = this._diodeIavg(b, Math.hypot(xp, xq), 0) * besselGain(xp) * besselGain(xq) / (2 * nVt * nVt);
        } else coef = mosSecondOrder(b, Ap + Aq) * (pnp ? -1 : 1);
        const prod = term.sign === 1 ? cmul(Vp, Vq) : cmul(Vp, conj(Vq));
        return [coef * prod[0], coef * prod[1]];
    }

    /** Add a band's products at time t to its source vector. */
    _addProducts(band, t, re, im) {
        const inj = this._sys.inj;
        for (const term of band.products) {
            const I = this._productCurrent(term, t);
            if (!I) continue;
            const c = DMath.cos(term.off * t), sn = DMath.sin(term.off * t);
            const ir = I[0] * c - I[1] * sn, ii = I[0] * sn + I[1] * c;
            const pat = inj[term.port];
            if (pat.pos !== undefined) { re[pat.pos] -= ir; im[pat.pos] -= ii; }
            if (pat.neg !== undefined) { re[pat.neg] += ir; im[pat.neg] += ii; }
        }
    }

    /**
     * The mixer IC's audio-rate output at t (half its difference current,
     * A): RF and LO swings that share a band beat, (gm/2)·Re(V_rf·T̄_lo) —
     * direct conversion, product detection, a synchronous detector.
     */
    mixerAudio(di, tSec) {
        const j = this._mixerJ?.get(di);
        const b = this._bias?.[di];
        if (!j || !b || !(b.iT > 1e-9) || !this._bands.length) return 0;
        this._advance(tSec);
        const [prf, plo] = j.p;
        let sum = 0;
        for (const band of this._bands) {
            const R = band.phasorAt(prf, tSec), L = band.phasorAt(plo, tSec);
            const Ar = cabs(R), Al = cabs(L);
            if (!(Ar > 1e-12) || !(Al > 1e-12)) continue;
            sum += mixerRfGain(b.card.gm, b.iT, Ar) * mixerLoGain(b.vlo, Al) * (R[0] * L[0] + R[1] * L[1]);
        }
        return sum / 4;
    }

    /**
     * The FM IF IC's detector output at t (V about mid-supply): the
     * instantaneous frequency of the band that carries most at its input,
     * from the envelope's phase over 1 µs, through the limiter and the
     * quadrature tank (src/fm-if-ic.js fmDetector).
     */
    fmDemod(di, tSec) {
        const j = this._fmJ?.get(di);
        if (!j || !this._bands.length) return 0;
        this._advance(tSec);
        const a = j.p[0];
        let best = null, A = 0;
        for (const band of this._bands) {
            const m = cabs(band.phasorAt(a, tSec));
            if (m > A) { A = m; best = band; }
        }
        if (!best) return 0;
        const fi = best.hz + best.phaseRateAt(a, tSec) / (2 * Math.PI);
        const card = fmIfCard(j.d.of);
        return fmDetector(card, fmQuadHz(card, this._controls?.()?.get(j.d.partId)), fi, A);
    }

    // ── Envelope at a time ───────────────────────────────────────────

    /** Bring every band to time t (lazily, on the integrator's own grid). */
    _advance(tSec) {
        // The bands products land in after the bands that make them.
        for (const b of this._bands) if (!b.products?.length) b.advanceTo(tSec);
        for (const b of this._bands) if (b.products?.length) b.advanceTo(tSec);
    }

    /** Per port at time t: Σ_b ln I0(A_b/nVt) and Σ_b A_b². */
    _ports(tSec) {
        const c = this._portCache;
        if (c.t === tSec) return c;
        if (this._assembling > 0) {
            if (c.L) return c;
            const K0 = this._sys?.K ?? 0;
            return { t: NaN, L: new Float64Array(K0), A2: new Float64Array(K0) };
        }
        const K = this._sys?.K ?? 0;
        const L = new Float64Array(K), A2 = new Float64Array(K);
        if (K) {
            this._advance(tSec);
            const add = (a, A) => {
                if (!(A > 0)) return;
                L[a] += lnI0(A / this._sys.portOwner[a].nVt);
                A2[a] += A * A;
            };
            for (const b of this._bands) {
                const vp = b.portsAt(tSec);
                for (let a = 0; a < K; a++) add(a, Math.hypot(vp[a][0], vp[a][1]));
            }
            for (const st of this._static) {
                const [mr, mi] = stationModulation(st.s, tSec);
                const m = Math.hypot(mr, mi);
                for (let a = 0; a < K; a++) add(a, m * Math.hypot(st.H[a][0], st.H[a][1]));
            }
        }
        c.t = tSec; c.L = L; c.A2 = A2;
        return c;
    }

    /**
     * The swing a junction carries at time t (for its rf_detect companion):
     * per port {L: Σ ln I0(A_b/nVt), A: √Σ A_b²}; port 0 B–E / A–K / G–S,
     * port 1 B–C / D–S.
     */
    junctionDrive(d, tSec) {
        if (!this._sys) return null;
        const c = this._ports(tSec);
        const out = [];
        this._sys.portOwner.forEach((o, a) => { if (o.d === this.detectors[d]) out.push({ L: c.L[a], A: Math.sqrt(c.A2[a]) }); });
        return out;
    }

    /** RF envelope (V peak, all bands combined) across detector `d`'s first junction at time t. */
    amplitude(d, tSec) {
        const j = this.junctionDrive(d, tSec);
        return j?.[0]?.A ?? 0;
    }

    /** Per-station RF phasor amplitudes at a net (V peak) from the last refresh. */
    netAmplitudes(netId) {
        const st = this._stationList;
        if (!st || !this._stationNets) return null;
        return st.map((s, k) => {
            const v = this._stationNets[k]?.get(netId) ?? [0, 0];
            return { id: s.id, hz: s.hz, volts: Math.hypot(v[0], v[1]) };
        });
    }

    /**
     * The actual RF envelope at a net per band now: the tuned stations, a
     * regenerative tank's gain and an oscillation all included. Each:
     * {hz (centre), volts (peak), stations (ids in the band)}.
     */
    bandAmplitudes(netId, tSec) {
        if (!this._sys) return [];
        const i = this._sys.builder.nodeIndex.get(netId);
        if (tSec !== undefined) this._advance(tSec);
        const st = this._stationList ?? [];
        return this._bands.map(b => ({
            hz: b.hz,
            volts: i === undefined ? 0 : Math.hypot(b.X.re[i], b.X.im[i]),
            stations: b.members.map(k => st[k]?.id),
        }));
    }

    report(tSec) {
        const st = this._stationList ?? this.allStations();
        return {
            stations: st.map(s => ({ ...s })),
            refreshes: this.refreshes,
            scans: this.scans,
            substeps: this.substeps,
            error: this.error,
            resonances: (this._resonances ?? []).map(r => ({ hz: r.hz })),
            bands: this._bands.map(b => ({ hz: b.hz, stations: b.members.map(k => st[k]?.id), substepSec: H_UNIT * DMath.pow(2, b.k),
                products: (b.products ?? []).map(t => (t.type === 'harm' ? `${t.k}×${(t.p.hz / 1e3).toFixed(1)} kHz`
                    : `${(t.p.hz / 1e3).toFixed(1)} ${t.sign === 1 ? '+' : '−'} ${(t.q.hz / 1e3).toFixed(1)} kHz`)) })),
            detectors: this.detectors.map((d, i) => {
                const drive = this._sys ? this.junctionDrive(i, tSec) : null;
                return {
                    id: d.partId, kind: d.kind,
                    carriers: st.map((s, k) => {
                        const m = this._stationNets?.[k];
                        const a = m?.get(d.nets[0]) ?? [0, 0], b = m?.get(d.nets[1]) ?? [0, 0];
                        return { id: s.id, hz: s.hz, volts: Math.hypot(a[0] - b[0], a[1] - b[1]) };
                    }),
                    envelope: drive?.[0]?.A ?? 0,
                };
            }),
        };
    }
}

/** Inverse of a small real matrix (Gauss–Jordan). */
function invertReal(M) {
    const n = M.length;
    const a = M.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
    for (let c = 0; c < n; c++) {
        let p = c;
        for (let r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
        [a[c], a[p]] = [a[p], a[c]];
        const d = a[c][c];
        for (let j = 0; j < 2 * n; j++) a[c][j] /= d;
        for (let r = 0; r < n; r++) {
            if (r === c) continue;
            const f = a[r][c];
            if (f !== 0) for (let j = 0; j < 2 * n; j++) a[r][j] -= f * a[c][j];
        }
    }
    return a.map(row => row.slice(n));
}

/**
 * One dynamic band: centre, member stations, the envelope state and its
 * integrator (src/rf-bands.js).
 */
class RfBand {
    constructor(radio, hz, tSec) {
        this.radio = radio;
        this.hz = hz;
        this.members = [];
        this.integ = null;
        this.X = null;
        this.t = tSec;
        this.k = 6;
        this.calm = 0;
        this.hist = [];
        this._tUnstable = -Infinity;
        this._born = tSec;
    }

    configure(hz, members, stations, tSec) {
        const r = this.radio;
        const sys = r._sys;
        const N = sys.N;
        // Re-centre: v = Re{X·e^{jωt}} must not change.
        if (this.X && hz !== this.hz) {
            this._recentred = true;
            const ph = 2 * Math.PI * (this.hz - hz) * this.t;
            const c = DMath.cos(ph), s = DMath.sin(ph);
            for (let i = 0; i < this.X.re.length; i++) {
                const a = this.X.re[i], b = this.X.im[i];
                this.X.re[i] = a * c - b * s; this.X.im[i] = a * s + b * c;
            }
        }
        if (!this.X || this.X.re.length !== N) {
            // A new band, or the circuit's RF system changed shape: start quiet.
            this.X = { re: new Float64Array(N), im: new Float64Array(N) };
            this.t = tSec;
            this._recentred = true;
        }
        this.hz = hz;
        this.members = members;
        this.stations = stations;
        this.omega = 2 * Math.PI * hz;
        const w = this.omega, dw = w * 1e-4;
        const Y0 = r._Y(w);
        const Yp = r._Y(w + dw), Ym = r._Y(w - dw);
        const Y1 = { re: new Float64Array(N * N), im: new Float64Array(N * N) };
        for (let i = 0; i < N * N; i++) {
            // dY/ds = −j·dY/dω
            Y1.re[i] = (Yp.im[i] - Ym.im[i]) / (2 * dw);
            Y1.im[i] = -(Yp.re[i] - Ym.re[i]) / (2 * dw);
        }
        this.integ = new BandIntegrator({ N, ports: sys.ports, inj: sys.inj, blocks: sys.junctions.map(j => j.p) });
        this.integ.setLinear(Y0, Y1);
        this.integ.X = this.X;
        this.integ.t = this.t;
        this.units = members.map(k => ({ s: stations[k], u: r._unitSource(stations[k], w), off: 2 * Math.PI * (stations[k].hz - hz) }));
        // Fastest rotation in the band sets the substep ceiling.
        let rot = 200;
        for (const k of members) {
            const s = stations[k];
            rot = Math.max(rot, Math.abs(s.hz - hz) + (s.mod === 'fm' ? s.deviationHz + audioMaxHz(s.audio) : audioMaxHz(s.audio)));
        }
        this.hRot = Math.min(H_TARGET_MAX, 1 / (ROTATION_STEPS * rot));
        this.hRot0 = this.hRot;
        // Thermal noise of each winding's loss conductance G = 1/(Q·ω·L).
        this.noise = sys.windings.filter(x => x.q > 0 && x.henrys > 0)
            .map(x => ({ sel: x.sel, psd: thermalCurrentPsd(1 / (x.q * w * x.henrys)) }));
        // Keep the history a surviving band already has: the transient solve
        // may still be querying times inside it. Re-starting it at the band's
        // own (run-ahead) time froze the swing the solve saw until the solve
        // caught up, then stepped it: a kink at every refresh.
        if (!this.hist.length || this._recentred) this.hist = [{ t: this.t, vp: this.integ.portVoltages(this.X), X: this.X }];
        else this.hist = this.hist.map(e => ({ ...e, vp: this.integ.portVoltages(e.X) }));
        this._recentred = false;
        this._bound();
    }

    /** Substep ceiling: the rotations in the band and its growth rate now. */
    _bound() {
        const r = this.radio;
        let hT = this.hRot;
        const modes = this._own(r._modes(this.omega, this.integ.portVoltages(this.X), r._otherAmplitudes(this)));
        this.growth = Math.max(0, ...modes.map(m => m[0]));
        // The estimate is first-order in a winding's admittance and can be
        // fooled by a peak that is not one simple mode: confirm it by
        // integrating a trial stretch at the step it asks for (state
        // restored afterwards). A mode that really grows at σ multiplies the
        // envelope by e^{4.5} over 30 steps of 0.15/σ; if it does not even
        // double, the band is not unstable and the estimate is dropped.
        if (this.growth > 0 && !this._trial) {
            const k = Math.max(0, Math.min(K_MAX, Math.floor(DMath.log2(0.15 / this.growth / H_UNIT))));
            const amp = () => Math.max(1e-12, ...this.integ.portVoltages(this.X).map(p => Math.hypot(p[0], p[1])),
                ...this.noise.map(n => Math.hypot(this.X.re[n.sel.pos ?? 0] ?? 0, this.X.im[n.sel.pos ?? 0] ?? 0)));
            const save = { X: this.X, t: this.t, hist: this.hist, k: this.k, kMax: this.kMax, calm: this.calm };
            const a0 = amp();
            this._trial = true;
            this.kMax = k; this.k = k;
            const other = r._otherAmplitudes(this);
            const stamps = (vp) => r._stamps(this.omega, vp, other);
            for (let i = 0; i < 30; i++) {
                this.integ.X = this.X; this.integ.t = this.t;
                const res = this.integ.step(k, stamps, (t) => this._source(t), (rr, ri, h) => this._noise(rr, ri, h), null);
                this.X = { re: res.re, im: res.im }; this.t = res.t;
            }
            const a1 = amp();
            Object.assign(this, save);
            this._trial = false;
            if (!(a1 > 2 * a0)) this.growth = 0;
        }
        if (this.growth > 0) hT = Math.min(hT, 0.15 / this.growth);
        // An oscillating band's own rotation in its frame (the dominant
        // mode's Im λ: its offset from the band's centre, which is the tank
        // or the station it is tuned to) is resolved like a station's offset:
        // a step that turned it by a large angle damped it and put it at the
        // wrong frequency.
        const dom = modes.reduce((a, m) => (m[0] > a[0] ? m : a), modes[0] ?? [0, 0]);
        if (this._unstable(modes)) this._tUnstable = this.t;
        let peak = 0;
        for (const p of this.integ.portVoltages(this.X)) peak = Math.max(peak, Math.hypot(p[0], p[1]));
        this.oscHz = this._tUnstable === this.t && peak > OSC_VOLTS ? dom[1] / (2 * Math.PI) : 0;
        if (Math.abs(this.oscHz) > 200) hT = Math.min(hT, 1 / (ROTATION_STEPS * Math.abs(this.oscHz)));
        this.kMax = Math.max(0, Math.min(K_MAX, Math.floor(DMath.log2(hT / H_UNIT))));
        // The loop's time scale: the envelope's, 2Q/ω, but no faster than the
        // bias currents the band's conductances follow (CURRENT_TAU_SEC).
        const tau = Math.max(this.tankQ > 0 ? 2 * this.tankQ / this.omega : 0, CURRENT_TAU_SEC);
        this._loopK = Math.max(0, Math.floor(DMath.log2(tau / LOOP_STEPS / H_UNIT)));
        this.k = Math.min(this.k, this.kMax);
        this._sinceBound = 0;
        this.hBound = hT;
        // How the growth rate moves with the transistors' current: one more
        // mode estimate with every bipolar current 30 % up. Between bounds the
        // substep then follows the bias the transient solve sets (a quench
        // swinging the stage across its threshold 25 000 times a second)
        // without a full re-estimate per substep.
        const bias = r._bias;
        const sumIc = (bs) => (bs ?? []).reduce((a, b) => a + (b?.ic ?? 0), 0);
        this._icRef = sumIc(bias);
        this._sigma0 = Math.max(...modes.map(m => m[0]));
        this._dSigma = 0;
        if (bias && this._icRef > 0) {
            const saved = bias.map(b => b?.ic);
            bias.forEach(b => { if (b && b.ic !== undefined) b.ic *= 1.3; });
            try {
                const m1 = this._own(r._modes(this.omega, this.integ.portVoltages(this.X), r._otherAmplitudes(this)));
                this._dSigma = (Math.max(...m1.map(m => m[0])) - this._sigma0) / 0.3;
            } finally { bias.forEach((b, i) => { if (b && saved[i] !== undefined) b.ic = saved[i]; }); }
        }
    }

    /**
     * The substep ceiling for the bias now (see _bound). The growth rate is
     * estimated afresh (_modes, two factorizations) whenever the stages'
     * current has moved by a sixth, or the band's swing by a factor of two,
     * since the last estimate. A linear extrapolation from the bound's
     * reference current was the first answer here; a quench drives the
     * current far past that reference, where the extrapolated rate ran away
     * (Cπ grows with the current too, and a swinging band compresses) and
     * held the band at 1 ns substeps: 160 000 per simulated millisecond.
     */
    _kForBias() {
        if (!(this._dSigma > 0) || !(this._icRef > 0)) return this.kMax;
        const r = this.radio;
        const ic = (r._bias ?? []).reduce((a, b) => a + (b?.ic ?? 0), 0);
        const amp = Math.max(1e-12, ...this.integ.portVoltages(this.X).map(p => Math.hypot(p[0], p[1])));
        const c = this._sigmaCache;
        let sigma;
        if (c && Math.abs(ic - c.ic) <= c.ic / 6 && amp <= 2 * c.amp && amp >= c.amp / 2) sigma = c.sigma;
        else {
            const modes = this._own(r._modes(this.omega, this.integ.portVoltages(this.X), r._otherAmplitudes(this)));
            sigma = Math.max(...modes.map(m => m[0]));
            this._sigmaCache = { ic, amp, sigma };
            if (sigma > 0) this._tUnstable = this.t;
        }
        // Only a clear growth (an e-fold in under 5 µs): an oscillation that
        // its own compression holds wobbles around σ = 0, and following those
        // wobbles cost a steady oscillator half its speed.
        if (!(sigma > SIGMA_FOLLOW)) return this.kMax;
        const k = Math.floor(DMath.log2(0.15 / sigma / H_UNIT));
        return Math.max(0, Math.min(this.kMax, K_MAX, k));
    }

    /**
     * The substep ceiling for the rotation the band's envelope actually has
     * (rotationHz): an oscillation whose mode estimate does not flag it
     * (a steady oscillator at σ ≈ 0, its tank another resonance's mode) still
     * turns in this band's frame, and a substep that turned it by a large
     * angle damped it (backward Euler: by 1/|1 − jωh|). A keyed medium-wave
     * transmitter 45 kHz off its band's centre lost a third of its swing at
     * every 4 µs trial step and grew back, ~25 000 times a second, and the
     * transient solve chased the sawtooth (2 500 solves per ms).
     */
    _kForRotation() {
        // A band's own oscillation only: in a band that carries stations or
        // products the envelope's phase also turns with their modulation
        // (an FM IF's deviation), which their own rotation bounds already
        // resolve.
        if (this.members?.length || this.products?.length) return K_MAX;
        let peak = 0;
        for (const p of this.integ.portVoltages(this.X)) peak = Math.max(peak, Math.hypot(p[0], p[1]));
        if (!(peak > OSC_VOLTS)) return K_MAX;
        const rot = Math.abs(this.rotationHz());
        if (!(rot > 200)) return K_MAX;
        return Math.max(0, Math.min(K_MAX, Math.floor(DMath.log2(1 / (ROTATION_STEPS * rot) / H_UNIT))));
    }

    portVoltages() { return this.integ ? this.integ.portVoltages(this.X) : []; }

    /**
     * Is this band's network unstable at small signal — would it start from
     * noise (an oscillator, a regenerative stage past its threshold, a
     * super-regenerator's burst)? `modes` are the large-signal ones at the
     * present swing: growing there settles it.
     */
    _unstable(modes) {
        if (modes.some(m => m[0] > 0)) return true;
        const r = this.radio;
        return this._own(r._modes(this.omega, this.integ.portVoltages(this.X).map(() => [0, 0]), r._otherAmplitudes(this))).some(m => m[0] > 0);
    }

    /**
     * The modes that are this band's own: nearer its centre than any other
     * resonance's (outside its half-width). Seen from a winding of ANOTHER tank, the nearest natural mode
     * is that tank's, offset by the distance between the two: a VHF
     * superhet's local oscillator 10 MHz above its aerial tank (10 % — close
     * enough for the first-order estimate to be accurate) made the aerial
     * band take the oscillator's growth and rotation for its own, bound its
     * substep to resolve a 10 MHz rotation, and run away. That oscillation
     * is the oscillator band's; this band's implicit steps damp it.
     */
    _own(modes) {
        const res = this.radio._resonances ?? [];
        const own = modes.filter(m => {
            // Half the centre frequency away is no mode of this band: the
            // first-order expansion around ω_b says nothing there (an IF
            // band at 10.96 MHz "saw" one at 21.7 MHz and stepped at 4 ns).
            if (Math.abs(m[1]) > Math.PI * this.hz) return false;
            const f = this.hz + m[1] / (2 * Math.PI);
            const d = Math.abs(f - this.hz);
            return !res.some(x => Math.abs(f - x.hz) < d && Math.abs(x.hz - this.hz) > (this.halfWidth ?? 0));
        });
        return own.length ? own : [[0, 0]];
    }


    _source(t) {
        const N = this.X.re.length;
        const re = new Float64Array(N), im = new Float64Array(N);
        if (this.products?.length) this.radio._addProducts(this, t, re, im);
        for (const { s, u, off } of this.units) {
            const [mr, mi] = stationModulation(s, t);
            if (mr === 0 && mi === 0) continue;
            const c = DMath.cos(off * t), sn = DMath.sin(off * t);
            const cr = mr * c - mi * sn, ci = mr * sn + mi * c;
            for (let i = 0; i < N; i++) {
                const ur = u.re[i], ui = u.im[i];
                if (ur === 0 && ui === 0) continue;
                re[i] += ur * cr - ui * ci;
                im[i] += ur * ci + ui * cr;
            }
        }
        return { re, im };
    }

    _noise(rr, ri, h) {
        const rand = this.radio._rand;
        for (const n of this.noise) {
            const sd = Math.sqrt(n.psd / h);
            const [a, b] = gaussPair(rand);
            const ir = a * sd, ii = b * sd;
            if (n.sel.pos !== undefined) { rr[n.sel.pos] += ir; ri[n.sel.pos] += ii; }
            if (n.sel.neg !== undefined) { rr[n.sel.neg] -= ir; ri[n.sel.neg] -= ii; }
        }
    }

    advanceTo(tSec) {
        const r = this.radio;
        if (this.dead) {
            if (tSec > this.t) {
                this.t = tSec;
                this.hist.push({ t: this.t, vp: this.hist[0].vp, X: this.X, k: this.k });
                if (this.hist.length > 4) this.hist = this.hist.slice(-4);
            }
            return;
        }
        let guard = 0;
        while (this.t < tSec && guard++ < 200000) {
            // While it grows, the growth rate changes with the swing (the
            // junctions compress): re-estimate it every few dozen substeps.
            if (this.growth > 0 && ++this._sinceBound >= 48) this._bound();
            const kBias = Math.min(this._kForBias(), this._kForRotation());
            if (this.k > kBias) this.k = kBias;
            const other = r._otherAmplitudes(this);
            const stamps = (vp) => r._stamps(this.omega, vp, other);
            const v0 = this.integ.portVoltages(this.X);
            // In a band that can oscillate, a swing that drives its junctions
            // past the square law (a few VT) moves their bias through the
            // rectified current, and the bias moves the gain that holds the
            // swing: a loop between this band and the transient solve,
            // closed once per substep (the band steps with the bias of the
            // last accepted step). It acts on the envelope's own time scale
            // 2Q/ω; at a substep that is not a small part of that, the
            // exchange itself oscillates — a steady oscillator's swing
            // jittered by tens of per cent step to step (and the audio it
            // rectified was that jitter), a super-regenerator's bursts
            // overshot their limit by up to 40 %.
            if (this.t - (this._tUnstable ?? -Infinity) < ACTIVE_HOLD_SEC && this.k > this._loopK) {
                let peak = 0;
                for (const p of v0) peak = Math.max(peak, Math.hypot(p[0], p[1]));
                if (peak > LOOP_VOLTS) this.k = this._loopK;
            }
            let res, k = this.k;
            for (;;) {
                this.integ.t = this.t;
                this.integ.X = this.X;
                const last = this.hist[this.hist.length - 1];
                const prev = this.hist[this.hist.length - 2];
                const Xprev = prev?.X && last?.k === k && prev && Math.abs((last.t - prev.t) - H_UNIT * DMath.pow(2, k)) < 1e-15 ? prev.X : null;
                // Radiated impulses (_kick) whose instant falls in this
                // substep: their area spread over it.
                const hNow = H_UNIT * DMath.pow(2, k);
                this._applied ??= new WeakSet();
                // (A band created after a corner takes it only if it was born
                // within 20 µs of it: the refresh that the switching itself
                // triggered.)
                const due = (r._events ?? []).filter(e => e.tc <= this.t + hNow && e.tc >= this._born - 20e-6 && !this._applied.has(e));
                const vecs = due.map(e => r._kickVector(this, e)).filter(Boolean);
                const src = vecs.length ? (t) => {
                    const J = this._source(t);
                    for (const q of vecs) for (let i = 0; i < J.re.length; i++) { J.re[i] += q.re[i] / hNow; J.im[i] += q.im[i] / hNow; }
                    return J;
                } : (t) => this._source(t);
                res = this.integ.step(k, stamps, src, (rr, ri, h) => this._noise(rr, ri, h), Xprev);
                r.substeps++;
                const v1 = this.integ.portVoltages({ re: res.re, im: res.im });
                let g = 0;
                for (let a = 0; a < v0.length; a++) {
                    const m0 = Math.hypot(v0[a][0], v0[a][1]), m1 = Math.hypot(v1[a][0], v1[a][1]);
                    if (Math.max(m0, m1) < 1e-4) continue;
                    g = Math.max(g, Math.abs(DMath.log(Math.max(m1, 1e-12) / Math.max(m0, 1e-12))));
                }
                if ((g > 0.7 || res.inconsistent) && k > 0) { k--; this.calm = 0; continue; }
                if (g > 0.35 && k > 0) { this.k = k - 1; this.calm = 0; }
                else if (g < 0.05) {
                    if (++this.calm >= 8 && k < this.kMax) {
                        // Held below its ceiling by a growth rate the swing
                        // does not show (estimated at a swing it has since
                        // compressed from, within the cache's factor of
                        // two): estimate it again.
                        if (k >= kBias) this._sigmaCache = null;
                        this.k = k + 1; this.calm = 0;
                    } else this.k = k;
                }
                else this.k = k;
                this.X = { re: res.re, im: res.im };
                this.t = res.t;
                for (const e of due) this._applied.add(e);
                let peak = 0;
                for (const p of v1) { const m = Math.hypot(p[0], p[1]); if (!(m <= peak)) peak = m; }
                if (!(peak < RF_RUNAWAY_VOLTS)) { this._refuse(`its swing ran away (${peak.toExponential(2)} V at ${(this.t * 1e3).toFixed(4)} ms)`); return; }
                this.hist.push({ t: this.t, vp: v1, X: this.X, k });
                if (this.hist.length > RF_HISTORY_LIMIT) { this._refuse(`it needed more than ${RF_HISTORY_LIMIT} substeps ahead of the circuit (${(this.t * 1e3).toFixed(4)} ms)`); return; }
                break;
            }
        }
    }

    /**
     * Port swing magnitudes at t: a C¹ (Catmull–Rom) interpolation of the
     * magnitudes on the integrator's grid, so the rectified current the
     * transient solve sees is smooth in time (a kink at every substep would
     * make its step controller crawl). One substep of look-ahead.
     */
    portsAt(tSec) {
        let h = this.hist;
        if (h.length && h[h.length - 1].t > tSec && h.length >= 2) {
            // ensure one point beyond the bracket
            let j = h.length - 1;
            while (j > 0 && h[j - 1].t >= tSec) j--;
            if (j === h.length - 1) this._stepOnce();
        } else this._stepOnce();
        h = this.hist;
        let i = h.length - 1;
        while (i > 0 && h[i - 1].t >= tSec) i--;
        if (i === 0) return h[0].vp.map(p => [Math.hypot(p[0], p[1]), 0]);
        const a = h[i - 1], b = h[i];
        const pa = h[i - 2] ?? a, pb = h[i + 1] ?? b;
        const dt = b.t - a.t;
        const w = Math.min(1, Math.max(0, (tSec - a.t) / dt));
        const w2 = w * w, w3 = w2 * w;
        const h00 = 2 * w3 - 3 * w2 + 1, h10 = w3 - 2 * w2 + w, h01 = -2 * w3 + 3 * w2, h11 = w3 - w2;
        const mag = (e, j) => Math.hypot(e.vp[j][0], e.vp[j][1]);
        return a.vp.map((_, j) => {
            const ma = mag(a, j), mb = mag(b, j);
            const da = pa === a ? (mb - ma) : (mb - mag(pa, j)) * dt / (b.t - pa.t);
            const db = pb === b ? (mb - ma) : (mag(pb, j) - ma) * dt / (pb.t - a.t);
            return [Math.max(0, h00 * ma + h10 * da + h01 * mb + h11 * db), 0];
        });
    }

    _stepOnce() { this.advanceTo(this.t + 1e-15); }

    /** Complex voltage of port a at t, linear between the integrator's points (no stepping). */
    phasorAt(a, t) {
        const h = this.hist;
        if (!h.length || this.dead) return [0, 0];
        let i = h.length - 1;
        if (t >= h[i].t) return h[i].vp[a];
        while (i > 0 && h[i - 1].t > t) i--;
        if (i === 0) return h[0].vp[a];
        const e0 = h[i - 1].vp[a], e1 = h[i].vp[a];
        const w = (t - h[i - 1].t) / (h[i].t - h[i - 1].t);
        return [e0[0] + (e1[0] - e0[0]) * w, e0[1] + (e1[1] - e0[1]) * w];
    }

    /**
     * The phase velocity (rad/s) of port a's envelope at t, from the
     * integrator's substeps around t. (Was the phase over the last 1 µs
     * read from the history — which the accepted transient steps prune: a
     * look-back before its first point read that point instead, and the
     * frequency an FM IF chip saw jumped wherever it did.)
     */
    phaseRateAt(a, t) {
        const h = this.hist;
        if (h.length < 2 || this.dead) return 0;
        // Each substep's rate belongs to its midpoint; between midpoints it
        // is interpolated, so the detector's output is continuous (a
        // staircase at every substep held the transient solve to steps of
        // a fifth of a microsecond).
        const rate = (i) => {
            const e0 = h[i - 1].vp[a], e1 = h[i].vp[a], dt = h[i].t - h[i - 1].t;
            if (!(dt > 0)) return [h[i].t, 0];
            return [(h[i].t + h[i - 1].t) / 2, DMath.atan2(e1[1] * e0[0] - e1[0] * e0[1], e1[0] * e0[0] + e1[1] * e0[1]) / dt];
        };
        let i = h.length - 1;
        while (i > 1 && (h[i - 1].t + h[i].t) / 2 > t) i--;
        const [ta, ra] = rate(i);
        if (t <= ta || i === h.length - 1) return ra;
        const [tb, rb] = rate(i + 1);
        return ra + (rb - ra) * Math.min(1, (t - ta) / (tb - ta));
    }

    /**
     * The rotation (Hz) of the band's strongest port in its frame: its phase
     * turned over the whole history the band holds (one substep's turn is
     * noisy, and a product placed by it could land in the wrong band).
     */
    rotationHz() {
        const h = this.hist;
        if (h.length < 2 || this.dead) return 0;
        const vp = h[h.length - 1].vp;
        let a = -1, m = 0;
        vp.forEach((p, i) => { const x = Math.hypot(p[0], p[1]); if (x > m) { m = x; a = i; } });
        if (a < 0) return 0;
        let phi = 0;
        for (let i = 1; i < h.length; i++) {
            const e0 = h[i - 1].vp[a], e1 = h[i].vp[a];
            phi += DMath.atan2(e1[1] * e0[0] - e1[0] * e0[1], e1[0] * e0[0] + e1[1] * e0[1]);
        }
        const dt = h[h.length - 1].t - h[0].t;
        return dt > 0 ? phi / dt / (2 * Math.PI) : 0;
    }

    /** Stop this band: silent from here, the reason on the front end (radio.error, a board warning). */
    _refuse(why) {
        const N = this.X.re.length;
        this.dead = `RF band at ${(this.hz / 1e6).toFixed(4)} MHz refused: ${why}`;
        this.radio.error = this.dead;
        this.X = { re: new Float64Array(N), im: new Float64Array(N) };
        const K = this.radio._sys?.K ?? 0;
        this.hist = [{ t: this.t, vp: Array.from({ length: K }, () => [0, 0]), X: this.X, k: this.k }];
    }

    /** Accepted transient step at t: history before it is no longer needed. */
    prune(tSec) {
        const h = this.hist;
        let i = 0;
        while (i < h.length - 1 && h[i + 1].t <= tSec) i++;
        if (i > 0) this.hist = h.slice(i);
    }

}

// ─── The round-3 phasor front end ───────────────────────────────────────
//
// For a circuit in which nothing can oscillate at RF — no RF coil winding
// shares a net with a transistor's output, no FM or Morse station, a long
// wire as the only antenna — the carrier is solved, as in round 3, as a
// linear phasor per station at the smoothed operating point, with
// detection by the cycle-averaged junction law at audio rate. The envelope
// bands above would give the same answers up to the tank's sideband
// attenuation, at several times the cost; keeping this path keeps every
// round-3 receiver's numbers exactly (chooseFrontEnd below decides).

const P_REFRESH_SEC = 2e-3;
const P_BLEND_SEC = 1e-3;
const P_IDC_TAU_SEC = 1e-3;
const P_DEFAULT_LOAD_OHMS = 47e3;
const P_OP_TAU_SEC = 5e-3;

const p_cadd = (a, b) => [a[0] + b[0], a[1] + b[1]];
const p_csub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const p_cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const p_cscale = (a, k) => [a[0] * k, a[1] * k];
const p_cdiv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
/** Phasor of v(n0) − v(n1) from an acSweep result map (n1 null: to ground). */
function p_phasorOf(results, n0, n1) {
    const at = (n) => {
        const r = n ? results.get(n) : null;
        if (!r) return [0, 0];
        const th = r.phaseDeg * Math.PI / 180;
        return [r.mag * DMath.cos(th), r.mag * DMath.sin(th)];
    };
    return p_csub(at(n0), n1 ? at(n1) : [0, 0]);
}
const P_SLOW_BEAT_HZ = 10e3;
const P_ENVELOPE_POINTS_PER_CYCLE = 10;
const P_THETA16 = Array.from({ length: 16 }, (_, i) => [DMath.cos((i + 0.5) * Math.PI / 8), DMath.sin((i + 0.5) * Math.PI / 8)]);

export class PhasorFrontEnd {
    constructor({ antennas, detectors, coupled }) {
        this.antennas = antennas;
        this.detectors = detectors;
        this.coupled = coupled;
        this.stations = normalizeStations(DEFAULT_STATIONS);
        this.reset();
    }

    reset() {
        this._H = null;        // per detector: per station [re, im] (target)
        this._Hprev = null;    // blended-from
        this._tRefresh = -Infinity;
        this._dirty = true;
        this._controlsKey = '';
        this._idc = new Map(); // detector id -> smoothed DC current
        this._lastAcceptSec = null;
        this._drive = new Map();     // junction / compression factors used by the RF solve
        this._netPhasors = null;
        this._groups = null;
        this._opEma = null;
        this.error = null;
        this.refreshes = 0;
    }

    /** Stations seen by the antennas (union; each antenna's override wins for it). */
    allStations() {
        const out = [...this.stations];
        for (const a of this.antennas) for (const s of a.stations ?? []) if (!out.some(o => o.id === s.id)) out.push(s);
        return out;
    }

    setStations(list) {
        this.stations = normalizeStations(list);
        this._dirty = true;
    }

    /** EMF (V peak) station `s` induces in antenna `a`. */
    emf(a, s) {
        const own = a.stations ? a.stations.find(x => x.id === s.id) : s;
        return own ? own.fieldVPerM * a.heightM : 0;
    }

    /**
     * Upper bound on the transient step that keeps the programme and the
     * audible beats resolved.
     */
    maxStepSec() {
        const st = this.allStations();
        let f = 0;
        for (const s of st) f = Math.max(f, audioMaxHz(s.audio));
        for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) {
            const d = Math.abs(st[i].hz - st[j].hz);
            if (d > 0 && d <= P_SLOW_BEAT_HZ) f = Math.max(f, d);
        }
        return f > 0 ? 1 / (P_ENVELOPE_POINTS_PER_CYCLE * f) : null;
    }

    _phasor(d, k, tSec) {
        const H = this._H[d][k];
        const P = this._Hprev?.[d]?.[k];
        if (!P) return H;
        const w = Math.min(1, Math.max(0, (tSec - this._tRefresh) / P_BLEND_SEC));
        if (w >= 1) return H;
        return [P[0] + (H[0] - P[0]) * w, P[1] + (H[1] - P[1]) * w];
    }

    /** RF envelope (V peak) across detector `d`'s junction at time t. */
    amplitude(d, tSec) {
        if (!this._H) return 0;
        const st = this._stationList;
        const g = this._groups[d];
        if (!g) return 0;
        let sr = 0, si = 0, b2 = 0;
        const fr = st[g.ref].hz;
        for (const k of g.slow) {
            const s = st[k];
            const env = Math.max(0, 1 + s.depth * programmeValue(s.audio, tSec));
            const [hr, hi] = this._phasor(d, k, tSec);
            const ph = 2 * Math.PI * (s.hz - fr) * tSec;
            const c = DMath.cos(ph), sn = DMath.sin(ph);
            sr += env * (hr * c - hi * sn);
            si += env * (hr * sn + hi * c);
        }
        for (const k of g.fast) {
            const s = st[k];
            const env = Math.max(0, 1 + s.depth * programmeValue(s.audio, tSec));
            const [hr, hi] = this._phasor(d, k, tSec);
            b2 += env * env * (hr * hr + hi * hi);
        }
        const a = Math.hypot(sr, si);
        if (!(b2 > 0)) return a;
        const b = Math.sqrt(b2);
        let m = 0;
        for (const [c, s] of P_THETA16) m += Math.hypot(a + b * c, b * s);
        return m / 16;
    }

    /** Called by the board after every accepted transient step. */
    onAccepted(board, tSec, solution) {
        // Smoothed junction voltage and DC current of each detector: their
        // ratio is the DC load the detector works into, which fixes its
        // carrier-level operating point (see refresh()). Smoothed over ~1 ms:
        // both follow the programme alike, so their ratio does not, and a
        // switch-on transient is forgotten quickly.
        const dt = this._lastAcceptSec === null ? 0 : Math.max(0, tSec - this._lastAcceptSec);
        this._lastAcceptSec = tSec;
        const alpha = dt > 0 ? 1 - DMath.exp(-dt / P_IDC_TAU_SEC) : 1;
        for (const d of this.detectors) {
            const env = this._H ? this.amplitude(d.index, tSec) : 0;
            const { v, i } = this._junctionDc(d, solution, env);
            const prev = this._idc.get(d.id);
            if (!prev) this._idc.set(d.id, { v, i });
            else { prev.v += (v - prev.v) * alpha; prev.i += (i - prev.i) * alpha; }
        }
        this._kindOf ??= new Map((board._solveParts ?? []).filter(p => p.kind === 'npn' || p.kind === 'pnp')
            .map(p => [p.id, p.kind]));
        this._smoothOperatingPoint(solution, dt);
        const key = JSON.stringify([...(board.controls ?? new Map())]);
        if (key !== this._controlsKey) { this._controlsKey = key; this._dirty = true; }
        if (this._dirty || tSec - this._tRefresh >= P_REFRESH_SEC) this.refresh(board, tSec, this._opView(solution));
    }

    /**
     * The operating point the carrier is linearised at, smoothed over ~5 ms.
     * A transistor's bias swings at audio rate (in a reflex receiver by
     * volts); sampling that swing every refresh would turn the RF gain into
     * a staircase at the refresh rate. The carrier-level gain follows the
     * mean bias; its modulation by the programme is not modelled.
     */
    _smoothOperatingPoint(solution, dt) {
        if (!solution?.nodeVoltages) return;
        const a = dt > 0 ? 1 - DMath.exp(-dt / P_OP_TAU_SEC) : 1;
        const ema = this._opEma ?? (this._opEma = { v: new Map(), bc: new Map() });
        for (const [id, v] of solution.nodeVoltages) {
            const p = ema.v.get(id);
            ema.v.set(id, p === undefined ? v : p + (v - p) * a);
        }
        for (const [id, m] of solution.branchCurrents ?? []) {
            const kind = this._kindOf?.get(id);
            if (kind !== 'npn' && kind !== 'pnp') continue;
            let e = ema.bc.get(id);
            if (!e) { e = new Map(m); ema.bc.set(id, e); continue; }
            for (const [t, i] of m) e.set(t, (e.get(t) ?? i) + (i - (e.get(t) ?? i)) * a);
        }
    }

    _opView(solution) {
        if (!this._opEma) return solution;
        const bc = new Map(solution.branchCurrents ?? []);
        for (const [id, m] of this._opEma.bc) bc.set(id, m);
        return { ...solution, nodeVoltages: this._opEma.v, branchCurrents: bc };
    }

    /** Junction voltage and DC current (forward sense) of detector d in a solution. */
    _junctionDc(d, solution, env) {
        const bc = solution?.branchCurrents?.get(d.partId);
        const nv = (id) => solution?.nodeVoltages?.get(id) ?? 0;
        const card = junctionCard(d.of);
        const sign = d.kind === 'pnp' ? -1 : 1;
        const v = sign * (nv(d.nets[0]) - nv(d.nets[1]));
        const [delta] = rectificationCurrent(v, env, card.is, card.nVt);
        let base = 0;
        if (bc) {
            // Raw branch currents are OUT of the part at each terminal.
            if (d.kind === 'diode') base = -(bc.get('anode') ?? 0);
            else base = sign * -(bc.get('base') ?? 0);
        }
        return { v, i: base + (d.kind === 'diode' ? delta : delta / (card.beta + 1)) };
    }

    /**
     * Carrier-level describing-function conductance of a diode detector with
     * an RF swing A, at the bias it settles to on its DC load: the averaged
     * current Is·e^{v/nVt}·I0(x) − Is flows into the load, so with the load
     * R (estimated from the smoothed junction voltage and current) v solves
     * Is·(e^{v/nVt}·I0(x) − 1) = −v/R, and G = (I + Is)·g(x)/nVt.
     * A detector held in forward conduction by its bias (v > 0) keeps its
     * measured current instead.
     */
    _diodeG(d, A) {
        const card = junctionCard(d.of);
        const x = A / card.nVt;
        const L = lnI0(x);
        const m = this._idc.get(d.id) ?? { v: 0, i: 0 };
        let iAvg;
        if (m.v > 0 && m.i > 0) {
            iAvg = m.i + card.is;
        } else {
            const rl = (m.i > 1e-10 && m.v < -1e-5) ? Math.min(1e8, Math.max(10, -m.v / m.i)) : P_DEFAULT_LOAD_OHMS;
            const h = (v) => card.is * (DMath.exp(Math.min(700, v / card.nVt + L)) - 1) + v / rl;
            let lo = -(A + 2), hi = 0.5;
            for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (h(mid) > 0) hi = mid; else lo = mid; }
            const v = (lo + hi) / 2;
            iAvg = card.is * DMath.exp(Math.min(700, v / card.nVt + L));
        }
        return iAvg * besselGain(x) / card.nVt;
    }

    /**
     * Solve the RF network at every carrier (see the module note) with the
     * board's small-signal AC solver. Diode detectors are closed in one step
     * from each detector's Thevenin equivalent: the carrier amplitude A
     * across the junction solves A² = Σ_k |Voc_k / (1 + Z_k·G(A))|², which
     * is monotone in A (bisection); transistors are compressed by g(x) by
     * fixed-point iteration.
     */
    refresh(board, tSec, solution) {
        this._dirty = false;
        const stations = this.allStations();
        this._stationList = stations;
        if (!this.antennas.length || !stations.length || !solution?.nodeVoltages) {
            this._tRefresh = tSec;
            return;
        }
        const prevBlend = this._H && this._groups ? this.detectors.map((_, d) => stations.map((__, k) => this._phasor(d, k, tSec))) : null;
        const freqs = stations.map(s => s.hz);
        const sq = ([re, im]) => re * re + im * im;
        let result = null;
        try {
            for (const d of this.detectors) {
                if (!this._drive.has(d.id)) this._drive.set(d.id, d.kind === 'diode' ? this._diodeG(d, 0) : 1);
            }
            for (let pass = 0; pass < 3; pass++) {
                result = this._solveCarriers(board, solution, freqs, stations, this._rfOptions());
                let change = 0;
                for (const d of this.detectors) {
                    const old = this._drive.get(d.id);
                    let next;
                    if (d.kind === 'diode') {
                        // Thevenin per carrier with this detector's G removed.
                        const zin = board._radioSweep(d.testId, freqs, solution, this._rfOptions(), this)
                            .map(pt => p_phasorOf(pt.results, d.nets[0], d.nets[1]));
                        const zth = zin.map(z => p_cdiv(z, p_csub([1, 0], p_cscale(z, old))));
                        const voc = result.det[d.index].map((vk, k) => p_cmul(vk, p_cadd([1, 0], p_cscale(zth[k], old))));
                        const aOf = (A, G) => Math.sqrt(voc.reduce((acc, v, k) => acc + sq(v) / sq(p_cadd([1, 0], p_cscale(zth[k], G))), 0));
                        let lo = 0, hi = Math.sqrt(voc.reduce((acc, v) => acc + sq(v), 0));
                        for (let k = 0; k < 50 && hi > 0; k++) {
                            const mid = (lo + hi) / 2;
                            if (aOf(mid, this._diodeG(d, mid)) > mid) lo = mid; else hi = mid;
                        }
                        next = this._diodeG(d, (lo + hi) / 2);
                    } else {
                        const A = Math.sqrt(result.det[d.index].reduce((acc, v) => acc + sq(v), 0));
                        next = besselGain(A / junctionCard(d.of).nVt);
                        if (old > 0) next = Math.sqrt(old * next);
                    }
                    if (Math.abs(next - old) > 0.01 * Math.max(Math.abs(old), 1e-30)) change++;
                    this._drive.set(d.id, next);
                }
                if (!change) break;
            }
            result = this._solveCarriers(board, solution, freqs, stations, this._rfOptions());
            this.error = null;
        } catch (err) {
            this.error = String(err?.message ?? err);
            this._tRefresh = tSec;
            return;
        }
        this._Hprev = prevBlend;
        this._H = result.det;
        this._netPhasors = result.nets;
        this._tRefresh = tSec;
        this.refreshes++;
        // Beat groups per detector.
        this._groups = this.detectors.map((d) => {
            let ref = 0, best = -1;
            stations.forEach((s, k) => {
                const m = sq(this._H[d.index][k]);
                if (m > best) { best = m; ref = k; }
            });
            const slow = [], fast = [];
            stations.forEach((s, k) => (Math.abs(s.hz - stations[ref].hz) <= P_SLOW_BEAT_HZ ? slow : fast).push(k));
            return { ref, slow, fast };
        });
    }

    _rfOptions() {
        const junctionG = new Map();
        const bjtCompression = new Map();
        for (const d of this.detectors) {
            const g = this._drive.get(d.id);
            if (g === undefined) continue;
            if (d.kind === 'diode') junctionG.set(d.partId, g);
            else bjtCompression.set(d.partId, g);
        }
        return { junctionG, bjtCompression };
    }

    _solveCarriers(board, solution, freqs, stations, rf) {
        const det = this.detectors.map(() => stations.map(() => [0, 0]));
        const nets = new Map();
        for (const a of this.antennas) {
            const sweep = board._radioSweep(a.sourceId, freqs, solution, rf, this);
            sweep.forEach((pt, k) => {
                const e = this.emf(a, stations[k]);
                if (!e) return;
                for (const d of this.detectors) {
                    const p = p_cscale(p_phasorOf(pt.results, d.nets[0], d.nets[1]), e);
                    det[d.index][k][0] += p[0];
                    det[d.index][k][1] += p[1];
                }
                for (const netId of pt.results.keys()) {
                    let m = nets.get(netId);
                    if (!m) { m = stations.map(() => [0, 0]); nets.set(netId, m); }
                    const p = p_cscale(p_phasorOf(pt.results, netId, null), e);
                    m[k][0] += p[0];
                    m[k][1] += p[1];
                }
            });
        }
        return { det, nets };
    }

    /** The solver view the RF solve runs on: the ferrite coils fully coupled, no detector companions. */
    rfView(parts, nets) {
        if (this._view && this._view.src === parts) return this._view;
        const drop = new Set(this.coupled.flatMap(c => c.remove));
        const outParts = parts.filter(p => p.kind !== RF_DETECT_KIND && !drop.has(p.id));
        const outNets = nets.map(n => ({ ...n, terminals: n.terminals.filter(t => !drop.has(t.part) && !t.part.endsWith(':det')) }));
        const byId = new Map(outNets.map(n => [n.id, n]));
        for (const c of this.coupled) {
            outParts.push(c.part);
            for (const [netId, t] of c.nets) byId.get(netId)?.terminals.push({ part: c.part.id, terminal: t });
        }
        // A 1 A test current across each diode detector (AC-open unless it is
        // the swept source): its response is the junction's driving-point
        // impedance, for the Thevenin equivalent in refresh().
        for (const d of this.detectors) {
            if (d.kind !== 'diode') continue;
            outParts.push({ id: d.testId, kind: 'isource', params: { amps: 0 }, terminals: ['pos', 'neg'] });
            byId.get(d.nets[0])?.terminals.push({ part: d.testId, terminal: 'pos' });
            byId.get(d.nets[1])?.terminals.push({ part: d.testId, terminal: 'neg' });
        }
        this._view = { src: parts, parts: outParts, nets: outNets };
        return this._view;
    }

    /** The swing at detector d's junction (rf_detect, src/devices/radio-parts.js). */
    junctionDrive(d, tSec) {
        const A = this.amplitude(d, tSec);
        const det = this.detectors[d];
        return [{ L: A > 0 ? lnI0(A / junctionCard(det.of).nVt) : 0, A }];
    }

    /** No envelope bands on this path. */
    bandAmplitudes() { return []; }

    /** Per-station RF phasor amplitudes at a net (V peak) from the last refresh. */
    netAmplitudes(netId) {
        const m = this._netPhasors?.get(netId);
        if (!m) return null;
        return this._stationList.map((s, k) => ({ id: s.id, hz: s.hz, volts: Math.hypot(m[k][0], m[k][1]) }));
    }

    report(tSec) {
        const st = this._stationList ?? this.allStations();
        return {
            stations: st.map(s => ({ ...s })),
            refreshes: this.refreshes,
            error: this.error,
            detectors: this.detectors.map(d => ({
                id: d.partId, kind: d.kind,
                carriers: st.map((s, k) => {
                    const h = this._H?.[d.index]?.[k] ?? [0, 0];
                    return { id: s.id, hz: s.hz, volts: Math.hypot(h[0], h[1]) };
                }),
                envelope: this.amplitude(d.index, tSec),
                junctionVolts: this._idc.get(d.id)?.v ?? 0,
                dcAmps: this._idc.get(d.id)?.i ?? 0,
            })),
        };
    }
}
