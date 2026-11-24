// Bit-reproducible transcendental functions for the analog and RF solvers.
//
// V8's Math.exp / log / sin / cos / pow / atan2 / tanh … are C++ (a port of
// fdlibm) and the compiler may fuse a*b+c into one FMA instruction where the
// CPU has one. arm64 (Apple silicon) does, x64 builds do not: the same call
// returns results one ulp apart on macOS and on Linux CI for a few inputs in
// a hundred thousand. Most circuits never notice. An oscillator that starts
// from noise, squegs, or sits near its threshold amplifies that ulp into a
// different trajectory within tens of microseconds — the RF benches gave a
// 10 kHz beat on Linux and 5 kHz on macOS.
//
// These functions use only + − × ÷, comparisons, Math.sqrt / floor / trunc /
// abs (all exactly rounded by IEEE 754) and bit-level scaling, which
// ECMAScript requires to evaluate identically everywhere: no fusion, no
// platform library. Accuracy is about one ulp (fdlibm's polynomials).

const F64 = new Float64Array(1);
const U32 = new Uint32Array(F64.buffer);
const LITTLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const HI = LITTLE ? 1 : 0, LO = LITTLE ? 0 : 1;

/** 2^k exactly, for integer k in [-1074, 1023]. */
function pow2(k) {
    if (k > 1023) return Infinity;
    if (k >= -1022) { U32[HI] = (k + 1023) << 20; U32[LO] = 0; return F64[0]; }
    if (k < -1074) return 0;
    // subnormal: 2^k = 2^(k+64) · 2^-64, both normal; the product is exact
    U32[HI] = (k + 64 + 1023) << 20; U32[LO] = 0;
    const a = F64[0];
    U32[HI] = (-64 + 1023) << 20; U32[LO] = 0;
    return a * F64[0];
}

/** y · 2^k without double rounding while k stays in range (k integer). */
function scale(y, k) {
    if (k > 1023) { y *= pow2(1023); k -= 1023; if (k > 1023) return y * Infinity; }
    else if (k < -1022) { y *= pow2(-1022); k += 1022; if (k < -1022) { y *= pow2(-1022); k += 1022; } }
    return y * pow2(Math.max(-1074, Math.min(1023, k)));
}

const LN2_HI = 6.93147180369123816490e-01, LN2_LO = 1.90821492927058770002e-10, INV_LN2 = 1.44269504088896338700e+00;
const P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05,
    P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08;

export function exp(x) {
    if (x !== x) return NaN;
    if (x > 709.782712893383973096) return Infinity;
    if (x < -745.13321910194110842) return 0;
    if (Math.abs(x) < 3.725290298461914e-09) return 1 + x;
    const k = Math.trunc(x * INV_LN2 + (x < 0 ? -0.5 : 0.5));
    const hi = x - k * LN2_HI, lo = k * LN2_LO;
    const r = hi - lo;
    const t = r * r;
    const c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
    if (k === 0) return 1 - ((r * c) / (c - 2) - r);
    const y = 1 - ((lo - (r * c) / (2 - c)) - hi);
    return scale(y, k);
}

const LG1 = 6.666666666666735130e-01, LG2 = 3.999999999940941908e-01, LG3 = 2.857142874366239149e-01,
    LG4 = 2.222219843214978396e-01, LG5 = 1.818357216161805012e-01, LG6 = 1.531383769920937332e-01,
    LG7 = 1.479819860511658591e-01;

export function log(x) {
    if (x !== x || x < 0) return NaN;
    if (x === 0) return -Infinity;
    if (x === Infinity) return Infinity;
    let k = 0;
    if (x < 2.2250738585072014e-308) { x *= 18014398509481984; k = -54; }   // 2^54
    F64[0] = x;
    let hx = U32[HI];
    k += (hx >>> 20) - 1023;
    hx &= 0x000fffff;
    const i = (hx + 0x95f64) & 0x100000;      // normalise the mantissa into [√2/2, √2)
    U32[HI] = hx | (i ^ 0x3ff00000);
    k += i >>> 20;
    const f = F64[0] - 1;
    const s = f / (2 + f), z = s * s, w = z * z;
    const t1 = w * (LG2 + w * (LG4 + w * LG6));
    const t2 = z * (LG1 + w * (LG3 + w * (LG5 + w * LG7)));
    const R = t2 + t1, hfsq = 0.5 * f * f;
    return k * LN2_HI - ((hfsq - (s * (hfsq + R) + k * LN2_LO)) - f);
}

