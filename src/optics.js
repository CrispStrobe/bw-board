// SPDX-License-Identifier: MIT
import { DMath } from './det-math.js';
/**
 * Optical links: light from a placed emitter to a placed receiver along a
 * `light_path` part with learner-controlled geometry.
 *
 * Before this module a receiver (phototransistor, photodiode, solar cell,
 * photo-LED) saw only a scalar `light` control or param; an LED's light went
 * nowhere. Here the LIGHT FOLLOWS THE EMITTER'S SIMULATED CURRENT, so a tone,
 * music or a 100 kHz FM square wave driving the LED arrives at the receiver
 * as the same waveform, scaled by the path.
 *
 * PARTS.
 *   Emitters  `led` (any colour), `ir_transmitter`, `laser_diode`.
 *   Receivers `phototransistor`, `photodiode`, `solar_cell`, `led` with
 *             params.photoSensitivity (the LED used as a sensor).
 *   Path      `light_path` (no leads): params.from = emitter id, params.to =
 *             receiver id, params.medium = 'air' | 'fibre' | 'reflect' |
 *             'prism' | 'liquid' | 'string', plus that medium's geometry.
 *             params.knob names ONE geometry param that board.setControl(id,
 *             0..1) moves between params.knobMin and params.knobMax, so a
 *             panel offers it as a slider like an LDR's light.
 *
 * UNITS. Radiant power in mW. A receiver's "light" is the irradiance on its
 * active area relative to E_FULL = 1 mW/cm² at its peak wavelength — the same
 * 0..1 "full light" scale the light control uses, so iMax (phototransistor,
 * photodiode), photoSensitivity (LED) and the solar cell's iph keep meaning
 * "amps at full light". Values above 1 are allowed (a focused beam).
 *
 * EMITTER. P = eta(colour) x I x (1 + tc x (T - 25)) for an LED, with I its
 * solved forward current and T its own temperature (thermal model) or the
 * bench's. A laser diode emits slope x (I - Ith(T)) above its threshold,
 * Ith(T) = Ith x e^((T-25)/T0), as one spectral line into a Gaussian beam of
 * ~1 mrad divergence. An LED's beam is cos^m(theta) with m from its half
 * angle (params.halfAngleDeg), on-axis intensity P(m+1)/(2 pi).
 *
 * RECEIVER. The collected spectral power is weighted by the receiver's
 * relative spectral response (silicon peaks near 880 nm; an LED sensor sees
 * only wavelengths shorter than its own) and its temperature: +0.6 %/K for a
 * phototransistor (its current gain rises), +0.1 %/K for a photodiode.
 *
 * MEDIA (each computes collected power per spectral line):
 *   air     optical bench: inverse square with a 3 mm source size
 *           (d_eff² = d² + d0²), emission pattern at angleDeg off axis,
 *           receiver tilt (cos), obstruction (blocked 0..1), an optional
 *           colour filter, and an optional thin LENS (lensFocalCm at
 *           lensAtCm from the emitter, aperture lensRadiusCm): the cone the
 *           lens catches converges on the image at 1/v = 1/f - 1/u, and the
 *           receiver at distanceCm collects min(1, r_rx²/r_spot²) of it —
 *           the signal peaks where the imaging equation puts the image.
 *   fibre   plastic light guide: launch efficiency (NA cone of the beam,
 *           core vs. source area, inGapMm), Fresnel/cut loss per face
 *           (cutQuality 1 clean .. 0 rough), attenuation in dB/m by
 *           wavelength (PMMA: low in the visible, strong in the IR), bend
 *           loss per bend 0.5 (core/R)/NA², a joint between two fibre
 *           pieces with gap, lateral offset and angle (disc overlap of the
 *           spreading exit cone), and the exit cone onto the receiver at
 *           outGapMm / outOffsetMm. With lensFocalCm the light is launched
 *           through a lens instead (lensAtCm, lensRadiusCm, fibreAtCm; see
 *           lensLaunch): image size against the core, converging cone
 *           against the NA. Ambient light at the receiver can be
 *           cut with params.shield (0..1).
 *   reflect a Lambertian surface at distanceCm: P_rx = rho(lambda) P A/(pi d²),
 *           rho from params.surface ('red', 'green', 'white', 'black', …, or
 *           {r, g, b, ir}). Red and green dyes both reflect infrared.
 *   prism   collimated beam through a prism (acrylic or glass, Cauchy
 *           dispersion) at minimum deviation; a slit at slitAngleDeg passes
 *           the lines whose deviation lies within the beam's spread.
 *   liquid  beam through a round glass: below the liquid it passes straight;
 *           in liquid the curved surface refracts it by 2(i - r) and it
 *           misses the receiver (level 0..1 against beamHeight).
 *   string  air path half-shaded by a plucked string: the shading swings at
 *           stringHz, decaying with decayS, re-plucked every pluckPeriodS —
 *           a light-modulated "electric guitar".
 *   jet     air path crossed by a thin stream of tap water that a charged
 *           comb or ruler pulls sideways (waterJetDeflectionMm): the jet's
 *           shadow on the beam shrinks as it bends out of it, so the
 *           receiver sees more light the harder the comb pulls.
 *
 * NUMERICS. Coupling is a FUNCTION EVALUATED PER STEP, not a new unknown:
 * each accepted (or adopted) solution sets the emitters' powers, and every
 * receiver's extra photocurrent is a hidden `optical_rx` element in parallel
 * with it that reads that power at its stamp (with the string's modulation
 * at the solve instant). The light therefore lags the emitter by one
 * accepted step — nanoseconds to microseconds, far below any photodetector's
 * own response. The board's DC fixpoint re-solves while the optical light
 * still moves, so an operating point is self-consistent. A circuit without a
 * `light_path` builds none of this.
 *
 * @module
 */

