// SPDX-License-Identifier: MIT
/**
 * Electrodynamic transducers: the dynamic loudspeaker (`speaker`) and the
 * high-impedance earphone (`earphone`).
 *
 * ELECTRICAL MODEL. A moving-coil transducer is its voice coil: a winding
 * resistance Re in series with the coil inductance Le,
 *
 *     a ──[Re]── coil ──[Le]── b
 *
 * built as first-class solver parts on a hidden node, so the transient
 * integrator owns the inductor's history exactly as for a drawn inductor
 * (the dc_motor winding and the piezo capacitance use the same pattern).
 * The hidden node is also one of the part's own terminals (`coil`) in the
 * solver view, so the device model reads its own coil current as
 * (v(a) − v(coil)) / Re — the current that moves the cone.
 *
 * Optional MOTIONAL IMPEDANCE (`resonanceHz` set): the cone's mass, the
 * suspension's compliance and the mechanical losses reflect into the
 * electrical side as a parallel R‖L‖C in series with the coil,
 *
 *     Res = motionalOhms,  Lces = Res / (ωs·Qm),  Cmes = Qm / (ωs·Res),
 *
 * which peaks at Re + Res at the free-air resonance fs and is a short far
 * from it (Thiele/Small, the textbook equivalent circuit).
 *
 * A CRYSTAL earphone (`type: 'crystal'`) is a piezo element instead: a
 * capacitance with a high leakage resistance, and no DC path — which is why
 * a crystal set needs a resistor across it.
 *
 * SOUND. The cone follows the coil current, so pitch and loudness are read
 * from the current, not the terminal voltage: update() tracks crossings of
 * the AC current (alternating rising/falling, interpolated, with hysteresis
 * as for the piezo) and a running RMS of the current's AC part. buzzerTone()
 * reports `{hz, on, amps, level}` where `level` = I_rms / I_rated with
 * I_rated = sqrt(ratedWatts / Re): amplitude proportional to current, 1 at
 * rated power. A steady DC through the coil makes no sound.
 *
 * @module
 */

import { buildAcoustics, needsVoiceCoil, VOICE_COIL_KIND } from './acoustics.js';

export const SPEAKER_DEFAULTS = Object.freeze({ ohms: 8, henrys: 2e-4, ratedWatts: 0.5, motionalOhms: 20, qm: 2 });
export const EARPHONE_DEFAULTS = Object.freeze({ ohms: 2000, henrys: 0.1, ratedWatts: 1e-3,
    capacitance: 10e-9, leakOhms: 10e6 });
export const COIL_PIN = 'coil';

/** Coil resistance and rated current for a transducer part. */
export function transducerCard(part) {
    const D = part.kind === 'earphone' ? EARPHONE_DEFAULTS : SPEAKER_DEFAULTS;
    const P = part.params ?? {};
    const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
    const crystal = part.kind === 'earphone' && P.type === 'crystal';
    const ohms = num(P.ohms, D.ohms);
    const ratedWatts = num(P.ratedWatts, D.ratedWatts);
    return {
        crystal,
        ohms,
        henrys: num(P.henrys, D.henrys),
        ratedWatts,
        // Rated current of the coil; a crystal earphone is rated by voltage
        // (1 V rms across it is loud), expressed as the current that drives
        // through its leak at that voltage would be meaningless, so it reads
        // loudness from the voltage instead (see update()).
        ratedAmps: Math.sqrt(ratedWatts / ohms),
        capacitance: num(P.capacitance, EARPHONE_DEFAULTS.capacitance),
        leakOhms: num(P.leakOhms, EARPHONE_DEFAULTS.leakOhms),
        resonanceHz: Number(P.resonanceHz) > 0 ? Number(P.resonanceHz) : 0,
        motionalOhms: num(P.motionalOhms, D.motionalOhms ?? 20),
        qm: num(P.qm, D.qm ?? 2),
    };
}

/**
 * Solver-only expansion of every speaker and earphone (see the module note).
 * The caller's parts/nets are not mutated. A transducer that listens (or is
 * listened to) gets its series resistance as a VOICE_COIL_KIND part, which
 * also carries the sound EMF (src/acoustics.js); `acoustics` is that
 * environment, or null when nothing listens.
 */
