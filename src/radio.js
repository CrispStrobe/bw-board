// SPDX-License-Identifier: MIT
/**
 * Radio front end: long-wire antenna, earth, tuning capacitor, ferrite-rod
 * medium-wave coil, a broadcast environment of AM stations, and envelope
 * detection in diode and transistor junctions.
 *
 * WHY NOT SIMULATE THE CARRIER. A medium-wave carrier is ~1 MHz; resolving it
 * in the transient integrator needs ~20 steps per cycle, i.e. 20 million
 * steps per simulated second, for a circuit whose interesting behaviour (the
 * programme) is audio. So the carrier is never put into the time domain.
 *
 * THE SPLIT (an envelope / quasi-static treatment, as in harmonic-balance
 * envelope simulators):
 *
 *   1. RF is LINEAR and solved as PHASORS. Every station's carrier is a phasor
 *      at its own frequency. The antenna is a voltage source (EMF = field
 *      strength × effective height) behind its radiation/loss resistance and
 *      its capacitance to earth. The whole circuit — tank, tap, coupling
 *      winding, transistors as small-signal gain stages at their present
 *      audio-rate operating point — is solved by the engine's small-signal
 *      AC solver (src/ac.js) at each carrier frequency. That gives, per
 *      station k and per detecting junction d, the complex RF voltage V_dk
 *      across the junction. Tuning, selectivity (tank Q, the tap's loading),
 *      RF gain and loading by the detector all come out of that solve.
 *
 *   2. Detection is a TIME-AVERAGED junction law at audio rate. A junction
 *      i = Is·e^{v/nVt} with an RF swing A·cos(ωt) on top of its slow voltage
 *      v carries, averaged over one carrier cycle,
 *
 *          <i> = Is·e^{v/nVt}·I0(A/nVt)            (I0: modified Bessel),
 *
 *      which is square-law for A ≪ nVt and a linear envelope (peak)
 *      detector for A ≫ nVt — both regimes from one formula. Each junction
 *      that can detect gets a solver-only companion (`rf_detect`) in
 *      parallel that adds  <i> − i(v) = Is·e^{v/nVt}·(I0(x) − 1)  to its
 *      own model, so a junction with no RF is exactly what it was. The
 *      envelope A(t) is evaluated at the solve instant from the stations'
 *      modulation (1 + m·s(t)) and the phasors from step 1, so the detected
 *      audio, its loading by the following stage and the speaker are all
 *      ordinary transient circuit behaviour.
 *
 *   3. Detector loading of the tank closes the loop: a conducting detector
 *      draws RF current. Its describing-function conductance (fundamental
 *      current / A) is, at the detector's DC current I,
 *
 *          G = (I + Is)·g(x)/nVt,   g(x) = 2·I1(x) / (x·I0(x)),
 *
 *      → I/nVt (small signal) for small x and → 2I/A (the classic "a peak
 *      detector loads its source with R_L/2") for large x. Transistors are
 *      linearised at their present collector current (gm = Ic/Vt, Cπ from
 *      fT) and compressed by the same g(x) under a large base swing. The
 *      phasor solve is refreshed every few ms of simulated time (and at once
 *      when a control moves), with the detector's DC current smoothed over
 *      ~10 ms so the programme does not modulate the loading; the phasors
 *      are blended over 1 ms after each refresh so the envelope never steps.
 *
 *   4. Two stations INTERFERE through the composite envelope at a junction,
 *      |Σ V_dk·(1 + m_k·s_k(t))·e^{j(ω_k−ω_r)t}|. Stations within 10 kHz of
 *      the strongest are kept with their exact beat (adjacent-channel
 *      whistle, 9/10 kHz); ones further away cannot be resolved at audio
 *      rate and enter as a random-phase component averaged over the beat,
 *      which gives the detector's real weak-signal suppression and
 *      crosstalk without aliasing.
 *
 * NOT MODELLED: oscillation (a regenerative receiver past its threshold, an
 * RF oscillator — the phasor solve is linear and cannot sustain one), RF
 * harmonics and intermodulation, junction capacitance of diodes, the
 * coupling winding's coupling in the TIME domain when all three windings of
 * the ferrite coil are in use (it is exact in the RF solve), detector series
 * resistance. A circuit without an antenna builds none of this.
 *
 * @module
 */

import { junctionVf } from './led-color.js';
import { chooseGroundReference } from './mna.js';

// ─── Broadcast environment ──────────────────────────────────────────────

/** The default bench broadcast: three medium-wave stations. */
export const DEFAULT_STATIONS = Object.freeze([
    Object.freeze({ id: 'rf612', name: 'Ortssender 612 kHz', hz: 612e3, fieldVPerM: 0.02, depth: 0.5,
        audio: Object.freeze({ type: 'tone', hz: 400 }) }),
    Object.freeze({ id: 'rf810', name: 'Sender 810 kHz', hz: 810e3, fieldVPerM: 0.008, depth: 0.6,
        audio: Object.freeze({ type: 'two-tone', hz: Object.freeze([600, 900]), period: 0.4 }) }),
    Object.freeze({ id: 'rf1215', name: 'Fernsender 1215 kHz', hz: 1215e3, fieldVPerM: 0.003, depth: 0.5,
        audio: Object.freeze({ type: 'tone', hz: 1000 }) }),
]);

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

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
    throw new Error(`broadcast: unknown programme type "${type}" (tone, two-tone, chord, none)`);
}

