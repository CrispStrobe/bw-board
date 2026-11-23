// SPDX-License-Identifier: MIT
/**
 * Transducers that turn a physical quantity the learner controls into an
 * electrical one, each a small solver network plus a device model:
 *
 * THERMOCOUPLE (`thermocouple`, pins pos/neg). Two different metals joined at
 * a hot junction; the open ends sit at the cold (bench) temperature. The
 * Seebeck EMF is E(T_hot) − E(T_cold), with E the type's reference function,
 * in series with the wires' resistance. E is interpolated from the standard
 * reference tables (ITS-90, values at 100 °C steps, rounded to 1 µV):
 * type K (chromel/alumel, ≈ 41 µV/K), T (copper/constantan, 39–60 µV/K: the
 * "thermocouple from two wires"), J (iron/constantan, ≈ 52 µV/K), E
 * (chromel/constantan, ≈ 68 µV/K). Linear interpolation between 100 °C points
 * is within ~0.5 % of the polynomials; beyond a table's end the last slope
 * continues. Params: type ('K'), hotC (hot-junction °C, default the bench
 * temperature: no EMF), coldC (default the bench temperature), ohms (5).
 *
 * HAND-WOUND COIL (`air_coil`, pins a/b). A single-layer air solenoid of N
 * turns, radius r, length l, wound from copper wire of diameter d:
 *   R = ρ_Cu · N · 2πr / (π d²/4)                (unless `ohms` is given)
 *   L = µ0 N² π r² / (l + 0.9 r)                  (Wheeler's short-coil formula)
 *   B = µ0 N I / √(l² + 4r²)                      (field at the coil's centre)
 *   B(x) = (µ0 N I / 2l)·[u/√(r²+u²)] from u = x − l/2 to x + l/2
 *                                                 (on the axis, x from the centre)
 *   compass deflection θ = atan(B(x) / B_earth)   (a compass on the axis at
 *                                                  `compassCm` from the centre,
 *                                                  5 cm by default, coil axis
 *                                                  east–west, B_earth the local
 *                                                  horizontal field, 20 µT)
 * A magnet DROPPED through it (control verb 'drop', or bumping `params.drops`)
 * falls freely from `dropHeightM` above the centre; as a point dipole of
 * moment m on the axis it links Λ(z) = (µ0 m N / 2l)·[u/√(r²+u²)] from
 * u = z − l/2 to z + l/2, and the coil develops e = −dΛ/dt = −Λ'(z)·v (sign
 * chosen so a magnet entering north-first drives a positive at `a`; set
 * `magnetPolarity: -1` to turn it over). The induced current is small and its
 * braking (Lenz) on the magnet is neglected. METAL near the coil changes its
 * inductance: a non-ferrous object (coin, aluminium) is a shorted turn and
 * lowers L, a ferrous one raises it, by `metalCoupling`·(r²/(r²+d²))³ with d
 * the distance from the coil face (the mutual inductance falls as the cube of
 * distance and the reflected change goes as its square).
 *
 * ELECTROLYSIS CELL (`electrolysis_cell`, pins a/b): two electrodes in an
 * electrolyte, e.g. a battery's terminals on a wet tongue. The bulk
 * electrolyte is a resistance; each electrode-electrolyte interface is a
 * double-layer capacitance in parallel with the Faradaic (electrolysis)
 * current, which is negligible below the decomposition voltage of water
 * (1.23 V plus overpotentials) and rises exponentially (Tafel) above it:
 *   I_F(V) = I0·(exp((V − E0)/b) − exp((−V − E0)/b))
 * built as two antiparallel solver diodes (Is = I0·e^(−E0/b), n = b/Vt) beside
 * the series double layer. E0 = 1.7 V, b = 60 mV, I0 = 10 µA, Cdl = 2 µF,
 * R = 2 kΩ (a wet tongue between contacts a centimetre apart) by default.
 * The device reports the Faradaic current, the charge moved, the hydrogen it
 * frees (Q/2F) and a "taste" level: the Faradaic current over 20 µA, the
 * order of the electrogustometry threshold for anodal current on the tongue.
 * After the battery is removed the double layer keeps a polarisation voltage
 * that discharges through the electrolysis branch: the cell is briefly a
 * battery itself.
 *
 * @module
 */