export const OPTICAL_RX_KIND = 'optical_rx';
export const LIGHT_PATH_KIND = 'light_path';

/** Irradiance that a receiver reads as light 1, mW/cm². */
export const E_FULL = 1;

// ─── Emitters ────────────────────────────────────────────────────────────

/**
 * Per colour: spectral lines [nm, share], external efficiency (W/A, i.e.
 * mW/mA), output tempco (1/K) and default half angle.
 */
export const EMITTER_TABLE = Object.freeze({
    ir: { lines: [[940, 1]], eta: 0.08, tc: -0.005, half: 20 },
    red: { lines: [[640, 1]], eta: 0.04, tc: -0.010, half: 15 },
    orange: { lines: [[610, 1]], eta: 0.035, tc: -0.009, half: 15 },
    yellow: { lines: [[590, 1]], eta: 0.03, tc: -0.009, half: 15 },
    green: { lines: [[568, 1]], eta: 0.015, tc: -0.004, half: 15 },
    truegreen: { lines: [[525, 1]], eta: 0.06, tc: -0.003, half: 15 },
    blue: { lines: [[470, 1]], eta: 0.08, tc: -0.003, half: 15 },
    white: { lines: [[455, 0.35], [565, 0.65]], eta: 0.07, tc: -0.003, half: 15 },
    uv: { lines: [[395, 1]], eta: 0.05, tc: -0.003, half: 15 },
});
const COLOUR_ALIAS = { infrared: 'ir', amber: 'orange', 'true-green': 'truegreen', 'warm-white': 'white',
    warmwhite: 'white', violet: 'uv', purple: 'blue', pink: 'white', ultraviolet: 'uv' };

/** Laser diode defaults: threshold 20 mA, slope 0.5 W/A, 650 nm, 0.5 mrad half-angle divergence. */
export const LASER_DEFAULTS = Object.freeze({ nm: 650, ith: 0.02, slope: 0.5, t0: 60, tc: -0.004,
    divergenceMrad: 0.5, beamMm: 1.5 });

function colourKey(part) {
    const c = String(part.params?.color ?? part.params?.colour ?? 'red').trim().toLowerCase();
    return EMITTER_TABLE[c] ? c : (COLOUR_ALIAS[c] ?? 'red');
}

/**
 * The emitter's optical card: lines (nm, share), beam model, and how its
 * power follows current and temperature.
 */
export function emitterCard(part) {
    const P = part.params ?? {};
    if (part.kind === 'laser_diode') {
        const nm = Number(P.wavelengthNm) || LASER_DEFAULTS.nm;
        return {
            laser: true, lines: [[nm, 1]],
            ith: num(P.thresholdA, LASER_DEFAULTS.ith), slope: num(P.slopeWPerA, LASER_DEFAULTS.slope),
            t0: num(P.t0K, LASER_DEFAULTS.t0), tc: LASER_DEFAULTS.tc,
            divergence: num(P.divergenceMrad, LASER_DEFAULTS.divergenceMrad) / 1000,
            beamCm: num(P.beamMm, LASER_DEFAULTS.beamMm) / 10,
        };
    }
    const key = part.kind === 'ir_transmitter' ? 'ir' : colourKey(part);
    const row = EMITTER_TABLE[key];
    const lines = Number(P.wavelengthNm) > 0 ? [[Number(P.wavelengthNm), 1]] : row.lines;
    const half = num(P.halfAngleDeg, row.half);
    return {
        laser: false, lines, eta: num(P.efficiencyWPerA, row.eta), tc: num(P.lightTempco, row.tc),
        half, m: lambertOrder(half), srcCm: num(P.sourceMm, 3) / 10,
    };
}

/** cos^m order whose intensity halves at `halfDeg`. */
export function lambertOrder(halfDeg) {
    const c = DMath.cos(Math.min(89, Math.max(1, halfDeg)) * Math.PI / 180);
    return DMath.log(0.5) / DMath.log(c);
}

/** Emitted radiant power, mW, at forward current `amps` and temperature `tC`. */
export function emitterPower(card, amps, tC = 25) {
    const I = Math.max(0, amps) * 1000; // mA
    const dT = tC - 25;
    if (card.laser) {
        const ith = card.ith * 1000 * DMath.exp(dT / card.t0);
        return Math.max(0, I - ith) * card.slope * Math.max(0, 1 + card.tc * dT);
    }
    return I * card.eta * Math.max(0, 1 + card.tc * dT);
}

/** Relative intensity of an LED beam at `deg` off axis (1 on axis). */
export function beamPattern(card, deg) {
    const a = Math.abs(deg) * Math.PI / 180;
    if (a >= Math.PI / 2) return 0;
    return DMath.pow(DMath.cos(a), card.m);
}

// ─── Receivers ───────────────────────────────────────────────────────────

/** Silicon relative response (phototransistor, photodiode, solar cell). */
const SILICON = [[350, 0.05], [400, 0.12], [450, 0.22], [500, 0.32], [550, 0.42], [600, 0.53],
    [650, 0.63], [700, 0.73], [800, 0.92], [880, 1], [940, 0.92], [1000, 0.65], [1100, 0.12], [1150, 0]];

