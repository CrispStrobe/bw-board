// SPDX-License-Identifier: MIT
/**
 * FM IF integrated circuit: a limiting amplifier and a quadrature detector
 * on one chip (part `fm_if`; pins in, gnd, vcc, out).
 *
 * THE CHIP. The IF (10.7 MHz in a VHF broadcast receiver, after the
 * ceramic filter) enters at `in` (330 Ω to an internal bias: the filter's
 * termination). A chain of differential stages amplifies it until it clips:
 * from a few tens of microvolts up the signal's amplitude is gone and only
 * its zero crossings — its frequency — are left (LIMITING: amplitude noise,
 * a spark's click, a fading station all vanish once the carrier is strong
 * enough). The limited IF drives a multiplier twice: directly and through a
 * phase-shift network (the quadrature tank, tuned to the IF), whose phase
 * turns with frequency as atan(2Q·Δf/f0). Their product, filtered, is the
 * detector output: proportional to that phase, i.e. to the instantaneous
 * frequency's distance from the quadrature tank's — the programme of an FM
 * station.
 *
 * THE MODEL. The input is a port of the RF bands (src/radio.js, kind
 * 'fmif'): from the band that carries most at the input, the envelope's
 * phase velocity gives the instantaneous frequency f_i = f_band + dφ/dt/2π
 * (over 1 µs). The output is a source behind 5 kΩ at
 *
 *     v_out = Vs/2 + Kd·atan(2Q·(f_i − f_q)/f_q) · A²/(A² + A_lim²)
 *
 * (Kd 1 V/rad, Q 20, A_lim 30 µV at the input), with f_q the quadrature
 * tank's tuning: `quadHz` (10.7 MHz) moved ±150 kHz by the chip's knob
 * (0.5 = on quadHz): mis-aligned, the S-curve's centre is off the IF and a
 * station is heard distorted, best on one slope. Without supply (below ~4 V)
 * the output collapses.
 *
 * NOT MODELLED: the chip's AGC and tuning-meter outputs, muting, the
 * limiter's own noise (its hiss between stations is the IF band's own noise
 * passed by the limiter), the quadrature tank's own bandwidth beyond its Q.
 *
 * @module
 */

import { DMath } from './det-math.js';

export const FM_IF_KIND = 'fm_if';
export const FM_IF_PINS = Object.freeze(['in', 'gnd', 'vcc', 'out']);
export const FM_IF_DEFAULTS = Object.freeze({ quadHz: 10.7e6, quadQ: 20, kd: 1, limitVolts: 30e-6, rin: 330, rout: 5000, quadSpanHz: 150e3 });

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

export function fmIfCard(part) {
    const P = part?.params ?? {};
    const D = FM_IF_DEFAULTS;
    return {
        quadHz: Math.max(1e5, num(P.quadHz, D.quadHz)),
        quadQ: Math.max(0.5, num(P.quadQ, D.quadQ)),
        kd: num(P.kd, D.kd),
        limitVolts: Math.max(1e-9, num(P.limitVolts, D.limitVolts)),
        rin: Math.max(1, num(P.rin, D.rin)),
        rout: Math.max(1, num(P.rout, D.rout)),
        quadSpanHz: Math.max(0, num(P.quadSpanHz, D.quadSpanHz)),
    };
}

/** The quadrature tank's frequency for the chip's knob (0..1; 0.5 = quadHz). */
export function fmQuadHz(card, control) {
    const x = Number.isFinite(control) ? Math.min(1, Math.max(0, control)) : 0.5;
    return card.quadHz + (x - 0.5) * 2 * card.quadSpanHz;
}

/** Detector output (V, about mid-supply) for an instantaneous frequency and input amplitude. */
export function fmDetector(card, fq, fi, A) {
    const phi = DMath.atan(2 * card.quadQ * (fi - fq) / fq);
    return card.kd * phi * (A * A) / (A * A + card.limitVolts * card.limitVolts);
}

/** The chip on at a supply voltage: up between 3.5 and 4.5 V. */
export function fmIfSupply(v) { return 0.5 * (1 + DMath.tanh((v - 4) / 0.25)); }

/** Solver-only expansion: the input termination (330 Ω to a bias at a quarter of the supply) and the supply draw. */
export function expandFmIfIcs(parts, nets) {
    const selected = parts.filter((p) => p.kind === FM_IF_KIND);
    if (!selected.length) return { parts, nets };
    const present = new Set(parts.map((p) => p.id));
    const outParts = [...parts];
    const outNets = nets.map((n) => ({ ...n, terminals: [...n.terminals] }));
    const netOf = (id, t) => outNets.find((n) => n.terminals.some((x) => x.part === id && x.terminal === t));
    for (const p of selected) {
        if (present.has(`${p.id}:rin`)) continue;
        const pin = (t) => {
            let n = netOf(p.id, t);
            if (!n) { n = { id: `n_${p.id}_${t}`, terminals: [{ part: p.id, terminal: t }] }; outNets.push(n); }
            return n;
        };
        const [nIn, gnd, vcc] = ['in', 'gnd', 'vcc'].map(pin);
        pin('out');
        const bias = { id: `n_${p.id}_bias`, terminals: [] };
        outNets.push(bias);
        const card = fmIfCard(p);
        const add = (id, kind, params, ends) => {
            outParts.push({ id, kind, params, terminals: ends.map(([, t]) => t) });
            for (const [n, t] of ends) n.terminals.push({ part: id, terminal: t });
        };
        add(`${p.id}:bias`, 'vcvs', { gain: 0.25 }, [[bias, 'outp'], [gnd, 'outn'], [vcc, 'inp'], [gnd, 'inn']]);
        add(`${p.id}:rin`, 'resistor', { ohms: card.rin }, [[nIn, 'a'], [bias, 'b']]);
        add(`${p.id}:rsup`, 'resistor', { ohms: 2200 }, [[vcc, 'a'], [gnd, 'b']]);
    }
    return { parts: outParts, nets: outNets };
}