/**
 * Validate and fill a station list. Each station: `hz` carrier (Hz),
 * `fieldVPerM` field strength (V/m, peak), `depth` modulation depth 0..1,
 * `audio` programme ({type:'tone', hz} | {type:'two-tone', hz:[f1,f2],
 * period} alternating | {type:'chord', hz:[f1,f2]} both at once |
 * {type:'none'} carrier only).
 */
export function normalizeStations(list) {
    if (!Array.isArray(list)) throw new Error('broadcast: expected an array of stations');
    return list.map((s, i) => {
        const hz = num(s?.hz, NaN);
        if (!(hz >= 10e3 && hz <= 100e6)) throw new Error(`broadcast: station ${i} needs a carrier hz between 10 kHz and 100 MHz`);
        return {
            id: String(s.id ?? `station${i}`),
            name: String(s.name ?? s.id ?? `${Math.round(hz / 1e3)} kHz`),
            hz,
            fieldVPerM: Math.max(0, num(s.fieldVPerM, 0.01)),
            depth: Math.min(1, Math.max(0, num(s.depth, 0.5))),
            audio: normalizeAudio(s.audio),
        };
    });
}

/** The programme signal s(t) in [−1, 1] (phase-continuous). */
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
    return 0;
}

function audioMaxHz(audio) {
    if (audio.type === 'tone') return audio.hz;
    if (audio.type === 'two-tone' || audio.type === 'chord') return Math.max(...audio.hz);
    return 0;
}

// ─── Bessel functions (Abramowitz & Stegun 9.8.1–9.8.4, |ε| < 2e-7) ──────

/** e^{−x}·I0(x), x ≥ 0. */
function i0e(x) {
    if (x < 3.75) {
        const t = (x / 3.75) ** 2;
        return Math.exp(-x) * (1 + t * (3.5156229 + t * (3.0899424 + t * (1.2067492
            + t * (0.2659732 + t * (0.0360768 + t * 0.0045813))))));
    }
    const t = 3.75 / x;
    return (0.39894228 + t * (0.01328592 + t * (0.00225319 + t * (-0.00157565 + t * (0.00916281
        + t * (-0.02057706 + t * (0.02635537 + t * (-0.01647633 + t * 0.00392377)))))))) / Math.sqrt(x);
}

/** e^{−x}·I1(x), x ≥ 0. */
function i1e(x) {
    if (x < 3.75) {
        const t = (x / 3.75) ** 2;
        return Math.exp(-x) * x * (0.5 + t * (0.87890594 + t * (0.51498869 + t * (0.15084934
            + t * (0.02658733 + t * (0.00301532 + t * 0.00032411))))));
    }
    const t = 3.75 / x;
    return (0.39894228 + t * (-0.03988024 + t * (-0.00362018 + t * (0.00163801 + t * (-0.01031555
        + t * (0.02282967 + t * (-0.02895312 + t * (0.01787654 - t * 0.00420059)))))))) / Math.sqrt(x);
}

/** ln I0(x). */
export function lnI0(x) { return x + Math.log(i0e(x)); }

/** g(x) = 2·I1(x) / (x·I0(x)): 1 at x = 0, → 2/x for large x. */
export function besselGain(x) {
    if (x < 1e-6) return 1 - x * x / 8;
    return 2 * i1e(x) / (x * i0e(x));
}

// ─── Averaged junction law ──────────────────────────────────────────────

const I_LIMIT = 0.5;  // A — exponential continued linearly above this (no rs modelled)

function expCapped(u, is) {
    const uMax = Math.log(I_LIMIT / is);
    if (u <= uMax) { const e = is * Math.exp(u); return [e, e]; }
    return [I_LIMIT * (1 + u - uMax), I_LIMIT];
}

/**
 * Rectification current of a junction carrying an RF swing of amplitude A:
 * Is·e^{v/nVt}·(I0(A/nVt) − 1), and its derivative in v.
 */
export function rectificationCurrent(v, amplitude, is, nVt) {
    if (!(amplitude > 0)) return [0, 0];
    const u = v / nVt;
    const [f1, d1] = expCapped(u + lnI0(amplitude / nVt), is);
    const [f0, d0] = expCapped(u, is);
    return [f1 - f0, (d1 - d0) / nVt];
}

