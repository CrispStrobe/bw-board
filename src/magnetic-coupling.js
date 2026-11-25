// SPDX-License-Identifier: MIT
/**
 * Low-frequency magnetic coupling between a circuit and its surroundings:
 * a magnetic field SOURCE whose field a pickup coil overhears, and a
 * PENDULUM that an electromagnet kicks and that induces back into it.
 *
 * ─── INDUCTION LOOP / CABLE (`induction_loop`, pins a/b) ──────────────────
 *
 * A conductor the circuit drives, whose magnetic field reaches a hand-wound
 * pickup coil (`air_coil`, named by `pickup`) a distance d away. Its shape
 * says how the field falls with distance (field per ampere at the pickup):
 *
 *   'loop'   a coil of N turns, radius r, on its axis:
 *              B/I = µ0·N·r² / (2·(r² + d²)^{3/2})   (a telephone's
 *              transformer, an induction loop, a relay coil; ∝ 1/d³ far off)
 *   'wire'   one long straight conductor, its return far away:
 *              B/I = µ0 / (2π·d)
 *   'cable'  a two-core cable, go and return `spacingMm` apart (a mains
 *              cable in a wall), seen broadside at d from its middle:
 *              B/I = µ0·s / (2π·(d² + s²/4))   (the two fields nearly
 *              cancel: ∝ 1/d² far off, which is why only a cable that
 *              CARRIES a load current hums, and only close to it)
 *
 * The pickup (N₂ turns of radius r₂, small against d) links
 * Λ = N₂·π·r₂²·B·cos φ, φ the angle between its axis and the field: the
 * mutual inductance is M = N₂·π·r₂²·(B/I)·cos φ, and the pair is solved as
 * a transformer of the source's own inductance and the pickup's (src/mna.js
 * `transformer`, coupling k = M/√(L₁L₂)), so the pickup's EMF is M·dI/dt
 * for ANY current the circuit drives — mains hum at 50 Hz, a tone, speech —
 * and the (tiny) back-reaction on the source is there too. Several sources
 * may name one pickup: its inductance is split into series sections, one
 * per source, each coupled to its own source (their sum is the pickup's
 * inductance and its EMF the sum of theirs; the sources' coupling to one
 * another is neglected). The coupling is clamped at k ≤ 0.95 (the pickup
 * pressed against a loop is not a closed-core transformer).
 *
 * THE KNOB is the distance: 0 = far (`farCm`, 30), 1 = near (`nearCm`, 1),
 * linear in between; its rest value is `params.position` (0.5).
 *
 * ─── COIL PENDULUM (`coil_pendulum`, pins a/b) ─────────────────────────
 *
 * An electromagnet (a wound rod: `ohms`, `henrys`, magnetic moment
 * `momentPerAmp` A·m² per ampere at its pole) with a pendulum hanging beside
 * it: a bob on a thread of `lengthM`, mass `massKg`, quality factor `q`
 * (air and pivot losses). The pole sits `gapMm` below the bob's rest
 * position and `offsetMm` to the side (+θ swings the bob towards it). The
 * pole's field is a point dipole's,
 *
 *     B = µ0·M/(4π r³)·(3(ẑ·r̂)r̂ − ẑ),   M = momentPerAmp·i.
 *
 * The bob is either
 *   'iron'    a soft-iron object (a paper clip) of `ironCm3` with an
 *             effective susceptibility `chiEff`: the coil's inductance rises
 *             by ΔL(θ) = χV·|B/I|²/µ0 as the bob nears it; the pull is the
 *             torque ½·i²·dΔL/dθ (whatever the current's sign) and the
 *             motion induces e = i·(dΔL/dθ)·ω on top of L·di/dt;
 *   'magnet'  a magnet of `magnetAm2` (sign `magnetPolarity`) pointing
 *             along the vertical: by reciprocity it links Λ(θ) =
 *             m·B_z/I with the coil; torque i·dΛ/dθ, EMF dΛ/dθ·ω — it is
 *             pushed or pulled with the current's sign.
 * Either way the electrical power the EMF absorbs is the mechanical power
 * plus the change of the stored field energy: energy is conserved.
 *
 *     J·θ'' = −m·g·L·sin θ − (J·ω₀/q)·θ' + τ_coil,   J = m·L²
 *
 * is integrated (semi-implicit Euler, at most T₀/400 per substep) at each
 * accepted circuit step, the bob's height rising with the arc. The device
 * publishes angleDeg, amplitudeDeg (largest |θ| over the last swing),
 * periodSec (between upward zero crossings), naturalHz, energyJ.
 *
 * @module
 */

