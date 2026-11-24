// SPDX-License-Identifier: MIT
import { DMath } from './det-math.js';
/**
 * Sound reaching a loudspeaker or an earphone: the transducer as a
 * MICROPHONE, and acoustic coupling between transducers.
 *
 * A moving-coil transducer is reversible. Sound pressure moves the cone, the
 * voice coil moves in the magnet's field and an EMF e = Bl·v appears in
 * series with the coil. A crystal (piezo) earphone works the same way with a
 * charge source: an EMF in series with its capacitance. Electrically both are
 * the existing voice-coil networks (src/transducers.js) with a Thevenin
 * source in series with the coil resistance:
 *
 *     a ──[Re  ⊕ e(t)]── coil ──[Le]── b         (moving coil)
 *     a ──[ESR ⊕ e(t)]── mid ──[C]── b           (crystal)
 *
 * stamped by the solver-only part VOICE_COIL_KIND, which replaces the plain
 * series resistor ONLY for a transducer that listens or is listened to. Every
 * other speaker or earphone is built exactly as before.
 *
 * THE EMF is e(t) = S · p(t), S the microphone sensitivity (V/Pa), p the
 * pressure at the transducer: the sum of
 *
 *   1. an external sound the learner makes — a sustained vowel ("aaah"), a
 *      steady tone, a telephone bell or room noise — at a level in dB SPL
 *      (params soundDb, soundWave, soundHz);
 *   2. the sound radiated by another transducer it `hears` at `distanceCm`:
 *      p = K · i_src(t − r/c) / r_eff, where i_src is the source's coil
 *      current (its voltage for a crystal one), K its radiation constant
 *      (Pa·m/A: pressure at 1 m per ampere), c = 343 m/s and
 *      r_eff = sqrt(r² + a²) with a the radiator's radius, so the pressure
 *      stays finite with the earphone pressed on the cone (a piston's
 *      on-axis near field levels off at about its own radius).
 *
 * The delay is real (29 µs per cm) and taken from the source's ACCEPTED
 * history, so a loop (earphone → amplifier → speaker → earphone) closes with
 * the physical delay, not the solver's step: the step is capped well below it.
 * When the loop gain exceeds one the loop howls, at the frequency the
 * amplifier's coupling capacitors, the coils and the delay agree on, and the
 * amplifier's clipping sets the howl's loudness.
 *
 * Defaults (order-of-magnitude, documented, NOT measured):
 *   speaker    S = 0.5 mV/Pa   (Bl ≈ 1.5 T·m, 20 cm² cone of ~2 g above its
 *                               resonance: v = p·A/(ω·m), e = Bl·v at 500 Hz)
 *              K = 1 Pa·m/A    (≈ 85 dB SPL at 1 m for 1 W into 8 Ω)
 *              a = 2.5 cm
 *   magnetic earphone S = 3 mV/Pa, K = 3 Pa·m/A, a = 1 cm
 *   crystal earphone  S = 5 mV/Pa, K = 2e-3 Pa·m/V (radiates from voltage), a = 1 cm
 * Transducers are treated as flat across the audio band (no cone resonance
 * in the acoustic path); a speaker's own motional impedance, when set,
 * still shapes its electrical side.
 *
 * Deterministic: noise is a hash of the sample index, not Math.random, so a
 * run reproduces exactly.
 *
 * @module
 */

export const VOICE_COIL_KIND = '__voice_coil';
export const SPEED_OF_SOUND = 343;
const P_REF = 20e-6;

export const ACOUSTIC_DEFAULTS = Object.freeze({
    speaker: { micVPerPa: 0.5e-3, radiatePaM: 1.0, radiusM: 0.025 },
    magnetic: { micVPerPa: 3e-3, radiatePaM: 3.0, radiusM: 0.01 },
    crystal: { micVPerPa: 5e-3, radiatePaM: 2e-3, radiusM: 0.01 },
});

/** Default fundamental per external sound. */
export const SOUND_DEFAULT_HZ = Object.freeze({ voice: 150, tone: 440, ring: 900, noise: 0 });

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

