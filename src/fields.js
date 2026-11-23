// SPDX-License-Identifier: MIT
/**
 * The room a circuit sits in: low-frequency electric fields (mains wiring, a
 * charged object, the learner's own body) picked up by a bare wire or plate,
 * and the noise of a junction driven into reverse breakdown.
 *
 * ─── FIELDS ──────────────────────────────────────────────────────────────
 *
 * A bare wire (`field_probe`) is coupled to whatever is near it by a small
 * capacitance, a few picofarads. At 50 Hz that is gigaohms, so only a
 * high-impedance input notices — which is the whole lesson of the "hum
 * finder", the static-charge detector and the touch-through-paper switch.
 *
 * THE ROOM. Everything is referred to the room's earth E (a hidden node; or
 * the net of an `earth` part when the circuit has one). The circuit's own
 * common is not earthed: it floats on its capacitance to the room
 * (`commonFarads`, ~50 pF for a gadget on a table) with a 1 TΩ leak. Mains
 * wiring is a source Vpk·sin(2πft) against E (230 V rms, 50 Hz by default).
 * A circuit powered from a MAINS ADAPTOR has its common tied to the primary
 * through the adaptor's interwinding / Y capacitance (`adaptorFarads`, ~1 nF)
 * — a primary at, on average, half the mains voltage — so its whole common
 * swings against earth; that is what makes the touch-through-paper switch
 * work only "with a mains adaptor".
 *
 * A COUPLING THAT CHANGES. Moving a probe toward a cable, or a charged ruler
 * toward a probe, changes the coupling capacitance C(t) between a source at
 * e(t) against E and the probe at v. The current into the probe is
 *
 *     i = d/dt[ C·(e − v) ] = C·d(e − v)/dt + (e − v)·dC/dt.
 *
 * It is realised exactly with the solver's own (fixed) capacitor: maxFarads
 * from the probe to a hidden node that a controlled source, fed from the
 * source side, holds at v + x(t)·(e − v). The capacitor then carries
 * maxFarads·d/dt[x·(e − v)] = d/dt[C·(e − v)], with its history kept by the
 * integrator. A charged ruler held still therefore leaves the charge it
 * induced (a MOSFET gate keeps it), a moving one drives a current (a
 * Darlington's LED flickers only while the ruler moves), and a whole
 * circuit swinging against earth (a mains adaptor) sees the coupling it
 * really has.
 *
 * THE KNOB is the distance: 0 = far away, 1 = as close as it gets, with the
 * coupling linear in the knob position. A knob change is a hand moving: the
 * position follows it over `moveSeconds` (0.2 s) on a smooth (raised-cosine)
 * path, so the induced current is the charge over the time of the movement,
 * as it is for a real ruler, and never an impulse.
 *
 * The probe's `source` says what it is near:
 *   'mains'  the live cable in a wall: e(t) = Vpk·sin(2πft).
 *   'charge' a rubbed plastic ruler at `rodVolts` (default +10 kV; negative
 *            for the other kind of charge): e = rodVolts, steady.
 *   'body'   the learner's finger. The body is a conductor in the room
 *            coupled to the wiring (`bodyMainsFarads`, ~3 pF) and to the
 *            floor (`bodyEarthFarads`, ~150 pF): it sits at
 *            Vpk·sin(2πft)·Cbm/(Cbm + Cbe) — a few volts of hum — behind
 *            Cbm + Cbe. With `contact: 'skin'` the finger touches the wire
 *            through its skin resistance, `skinOhms`/position (open at 0);
 *            with `contact: 'paper'` it presses on a sheet of paper over a
 *            plate, a capacitance `paperFarads`·position in series with the
 *            body's own.
 * Every probe also has its stray capacitance to the room (`strayFarads`,
 * 5 pF) and an insulation leak (`leakOhms`, 1 TΩ).
 *
 * ─── JUNCTION NOISE ──────────────────────────────────────────────────────
 *
 * A junction driven into REVERSE BREAKDOWN — a transistor's base-emitter
 * junction (`bvEbo` on an npn/pnp) or a diode with a breakdown voltage (`bv`)
 * — conducts I(vr) = ibv·e^{(vr − bv)/(n·Vt)}: ibv (10 µA) flows at vr = bv,
 * and the knee is sharp (n = 1). A circuit without these params is untouched:
 * the engine's transistors and diodes have no reverse breakdown of their own.
 *
 * Avalanche current is SHOT NOISE multiplied: every carrier that starts an
 * avalanche arrives as a burst of M carriers, and the bursts (microplasmas)
 * switch on and off at random. Its current noise is white, with density
 *
 *     S_i = 2·q·I·F      (A²/Hz, one-sided)
 *
 * — shot noise (F = 1) times an excess noise factor F. F for a small
 * junction at tens of µA is enormous and device-dependent; the default
 * (1e7) gives ~0.5 mV rms across a base-emitter junction at 20 µA in the
 * simulated band, the order measured on hobby noise generators, and is a
 * param
 * (`noiseFactor`; `noise: false` turns the noise off). Noise current grows
 * as √I; across the junction's own dynamic resistance n·Vt/I the noise
 * VOLTAGE falls as 1/√I, which is why breakdown noise is loudest just past
 * the knee.
 *
 * The noise is a deterministic function of time, not of the step sequence:
 * a seeded hash gives a unit Gaussian per 1/(2B) instant, interpolated with
 * a continuous slope (Catmull-Rom), scaled to σ = √(S_i·B). B, the
 * SIMULATED band (`noiseBandwidthHz`), is 2.5 kHz by default: the real
 * noise is white far beyond it, but every kilohertz of noise costs the
 * transient integrator steps (each sample is a corner it must resolve), and
 * a loudspeaker's report flags the sound as noise (buzzerTone `noise`) for
 * the host to render as hiss whatever the band. The seed
 * is `noiseSeed` or a hash of the part id, so a run reproduces exactly. Its
 * amplitude follows the breakdown current of the last accepted step, so the
 * noise is an independent source in each Newton solve (no negative
 * conductance) and still follows a gated current within a step. Transient
 * steps are capped at 1/(2B) while a junction carries at least 10 nA of
 * breakdown current (a gated noise source between bursts costs nothing).
 *
 * Not modelled: 1/f and popcorn noise, the noise of forward-biased
 * junctions and resistors, temperature dependence of the breakdown voltage,
 * charge decay on a rubbed ruler, the mains field's harmonics.
 *
 * @module
 */

