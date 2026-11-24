// SPDX-License-Identifier: MIT
import { DMath } from './det-math.js';
/**
 * RF envelope ("dynamic phasor") machinery for the radio front end
 * (src/radio.js): dense complex linear algebra, the large-signal
 * describing functions of the junctions, and the time integrator of one
 * frequency BAND.
 *
 * THE MODEL. Around a centre frequency ω_b every node voltage and branch
 * current of the linearised RF network is written v(t) = Re{X(t)·e^{jω_b t}}
 * with a slowly varying complex envelope X. For the network's admittance
 * Y(s) expanded to first order about s = jω_b,
 *
 *     Y0·X + Y1·dX/dt = J(t),     Y0 = Y(jω_b),  Y1 = dY/ds at jω_b,
 *
 * which is the narrow-band envelope equation of every tuned circuit (a
 * parallel LC tank gets Y1 = 2C, its envelope time constant 2C/G = 2Q/ω).
 * It is exact for capacitors and branch-form inductors and accurate to
 * (Δω/ω)² for the coupled windings, and its time scale is the tank's
 * bandwidth, not the carrier: a 1 MHz or a 100 MHz carrier costs the same.
 *
 * Junctions are not linearised at a fixed point. Each is stamped by its
 * DESCRIBING FUNCTION — the fundamental current a sinusoidal swing of
 * amplitude A produces, averaged over the carrier cycle. For an exponential
 * junction i = Is·e^{v/nVt} that is, with x = A/nVt and the swings of the
 * other bands averaged out (incommensurate carriers),
 *
 *     fundamental  Is·e^{v/nVt}·Π_c I0(x_c)·g(x_b)·V_b / nVt,
 *     g(x) = 2·I1(x) / (x·I0(x)),
 *
 * and the DC current rises by Is·e^{v/nVt}·(Π_c I0(x_c) − 1) — the
 * rectification the transient solve sees (src/devices/radio-parts.js). So a
 * transistor whose loop gain at the tank's resonance exceeds one makes the
 * envelope GROW, its own I1/I0 compression and the bias shift of its
 * rectified current LIMIT the growth (a regenerative receiver past its
 * threshold, an oscillator), and a bias network slow enough to starve the
 * transistor QUENCHES it (super-regeneration). Field-effect transistors
 * (square law with cut-off) take the same describing function by quadrature
 * over the cycle.
 *
 * INTEGRATION. BDF2 (backward Euler after a change of step): second order
 * for the slow modes the envelope carries and L-stable, so the fast modes it
 * does not resolve are damped instead of ringing; substeps h = 1 ns·2^k
 * chosen per band from the fastest rotation in it (stations off the centre,
 * FM deviation, the programme) and the envelope's own growth rate. With h
 * fixed the linear part A = Y0 + 1.5·Y1/h is factored once; the junction
 * stamps, which change every substep, enter as a low-rank Woodbury update
 * through their port voltages, so a substep costs O(N²).
 *
 * NOISE. A tank with nothing to amplify still starts: each winding carries
 * the thermal noise current of its loss conductance, 4kT·G per hertz, from
 * a seeded PRNG (deterministic runs). It is what a super-regenerative
 * receiver hisses with between stations.
 *
 * @module
 */

export const VT = 0.02585;
const KT = 1.380649e-23 * 300;

// ─── Bessel functions (Abramowitz & Stegun 9.8.1–9.8.4, |ε| < 2e-7) ──────

/** e^{−x}·I0(x), x ≥ 0. */
export function i0e(x) {
    if (x < 3.75) {
        const t = (x / 3.75) ** 2;
        return DMath.exp(-x) * (1 + t * (3.5156229 + t * (3.0899424 + t * (1.2067492
            + t * (0.2659732 + t * (0.0360768 + t * 0.0045813))))));
    }
    const t = 3.75 / x;
    return (0.39894228 + t * (0.01328592 + t * (0.00225319 + t * (-0.00157565 + t * (0.00916281
        + t * (-0.02057706 + t * (0.02635537 + t * (-0.01647633 + t * 0.00392377)))))))) / Math.sqrt(x);
}