function acousticCard(part) {
    const P = part.params ?? {};
    const D = part.kind === 'speaker' ? ACOUSTIC_DEFAULTS.speaker
        : P.type === 'crystal' ? ACOUSTIC_DEFAULTS.crystal : ACOUSTIC_DEFAULTS.magnetic;
    return {
        micVPerPa: Math.max(0, num(P.micVPerPa, D.micVPerPa)),
        radiatePaM: Math.max(0, num(P.radiatePaM, D.radiatePaM)),
        radiusM: Math.max(1e-4, num(P.radiusM, D.radiusM)),
        crystal: part.kind === 'earphone' && P.type === 'crystal',
    };
}

/** A transducer that picks up sound: it says so, or names a sound or a source. */
export function isListener(part) {
    const P = part?.params ?? {};
    return P.listen === true || P.soundDb !== undefined || P.soundWave !== undefined
        || (typeof P.hears === 'string' && P.hears !== '');
}

// ─── External sounds ─────────────────────────────────────────────────────

/** Deterministic noise in [-1, 1]: a hash of the integer sample index. */
function hashNoise(n) {
    let x = (n | 0) ^ 0x9e3779b9;
    x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
    x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
    x ^= x >>> 16;
    return ((x >>> 0) / 4294967295) * 2 - 1;
}

/** Vowel harmonics: two formant humps (≈ "ah", 700 and 1150 Hz) on a 1/k tilt. */
function vowelAmplitudes(f0) {
    const out = [];
    for (let k = 1; k * f0 < 2500 && k <= 24; k++) {
        const f = k * f0;
        out.push(DMath.exp(-(((f - 700) / 250) ** 2)) + 0.5 * DMath.exp(-(((f - 1150) / 250) ** 2)) + 0.25 / k);
    }
    const rms = Math.sqrt(out.reduce((s, a) => s + a * a / 2, 0));
    return out.map(a => a / rms);
}

/**
 * An electromechanical bell: the clapper strikes `strikeHz` times a second
 * (twice the ringing current's frequency: the armature flips each half
 * cycle), each strike a decaying gong partial at f plus a weaker one at
 * 2.4·f, in bursts of `onS` seconds every `onS + offS`.
 */
function bellSample(t, f, strikeHz, decayS) {
    const T = 1 / strikeHz;
    let s = 0;
    // The ring of the last few strikes still sounds.
    const k0 = Math.floor(t / T);
    for (let k = k0; k >= 0 && k > k0 - 6; k--) {
        const age = t - k * T;
        const env = DMath.exp(-age / decayS);
        s += env * (DMath.sin(2 * Math.PI * f * age) + 0.35 * DMath.sin(2 * Math.PI * 2.4 * f * age));
    }
    return s;
}

const bellRmsCache = new Map();
function bellRms(f, strikeHz, decayS) {
    const key = `${f}|${strikeHz}|${decayS}`;
    let r = bellRmsCache.get(key);
    if (r !== undefined) return r;
    // RMS over steady ringing (after the first few strikes), 50 samples per gong period.
    const t0 = 8 / strikeHz;
    const span = 4 / strikeHz;
    const n = Math.max(400, Math.ceil(span * f * 50));
    let s2 = 0;
    for (let i = 0; i < n; i++) { const v = bellSample(t0 + span * i / n, f, strikeHz, decayS); s2 += v * v; }
    r = Math.sqrt(s2 / n) || 1;
    bellRmsCache.set(key, r);
    return r;
}

/**
 * The learner's sound at a transducer, normalised to RMS 1 while it sounds:
 * a function of simulated time only.
 * @param {object} P part params
 * @param {number} t seconds
 */