export function log1p(x) {
    if (x !== x || x < -1) return NaN;
    const u = 1 + x;
    if (u === 1) return x;
    if (u === Infinity) return Infinity;
    return log(u) * (x / (u - 1));            // Goldberg: cancels u's rounding
}

export function expm1(x) {
    if (x !== x) return NaN;
    if (Math.abs(x) < 1e-5) return x + x * x * (0.5 + x / 6);
    const u = exp(x);
    if (u === Infinity) return Infinity;
    if (u === 1) return x;
    const um1 = u - 1;
    if (um1 === -1) return -1;
    return um1 * (x / log(u));                // Kahan
}

const LOG10E = 4.34294481903251816668e-01, LOG2E = 1.44269504088896338700e+00;
export const log10 = (x) => log(x) * LOG10E;
export const log2 = (x) => log(x) * LOG2E;

// π/2 in five chunks of at most 24 significant bits: n · chunk is exact for
// |n| < 2^29, so the reduction is exact to ~120 bits for |x| up to ~8e8.
const PIO2 = [1.5707963705062866, -4.371138828673793e-08, -1.7151245100058819e-15, 1.056299898220315e-23, 8.478427566216846e-32];
const TWO_OVER_PI = 0.6366197723675814;

function reduce(x) {
    const n = Math.round(x * TWO_OVER_PI);
    let r = x;
    for (const p of PIO2) r -= n * p;
    return [n, r];
}

const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
    S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
    C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;

function ksin(x) {
    const z = x * x, v = z * x;
    const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
    return x + v * (S1 + z * r);
}
function kcos(x) {
    const z = x * x;
    const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
    const hz = 0.5 * z, w = 1 - hz;
    return w + (((1 - w) - hz) + z * r);
}

export function sin(x) {
    if (!Number.isFinite(x)) return NaN;
    if (Math.abs(x) < 0.7853981633974483) return ksin(x);
    const [n, r] = reduce(x);
    switch (((n % 4) + 4) % 4) {
        case 0: return ksin(r);
        case 1: return kcos(r);
        case 2: return -ksin(r);
        default: return -kcos(r);
    }
}

export function cos(x) {
    if (!Number.isFinite(x)) return NaN;
    if (Math.abs(x) < 0.7853981633974483) return kcos(x);
    const [n, r] = reduce(x);
    switch (((n % 4) + 4) % 4) {
        case 0: return kcos(r);
        case 1: return -ksin(r);
        case 2: return -kcos(r);
        default: return ksin(r);
    }
}

export const tan = (x) => sin(x) / cos(x);

const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
    9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
    4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];

export function atan(x) {
    if (x !== x) return NaN;
    const sign = x < 0 ? -1 : 1;
    let ax = Math.abs(x);
    if (ax >= 3.6893488147419103e19) return sign * (ATANHI[3] + ATANLO[3]);
    let id = -1;
    if (ax < 0.4375) {
        if (ax < 3.725290298461914e-09) return x;
    } else if (ax < 1.1875) {
        if (ax < 0.6875) { id = 0; ax = (2 * ax - 1) / (2 + ax); } else { id = 1; ax = (ax - 1) / (ax + 1); }
    } else if (ax < 2.4375) { id = 2; ax = (ax - 1.5) / (1 + 1.5 * ax); } else { id = 3; ax = -1 / ax; }
    const z = ax * ax, w = z * z;
    const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
    const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
    if (id < 0) return sign * (ax - ax * (s1 + s2));
    const r = ATANHI[id] - ((ax * (s1 + s2) - ATANLO[id]) - ax);
    return sign * r;
}