function interp(table, x) {
    if (x <= table[0][0]) return table[0][1];
    for (let i = 1; i < table.length; i++) {
        if (x <= table[i][0]) {
            const [x0, y0] = table[i - 1], [x1, y1] = table[i];
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
        }
    }
    return table[table.length - 1][1];
}

export const RECEIVER_KINDS = new Set(['phototransistor', 'photodiode', 'solar_cell', 'led']);

/** The receiver's optical card: area, response(nm), tempco, amps at light 1. */
export function receiverCard(part) {
    const P = part.params ?? {};
    switch (part.kind) {
        case 'phototransistor':
            return { areaCm2: num(P.areaCm2, 0.03), tc: num(P.lightTempco, 0.006),
                fullAmps: num(P.iMax, 0.005), response: (nm) => interp(SILICON, nm), law: 'vce' };
        case 'photodiode':
            return { areaCm2: num(P.areaCm2, 0.03), tc: num(P.lightTempco, 0.001),
                fullAmps: num(P.iMax, 0.001), response: (nm) => interp(SILICON, nm), law: 'source',
                pos: 'anode', neg: 'cathode' };
        case 'solar_cell':
            return { areaCm2: num(P.areaCm2, 4), tc: num(P.lightTempco, 0.0005),
                fullAmps: num(P.iph, 0.05), response: (nm) => interp(SILICON, nm), law: 'source',
                pos: 'pos', neg: 'neg' };
        case 'led': {
            // An LED senses light of shorter wavelength than its own emission.
            const own = emitterCard(part).lines.reduce((a, [nm]) => Math.max(a, nm), 0);
            return { areaCm2: num(P.areaCm2, 0.02), tc: 0, fullAmps: num(P.photoSensitivity, 0),
                response: (nm) => 1 / (1 + DMath.exp((nm - (own - 15)) / 10)), law: 'source',
                pos: 'anode', neg: 'cathode' };
        }
        default: return null;
    }
}

// ─── Room light with a spectrum (LED sensors) ────────────────────────────

/**
 * THE ROOM'S LIGHT HAS A COLOUR TOO. An LED used as a light sensor sees only
 * wavelengths shorter than its own emission (receiverCard 'led'), and along a
 * light_path that is applied line by line. The plain `light` control was a
 * colourless 0..1, so a red LED and an IR LED under the same lamp could only
 * differ by the photoSensitivity the author typed. With
 * params.ambientSpectrum on the sensing LED, its room-light photocurrent is
 * weighted by the share of that light it can see:
 *
 *   f = Σ S(λ)·R(λ) / Σ S(λ)   over 350..1100 nm in 5 nm steps,
 *
 * S the source's spectral power and R the LED's response, so
 * photoSensitivity keeps meaning "amps at full light of a source it sees
 * completely". Sources: 'incandescent' (a 2850 K black body: a bulb is
 * mostly infrared), 'daylight' (5800 K), 'white-led' (the white emitter's two
 * lines, 25 nm wide), 'flat'. Without the param nothing changes.
 */
export const AMBIENT_SPECTRA = Object.freeze(['incandescent', 'daylight', 'white-led', 'flat']);

function blackBody(nm, kelvin) {
    const l = nm * 1e-9;
    return 1 / (l ** 5 * (DMath.exp(1.438777e-2 / (l * kelvin)) - 1));
}

function ambientPower(spectrum, nm) {
    switch (spectrum) {
        case 'incandescent': return blackBody(nm, 2850);
        case 'daylight': return blackBody(nm, 5800);
        case 'white-led': return EMITTER_TABLE.white.lines.reduce((a, [c, w]) => a + w * DMath.exp(-(((nm - c) / 25) ** 2)), 0);
        case 'flat': return 1;
        default: return null;
    }
}

/** Share of `spectrum` a light-sensing LED responds to (0..1), or 1 without a known spectrum. */
export function ambientSpectralShare(part, spectrum = part?.params?.ambientSpectrum) {
    if (!AMBIENT_SPECTRA.includes(spectrum)) return 1;
    const card = receiverCard({ ...part, kind: 'led' });
    let num = 0, den = 0;
    for (let nm = 350; nm <= 1100; nm += 5) {
        const s = ambientPower(spectrum, nm);
        num += s * card.response(nm);
        den += s;
    }
    return den > 0 ? num / den : 1;
}

// ─── Surfaces, filters, dispersion ───────────────────────────────────────

export const SURFACES = Object.freeze({
    white: { r: 0.9, g: 0.9, b: 0.9, ir: 0.9 },
    black: { r: 0.04, g: 0.04, b: 0.04, ir: 0.08 },
    red: { r: 0.8, g: 0.08, b: 0.06, ir: 0.85 },
    green: { r: 0.07, g: 0.6, b: 0.12, ir: 0.8 },
    blue: { r: 0.06, g: 0.12, b: 0.7, ir: 0.75 },
    yellow: { r: 0.85, g: 0.8, b: 0.08, ir: 0.85 },
    mirror: { r: 0.95, g: 0.95, b: 0.95, ir: 0.95 },
});

/** Reflectance of a surface at a wavelength (rgb bands + infrared). */
export function reflectance(surface, nm) {
    const s = typeof surface === 'string' ? (SURFACES[surface.toLowerCase()] ?? SURFACES.white)
        : { ...SURFACES.white, ...(surface || {}) };
    if (nm < 490) return s.b;
    if (nm < 585) return s.g;
    if (nm < 700) return s.r;
    return s.ir;
}

/** Colour filter pass bands (nm). A name or [lo, hi]. */
export const FILTERS = Object.freeze({
    red: [595, 720], green: [495, 580], blue: [420, 500], yellow: [560, 720], ir: [780, 1100],
    none: [0, 2000],
});