/** e^{−x}·I1(x), x ≥ 0. */
export function i1e(x) {
    if (x < 3.75) {
        const t = (x / 3.75) ** 2;
        return DMath.exp(-x) * x * (0.5 + t * (0.87890594 + t * (0.51498869 + t * (0.15084934
            + t * (0.02658733 + t * (0.00301532 + t * 0.00032411))))));
    }
    const t = 3.75 / x;
    return (0.39894228 + t * (-0.03988024 + t * (-0.00362018 + t * (0.00163801 + t * (-0.01031555
        + t * (0.02282967 + t * (-0.02895312 + t * (0.01787654 - t * 0.00420059)))))))) / Math.sqrt(x);
}

/** ln I0(x). */
export function lnI0(x) { return x + DMath.log(i0e(x)); }

/** g(x) = 2·I1(x) / (x·I0(x)): 1 at x = 0, → 2/x for large x. */
export function besselGain(x) {
    if (x < 1e-6) return 1 - x * x / 8;
    return 2 * i1e(x) / (x * i0e(x));
}

/** Is·e^u, continued linearly above I_LIMIT (no series resistance modelled). */
export const I_LIMIT = 0.5;
export function expCapped(u, is) {
    const uMax = DMath.log(I_LIMIT / is);
    if (u <= uMax) { const e = is * DMath.exp(u); return [e, e]; }
    return [I_LIMIT * (1 + u - uMax), I_LIMIT];
}

// ─── Field-effect describing function (quadrature over the cycle) ───────

const QN = 32;
const QCOS = Array.from({ length: QN }, (_, k) => DMath.cos(Math.PI * (k + 0.5) / QN));

/**
 * Cycle average and fundamental of a static law f(v) driven by
 * v0 + A·cos θ: returns [<f> − f(v0), effective transconductance
 * (fundamental / A; f'(v0) as A → 0)].
 */
export function describeLaw(f, v0, A) {
    const f0 = f(v0);
    if (!(A > 1e-9)) {
        const d = 1e-6;
        return [0, (f(v0 + d) - f(v0 - d)) / (2 * d)];
    }
    let avg = 0, fund = 0;
    for (const c of QCOS) { const y = f(v0 + A * c); avg += y; fund += y * c; }
    return [avg / QN - f0, 2 * fund / (QN * A)];
}

// ─── Dense complex LU ───────────────────────────────────────────────────

/** In-place LU of a row-major complex n×n matrix with partial pivoting. */
export function cluFactor(re, im, n) {
    const piv = new Int32Array(n);
    for (let k = 0; k < n; k++) {
        let p = k, best = -1;
        for (let i = k; i < n; i++) {
            const a = re[i * n + k], b = im[i * n + k];
            const m = a * a + b * b;
            if (m > best) { best = m; p = i; }
        }
        if (!(best > 0)) throw new Error('rf: singular band matrix');
        piv[k] = p;
        if (p !== k) {
            for (let j = 0; j < n; j++) {
                let t = re[k * n + j]; re[k * n + j] = re[p * n + j]; re[p * n + j] = t;
                t = im[k * n + j]; im[k * n + j] = im[p * n + j]; im[p * n + j] = t;
            }
        }
        const dr = re[k * n + k], di = im[k * n + k];
        const dd = dr * dr + di * di;
        const ir = dr / dd, ii = -di / dd;
        for (let i = k + 1; i < n; i++) {
            const ar = re[i * n + k], ai = im[i * n + k];
            if (ar === 0 && ai === 0) continue;
            const lr = ar * ir - ai * ii, li = ar * ii + ai * ir;
            re[i * n + k] = lr; im[i * n + k] = li;
            const ro = i * n, ko = k * n;
            for (let j = k + 1; j < n; j++) {
                const ur = re[ko + j], ui = im[ko + j];
                if (ur === 0 && ui === 0) continue;
                re[ro + j] -= lr * ur - li * ui;
                im[ro + j] -= lr * ui + li * ur;
            }
        }
    }
    return { re, im, n, piv };
}

