// SPDX-License-Identifier: MIT
/**
 * Compliance laws for the light-driven parts (2026-11-23).
 *
 * `phototransistor`, `photodiode` and the optocoupler's output used to be
 * ideal current sources (or, for the optocoupler, a linear conductance set
 * by event-driven updates). An ideal source has no voltage limit: a large
 * series resistor drove a node above the supply, a phototransistor never
 * saturated, and the optocoupler's event-driven conductance — re-aimed after
 * every solve — chattered against a diode-pump capacitor until the adaptive
 * integrator failed at its minimum step. These laws are smooth, memoryless
 * and Newton-solved (`nonlinearCurrents`), so the network finds the
 * operating point in one solve and nothing is reported as an event.
 *
 * @module
 */

/**
 * Collector-emitter saturation shape of a phototransistor: the fraction of
 * its photo/base-driven collector current it can pass at `vce`.
 *   vce ≥ 0: 1 − e^(−vce/vk)  (90 % at 2.3·vk ≈ 0.23 V — a VCE(sat))
 *   vce < 0: (vce/vk)·e^(vce/vk)  (C1-continuous, peaks at −1/e at −vk and
 *            decays to zero: a reversed C-E junction passes no photocurrent)
 * Returns [shape, d shape / d vce].
 */
export const VCE_KNEE = 0.1;
export function vceShape(vce, vk = VCE_KNEE) {
    const x = vce / vk;
    if (x >= 0) {
        const e = Math.exp(-x);
        return [1 - e, e / vk];
    }
    const e = Math.exp(x);
    return [x * e, (1 + x) * e / vk];
}

/**
 * Smooth LED segment for the optocoupler emitter: rd above the knee vf,
 * exponentially dark below it (width w), plus a 1 µS leakage that keeps a
 * reverse-biased LED a defined element. Returns [amps, d amps / d v].
 */
export function ledSegment(v, vf, rd, w = 0.05) {
    const x = (v - vf) / w;
    // softplus with overflow-safe branches
    const sp = x > 30 ? x : Math.log1p(Math.exp(x));
    const sig = x > 30 ? 1 : 1 / (1 + Math.exp(-x));
    return [w * sp / rd + 1e-6 * v, sig / rd + 1e-6];
}

/**
 * Photodiode terminal current OUT of the anode lead (into its net) for a
 * photocurrent iL and anode−cathode voltage v: iL − Is·(e^(v/nVt) − 1).
 * Forward bias is limited by the junction (open-circuit voltage ≈ nVt·ln(iL/Is));
 * the exponential is continued linearly above vLin so a far Newton iterate
 * cannot overflow. Returns [amps, d amps / d v].
 */
export const PHOTODIODE = Object.freeze({ is: 1e-10, n: 1.0, vt: 0.025852, vLin: 0.9 });
export function photodiodeCurrent(iL, v, p = PHOTODIODE) {
    const nvt = p.n * p.vt;
    const vv = Math.min(v, p.vLin);
    const e = Math.exp(vv / nvt);
    let id = p.is * (e - 1);
    let g = p.is * e / nvt;
    if (v > p.vLin) id += g * (v - p.vLin);
    return [iL - id, -g];
}

/**
 * Solar cell / panel, single-diode model:
 *   I = Iph − Is·(e^((V + I·Rs)/(Ns·n·Vt)) − 1) − (V + I·Rs)/Rsh
 * with I the current OUT of `pos` into the circuit and V = Vpos − Vneg.
 *
 * Calibration from the part's datasheet-style parameters (all at light = 1):
 *   voc  open-circuit voltage (default 0.6 V, one cell); Ns = round(voc/0.6)
 *   isc  short-circuit current (default voc / rInternal — the old model's
 *        straight line through (0, voc) and (isc, 0), 0.12 A by default)
 *   rs   series resistance (default 3 % of voc/isc)
 *   rsh  shunt resistance (default 50 × voc/isc)
 * Is follows from Voc: Iph = Is·(e^(voc/(Ns·n·Vt)) − 1) + voc/rsh.
 * Iph scales with light, so Voc falls only logarithmically as light dims.
 */
export function solarCellParams(params = {}) {
    const voc = Number(params.voc ?? 0.6);
    const rInternal = Number(params.rInternal ?? 5);
    const isc = Number(params.isc ?? voc / rInternal);
    const ns = Math.max(1, Math.round(voc / 0.6));
    const n = Number(params.n ?? 1.3);
    const nvt = ns * n * 0.025852;
    const rs = Number(params.rs ?? 0.03 * voc / isc);
    const rsh = Number(params.rsh ?? 50 * voc / isc);
    // Short circuit: Iph ≈ isc·(1 + rs/rsh) (diode negligible at V = −I·rs).
    const iph = isc * (1 + rs / rsh);
    const is = Math.max((iph - voc / rsh) / Math.expm1(voc / nvt), 1e-30);
    return { voc, isc, ns, nvt, rs, rsh, iph, is };
}

/** [I, dI/dV] for terminal voltage v at photocurrent iph (implicit in I). */
export function solarCellCurrent(v, iph, p) {
    const VMAX = 40 * p.nvt;               // linear continuation of the exponential
    const diode = (vj) => {
        if (vj > VMAX) {
            const e = Math.exp(VMAX / p.nvt);
            return [p.is * (e - 1) + p.is * e / p.nvt * (vj - VMAX), p.is * e / p.nvt];
        }
        const e = Math.exp(vj / p.nvt);
        return [p.is * (e - 1), p.is * e / p.nvt];
    };
    // Scalar Newton on f(I) = iph − Id(v + I·rs) − (v + I·rs)/rsh − I.
    let i = iph - v / p.rsh;
    let g = 0;
    for (let k = 0; k < 100; k++) {
        const vj = v + i * p.rs;
        const [id, gd] = diode(vj);
        g = gd + 1 / p.rsh;
        const f = iph - id - vj / p.rsh - i;
        const step = f / (1 + g * p.rs);
        i += step;
        if (Math.abs(step) < 1e-15 + 1e-12 * Math.abs(i)) break;
    }
    const gd = diode(v + i * p.rs)[1] + 1 / p.rsh;
    return [i, -gd / (1 + gd * p.rs)];
}