export function filterTransmission(filter, nm) {
    if (filter == null || filter === '') return 1;
    const band = Array.isArray(filter) ? filter : FILTERS[String(filter).toLowerCase()];
    if (!band) return 1;
    // 85 % in band, 15 nm soft edges, 1 % blocking
    const edge = (x) => 1 / (1 + DMath.exp(-x / 6));
    return 0.01 + 0.84 * edge(nm - band[0]) * edge(band[1] - nm);
}

const CAUCHY = { acrylic: [1.4795, 4300], glass: [1.5046, 4200], flint: [1.5980, 9600] };

/** Refractive index by Cauchy's equation, n = A + B/λ² (λ in nm). */
export function refractiveIndex(material, nm) {
    const [A, B] = CAUCHY[material] ?? CAUCHY.acrylic;
    return A + B / (nm * nm);
}

/** Minimum deviation (degrees) of a prism with apex `apexDeg` at index n. */
export function prismDeviation(n, apexDeg = 60) {
    const A = apexDeg * Math.PI / 180;
    const s = n * DMath.sin(A / 2);
    if (s >= 1) return 90;
    return (2 * DMath.asin(s) - A) * 180 / Math.PI;
}

/** Overlap area of two discs (radii r1, r2) whose centres are d apart. */
export function discOverlap(r1, r2, d) {
    d = Math.abs(d);
    if (d >= r1 + r2) return 0;
    if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
    const a = r1 * r1 * DMath.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
    const b = r2 * r2 * DMath.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
    const c = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
    return a + b - c;
}

/** PMMA plastic fibre attenuation, dB/m. */
const PMMA_DB = [[400, 0.35], [450, 0.2], [520, 0.09], [570, 0.07], [620, 0.11], [650, 0.15],
    [700, 0.4], [760, 0.9], [800, 1.5], [850, 2.5], [940, 4], [1000, 6]];
export const fibreAttenuationDbPerM = (nm) => interp(PMMA_DB, nm);

// ─── Path geometry ───────────────────────────────────────────────────────

function num(x, d) { const n = Number(x); return x !== undefined && x !== null && x !== '' && Number.isFinite(n) ? n : d; }
const DEG = Math.PI / 180;

// ─── A water jet bent by a charged comb ──────────────────────────────────

/**
 * How far (mm, at the beam) a thin stream of tap water bends toward a
 * charged comb or ruler `combCm` away holding `combKv` kilovolts.
 *
 * The stream is earthed through the tap, so the comb draws a charge of the
 * opposite sign onto it by induction, proportional to the comb's potential,
 * and then pulls on that charge with a field that is also proportional to
 * it: the force goes as V², so BOTH signs of charge attract (the lesson of
 * the experiment), and as 1/d² for a comb long compared with its distance
 * (a line charge's induced charge and field each fall as 1/d). The
 * stiffness of the falling stream is folded into one calibration: 10 kV at
 * 2 cm bends it 10 mm where it crosses the beam (params.jetBendMm), the
 * order seen with a comb run through dry hair. The stream sticks to the
 * comb beyond 25 mm (params.jetMaxMm). Not modelled: the stream breaking
 * into drops, the comb's charge leaking away, water spraying onto it.
 */
export function waterJetDeflectionMm(P) {
    const kv = num(P.combKv, 10);
    const d = Math.max(0.5, num(P.combCm, 10));
    const ref = num(P.jetBendMm, 10);
    const bend = ref * (kv / 10) ** 2 * (2 / d) ** 2;
    return Math.min(num(P.jetMaxMm, 25), bend);
}

/**
 * The fraction of a beam `beamMm` wide that the stream (jetMm wide, centred
 * in the beam at rest plus jetOffsetMm) shadows once bent, times its
 * opacity (jetOpacity, 0.9: a water stream scatters most of what crosses it).
 */
export function waterJetShadow(P) {
    const b = Math.max(0.1, num(P.beamMm, 4));
    const w = Math.max(0, num(P.jetMm, 3));
    const x = num(P.jetOffsetMm, 0) + waterJetDeflectionMm(P);
    const lo = Math.max(-b / 2, x - w / 2), hi = Math.min(b / 2, x + w / 2);
    const overlap = Math.max(0, hi - lo) / b;
    return Math.min(1, Math.max(0, num(P.jetOpacity, 0.9))) * overlap;
}

/**
 * Fraction (per spectral line nm) of the emitter's power P that the receiver
 * collects through `path` at time t: returns { gain(nm), mod(t) } where the
 * collected mW for a line of power p is p · gain(nm) · mod(t).
 */