/** Shockley parameters of a junction for the averaged law. */
export function junctionCard(part) {
    const P = part.params ?? {};
    const VT = 0.02585;
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

// ─── Solver-view expansion ──────────────────────────────────────────────

export const RF_DETECT_KIND = 'rf_detect';
export const COUPLED_INDUCTORS_KIND = 'coupled_inductors';
export const FERRITE_DEFAULTS = Object.freeze({ henrys: 250e-6, tap: 0.25, couplingRatio: 0.1, k: 0.98, couplingK: 0.9, q: 120 });
export const ANTENNA_DEFAULTS = Object.freeze({ heightM: 5, ohms: 50, farads: 200e-12 });
export const TUNING_CAP_DEFAULTS = Object.freeze({ minFarads: 10e-12, maxFarads: 500e-12, position: 0.5 });
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
 * the new parts/nets and, when the circuit has a connected antenna, the
 * RadioFrontEnd that owns the broadcast and the detectors. The caller's
 * parts/nets are not mutated.
 *
 * @param {object[]} parts
 * @param {object[]} nets
 * @param {{controls: () => Map<string, number>}} opts
 */
export function expandRadio(parts, nets, opts) {
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
    const radio = new RadioFrontEnd({ antennas: antennaSpecs, detectors: [], coupled });
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

// ─── The RF solve and the envelope ──────────────────────────────────────

const REFRESH_SEC = 2e-3;
const BLEND_SEC = 1e-3;
const IDC_TAU_SEC = 1e-3;
const DEFAULT_LOAD_OHMS = 47e3;

const cadd = (a, b) => [a[0] + b[0], a[1] + b[1]];
const csub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const cmul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
const cscale = (a, k) => [a[0] * k, a[1] * k];
const cdiv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
/** Phasor of v(n0) − v(n1) from an acSweep result map (n1 null: to ground). */
function phasorOf(results, n0, n1) {
    const at = (n) => {
        const r = n ? results.get(n) : null;
        if (!r) return [0, 0];
        const th = r.phaseDeg * Math.PI / 180;
        return [r.mag * Math.cos(th), r.mag * Math.sin(th)];
    };
    return csub(at(n0), n1 ? at(n1) : [0, 0]);
}
const SLOW_BEAT_HZ = 10e3;
const ENVELOPE_POINTS_PER_CYCLE = 10;
const THETA16 = Array.from({ length: 16 }, (_, i) => [Math.cos((i + 0.5) * Math.PI / 8), Math.sin((i + 0.5) * Math.PI / 8)]);

export class RadioFrontEnd {
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
            if (d > 0 && d <= SLOW_BEAT_HZ) f = Math.max(f, d);
        }
        return f > 0 ? 1 / (ENVELOPE_POINTS_PER_CYCLE * f) : null;
    }

    _phasor(d, k, tSec) {
        const H = this._H[d][k];
        const P = this._Hprev?.[d]?.[k];
        if (!P) return H;
        const w = Math.min(1, Math.max(0, (tSec - this._tRefresh) / BLEND_SEC));
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
        for (const [c, s] of THETA16) m += Math.hypot(a + b * c, b * s);
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
        const alpha = dt > 0 ? 1 - Math.exp(-dt / IDC_TAU_SEC) : 1;
        for (const d of this.detectors) {
            const env = this._H ? this.amplitude(d.index, tSec) : 0;
            const { v, i } = this._junctionDc(d, solution, env);
            const prev = this._idc.get(d.id);
            if (!prev) this._idc.set(d.id, { v, i });
            else { prev.v += (v - prev.v) * alpha; prev.i += (i - prev.i) * alpha; }
        }
        const key = JSON.stringify([...(board.controls ?? new Map())]);
        if (key !== this._controlsKey) { this._controlsKey = key; this._dirty = true; }
        if (this._dirty || tSec - this._tRefresh >= REFRESH_SEC) this.refresh(board, tSec, solution);
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
            const rl = (m.i > 1e-10 && m.v < -1e-5) ? Math.min(1e8, Math.max(10, -m.v / m.i)) : DEFAULT_LOAD_OHMS;
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
                            .map(pt => phasorOf(pt.results, d.nets[0], d.nets[1]));
                        const zth = zin.map(z => cdiv(z, csub([1, 0], cscale(z, old))));
                        const voc = result.det[d.index].map((vk, k) => cmul(vk, cadd([1, 0], cscale(zth[k], old))));
                        const aOf = (A, G) => Math.sqrt(voc.reduce((acc, v, k) => acc + sq(v) / sq(cadd([1, 0], cscale(zth[k], G))), 0));
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
            stations.forEach((s, k) => (Math.abs(s.hz - stations[ref].hz) <= SLOW_BEAT_HZ ? slow : fast).push(k));
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
                    const p = cscale(phasorOf(pt.results, d.nets[0], d.nets[1]), e);
                    det[d.index][k][0] += p[0];
                    det[d.index][k][1] += p[1];
                }
                for (const netId of pt.results.keys()) {
                    let m = nets.get(netId);
                    if (!m) { m = stations.map(() => [0, 0]); nets.set(netId, m); }
                    const p = cscale(phasorOf(pt.results, netId, null), e);
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