/** Solve in place with a factor from cluFactor. */
export function cluSolve(lu, br, bi) {
    const { re, im, n, piv } = lu;
    for (let k = 0; k < n; k++) {
        const p = piv[k];
        if (p !== k) { let t = br[k]; br[k] = br[p]; br[p] = t; t = bi[k]; bi[k] = bi[p]; bi[p] = t; }
    }
    for (let i = 0; i < n; i++) {
        let sr = br[i], si = bi[i];
        const ro = i * n;
        for (let j = 0; j < i; j++) {
            const lr = re[ro + j], li = im[ro + j];
            if (lr === 0 && li === 0) continue;
            sr -= lr * br[j] - li * bi[j];
            si -= lr * bi[j] + li * br[j];
        }
        br[i] = sr; bi[i] = si;
    }
    for (let i = n - 1; i >= 0; i--) {
        let sr = br[i], si = bi[i];
        const ro = i * n;
        for (let j = i + 1; j < n; j++) {
            const ur = re[ro + j], ui = im[ro + j];
            if (ur === 0 && ui === 0) continue;
            sr -= ur * br[j] - ui * bi[j];
            si -= ur * bi[j] + ui * br[j];
        }
        const dr = re[ro + i], di = im[ro + i];
        const dd = dr * dr + di * di;
        br[i] = (sr * dr + si * di) / dd;
        bi[i] = (si * dr - sr * di) / dd;
    }
}

/** Small dense complex solve (copies). A: K×K arrays of [re, im]. */
export function csolveSmall(Ar, Ai, br, bi, K) {
    const re = Float64Array.from(Ar), im = Float64Array.from(Ai);
    const xr = Float64Array.from(br), xi = Float64Array.from(bi);
    cluSolve(cluFactor(re, im, K), xr, xi);
    return [xr, xi];
}

// ─── Seeded PRNG (noise) ────────────────────────────────────────────────

export function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Standard normal pair from a uniform source (Box–Muller). */
export function gaussPair(rand) {
    const u = Math.max(1e-300, rand());
    const v = rand();
    const r = Math.sqrt(-2 * DMath.log(u));
    return [r * DMath.cos(2 * Math.PI * v), r * DMath.sin(2 * Math.PI * v)];
}

/** One-sided thermal current-noise density of a conductance G, A²/Hz. */
export const thermalCurrentPsd = (G) => 4 * KT * Math.max(0, G);

// ─── One band ───────────────────────────────────────────────────────────

export const H_UNIT = 1e-9;
export const K_MAX = 15;          // 32.8 µs

/**
 * A band's integrator. The caller supplies, per refresh, the linear system
 * (Y0lin, Y1lin as row-major complex N×N), the junction blocks (port
 * selectors and, per substep, their admittances) and the source function;
 * the band keeps its envelope X and a short history for interpolation.
 */
export class BandIntegrator {
    /**
     * @param {object} o
     * @param {number} o.N
     * @param {{pos:number|undefined, neg:number|undefined}[]} o.ports - voltage selectors (port i: X[pos] − X[neg])
     * @param {{pos:number|undefined, neg:number|undefined}[]} [o.inj] - current-injection patterns (same count; default the ports)
     */
    constructor({ N, ports, inj = ports }) {
        this.N = N;
        this.ports = ports;   // [{pos, neg}] voltage selectors (Qᵀ)
        this.inj = inj;       // [{pos, neg}] current-injection patterns (P), same count
        this.K = ports.length;
        this.X = { re: new Float64Array(N), im: new Float64Array(N) };
        this.t = null;        // time of X
        this.hist = [];       // [{t, re, im}] since the last commit (for interpolation)
        this.k = 6;
        this.calm = 0;
        this._lus = new Map();
        this._lin = null;
    }