export function expandTransducers(parts, nets) {
    const selected = parts.filter(p => p.kind === 'speaker' || p.kind === 'earphone');
    if (!selected.length) return { parts, nets, acoustics: null };
    const acoustics = buildAcoustics(parts);
    const outParts = [...parts];
    const outNets = nets.map(n => ({ ...n, terminals: [...n.terminals] }));
    const netOf = (id, t) => outNets.find(n => n.terminals.some(x => x.part === id && x.terminal === t));
    for (const p of selected) {
        const a = netOf(p.id, 'a');
        const b = netOf(p.id, 'b');
        if (!a || !b || a === b) continue;
        const c = transducerCard(p);
        const add = (id, kind, params, na, nb) => {
            outParts.push({ id, kind, params, terminals: ['a', 'b'] });
            na.terminals.push({ part: id, terminal: 'a' });
            nb.terminals.push({ part: id, terminal: 'b' });
        };
        // The series resistance: a plain resistor, or the voice coil with its
        // sound EMF when the part takes part in an acoustic path.
        const series = (id, ohms, na, nb) => {
            if (!needsVoiceCoil(acoustics, p)) { add(id, 'resistor', { ohms }, na, nb); return; }
            const vc = { id: `${p.id}_vc`, kind: VOICE_COIL_KIND, params: { ohms }, terminals: ['a', 'coil'] };
            Object.defineProperty(vc, 'acoustic', { value: { env: acoustics, part: p }, enumerable: false });
            outParts.push(vc);
            na.terminals.push({ part: vc.id, terminal: 'a' });
            nb.terminals.push({ part: vc.id, terminal: 'coil' });
        };
        if (c.crystal) {
            // Piezo crystal: capacitance behind a small series resistance
            // (the element's own), leak across the pins.
            const mid = { id: `n_${p.id}_${COIL_PIN}`, terminals: [{ part: p.id, terminal: COIL_PIN }] };
            outNets.push(mid);
            series(`${p.id}_esr`, 100, a, mid);
            add(`${p.id}_cp`, 'capacitor', { farads: c.capacitance }, mid, b);
            add(`${p.id}_leak`, 'resistor', { ohms: c.leakOhms }, a, b);
            continue;
        }
        const coil = { id: `n_${p.id}_${COIL_PIN}`, terminals: [{ part: p.id, terminal: COIL_PIN }] };
        outNets.push(coil);
        series(`${p.id}_re`, c.ohms, a, coil);
        let end = b;
        if (c.resonanceHz > 0) {
            const ws = 2 * Math.PI * c.resonanceHz;
            const mot = { id: `n_${p.id}_mot`, terminals: [] };
            outNets.push(mot);
            add(`${p.id}_res`, 'resistor', { ohms: c.motionalOhms }, mot, b);
            add(`${p.id}_lces`, 'inductor', { henrys: c.motionalOhms / (ws * c.qm) }, mot, b);
            add(`${p.id}_cmes`, 'capacitor', { farads: c.qm / (ws * c.motionalOhms) }, mot, b);
            end = mot;
        }
        add(`${p.id}_le`, 'inductor', { henrys: c.henrys }, coil, end);
    }
    return { parts: outParts, nets: outNets, acoustics };
}

/**
 * The transducer's cone signal for one accepted solve: the coil current for
 * a moving-coil part, the terminal voltage for a crystal earphone.
 */
export function coneSignal(card, read, emf = 0) {
    if (card.crystal) return read('a') - read('b') - emf;
    return (read('a') - read(COIL_PIN) - emf) / card.ohms;
}

/** Device state for the tone tracker. */
export function initToneTracker() {
    return { drives: {}, _lastX: 0, _lastNs: null, _lo: 0, _hi: 0, _level: 0, _edges: [],
        _mean: 0, _msq: 0, rms: 0 };
}

const RMS_TAU_S = 0.02;
const HP_TAU_S = 0.005;
const ENV_TAU_S = 0.005;

/**
 * Track pitch (same-direction crossing times, interpolated) and RMS of the
 * AC part of `x` over time. `minSwing` is the smallest peak-to-peak swing
 * that counts as sound. Mutates `state`.
 */
export function trackTone(state, x, ns, minSwing) {
    const nsPrev = state._lastNs;
    const xPrev = state._lastX - (state._lastMean ?? 0);
    state._lastX = x;
    state._lastNs = ns;
    // The AC part: x minus its DC level, followed over ~5 ms (a 30 Hz
    // high-pass), so a drifting level (a detector settling, an amplifier
    // biasing up at switch-on) is neither counted as the tone nor as sound.
    if (nsPrev === null) {
        state._mean = x;
    } else if (ns > nsPrev) {
        const dt = (ns - nsPrev) * 1e-9;
        state._mean += (x - state._mean) * (1 - Math.exp(-dt / HP_TAU_S));
        const ac = x - state._mean;
        state._msq += (ac * ac - state._msq) * (1 - Math.exp(-dt / RMS_TAU_S));
        state.rms = Math.sqrt(state._msq);
    }
    state._lastMean = state._mean;
    x -= state._mean;
    // Envelope of the swing, decaying toward the present value over ~5 ms
    // of simulated time (whatever the step size) so a level change, or the
    // DC settling at switch-on, is followed without remembering forever.
    const decay = nsPrev !== null && ns > nsPrev ? 1 - Math.exp(-(ns - nsPrev) * 1e-9 / ENV_TAU_S) : 0;
    state._lo = Math.min(x, state._lo + (x - state._lo) * decay);
    state._hi = Math.max(x, state._hi + (x - state._hi) * decay);
    const swing = state._hi - state._lo;
    if (swing < minSwing) return;
    const mid = (state._hi + state._lo) / 2;
    const hyst = swing * 0.2;
    const level = x > mid + hyst ? 1 : x < mid - hyst ? -1 : 0;
    if (level !== 0 && level !== state._level) {
        if (state._level !== 0) {
            const threshold = mid + level * hyst;
            let at = ns;
            if (nsPrev !== null && nsPrev < ns && (xPrev - threshold) * (x - threshold) < 0) {
                at = nsPrev + (ns - nsPrev) * (threshold - xPrev) / (x - xPrev);
            }
            state._edges.push(BigInt(Math.round(at)));
            if (state._edges.length > 16) state._edges.shift();
        }
        state._level = level;
    }
}
