// SPDX-License-Identifier: MIT
/**
 * Double-balanced mixer IC with its own oscillator transistor, SA612/NE602
 * type: part `sa612`, DIP-8.
 *
 *   1 in_a   RF input A  (1.5 kΩ to an internal bias)
 *   2 in_b   RF input B  (1.5 kΩ to the same bias; usually bypassed to ground)
 *   3 gnd
 *   4 out_a  output A    (1.5 kΩ to vcc)
 *   5 out_b  output B    (1.5 kΩ to vcc)
 *   6 osc_b  oscillator transistor's base (biased internally through 18 kΩ)
 *   7 osc_e  oscillator transistor's emitter (4 kΩ to gnd inside)
 *   8 vcc    4.5 … 8 V
 *
 * THE CORE is a Gilbert cell: a differential pair on the RF inputs (with
 * emitter degeneration) whose two collector currents are each switched
 * between the two outputs by a cross-coupled quad driven from the
 * oscillator. Its large-signal law, the standard one for that cell, is
 *
 *     i_a − i_b = I_T · tanh(gm·v_rf / I_T) · tanh(v_lo / 2Vt),
 *     i_a + i_b = I_T,
 *
 * with v_rf = v(in_a) − v(in_b) and v_lo the oscillator base's swing against
 * its internal bias: the output current is the PRODUCT of the two inputs
 * while both are small, and the RF signal's polarity switched by the sign of
 * the LO once the LO is a few tens of millivolts (the switching mixer). Both
 * terms are odd, so neither input alone reaches the outputs (double
 * balanced): what appears there is the product, at the sum and difference
 * of the two inputs' frequencies.
 *
 * IN THE TIME DOMAIN (this module) the law is stamped as it stands, so slow
 * signals mix exactly: two square waves on the two inputs steer the tail
 * current from one output to the other at their difference frequency, a DC
 * level on either input sets the sign and the gain the other one sees.
 *
 * AT RF (src/radio.js) the chip is a junction-like element of the envelope
 * bands, kind 'mixer', with three ports (RF input, LO, output pair):
 *   - in a band, the outputs carry gm·⟨tanh(v_lo/2Vt)⟩/2·v_rf: the mixer as a
 *     differential amplifier whose gain the DC on the LO pin sets;
 *   - RF in band p and LO in band q put (gm/2)·V_p·conj(T_q) into a band at
 *     f_p − f_q and (gm/2)·V_p·T_q into one at f_p + f_q (T_q: the
 *     fundamental of tanh(v_lo/2Vt), → 4/π for a large LO);
 *   - RF and LO in the SAME band beat at audio: the outputs carry
 *     (gm/2)·Re(V_rf·conj(T_lo)), which the time-domain stamp adds (direct
 *     conversion, product and synchronous detection).
 *
 * The oscillator transistor is an ordinary solver `npn` (`<id>:qosc`:
 * base osc_b, emitter osc_e, collector vcc), so external capacitors and a
 * coil make a Colpitts or Hartley oscillator with it, at RF in the bands like
 * any other transistor oscillator.
 *
 * THE SUPPLY. The internal biases are fractions of the supply (a resistive
 * reference), the tail current comes up between 3 and 4 V of supply, and an
 * output whose pin is pulled below ~1 V starves the switching quad.
 *
 * PARAMS (all optional): itail (A, 1 mA), gm (S, 8 mS: the degenerated
 * input pair), rin (Ω per input, 1500), rout (Ω per output, 1500), beta (of
 * the oscillator transistor, 100), ft (Hz, 500 MHz).
 *
 * NOT MODELLED: the input and output capacitances (~3 pF), the chip's
 * internal oscillator buffer (the LO is taken at the base), its noise figure,
 * the third-order intercept beyond the tanh law.
 *
 * @module
 */

import { DMath } from './det-math.js';

export const MIXER_IC_KIND = 'sa612';
export const MIXER_IC_PINS = Object.freeze(['in_a', 'in_b', 'gnd', 'out_a', 'out_b', 'osc_b', 'osc_e', 'vcc']);
export const MIXER_IC_DEFAULTS = Object.freeze({ itail: 1e-3, gm: 8e-3, rin: 1500, rout: 1500, beta: 100, ft: 500e6 });

const VT = 0.02585;
/** Input bias, LO bias: fractions of the supply. */
const RF_BIAS_RATIO = 0.23;
/** The LO bias (osc_b's rest) as a fraction of the supply above gnd. */
export const LO_BIAS_RATIO = 0.27;
const LO_BIAS_OHMS = 18e3;
const OSC_EMITTER_OHMS = 4000;
const SUPPLY_OHMS = 6000;

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