export function soundWaveform(P, t) {
    const wave = P.soundWave ?? 'voice';
    const f = num(P.soundHz, SOUND_DEFAULT_HZ[wave] ?? 440);
    if (wave === 'tone') return Math.SQRT2 * DMath.sin(2 * Math.PI * f * t);
    if (wave === 'noise') {
        // White noise sampled at 10 kHz, linearly interpolated: band-limited
        // to the audio range and independent of the solver's step. Uniform
        // in [-1, 1] has RMS 1/√3; the interpolation lowers it to √(2/9).
        const fs = 10000;
        const x = t * fs;
        const n = Math.floor(x);
        const u = x - n;
        return ((1 - u) * hashNoise(n) + u * hashNoise(n + 1)) / Math.sqrt(2 / 9);
    }
    if (wave === 'ring') {
        const onS = num(P.ringOnS, 1);
        const offS = num(P.ringOffS, 4);
        const strikeHz = num(P.strikeHz, 50);
        const decayS = num(P.decayS, 0.03);
        const period = onS + offS;
        const tc = period > 0 ? t % period : t;
        // A burst rings out after the ringing current stops.
        if (tc > onS + 0.2) return 0;
        const sinceStart = tc;
        const struck = Math.min(sinceStart, onS);
        // Strikes only during the burst; their ring decays afterwards.
        let s = 0;
        const T = 1 / strikeHz;
        const k0 = Math.floor(struck / T);
        for (let k = k0; k >= 0 && k > k0 - 6; k--) {
            const age = sinceStart - k * T;
            if (age < 0) continue;
            s += DMath.exp(-age / decayS) * (DMath.sin(2 * Math.PI * f * age) + 0.35 * DMath.sin(2 * Math.PI * 2.4 * f * age));
        }
        return s / bellRms(f, strikeHz, decayS);
    }
    // 'voice': a sustained vowel on fundamental f, with a slight vibrato
    // (±2 % at 5 Hz) as a voice has.
    const amps = vowelAmplitudes(f);
    const phase = 2 * Math.PI * f * t + 0.02 * f / 5 * (1 - DMath.cos(2 * Math.PI * 5 * t));
    let s = 0;
    for (let k = 0; k < amps.length; k++) s += amps[k] * DMath.sin((k + 1) * phase + 0.7 * k * k);
    return s;
}

/** Highest frequency in a sound (for the step bound), Hz. */
function soundTopHz(P) {
    const wave = P.soundWave ?? 'voice';
    const f = num(P.soundHz, SOUND_DEFAULT_HZ[wave] ?? 440);
    if (wave === 'tone') return f;
    if (wave === 'noise') return 5000;
    if (wave === 'ring') return 2.4 * f;
    return Math.min(2500, f * vowelAmplitudes(f).length);
}

/** RMS pressure (Pa) of the learner's sound at a part, 0 when silent. */
export function soundPressureRms(P) {
    const db = num(P.soundDb, null);
    if (db === null || db <= 0) return 0;
    return P_REF * DMath.pow(10, Math.min(db, 140) / 20);
}

// ─── The acoustic environment of one netlist ─────────────────────────────

const ENV_OF = new WeakMap();

/** The acoustic environment a drawn transducer belongs to, if any. */
export function acousticsOf(part) { return ENV_OF.get(part) ?? null; }

/** Keep this much accepted history per radiating source (s). */
const HISTORY_S = 0.02;

class Acoustics {
    constructor(listeners, sources) {
        /** @type {Map<string, {part: object, card: object}>} */
        this.listeners = listeners;
        /** @type {Map<string, {part: object, card: object, t: number[], x: number[]}>} */
        this.sources = sources;
    }

    /** Distance (m) from a listener to the source it hears. */
    _distance(part) {
        return Math.max(0, num(part.params?.distanceCm, 5)) / 100;
    }

    /** Pressure (Pa) at a listener at time t, from the learner's sound and the source it hears. */
    pressure(part, t) {
        const P = part.params ?? {};
        let p = 0;
        const prms = soundPressureRms(P);
        if (prms > 0) p += prms * soundWaveform(P, t);
        const src = typeof P.hears === 'string' ? this.sources.get(P.hears) : null;
        if (src) {
            const r = this._distance(part);
            const rEff = Math.hypot(r, src.card.radiusM);
            p += src.card.radiatePaM * this._sourceAt(src, t - r / SPEED_OF_SOUND) / rEff;
        }
        return p;
    }

    /** EMF (V) a listener's coil develops at time t. */
    emf(part, t) {
        const card = this.listeners.get(part.id)?.card;
        if (!card) return 0;
        return card.micVPerPa * this.pressure(part, t);
    }