import { chooseGroundReference } from './mna.js';

export const Q_E = 1.602176634e-19;
const VT = 0.02585;
// Catmull-Rom interpolation of unit samples has mean variance 57/70.
const CR_NORM = Math.sqrt(70 / 57);

export const PROBE_DEFAULTS = Object.freeze({
    source: 'mains', position: 0, maxFarads: 2e-12, strayFarads: 5e-12, leakOhms: 1e12,
    mainsVolts: 230, mainsHz: 50, commonFarads: 50e-12, adaptorFarads: 0,
    rodVolts: 10000, moveSeconds: 0.2,
    contact: 'skin', skinOhms: 1e6, paperFarads: 20e-12, bodyMainsFarads: 3e-12, bodyEarthFarads: 150e-12,
});
export const BREAKDOWN_DEFAULTS = Object.freeze({ ibv: 10e-6, n: 1, noiseFactor: 1e7, noiseBandwidthHz: 2500 });

export const BREAKDOWN_KIND = 'junction_breakdown';
export const FIELD_EMF_KIND = 'field_emf';
export const FIELD_CONTACT_KIND = 'field_contact';
export const FIELD_COUPLER_KIND = 'field_coupler';
const EARTH_NET = '@field:earth';
const COMMON_LEAK_OHMS = 1e12;
const BODY_LEAK_OHMS = 1e10;
const I_LIMIT = 0.1;          // A: breakdown exponential continued linearly above
const IDC_TAU_SEC = 2e-4;     // smoothing of the breakdown current that sets the noise
const FIELD_STEP_PER_CYCLE = 40;
const MOVE_STEPS = 20;
const NOISY_AMPS = 1e-8;    // below this a breakdown junction's noise is not resolved
const CONTACT_FLOOR_SIEMENS = 1e-15;
const CHARGE_MAX_FARADS = 0.1e-12;  // a ruler a few cm from a short wire

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const pos = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// ─── Deterministic band-limited Gaussian noise ──────────────────────────