import { JUNCTION_THERMAL_VOLTAGE } from './mna.js';

export const MU0 = 4e-7 * Math.PI;
const RHO_CU = 1.72e-8;
const FARADAY = 96485.33;
const G = 9.81;

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

// ─── Thermocouple ───────────────────────────────────────────────────────

/** Reference EMF tables, mV at [°C, mV] points (cold junction 0 °C). */
export const THERMOCOUPLE_TABLES = Object.freeze({
    K: [[-200, -5.891], [-100, -3.554], [0, 0], [100, 4.096], [200, 8.138], [300, 12.209], [400, 16.397],
        [500, 20.644], [600, 24.905], [700, 29.129], [800, 33.275], [900, 37.326], [1000, 41.276],
        [1100, 45.119], [1200, 48.838], [1300, 52.410]],
    T: [[-200, -5.603], [-100, -3.379], [0, 0], [100, 4.279], [200, 9.288], [300, 14.862], [400, 20.872]],
    J: [[-200, -7.890], [-100, -4.633], [0, 0], [100, 5.269], [200, 10.779], [300, 16.327], [400, 21.848],
        [500, 27.393], [600, 33.102], [700, 39.132], [760, 42.919]],
    E: [[-200, -8.825], [-100, -5.237], [0, 0], [100, 6.319], [200, 13.421], [300, 21.036], [400, 28.946],
        [500, 37.005], [600, 45.093], [700, 53.112], [800, 61.017], [900, 68.787], [1000, 76.373]],
});

/** Reference EMF (V) of a thermocouple type at `c` °C against a 0 °C junction. */
export function thermocoupleEmf(type, c) {
    const tab = THERMOCOUPLE_TABLES[String(type ?? 'K').toUpperCase()] ?? THERMOCOUPLE_TABLES.K;
    let i = 1;
    while (i < tab.length - 1 && c > tab[i][0]) i++;
    const [c0, e0] = tab[i - 1];
    const [c1, e1] = tab[i];
    return 1e-3 * (e0 + (e1 - e0) * (c - c0) / (c1 - c0));
}

export function thermocoupleCard(part, benchC = 25) {
    const P = part.params ?? {};
    const coldC = num(P.coldC, benchC);
    const hotC = num(P.hotC, coldC);
    const type = String(P.type ?? 'K').toUpperCase();
    return {
        type, hotC, coldC,
        ohms: Math.max(1e-3, num(P.ohms, 5)),
        emf: thermocoupleEmf(type, hotC) - thermocoupleEmf(type, coldC),
    };
}

// ─── Hand-wound air coil ────────────────────────────────────────────────

export const AIR_COIL_DEFAULTS = Object.freeze({
    turns: 200, radiusM: 0.015, lengthM: 0.03, wireMm: 0.25, earthT: 20e-6, compassCm: 5,
    magnetAm2: 1.0, dropHeightM: 0.1, metalCoupling: 0.05,
});

export function airCoilCard(part) {
    const P = part.params ?? {};
    const D = AIR_COIL_DEFAULTS;
    const N = Math.max(1, num(P.turns, D.turns));
    const r = Math.max(1e-4, num(P.radiusM, D.radiusM));
    const l = Math.max(1e-4, num(P.lengthM, D.lengthM));
    const d = Math.max(0.01, num(P.wireMm, D.wireMm)) * 1e-3;
    const wireOhms = RHO_CU * N * 2 * Math.PI * r / (Math.PI * d * d / 4);
    const henrys0 = MU0 * N * N * Math.PI * r * r / (l + 0.9 * r);
    const metalCm = num(P.metalCm, null);
    let metal = 0;
    if (metalCm !== null && metalCm >= 0) {
        const dm = metalCm / 100;
        const sign = P.metalKind === 'ferrous' ? 1 : -1;
        metal = sign * Math.max(0, Math.min(0.5, num(P.metalCoupling, D.metalCoupling))) * (r * r / (r * r + dm * dm)) ** 3;
    }
    return {
        N, r, l,
        ohms: Math.max(1e-3, num(P.ohms, wireOhms)),
        henrys0,
        henrys: henrys0 * (1 + metal),
        metalShift: metal,
        teslaPerAmp: MU0 * N / Math.sqrt(l * l + 4 * r * r),
        compassTeslaPerAmp: axialTeslaPerAmp(N, r, l, Math.max(0, num(P.compassCm, D.compassCm)) / 100),
        earthT: Math.max(1e-9, num(P.earthT, D.earthT)),
        magnetAm2: num(P.magnetAm2, D.magnetAm2),
        dropHeightM: Math.max(0, num(P.dropHeightM, D.dropHeightM)),
        polarity: num(P.magnetPolarity, 1) < 0 ? -1 : 1,
    };
}

