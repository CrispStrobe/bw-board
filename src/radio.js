// SPDX-License-Identifier: MIT
/**
 * Radio front end: long-wire antenna, earth, tuning capacitor, ferrite-rod
 * medium-wave coil, air-core VHF coil, varicap diode, a broadcast
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
 * NOT MODELLED: harmonics of the carrier (a band per harmonic is possible
 * but nothing here needs one), intermodulation products between DIFFERENT
 * bands (only their mutual compression), junction capacitance except a
 * diode's `cjo` (varicaps) and a transistor's cje/cjc/fT, detector series
 * resistance, the field's far-zone geometry (stations are plane waves).
 *
 * @module
 */

import { junctionVf } from './led-color.js';
import { resolveParams } from './parts-library.js';
import { chooseGroundReference, smoothVov, mosK } from './mna.js';
import {
    VT, lnI0, besselGain, expCapped, describeLaw, cluFactor, cluSolve, mulberry32, gaussPair,
    thermalCurrentPsd, BandIntegrator, H_UNIT, K_MAX,
} from './rf-bands.js';

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
 * (cw) | {type:'none'} carrier only).
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
            mod,
            depth: Math.min(1, Math.max(0, num(s.depth, 0.5))),
            deviationHz: Math.max(0, num(s.deviationHz, 75e3)),
            bearingDeg: num(s.bearingDeg, 0),
            audio,
        };
    });
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
        case 'tone': return Math.sin(2 * Math.PI * audio.hz * t);
        case 'chord': return 0.5 * (Math.sin(2 * Math.PI * audio.hz[0] * t) + Math.sin(2 * Math.PI * audio.hz[1] * t));
        case 'two-tone': {
            const half = audio.period / 2;
            const n = Math.floor(t / audio.period);
            const w = t - n * audio.period;
            const [f1, f2] = audio.hz;
            const cycles = (f1 + f2) * half * n + (w < half ? f1 * w : f1 * half + f2 * (w - half));
            return Math.sin(2 * Math.PI * cycles);
        }
        case 'melody': { const m = melodyAt(audio, t); return m.hz > 0 ? Math.sin(2 * Math.PI * m.cycles) : 0; }
        case 'morse': return morseKey(audio, t);
        default: return 0;
    }
}

/** ∫₀ᵗ s(τ) dτ, for frequency modulation. */
export function programmeIntegral(audio, t) {
    const sinInt = (f, c0, c1) => (Math.cos(2 * Math.PI * c0) - Math.cos(2 * Math.PI * c1)) / (2 * Math.PI * f);
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
        return [Math.cos(ph), Math.sin(ph)];
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
    return { is: 0.02 / Math.max(Math.exp(Math.min(vf / nVt, 80)) - 1, 1e-30), nVt };
}

/** A diode's junction capacitance at forward voltage v (SPICE law, linear above vj/2). */
export function junctionCapacitance(P, v) {
    const cjo = num(P?.cjo, 0);
    if (!(cjo > 0)) return 0;
    const vj = Math.max(0.05, num(P.vj, 0.7));
    const m = Math.min(0.99, Math.max(0.01, num(P.m, 0.5)));
    const fc = 0.5;
    if (v < fc * vj) return cjo / (1 - v / vj) ** m;
    const c0 = cjo / (1 - fc) ** m;
    return c0 * (1 + m * (v - fc * vj) / (vj * (1 - fc)));
}

/** Square law of a MOSFET in saturation (the engine's smoothed law). */
function mosLaw(P) {
    const vth = Math.abs(num(P.vth, 2.0));
    const k = mosK(P);
    return (vgs) => { const [vov] = smoothVov(vgs - vth); return k * vov * vov; };
}

/** Extra DC (drain→source) a gate swing of amplitude A adds, and d/dvgs. */
export function mosRectification(part, vgs, A) {
    if (!(A > 1e-9)) return [0, 0];
    const f = mosLaw(part.params ?? {});
    const [d0] = describeLaw(f, vgs, A);
    const e = 1e-4;
    const [dp] = describeLaw(f, vgs + e, A);
    const [dm] = describeLaw(f, vgs - e, A);
    return [d0, (dp - dm) / (2 * e)];
}