import { DMath } from './det-math.js';

export const MU0 = 4e-7 * Math.PI;
const G = 9.81;

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

// ─── Induction loop / cable ─────────────────────────────────────────────

export const INDUCTION_LOOP_DEFAULTS = Object.freeze({
    shape: 'loop', turns: 50, radiusM: 0.02, wireMm: 0.3, spacingMm: 6,
    nearCm: 1, farCm: 30, position: 0.5, angleDeg: 0,
});
const SHAPES = new Set(['loop', 'wire', 'cable']);
/** Coupling ceiling for a pickup section (no closed core). */
export const K_MAX = 0.95;

export function inductionLoopCard(part) {
    const P = part.params ?? {};
    const D = INDUCTION_LOOP_DEFAULTS;
    const shape = SHAPES.has(P.shape) ? P.shape : D.shape;
    const loop = shape === 'loop';
    const N = loop ? Math.max(1, num(P.turns, D.turns)) : 1;
    const r = Math.max(1e-3, num(P.radiusM, D.radiusM));
    const a = Math.max(0.01, num(P.wireMm, D.wireMm)) * 1e-3;
    // A loop: N·2πr of copper; a straight run: one metre, both ways for a cable.
    const copper = loop ? N * 2 * Math.PI * r : shape === 'cable' ? 2 : 1;
    const area = Math.PI * a * a / 4;
    // Self-inductance: a circular multi-turn loop µ0·N²·r·(ln(8r/b) − 2) with
    // the bundle radius b ≈ √N·a; a metre of wire ~1 µH.
    const bundle = Math.max(a, Math.sqrt(N) * a);
    const henrys = loop ? MU0 * N * N * r * Math.max(0.1, DMath.log(8 * r / bundle) - 2) : 1e-6;
    const nearCm = Math.max(0.1, num(P.nearCm, D.nearCm));
    const farCm = Math.max(nearCm, num(P.farCm, D.farCm));
    return {
        shape, N, r,
        spacingM: Math.max(1e-4, num(P.spacingMm, D.spacingMm) / 1000),
        ohms: Math.max(1e-3, num(P.ohms, 1.72e-8 * copper / area)),
        henrys: Math.max(1e-9, num(P.henrys, henrys)),
        nearCm, farCm,
        position: Math.min(1, Math.max(0, num(P.position, D.position))),
        cosAngle: DMath.cos(num(P.angleDeg, D.angleDeg) * Math.PI / 180),
    };
}

/** Distance (m) from the source to the pickup for a knob value (0 far … 1 near). */
export function loopDistanceM(card, control) {
    const x = Number.isFinite(control) ? Math.min(1, Math.max(0, Number(control))) : card.position;
    return (card.farCm + (card.nearCm - card.farCm) * x) / 100;
}

/** Field (T) per ampere at distance d (m) from the source. */
export function sourceTeslaPerAmp(card, d) {
    if (card.shape === 'loop') return MU0 * card.N * card.r * card.r / (2 * DMath.pow(card.r * card.r + d * d, 1.5));
    if (card.shape === 'wire') return MU0 / (2 * Math.PI * d);
    const s = card.spacingM;
    return MU0 * s / (2 * Math.PI * (d * d + s * s / 4));
}

/** Mutual inductance (H) of the source and a pickup of `turns`, radius `radiusM`, at distance d. */
export function pickupMutual(card, pickup, d) {
    return pickup.N * Math.PI * pickup.r * pickup.r * sourceTeslaPerAmp(card, d) * card.cosAngle;
}

/** Coupling k of the source and one pickup section of `l2` henrys (clamped to ±K_MAX). */
export function sectionCoupling(card, pickup, d, l2) {
    const k = pickupMutual(card, pickup, d) / Math.sqrt(card.henrys * l2);
    return Math.max(-K_MAX, Math.min(K_MAX, k));
}

// ─── Coil pendulum ──────────────────────────────────────────────────────