export function pathTransfer(params, em, rx) {
    const P = params;
    const medium = String(P.medium ?? 'air');
    const rRx = Math.sqrt(rx.areaCm2 / Math.PI); // cm
    const block = (1 - Math.min(1, Math.max(0, num(P.blocked, 0))))
        * (medium === 'jet' ? 1 - waterJetShadow(P) : 1);
    const filt = (nm) => filterTransmission(P.filter, nm);

    // Free-space beam onto an area at distance dCm, off-axis angle deg.
    const freeSpace = (dCm, deg, areaCm2) => {
        if (em.laser) {
            const w = em.beamCm / 2 + Math.max(0, dCm) * em.divergence; // beam radius
            const off = Math.max(0, dCm) * DMath.tan(Math.abs(deg) * DEG);
            const r = Math.sqrt(areaCm2 / Math.PI);
            return (1 - DMath.exp(-2 * r * r / (w * w))) * DMath.exp(-2 * off * off / (w * w));
        }
        const d2 = dCm * dCm + (em.srcCm / 2) ** 2 + 0.09; // 3 mm near-field floor
        const I0 = (em.m + 1) / (2 * Math.PI);            // per mW, per sr
        return Math.min(1, I0 * beamPattern(em, deg) * areaCm2 / d2);
    };

    if (medium === 'air' || medium === 'string' || medium === 'jet') {
        const d = Math.max(0, num(P.distanceCm, 10));
        const deg = num(P.angleDeg, 0);
        const tilt = DMath.cos(Math.min(90, Math.abs(num(P.tiltDeg, 0))) * DEG);
        let geo;
        const f = num(P.lensFocalCm, 0);
        if (f > 0) {
            const u = Math.max(0.1, num(P.lensAtCm, 2 * f));
            const R = num(P.lensRadiusCm, 1.5);
            const L = Math.max(0, d - u);
            const alpha = DMath.atan(R / u);
            const caught = em.laser ? freeSpace(u, deg, Math.PI * R * R)
                : (1 - DMath.pow(DMath.cos(alpha), em.m + 1)) * beamPattern(em, deg);
            const invV = 1 / f - 1 / u;                       // 1/v
            const rGeo = R * Math.abs(1 - L * invV);
            const src = em.laser ? em.beamCm / 2 : em.srcCm / 2;
            // The source's image (magnification v/u) blurs the focus.
            const rBlur = src * (invV > 0 ? 1 / invV : L) / u;
            const rSpot = Math.max(1e-4, Math.hypot(rGeo, rBlur));
            geo = caught * Math.min(1, (rRx * rRx) / (rSpot * rSpot)) * 0.92;
        } else {
            geo = freeSpace(d, deg, rx.areaCm2);
        }
        const g = geo * tilt * block;
        const out = { gain: (nm) => g * filt(nm), mod: null, maxStepSec: null };
        if (medium === 'string') {
            const hz = num(P.stringHz, 110), tau = num(P.decayS, 1.5), depth = num(P.depth, 0.45);
            const period = num(P.pluckPeriodS, 1), rest = num(P.restShade, 0.5);
            out.mod = (t) => {
                const tp = period > 0 ? ((t % period) + period) % period : Math.max(0, t);
                const s = rest + depth * DMath.exp(-tp / tau) * DMath.sin(2 * Math.PI * hz * tp);
                return 1 - Math.min(1, Math.max(0, s));
            };
            out.maxStepSec = 1 / (20 * hz);
        }
        return out;
    }

    if (medium === 'reflect') {
        const d = Math.max(0, num(P.distanceCm, 1));
        const d2 = d * d + 0.09;
        const hit = em.laser ? 1 : Math.min(1, 0.6 + 0.4 * beamPattern(em, num(P.angleDeg, 0)));
        const g = hit * rx.areaCm2 / (Math.PI * d2) * block;
        const surface = P.surface ?? 'white';
        return { gain: (nm) => Math.min(1, g * reflectance(surface, nm) * filt(nm)), mod: null, maxStepSec: null };
    }

    if (medium === 'prism') {
        const material = P.material ?? 'acrylic', apex = num(P.apexDeg, 60);
        const slit = num(P.slitAngleDeg, 37.5);
        const spread = num(P.beamSpreadDeg, 0.12);
        // Collimated through a lens: a share of the beam reaches the slit plane.
        const d = num(P.distanceCm, 10);
        const g = (em.laser ? 0.9 : 0.25) * Math.min(1, rx.areaCm2 / (0.15 + 0.002 * d * d)) * 0.9 * block;
        return {
            gain: (nm) => {
                const dev = prismDeviation(refractiveIndex(material, nm), apex);
                const x = (dev - slit) / (em.laser ? 0.05 : spread);
                return g * DMath.exp(-0.5 * x * x) * filt(nm);
            },
            mod: null, maxStepSec: null,
        };
    }

    if (medium === 'liquid') {
        const d = num(P.distanceCm, 15);
        const level = Math.min(1, Math.max(0, num(P.level, 0)));
        const beamH = num(P.beamHeight, 0.5), beamW = num(P.beamWidth, 0.05);
        const n = num(P.liquidIndex, 1.33);
        const R = num(P.glassRadiusCm, 3), b = Math.min(R * 0.99, num(P.beamOffsetCm, 1.5));
        const i = DMath.asin(b / R), r = DMath.asin(DMath.sin(i) / n);
        const deflect = 2 * (i - r) / DEG;   // degrees
        const after = Math.min(d, num(P.receiverFromGlassCm, 0.8 * d));
        // The deflected beam leaves the receiver `seen` degrees off its axis.
        const seen = DMath.atan(after * DMath.tan(deflect * DEG) / Math.max(0.1, d)) / DEG;
        // A round glass of liquid is also a cylindrical lens (focus nR/(2(n-1))
        // from its axis): past the focus the beam fans out in one plane.
        const fBack = Math.max(0.1, n * R / (2 * (n - 1)) - R);
        const fan = Math.min(1, fBack / Math.max(fBack, after - fBack));
        const covered = 1 / (1 + DMath.exp(-(level - beamH) / beamW));
        const walls = 0.92;
        const straight = freeSpace(d, num(P.angleDeg, 0), rx.areaCm2);
        const bent = freeSpace(d, num(P.angleDeg, 0) + seen, rx.areaCm2) * fan;
        const g = walls * ((1 - covered) * straight + covered * bent) * block;
        return { gain: (nm) => g * filt(nm), mod: null, maxStepSec: null, deflectionDeg: deflect };
    }

    if (medium === 'fibre') {
        const a = num(P.coreMm, 1) / 20;                  // core radius, cm
        const na = num(P.na, 0.5);
        const thNA = DMath.asin(Math.min(0.99, na));
        const lengthM = Math.max(0, num(P.lengthM, 1));
        const cut = Math.min(1, Math.max(0, num(P.cutQuality, 1)));
        const face = 0.96 * (0.35 + 0.65 * cut);           // per end face
        const inGap = Math.max(0, num(P.inGapMm, 0)) / 10;
        // Launch: the beam's share inside the NA cone, and core vs. spot area.
        let launch;
        const launchF = num(P.lensFocalCm, 0);
        if (launchF > 0) {
            launch = lensLaunch(P, em, a, thNA, launchF);
        } else if (em.laser) {
            const w = em.beamCm / 2 + inGap * em.divergence;
            launch = 1 - DMath.exp(-2 * a * a / (w * w));
        } else {
            const cone = 1 - DMath.pow(DMath.cos(thNA), em.m + 1);
            const spot = em.srcCm / 2 + inGap * DMath.tan(em.half * DEG);
            launch = cone * Math.min(1, (a * a) / (spot * spot));
        }
        // Bends: 0.5 (core diameter / R) / NA² lost per bend.
        const bendR = num(P.bendRadiusCm, 0);
        const bends = bendR > 0 ? Math.max(1, num(P.bends, 1)) : 0;
        const perBend = bendR > 0 ? Math.max(0, 1 - 0.5 * (2 * a / bendR) / (na * na)) : 1;
        // A joint between two pieces of the same fibre (optional).
        let joint = 1;
        const jg = num(P.jointGapMm, null), jo = num(P.jointOffsetMm, 0), ja = num(P.jointAngleDeg, 0);
        if (jg !== null || jo || ja) {
            const spot = a + Math.max(0, jg ?? 0) / 10 * DMath.tan(thNA);
            joint = discOverlap(spot, a, jo / 10) / (Math.PI * spot * spot)
                * Math.max(0, 1 - DMath.sin(Math.abs(ja) * DEG) / (2 * na)) * face * face;
        }
        // Exit cone onto the receiver.
        const outGap = Math.max(0, num(P.outGapMm, 1)) / 10;
        const outSpot = a + outGap * DMath.tan(thNA);
        const outOff = num(P.outOffsetMm, 0) / 10;
        const outAng = Math.abs(num(P.outAngleDeg, 0));
        const exit = discOverlap(outSpot, rRx, outOff) / (Math.PI * outSpot * outSpot)
            * Math.max(0, 1 - DMath.sin(outAng * DEG) / (2 * na));
        const g = launch * face * face * DMath.pow(perBend, bends) * joint * exit * block;
        return {
            gain: (nm) => g * DMath.pow(10, -fibreAttenuationDbPerM(nm) * lengthM / 10) * filt(nm),
            mod: null, maxStepSec: null,
        };
    }
    throw new Error(`light_path: unknown medium "${medium}"`);
}