const PI = 3.14159265358979311600e+00, PI_LO = 1.2246467991473531772e-16;
export function atan2(y, x) {
    if (x !== x || y !== y) return NaN;
    if (y === 0) {
        if (x > 0 || Object.is(x, 0)) return y;
        return Object.is(y, -0) ? -PI : PI;
    }
    if (x === 0) return y > 0 ? PI / 2 : -PI / 2;
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        const ix = Number.isFinite(x) ? 0 : Math.sign(x), iy = Number.isFinite(y) ? 0 : Math.sign(y);
        if (iy === 0) return x > 0 ? (y > 0 ? 0 : -0) : (y > 0 ? PI : -PI);
        if (ix === 0) return iy * PI / 2;
        return iy * (ix > 0 ? PI / 4 : 3 * PI / 4);
    }
    const a = atan(Math.abs(y / x));
    if (x > 0) return y > 0 ? a : -a;
    const r = PI - (a - PI_LO);
    return y > 0 ? r : -r;
}

export const asin = (x) => (x !== x || Math.abs(x) > 1 ? NaN : atan2(x, Math.sqrt((1 - x) * (1 + x))));
export const acos = (x) => (x !== x || Math.abs(x) > 1 ? NaN : atan2(Math.sqrt((1 - x) * (1 + x)), x));

export function pow(x, y) {
    if (y === 0) return 1;
    if (x !== x || y !== y) return NaN;
    if (y === 1) return x;
    if (y === 2) return x * x;
    if (y === 0.5 && x >= 0 && x !== Infinity) return Math.sqrt(x);
    if (y === -1) return 1 / x;
    const yInt = Number.isInteger(y);
    if (yInt && Math.abs(y) <= 64) {
        let n = Math.abs(y), b = x, r = 1;
        while (n > 0) { if (n & 1) r *= b; b *= b; n >>= 1; }
        return y < 0 ? 1 / r : r;
    }
    if (x === 0) {
        const odd = yInt && Math.abs(y % 2) === 1;
        if (y > 0) return odd ? x : 0;
        return odd ? 1 / x : Infinity;
    }
    if (x < 0) {
        if (!yInt) return NaN;
        const m = powPos(-x, y);
        return Math.abs(y % 2) === 1 ? -m : m;
    }
    if (x === Infinity) return y > 0 ? Infinity : 0;
    if (!Number.isFinite(y)) return x === 1 ? NaN : (x > 1) === (y > 0) ? Infinity : 0;
    if (x === 1) return 1;
    return powPos(x, y);
}

const SPLIT = 134217729;   // 2^27 + 1 (Veltkamp)
/** a·b exactly as hi + lo, without FMA (Dekker). */
function twoProd(a, b) {
    const p = a * b;
    const ca = SPLIT * a, ah = ca - (ca - a), al = a - ah;
    const cb = SPLIT * b, bh = cb - (cb - b), bl = b - bh;
    return [p, ((ah * bh - p) + ah * bl + al * bh) + al * bl];
}

/**
 * x^y for x > 0 within about an ulp. exp(y·log x) alone loses the bits of
 * log x's rounding times |y·log x| (five ulps at 10^10 to the −1/3): log x is
 * corrected by one Newton step on exp, and y·log x carried as hi + lo.
 */
function powPos(x, y) {
    const L = log(x);
    const e = exp(L);
    const dL = Number.isFinite(e) && e > 0 ? (x - e) / e : 0;     // log x − L, to ~1e-16
    const [th, tl0] = twoProd(y, L);
    const tl = tl0 + y * dL;
    if (th > 709.782712893383973096) return Infinity;
    if (th < -745.13321910194110842) return 0;
    const z = exp(th);
    return z + z * tl;
}

export function tanh(x) {
    if (x !== x) return NaN;
    const ax = Math.abs(x);
    if (ax > 22) return x > 0 ? 1 : -1;
    if (ax < 1e-9) return x;
    const e = expm1(2 * ax);
    const t = e / (e + 2);
    return x < 0 ? -t : t;
}

export const sinh = (x) => {
    const a = Math.abs(x);
    if (a < 1e-5) return x + x * x * x / 6;
    const e = expm1(a);
    const r = a > 710 ? Infinity : 0.5 * (e + e / (e + 1));
    return x < 0 ? -r : r;
};
export const cosh = (x) => { const e = exp(Math.abs(x)); return 0.5 * (e + 1 / e); };

/** The whole set, as a drop-in for the Math functions it replaces. */
export const DMath = { exp, log, log1p, expm1, log10, log2, sin, cos, tan, atan, atan2, asin, acos, pow, tanh, sinh, cosh };