/** 32-bit integer mix (murmur3 finaliser). */
function mix32(h) {
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
}

/** A 32-bit seed from a string (FNV-1a). */
export function seedOf(text) {
    let h = 0x811c9dc5;
    for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
    return h >>> 0;
}

/** Unit Gaussian number k of the stream `seed` (Box–Muller on two hashes). */
export function gaussianAt(seed, k) {
    const a = mix32((seed ^ mix32(k * 2 + 0x9e3779b9)) >>> 0);
    const b = mix32((seed ^ mix32(k * 2 + 1 + 0x7f4a7c15)) >>> 0);
    const u1 = (a + 1) / 4294967297;
    const u2 = b / 4294967296;
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * White Gaussian noise of unit (time-averaged) variance, band-limited to
 * rateHz/2: independent samples at `rateHz`, linearly interpolated. A pure
 * function of t.
 */
export function bandNoise(seed, t, rateHz) {
    const x = Math.max(0, t) * rateHz;
    const k = Math.floor(x);
    const f = x - k;
    const p0 = gaussianAt(seed, k - 1), p1 = gaussianAt(seed, k), p2 = gaussianAt(seed, k + 1), p3 = gaussianAt(seed, k + 2);
    // Catmull-Rom: through every sample with a continuous slope.
    const v = p1 + 0.5 * f * (p2 - p0 + f * (2 * p0 - 5 * p1 + 4 * p2 - p3 + f * (3 * (p1 - p2) + p3 - p0)));
    return CR_NORM * v;
}

// ─── Reverse breakdown ──────────────────────────────────────────────────

/** Breakdown and noise parameters of a part, or null when it has none. */
export function breakdownCard(part) {
    const P = part.params ?? {};
    const bjt = part.kind === 'npn' || part.kind === 'pnp';
    const bv = bjt ? Number(P.bvEbo) : (part.kind === 'diode' ? Number(P.bv) : NaN);
    if (!(Number.isFinite(bv) && bv > 0)) return null;
    const n = pos(P.breakdownN, BREAKDOWN_DEFAULTS.n);
    const F = P.noise === false || P.noise === 0 ? 0 : pos(P.noiseFactor, BREAKDOWN_DEFAULTS.noiseFactor);
    const B = pos(P.noiseBandwidthHz, BREAKDOWN_DEFAULTS.noiseBandwidthHz);
    const seed = P.noiseSeed !== undefined ? (num(P.noiseSeed, 0) >>> 0) : seedOf(part.id);
    return { bv, ibv: pos(P.ibv, BREAKDOWN_DEFAULTS.ibv), nVt: n * VT, F, B, seed };
}

/** Breakdown current at reverse voltage vr, and dI/dvr. */
export function breakdownCurrent(vr, card) {
    const u = (vr - card.bv) / card.nVt;
    const uMax = Math.log(I_LIMIT / card.ibv);
    if (u <= uMax) {
        const i = card.ibv * Math.exp(Math.max(u, -700));
        return [i, i / card.nVt];
    }
    return [I_LIMIT * (1 + u - uMax), I_LIMIT / card.nVt];
}

/** RMS noise current (A) of a breakdown current I over the card's band. */
export function noiseRms(card, amps) {
    return card.F > 0 && amps > 0 ? Math.sqrt(2 * Q_E * amps * card.F * card.B) : 0;
}

// ─── The probe ──────────────────────────────────────────────────────────

/** A field probe's parameters with defaults. */
export function probeCard(part) {
    const P = part.params ?? {};
    const D = PROBE_DEFAULTS;
    const source = ['mains', 'charge', 'body'].includes(P.source) ? P.source : D.source;
    const card = {
        source,
        maxFarads: pos(P.maxFarads, source === 'charge' ? CHARGE_MAX_FARADS : D.maxFarads),
        strayFarads: pos(P.strayFarads, D.strayFarads),
        leakOhms: pos(P.leakOhms, D.leakOhms),
        mainsVolts: Math.max(0, num(P.mainsVolts, D.mainsVolts)),
        mainsHz: pos(P.mainsHz, D.mainsHz),
        commonFarads: pos(P.commonFarads, D.commonFarads),
        adaptorFarads: Math.max(0, num(P.adaptorFarads, D.adaptorFarads)),
        rodVolts: num(P.rodVolts, D.rodVolts),
        moveSeconds: Math.max(0, num(P.moveSeconds, D.moveSeconds)),
        contact: P.contact === 'paper' ? 'paper' : 'skin',
        skinOhms: pos(P.skinOhms, D.skinOhms),
        paperFarads: pos(P.paperFarads, D.paperFarads),
        bodyMainsFarads: pos(P.bodyMainsFarads, D.bodyMainsFarads),
        bodyEarthFarads: pos(P.bodyEarthFarads, D.bodyEarthFarads),
        position: clamp01(num(P.position, D.position)),
    };
    card.bodyFarads = card.bodyMainsFarads + card.bodyEarthFarads;
    card.bodyShare = card.bodyMainsFarads / card.bodyFarads;
    return card;
}

// ─── Solver-view expansion ──────────────────────────────────────────────

/**
 * Solver-only expansion of field probes and junctions in breakdown. Returns
 * the caller's arrays untouched (and `fields: null`) when the circuit has
 * neither; otherwise new parts/nets and the FieldEnvironment that drives
 * them. The caller's parts/nets are not mutated.
 *
 * @param {object[]} parts
 * @param {object[]} nets
 * @param {{controls?: () => Map<string, number>, voltages?: () => Map<string, number>}} [opts]
 *   controls: the board's knob values; voltages: its last solved node voltages
 */
export function expandFields(parts, nets, opts = {}) {
    const probes = parts.filter(p => p.kind === 'field_probe');
    const junctionParts = parts.filter(p => breakdownCard(p));
    if (!probes.length && !junctionParts.length) return { parts, nets, fields: null };
    const outParts = [...parts];
    const outNets = nets.map(n => ({ ...n, terminals: [...n.terminals] }));
    const netOf = (id, t) => outNets.find(n => n.terminals.some(x => x.part === id && x.terminal === t)) ?? null;
    const add = (part, ends) => {
        outParts.push(part);
        ends.forEach(([n, t]) => n.terminals.push({ part: part.id, terminal: t }));
    };
    const hiddenNet = (id) => { const n = { id, terminals: [] }; outNets.push(n); return n; };
    const R = (id, ohms, a, b) => add({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] }, [[a, 'a'], [b, 'b']]);
    const C = (id, farads, a, b) => add({ id, kind: 'capacitor', params: { farads }, terminals: ['a', 'b'] }, [[a, 'a'], [b, 'b']]);
    const env = new FieldEnvironment(opts.controls, opts.voltages);

    // Junctions in breakdown: a companion across the junction, p the side
    // that is positive in breakdown.
    for (const p of junctionParts) {
        const card = breakdownCard(p);
        const [tp, tn] = p.kind === 'npn' ? ['emitter', 'base']
            : p.kind === 'pnp' ? ['base', 'emitter'] : ['cathode', 'anode'];
        const np = netOf(p.id, tp);
        const nn = netOf(p.id, tn);
        if (!np || !nn || np === nn) continue;
        const id = `@field:${p.id}:bd`;
        const j = { id, partId: p.id, card, nets: [np.id, nn.id], index: env.junctions.length };
        const hidden = { id, kind: BREAKDOWN_KIND, params: {}, terminals: ['p', 'n'] };
        Object.defineProperty(hidden, 'fieldJunction', { value: j, enumerable: false });
        Object.defineProperty(j, 'env', { value: env, enumerable: false });
        env.junctions.push(j);
        add(hidden, [[np, 'p'], [nn, 'n']]);
    }

    const wired = probes.filter(p => netOf(p.id, 'a'));
    if (wired.length) {
        const cards = wired.map(probeCard);
        // The room's earth: an `earth` part's net, else a hidden node on the
        // circuit common's capacitance to the room.
        const earthPart = parts.find(p => p.kind === 'earth' && netOf(p.id, 'earth'));
        const refId = outNets.find(n => n.terminals.some(t => parts.find(p => p.id === t.part)?.kind === 'gnd'))?.id
            ?? chooseGroundReference(outParts, outNets)?.netId ?? null;
        const common = outNets.find(n => n.id === refId) ?? null;
        let earth;
        if (earthPart) earth = netOf(earthPart.id, 'earth');
        else {
            earth = hiddenNet(EARTH_NET);
            if (common) {
                C('@field:common', Math.max(...cards.map(c => c.commonFarads)), earth, common);
                R('@field:common_leak', COMMON_LEAK_OHMS, earth, common);
            } else {
                // No circuit common to float: tie the room to the first probe
                // through the leak only (keeps the matrix regular).
                R('@field:common_leak', COMMON_LEAK_OHMS, earth, netOf(wired[0].id, 'a'));
            }
        }
        env.mains = { volts: cards[0].mainsVolts, hz: cards[0].mainsHz };
        env.mainsDriven = cards.some(c => c.source !== 'charge' || c.adaptorFarads > 0);
        const emf = (id, a, b, fn) => {
            const k = env.sources.length;
            env.sources.push(fn);
            const part = { id, kind: FIELD_EMF_KIND, params: {}, terminals: ['p', 'e'] };
            Object.defineProperty(part, 'fieldSource', { value: { env, index: k }, enumerable: false });
            add(part, [[a, 'p'], [b, 'e']]);
        };
        // A mains adaptor's primary at half the mains voltage, through its
        // interwinding capacitance to the circuit common.
        const adaptorFarads = Math.max(...cards.map(c => c.adaptorFarads));
        if (adaptorFarads > 0 && common && !earthPart) {
            const h = hiddenNet('@field:adaptor');
            emf('@field:adaptor:emf', h, earth, (t) => 0.5 * env.mainsAt(t));
            const hn = hiddenNet('@field:adaptor:c');
            R('@field:adaptor:r', 1, h, hn);
            C('@field:adaptor:cap', adaptorFarads, hn, common);
        }
        wired.forEach((p, i) => {
            const card = cards[i];
            const a = netOf(p.id, 'a');
            const pi = env.probes.length;
            const initial = opts.controls?.()?.get(p.id);
            env.probes.push({ id: p.id, card, x0: clamp01(num(initial, card.position)), target: clamp01(num(initial, card.position)), t0: -Infinity });
            C(`@field:${p.id}:stray`, card.strayFarads, a, earth);
            R(`@field:${p.id}:leak`, card.leakOhms, a, earth);
            // A conductance between a and b that the environment sets
            // as a function of time.
            const conductance = (id, na, nb, siemens) => {
                const part = { id, kind: FIELD_CONTACT_KIND, params: {}, terminals: ['a', 'b'] };
                Object.defineProperty(part, 'fieldContact', { value: { siemens }, enumerable: false });
                add(part, [[na, 'a'], [nb, 'b']]);
            };
            // A coupling capacitance C(t) = maxFarads·x(t) between a source
            // node p and the probe a, exactly: a FIXED capacitor maxFarads
            // from a to a hidden node m that a controlled source, drawing
            // its current from p, holds at v(m) = v(a) + x(t)·(v(p) − v(a)).
            // The capacitor then carries maxFarads·d/dt[x·(v(p) − v(a))] =
            // d/dt[C(t)·(v(p) − v(a))]: a moving coupling moves charge, a
            // still one keeps it, and the solver's own capacitor holds the
            // history.
            const coupling = (id, maxFarads, np, na) => {
                const m = hiddenNet(`${id}:m`);
                add({ id, kind: 'capacitor', params: { farads: maxFarads }, terminals: ['a', 'b'] }, [[m, 'a'], [na, 'b']]);
                const ctl = { id: `${id}:x`, kind: FIELD_COUPLER_KIND, params: {}, terminals: ['m', 'a', 'p'] };
                Object.defineProperty(ctl, 'fieldCoupler', { value: { position: (t) => env.position(pi, t) }, enumerable: false });
                add(ctl, [[m, 'm'], [na, 'a'], [np, 'p']]);
            };
            const pe = hiddenNet(`@field:${p.id}:emf`);
            if (card.source === 'mains') {
                emf(`@field:${p.id}:emf`, pe, earth, (t) => env.mainsAt(t));
                coupling(`@field:${p.id}:couple`, card.maxFarads, pe, a);
            } else if (card.source === 'charge') {
                emf(`@field:${p.id}:emf`, pe, earth, () => card.rodVolts);
                coupling(`@field:${p.id}:couple`, card.maxFarads, pe, a);
            } else {
                // The body: its share of the mains behind its own
                // capacitance; touched through the skin (a resistance) or
                // through paper (a capacitance).
                const body = hiddenNet(`@field:${p.id}:body`);
                emf(`@field:${p.id}:emf`, pe, earth, (t) => card.bodyShare * env.mainsAt(t));
                C(`@field:${p.id}:cbody`, card.bodyFarads, pe, body);
                R(`@field:${p.id}:body_leak`, BODY_LEAK_OHMS, body, earth);
                if (card.contact === 'skin') {
                    conductance(`@field:${p.id}:skin`, a, body,
                        (t) => Math.max(CONTACT_FLOOR_SIEMENS, env.position(pi, t) / card.skinOhms));
                } else {
                    coupling(`@field:${p.id}:paper`, card.paperFarads, body, a);
                }
            }
        });
    }
    return { parts: outParts, nets: outNets, fields: env };
}