// ─── Solver-view expansion ──────────────────────────────────────────────

export const RF_DETECT_KIND = 'rf_detect';
export const COUPLED_INDUCTORS_KIND = 'coupled_inductors';
export const FERRITE_DEFAULTS = Object.freeze({ henrys: 250e-6, tap: 0.25, couplingRatio: 0.1, k: 0.98, couplingK: 0.9, q: 120,
    rodHeightM: 0.01, angleDeg: 0, distanceM: 1, linkRadiusM: 0.1 });
export const AIR_COIL_DEFAULTS = Object.freeze({ henrys: 0.15e-6, q: 80 });
export const ANTENNA_DEFAULTS = Object.freeze({ heightM: 5, ohms: 50, farads: 200e-12 });
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

/** A ferrite rod's angle (degrees) from its control (0..1 = 0..360°) or its param. */
export function rodAngleDeg(part, control) {
    if (Number.isFinite(control)) return 360 * control;
    return num(part.params?.angleDeg, FERRITE_DEFAULTS.angleDeg);
}

/** Inductance matrix of a ferrite coil's connected windings. */
function ferriteWindings(part, has) {
    const P = part.params ?? {};
    const L = num(P.henrys, FERRITE_DEFAULTS.henrys);
    const r = Math.min(0.95, Math.max(0.05, num(P.tap, FERRITE_DEFAULTS.tap)));
    const n = Math.max(1e-3, num(P.couplingRatio, FERRITE_DEFAULTS.couplingRatio));
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
    const Lm = w.map((wi, i) => w.map((wj, j) => {
        const li = L * wi.turns * wi.turns;
        const lj = L * wj.turns * wj.turns;
        if (i === j) return li;
        return (wi.main && wj.main ? k : kc) * Math.sqrt(li * lj);
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
    const kinds = new Set(['antenna', 'earth', 'tuning_cap', 'ferrite_coil', 'air_coil', 'varicap']);
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
    for (const p of parts.filter(q => q.kind === 'ferrite_coil' || q.kind === 'air_coil')) {
        const has = (t) => !!netOf(p.id, t);
        let fw;
        if (p.kind === 'air_coil') {
            if (!has('a') || !has('b')) continue;
            const P = p.params ?? {};
            fw = { windings: [{ a: 'a', b: 'b', turns: 1, main: true }], L: [[num(P.henrys, AIR_COIL_DEFAULTS.henrys)]],
                q: Math.max(0, num(P.q, AIR_COIL_DEFAULTS.q)) };
        } else fw = ferriteWindings(p, has);
        const wn = fw.windings.filter(w => netOf(p.id, w.a) !== netOf(p.id, w.b));
        if (wn.length !== fw.windings.length || !wn.length) continue;
        const hidden = [];
        const ends = (w) => [netOf(p.id, w.a), netOf(p.id, w.b)];
        // The TIME-domain view of a winding is its copper resistance only.
        // Everything a coil does at RF — resonance, coupling between windings,
        // feedback — lives in the RF bands; at audio, where the transient
        // solve works, a few hundred µH is a fraction of an ohm. Keeping the
        // inductances (and the windings' mutual coupling) in the transient
        // view as well would let the circuit's RF feedback loop exist twice:
        // a Meissner oscillator also became a broadband blocking oscillator
        // there, pinching its own bias off. (Round 3 kept them, damped by ωL
        // at 1 MHz; nothing it built needed more than their DC path.)
        const copper = p.kind === 'air_coil' ? 0.05 : 2;
        wn.forEach((w, i) => {
            const id = `${p.id}_w${i}`;
            const [na, nb] = ends(w);
            add({ id, kind: 'resistor', params: { ohms: Math.max(0.01, copper * w.turns) }, terminals: ['a', 'b'] },
                [[na, 'a'], [nb, 'b']]);
            hidden.push(id);
        });
        coils.push({ part: p, kind: p.kind, windings: wn, L: fw.L, q: fw.q, hidden,
            nets: wn.map(w => [netOf(p.id, w.a).id, netOf(p.id, w.b).id]) });
    }

    // Couple linked ferrite rods (near field) into one coupled set; every
    // other coil is a set of its own.
    const coupled = [];
    const used = new Set();
    for (const c of coils) {
        if (used.has(c)) continue;
        const group = [c];
        used.add(c);
        const linkTo = c.part.params?.linkTo;
        // Either rod may name the other.
        const partner = c.kind !== 'ferrite_coil' ? null
            : coils.find(o => !used.has(o) && o.kind === 'ferrite_coil' && (o.part.id === linkTo || o.part.params?.linkTo === c.part.id)) ?? null;
        // The link's distance is the naming rod's.
        const namer = partner && partner.part.params?.linkTo === c.part.id ? partner : c;
        if (partner && c.kind === 'ferrite_coil') { group.push(partner); used.add(partner); }
        const offsets = [];
        let K = 0;
        for (const g of group) { offsets.push(K); K += g.windings.length; }
        const linkK = () => {
            if (group.length < 2) return 0;
            const P = namer.part.params ?? {};
            const d = Math.max(1e-3, num(P.distanceM, FERRITE_DEFAULTS.distanceM));
            const r0 = Math.max(1e-4, num(P.linkRadiusM, FERRITE_DEFAULTS.linkRadiusM));
            const da = (rodAngleDeg(c.part, control(c.part.id)) - rodAngleDeg(partner.part, control(partner.part.id))) * Math.PI / 180;
            return Math.min(0.5, (r0 / d) ** 3) * Math.cos(da);
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
        });
    }

    // Antennas and earth.
    const antennas = parts.filter(p => p.kind === 'antenna' && netOf(p.id, 'a'));
    const earths = parts.filter(p => p.kind === 'earth' && netOf(p.id, 'earth'));
    // Without an antenna or an RF coil nothing carries RF: the parts are plain passives.
    if (!antennas.length && !coupled.length) return { parts: outParts, nets: outNets, radio: null };
    const antennaSpecs = [];
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
                stations: Array.isArray(P.stations) ? normalizeStations(P.stations) : null });
        }
    }

    // Junctions: every diode, transistor and MOSFET can rectify and is
    // stamped into the RF bands by its describing function.
    const radio = new RadioFrontEnd({ antennas: antennaSpecs, detectors: [], coupled, controls: opts.controls });
    for (const p of outParts) {
        let terms, j, k2 = null;
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
    }
    return { parts: outParts, nets: outNets, radio };
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
    const coilT = (p, t) => (p.kind === 'ferrite_coil' && ['a', 'tap', 'b', 'c1', 'c2'].includes(t)) || (p.kind === 'air_coil');
    const outT = (p, t) => ((p.kind === 'npn' || p.kind === 'pnp') && (t === 'collector' || t === 'emitter'))
        || ((p.kind === 'nmos' || p.kind === 'pmos') && (t === 'drain' || t === 'source'));
    if (parts.some(p => ['air_coil', 'varicap', 'nmos', 'pmos'].includes(p.kind))) return 'envelope';
    if (parts.some(p => p.kind === 'ferrite_coil' && (p.params?.linkTo || Array.isArray(p.params?.stations)))) return 'envelope';
    const antennas = parts.filter(p => p.kind === 'antenna');
    if (!antennas.length) return 'envelope';
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
        } else {
            const [p1, p2] = ends(wn[0]);
            const [s1, s2] = ends(wn[1]);
            const id = `${p.id}_T01`;
            add({ id, kind: 'transformer', terminals: ['p1', 'p2', 's1', 's2'],
                params: { l1: fw.L[0][0], l2: fw.L[1][1], k: fw.L[0][1] / Math.sqrt(fw.L[0][0] * fw.L[1][1]) } },
            [[p1, 'p1'], [p2, 'p2'], [s1, 's1'], [s2, 's2']]);
            hidden.push(id);
            if (wn.length === 3) {
                const [na, nb] = ends(wn[2]);
                const lid = `${p.id}_L2`;
                add({ id: lid, kind: 'inductor', params: { henrys: fw.L[2][2] }, terminals: ['a', 'b'] }, [[na, 'a'], [nb, 'b']]);
                hidden.push(lid);
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
    if (!antennas.length) return { parts: outParts, nets: outNets, radio: null };
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
    }
    return { parts: outParts, nets: outNets, radio };
}