    /** New linear part (after a refresh): Y0, Y1 row-major complex. */
    setLinear(Y0, Y1) {
        this._lin = { Y0, Y1 };
        this._lus.clear();
    }

    /** Factor A = Y0 + (a/h)·Y1 for substep 2^k (a = 1: backward Euler, 1.5: BDF2). */
    _factor(k, a) {
        const key = k * 2 + (a === 1 ? 0 : 1);
        let f = this._lus.get(key);
        if (f) return f;
        const { N, K } = this;
        const h = H_UNIT * DMath.pow(2, k);
        const { Y0, Y1 } = this._lin;
        const Are = new Float64Array(N * N), Aim = new Float64Array(N * N);
        for (let i = 0; i < N * N; i++) {
            Are[i] = Y0.re[i] + a * Y1.re[i] / h;
            Aim[i] = Y0.im[i] + a * Y1.im[i] / h;
        }
        const lu = cluFactor(Are, Aim, N);
        // W = A⁻¹·P (one column per port), C0 = Qᵀ·W.
        const W = [];
        for (const p of this.inj) {
            const wr = new Float64Array(N), wi = new Float64Array(N);
            if (p.pos !== undefined) wr[p.pos] += 1;
            if (p.neg !== undefined) wr[p.neg] -= 1;
            cluSolve(lu, wr, wi);
            W.push([wr, wi]);
        }
        const C0r = new Float64Array(K * K), C0i = new Float64Array(K * K);
        for (let q = 0; q < K; q++) for (let c = 0; c < K; c++) {
            const [r, i] = this._sel(q, W[c][0], W[c][1]);
            C0r[q * K + c] = r; C0i[q * K + c] = i;
        }
        f = { h, a, lu, W, C0r, C0i };
        this._lus.set(key, f);
        return f;
    }

    /** Port a's voltage in a vector. */
    _sel(a, re, im) {
        const p = this.ports[a];
        let r = 0, i = 0;
        if (p.pos !== undefined) { r += re[p.pos]; i += im[p.pos]; }
        if (p.neg !== undefined) { r -= re[p.neg]; i -= im[p.neg]; }
        return [r, i];
    }

    /** Port voltages of the present state. */
    portVoltages(X = this.X) {
        const out = [];
        for (let a = 0; a < this.K; a++) out.push(this._sel(a, X.re, X.im));
        return out;
    }