// ─── The environment ────────────────────────────────────────────────────

/**
 * Owns the probes' positions (and how a knob change moves them), the field
 * sources' EMFs and the breakdown junctions' noise amplitude.
 */
export class FieldEnvironment {
    constructor(controls, voltages) {
        this._controls = controls ?? (() => new Map());
        this._voltages = voltages ?? null;
        this.probes = [];
        this.junctions = [];
        this.sources = [];
        this.mains = { volts: PROBE_DEFAULTS.mainsVolts, hz: PROBE_DEFAULTS.mainsHz };
        this.mainsDriven = false;
        this.reset();
    }

    /** Start from rest: probes where their knobs are, no noise history. */
    reset() {
        this._idc = new Map();
        this._lastAcceptSec = null;
        this._now = 0;
        const controls = this._controls() ?? new Map();
        for (const p of this.probes) {
            const x = clamp01(num(controls.get(p.id), p.card.position));
            p.x0 = x; p.target = x; p.t0 = -Infinity;
        }
    }

    /**
     * Whether anything here moves with time now: the mains (a mains probe,
     * a finger, an adaptor), a noisy junction, or a probe whose hand is
     * still moving. A charged ruler held still is a static source.
     */
    get timeVarying() {
        if (this.junctions.some(j => this.noisy(j))) return true;
        if (this.mainsDriven) return true;
        return this.probes.some((p, i) => this.moving(i, this._now));
    }