/**
 * Launch efficiency into a fibre through a converging lens (fibre medium
 * with lensFocalCm): the LED (or laser) at lensAtCm in front of the lens,
 * the fibre's entrance face at fibreAtCm from the emitter.
 *
 *   caught   the share of the emitter's light inside the lens aperture
 *            (radius lensRadiusCm): 1 - cos^(m+1)(atan(R/u)) for an LED,
 *            the Gaussian share for a laser;
 *   spot     the light's radius at the fibre face: defocus R |1 - L/v|
 *            (1/v = 1/f - 1/u, L = face distance behind the lens) combined
 *            with the image of the source (magnification v/u);
 *   core     the share of the spot the core covers, min(1, a^2 / spot^2);
 *   cone     the share of the converging cone the fibre accepts: the lens
 *            delivers rays up to atan(R / v); beyond the fibre's acceptance
 *            angle asin(NA) they leak out of the cladding at once,
 *            min(1, (tan thNA / tan thCone)^2) for a uniformly lit aperture.
 *
 * The best launch sits where the face is at the LED's image and the lens is
 * slow enough (R / v <= NA) that the cone fits the fibre.
 */
export function lensLaunch(P, em, a, thNA, f) {
    const u = Math.max(0.1, num(P.lensAtCm, 3 * f));
    const R = Math.max(0.05, num(P.lensRadiusCm, 0.75));
    const face = Math.max(u, num(P.fibreAtCm, u + f * u / Math.max(1e-6, u - f)));
    const L = face - u;
    const invV = 1 / f - 1 / u;
    let caught, src;
    if (em.laser) {
        const w = em.beamCm / 2 + u * em.divergence;
        caught = 1 - DMath.exp(-2 * R * R / (w * w));
        src = em.beamCm / 2;
    } else {
        caught = 1 - DMath.pow(DMath.cos(DMath.atan(R / u)), em.m + 1);
        src = em.srcCm / 2;
    }
    const rGeo = R * Math.abs(1 - L * invV);
    const rImg = src * (invV > 0 ? 1 / invV : L) / u;
    const spot = Math.max(1e-4, Math.hypot(rGeo, rImg));
    const core = Math.min(1, (a * a) / (spot * spot));
    const tanCone = invV > 0 ? R * invV : 0;            // R / v; a diverging beam has no cone to match
    const cone = tanCone > DMath.tan(thNA) ? (DMath.tan(thNA) / tanCone) ** 2 : 1;
    return caught * core * cone * 0.92;                 // two lens surfaces
}