    /** A source's drive (A, or V for a crystal) at time tq, from its accepted history. */
    _sourceAt(src, tq) {
        const { t, x } = src;
        const n = t.length;
        if (!n || tq < t[0]) return 0;
        if (tq >= t[n - 1]) return x[n - 1];
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m] <= tq) lo = m; else hi = m; }
        // Cubic Hermite through the neighbours (Catmull-Rom slopes on the
        // uneven grid): a piecewise-linear history has a kink at every
        // accepted point, which the step controller reads as error and
        // answers with ever smaller steps.
        const h = (t[hi] - t[lo]) || 1;
        const u = (tq - t[lo]) / h;
        const slope = (i) => {
            const a = Math.max(0, i - 1), c = Math.min(n - 1, i + 1);
            return (x[c] - x[a]) / ((t[c] - t[a]) || 1);
        };
        const m0 = slope(lo) * h, m1 = slope(hi) * h;
        const u2 = u * u, u3 = u2 * u;
        return (2 * u3 - 3 * u2 + 1) * x[lo] + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * x[hi] + (u3 - u2) * m1;
    }

    /** Record a radiating transducer's drive at an accepted time. */
    record(part, tSec, drive) {
        const src = this.sources.get(part.id);
        if (!src || !Number.isFinite(drive)) return;
        const { t, x } = src;
        // A re-accepted time (a restart) replaces what came after it.
        while (t.length && t[t.length - 1] >= tSec) { t.pop(); x.pop(); }
        t.push(tSec); x.push(drive);
        if (t.length > 64 && t[0] < tSec - HISTORY_S) {
            let k = 0;
            while (k < t.length && t[k] < tSec - HISTORY_S) k++;
            t.splice(0, k); x.splice(0, k);
        }
    }

    /** Anything moving with time: a learner's sound, or a coupling. */
    timeVarying() {
        for (const { part } of this.listeners.values()) {
            if (soundPressureRms(part.params ?? {}) > 0) return true;
            if (typeof part.params?.hears === 'string' && this.sources.has(part.params.hears)) return true;
        }
        return false;
    }

    /**
     * Step ceiling: a twelfth of the shortest period in a learner's sound,
     * and half the shortest acoustic delay of a coupling (so the loop closes
     * with the physical delay, not the solver's step).
     */
    maxStepSec() {
        let h = Infinity;
        for (const { part } of this.listeners.values()) {
            const P = part.params ?? {};
            if (soundPressureRms(P) > 0) h = Math.min(h, 1 / (12 * soundTopHz(P)));
            if (typeof P.hears === 'string' && this.sources.has(P.hears)) {
                const tau = this._distance(part) / SPEED_OF_SOUND;
                h = Math.min(h, Math.max(2e-6, tau / 2), 2e-5);
            }
        }
        return Number.isFinite(h) ? h : null;
    }

    reset() {
        for (const s of this.sources.values()) { s.t.length = 0; s.x.length = 0; }
    }
}

/**
 * Build the acoustic environment for a netlist's transducers: listeners and
 * the sources they hear. Null when no transducer listens.
 * @param {object[]} parts drawn parts
 */
export function buildAcoustics(parts) {
    const tx = parts.filter(p => p.kind === 'speaker' || p.kind === 'earphone');
    const listeners = new Map();
    const sources = new Map();
    for (const p of tx) {
        if (!isListener(p)) continue;
        listeners.set(p.id, { part: p, card: acousticCard(p) });
        const h = p.params?.hears;
        const src = typeof h === 'string' ? tx.find(q => q.id === h && q !== p) : null;
        if (src && !sources.has(src.id)) sources.set(src.id, { part: src, card: acousticCard(src), t: [], x: [] });
    }
    if (!listeners.size) return null;
    const env = new Acoustics(listeners, sources);
    for (const p of tx) if (listeners.has(p.id) || sources.has(p.id)) ENV_OF.set(p, env);
    return env;
}

/** Whether the drawn transducer needs the EMF-capable coil (it listens or is heard). */
export function needsVoiceCoil(env, part) {
    return Boolean(env && (env.listeners.has(part.id) || env.sources.has(part.id)));
}