    /**
     * Whether junction j makes noise worth resolving: noise on, and a
     * breakdown current of at least NOISY_AMPS. A junction held below
     * breakdown (a gated noise source between bursts) costs no steps.
     */
    noisy(j) {
        if (!(j.card.F > 0)) return false;
        if (this.junctionAmps(j.index) >= NOISY_AMPS) return true;
        // Not yet (or no longer) seen in transient: the last solve decides,
        // so a DC operating point already in breakdown starts the noise.
        const nv = this._voltages?.();
        if (!nv) return this._idc.get(j.index) === undefined;
        const [i] = breakdownCurrent((nv.get(j.nets[0]) ?? 0) - (nv.get(j.nets[1]) ?? 0), j.card);
        return i >= NOISY_AMPS;
    }

    /** Whether probe i's hand is moving at time t. */
    moving(i, t) {
        const p = this.probes[i];
        return p.x0 !== p.target && t < p.t0 + p.card.moveSeconds;
    }

    /** Mains voltage against earth at time t. */
    mainsAt(t) {
        return this.mains.volts * Math.SQRT2 * Math.sin(2 * Math.PI * this.mains.hz * t);
    }

    /** A probe's position at time t (the hand's path toward the knob). */
    position(i, t) {
        const p = this.probes[i];
        if (p.x0 === p.target) return p.target;
        const T = p.card.moveSeconds;
        if (!(T > 0)) return t >= p.t0 ? p.target : p.x0;
        const s = (t - p.t0) / T;
        if (s <= 0) return p.x0;
        if (s >= 1) return p.target;
        return p.x0 + (p.target - p.x0) * (1 - Math.cos(Math.PI * s)) / 2;
    }