/** The geometry params a `light_path` exposes as its knob, by medium. */
export const DEFAULT_KNOB = Object.freeze({
    air: ['distanceCm', 1, 30], string: ['stringHz', 80, 330], reflect: ['distanceCm', 0.3, 5],
    prism: ['slitAngleDeg', 35, 41], liquid: ['level', 0, 1], fibre: ['outGapMm', 0, 20],
    jet: ['combCm', 20, 1],
});

/** A path's params with its knob applied (control 0..1 → knob param). */
export function pathParams(path, control) {
    const P = { ...(path.params ?? {}) };
    const medium = String(P.medium ?? 'air');
    const def = DEFAULT_KNOB[medium] ?? [];
    const knob = P.knob ?? def[0];
    if (knob && typeof control === 'number' && Number.isFinite(control)) {
        const lo = num(P.knobMin, def[1] ?? 0), hi = num(P.knobMax, def[2] ?? 1);
        P[knob] = lo + (hi - lo) * Math.min(1, Math.max(0, control));
    }
    return P;
}

/** The 0..1 knob position a path rests at (its param inside the range). */
export function pathKnobRest(path) {
    const P = path.params ?? {};
    const def = DEFAULT_KNOB[String(P.medium ?? 'air')] ?? [];
    const knob = P.knob ?? def[0];
    if (!knob) return 0;
    const lo = num(P.knobMin, def[1] ?? 0), hi = num(P.knobMax, def[2] ?? 1);
    const v = num(P[knob], lo);
    return hi === lo ? 0 : Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
}

// ─── The model on a board ────────────────────────────────────────────────

/**
 * Solver-view expansion: one hidden `optical_rx` in parallel with each
 * receiver some `light_path` points at. Returns { parts, nets, optics }.
 * @param {Array<object>} parts solver-view parts
 * @param {Array<object>} nets
 * @param {{controls: () => Map<string, number>}} opts
 */
export function expandOptics(parts, nets, opts = {}) {
    const paths = parts.filter(p => p.kind === LIGHT_PATH_KIND);
    if (!paths.length) return { parts, nets, optics: null };
    const byId = new Map(parts.map(p => [p.id, p]));
    const links = [];
    // A path that does not name its ends takes the board's only emitter /
    // only receiver (a learner who drops one LED, one phototransistor and a
    // light guide on the bench means those two).
    const isEm = (p) => ['ir_transmitter', 'laser_diode'].includes(p.opticalKind ?? p.kind)
        || (p.kind === 'led' && !(Number(p.params?.photoSensitivity) > 0));
    const isRx = (p) => RECEIVER_KINDS.has(p.kind) && (p.kind !== 'led' || Number(p.params?.photoSensitivity) > 0);
    const only = (pred) => { const c = parts.filter(pred); return c.length === 1 ? c[0] : null; };
    for (const path of paths) {
        const em = byId.get(path.params?.from) ?? (path.params?.from ? null : only(isEm));
        const rx = byId.get(path.params?.to) ?? (path.params?.to ? null : only(isRx));
        if (!em || !rx) continue;
        // An IR transmitter / laser are solved as LEDs of the same id, so
        // the kind decides the card through the drawn kind (`opticalKind`).
        const emKind = em.opticalKind ?? em.kind;
        if (!['led', 'ir_transmitter', 'laser_diode'].includes(emKind)) continue;
        if (!RECEIVER_KINDS.has(rx.kind)) continue;
        if (rx.kind === 'led' && !(Number(rx.params?.photoSensitivity) > 0)) continue;
        links.push({ path, emId: em.id, rxId: rx.id,
            em: emitterCard({ ...em, kind: emKind }), rx: receiverCard(rx), rxPart: rx });
    }
    const optics = new OpticsModel(links, opts);
    if (!links.length) return { parts, nets, optics };
    const outParts = [...parts];
    const outNets = nets.map(n => ({ ...n, terminals: [...n.terminals] }));
    const netOf = (id, t) => outNets.find(n => n.terminals.some(x => x.part === id && x.terminal === t));
    for (const rxId of new Set(links.map(l => l.rxId))) {
        const rx = byId.get(rxId);
        const card = receiverCard(rx);
        const [tp, tn] = card.law === 'vce' ? ['collector', 'emitter'] : [card.pos, card.neg];
        const np = netOf(rxId, tp), nn = netOf(rxId, tn);
        if (!np || !nn || np === nn) continue;
        const id = `${rxId}_optical`;
        const hidden = { id, kind: OPTICAL_RX_KIND, terminals: ['p', 'n'], params: { law: card.law } };
        Object.defineProperty(hidden, 'optics', { value: { model: optics, rxId }, enumerable: false });
        np.terminals.push({ part: id, terminal: 'p' });
        nn.terminals.push({ part: id, terminal: 'n' });
        outParts.push(hidden);
    }
    return { parts: outParts, nets: outNets, optics };
}

export class OpticsModel {
    constructor(links, opts = {}) {
        this.links = links;
        this.controls = opts.controls ?? (() => new Map());
        /** mW per emitter id from the last observed solution. */
        this.emitPower = new Map();
        this._lastAmps = new Map();
        this.reset();
    }

    reset() {
        this.emitPower.clear();
        this._lastAmps.clear();
        for (const l of this.links) { l.a1 = 0; l.t1 = NaN; l.slope = 0; l.h = 0; l.mod = null; }
    }