/** On-axis field per ampere (T/A) at x metres from a solenoid's centre. */
export function axialTeslaPerAmp(N, r, l, x) {
    const g = (u) => u / Math.sqrt(r * r + u * u);
    return MU0 * N / (2 * l) * (g(x + l / 2) - g(x - l / 2));
}

/** dΛ/dz (Wb·turn per m) for a point dipole on the axis at height z above the centre. */
export function fluxLinkageSlope(card, z) {
    const { N, r, l, magnetAm2: m } = card;
    const k = MU0 * m * N / (2 * l);
    const f = (u) => r * r / (r * r + u * u) ** 1.5;
    return k * (f(z + l / 2) - f(z - l / 2));
}

/** Flux linkage Λ(z) (Wb·turn) for the same dipole. */
export function fluxLinkage(card, z) {
    const { N, r, l, magnetAm2: m } = card;
    const k = MU0 * m * N / (2 * l);
    const g = (u) => u / Math.sqrt(r * r + u * u);
    return k * (g(z + l / 2) - g(z - l / 2));
}

/** Where the falling magnet is τ seconds after release: {z, v}. */
export function magnetFall(card, tau) {
    if (!(tau > 0)) return { z: card.dropHeightM, v: 0 };
    return { z: card.dropHeightM - 0.5 * G * tau * tau, v: -G * tau };
}

/** Seconds until the magnet is well past the coil (2 heights plus the coil below the centre). */
function fallDuration(card) {
    const depth = card.dropHeightM + card.l + 4 * card.r;
    return Math.sqrt(2 * depth / G);
}

/** EMF (V, at `a` against the inner node) of the coil τ seconds after a drop. */
export function dropEmf(card, tau) {
    if (!(tau > 0) || tau > fallDuration(card)) return 0;
    const { z, v } = magnetFall(card, tau);
    // |e| = |dΛ/dt| = |Λ'(z)·v|; the winding sense makes a north-first entry
    // (Λ rising: Λ' < 0 above the centre, v < 0) positive at `a`.
    return card.polarity * fluxLinkageSlope(card, z) * v;
}

// Drop state lives beside the drawn part (not in the device state, which a
// solver-only stimulus cannot reach), so the step bound knows a magnet is
// in flight.
const COIL_RUN = new WeakMap();
export function coilRun(part) {
    let s = COIL_RUN.get(part);
    if (!s) { s = { t0: null, armed: false, seen: num(part.params?.drops, 0), lastT: 0 }; COIL_RUN.set(part, s); }
    return s;
}

/** Inductor params objects of each coil, so the model can move L with the metal. */
const COIL_INDUCTOR = new WeakMap();
export function coilInductorParams(part) { return COIL_INDUCTOR.get(part) ?? null; }

// ─── Electrolysis cell ──────────────────────────────────────────────────

export const ELECTROLYSIS_DEFAULTS = Object.freeze({
    ohms: 2000, farads: 2e-6, onsetV: 1.7, tafelV: 0.06, i0: 1e-5, tasteAmps: 20e-6,
});