export const PENDULUM_DEFAULTS = Object.freeze({
    ohms: 150, henrys: 0.1, momentPerAmp: 1.0,
    lengthM: 0.15, massKg: 0.0008, q: 12, gapMm: 10, offsetMm: 20,
    bob: 'iron', ironCm3: 0.1, chiEff: 20, magnetAm2: 0.02, magnetPolarity: 1, startDeg: 0,
});

export function pendulumCard(part) {
    const P = part.params ?? {};
    const D = PENDULUM_DEFAULTS;
    const lengthM = Math.max(0.01, num(P.lengthM, D.lengthM));
    const massKg = Math.max(1e-5, num(P.massKg, D.massKg));
    const omega0 = Math.sqrt(G / lengthM);
    return {
        ohms: Math.max(1e-3, num(P.ohms, D.ohms)),
        henrys: Math.max(1e-6, num(P.henrys, D.henrys)),
        momentPerAmp: num(P.momentPerAmp, D.momentPerAmp),
        lengthM, massKg,
        J: massKg * lengthM * lengthM,
        omega0,
        naturalHz: omega0 / (2 * Math.PI),
        q: Math.max(0.5, num(P.q, D.q)),
        gapM: Math.max(1e-3, num(P.gapMm, D.gapMm) / 1000),
        offsetM: num(P.offsetMm, D.offsetMm) / 1000,
        bob: P.bob === 'magnet' ? 'magnet' : 'iron',
        ironM3: Math.max(0, num(P.ironCm3, D.ironCm3)) * 1e-6,
        chiEff: Math.max(0, num(P.chiEff, D.chiEff)),
        magnetAm2: num(P.magnetAm2, D.magnetAm2) * (num(P.magnetPolarity, 1) < 0 ? -1 : 1),
        startRad: num(P.startDeg, D.startDeg) * Math.PI / 180,
    };
}

/** The coil's field per ampere [Bx, Bz] (T/A) at the bob for angle θ. */
export function poleFieldPerAmp(card, theta) {
    const rx = card.lengthM * DMath.sin(theta) - card.offsetM;
    const rz = card.lengthM * (1 - DMath.cos(theta)) + card.gapM;
    const r2 = rx * rx + rz * rz;
    const r = Math.sqrt(r2);
    const k = MU0 * card.momentPerAmp / (4 * Math.PI * r2 * r);
    return [k * 3 * rx * rz / r2, k * (3 * rz * rz / r2 - 1)];
}

/**
 * The bob's coupling with the coil at θ: for a magnet the flux linkage it
 * gives the coil (Λ = m·B_z/I, Wb·turn), for iron the extra inductance ΔL (H).
 */
export function bobCoupling(card, theta) {
    const [bx, bz] = poleFieldPerAmp(card, theta);
    if (card.bob === 'magnet') return card.magnetAm2 * bz;
    return card.chiEff * card.ironM3 * (bx * bx + bz * bz) / MU0;
}

/** d(bobCoupling)/dθ (central difference). */
export function bobCouplingSlope(card, theta) {
    const h = 1e-5;
    return (bobCoupling(card, theta + h) - bobCoupling(card, theta - h)) / (2 * h);
}

/** Torque (N·m) the coil current i exerts on the pendulum at θ. */
export function coilTorque(card, theta, i) {
    const s = bobCouplingSlope(card, theta);
    return card.bob === 'magnet' ? i * s : 0.5 * i * i * s;
}

/**
 * Advance the pendulum {theta, omega} by dt with the coil current i held:
 * semi-implicit Euler, the viscous loss implicit, substeps ≤ T₀/400.
 */
export function stepPendulum(card, s, i, dt) {
    if (!(dt > 0)) return s;
    const hMax = 2 * Math.PI / card.omega0 / 400;
    const n = Math.max(1, Math.ceil(dt / hMax));
    const h = dt / n;
    const damp = card.omega0 / card.q;
    let { theta, omega } = s;
    for (let k = 0; k < n; k++) {
        const tau = -card.massKg * G * card.lengthM * DMath.sin(theta) + coilTorque(card, theta, i);
        omega = (omega + h * tau / card.J) / (1 + h * damp);
        theta += h * omega;
    }
    return { theta, omega };
}

/** Mechanical energy (J) above the rest position. */
export function pendulumEnergy(card, s) {
    return 0.5 * card.J * s.omega * s.omega + card.massKg * G * card.lengthM * (1 - DMath.cos(s.theta));
}