// ─── The RF bands ───────────────────────────────────────────────────────

const REFRESH_SEC = 5e-3;
const RESCAN_SEC = 200e-3;
const SCAN_LO_HZ = 100e3;
const SCAN_HI_HZ = 300e6;
const SCAN_PER_DECADE = 20;
const SLOW_BEAT_HZ = 10e3;
const ENVELOPE_POINTS_PER_CYCLE = 10;
const ROTATION_STEPS = 16;
const H_TARGET_MAX = 20e-6;
const NOISE_SEED = 0x5eed1234;
const IS_TAU_SEC = 2e-3;
const REBOUND_SEC = 0.1e-3;
const CURRENT_TAU_SEC = 20e-6;
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
        return own ? own.fieldVPerM * a.heightM : 0;
    }

    /** EMF (V peak, signed) station `s` induces in the whole main winding of rod `r`. */
    rodEmf(r, s) {
        const own = r.stations ? r.stations.find(x => x.id === s.id) : s;
        if (!own || !(r.heightM > 0)) return 0;
        const angle = rodAngleDeg(r.part, this._controls?.()?.get(r.part.id));
        return own.fieldVPerM * r.heightM * (own.hz / 1e6) * Math.cos((angle - own.bearingDeg) * Math.PI / 180);
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
        return f > 0 ? 1 / (ENVELOPE_POINTS_PER_CYCLE * f) : null;
    }

    // ── Operating point ──────────────────────────────────────────────

    _snapshot(solution) {
        const nv = (id) => solution?.nodeVoltages?.get(id) ?? 0;
        return this.detectors.map(d => {
            const P = d.of.params ?? {};
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
                    : conducting ? ic * (beta + 1) / beta * Math.exp(-Math.min(vbe, 1.5) / VT) : NaN;
                return { vbe, vbc, ic, saturated, card, isEff, beta,
                    ft: Math.max(1e6, num(P.ft, 300e6)), cjc: num(P.cfb, num(P.cjc, 4e-12)), cje: num(P.cje, 0) };
            }
            const s = d.kind === 'pmos' ? -1 : 1;
            const vgs = s * (nv(d.nets[0]) - nv(d.nets[1]));
            const vds = d.nets2 ? s * (nv(d.nets2[0]) - nv(d.nets2[1])) : 0;
            const id = Math.abs(solution?.branchCurrents?.get(d.partId)?.get('drain') ?? 0);
            return { vgs, vds, id, law: mosLaw(P), lambda: num(P.lambda, 0), cgs: num(P.cgs, 0), cgd: num(P.cgd, 0) };
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
        const h = (v) => is * (Math.exp(Math.min(700, v / nVt + L)) - 1) + v / R;
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
                const gm = b.saturated ? 0 : b.ic * besselGain(xbe) / VT;
                const cpi = b.ic / (VT * 2 * Math.PI * b.ft) + b.cje;
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
            } else if (j.kind === 'mos') {
                const [pgs, pds] = j.p;
                const A = Math.sqrt(sq(vp[pgs][0], vp[pgs][1]) + other.A2[pgs]);
                const [, gmEff] = b.vds > 0.05 ? describeLaw(b.law, b.vgs, A) : [0, 0];
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
    }

    /** The solver view the RF bands run on: the coils fully coupled, no transient-only parts. */
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
        this._view = { src: parts, parts: outParts, nets: outNets };
        return this._view;
    }

    /** Linear RF matrix at ω (dense). */
    _Y(omega) { return this._sys.builder.matrix(omega); }

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
        const n = Math.ceil(Math.log10(SCAN_HI_HZ / SCAN_LO_HZ) * SCAN_PER_DECADE);
        const fs = Array.from({ length: n + 1 }, (_, i) => SCAN_LO_HZ * 10 ** (i / SCAN_PER_DECADE));
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
                let a = Math.log(fs[i - 1]), b = Math.log(fs[i + 1]);
                const g = (Math.sqrt(5) - 1) / 2;
                const zAt = (lf) => this._windingZ(2 * Math.PI * Math.exp(lf), vp, other)[w];
                let c = b - g * (b - a), d = a + g * (b - a);
                let zc = zAt(c), zd = zAt(d);
                for (let it = 0; it < 28 && b - a > 2e-6; it++) {
                    if (zc > zd) { b = d; d = c; zd = zc; c = b - g * (b - a); zc = zAt(c); }
                    else { a = c; c = d; zc = zd; d = a + g * (b - a); zd = zAt(d); }
                }
                const hz = Math.exp((a + b) / 2), zPeak = Math.max(zc, zd);
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
        found.sort((x, y) => y.z - x.z);
        const out = [];
        for (const r of found) if (!out.some(o => Math.abs(o.hz - r.hz) <= o.halfWidth)) out.push(r);
        this.scans++;
        return out.sort((x, y) => x.hz - y.hz);
    }

    // ── Refresh: linear systems, bands, quasi-static stations ─────────

    /** Called by the board after every accepted transient step. */
    onAccepted(board, tSec, solution) {
        const L = this._sys ? this.detectors.map((d, i) => (d.kind === 'npn' || d.kind === 'pnp') ? (this.junctionDrive(i, tSec)?.[0]?.L ?? 0) : 0) : null;
        this._bias = this._snapshot(solution);
        // The calibrated emitter Is is the device's own law: take the
        // rectified part (e^L − 1 of it) back out of the measured current.

        // …smoothed over IS_TAU_SEC in the log domain: re-fitting it at every
        // step would hand the transient solve a slightly different law each
        // step, and its error control answers that with ever smaller steps.
        const dt = this._tAccept === undefined ? Infinity : Math.max(0, tSec - this._tAccept);
        this._tAccept = tSec;
        const w = Number.isFinite(dt) ? 1 - Math.exp(-dt / IS_TAU_SEC) : 1;
        this._isLog ??= new Map();
        this._bias.forEach((b, i) => {
            if (b.isEff === undefined) return;
            const prev = this._isLog.get(i);
            // Not conducting and never calibrated: the generic law's knee,
            // 1 mA at 0.7 V.
            const lg = Number.isFinite(b.isEff) ? Math.log(b.isEff) : (prev ?? Math.log(1e-3) - 0.7 / VT);
            const next = prev === undefined ? lg : prev + (lg - prev) * w;
            this._isLog.set(i, next);
            b.isEff = Math.exp(next);
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
        const wc = Number.isFinite(dt) ? 1 - Math.exp(-dt / CURRENT_TAU_SEC) : 1;
        const prevBias = this._biasPrev;
        if (prevBias && prevBias.length === this._bias.length) {
            this._bias.forEach((b, i) => {
                const p = prevBias[i];
                if (b.ic !== undefined && p.ic !== undefined) b.ic = p.ic + (b.ic - p.ic) * wc;
                if (Number.isFinite(b.i) && Number.isFinite(p.i)) b.i = p.i + (b.i - p.i) * wc;
            });
        }
        // A detector's DC load, R = −v/I, smoothed over LOAD_TAU_SEC.
        const wl = Number.isFinite(dt) ? 1 - Math.exp(-dt / LOAD_TAU_SEC) : 1;
        this._bias.forEach((b, i) => {
            if (b.card === undefined || b.ic !== undefined || b.v === undefined) return;
            const r = (b.i > 1e-10 && b.v < -1e-5) ? Math.min(1e8, Math.max(10, -b.v / b.i)) : null;
            const p = prevBias?.[i]?.rLoad;
            b.rLoad = r === null ? (p ?? DEFAULT_LOAD_OHMS) : (p === undefined ? r : p + (r - p) * wl);
        });
        this._biasPrev = this._bias;
        this._lastSolution = solution;
        // Band history past this instant was integrated with the previous
        // operating point: discard it, so it is redone with this one.
        for (const b of this._bands) b.prune(tSec);
        this._portCache.t = NaN;
        const key = JSON.stringify([...(board.controls ?? new Map())]);
        if (key !== this._controlsKey) { this._controlsKey = key; this._dirty = true; this._tScan = -Infinity; }
        // A varicap's bias moved (its tuning voltage settling after the pot
        // turned): the resonance moved with it; look again.
        if (!this._dirty && tSec - this._tScan >= RETUNE_SEC && this._varicapMoved()) { this._dirty = true; this._tScan = -Infinity; }
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
            if (Math.abs((b[i].v ?? 0) - (a[i].v ?? 0)) > 0.05) return true;
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
            const other = this._otherAmplitudes(null);
            const vpNow = this._portsAt(null);
            if (tSec - this._tScan >= RESCAN_SEC || !this._resonances) {
                this._resonances = this._scan(vpNow, other);
                this._tScan = tSec;
                this._biasAtScan = this._bias;
            }
            this._rebuildBands(stations, tSec);
            this._biasAtBound = this._bias;
            this._tBound = tSec;
            this._solveStations(stations, tSec);
            this.error = null;
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
            bands.push({ hz, members });
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

    // ── Envelope at a time ───────────────────────────────────────────

    /** Bring every band to time t (lazily, on the integrator's own grid). */
    _advance(tSec) {
        for (const b of this._bands) b.advanceTo(tSec);
    }

    /** Per port at time t: Σ_b ln I0(A_b/nVt) and Σ_b A_b². */
    _ports(tSec) {
        const c = this._portCache;
        if (c.t === tSec) return c;
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
            bands: this._bands.map(b => ({ hz: b.hz, stations: b.members.map(k => st[k]?.id), substepSec: H_UNIT * 2 ** b.k })),
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
    }

    configure(hz, members, stations, tSec) {
        const r = this.radio;
        const sys = r._sys;
        const N = sys.N;
        // Re-centre: v = Re{X·e^{jωt}} must not change.
        if (this.X && hz !== this.hz) {
            const ph = 2 * Math.PI * (this.hz - hz) * this.t;
            const c = Math.cos(ph), s = Math.sin(ph);
            for (let i = 0; i < this.X.re.length; i++) {
                const a = this.X.re[i], b = this.X.im[i];
                this.X.re[i] = a * c - b * s; this.X.im[i] = a * s + b * c;
            }
        }
        if (!this.X || this.X.re.length !== N) {
            // A new band, or the circuit's RF system changed shape: start quiet.
            this.X = { re: new Float64Array(N), im: new Float64Array(N) };
            this.t = tSec;
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
        this.integ = new BandIntegrator({ N, ports: sys.ports, inj: sys.inj });
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
        // Thermal noise of each winding's loss conductance G = 1/(Q·ω·L).
        this.noise = sys.windings.filter(x => x.q > 0 && x.henrys > 0)
            .map(x => ({ sel: x.sel, psd: thermalCurrentPsd(1 / (x.q * w * x.henrys)) }));
        this.hist = [{ t: this.t, vp: this.integ.portVoltages(this.X), X: this.X }];
        this._bound();
    }

    /** Substep ceiling: the rotations in the band and its growth rate now. */
    _bound() {
        const r = this.radio;
        let hT = this.hRot;
        const modes = r._modes(this.omega, this.integ.portVoltages(this.X), r._otherAmplitudes(this));
        this.growth = Math.max(0, ...modes.map(m => m[0]));
        // The estimate is first-order in a winding's admittance and can be
        // fooled by a peak that is not one simple mode: confirm it by
        // integrating a trial stretch at the step it asks for (state
        // restored afterwards). A mode that really grows at σ multiplies the
        // envelope by e^{4.5} over 30 steps of 0.15/σ; if it does not even
        // double, the band is not unstable and the estimate is dropped.
        if (this.growth > 0 && !this._trial) {
            const k = Math.max(0, Math.min(K_MAX, Math.floor(Math.log2(0.15 / this.growth / H_UNIT))));
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
        this.kMax = Math.max(0, Math.min(K_MAX, Math.floor(Math.log2(hT / H_UNIT))));
        this.k = Math.min(this.k, this.kMax);
        this._sinceBound = 0;
    }

    portVoltages() { return this.integ ? this.integ.portVoltages(this.X) : []; }

    _source(t) {
        const N = this.X.re.length;
        const re = new Float64Array(N), im = new Float64Array(N);
        for (const { s, u, off } of this.units) {
            const [mr, mi] = stationModulation(s, t);
            if (mr === 0 && mi === 0) continue;
            const c = Math.cos(off * t), sn = Math.sin(off * t);
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
        let guard = 0;
        while (this.t < tSec && guard++ < 200000) {
            // While it grows, the growth rate changes with the swing (the
            // junctions compress): re-estimate it every few dozen substeps.
            if (this.growth > 0 && ++this._sinceBound >= 48) this._bound();
            const other = r._otherAmplitudes(this);
            const stamps = (vp) => r._stamps(this.omega, vp, other);
            const v0 = this.integ.portVoltages(this.X);
            let res, k = this.k;
            for (;;) {
                this.integ.t = this.t;
                this.integ.X = this.X;
                const last = this.hist[this.hist.length - 1];
                const prev = this.hist[this.hist.length - 2];
                const Xprev = prev?.X && last?.k === k && prev && Math.abs((last.t - prev.t) - H_UNIT * 2 ** k) < 1e-15 ? prev.X : null;
                res = this.integ.step(k, stamps, (t) => this._source(t), (rr, ri, h) => this._noise(rr, ri, h), Xprev);
                r.substeps++;
                const v1 = this.integ.portVoltages({ re: res.re, im: res.im });
                let g = 0;
                for (let a = 0; a < v0.length; a++) {
                    const m0 = Math.hypot(v0[a][0], v0[a][1]), m1 = Math.hypot(v1[a][0], v1[a][1]);
                    if (Math.max(m0, m1) < 1e-4) continue;
                    g = Math.max(g, Math.abs(Math.log(Math.max(m1, 1e-12) / Math.max(m0, 1e-12))));
                }
                if (g > 0.7 && k > 0) { k--; this.calm = 0; continue; }
                if (g > 0.35 && k > 0) { this.k = k - 1; this.calm = 0; }
                else if (g < 0.05) { if (++this.calm >= 8 && k < this.kMax) { this.k = k + 1; this.calm = 0; } else this.k = k; }
                else this.k = k;
                this.X = { re: res.re, im: res.im };
                this.t = res.t;
                this.hist.push({ t: this.t, vp: v1, X: this.X, k });
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
        return [r.mag * Math.cos(th), r.mag * Math.sin(th)];
    };
    return p_csub(at(n0), n1 ? at(n1) : [0, 0]);
}
const P_SLOW_BEAT_HZ = 10e3;
const P_ENVELOPE_POINTS_PER_CYCLE = 10;
const P_THETA16 = Array.from({ length: 16 }, (_, i) => [Math.cos((i + 0.5) * Math.PI / 8), Math.sin((i + 0.5) * Math.PI / 8)]);

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
            const c = Math.cos(ph), sn = Math.sin(ph);
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
        const alpha = dt > 0 ? 1 - Math.exp(-dt / P_IDC_TAU_SEC) : 1;
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
        const a = dt > 0 ? 1 - Math.exp(-dt / P_OP_TAU_SEC) : 1;
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
            const h = (v) => card.is * (Math.exp(Math.min(700, v / card.nVt + L)) - 1) + v / rl;
            let lo = -(A + 2), hi = 0.5;
            for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (h(mid) > 0) hi = mid; else lo = mid; }
            const v = (lo + hi) / 2;
            iAvg = card.is * Math.exp(Math.min(700, v / card.nVt + L));
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