    /** Smallest step the time-modulated paths need, or null. */
    maxStepSec() {
        let s = Infinity;
        for (const l of this.links) {
            const tr = pathTransfer(pathParams(l.path, this.controls().get(l.path.id)), l.em, l.rx);
            if (tr.maxStepSec) s = Math.min(s, tr.maxStepSec);
        }
        return Number.isFinite(s) ? s : null;
    }

    hasModulation() {
        return this.links.some(l => String(l.path.params?.medium) === 'string');
    }

    /**
     * Take the emitters' currents (and temperatures) from a solution and
     * recompute every receiver's optical drive. Returns true when some
     * receiver's photocurrent moved by more than 0.1 µA + 0.1 %.
     *
     * With `tSec` (an accepted transient step) the drive between this and
     * the next accepted step is EXTRAPOLATED along the last two accepted
     * values (for at most one step length), so a modulated emitter reaches
     * the receiver as a continuous waveform instead of a staircase — a
     * staircase drive into a fast photodetector node made the step
     * controller reject steps on every stair. Without `tSec` (an operating
     * point) the drive is held.
     * @param {{branchCurrents: Map<string, Map<string, number>>}} res
     * @param {(id: string) => number} tempOf
     * @param {number} [tSec]
     */
    observe(res, tempOf, tSec) {
        if (!res?.branchCurrents) return false;
        let edge = false;
        for (const l of this.links) {
            const c = res.branchCurrents.get(l.emId);
            const amps = Math.max(0, c ? -(c.get('anode') ?? 0) : 0);
            this.emitPower.set(l.emId, emitterPower(l.em, amps, tempOf(l.emId)));
        }
        for (const l of this.links) {
            const ctl = this.controls().get(l.path.id);
            const tr = pathTransfer(pathParams(l.path, ctl), l.em, l.rx);
            const pmW = this.emitPower.get(l.emId) ?? 0;
            let collected = 0;
            for (const [nm, share] of l.em.lines) collected += pmW * share * tr.gain(nm) * l.rx.response(nm);
            const tRx = tempOf(l.rxId);
            const light = collected / (l.rx.areaCm2 * E_FULL) * Math.max(0, 1 + l.rx.tc * (tRx - 25));
            const amps = light * l.rx.fullAmps;
            const timed = typeof tSec === 'number' && Number.isFinite(tSec);
            let slope = 0;
            if (timed && Number.isFinite(l.t1) && tSec > l.t1) {
                l.h = tSec - l.t1;
                slope = (amps - l.a1) / l.h;
                // An EDGE (the emitter switched: a jump of more than a fifth of
                // the drive, or a slope four times the last one) is not
                // extrapolated -- it would overshoot by a whole jump -- and
                // the integrator is told, as for a device that switched.
                const big = Math.abs(amps - l.a1) > 0.2 * Math.max(Math.abs(amps), Math.abs(l.a1)) + 1e-9;
                const kink = Math.abs(slope) > 4 * Math.abs(l.slope ?? 0) + 1e-12 && Math.abs(l.slope ?? 0) > 0;
                if (big || (kink && Math.abs(amps - l.a1) > 0.02 * Math.abs(amps) + 1e-9)) {
                    edge = true;
                    slope = 0;
                }
            } else {
                l.h = 0;
            }
            l.slope = slope;
            l.a1 = amps;
            l.t1 = timed ? tSec : NaN;
            l.mod = tr.mod;
        }
        this.lastEdge = edge;
        let changed = false;
        for (const id of new Set(this.links.map(l => l.rxId))) {
            const now = this._heldAmps(id);
            const was = this._lastAmps.get(id) ?? 0;
            if (Math.abs(now - was) > 1e-7 + 1e-3 * Math.abs(was)) changed = true;
            this._lastAmps.set(id, now);
        }
        return changed;
    }

    _heldAmps(rxId) {
        let a = 0;
        for (const l of this.links) if (l.rxId === rxId) a += l.a1 ?? 0;
        return a;
    }

    /** Share of the room light a receiver still sees (params.shield 0..1). */
    ambientFactor(rxId) {
        let f = 1;
        for (const l of this.links) {
            if (l.rxId === rxId) f *= 1 - Math.min(1, Math.max(0, Number(l.path.params?.shield) || 0));
        }
        return f;
    }

    /** Photocurrent (A at the receiver's law) the optical links add at time t. */
    rxAmps(rxId, tSec = 0) {
        let a = 0;
        for (const l of this.links) {
            if (l.rxId !== rxId) continue;
            let v = l.a1 ?? 0;
            if (l.slope && Number.isFinite(l.t1)) {
                const dt = Math.min(Math.max(0, tSec - l.t1), 4 * l.h);
                v = Math.max(0, v + l.slope * dt);
            }
            a += l.mod ? v * l.mod(tSec) : v;
        }
        return a;
    }

    /** The light (0..1 full-light scale) a receiver gets from its links. */
    rxLight(rxId, tSec = 0) {
        const l = this.links.find(k => k.rxId === rxId);
        return l && l.rx.fullAmps > 0 ? this.rxAmps(rxId, tSec) / l.rx.fullAmps : 0;
    }

    /** A readable summary: emitters' mW and receivers' optical light. */
    report(tSec = 0) {
        const rx = {};
        for (const id of new Set(this.links.map(l => l.rxId))) rx[id] = { light: this.rxLight(id, tSec), amps: this.rxAmps(id, tSec) };
        return { emitters: Object.fromEntries(this.emitPower), receivers: rx };
    }
}