/** The chip's numbers, defaults filled in. */
export function mixerCard(part) {
    const P = part?.params ?? {};
    const D = MIXER_IC_DEFAULTS;
    return {
        itail: Math.max(1e-6, num(P.itail, D.itail)),
        gm: Math.max(1e-6, num(P.gm, D.gm)),
        rin: Math.max(1, num(P.rin, D.rin)),
        rout: Math.max(1, num(P.rout, D.rout)),
        beta: Math.max(1, num(P.beta, D.beta)),
        ft: Math.max(1e6, num(P.ft, D.ft)),
    };
}

/** Tail current at a supply voltage: up between 3 and 4 V. */
export function mixerTail(card, vSupply) {
    return card.itail * 0.5 * (1 + DMath.tanh((vSupply - 3.5) / 0.25));
}

/** How much of its share an output can still carry with its pin at v (above gnd). */
export function mixerOutputFade(v) { return v > 1.0 ? DMath.tanh((v - 1.0) / 0.2) : 0; }

/**
 * The core's currents drawn from out_a and out_b (A, into the chip) at the
 * given pin voltages (relative to gnd), plus an extra differential part
 * `extra` (the RF bands' audio-rate product, half the difference current).
 */
export function mixerCurrents(card, v, extra = 0) {
    const iT = mixerTail(card, v.vcc);
    const y = DMath.tanh(card.gm * v.rf / iT) * DMath.tanh(v.lo / (2 * VT));
    const half = iT / 2;
    return [(half * (1 + y) + extra) * mixerOutputFade(v.outA), (half * (1 - y) - extra) * mixerOutputFade(v.outB)];
}

/**
 * Solver-only expansion: each `sa612` keeps its id (its device stamps the
 * core) and gets its internal biases, resistors and oscillator transistor as
 * hidden parts. Missing pins get nets of their own. The caller's parts and
 * nets are not mutated; idempotent.
 */
export function expandMixerIcs(parts, nets) {
    const selected = parts.filter((p) => p.kind === MIXER_IC_KIND);
    if (!selected.length) return { parts, nets };
    const present = new Set(parts.map((p) => p.id));
    const outParts = [...parts];
    const outNets = nets.map((n) => ({ ...n, terminals: [...n.terminals] }));
    const netOf = (id, t) => outNets.find((n) => n.terminals.some((x) => x.part === id && x.terminal === t));
    for (const p of selected) {
        if (present.has(`${p.id}:qosc`)) continue;
        const pin = (t) => {
            let n = netOf(p.id, t);
            if (!n) {
                n = { id: `n_${p.id}_${t}`, terminals: [{ part: p.id, terminal: t }] };
                outNets.push(n);
            }
            return n;
        };
        const [inA, inB, gnd, outA, outB, oscB, oscE, vcc] = MIXER_IC_PINS.map(pin);
        const rfBias = { id: `n_${p.id}_rfbias`, terminals: [] };
        const loRef = { id: `n_${p.id}_lobias`, terminals: [] };
        outNets.push(rfBias, loRef);
        const card = mixerCard(p);
        const add = (id, kind, params, ends) => {
            outParts.push({ id, kind, params, terminals: ends.map(([, t]) => t) });
            for (const [n, t] of ends) n.terminals.push({ part: id, terminal: t });
        };
        const R = (sfx, ohms, a, b) => add(`${p.id}:${sfx}`, 'resistor', { ohms }, [[a, 'a'], [b, 'b']]);
        add(`${p.id}:rfref`, 'vcvs', { gain: RF_BIAS_RATIO }, [[rfBias, 'outp'], [gnd, 'outn'], [vcc, 'inp'], [gnd, 'inn']]);
        add(`${p.id}:loref`, 'vcvs', { gain: LO_BIAS_RATIO }, [[loRef, 'outp'], [gnd, 'outn'], [vcc, 'inp'], [gnd, 'inn']]);
        R('rina', card.rin, inA, rfBias);
        R('rinb', card.rin, inB, rfBias);
        R('routa', card.rout, outA, vcc);
        R('routb', card.rout, outB, vcc);
        R('rlo', LO_BIAS_OHMS, oscB, loRef);
        R('remit', OSC_EMITTER_OHMS, oscE, gnd);
        R('rsup', SUPPLY_OHMS, vcc, gnd);
        add(`${p.id}:qosc`, 'npn', { beta: card.beta, ft: card.ft }, [[oscB, 'base'], [vcc, 'collector'], [oscE, 'emitter']]);
    }
    return { parts: outParts, nets: outNets };
}