export function electrolysisCard(part) {
    const P = part.params ?? {};
    const D = ELECTROLYSIS_DEFAULTS;
    const onsetV = Math.max(0.1, num(P.onsetV, D.onsetV));
    const tafelV = Math.max(0.01, num(P.tafelV, D.tafelV));
    const i0 = Math.max(1e-12, num(P.i0, D.i0));
    return {
        ohms: Math.max(1, num(P.ohms, D.ohms)),
        farads: Math.max(1e-12, num(P.farads, D.farads)),
        onsetV, tafelV, i0,
        tasteAmps: Math.max(1e-9, num(P.tasteAmps, D.tasteAmps)),
        is: i0 * Math.exp(-onsetV / tafelV),
        // The solver's junction law uses its own thermal voltage; n is set
        // against it so the diodes carry exactly I_F(V).
        n: tafelV / JUNCTION_THERMAL_VOLTAGE,
    };
}

/** Faradaic current (A) at interface voltage v. */
export function faradaicCurrent(card, v) {
    return card.i0 * (Math.exp((v - card.onsetV) / card.tafelV) - Math.exp((-v - card.onsetV) / card.tafelV));
}

export { FARADAY };

// ─── Solver view ────────────────────────────────────────────────────────

export const INNER_PIN = 'm';
const KINDS = new Set(['air_coil', 'electrolysis_cell']);

/**
 * Solver-only expansion: the coil's inductance and the electrolysis cell's
 * interface on a hidden inner node `m` (the drawn part's own terminal in the
 * solver view, so its model stamps the series branch a–m and reads both
 * ends). The thermocouple needs no expansion. The caller's parts/nets are not
 * mutated. `stimulus` is the step/time authority for magnets in flight.
 */
export function expandSensingTransducers(parts, nets) {
    const selected = parts.filter(p => KINDS.has(p.kind));
    if (!selected.length) return { parts, nets, stimulus: null };
    const outParts = [...parts];
    const outNets = nets.map(n => ({ ...n, terminals: [...n.terminals] }));
    const netOf = (id, t) => outNets.find(n => n.terminals.some(x => x.part === id && x.terminal === t));
    const coils = [];
    for (const p of selected) {
        const a = netOf(p.id, 'a');
        const b = netOf(p.id, 'b');
        if (!a || !b || a === b) continue;
        const m = { id: `n_${p.id}_${INNER_PIN}`, terminals: [{ part: p.id, terminal: INNER_PIN }] };
        outNets.push(m);
        const add = (id, kind, params, na, nb, ta = 'a', tb = 'b') => {
            outParts.push({ id, kind, params, terminals: [ta, tb] });
            na.terminals.push({ part: id, terminal: ta });
            nb.terminals.push({ part: id, terminal: tb });
        };
        if (p.kind === 'air_coil') {
            const card = airCoilCard(p);
            const lp = { henrys: card.henrys };
            COIL_INDUCTOR.set(p, lp);
            add(`${p.id}_l`, 'inductor', lp, m, b);
            coils.push(p);
        } else {
            const card = electrolysisCard(p);
            add(`${p.id}_cdl`, 'capacitor', { farads: card.farads }, m, b);
            const dp = { is: card.is, n: card.n, rs: 0, vf: card.onsetV + card.tafelV * Math.log(0.02 / card.i0) };
            add(`${p.id}_fa`, 'diode', { ...dp }, m, b, 'anode', 'cathode');
            add(`${p.id}_fc`, 'diode', { ...dp }, b, m, 'anode', 'cathode');
        }
    }
    const stimulus = coils.length ? {
        /** A magnet armed or in flight through any coil. */
        timeVarying() { return coils.some(p => inFlight(p)); },
        maxStepSec() {
            let h = Infinity;
            for (const p of coils) {
                if (!inFlight(p)) continue;
                const c = airCoilCard(p);
                const vPass = Math.sqrt(2 * G * Math.max(c.dropHeightM, 0.005));
                h = Math.min(h, Math.min(c.r, c.l) / vPass / 40);
            }
            return Number.isFinite(h) ? Math.max(h, 1e-6) : null;
        },
        reset() { for (const p of coils) { const s = coilRun(p); s.t0 = null; s.armed = false; s.lastT = 0; } },
    } : null;
    return { parts: outParts, nets: outNets, stimulus };
}

function inFlight(p) {
    const s = coilRun(p);
    if (s.armed) return true;
    if (s.t0 === null) return false;
    return s.lastT - s.t0 <= fallDuration(airCoilCard(p));
}