    /**
     * One substep of size H_UNIT·2^k from the present state: BDF2 when the
     * previous state `Xprev` was one substep of the same size earlier,
     * backward Euler otherwise (both L-stable: the fast modes the envelope
     * does not resolve are damped, never left ringing). `stamps(vPorts)`
     * returns {S0r,S0i,S1r,S1i} (K×K, block-diagonal per junction) at the
     * given port voltages; `source(t)` returns {re, im} (length N).
     */
    step(k, stamps, source, noise, Xprev = null) {
        const { N, K } = this;
        const bdf = !!Xprev;
        const a = bdf ? 1.5 : 1;
        const f = this._factor(k, a);
        const h = f.h;
        const t1 = this.t + h;
        const X = this.X;
        const vp = this.portVoltages();
        const S = stamps(vp);
        const J1 = source(t1);
        // History H = X_n (BE) or 2·X_n − X_{n−1}/2 (BDF2); rhs = J + Y1·H/h.
        const Hr = new Float64Array(N), Hi = new Float64Array(N);
        for (let i = 0; i < N; i++) {
            Hr[i] = bdf ? 2 * X.re[i] - 0.5 * Xprev.re[i] : X.re[i];
            Hi[i] = bdf ? 2 * X.im[i] - 0.5 * Xprev.im[i] : X.im[i];
        }
        const rr = Float64Array.from(J1.re), ri = Float64Array.from(J1.im);
        const { re: Y1r, im: Y1i } = this._lin.Y1;
        for (let i = 0; i < N; i++) {
            let sr = 0, si = 0;
            const o = i * N;
            for (let j = 0; j < N; j++) {
                const br = Y1r[o + j], bi = Y1i[o + j];
                if (br === 0 && bi === 0) continue;
                sr += br * Hr[j] - bi * Hi[j];
                si += br * Hi[j] + bi * Hr[j];
            }
            rr[i] += sr / h; ri[i] += si / h;
        }
        if (noise) noise(rr, ri, h);
        // Junction capacitive history: + P·S1·Qᵀ·H / h
        if (K) {
            const hp = [];
            for (let q = 0; q < K; q++) hp.push(this._sel(q, Hr, Hi));
            for (let q = 0; q < K; q++) {
                let ur = 0, ui = 0;
                for (let c = 0; c < K; c++) {
                    const m = q * K + c;
                    const mr = S.S1r[m], mi = S.S1i[m];
                    if (mr === 0 && mi === 0) continue;
                    ur += mr * hp[c][0] - mi * hp[c][1];
                    ui += mr * hp[c][1] + mi * hp[c][0];
                }
                const p = this.inj[q];
                if (p.pos !== undefined) { rr[p.pos] += ur / h; ri[p.pos] += ui / h; }
                if (p.neg !== undefined) { rr[p.neg] -= ur / h; ri[p.neg] -= ui / h; }
            }
        }
        // y = A⁻¹·rhs
        cluSolve(f.lu, rr, ri);
        if (K) {
            // S = θ·S0 + S1/h; u = (I + S·C0)⁻¹·S·z, z = Qᵀy; x = y − W·u
            const Sr = new Float64Array(K * K), Si = new Float64Array(K * K);
            let any = false;
            for (let m = 0; m < K * K; m++) {
                Sr[m] = S.S0r[m] + a * S.S1r[m] / h;
                Si[m] = S.S0i[m] + a * S.S1i[m] / h;
                if (Sr[m] !== 0 || Si[m] !== 0) any = true;
            }
            if (any) {
                const z = [];
                for (let a = 0; a < K; a++) z.push(this._sel(a, rr, ri));
                const Mr = new Float64Array(K * K), Mi = new Float64Array(K * K);
                const br = new Float64Array(K), bi = new Float64Array(K);
                for (let a = 0; a < K; a++) {
                    for (let c = 0; c < K; c++) {
                        let sr = a === c ? 1 : 0, si = 0;
                        for (let e = 0; e < K; e++) {
                            const s1r = Sr[a * K + e], s1i = Si[a * K + e];
                            if (s1r === 0 && s1i === 0) continue;
                            const cr = f.C0r[e * K + c], ci = f.C0i[e * K + c];
                            sr += s1r * cr - s1i * ci;
                            si += s1r * ci + s1i * cr;
                        }
                        Mr[a * K + c] = sr; Mi[a * K + c] = si;
                    }
                    let vr = 0, vi = 0;
                    for (let e = 0; e < K; e++) {
                        const s1r = Sr[a * K + e], s1i = Si[a * K + e];
                        vr += s1r * z[e][0] - s1i * z[e][1];
                        vi += s1r * z[e][1] + s1i * z[e][0];
                    }
                    br[a] = vr; bi[a] = vi;
                }
                const [ur, ui] = csolveSmall(Mr, Mi, br, bi, K);
                for (let c = 0; c < K; c++) {
                    const [wr, wi] = f.W[c];
                    const a = ur[c], b = ui[c];
                    if (a === 0 && b === 0) continue;
                    for (let i = 0; i < N; i++) {
                        rr[i] -= wr[i] * a - wi[i] * b;
                        ri[i] -= wr[i] * b + wi[i] * a;
                    }
                }
            }
        }
        return { t: t1, re: rr, im: ri, k };
    }
}