    /** A knob moved at time t: the hand starts moving from where it is. */
    onControl(partId, value, t) {
        this.probes.forEach((p, i) => {
            if (p.id !== partId) return;
            const x = this.position(i, t);
            p.x0 = x; p.t0 = t; p.target = clamp01(num(value, p.target));
        });
        this._now = t;
    }

    /** EMF of source k at time t. */
    emf(k, t) { return this.sources[k](t); }

    /** The latest time the environment has seen (accepted step or control). */
    get now() { return this._now; }

    /** Smoothed breakdown current (A) of junction j. */
    junctionAmps(j) { return this._idc.get(j) ?? 0; }

    /** RMS noise current (A) of junction j now. */
    noiseSigma(j) { return noiseRms(this.junctions[j].card, this.junctionAmps(j)); }

    /** Smallest step that resolves the noise band and the mains cycle. */
    maxStepSec() {
        let s = Infinity;
        for (const j of this.junctions) if (this.noisy(j)) s = Math.min(s, 1 / (2 * j.card.B));
        if (this.mainsDriven) s = Math.min(s, 1 / (FIELD_STEP_PER_CYCLE * this.mains.hz));
        this.probes.forEach((p, i) => {
            if (this.moving(i, this._now)) s = Math.min(s, p.card.moveSeconds / MOVE_STEPS);
        });
        return Number.isFinite(s) ? s : null;
    }

    /** Follow each junction's breakdown current at an accepted step. */
    onAccepted(board, tSec, solution) {
        const dt = this._lastAcceptSec === null ? 0 : Math.max(0, tSec - this._lastAcceptSec);
        this._lastAcceptSec = tSec;
        this._now = tSec;
        const alpha = dt > 0 ? 1 - Math.exp(-dt / IDC_TAU_SEC) : 1;
        const nv = (id) => solution?.nodeVoltages?.get(id) ?? 0;
        for (const j of this.junctions) {
            const [i] = breakdownCurrent(nv(j.nets[0]) - nv(j.nets[1]), j.card);
            const prev = this._idc.get(j.index);
            this._idc.set(j.index, prev === undefined ? i : prev + (i - prev) * alpha);
        }
    }

    /** What the environment is doing at time t. */
    report(t) {
        return {
            mains: { ...this.mains },
            probes: this.probes.map((p, i) => ({ id: p.id, source: p.card.source, position: this.position(i, t), target: p.target })),
            junctions: this.junctions.map(j => ({ id: j.partId, amps: this.junctionAmps(j.index), noiseAmpsRms: this.noiseSigma(j.index) })),
        };
    }
}
